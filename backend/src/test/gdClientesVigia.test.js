import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import {
  GD_DONO,
  registerGdClientesRoutes,
  requireGoclawReadToken,
} from "../domains/gdClientes/routes.js";
import {
  classificarCliente,
  calcularResumo,
  gerarRelatorioVigia,
  determinarPeriodo,
  normalizarNumerosWhatsApp,
  gerarPromptGoClaw,
  gerarBriefingFallback,
  gerarBriefingGoClaw,
  despacharVigia,
} from "../scripts/vigia-gd.mjs";

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

const TOKEN_TESTE = "goclaw-secret-token-teste-12345";

let db;
let server;
let base;

function poolDe(pg) {
  const query = async (sql, params) => pg.query(sql, params);
  const client = { query, release() {} };
  return { query, connect: async () => client };
}

async function chamarVigia(tokenHeader) {
  const headers = {};
  if (tokenHeader !== undefined) {
    headers["Authorization"] = tokenHeader;
  }
  const res = await fetch(`${base}/api/gd/clientes/vigia`, {
    method: "GET",
    headers,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

beforeAll(async () => {
  db = await createPgliteDb(`
    SET TimeZone = 'UTC';
    CREATE TABLE public.leads_clients (id text PRIMARY KEY, name text NOT NULL);
    INSERT INTO public.leads_clients VALUES ('geracao-digital', 'Geração Digital'), ('outro-tenant', 'Outro');
  `);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION_CAMPOS);
  await db.exec(MIGRATION_TRILHA);

  // Inserção de dados de teste: clientes da GD e cliente de outro tenant
  await db.exec(`
    INSERT INTO public.gd_clientes (id, dono_client_id, nome, origem)
    VALUES
      ('11111111-1111-1111-1111-111111111111', 'geracao-digital', 'Empresa Alfa', 'fluxo'),
      ('22222222-2222-2222-2222-222222222222', 'geracao-digital', 'Empresa Beta', 'fluxo'),
      ('33333333-3333-3333-3333-333333333333', 'outro-tenant', 'Empresa Outro Tenant', 'fluxo');

    SELECT public.gd_registrar_evento('11111111-1111-1111-1111-111111111111', 'PROPOSTA_ENVIADA', '2026-11-01T10:00:00Z', false, 'fluxo', 'sistema', 'seed-1', 'Inicial');
    SELECT public.gd_registrar_evento('22222222-2222-2222-2222-222222222222', 'BRIEFING_AGENDADO', '2026-11-02T14:30:00Z', false, 'fluxo', 'sistema', 'seed-2', 'Inicial');
  `);

  const app = express();
  app.use(express.json());
  registerGdClientesRoutes(app, {
    getPool: () => poolDe(db),
  });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (db) await db.close();
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("middleware: requireGoclawReadToken", () => {
  it("chama next() quando token bate exatamente com GOCLAW_READ_TOKEN", () => {
    process.env.GOCLAW_READ_TOKEN = "token-segredo-abc";
    const req = { headers: { authorization: "Bearer token-segredo-abc" } };
    let jsonStatus = null;
    let jsonPayload = null;
    let nextChamado = false;
    const res = {
      status(s) { jsonStatus = s; return this; },
      json(p) { jsonPayload = p; return this; },
    };
    requireGoclawReadToken(req, res, () => { nextChamado = true; });

    expect(nextChamado).toBe(true);
    expect(jsonStatus).toBeNull();
    expect(jsonPayload).toBeNull();
  });

  it("responde 401 se GOCLAW_READ_TOKEN for undefined", () => {
    delete process.env.GOCLAW_READ_TOKEN;
    const req = { headers: { authorization: "Bearer token-qualquer" } };
    let jsonStatus = null;
    let jsonPayload = null;
    let nextChamado = false;
    const res = {
      status(s) { jsonStatus = s; return this; },
      json(p) { jsonPayload = p; return this; },
    };
    requireGoclawReadToken(req, res, () => { nextChamado = true; });

    expect(nextChamado).toBe(false);
    expect(jsonStatus).toBe(401);
    expect(jsonPayload).toEqual({ error: "Token de acesso do GoClaw inválido ou não configurado." });
  });

  it("responde 401 se token enviado for menor ou maior que o esperado", () => {
    process.env.GOCLAW_READ_TOKEN = "tamanho-exato-16";
    const req = { headers: { authorization: "Bearer tamanho-diferente" } };
    let jsonStatus = null;
    let jsonPayload = null;
    const res = {
      status(s) { jsonStatus = s; return this; },
      json(p) { jsonPayload = p; return this; },
    };
    requireGoclawReadToken(req, res, () => {});

    expect(jsonStatus).toBe(401);
    expect(jsonPayload).toEqual({ error: "Token de acesso do GoClaw inválido ou não configurado." });
  });
});

describe("endpoint: GET /api/gd/clientes/vigia", () => {
  it("a) requisição sem header de autorização -> devolve 401", async () => {
    process.env.GOCLAW_READ_TOKEN = TOKEN_TESTE;
    const res = await chamarVigia(undefined);
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: "Token de acesso do GoClaw inválido ou não configurado." });
  });

  it("b) requisição com token incorreto -> devolve 401", async () => {
    process.env.GOCLAW_READ_TOKEN = TOKEN_TESTE;
    const res = await chamarVigia("Bearer token-totalmente-errado");
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: "Token de acesso do GoClaw inválido ou não configurado." });
  });

  it("b2) requisição com header de formato inválido (sem Bearer) -> devolve 401", async () => {
    process.env.GOCLAW_READ_TOKEN = TOKEN_TESTE;
    const res = await chamarVigia(`Basic ${TOKEN_TESTE}`);
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: "Token de acesso do GoClaw inválido ou não configurado." });
  });

  it("d) comportamento quando a env GOCLAW_READ_TOKEN não existe -> devolve 401 seguro sem quebrar", async () => {
    delete process.env.GOCLAW_READ_TOKEN;
    const res = await chamarVigia(`Bearer ${TOKEN_TESTE}`);
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: "Token de acesso do GoClaw inválido ou não configurado." });
  });

  it("c) requisição com token correto -> devolve 200 e a estrutura esperada", async () => {
    process.env.GOCLAW_READ_TOKEN = TOKEN_TESTE;
    const res = await chamarVigia(`Bearer ${TOKEN_TESTE}`);
    expect(res.status).toBe(200);
    expect(res.json).toHaveProperty("clientes");
    expect(Array.isArray(res.json.clientes)).toBe(true);
    expect(res.json.clientes.length).toBe(2);

    // Garante que só clientes da GD (dono_client_id = geracao-digital) são retornados
    const empresas = res.json.clientes.map((c) => c.nome_empresa);
    expect(empresas).toContain("Empresa Alfa");
    expect(empresas).toContain("Empresa Beta");
    expect(empresas).not.toContain("Empresa Outro Tenant");

    // Valida formato dos campos especificados incluindo os novos campos de prazo
    const clienteBeta = res.json.clientes.find((c) => c.nome_empresa === "Empresa Beta");
    expect(clienteBeta).toEqual({
      id: "22222222-2222-2222-2222-222222222222",
      nome_empresa: "Empresa Beta",
      estado_atual: "BRIEFING_AGENDADO",
      fase: "entrada",
      ordem: 80,
      entrou_em: "2026-11-02T14:30:00.000Z",
      prazo_horas: 72,
      prazo_contagem: "horas_corridas",
      rotulo_interno: "Briefing agendado",
      acao_do_cliente: false,
    });

    const clienteAlfa = res.json.clientes.find((c) => c.nome_empresa === "Empresa Alfa");
    expect(clienteAlfa).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      nome_empresa: "Empresa Alfa",
      estado_atual: "PROPOSTA_ENVIADA",
      fase: "comercial",
      ordem: 10,
      entrou_em: "2026-11-01T10:00:00.000Z",
      prazo_horas: 168,
      prazo_contagem: "horas_corridas",
      rotulo_interno: "Proposta enviada",
      acao_do_cliente: false,
    });
  });

  it("rotas regulares continuam protegidas contra acesso sem credencial Firebase", async () => {
    process.env.GOCLAW_READ_TOKEN = TOKEN_TESTE;
    // Sem Authorization
    const resSemAuth = await fetch(`${base}/api/gd/clientes`, { method: "GET" });
    expect(resSemAuth.status).toBe(401);

    // Com o token do GoClaw em vez de credencial Firebase
    const resComGoclaw = await fetch(`${base}/api/gd/clientes`, {
      method: "GET",
      headers: { Authorization: `Bearer ${TOKEN_TESTE}` },
    });
    // Não pode dar 200 de sucesso
    expect(resComGoclaw.status).not.toBe(200);
  });
});

