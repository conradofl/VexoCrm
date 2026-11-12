// Fase 2 — follow-up escolhendo áudio da Biblioteca de Áudios.
//
// Rotas de passo (POST/PATCH/GET /api/followup/templates) e o worker
// (processJob) rodam de verdade sobre Postgres real em memória (pglite com a
// migration de produção) e storage local real.
//
// Dublado, e só isto (tudo sai do processo):
//   - fetch global  -> a chamada HTTP para a Evolution (WhatsApp);
//   - followup/queue.js -> BullMQ/Redis;
//   - getLeadClientN8nSettings e getLeadClientEvolutionInstances -> config do
//     tenant e dos chips, que vem do Supabase.
// sendMediaMessageViaEvolution, a reserva de cota, o serviço da biblioteca e a
// leitura do arquivo NÃO são dublados.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUDIO_LIBRARY_MIGRATION,
  acessoInterno,
  createAudioLibraryDb,
  limparStorageDeTeste,
  poolFor,
  startHttp,
} from "./helpers/audioLibraryHarness.js";
import { makeWav } from "./helpers/audioFixtures.js";
import { _setPoolForTesting } from "../followup/db.js";

let db = null;
vi.mock("../services/database.js", () => ({
  get pgDatabasePool() {
    return db ? { query: (sql, params) => db.query(sql, params) } : null;
  },
}));

vi.mock("../followup/queue.js", () => ({
  QUEUE_NAME: "followup-test-queue",
  getRedisConnection: () => ({}),
  getFollowupQueue: () => ({ add: vi.fn(async () => ({ id: "bull-1" })), getJob: vi.fn(async () => null) }),
}));

vi.mock("../services/n8nSettings.js", () => ({
  // Janela de envio desligada: o teste não pode depender da hora em que roda.
  getLeadClientN8nSettings: vi.fn(async () => ({ send_window_enabled: false })),
}));

const chipsPorTenant = {};
vi.mock("../services/evolution.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getLeadClientEvolutionInstances: vi.fn(async (tenantId) => chipsPorTenant[tenantId] || []),
  };
});

const { registerFollowupRoutes } = await import("../followup/routes.js");
const { processJob } = await import("../followup/worker.js");
const { createAudio } = await import("../audioLibrary/service.js");
const { fakeFirebaseAuth } = await import("./helpers/audioLibraryHarness.js");

const TENANT_A = "teste-fup-audio-empresa-a";
const TENANT_B = "teste-fup-audio-empresa-b";
const USER_A = acessoInterno([TENANT_A]);
const AGENTE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENTE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CADENCIA_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CADENCIA_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const AGENDAMENTO_A = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const WORKER_SCHEMA = `
  CREATE TABLE public.followup_schedules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES public.followup_campaigns(id),
    company_id uuid NOT NULL REFERENCES public.followup_companies(id),
    lead_name text NOT NULL,
    phone text,
    meeting_datetime timestamptz,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE public.followup_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id uuid NOT NULL REFERENCES public.followup_schedules(id),
    template_id uuid REFERENCES public.followup_templates(id),
    custom_message text,
    status text NOT NULL DEFAULT 'pending',
    scheduled_for timestamptz,
    sent_at timestamptz,
    error_log text,
    bull_job_id text,
    media_path text,
    media_type text,
    media_mime text,
    media_filename text
  );
  CREATE TABLE public.evolution_instance_daily_usage (
    instance_id text NOT NULL,
    date date NOT NULL,
    sent_count integer NOT NULL DEFAULT 0,
    PRIMARY KEY (instance_id, date)
  );
`;

async function semear(banco) {
  await banco.query(
    `INSERT INTO followup_companies (id, tenant_id, name, evolution_instance) VALUES
       ($1, $3, 'Agente A', 'chip-a'), ($2, $4, 'Agente B', 'chip-b')`,
    [AGENTE_A, AGENTE_B, TENANT_A, TENANT_B]
  );
  // Sem condições de saída: o que está em prova é o envio, não a cadência.
  await banco.query(
    `INSERT INTO followup_campaigns (id, company_id, name, status, exit_on_reply, exit_on_won, exit_on_lost, exit_on_human_takeover) VALUES
       ($1, $3, 'Cadência A', 'active', false, false, false, false),
       ($2, $4, 'Cadência B', 'active', false, false, false, false)`,
    [CADENCIA_A, CADENCIA_B, AGENTE_A, AGENTE_B]
  );
}

