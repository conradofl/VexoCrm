import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { GD_DONO, registerGdClientesRoutes } from "../domains/gdClientes/routes.js";
import { createEvolutionGroup, getEvolutionGroupInviteCode } from "../services/evolution.js";

const MIGRATION = readFileSync(
  resolve("supabase/migrations/20261102120000_create_gd_estados_clientes.sql"),
  "utf8"
);
const MIGRATION_CAMPOS = readFileSync(
  resolve("supabase/migrations/20261103120000_gd_clientes_aprovador_drive_escopo.sql"),
  "utf8"
);
const MIGRATION_TRILHA = readFileSync(
  resolve("supabase/migrations/20261103180000_gd_estados_acao_rotulo_portal.sql"),
  "utf8"
);
const MIGRATION_DOCUMENTOS = readFileSync(
  resolve("supabase/migrations/20261105190000_gd_clientes_quatro_documentos.sql"),
  "utf8"
);
const MIGRATION_WHATSAPP = readFileSync(
  resolve("supabase/migrations/20261107100000_gd_clientes_whatsapp_groups.sql"),
  "utf8"
);
const MIGRATION_CALENDAR = readFileSync(
  resolve("supabase/migrations/20261108100000_gd_clientes_google_calendar_email.sql"),
  "utf8"
);
const MIGRATION_BRIEFING = readFileSync(
  resolve("supabase/migrations/20261108110000_gd_clientes_briefing_scheduling.sql"),
  "utf8"
);

const PERFIS = {
  equipeGd: {
    uid: "uid-gd-conrado",
    role: "internal",
    isAdmin: false,
    clientId: GD_DONO,
    clientIds: [GD_DONO],
    permissions: ["geracao_digital.proposals"],
    internalPages: ["propostas-gd"],
  },
  semPermissao: {
    uid: "uid-sem-acesso",
    role: "internal",
    isAdmin: false,
    clientId: "outro-tenant",
    clientIds: ["outro-tenant"],
    permissions: [],
  },
};

let db;
let server;
let base;

// Mocks de serviço
let mockEvolutionGroupCreator;
let mockEvolutionInviteGetter;
let mockEvolutionMessageSender;
let mockEvolutionCommunityLinker;
let mockBrandingAvatarGenerator;
let mockSlackSender;

function poolDe(pg) {
  const query = async (sql, params) => pg.query(sql, params);
  const client = { query, release() { } };
  return { query, connect: async () => client };
}