describe("classificação matemática do Vigia GD (datas fixadas)", () => {
  const t0 = new Date("2026-11-01T00:00:00.000Z");

  it("classifica cliente ATIVO como EM REGIME independentemente do tempo", () => {
    const agora = new Date("2026-11-20T00:00:00.000Z");
    const c = {
      nome_empresa: "Ativa LTDA",
      estado_atual: "ATIVO",
      fase: "regime",
      entrou_em: t0.toISOString(),
      prazo_horas: null,
      prazo_contagem: "horas_corridas",
      acao_do_cliente: false,
    };
    const res = classificarCliente(c, agora);
    expect(res.status).toBe("EM REGIME");
    expect(res.prazo_sla).toBe("Sem prazo fatal");
    expect(res.responsavel).toBe("Equipe GD");
  });

  it("classifica cliente PAUSADO e ENCERRADO corretamente", () => {
    const agora = new Date("2026-11-05T00:00:00.000Z");
    const pausado = classificarCliente({ estado_atual: "PAUSADO", entrou_em: t0.toISOString() }, agora);
    expect(pausado.status).toBe("PAUSADO");

    const encerrado = classificarCliente({ estado_atual: "ENCERRADO", entrou_em: t0.toISOString() }, agora);
    expect(encerrado.status).toBe("ENCERRADO");
  });

  it("classifica NO_PRAZO quando horas_decorridas < 80% do prazo", () => {
    // Prazo de 100 horas. 72h decorridas = 72% (< 80%)
    const agora = new Date("2026-11-04T00:00:00.000Z"); // +72h após t0
    const c = {
      nome_empresa: "Cliente Prazo",
      estado_atual: "BRIEFING_AGENDADO",
      entrou_em: t0.toISOString(),
      prazo_horas: 100,
      prazo_contagem: "horas_corridas",
      acao_do_cliente: false,
    };
    const res = classificarCliente(c, agora);
    expect(res.status).toBe("NO_PRAZO");
    expect(res.horas_decorridas).toBe(72);
    expect(res.detalhe).toBe("Restam 28h");
  });

  it("classifica ALERTA quando horas_decorridas >= 80% do prazo e <= prazo", () => {
    // Prazo de 100 horas. 80h decorridas = 80% exatos
    const agora80 = new Date("2026-11-04T08:00:00.000Z"); // +80h
    const c = {
      nome_empresa: "Cliente Alerta",
      estado_atual: "BRIEFING_AGENDADO",
      entrou_em: t0.toISOString(),
      prazo_horas: 100,
      prazo_contagem: "horas_corridas",
      acao_do_cliente: false,
    };
    const res80 = classificarCliente(c, agora80);
    expect(res80.status).toBe("ALERTA");
    expect(res80.horas_decorridas).toBe(80);
    expect(res80.detalhe).toBe("Faltam 20h");

    // 100h decorridas: exatamente no limite do prazo
    const agora100 = new Date("2026-11-05T04:00:00.000Z"); // +100h
    const res100 = classificarCliente(c, agora100);
    expect(res100.status).toBe("ALERTA");
    expect(res100.horas_decorridas).toBe(100);
    expect(res100.detalhe).toBe("Faltam 0h");
  });

  it("classifica ATRASADO quando horas_decorridas > prazo_horas", () => {
    // Prazo de 100 horas. 101h decorridas (> 100h)
    const agora = new Date("2026-11-05T05:00:00.000Z"); // +101h
    const c = {
      nome_empresa: "Cliente Atrasado",
      estado_atual: "BRIEFING_AGENDADO",
      entrou_em: t0.toISOString(),
      prazo_horas: 100,
      prazo_contagem: "horas_corridas",
      acao_do_cliente: false,
    };
    const res = classificarCliente(c, agora);
    expect(res.status).toBe("ATRASADO");
    expect(res.horas_decorridas).toBe(101);
    expect(res.detalhe).toBe("Estourado por 1h");
  });

  it("identifica corretamente ação do cliente vs equipe GD", () => {
    const agora = new Date("2026-11-02T00:00:00.000Z");
    const doCliente = classificarCliente({ estado_atual: "BRIEFING_APROVACAO_CLIENTE", acao_do_cliente: true, entrou_em: t0.toISOString() }, agora);
    expect(doCliente.responsavel).toBe("Cliente");

    const daEquipe = classificarCliente({ estado_atual: "BRIEFING_REALIZADO", acao_do_cliente: false, entrou_em: t0.toISOString() }, agora);
    expect(daEquipe.responsavel).toBe("Equipe GD");
  });

  it("classifica horas_uteis e fim_do_dia_util como EM_ANALISE_UTEIS", () => {
    const agora = new Date("2026-11-01T06:00:00.000Z");
    const uteis = classificarCliente({
      estado_atual: "PROPOSTA_ACEITA",
      prazo_horas: 4,
      prazo_contagem: "horas_uteis",
      entrou_em: t0.toISOString(),
    }, agora);
    expect(uteis.status).toBe("EM_ANALISE_UTEIS");
    expect(uteis.prazo_sla).toBe("4h úteis");

    const fimDoDia = classificarCliente({
      estado_atual: "ASSINADO",
      prazo_horas: null,
      prazo_contagem: "fim_do_dia_util",
      entrou_em: t0.toISOString(),
    }, agora);
    expect(fimDoDia.status).toBe("EM_ANALISE_UTEIS");
    expect(fimDoDia.prazo_sla).toBe("Fim do dia útil");
  });

  it("calcula resumo de totais com precisão", () => {
    const agora = new Date("2026-11-05T00:00:00.000Z"); // +96h de t0
    const clientes = [
      { nome_empresa: "A", estado_atual: "ATIVO", fase: "regime", entrou_em: t0.toISOString() },
      { nome_empresa: "B", estado_atual: "PROPOSTA_ENVIADA", fase: "comercial", prazo_horas: 168, prazo_contagem: "horas_corridas", entrou_em: t0.toISOString() }, // 96h < 134h -> NO_PRAZO
      { nome_empresa: "C", estado_atual: "BRIEFING_AGENDADO", fase: "entrada", prazo_horas: 100, prazo_contagem: "horas_corridas", entrou_em: t0.toISOString() }, // 96h >= 80h -> ALERTA
      { nome_empresa: "D", estado_atual: "IDENTIDADE_VISUAL", fase: "estrategia", prazo_horas: 48, prazo_contagem: "horas_corridas", entrou_em: t0.toISOString() }, // 96h > 48h -> ATRASADO
      { nome_empresa: "E", estado_atual: "PAUSADO", fase: "fora_da_linha", entrou_em: t0.toISOString() },
    ];

    const relatorio = gerarRelatorioVigia(clientes, agora);
    expect(relatorio.resumo).toEqual({
      ativos: 1,      // Empresa A
      onboarding: 3,  // Empresas B, C, D
      atrasados: 1,   // Empresa D
      alerta: 1,      // Empresa C
    });
  });
});

