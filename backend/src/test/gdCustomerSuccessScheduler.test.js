// Testes unitários do Agendador e Serviço de Customer Success da GD (Frente 7).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { GD_DONO, registerGdClientesRoutes } from "../domains/gdClientes/routes.js";
import {
  isGdCsScheduleEnabled,
  montarMensagemPrimeiraQuinzena,
  montarMensagemAcompanhamentoPeriodico,
  calcularElegibilidadeCs,
  processarReguaCustomerSuccess,
  iniciarCsScheduler,
  pararCsScheduler,
  TIPOS_TOQUE_CS,
  DEFAULT_CS_INTERVAL_DAYS,
  GOOGLE_REVIEW_DAYS_THRESHOLD,
} from "../services/gdCustomerSuccessSchedulerService.js";

const MIGRATIONS = [
  "20261102120000_create_gd_estados_clientes.sql",
  "20261103120000_gd_clientes_aprovador_drive_escopo.sql",
  "20261103180000_gd_estados_acao_rotulo_portal.sql",
  "20261105190000_gd_clientes_quatro_documentos.sql",
  "20261107100000_gd_clientes_whatsapp_groups.sql",
  "20261108100000_gd_clientes_google_calendar_email.sql",
  "20261108110000_gd_clientes_briefing_scheduling.sql",
  "20261108120000_gd_clientes_briefing_docs_approval.sql",
  "20261108160000_gd_clientes_vexto_briefing_and_chips.sql",
  "20261108180000_gd_clientes_customer_success_and_portal_slug.sql",
];

const PERFIS = {
  superadmin: { uid: "uid-fundador", role: "superadmin", isAdmin: true, clientIds: [] },
  admin: { uid: "uid-admin", role: "internal", isAdmin: true, clientIds: [] },
  equipeGd: {
    uid: "uid-gd",
    email: "equipe@gd.com",
    role: "internal",
    isAdmin: false,
    clientId: GD_DONO,
    clientIds: [GD_DONO],
    permissions: ["geracao_digital.proposals"],
    internalPages: ["propostas-gd"],
  },
  cliente: {
    uid: "uid-cliente",
    role: "client",
    isAdmin: false,
    clientId: GD_DONO,
    clientIds: [GD_DONO],
  },
};

let db;
let server;
let base;
let mockApiSender = vi.fn().mockResolvedValue({ messageId: "msg-mock" });

function poolDe(pg) {
  const client = { query: (sql, params) => pg.query(sql, params), release() {} };
  return {
    query: (sql, params) => pg.query(sql, params),
    connect: async () => client,
  };
}