describe("follow-up com áudio da biblioteca", () => {
  let http;
  let pool;
  let audioA;
  let audioB;
  let wavA;
  let fetchMock;

  async function criarPasso(body, access = USER_A) {
    return http.call("POST", "/api/followup/templates", {
      access,
      body: { campaign_id: CADENCIA_A, name: "Passo de áudio", trigger_type: "after_enrollment", ...body },
    });
  }

  async function criarJob(templateId) {
    await db.query(
      `INSERT INTO followup_schedules (id, campaign_id, company_id, lead_name, phone)
       VALUES ($1, $2, $3, 'Maria', '5534999990001') ON CONFLICT (id) DO NOTHING`,
      [AGENDAMENTO_A, CADENCIA_A, AGENTE_A]
    );
    const { rows } = await db.query(
      `INSERT INTO followup_jobs (schedule_id, template_id) VALUES ($1, $2) RETURNING id`,
      [AGENDAMENTO_A, templateId]
    );
    return rows[0].id;
  }

  async function jobDoBanco(jobId) {
    const { rows } = await db.query("SELECT status, error_log FROM followup_jobs WHERE id = $1", [jobId]);
    return rows[0];
  }

  function chamadasEvolution() {
    return fetchMock.mock.calls.filter(([url]) => String(url).startsWith("https://evo.test/"));
  }

  beforeAll(async () => {
    const noop = (req, res, next) => next();
    http = await startHttp((app) => registerFollowupRoutes(app, fakeFirebaseAuth, () => noop, noop));
  });

  afterAll(async () => {
    await http.close();
    limparStorageDeTeste([TENANT_A, TENANT_B]);
  });

  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    db = await createAudioLibraryDb({ extraSchema: WORKER_SCHEMA });
    pool = poolFor(db);
    _setPoolForTesting(pool);
    await semear(db);

    wavA = makeWav({ seconds: 3 });
    audioA = await createAudio(pool, { clientId: TENANT_A, buffer: wavA, name: "Boas-vindas A" });
    audioB = await createAudio(pool, { clientId: TENANT_B, buffer: makeWav({ seconds: 4 }), name: "Segredo da B" });

    chipsPorTenant[TENANT_A] = [
      {
        id: "chip-a",
        name: "chip-a",
        active: true,
        is_default: true,
        dispatch_webhook_url: "https://evo.test/message/sendText/chip-a",
        dispatch_webhook_token: "token-de-teste",
      },
    ];

    const realFetch = globalThis.fetch;
    fetchMock = vi.fn(async (url, init) => {
      if (String(url).startsWith("https://evo.test/")) {
        return new Response(JSON.stringify({ key: { id: "WA-1" } }), { status: 201 });
      }
      return realFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    _setPoolForTesting(null);
    await db.close();
    db = null;
    vi.restoreAllMocks();
  });

  describe("salvar o passo", () => {
    it("passo com áudio da própria empresa grava a referência, sem anexo solto, e o texto vira o nome do áudio", async () => {
      const res = await criarPasso({
        audio_library_id: audioA.id,
        media_path: "followup-media/qualquer/audio/1_x.ogg",
        media_type: "audio",
      });
      expect(res.status).toBe(201);
      const { rows } = await db.query("SELECT audio_library_id, media_path, media_type, message FROM followup_templates WHERE id = $1", [res.body.template.id]);
      expect(rows[0]).toEqual({ audio_library_id: audioA.id, media_path: null, media_type: null, message: "Áudio: Boas-vindas A" });
    });

    it("empresa A NÃO USA áudio da empresa B ao criar passo: 400 e nada gravado", async () => {
      const res = await criarPasso({ audio_library_id: audioB.id, message: "oi" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("AUDIO_NOT_AVAILABLE");
      const { rows } = await db.query("SELECT count(*)::int AS n FROM followup_templates");
      expect(rows[0].n).toBe(0);
    });

    it("empresa A NÃO USA áudio da empresa B ao editar passo", async () => {
      const criado = await criarPasso({ message: "texto comum" });
      const id = criado.body.template.id;
      const res = await http.call("PATCH", `/api/followup/templates/${id}`, { access: USER_A, body: { audio_library_id: audioB.id } });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("AUDIO_NOT_AVAILABLE");
      const { rows } = await db.query("SELECT audio_library_id FROM followup_templates WHERE id = $1", [id]);
      expect(rows[0].audio_library_id).toBeNull();
    });

    it("áudio arquivado não pode ser escolhido", async () => {
      await db.query("UPDATE audio_library SET archived_at = now() WHERE id = $1", [audioA.id]);
      const res = await criarPasso({ audio_library_id: audioA.id });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("AUDIO_NOT_AVAILABLE");
    });

    it("editar: escolher áudio limpa o anexo solto; anexar arquivo solto tira o áudio; null remove", async () => {
      const criado = await criarPasso({ message: "com anexo", media_path: "followup-media/x/document/1_a.pdf", media_type: "document" });
      const id = criado.body.template.id;

      await http.call("PATCH", `/api/followup/templates/${id}`, { access: USER_A, body: { audio_library_id: audioA.id } });
      let { rows } = await db.query("SELECT audio_library_id, media_path FROM followup_templates WHERE id = $1", [id]);
      expect(rows[0]).toEqual({ audio_library_id: audioA.id, media_path: null });

      await http.call("PATCH", `/api/followup/templates/${id}`, { access: USER_A, body: { media_path: "followup-media/x/image/2_b.png", media_type: "image" } });
      ({ rows } = await db.query("SELECT audio_library_id, media_path FROM followup_templates WHERE id = $1", [id]));
      expect(rows[0]).toEqual({ audio_library_id: null, media_path: "followup-media/x/image/2_b.png" });

      await http.call("PATCH", `/api/followup/templates/${id}`, { access: USER_A, body: { audio_library_id: audioA.id } });
      await http.call("PATCH", `/api/followup/templates/${id}`, { access: USER_A, body: { audio_library_id: null } });
      ({ rows } = await db.query("SELECT audio_library_id FROM followup_templates WHERE id = $1", [id]));
      expect(rows[0].audio_library_id).toBeNull();
    });

    it("a lista de passos devolve o áudio escolhido (nome e duração)", async () => {
      await criarPasso({ audio_library_id: audioA.id });
      await criarPasso({ name: "Passo de texto", message: "só texto" });
      const res = await http.call("GET", `/api/followup/templates?campaignId=${CADENCIA_A}`, { access: USER_A });
      expect(res.status).toBe(200);
      const porNome = Object.fromEntries(res.body.templates.map((t) => [t.name, t]));
      expect(porNome["Passo de áudio"].audio_library_id).toBe(audioA.id);
      expect(porNome["Passo de áudio"].audio_library).toEqual({ name: "Boas-vindas A", durationSeconds: 3, archived: false });
      expect(porNome["Passo de texto"].audio_library_id).toBeNull();
      expect(porNome["Passo de texto"].audio_library).toBeNull();
    });

    it("clonar a cadência leva o áudio da biblioteca junto", async () => {
      await criarPasso({ audio_library_id: audioA.id });
      const res = await http.call("POST", `/api/followup/campaigns/${CADENCIA_A}/clone`, { access: USER_A, body: {} });
      expect(res.status).toBe(201);
      const { rows } = await db.query("SELECT audio_library_id FROM followup_templates WHERE campaign_id = $1", [res.body.campaign.id]);
      expect(rows).toEqual([{ audio_library_id: audioA.id }]);
    });
  });

  describe("enviar (worker)", () => {
    it("manda o áudio da biblioteca como áudio do WhatsApp: um envio só, com os bytes do arquivo", async () => {
      const passo = await criarPasso({ audio_library_id: audioA.id });
      const jobId = await criarJob(passo.body.template.id);

      await processJob({ data: { jobId } });

      const chamadas = chamadasEvolution();
      expect(chamadas).toHaveLength(1);
      const [url, init] = chamadas[0];
      expect(url).toBe("https://evo.test/message/sendWhatsAppAudio/chip-a");
      const corpo = JSON.parse(init.body);
      expect(corpo.number).toBe("5534999990001");
      expect(Buffer.from(corpo.audio, "base64").equals(wavA)).toBe(true);
      // O texto do passo ("Áudio: nome") não vai para o lead.
      expect(init.body).not.toContain("Boas-vindas A");

      expect(await jobDoBanco(jobId)).toEqual({ status: "sent", error_log: null });
      const { rows } = await db.query("SELECT sent_count FROM evolution_instance_daily_usage WHERE instance_id = 'chip-a'");
      expect(rows[0].sent_count).toBe(1);
    });

    it("passo da empresa A apontando para áudio da empresa B NÃO envia: job falha com o motivo e a cota não é gasta", async () => {
      const passo = await criarPasso({ message: "texto comum" });
      // Só dá para chegar aqui escrevendo direto no banco — a rota recusa.
      await db.query("UPDATE followup_templates SET audio_library_id = $1 WHERE id = $2", [audioB.id, passo.body.template.id]);
      const jobId = await criarJob(passo.body.template.id);

      await expect(processJob({ data: { jobId } })).rejects.toMatchObject({ code: "AUDIO_LIBRARY_UNAVAILABLE" });

      expect(chamadasEvolution()).toHaveLength(0);
      const job = await jobDoBanco(jobId);
      expect(job.status).toBe("failed");
      expect(job.error_log).toBe("Áudio da biblioteca indisponível (audio_nao_encontrado_nesta_empresa); passo não enviado.");
      const { rows } = await db.query("SELECT count(*)::int AS n FROM evolution_instance_daily_usage");
      expect(rows[0].n).toBe(0);
    });

    it("áudio arquivado depois de escolhido não é enviado, e o texto do passo também não", async () => {
      const passo = await criarPasso({ audio_library_id: audioA.id });
      await db.query("UPDATE audio_library SET archived_at = now() WHERE id = $1", [audioA.id]);
      const jobId = await criarJob(passo.body.template.id);

      await expect(processJob({ data: { jobId } })).rejects.toMatchObject({ code: "AUDIO_LIBRARY_UNAVAILABLE" });
      expect(chamadasEvolution()).toHaveLength(0);
      expect((await jobDoBanco(jobId)).error_log).toContain("audio_arquivado");
    });

    it("passo de texto continua saindo como texto", async () => {
      const passo = await criarPasso({ name: "Texto", message: "Oi {{nome}}, tudo bem?" });
      const jobId = await criarJob(passo.body.template.id);
      await processJob({ data: { jobId } });
      const chamadas = chamadasEvolution();
      expect(chamadas).toHaveLength(1);
      expect(chamadas[0][0]).toBe("https://evo.test/message/sendText/chip-a");
      expect(JSON.parse(chamadas[0][1].body).text).toBe("Oi Maria, tudo bem?");
    });
  });
});

// Matriz código x schema: este código tem que rodar com o banco ANTES da
// migration (migration que falha não derruba o boot — o servidor sobe assim
// mesmo). O follow-up que já existia não pode cair por causa da biblioteca.
describe("código novo com schema antigo (sem a migration)", () => {
  let http;
  let pool;

  beforeAll(async () => {
    const noop = (req, res, next) => next();
    http = await startHttp((app) => registerFollowupRoutes(app, fakeFirebaseAuth, () => noop, noop));
  });
  afterAll(async () => {
    await http.close();
  });

  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    db = await createAudioLibraryDb({ withMigration: false, extraSchema: WORKER_SCHEMA });
    pool = poolFor(db);
    _setPoolForTesting(pool);
    await semear(db);
    chipsPorTenant[TENANT_A] = [
      { id: "chip-a", name: "chip-a", active: true, is_default: true, dispatch_webhook_url: "https://evo.test/message/sendText/chip-a", dispatch_webhook_token: "t" },
    ];
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      if (String(url).startsWith("https://evo.test/")) return new Response(JSON.stringify({ key: { id: "WA-1" } }), { status: 201 });
      return realFetch(url, init);
    }));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    _setPoolForTesting(null);
    await db.close();
    db = null;
    vi.restoreAllMocks();
  });

  it("a coluna não existe mesmo neste banco", async () => {
    await expect(db.query("SELECT audio_library_id FROM followup_templates")).rejects.toThrow(/audio_library_id/);
    expect(AUDIO_LIBRARY_MIGRATION).toContain("audio_library_id");
  });

  it("criar, editar, listar e clonar passo comum continuam funcionando", async () => {
    const criado = await http.call("POST", "/api/followup/templates", {
      access: USER_A,
      body: { campaign_id: CADENCIA_A, name: "Texto", message: "Oi", trigger_type: "after_enrollment", audio_library_id: null },
    });
    expect(criado.status).toBe(201);
    const id = criado.body.template.id;

    const editado = await http.call("PATCH", `/api/followup/templates/${id}`, { access: USER_A, body: { message: "Oi de novo", audio_library_id: null } });
    expect(editado.status).toBe(200);

    const lista = await http.call("GET", `/api/followup/templates?campaignId=${CADENCIA_A}`, { access: USER_A });
    expect(lista.status).toBe(200);
    expect(lista.body.templates).toHaveLength(1);
    expect(lista.body.templates[0].audio_library_id).toBeNull();

    const clone = await http.call("POST", `/api/followup/campaigns/${CADENCIA_A}/clone`, { access: USER_A, body: {} });
    expect(clone.status).toBe(201);
    expect(clone.body.templatesCount).toBe(1);
  });

  it("o worker continua enviando passo de texto", async () => {
    const criado = await http.call("POST", "/api/followup/templates", {
      access: USER_A,
      body: { campaign_id: CADENCIA_A, name: "Texto", message: "Oi", trigger_type: "after_enrollment" },
    });
    await db.query(
      `INSERT INTO followup_schedules (id, campaign_id, company_id, lead_name, phone) VALUES ($1, $2, $3, 'Maria', '5534999990001')`,
      [AGENDAMENTO_A, CADENCIA_A, AGENTE_A]
    );
    const { rows } = await db.query(`INSERT INTO followup_jobs (schedule_id, template_id) VALUES ($1, $2) RETURNING id`, [AGENDAMENTO_A, criado.body.template.id]);

    await processJob({ data: { jobId: rows[0].id } });

    const { rows: jobs } = await db.query("SELECT status FROM followup_jobs WHERE id = $1", [rows[0].id]);
    expect(jobs[0].status).toBe("sent");
  });
});