async function chamar(metodo, caminho, { perfil = "equipeGd", token = null, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (perfil) {
    headers["x-teste-perfil"] = perfil;
  }

  const res = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

beforeAll(async () => {
  process.env.GOCLAW_READ_TOKEN = "token-secreto-goclaw-teste";
  process.env.GD_ONBOARDING_EVOLUTION_INSTANCE = "vexo-adm";

  db = await createPgliteDb(`
    SET TimeZone = 'UTC';
    CREATE TABLE public.leads_clients (id text PRIMARY KEY, name text NOT NULL);
    INSERT INTO public.leads_clients VALUES ('geracao-digital', 'Geração Digital');
  `);

  await db.exec(MIGRATION);
  await db.exec(MIGRATION_CAMPOS);
  await db.exec(MIGRATION_TRILHA);
  await db.exec(MIGRATION_DOCUMENTOS);
  await db.exec(MIGRATION_WHATSAPP);
  await db.exec(MIGRATION_CALENDAR);
  await db.exec(MIGRATION_BRIEFING);

  mockEvolutionGroupCreator = vi.fn();
  mockEvolutionInviteGetter = vi.fn();
  mockEvolutionMessageSender = vi.fn();
  mockEvolutionCommunityLinker = vi.fn().mockResolvedValue({
    success: true,
    community: "GD — Operação Interna",
  });
  mockBrandingAvatarGenerator = vi.fn().mockResolvedValue({
    success: true,
    evolutionUpdated: true,
    driveFile: {
      fileId: "mock_avatar_file",
      fileLink: "https://drive.google.com/file/d/mock_avatar_file/view",
    },
  });
  mockSlackSender = vi.fn();

  const app = express();
  app.use(express.json());
  registerGdClientesRoutes(app, {
    getPool: () => poolDe(db),
    requireFirebaseAuth: (req, _res, next) => {
      req.authAccess = PERFIS[req.headers["x-teste-perfil"]];
      next();
    },
    evolutionGroupCreator: (...args) => mockEvolutionGroupCreator(...args),
    evolutionInviteGetter: (...args) => mockEvolutionInviteGetter(...args),
    evolutionMessageSender: (...args) => mockEvolutionMessageSender(...args),
    evolutionCommunityLinker: (...args) => mockEvolutionCommunityLinker(...args),
    brandingAvatarGenerator: (...args) => mockBrandingAvatarGenerator(...args),
    slackSender: (...args) => mockSlackSender(...args),
  });

  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  delete process.env.GOCLAW_READ_TOKEN;
  delete process.env.GD_ONBOARDING_EVOLUTION_INSTANCE;
});

beforeEach(async () => {
  vi.clearAllMocks();
});

async function criarClienteExemplo({
  nome = "Empresa Alpha Ltda",
  estado = "ASSINADO",
  aprovadorNome = "Carlos Diretor",
  aprovadorTelefone = "5534988887777",
} = {}) {
  const res = await db.query(
    `INSERT INTO public.gd_clientes (dono_client_id, nome, origem, aprovador_nome, aprovador_telefone)
     VALUES ($1, $2, 'fluxo', $3, $4)
     RETURNING id`,
    [GD_DONO, nome, aprovadorNome, aprovadorTelefone]
  );
  const clienteId = res.rows[0].id;

  await db.query(
    `SELECT public.gd_registrar_evento($1, $2, now(), false, 'fluxo', 'humano', 'setup', 'Carga de teste')`,
    [clienteId, estado]
  );

  return clienteId;
}

describe("Onboarding GD · Criação de Grupos de WhatsApp", () => {
  it("cria os 2 grupos no WhatsApp, busca invite urls, envia boas-vindas, avança estado para GRUPOS_CRIADOS e notifica Slack", async () => {
    const clienteId = await criarClienteExemplo({
      nome: "Clínica Sorriso Aberto",
      aprovadorNome: "Dra. Ana",
      aprovadorTelefone: "5534991112233",
    });

    mockEvolutionGroupCreator
      .mockResolvedValueOnce({ success: true, groupJid: "120363000001@g.us" }) // Interno
      .mockResolvedValueOnce({ success: true, groupJid: "120363000002@g.us" }); // Cliente

    mockEvolutionInviteGetter
      .mockResolvedValueOnce({ success: true, inviteUrl: "https://chat.whatsapp.com/invite-interno" })
      .mockResolvedValueOnce({ success: true, inviteUrl: "https://chat.whatsapp.com/invite-cliente" });

    mockEvolutionMessageSender.mockResolvedValueOnce({ success: true });
    mockSlackSender.mockResolvedValueOnce({ ok: true });

    const r = await chamar("POST", `/api/gd/clientes/${clienteId}/onboarding/whatsapp-groups`, {
      perfil: "equipeGd",
      body: {
        instance_name: "vexo-adm",
        equipe_telefones: ["5534991751267", "5534997719779", "5534991241824"],
      },
    });

    expect(r.status).toBe(201);
    expect(r.json.success).toBe(true);
    expect(r.json.grupos.interno.jid).toBe("120363000001@g.us");
    expect(r.json.grupos.interno.url).toBe("https://chat.whatsapp.com/invite-interno");
    expect(r.json.grupos.cliente.jid).toBe("120363000002@g.us");
    expect(r.json.grupos.cliente.url).toBe("https://chat.whatsapp.com/invite-cliente");
    expect(r.json.cliente.estado_atual).toBe("GRUPOS_CRIADOS");

    // Verifica chamadas da Evolution
    expect(mockEvolutionGroupCreator).toHaveBeenCalledTimes(2);

    // Grupo Interno
    expect(mockEvolutionGroupCreator).toHaveBeenNthCalledWith(1, {
      instanceName: "vexo-adm",
      subject: "PASTA: CLÍNICA SORRISO ABERTO",
      description: expect.stringContaining("Grupo interno"),
      participants: ["5534991751267", "5534997719779", "5534991241824"],
    });

    // Grupo Cliente
    expect(mockEvolutionGroupCreator).toHaveBeenNthCalledWith(2, {
      instanceName: "vexo-adm",
      subject: "MÁQUINA DE VENDAS: CLÍNICA SORRISO ABERTO",
      description: expect.stringContaining("Canal oficial"),
      participants: ["5534991751267", "5534997719779", "5534991241824", "5534991112233"],
    });

    // Mensagem de boas-vindas
    expect(mockEvolutionMessageSender).toHaveBeenCalledWith({
      instanceName: "vexo-adm",
      number: "120363000002@g.us",
      text: expect.stringContaining("Olá, Dra. Ana!"),
    });

    // Notificação Slack
    expect(mockSlackSender).toHaveBeenCalledWith({
      text: expect.stringContaining("Onboarding GD · Grupos de WhatsApp Criados!"),
      channel: "01-ops-geral",
    });

    // Verifica vínculo automático com Comunidade Interna
    expect(mockEvolutionCommunityLinker).toHaveBeenCalledWith({
      instanceName: "vexo-adm",
      groupJid: "120363000001@g.us",
      communityName: "GD — Operação Interna",
      communityJid: null,
    });

    // Verifica geração e aplicação do Avatar com tarja 50%
    expect(mockBrandingAvatarGenerator).toHaveBeenCalledWith(
      expect.objectContaining({
        clientName: "Clínica Sorriso Aberto",
        groupJid: "120363000002@g.us",
        instanceName: "vexo-adm",
      })
    );

    // Verifica integridade no banco
    const dbCliente = (
      await db.query(`SELECT * FROM public.gd_clientes WHERE id = $1`, [clienteId])
    ).rows[0];

    expect(dbCliente.grupo_interno_jid).toBe("120363000001@g.us");
    expect(dbCliente.grupo_interno_url).toBe("https://chat.whatsapp.com/invite-interno");
    expect(dbCliente.grupo_cliente_jid).toBe("120363000002@g.us");
    expect(dbCliente.grupo_cliente_url).toBe("https://chat.whatsapp.com/invite-cliente");
    expect(dbCliente.onboarding_concluido_em).toBeTruthy();
    expect(dbCliente.estado_atual).toBe("GRUPOS_CRIADOS");

    // Verifica evento no gd_cliente_eventos
    const evento = (
      await db.query(
        `SELECT * FROM public.gd_cliente_eventos WHERE cliente_id = $1 ORDER BY seq DESC LIMIT 1`,
        [clienteId]
      )
    ).rows[0];

    expect(evento.estado_para).toBe("GRUPOS_CRIADOS");
    expect(evento.ator_tipo).toBe("humano");
    expect(evento.ator_id).toBe("uid-gd-conrado");
  });

  it("permite execução autônoma pelo GoClaw usando Bearer GOCLAW_READ_TOKEN", async () => {
    const clienteId = await criarClienteExemplo({ nome: "Tecnologia Beta" });

    mockEvolutionGroupCreator
      .mockResolvedValueOnce({ success: true, groupJid: "120363999901@g.us" })
      .mockResolvedValueOnce({ success: true, groupJid: "120363999902@g.us" });

    mockEvolutionInviteGetter
      .mockResolvedValueOnce({ success: true, inviteUrl: "https://chat.whatsapp.com/goclaw-1" })
      .mockResolvedValueOnce({ success: true, inviteUrl: "https://chat.whatsapp.com/goclaw-2" });

    const r = await chamar("POST", `/api/gd/clientes/${clienteId}/onboarding/whatsapp-groups`, {
      token: "token-secreto-goclaw-teste",
      body: {},
    });

    expect(r.status).toBe(201);
    expect(r.json.success).toBe(true);

    const evento = (
      await db.query(
        `SELECT * FROM public.gd_cliente_eventos WHERE cliente_id = $1 ORDER BY seq DESC LIMIT 1`,
        [clienteId]
      )
    ).rows[0];

    expect(evento.estado_para).toBe("GRUPOS_CRIADOS");
    expect(evento.ator_tipo).toBe("goclaw");
    expect(evento.ator_id).toBe("goclaw");
  });

  it("garante idempotência: não duplica grupos se já foram criados, a menos que force=true", async () => {
    const clienteId = await criarClienteExemplo({ nome: "Empresa Repetida" });

    await db.query(
      `UPDATE public.gd_clientes
          SET grupo_interno_jid = '120363111@g.us',
              grupo_interno_url = 'https://chat.whatsapp.com/interno-ja-existe',
              grupo_cliente_jid = '120363222@g.us',
              grupo_cliente_url = 'https://chat.whatsapp.com/cliente-ja-existe'
        WHERE id = $1`,
      [clienteId]
    );

    const r = await chamar("POST", `/api/gd/clientes/${clienteId}/onboarding/whatsapp-groups`, {
      perfil: "equipeGd",
      body: {},
    });

    expect(r.status).toBe(200);
    expect(r.json.status).toBe("already_created");
    expect(mockEvolutionGroupCreator).not.toHaveBeenCalled();
    expect(r.json.grupos.interno.jid).toBe("120363111@g.us");
    expect(r.json.grupos.cliente.jid).toBe("120363222@g.us");
  });

  it("recusa acesso a usuários não autorizados (403)", async () => {
    const clienteId = await criarClienteExemplo({ nome: "Empresa Bloqueada" });

    const r = await chamar("POST", `/api/gd/clientes/${clienteId}/onboarding/whatsapp-groups`, {
      perfil: "semPermissao",
      body: {},
    });

    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("FORBIDDEN");
  });

  it("retorna 404 se o cliente não existir", async () => {
    const fakeUuid = "00000000-0000-0000-0000-000000000000";
    const r = await chamar("POST", `/api/gd/clientes/${fakeUuid}/onboarding/whatsapp-groups`, {
      perfil: "equipeGd",
      body: {},
    });

    expect(r.status).toBe(404);
    expect(r.json.error.code).toBe("CLIENTE_NAO_ENCONTRADO");
  });

  it("POST /onboarding/whatsapp-community associa grupo interno à comunidade explicitamente", async () => {
    const clienteId = await criarClienteExemplo({ nome: "Clínica Vida Nova" });
    await db.query(
      `UPDATE public.gd_clientes SET grupo_interno_jid = '120363555555@g.us' WHERE id = $1`,
      [clienteId]
    );

    mockEvolutionCommunityLinker.mockResolvedValueOnce({
      success: true,
      community: "GD — Operação Interna",
    });

    const r = await chamar("POST", `/api/gd/clientes/${clienteId}/onboarding/whatsapp-community`, {
      perfil: "equipeGd",
      body: {},
    });

    expect(r.status).toBe(200);
    expect(r.json.success).toBe(true);
    expect(r.json.comunidade).toBe("GD — Operação Interna");
    expect(mockEvolutionCommunityLinker).toHaveBeenCalledWith({
      instanceName: "vexo-adm",
      groupJid: "120363555555@g.us",
      communityName: "GD — Operação Interna",
      communityJid: null,
    });
  });

  it("POST /onboarding/branding-avatar gera e aplica foto do grupo explicitamente", async () => {
    const clienteId = await criarClienteExemplo({ nome: "Clínica Dental Art" });
    await db.query(
      `UPDATE public.gd_clientes SET grupo_cliente_jid = '120363777777@g.us' WHERE id = $1`,
      [clienteId]
    );

    mockBrandingAvatarGenerator.mockResolvedValueOnce({
      success: true,
      evolutionUpdated: true,
      driveFile: { fileId: "file-xyz", fileLink: "https://drive.google.com/xyz" },
    });

    const r = await chamar("POST", `/api/gd/clientes/${clienteId}/onboarding/branding-avatar`, {
      perfil: "equipeGd",
      body: { identidade_folder_id: "folder_01" },
    });

    expect(r.status).toBe(200);
    expect(r.json.success).toBe(true);
    expect(r.json.branding.evolution_updated).toBe(true);
    expect(mockBrandingAvatarGenerator).toHaveBeenCalledWith(
      expect.objectContaining({
        clientName: "Clínica Dental Art",
        groupJid: "120363777777@g.us",
        identidadeFolderId: "folder_01",
      })
    );
  });

  it("permite atualizar e ler google_calendar_email via PATCH e GET /api/gd/clientes/:id", async () => {
    const clienteId = await criarClienteExemplo({ nome: "Empresa Calendário Ltda" });

    // Atualização com e-mail válido
    const patchRes = await chamar("PATCH", `/api/gd/clientes/${clienteId}`, {
      perfil: "equipeGd",
      body: { google_calendar_email: "agenda@empresacalendario.com.br" },
    });

    expect(patchRes.status).toBe(200);
    expect(patchRes.json.cliente.google_calendar_email).toBe("agenda@empresacalendario.com.br");

    // Consulta GET
    const getRes = await chamar("GET", `/api/gd/clientes/${clienteId}`, { perfil: "equipeGd" });
    expect(getRes.status).toBe(200);
    expect(getRes.json.cliente.google_calendar_email).toBe("agenda@empresacalendario.com.br");

    // Recusa e-mail inválido
    const failRes = await chamar("PATCH", `/api/gd/clientes/${clienteId}`, {
      perfil: "equipeGd",
      body: { google_calendar_email: "email-invalido-sem-arroba" },
    });
    expect(failRes.status).toBe(422);
    expect(failRes.json.error.code).toBe("GOOGLE_CALENDAR_EMAIL_INVALIDO");
  });
});

describe("Evolution Service Group Helpers (createEvolutionGroup / getEvolutionGroupInviteCode)", () => {
  it("formata participantes adicionando DDI 55 e montando JIDs corretamente", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: "120363444@g.us" }),
    });

    const res = await createEvolutionGroup({
      instanceName: "chip-teste",
      subject: "Grupo Teste",
      participants: ["(34) 99175-1267", "5534997719779", "34991241824"],
      webhookToken: "apikey-teste",
      baseUrl: "https://evolution.teste.com",
      fetchFn: fakeFetch,
    });

    expect(res.success).toBe(true);
    expect(res.groupJid).toBe("120363444@g.us");

    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const [callUrl, callOptions] = fakeFetch.mock.calls[0];
    expect(callUrl).toBe("https://evolution.teste.com/group/create/chip-teste");

    const sentBody = JSON.parse(callOptions.body);
    expect(sentBody.subject).toBe("Grupo Teste");
    expect(sentBody.participants).toEqual([
      "5534991751267@s.whatsapp.net",
      "5534997719779@s.whatsapp.net",
      "5534991241824@s.whatsapp.net",
    ]);
  });

  it("obtém o invite code e monta a URL https://chat.whatsapp.com/...", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ inviteCode: "ABC123xyz" }),
    });

    const res = await getEvolutionGroupInviteCode({
      instanceName: "chip-teste",
      groupJid: "120363444@g.us",
      webhookToken: "apikey-teste",
      baseUrl: "https://evolution.teste.com",
      fetchFn: fakeFetch,
    });

    expect(res.success).toBe(true);
    expect(res.inviteCode).toBe("ABC123xyz");
    expect(res.inviteUrl).toBe("https://chat.whatsapp.com/ABC123xyz");
  });
});