describe("período e normalização de destinatários WhatsApp", () => {
  it("determina período via flag de CLI com prioridade", () => {
    expect(determinarPeriodo(["--periodo=checkin"])).toBe("checkin");
    expect(determinarPeriodo(["--periodo=fechamento"])).toBe("fechamento");
    expect(determinarPeriodo(["--other", "--periodo=CHECKIN"])).toBe("checkin");
  });

  it("infere período com base no horário quando a flag não for fornecida", () => {
    // 09:00 no horário de Brasília (UTC-3 -> 12:00Z)
    const manha = new Date("2026-11-04T12:00:00.000Z");
    expect(determinarPeriodo([], manha)).toBe("checkin");

    // 15:30 no horário de Brasília (UTC-3 -> 18:30Z)
    const tarde = new Date("2026-11-04T18:30:00.000Z");
    expect(determinarPeriodo([], tarde)).toBe("fechamento");
  });

  it("normaliza números de WhatsApp adicionando DDI 55 e limpando pontuação", () => {
    const raw = " (34) 99123-4567, 11987654321, 5521998887777 ";
    const normalizados = normalizarNumerosWhatsApp(raw);
    expect(normalizados).toEqual([
      "5534991234567",
      "5511987654321",
      "5521998887777",
    ]);
  });

  it("ignora números com formatação inválida e remove duplicatas", () => {
    const raw = "12345, 5534991234567, 5534991234567, texto-invalido, 0011999999999";
    const normalizados = normalizarNumerosWhatsApp(raw);
    expect(normalizados).toEqual(["5534991234567"]);
  });

  it("retorna array vazio quando entrada for nula, indefinida ou vazia", () => {
    expect(normalizarNumerosWhatsApp(null)).toEqual([]);
    expect(normalizarNumerosWhatsApp("")).toEqual([]);
    expect(normalizarNumerosWhatsApp(undefined)).toEqual([]);
  });
});

