// Fase 3 — ligar áudio da biblioteca a agente de atendimento
// (PUT /api/audio-library/:id/agents, GET /agents, GET /usage).
// Mesma bancada de audioLibraryRoutes.test.js: Express real, pglite com a
// migration de produção, storage local real. Dublado só o token Firebase e o
// plano do tenant (Supabase).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { acessoInterno, createAudioLibraryDb, limparStorageDeTeste, startHttp } from "./helpers/audioLibraryHarness.js";
import { makeWav } from "./helpers/audioFixtures.js";

let db = null;
vi.mock("../services/database.js", () => ({
  get pgDatabasePool() {
    return db ? { query: (sql, params) => db.query(sql, params) } : null;
  },
}));
vi.mock("../services/n8nSettings.js", () => ({
  getLeadClientN8nSettings: vi.fn(async () => ({ plan_tier: "avancado", modulos_avulsos: [] })),
}));
vi.mock("../access/middlewares.js", async (importOriginal) => {
  const actual = await importOriginal();
  const { fakeFirebaseAuth } = await import("./helpers/audioLibraryHarness.js");
  return { ...actual, requireFirebaseAuth: fakeFirebaseAuth };
});

const { registerAudioLibraryRoutes } = await import("../audioLibrary/routes.js");

const TENANT_A = "teste-audio-agentes-a";
const TENANT_B = "teste-audio-agentes-b";
const USER_A = acessoInterno([TENANT_A]);
const USER_B = acessoInterno([TENANT_B]);
const ATENDE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ATENDE_A2 = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";
const CAMPANHA_A = "abababab-abab-4bab-8bab-abababababab";
const ARQUIVADO_A = "acacacac-acac-4cac-8cac-acacacacacac";
const ATENDE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const LEAD_MESSAGES_SCHEMA = `
  CREATE TABLE public.lead_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL,
    phone text,
    direction text NOT NULL DEFAULT 'outbound',
    message_text text,
    created_at timestamptz NOT NULL DEFAULT now(),
    meta jsonb NOT NULL DEFAULT '{}'::jsonb
  );
`;