async function chamar(metodo, caminho, { perfil, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (perfil) headers["x-teste-perfil"] = perfil;
  const res = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

beforeAll(async () => {
  db = await createPgliteDb(`
    SET TimeZone = 'UTC';
    CREATE TABLE public.leads_clients (id text PRIMARY KEY, name text NOT NULL);
    INSERT INTO public.leads_clients VALUES ('geracao-digital', 'Geração Digital');
  `);

  for (const m of MIGRATIONS) {
    const sql = readFileSync(resolve(`supabase/migrations/${m}`), "utf8");
    await db.exec(sql);
  }

  const app = express();
  app.use(express.json());
  registerGdClientesRoutes(app, {
    getPool: () => poolDe(db),
    evolutionMessageSender: (...args) => mockApiSender(...args),
    requireFirebaseAuth: (req, _res, next) => {
      const perfilKey = req.headers["x-teste-perfil"];
      req.authAccess = perfilKey ? PERFIS[perfilKey] : null;
      next();
    },
  });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});

afterAll(async () => {
  pararCsScheduler();
  await new Promise((r) => server.close(r));
  await db.close();
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Módulo gdCustomerSuccessSchedulerService", () => {
  it("isGdCsScheduleEnabled respeita variável de ambiente GD_CS_SCHEDULE_ENABLED", () => {
    delete process.env.GD_CS_SCHEDULE_ENABLED;
    expect(isGdCsScheduleEnabled()).toBe(false);

    process.env.GD_CS_SCHEDULE_ENABLED = "true";
    expect(isGdCsScheduleEnabled()).toBe(true);

    process.env.GD_CS_SCHEDULE_ENABLED = "false";
    expect(isGdCsScheduleEnabled()).toBe(false);
  });

  it("montarMensagemPrimeiraQuinzena gera texto institucional de 15 dias com links e avaliação", () => {
    const msg = montarMensagemPrimeiraQuinzena({
      cliente: { nome: "Ótica Solar" },
      reviewUrl: "https://g.page/review-teste",
      instagramUrl: "https://instagram.com/gd",
      linkedinUrl: "https://linkedin.com/gd",
    });

    expect(msg).toContain("15 Dias da sua Máquina de Vendas no Ar!");
    expect(msg).toContain("Ótica Solar");
    expect(msg).toContain("https://g.page/review-teste");
    expect(msg).toContain("https://instagram.com/gd");
    expect(msg).toContain("https://linkedin.com/gd");
  });

  it("montarMensagemAcompanhamentoPeriodico inclui o texto padrão das últimas semanas", () => {
    const msg = montarMensagemAcompanhamentoPeriodico({
      cliente: { nome: "Construtora Alfa", drive_url: "https://drive.com/pasta-alfa" },
      portalUrl: "https://crm.gd.com/acompanhamento/alfa-slug",
    });

    expect(msg).toContain("Passando para compartilhar o que nossa equipe entregou para você nestas últimas semanas");
    expect(msg).toContain("Construtora Alfa");
    expect(msg).toContain("https://drive.com/pasta-alfa");
    expect(msg).toContain("https://crm.gd.com/acompanhamento/alfa-slug");
  });

  it("calcularElegibilidadeCs retorna null se o cliente não tiver grupo de WhatsApp ou estiver pausado", () => {
    const c1 = { estado_atual: "ATIVO", grupo_cliente_jid: null };
    expect(calcularElegibilidadeCs(c1)).toBeNull();

    const c2 = { estado_atual: "PAUSADO", grupo_cliente_jid: "123@g.us", cs_regua_ativa: false };
    expect(calcularElegibilidadeCs(c2)).toBeNull();
  });

  it("calcularElegibilidadeCs seleciona AVALIACAO_GOOGLE_15D quando completados 15 dias de operação", () => {
    const now = new Date("2026-11-20T12:00:00Z");
    const dataInicio = new Date("2026-11-04T12:00:00Z").toISOString(); // 16 dias atrás

    const c = {
      estado_atual: "ATIVO",
      grupo_cliente_jid: "123@g.us",
      cs_regua_ativa: true,
      onboarding_concluido_em: dataInicio,
      cs_avaliacao_google_enviada_em: null,
      cs_ultimo_toque_em: null,
    };

    const res = calcularElegibilidadeCs(c, now);
    expect(res).not.toBeNull();
    expect(res.tipo).toBe(TIPOS_TOQUE_CS.AVALIACAO_GOOGLE_15D);
    expect(res.motivo).toContain("Primeira quinzena de sucesso");
  });

  it("calcularElegibilidadeCs seleciona ACOMPANHAMENTO_PERIODICO após 14 dias desde o último toque", () => {
    const now = new Date("2026-11-25T12:00:00Z");
    const dataInicio = new Date("2026-10-01T12:00:00Z").toISOString();
    const ultimoToque = new Date("2026-11-10T12:00:00Z").toISOString(); // 15 dias atrás

    const c = {
      estado_atual: "ATIVO",
      grupo_cliente_jid: "123@g.us",
      cs_regua_ativa: true,
      onboarding_concluido_em: dataInicio,
      cs_avaliacao_google_enviada_em: new Date("2026-10-16T12:00:00Z").toISOString(),
      cs_ultimo_toque_em: ultimoToque,
    };

    const res = calcularElegibilidadeCs(c, now);
    expect(res).not.toBeNull();
    expect(res.tipo).toBe(TIPOS_TOQUE_CS.ACOMPANHAMENTO_PERIODICO);
    expect(res.motivo).toContain("Acompanhamento periódico de CS");
  });

  it("calcularElegibilidadeCs retorna null se o toque foi realizado recentemente (< 10-14 dias)", () => {
    const now = new Date("2026-11-25T12:00:00Z");
    const ultimoToque = new Date("2026-11-20T12:00:00Z").toISOString(); // Apenas 5 dias atrás

    const c = {
      estado_atual: "ATIVO",
      grupo_cliente_jid: "123@g.us",
      cs_regua_ativa: true,
      cs_avaliacao_google_enviada_em: new Date("2026-10-16T12:00:00Z").toISOString(),
      cs_ultimo_toque_em: ultimoToque,
    };

    expect(calcularElegibilidadeCs(c, now)).toBeNull();
  });
});

describe("Execução da Régua de Customer Success no Banco (processarReguaCustomerSuccess)", () => {
  let clienteId;
  const mockSender = vi.fn().mockResolvedValue({ messageId: "msg-123" });

  beforeEach(async () => {
    mockSender.mockClear();
    const nome = `Cliente CS ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const r = await chamar("POST", "/api/gd/clientes", {
      perfil: "equipeGd",
      body: {
        nome,
        estado: "ATIVO",
        drive_url: "https://drive.google.com/drive/folders/pasta-cs",
        grupo_cliente_jid: "120363044444444444@g.us",
        grupo_cliente_url: "https://chat.whatsapp.com/grupo-cs",
        portal_slug: `cs-slug-${Date.now()}`,
        onboarding_concluido_em: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000).toISOString(), // 16 dias atrás
      },
    });
    expect(r.status).toBe(201);
    clienteId = r.json.cliente.id;
  });

  it("dispara avaliação do Google na 1ª quinzena e atualiza histórico e agendamentos no banco", async () => {
    const res = await processarReguaCustomerSuccess({
      pool: poolDe(db),
      clienteId,
      evolutionSender: mockSender,
      now: new Date(),
    });

    expect(res.enviados).toBe(1);
    expect(res.avaliacoesGoogle).toBe(1);
    expect(mockSender).toHaveBeenCalledTimes(1);

    const callArgs = mockSender.mock.calls[0][0];
    expect(callArgs.number).toBe("120363044444444444@g.us");
    expect(callArgs.text).toContain("15 Dias da sua Máquina de Vendas no Ar!");

    // Confere se gravou no banco
    const { rows } = await db.query(
      `SELECT cs_ultimo_toque_em, cs_avaliacao_google_enviada_em, cs_proximo_toque_em, cs_toques_historico
         FROM public.gd_clientes
        WHERE id = $1`,
      [clienteId]
    );

    expect(rows[0].cs_ultimo_toque_em).not.toBeNull();
    expect(rows[0].cs_avaliacao_google_enviada_em).not.toBeNull();
    expect(rows[0].cs_proximo_toque_em).not.toBeNull();
    expect(rows[0].cs_toques_historico).toHaveLength(1);
    expect(rows[0].cs_toques_historico[0].tipo).toBe(TIPOS_TOQUE_CS.AVALIACAO_GOOGLE_15D);

    // Rodar novamente logo em seguida NÃO deve enviar nada (idempotência)
    const resIdempotente = await processarReguaCustomerSuccess({
      pool: poolDe(db),
      clienteId,
      evolutionSender: mockSender,
      now: new Date(),
    });

    expect(resIdempotente.enviados).toBe(0);
    expect(mockSender).toHaveBeenCalledTimes(1); // Manteve 1 chamada
  });

  it("dispara acompanhamento periódico quando simulado avanço de 14 dias", async () => {
    // 1. Primeiro toque (avaliação de 15 dias)
    await processarReguaCustomerSuccess({
      pool: poolDe(db),
      clienteId,
      evolutionSender: mockSender,
      now: new Date(),
    });
    expect(mockSender).toHaveBeenCalledTimes(1);
    mockSender.mockClear();

    // 2. Avança 15 dias no tempo
    const futuro = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
    const resPeriodico = await processarReguaCustomerSuccess({
      pool: poolDe(db),
      clienteId,
      evolutionSender: mockSender,
      now: futuro,
    });

    expect(resPeriodico.enviados).toBe(1);
    expect(resPeriodico.toquesPeriodicos).toBe(1);
    expect(mockSender).toHaveBeenCalledTimes(1);

    const callArgs = mockSender.mock.calls[0][0];
    expect(callArgs.text).toContain("Passando para compartilhar o que nossa equipe entregou para você nestas últimas semanas");

    // Histórico agora deve ter 2 itens
    const { rows } = await db.query(
      `SELECT cs_toques_historico FROM public.gd_clientes WHERE id = $1`,
      [clienteId]
    );
    expect(rows[0].cs_toques_historico).toHaveLength(2);
    expect(rows[0].cs_toques_historico[1].tipo).toBe(TIPOS_TOQUE_CS.ACOMPANHAMENTO_PERIODICO);
  });
});

describe("Endpoints de Customer Success (/api/gd/cs/*)", () => {
  let clienteId;

  beforeEach(async () => {
    const nome = `Cliente API CS ${Date.now()}`;
    const r = await chamar("POST", "/api/gd/clientes", {
      perfil: "equipeGd",
      body: {
        nome,
        estado: "ATIVO",
        grupo_cliente_jid: "123456789@g.us",
      },
    });
    expect(r.status).toBe(201);
    clienteId = r.json.cliente.id;
  });

  it("rejeita acesso de clientes não autorizados (403)", async () => {
    const res1 = await chamar("POST", "/api/gd/cs/processar", { perfil: "cliente" });
    expect(res1.status).toBe(403);

    const res2 = await chamar("GET", `/api/gd/clientes/${clienteId}/cs-historico`, { perfil: "cliente" });
    expect(res2.status).toBe(403);
  });

  it("POST /api/gd/cs/processar executa com perfil equipeGd e GET /api/gd/clientes/:id/cs-historico retorna status", async () => {
    const resPost = await chamar("POST", "/api/gd/cs/processar", {
      perfil: "equipeGd",
      body: {
        cliente_id: clienteId,
        force_tipo: TIPOS_TOQUE_CS.ACOMPANHAMENTO_PERIODICO,
      },
    });
    expect(resPost.status).toBe(200);
    expect(resPost.json.processados).toBe(1);

    const resGet = await chamar("GET", `/api/gd/clientes/${clienteId}/cs-historico`, {
      perfil: "equipeGd",
    });
    expect(resGet.status).toBe(200);
    expect(resGet.json.cliente.id).toBe(clienteId);
    expect(resGet.json.cliente.cs_regua_ativa).toBe(true);
    expect(resGet.json.cliente.cs_ultimo_toque_em).toBeDefined();
    expect(resGet.json.cliente.cs_toques_historico).toHaveLength(1);
  });
});