describe("briefing do GoClaw e fallback determinístico", () => {
  const agora = new Date("2026-11-04T15:00:00.000Z");
  const relatorioComAtrasos = {
    resumo: { ativos: 20, onboarding: 2, atrasados: 1, alerta: 1 },
    classificados: [
      {
        cliente: { nome_empresa: "Empresa X", estado_atual: "BRIEFING_AGENDADO", rotulo_interno: "Briefing agendado" },
        info: { status: "ATRASADO", detalhe: "Estourado por 4h", horas_decorridas: 76, responsavel: "Equipe GD", prazo_sla: "72h corridas" },
      },
      {
        cliente: { nome_empresa: "Empresa Y", estado_atual: "PLANEJAMENTO_APROVACAO", rotulo_interno: "Planejamento para aprovar" },
        info: { status: "ALERTA", detalhe: "Faltam 2h", horas_decorridas: 46, responsavel: "Cliente", prazo_sla: "48h corridas" },
      },
      {
        cliente: { nome_empresa: "Empresa Z", estado_atual: "ATIVO", rotulo_interno: "Cliente ativo" },
        info: { status: "EM REGIME", detalhe: "Em regime", horas_decorridas: 300, responsavel: "Equipe GD", prazo_sla: "Sem prazo fatal" },
      },
    ],
    agora,
  };

  const relatorioEstavel = {
    resumo: { ativos: 22, onboarding: 0, atrasados: 0, alerta: 0 },
    classificados: [
      {
        cliente: { nome_empresa: "Empresa Alfa", estado_atual: "ATIVO" },
        info: { status: "EM REGIME", detalhe: "Em regime", horas_decorridas: 200, responsavel: "Equipe GD", prazo_sla: "Sem prazo fatal" },
      },
    ],
    agora,
  };

  it("gera prompt do GoClaw destacando pendências e persona executiva", () => {
    const prompt = gerarPromptGoClaw({ relatorio: relatorioComAtrasos, periodo: "checkin" });
    expect(prompt.system).toContain("Vigia Operacional da Geração Digital");
    expect(prompt.system).toContain("Check-in Matinal");
    expect(prompt.user).toContain("Empresa X");
    expect(prompt.user).toContain("Equipe GD");
    expect(prompt.user).toContain("Empresa Y");
    expect(prompt.user).toContain("Cliente");
  });

  it("gera briefing fallback matinal com destaque aos responsáveis de cobrança", () => {
    const fallback = gerarBriefingFallback({ relatorio: relatorioComAtrasos, periodo: "checkin" });
    expect(fallback).toContain("☀️ *Check-in Operacional GD*");
    expect(fallback).toContain("Demandas Atrasadas: 🚨 *1*");
    expect(fallback).toContain("Demandas em Alerta: ⚠️ *1*");
    expect(fallback).toContain("Empresa X");
    expect(fallback).toContain("Cobrar: *Equipe GD*");
    expect(fallback).toContain("Empresa Y");
    expect(fallback).toContain("Cobrar: *Cliente*");
  });

  it("gera briefing fallback de fechamento com carteira 100% estável", () => {
    const fallback = gerarBriefingFallback({ relatorio: relatorioEstavel, periodo: "fechamento" });
    expect(fallback).toContain("🌙 *Fechamento Operacional GD*");
    expect(fallback).toContain("• Clientes Ativos (em regime): *22*");
    expect(fallback).toContain("✅ Carteira 100% em dia. Nenhuma demanda atrasada ou em alerta.");
  });

  it("gerarBriefingGoClaw usa resposta do modelo quando chamada HTTP sucede", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: { content: "Briefing executivo gerado com sucesso pelo Gemini 3 Flash." },
          },
        ],
      }),
    });

    const texto = await gerarBriefingGoClaw({
      relatorio: relatorioComAtrasos,
      periodo: "checkin",
      goclawUrl: "http://goclaw-teste:1337",
      goclawToken: "token-goclaw-123",
      fetchFn: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("http://goclaw-teste:1337/v1/chat/completions");
    expect(opts.headers["Authorization"]).toBe("Bearer token-goclaw-123");
    expect(JSON.parse(opts.body).model).toBe("gemini/gemini-3-flash-preview");
    expect(texto).toBe("Briefing executivo gerado com sucesso pelo Gemini 3 Flash.");
  });

  it("gerarBriefingGoClaw usa fallback determinístico quando GoClaw falha ou dá erro 500", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "Internal server error",
    });

    const texto = await gerarBriefingGoClaw({
      relatorio: relatorioComAtrasos,
      periodo: "fechamento",
      goclawUrl: "http://goclaw-teste:1337",
      goclawToken: "token-goclaw-123",
      fetchFn: fetchMock,
    });

    expect(texto).toContain("🌙 *Fechamento Operacional GD*");
    expect(texto).toContain("Empresa X");
  });

  it("gerarBriefingGoClaw usa fallback imediatamente se token não for informado", async () => {
    const fetchMock = vi.fn();
    const texto = await gerarBriefingGoClaw({
      relatorio: relatorioEstavel,
      periodo: "checkin",
      goclawToken: null,
      fetchFn: fetchMock,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(texto).toContain("☀️ *Check-in Operacional GD*");
    expect(texto).toContain("Carteira 100% em dia");
  });
});

