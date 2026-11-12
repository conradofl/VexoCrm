// /api/audio-library — rotas de verdade, sobre Express real, Postgres real em
// memória (pglite com a migration de produção) e storage local real.
//
// Dublado, e só isto (tudo sai do processo):
//   - requireFirebaseAuth (token Firebase);
//   - getLeadClientN8nSettings (plano do tenant, lido do Supabase).
// O gate (audioLibrary/access.js), o serviço, o medidor de áudio e o
// resolveAuthorizedClientId rodam como em produção.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acessoInterno,
  createAudioLibraryDb,
  fakeFirebaseAuth,
  limparStorageDeTeste,
  poolFor,
  startHttp,
} from "./helpers/audioLibraryHarness.js";
import { makeWav, makeOggOpus, makeMp4, PDF_BYTES } from "./helpers/audioFixtures.js";

let db = null;
vi.mock("../services/database.js", () => ({
  get pgDatabasePool() {
    return db ? { query: (sql, params) => db.query(sql, params) } : null;
  },
}));

const settingsMock = vi.fn();
vi.mock("../services/n8nSettings.js", () => ({
  getLeadClientN8nSettings: (...args) => settingsMock(...args),
}));

vi.mock("../access/middlewares.js", async (importOriginal) => {
  const actual = await importOriginal();
  const { fakeFirebaseAuth: fake } = await import("./helpers/audioLibraryHarness.js");
  return { ...actual, requireFirebaseAuth: fake };
});

const { registerAudioLibraryRoutes } = await import("../audioLibrary/routes.js");

const TENANT_A = "teste-audio-empresa-a";
const TENANT_B = "teste-audio-empresa-b";
const USER_A = acessoInterno([TENANT_A]);
const USER_B = acessoInterno([TENANT_B]);