describe("áudio da biblioteca ligado a agente de atendimento", () => {
  let http;

  async function enviar(name, { whenToUse = "Quando perguntam o endereço", access = USER_A, clientId = TENANT_A } = {}) {
    const params = new URLSearchParams({ clientId, name });
    if (whenToUse) params.set("whenToUse", whenToUse);
    const res = await http.call("POST", `/api/audio-library?${params}`, { access, body: makeWav({ seconds: 1 }) });
    expect(res.status).toBe(201);
    return res.body.audio.id;
  }
  const ligar = (id, companyIds, access = USER_A) =>
    http.call("PUT", `/api/audio-library/${id}/agents`, { access, body: { companyIds } });
  async function ligacoes(id) {
    const { rows } = await db.query("SELECT company_id::text AS c, client_id FROM audio_library_agents WHERE audio_id = $1 ORDER BY 1", [id]);
    return rows;
  }

  beforeAll(async () => {
    http = await startHttp((app) => registerAudioLibraryRoutes(app));
  });
  afterAll(async () => {
    await http.close();
    limparStorageDeTeste([TENANT_A, TENANT_B]);
  });
  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db = await createAudioLibraryDb({ extraSchema: LEAD_MESSAGES_SCHEMA });
    await db.query(
      `INSERT INTO followup_companies (id, tenant_id, name, agent_kind, archived_at) VALUES
        ($1, $6, 'Bia', 'atendimento', NULL), ($2, $6, 'Caio', 'atendimento', NULL),
        ($3, $6, 'Disparo', 'campanha', NULL), ($4, $6, 'Antigo', 'atendimento', now()),
        ($5, $7, 'Atendente da B', 'atendimento', NULL)`,
      [ATENDE_A, ATENDE_A2, CAMPANHA_A, ARQUIVADO_A, ATENDE_B, TENANT_A, TENANT_B]
    );
  });
  afterEach(async () => {
    await db.close();
    db = null;
    vi.restoreAllMocks();
  });

  it("lista só os agentes de atendimento ativos da própria empresa", async () => {
    const res = await http.call("GET", `/api/audio-library/agents?clientId=${TENANT_A}`, { access: USER_A });
    expect(res.status).toBe(200);
    expect(res.body.agents).toEqual([
      { id: ATENDE_A, name: "Bia", audioCount: 0 },
      { id: ATENDE_A2, name: "Caio", audioCount: 0 },
    ]);
    expect(res.body.maxAudiosPerAgent).toBe(10);
  });

  it("liga, troca e desliga; a lista de áudios devolve os agentes ligados", async () => {
    const id = await enviar("Endereço");
    expect((await ligar(id, [ATENDE_A, ATENDE_A2])).status).toBe(200);
    expect(await ligacoes(id)).toEqual([
      { c: ATENDE_A2, client_id: TENANT_A },
      { c: ATENDE_A, client_id: TENANT_A },
    ]);

    const lista = await http.call("GET", `/api/audio-library?clientId=${TENANT_A}`, { access: USER_A });
    expect(lista.body.audios[0].agentIds.sort()).toEqual([ATENDE_A2, ATENDE_A].sort());

    expect((await ligar(id, [ATENDE_A2])).body.agentIds).toEqual([ATENDE_A2]);
    expect(await ligacoes(id)).toEqual([{ c: ATENDE_A2, client_id: TENANT_A }]);

    expect((await ligar(id, [])).status).toBe(200);
    expect(await ligacoes(id)).toEqual([]);
  });

  it("isolamento: empresa A não liga seu áudio ao agente da empresa B", async () => {
    const id = await enviar("Endereço");
    const res = await ligar(id, [ATENDE_B]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("AGENT_NOT_AVAILABLE");
    expect(await ligacoes(id)).toEqual([]);
  });

  it("isolamento: empresa B não mexe nas ligações do áudio da empresa A", async () => {
    const id = await enviar("Endereço");
    await ligar(id, [ATENDE_A]);
    const res = await ligar(id, [ATENDE_B], USER_B);
    expect(res.status).toBe(403);
    expect(await ligacoes(id)).toEqual([{ c: ATENDE_A, client_id: TENANT_A }]);
    expect((await http.call("GET", `/api/audio-library/agents?clientId=${TENANT_A}`, { access: USER_B })).status).toBe(403);
  });

  it("agente de campanha e agente arquivado não recebem áudio; uma recusa não grava nada", async () => {
    const id = await enviar("Endereço");
    for (const agente of [CAMPANHA_A, ARQUIVADO_A]) {
      const res = await ligar(id, [ATENDE_A, agente]);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("AGENT_NOT_AVAILABLE");
    }
    expect(await ligacoes(id)).toEqual([]);
    expect((await ligar(id, ["não-é-uuid"])).body.error.code).toBe("INVALID_AGENTS");
  });

  it("sem 'quando usar' não liga; e não dá para apagar o 'quando usar' de áudio ligado", async () => {
    const semTexto = await enviar("Mudo", { whenToUse: null });
    const res = await ligar(semTexto, [ATENDE_A]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("WHEN_TO_USE_REQUIRED");

    const comTexto = await enviar("Endereço");
    await ligar(comTexto, [ATENDE_A]);
    const patch = await http.call("PATCH", `/api/audio-library/${comTexto}`, { access: USER_A, body: { whenToUse: "" } });
    expect(patch.status).toBe(400);
    expect(patch.body.error.code).toBe("WHEN_TO_USE_REQUIRED");
    const { rows } = await db.query("SELECT when_to_use FROM audio_library WHERE id = $1", [comTexto]);
    expect(rows[0].when_to_use).toBe("Quando perguntam o endereço");
    // Trocar o texto continua podendo.
    expect((await http.call("PATCH", `/api/audio-library/${comTexto}`, { access: USER_A, body: { whenToUse: "Outro momento" } })).status).toBe(200);
  });

  it("teto de 10 áudios por agente: o 11º é recusado dizendo o agente; religar um que já estava não conta", async () => {
    const ids = [];
    for (let i = 0; i < 10; i += 1) {
      ids.push(await enviar(`Áudio ${i}`));
      expect((await ligar(ids[i], [ATENDE_A])).status).toBe(200);
    }
    const onze = await enviar("Áudio 11");
    const res = await ligar(onze, [ATENDE_A]);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("AGENT_AUDIO_LIMIT");
    expect(res.body.error.message).toBe('O agente "Bia" já tem 10 áudios, que é o máximo. Tire um áudio dele antes de ligar outro.');
    expect(await ligacoes(onze)).toEqual([]);

    // Quem já está ligado pode salvar de novo (e ganhar outro agente).
    expect((await ligar(ids[0], [ATENDE_A, ATENDE_A2])).status).toBe(200);
    // Arquivar um libera a vaga.
    expect((await http.call("POST", `/api/audio-library/${ids[1]}/archive`, { access: USER_A })).status).toBe(200);
    expect(await ligacoes(ids[1])).toEqual([]);
    expect((await ligar(onze, [ATENDE_A])).status).toBe(200);
  });

  it("contagem de envios vem das mensagens gravadas, por empresa", async () => {
    const id = await enviar("Endereço");
    const idB = await enviar("Da B", { access: USER_B, clientId: TENANT_B });
    const meta = (audioId) => JSON.stringify({ audioLibraryId: audioId });
    await db.query(
      `INSERT INTO lead_messages (client_id, phone, direction, message_text, meta, created_at) VALUES
        ($1, '5534999990001', 'outbound', '[áudio]', $3::jsonb, now()),
        ($1, '5534999990002', 'outbound', '[áudio]', $3::jsonb, now() - interval '10 days'),
        ($1, '5534999990003', 'outbound', '[áudio]', $3::jsonb, now() - interval '120 days'),
        ($1, '5534999990004', 'outbound', 'texto comum', '{}'::jsonb, now()),
        ($2, '5534999990005', 'outbound', '[áudio]', $4::jsonb, now())`,
      [TENANT_A, TENANT_B, meta(id), meta(idB)]
    );
    const res = await http.call("GET", `/api/audio-library/usage?clientId=${TENANT_A}`, { access: USER_A });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ windowDays: 90, sends: { [id]: 2 } });
    expect(res.body.sends[idB]).toBeUndefined();
  });
});