describe("despacho do Vigia: dry-run vs dispatch", () => {
  const relatorio = {
    resumo: { ativos: 22, onboarding: 0, atrasados: 0, alerta: 0 },
    classificados: [],
    agora: new Date(),
  };
  const briefingTexto = "Texto do briefing para teste";

  it("em modo dryRun não invoca remetentes de rede (Slack ou Evolution)", async () => {
    const slackMock = vi.fn();
    const evolutionMock = vi.fn();

    const res = await despacharVigia({
      briefingTexto,
      relatorio,
      dryRun: true,
      periodo: "checkin",
      slackSender: slackMock,
      evolutionSender: evolutionMock,
      config: {
        slackChannel: "01-ops-geral",
        slackToken: "slack-token-xyz",
        whatsappNumbers: "5534991234567, 5511998765432",
      },
    });

    expect(slackMock).not.toHaveBeenCalled();
    expect(evolutionMock).not.toHaveBeenCalled();
    expect(res.dryRun).toBe(true);
    expect(res.slack.enviado).toBe(false);
    expect(res.whatsapp.enviado).toBe(false);
  });

  it("em modo dispatch (dryRun=false) dispara Slack e cada destinatário WhatsApp", async () => {
    const slackMock = vi.fn().mockResolvedValue({ ok: true, ts: "123456789.00" });
    const evolutionMock = vi.fn().mockResolvedValue({ success: true, waMessageId: "msg-wa-123" });

    const res = await despacharVigia({
      briefingTexto,
      relatorio,
      dryRun: false,
      periodo: "checkin",
      slackSender: slackMock,
      evolutionSender: evolutionMock,
      config: {
        slackChannel: "01-ops-geral",
        slackToken: "slack-token-xyz",
        whatsappNumbers: "5534991234567, 5511998765432",
        instanceName: "TesteInstancia",
        evolutionUrl: "https://evolution-teste.com",
        evolutionApiKey: "evo-key-123",
      },
    });

    expect(slackMock).toHaveBeenCalledTimes(1);
    expect(slackMock).toHaveBeenCalledWith({
      text: briefingTexto,
      channel: "01-ops-geral",
      token: "slack-token-xyz",
    });

    expect(evolutionMock).toHaveBeenCalledTimes(2);
    expect(evolutionMock).toHaveBeenNthCalledWith(1, {
      instanceName: "TesteInstancia",
      number: "5534991234567",
      text: briefingTexto,
      baseUrl: "https://evolution-teste.com",
      webhookToken: "evo-key-123",
    });
    expect(evolutionMock).toHaveBeenNthCalledWith(2, {
      instanceName: "TesteInstancia",
      number: "5511998765432",
      text: briefingTexto,
      baseUrl: "https://evolution-teste.com",
      webhookToken: "evo-key-123",
    });

    expect(res.dryRun).toBe(false);
    expect(res.slack.enviado).toBe(true);
    expect(res.whatsapp.destinatarios).toHaveLength(2);
    expect(res.whatsapp.destinatarios[0].enviado).toBe(true);
    expect(res.whatsapp.destinatarios[1].enviado).toBe(true);
  });

  it("continua envio do WhatsApp mesmo se um dos números falhar", async () => {
    const slackMock = vi.fn().mockResolvedValue({ ok: true });
    const evolutionMock = vi.fn()
      .mockRejectedValueOnce(new Error("Falha no envio para número 1"))
      .mockResolvedValueOnce({ success: true, waMessageId: "msg-wa-456" });

    const res = await despacharVigia({
      briefingTexto,
      relatorio,
      dryRun: false,
      slackSender: slackMock,
      evolutionSender: evolutionMock,
      config: {
        slackChannel: "01-ops-geral",
        slackToken: "slack-token-xyz",
        whatsappNumbers: "5534991234567, 5511998765432",
      },
    });

    expect(evolutionMock).toHaveBeenCalledTimes(2);
    expect(res.whatsapp.destinatarios[0].enviado).toBe(false);
    expect(res.whatsapp.destinatarios[0].erro).toBe("Falha no envio para número 1");
    expect(res.whatsapp.destinatarios[1].enviado).toBe(true);
  });
});