describe("/api/audio-library", () => {
  let http;

  async function enviar(buffer, { access = USER_A, clientId = TENANT_A, name, whenToUse, filename, headers = {} } = {}) {
    const params = new URLSearchParams({ clientId });
    if (name) params.set("name", name);
    if (whenToUse) params.set("whenToUse", whenToUse);
    return http.call("POST", `/api/audio-library?${params}`, {
      access,
      body: buffer,
      headers: { ...(filename ? { "x-file-name": encodeURIComponent(filename) } : {}), ...headers },
    });
  }

  async function listar(access = USER_A, clientId = TENANT_A) {
    return http.call("GET", `/api/audio-library?clientId=${clientId}`, { access });
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
    db = await createAudioLibraryDb();
    settingsMock.mockReset();
    settingsMock.mockImplementation(async () => ({ plan_tier: "avancado", modulos_avulsos: [] }));
  });

  afterEach(async () => {
    await db.close();
    db = null;
    vi.restoreAllMocks();
  });

  describe("enviar, listar, ouvir, renomear, quando usar, arquivar", () => {
    it("envia um áudio e ele aparece na lista com duração e tamanho medidos", async () => {
      const wav = makeWav({ seconds: 7 });
      const res = await enviar(wav, { name: "Apresentação da loja", whenToUse: "Quando o cliente pergunta quem somos" });
      expect(res.status).toBe(201);
      expect(res.body.audio).toMatchObject({
        name: "Apresentação da loja",
        whenToUse: "Quando o cliente pergunta quem somos",
        mimeType: "audio/wav",
        sizeBytes: wav.length,
        durationSeconds: 7,
        followupSteps: 0,
      });
      // storage_key é interno: nunca sai para a tela.
      expect(JSON.stringify(res.body)).not.toContain("followup-media");

      const lista = await listar();
      expect(lista.status).toBe(200);
      expect(lista.body.audios.map((a) => a.id)).toEqual([res.body.audio.id]);
    });

    it("sem nome digitado, usa o nome do arquivo limpo", async () => {
      const res = await enviar(makeOggOpus({ seconds: 4 }), { filename: "boas_vindas-final.ogg" });
      expect(res.status).toBe(201);
      expect(res.body.audio.name).toBe("boas vindas final");
      expect(res.body.audio.mimeType).toBe("audio/ogg");
    });

    it("ouvir devolve exatamente os bytes enviados, com o tipo medido", async () => {
      const wav = makeWav({ seconds: 3 });
      const { body } = await enviar(wav, { name: "Para ouvir" });
      const file = await http.call("GET", `/api/audio-library/${body.audio.id}/file`, { access: USER_A, raw: true });
      expect(file.status).toBe(200);
      expect(file.headers.get("content-type")).toBe("audio/wav");
      expect(file.buffer.equals(wav)).toBe(true);
    });

    it("renomeia e grava o 'quando usar'; limpar o texto grava NULL", async () => {
      const { body } = await enviar(makeWav(), { name: "Nome velho" });
      const id = body.audio.id;

      const r1 = await http.call("PATCH", `/api/audio-library/${id}`, {
        access: USER_A,
        body: { name: "  Nome   novo ", whenToUse: "Quando pedir o endereço" },
      });
      expect(r1.status).toBe(200);
      expect(r1.body.audio).toMatchObject({ name: "Nome novo", whenToUse: "Quando pedir o endereço" });

      const r2 = await http.call("PATCH", `/api/audio-library/${id}`, { access: USER_A, body: { whenToUse: "   " } });
      expect(r2.body.audio.whenToUse).toBeNull();
      expect(r2.body.audio.name).toBe("Nome novo");
    });

    it("'quando usar' aceita 140 caracteres e recusa 141", async () => {
      const { body } = await enviar(makeWav(), { name: "Limite" });
      const id = body.audio.id;
      const ok = await http.call("PATCH", `/api/audio-library/${id}`, { access: USER_A, body: { whenToUse: "a".repeat(140) } });
      expect(ok.status).toBe(200);
      const demais = await http.call("PATCH", `/api/audio-library/${id}`, { access: USER_A, body: { whenToUse: "a".repeat(141) } });
      expect(demais.status).toBe(400);
      expect(demais.body.error.code).toBe("WHEN_TO_USE_TOO_LONG");
      const { rows } = await db.query("SELECT char_length(when_to_use) AS n FROM audio_library WHERE id = $1", [id]);
      expect(rows[0].n).toBe(140);
    });

    it("arquivar tira da lista e do ouvir, mas a linha e o arquivo ficam", async () => {
      const { body } = await enviar(makeWav(), { name: "Vai sair" });
      const id = body.audio.id;

      const arq = await http.call("POST", `/api/audio-library/${id}/archive`, { access: USER_A });
      expect(arq.status).toBe(200);

      expect((await listar()).body.audios).toEqual([]);
      const file = await http.call("GET", `/api/audio-library/${id}/file`, { access: USER_A, raw: true });
      expect(file.status).toBe(404);

      const { rows } = await db.query("SELECT archived_at, storage_key FROM audio_library WHERE id = $1", [id]);
      expect(rows).toHaveLength(1);
      expect(rows[0].archived_at).not.toBeNull();
    });

    it("não arquiva áudio em uso por passo de follow-up: 409 dizendo onde", async () => {
      const { body } = await enviar(makeWav(), { name: "Em uso" });
      const id = body.audio.id;
      await db.query(`INSERT INTO followup_companies (id, tenant_id, name) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $1, 'Agente A')`, [TENANT_A]);
      await db.query(`INSERT INTO followup_campaigns (id, company_id, name, status) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cadência de boas-vindas', 'active')`);
      await db.query(
        `INSERT INTO followup_templates (campaign_id, name, message, trigger_type, audio_library_id)
         VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Passo 1', 'Áudio: Em uso', 'after_enrollment', $1)`,
        [id]
      );

      const lista = await listar();
      expect(lista.body.audios[0].followupSteps).toBe(1);

      const arq = await http.call("POST", `/api/audio-library/${id}/archive`, { access: USER_A });
      expect(arq.status).toBe(409);
      expect(arq.body.error.code).toBe("AUDIO_IN_USE");
      expect(arq.body.error.message).toContain('"Passo 1" (Cadência de boas-vindas)');
      const { rows } = await db.query("SELECT archived_at FROM audio_library WHERE id = $1", [id]);
      expect(rows[0].archived_at).toBeNull();

      // Cadência arquivada não segura o áudio.
      await db.query(`UPDATE followup_campaigns SET status = 'archived'`);
      expect((await http.call("POST", `/api/audio-library/${id}/archive`, { access: USER_A })).status).toBe(200);
    });
  });

  describe("o que não entra", () => {
    it("acima de 5 MB recebe a mensagem do produto, não o 413 genérico", async () => {
      const grande = makeWav({ seconds: 56, sampleRate: 96000 });
      expect(grande.length).toBeGreaterThan(5 * 1024 * 1024);
      expect(grande.length).toBeLessThan(6 * 1024 * 1024);
      const res = await enviar(grande, { name: "Grande" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("FILE_TOO_LARGE");
      expect(res.body.error.message).toMatch(/^O áudio tem 5\.\d MB\. O limite é 5 MB\.$/);
    });

    it("acima de 3 minutos é recusado pela duração medida nos bytes", async () => {
      const res = await enviar(makeWav({ seconds: 200 }), { name: "Longo" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("AUDIO_TOO_LONG");
      expect(res.body.error.message).toBe("O áudio tem 3:20. O limite é 3 minutos.");
    });

    it("PDF com nome .mp3 e Content-Type de áudio é recusado: só os bytes decidem", async () => {
      const res = await enviar(PDF_BYTES, {
        name: "Disfarçado",
        filename: "audio.mp3",
        headers: { "Content-Type": "audio/mpeg" },
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_AUDIO_TYPE");
    });

    it("vídeo renomeado para .m4a é recusado", async () => {
      const res = await enviar(makeMp4({ brand: "M4A ", video: true }), {
        name: "Vídeo",
        filename: "gravacao.m4a",
        headers: { "Content-Type": "audio/mp4" },
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_AUDIO_TYPE");
    });

    it("recusa não deixa linha no banco", async () => {
      await enviar(PDF_BYTES, { name: "x" });
      await enviar(makeWav({ seconds: 200 }), { name: "y" });
      const { rows } = await db.query("SELECT count(*)::int AS n FROM audio_library");
      expect(rows[0].n).toBe(0);
    });
  });

  describe("isolamento por empresa", () => {
    let audioDaA;

    beforeEach(async () => {
      const res = await enviar(makeWav({ seconds: 2 }), { name: "Áudio da empresa A", access: USER_A, clientId: TENANT_A });
      audioDaA = res.body.audio.id;
      await enviar(makeWav({ seconds: 2 }), { name: "Áudio da empresa B", access: USER_B, clientId: TENANT_B });
    });

    it("empresa B não LISTA áudio da empresa A", async () => {
      const lista = await listar(USER_B, TENANT_B);
      expect(lista.body.audios.map((a) => a.name)).toEqual(["Áudio da empresa B"]);
    });

    it("empresa B pedindo a lista com o clientId da A leva 403", async () => {
      const lista = await listar(USER_B, TENANT_A);
      expect(lista.status).toBe(403);
      expect(lista.body.audios).toBeUndefined();
    });

    it("empresa B não OUVE áudio da empresa A", async () => {
      const file = await http.call("GET", `/api/audio-library/${audioDaA}/file`, { access: USER_B, raw: true });
      expect(file.status).toBe(403);
      expect(file.buffer.includes(Buffer.from("RIFF"))).toBe(false);
    });

    it("empresa B não renomeia nem arquiva áudio da empresa A", async () => {
      const patch = await http.call("PATCH", `/api/audio-library/${audioDaA}`, { access: USER_B, body: { name: "Invadido" } });
      expect(patch.status).toBe(403);
      const arq = await http.call("POST", `/api/audio-library/${audioDaA}/archive`, { access: USER_B });
      expect(arq.status).toBe(403);

      const { rows } = await db.query("SELECT name, archived_at FROM audio_library WHERE id = $1", [audioDaA]);
      expect(rows[0]).toEqual({ name: "Áudio da empresa A", archived_at: null });
    });

    it("empresa B não ENVIA áudio para dentro da empresa A", async () => {
      const res = await enviar(makeWav(), { name: "Intruso", access: USER_B, clientId: TENANT_A });
      expect(res.status).toBe(403);
      const { rows } = await db.query("SELECT count(*)::int AS n FROM audio_library WHERE client_id = $1", [TENANT_A]);
      expect(rows[0].n).toBe(1);
    });

    it("o arquivo de cada empresa fica na pasta dela no storage", async () => {
      const { rows } = await db.query("SELECT client_id, storage_key FROM audio_library ORDER BY client_id");
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.storage_key.startsWith(`followup-media/${row.client_id}/audio/`)).toBe(true);
      }
    });

    it("linha com storage_key de outra empresa não é servida (segunda cerca)", async () => {
      const { rows } = await db.query("SELECT storage_key FROM audio_library WHERE client_id = $1", [TENANT_B]);
      await db.query("UPDATE audio_library SET storage_key = $1 WHERE id = $2", [rows[0].storage_key, audioDaA]);
      const file = await http.call("GET", `/api/audio-library/${audioDaA}/file`, { access: USER_A, raw: true });
      expect(file.status).toBe(500);
      expect(file.buffer.includes(Buffer.from("RIFF"))).toBe(false);
    });
  });

  describe("gate (audioLibrary/access.js)", () => {
    it("usuário sem a página 'agente' leva 403 em toda rota", async () => {
      const semAgente = acessoInterno([TENANT_A], ["dashboard", "planilhas"]);
      const lista = await listar(semAgente);
      expect(lista.status).toBe(403);
      expect(lista.body.error.code).toBe("AUDIO_USER_NOT_ALLOWED");
      const envio = await enviar(makeWav(), { name: "x", access: semAgente });
      expect(envio.status).toBe(403);
    });

    it("tenant modular sem o módulo de agente leva 403, e /access explica", async () => {
      settingsMock.mockImplementation(async () => ({ plan_tier: "modular", modulos_avulsos: ["disparador"] }));
      const lista = await listar();
      expect(lista.status).toBe(403);
      expect(lista.body.error.code).toBe("AUDIO_MODULE_NOT_CONTRACTED");

      const access = await http.call("GET", `/api/audio-library/access?clientId=${TENANT_A}`, { access: USER_A });
      expect(access.status).toBe(200);
      expect(access.body).toMatchObject({ allowed: false, reason: "AUDIO_MODULE_NOT_CONTRACTED" });
    });

    it("tenant modular COM agente_inbound passa", async () => {
      settingsMock.mockImplementation(async () => ({ plan_tier: "modular", modulos_avulsos: ["agente_inbound"] }));
      expect((await listar()).status).toBe(200);
    });

    it("falha ao ler o plano nega com 503, nunca libera", async () => {
      settingsMock.mockImplementation(async () => {
        throw new Error("banco fora");
      });
      const lista = await listar();
      expect(lista.status).toBe(503);
      expect(lista.body.error.code).toBe("AUDIO_SETTINGS_UNAVAILABLE");
    });

    it("tenant sem linha de settings é negado com o motivo certo", async () => {
      settingsMock.mockImplementation(async () => null);
      const lista = await listar();
      expect(lista.status).toBe(403);
      expect(lista.body.error.code).toBe("AUDIO_TENANT_NOT_CONFIGURED");
    });

    it("/access devolve os limites que a tela mostra", async () => {
      const access = await http.call("GET", `/api/audio-library/access?clientId=${TENANT_A}`, { access: USER_A });
      expect(access.body).toMatchObject({
        allowed: true,
        limits: { maxBytes: 5242880, maxSeconds: 180, nameMax: 80, whenToUseMax: 140 },
      });
    });

    it("sem credencial, 401", async () => {
      expect((await http.call("GET", `/api/audio-library?clientId=${TENANT_A}`)).status).toBe(401);
    });
  });
});

describe("migration 20261111210000_create_audio_library.sql", () => {
  it("é idempotente e os CHECKs seguram os limites de produto no banco", async () => {
    const { AUDIO_LIBRARY_MIGRATION } = await import("./helpers/audioLibraryHarness.js");
    const banco = await createAudioLibraryDb();
    await banco.exec(AUDIO_LIBRARY_MIGRATION); // segunda vez: não pode quebrar

    const inserir = (over = {}) => {
      const v = { name: "ok", when: null, size: 1000, dur: 10, ...over };
      return banco.query(
        `INSERT INTO audio_library (client_id, name, when_to_use, storage_key, mime_type, size_bytes, duration_seconds)
         VALUES ('t', $1, $2, 'k', 'audio/ogg', $3, $4)`,
        [v.name, v.when, v.size, v.dur]
      );
    };
    await expect(inserir()).resolves.toBeTruthy();
    await expect(inserir({ size: 5242881 })).rejects.toThrow(/check/i);
    await expect(inserir({ dur: 180.01 })).rejects.toThrow(/check/i);
    await expect(inserir({ when: "a".repeat(141) })).rejects.toThrow(/check/i);
    await expect(inserir({ name: "   " })).rejects.toThrow(/check/i);

    const { rows } = await banco.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'followup_templates' AND column_name = 'audio_library_id'`
    );
    expect(rows).toEqual([{ column_name: "audio_library_id", data_type: "uuid", is_nullable: "YES" }]);
    await banco.close();
  });
});
