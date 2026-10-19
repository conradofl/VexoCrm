import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import {
  checkCaptureRateLimit,
  resetCaptureRateLimit,
  validateCapturePayload,
  formatVisitorDiagnosticMessage,
  formatOwnerAlertMessage,
  saveCaptureLead,
  dispatchCaptureAutoReply,
  maskPhoneForDisplay,
  notifyOwnerOnCapture,
  checkCaptureDispatchQuota,
  resetLeadCaptureDispatchesTableEnsured,
  parseBaseCount,
  parseTicketMedio,
  parseStalledPct,
  calculateStalledRevenue,
  DAILY_CAPTURE_DISPATCH_LIMIT_PER_TENANT,
  MAX_CAPTURE_DISPATCH_PER_PHONE_24H,
} from "../services/leadCapture.js";
import * as evolutionModule from "../services/evolution.js";
import * as leadUpsertModule from "../services/leadUpsert.js";

describe("Serviço de Captura de Leads e Diagnóstico Comercial", () => {
  beforeEach(() => {
    resetCaptureRateLimit();
    resetLeadCaptureDispatchesTableEnsured();
    leadUpsertModule.resetLeadsColumnsCache();
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // f) Honeypot: descarta em silêncio e responde 200
  // --------------------------------------------------------------------------
  it("f) honeypot preenchido: identifica robô para descarte silencioso", () => {
    const payloadComHoneypot = {
      fullName: "Spam Bot",
      phone: "34991751267",
      website_url: "https://spam.com",
    };

    const res = validateCapturePayload(payloadComHoneypot);
    expect(res.isBot).toBe(true);
    expect(res.valid).toBe(false);
  });

  // --------------------------------------------------------------------------
  // e) Telefone inválido: recusa com mensagem clara, NÃO dispara
  // --------------------------------------------------------------------------
  it("e) telefone inválido: recusa com erro e mensagem clara, sem autorizar disparo", () => {
    const payloadInvalido = {
      fullName: "Carlos Silva",
      phone: "12345", // formato impossível
      email: "carlos@empresa.com",
    };

    const res = validateCapturePayload(payloadInvalido);
    expect(res.valid).toBe(false);
    expect(res.error).toBe("TELEFONE_INVALIDO");
    expect(res.message).toMatch(/número de WhatsApp comercial válido/i);
  });

  it("valida obrigatoriedade do nome completo", () => {
    const semNome = {
      fullName: "",
      phone: "34991751267",
    };

    const res = validateCapturePayload(semNome);
    expect(res.valid).toBe(false);
    expect(res.error).toBe("NOME_OBRIGATORIO");
  });

  // --------------------------------------------------------------------------
  // g) Rate Limit: 6º envio do mesmo IP na mesma hora é recusado
  // --------------------------------------------------------------------------
  it("g) rate limit: permite até 5 envios por IP por hora e recusa o 6º envio", () => {
    const testIp = "192.168.1.100";

    for (let i = 1; i <= 5; i++) {
      expect(checkCaptureRateLimit(testIp, 5, 3600000)).toBe(true);
    }

    // 6º envio deve ser barrado
    const sextoEnvio = checkCaptureRateLimit(testIp, 5, 3600000);
    expect(sextoEnvio).toBe(false);

    // Outro IP deve continuar permitido
    expect(checkCaptureRateLimit("192.168.1.101", 5, 3600000)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // a) saveCaptureLead com email preenchido -> lead gravado, email em dados.email
  // --------------------------------------------------------------------------
  it("a) saveCaptureLead com email preenchido -> lead gravado, email em dados.email e NÃO na raiz", async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rowCount: 1 }),
    };

    const upsertSpy = vi.spyOn(leadUpsertModule, "upsertLeadByPhone").mockResolvedValue("inserted");

    const leadData = {
      clientId: "vexo-adm",
      phone: "5534991751267",
      fullName: "Conrado Finzi",
      email: "conrado@vexo.com.br",
      answers: {
        company: "Vexo Tecnologia",
        teamSize: "2 a 5 vendedores",
        baseSize: "10.000 a 50.000 contatos",
        responseTime: "5 a 30 minutos",
      },
    };

    const result = await saveCaptureLead(mockPool, leadData);

    expect(result.action).toBe("inserted");
    expect(upsertSpy).toHaveBeenCalledTimes(1);

    const [calledPool, calledClientId, calledPhone, calledFields] = upsertSpy.mock.calls[0];
    expect(calledClientId).toBe("vexo-adm");
    expect(calledPhone).toBe("5534991751267");
    expect(calledFields.tags).toContain("diagnostico-site");
    expect(calledFields.lead_origin).toBe("diagnostico-site");
    expect(calledFields.nome).toBe("Conrado Finzi");
    // PROVA DA CORREÇÃO: email NÃO pode ir no nível raiz (evita column "email" does not exist)
    expect(calledFields.email).toBeUndefined();
    // email deve ir dentro do JSONB dados
    expect(calledFields.dados.email).toBe("conrado@vexo.com.br");

    // Verifica que gravou notificação in-app no CRM
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO public.notifications"),
      expect.arrayContaining(["vexo-adm", expect.stringContaining("Conrado Finzi")])
    );
  });

  // --------------------------------------------------------------------------
  // b) saveCaptureLead com email null -> lead gravado, sem quebrar
  // --------------------------------------------------------------------------
  it("b) saveCaptureLead com email null -> lead gravado com dados.email null, sem quebrar", async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rowCount: 1 }),
    };

    const upsertSpy = vi.spyOn(leadUpsertModule, "upsertLeadByPhone").mockResolvedValue("inserted");

    const leadData = {
      clientId: "vexo-adm",
      phone: "5534991751267",
      fullName: "Lead Sem Email",
      email: null,
      answers: { company: "Empresa Teste" },
    };

    const result = await saveCaptureLead(mockPool, leadData);

    expect(result.action).toBe("inserted");
    expect(upsertSpy).toHaveBeenCalledTimes(1);

    const [, , , calledFields] = upsertSpy.mock.calls[0];
    expect(calledFields.email).toBeUndefined();
    expect(calledFields.dados.email).toBeNull();
  });

  // --------------------------------------------------------------------------
  // c) upsertLeadByPhone com chave inexistente -> não vai pro SQL, warn emitido, retorna normal
  // --------------------------------------------------------------------------
  it("c) upsertLeadByPhone com chave inexistente -> não vai pro SQL, warn emitido, retorna normal", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    let executedInsertSql = "";
    let executedParams = [];

    const mockPool = {
      query: vi.fn(async (sql, params = []) => {
        if (sql.includes("information_schema.columns")) {
          return {
            rows: [
              { column_name: "id" },
              { column_name: "client_id" },
              { column_name: "telefone" },
              { column_name: "phone" },
              { column_name: "nome" },
              { column_name: "tags" },
              { column_name: "dados" },
            ],
          };
        }
        if (sql.includes("SELECT") && sql.includes("FROM public.leads")) {
          return { rows: [] }; // Simula lead novo (vai para INSERT)
        }
        if (sql.includes("INSERT INTO public.leads")) {
          executedInsertSql = sql;
          executedParams = params;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    // Chamada passando chave inexistente 'email' e outro campo fantasma
    const result = await leadUpsertModule.upsertLeadByPhone(
      mockPool,
      "vexo-adm",
      "5534991751267",
      {
        nome: "Lead Protegido",
        tags: ["diagnostico-site"],
        email: "teste@naoexiste.com", // Chave inexistente na tabela leads
        campo_inexistente_xyz: "valor_fantasma", // Outra chave inexistente
        dados: { email: "teste@naoexiste.com" }, // Chave válida (JSONB)
      }
    );

    expect(result).toBe("inserted");

    // 1. Chaves inexistentes NÃO podem constar no SQL nem nos parâmetros
    expect(executedInsertSql).not.toContain('"email"');
    expect(executedInsertSql).not.toContain('"campo_inexistente_xyz"');
    expect(executedParams).not.toContain("valor_fantasma");

    // 2. Chaves legítimas DEVEM estar no SQL
    expect(executedInsertSql).toContain('"nome"');
    expect(executedInsertSql).toContain('"tags"');
    expect(executedInsertSql).toContain('"dados"');

    // 3. Deve emitir console.warn com o nome da chave e o chamador fora de leadUpsert.js
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[leadUpsert] Chave desconhecida descartada da coluna public.leads: "email"')
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[leadUpsert] Chave desconhecida descartada da coluna public.leads: "campo_inexistente_xyz"')
    );
  });

  // --------------------------------------------------------------------------
  // d) boot com banco respondendo -> conjunto vem do information_schema;
  //    chave presente no banco mas AUSENTE da constante é aceita
  // --------------------------------------------------------------------------
  it("d) boot com banco respondendo -> conjunto vem do information_schema; chave presente no banco mas AUSENTE da constante é aceita", async () => {
    leadUpsertModule.resetLeadsColumnsCache();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    let executedInsertSql = "";
    let executedParams = [];

    // Coluna que comprovadamente NÃO existe na constante de fallback KNOWN_LEADS_COLUMNS
    const colunaCustomDoBanco = "coluna_nova_criada_por_migration";
    expect(leadUpsertModule.KNOWN_LEADS_COLUMNS.has(colunaCustomDoBanco)).toBe(false);

    const mockPool = {
      query: vi.fn(async (sql, params = []) => {
        if (sql.includes("information_schema.columns")) {
          return {
            rows: [
              { column_name: "id" },
              { column_name: "client_id" },
              { column_name: "telefone" },
              { column_name: "phone" },
              { column_name: "nome" },
              { column_name: "tags" },
              { column_name: "dados" },
              { column_name: colunaCustomDoBanco },
            ],
          };
        }
        if (sql.includes("SELECT") && sql.includes("FROM public.leads")) {
          return { rows: [] }; // Lead novo
        }
        if (sql.includes("INSERT INTO public.leads")) {
          executedInsertSql = sql;
          executedParams = params;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    const result = await leadUpsertModule.upsertLeadByPhone(
      mockPool,
      "vexo-adm",
      "5534991751267",
      {
        nome: "Lead Com Coluna Nova",
        [colunaCustomDoBanco]: "valor_valido_do_banco",
      }
    );

    expect(result).toBe("inserted");

    // 1. A coluna nova do banco DEVE estar presente no SQL e nos parâmetros
    expect(executedInsertSql).toContain(`"${colunaCustomDoBanco}"`);
    expect(executedParams).toContain("valor_valido_do_banco");

    // 2. Não deve ter emitido warning de descarte para essa coluna
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining(`[leadUpsert] Chave desconhecida descartada da coluna public.leads: "${colunaCustomDoBanco}"`)
    );
  });

  // --------------------------------------------------------------------------
  // e) boot com a query falhando -> usa o fallback e emite o aviso
  // --------------------------------------------------------------------------
  it("e) boot com a query falhando -> usa o fallback e emite o aviso", async () => {
    leadUpsertModule.resetLeadsColumnsCache();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    let executedInsertSql = "";
    let executedParams = [];

    const mockPool = {
      query: vi.fn(async (sql, params = []) => {
        if (sql.includes("information_schema.columns")) {
          throw new Error("connection to database lost");
        }
        if (sql.includes("SELECT") && sql.includes("FROM public.leads")) {
          return { rows: [] }; // Lead novo
        }
        if (sql.includes("INSERT INTO public.leads")) {
          executedInsertSql = sql;
          executedParams = params;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    const result = await leadUpsertModule.upsertLeadByPhone(
      mockPool,
      "vexo-adm",
      "5534991751267",
      {
        nome: "Lead Fallback",
        tags: ["teste-fallback"],
        campo_inexistente_total: "rejeitado",
      }
    );

    expect(result).toBe("inserted");

    // 1. Deve emitir aviso explícito de fallback no log
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[leadUpsert] falha ao carregar colunas do banco")
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("usando KNOWN_LEADS_COLUMNS como fallback")
    );

    // 2. Colunas canônicas da constante de fallback funcionam normalmente
    expect(executedInsertSql).toContain('"nome"');
    expect(executedInsertSql).toContain('"tags"');
    expect(executedParams).toContain("Lead Fallback");

    // 3. Campo inexistente fora do fallback é descartado
    expect(executedInsertSql).not.toContain('"campo_inexistente_total"');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[leadUpsert] Chave desconhecida descartada da coluna public.leads: "campo_inexistente_total"')
    );
  });

  // --------------------------------------------------------------------------
  // f) information_schema falha -> segunda chamada de upsertLeadByPhone NÃO
  //    executa nova query no information_schema e NÃO emite segundo aviso de fallback
  // --------------------------------------------------------------------------
  it("f) information_schema falha -> segunda chamada de upsertLeadByPhone NÃO executa nova query no information_schema e NÃO emite segundo aviso de fallback", async () => {
    leadUpsertModule.resetLeadsColumnsCache();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    let informationSchemaQueryCount = 0;

    const mockPool = {
      query: vi.fn(async (sql, params = []) => {
        if (sql.includes("information_schema.columns")) {
          informationSchemaQueryCount++;
          throw new Error("banco temporariamente inacessível");
        }
        if (sql.includes("SELECT") && sql.includes("FROM public.leads")) {
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO public.leads")) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    // 1ª chamada: falha no information_schema, entra em fallback e grava no cache
    const res1 = await leadUpsertModule.upsertLeadByPhone(
      mockPool,
      "vexo-adm",
      "5534991751267",
      { nome: "Lead 1" }
    );
    expect(res1).toBe("inserted");
    expect(informationSchemaQueryCount).toBe(1);

    const fallbackWarningsAfterFirst = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes("[leadUpsert] falha ao carregar colunas do banco")
    );
    expect(fallbackWarningsAfterFirst.length).toBe(1);

    // 2ª chamada: DEVE consumir o cache em memória!
    // NÃO pode reconsultar information_schema e NÃO pode emitir segundo warning
    const res2 = await leadUpsertModule.upsertLeadByPhone(
      mockPool,
      "vexo-adm",
      "5534991751268",
      { nome: "Lead 2" }
    );
    expect(res2).toBe("inserted");

    // PROVA: nenhuma query extra ao information_schema (continua 1)
    expect(informationSchemaQueryCount).toBe(1);

    // PROVA: nenhum aviso extra de fallback (continua 1)
    const fallbackWarningsAfterSecond = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes("[leadUpsert] falha ao carregar colunas do banco")
    );
    expect(fallbackWarningsAfterSecond.length).toBe(1);
  });

  // --------------------------------------------------------------------------
  // Validação do fallback: assigned_chip incluído
  // --------------------------------------------------------------------------
  it("valida que assigned_chip consta na constante de fallback KNOWN_LEADS_COLUMNS", () => {
    expect(leadUpsertModule.KNOWN_LEADS_COLUMNS.has("assigned_chip")).toBe(true);
  });

  // --------------------------------------------------------------------------
  // b) A mensagem personalizada chega no WhatsApp do visitante com o cálculo do diagnóstico
  // --------------------------------------------------------------------------
  it("b) formata mensagem de demonstração contendo os dados reais do visitante e cálculo do dinheiro parado", () => {
    const msg = formatVisitorDiagnosticMessage({
      fullName: "Carlos Eduardo Finzi",
      baseSize: "10.000 a 50.000 contatos",
      responseTime: "30 minutos",
      ticketMedio: "R$ 2.000 a R$ 5.000",
      stalledLeadsPct: "30% a 50% da base",
    });

    expect(msg).toContain("Oi Carlos! Aqui é a Vexo 👋");
    expect(msg).toContain("10.000 a 50.000 contatos na base");
    expect(msg).toContain("time responde em 30 minutos");
    expect(msg).toContain("ticket médio de R$ 2.000 a R$ 5.000");
    expect(msg).toContain("Com 20.000 leads parados nesse ticket, há cerca de R$ 750.000 esperando na sua base. Estimando 15% de resposta e 5% de fechamento.");
    expect(msg).not.toContain("conservadora");
    expect(msg).toContain("Te ligo amanhã de manhã pra te mostrar como destravar isso em 3 dias. Pode ser?");
  });

  // --------------------------------------------------------------------------
  // g) Cálculo honesto respeitando o teto declarado: R$ 60.000 (assertado como número)
  // --------------------------------------------------------------------------
  it("g) base '2.000 a 10.000' + ticket 'R$ 500 a R$ 2.000' + '30% a 50%' resulta exatamente em R$ 60.000", () => {
    const modalPath = resolve(__dirname, "../../../frontend/src/pages/LandingPage/LeadCaptureModal.tsx");
    const modalContent = readFileSync(modalPath, "utf8");
    const baseMatch = modalContent.match(/<option[^>]*value=\"(2\.000 a 10\.000 contatos)\"/);
    expect(baseMatch, "Opção '2.000 a 10.000 contatos' deve existir no formulário real do frontend").not.toBeNull();

    const baseSize = baseMatch[1];
    const ticketMedio = "R$ 500 a R$ 2.000";
    const stalledLeadsPct = "30% a 50% da base";

    // 1. Validação unitária das funções de cálculo
    const baseCount = parseBaseCount(baseSize);
    const ticketVal = parseTicketMedio(ticketMedio);
    const pct = parseStalledPct(stalledLeadsPct);

    // O teto declarado da base é 10.000 (NUNCA 25.000)
    expect(baseCount).toBe(10000);
    // O teto declarado do ticket é 2.000 (NUNCA 3.500)
    expect(ticketVal).toBe(2000);
    // O percentual médio é 40%
    expect(pct).toBe(0.40);

    const calc = calculateStalledRevenue({ baseSize, ticketMedio, stalledLeadsPct });
    expect(calc.leadsParados).toBe(4000);
    // 4000 leads parados * 15% resposta * 5% fechamento * R$ 2.000 ticket = R$ 60.000
    expect(calc.receitaPotencial).toBe(60000);

    // 2. Validação da mensagem gerada para o WhatsApp: asserta o valor como NÚMERO
    const msg = formatVisitorDiagnosticMessage({
      fullName: "Gabriel Medeiros",
      baseSize,
      ticketMedio,
      stalledLeadsPct,
      responseTime: "30 min a 2 horas",
    });

    const revenueMatch = msg.match(/há cerca de R\$\s*([\d.]+)/);
    expect(revenueMatch).not.toBeNull();
    const extractedRevenue = parseInt(revenueMatch[1].replace(/\./g, ""), 10);
    expect(extractedRevenue).toBe(60000); // Asserta EXATAMENTE 60000 como número!

    const leadsMatch = msg.match(/Com\s+([\d.]+)\s+leads parados/);
    expect(leadsMatch).not.toBeNull();
    const extractedLeads = parseInt(leadsMatch[1].replace(/\./g, ""), 10);
    expect(extractedLeads).toBe(4000); // Asserta EXATAMENTE 4000 como número!

    expect(msg).toContain("Com 4.000 leads parados nesse ticket, há cerca de R$ 60.000 esperando na sua base. Estimando 15% de resposta e 5% de fechamento.");
    expect(msg).not.toContain("conservadora");
    expect(msg).toContain("Te ligo amanhã de manhã pra te mostrar como destravar isso em 3 dias. Pode ser?");
  });

  // --------------------------------------------------------------------------
  // h) Para toda opção do formulário real no frontend, o valor usado <= teto declarado
  // --------------------------------------------------------------------------
  it("h) varre a lista real de opções do frontend e valida que nenhum valor ultrapassa o teto declarado", () => {
    const modalPath = resolve(__dirname, "../../../frontend/src/pages/LandingPage/LeadCaptureModal.tsx");
    const modalContent = readFileSync(modalPath, "utf8");

    // Extrai blocos select reais do arquivo do frontend
    const baseBlockMatch = modalContent.match(/(?:Tamanho da sua base total de contatos|Quantos contatos você tem guardados)[\s\S]*?<select[^>]*>([\s\S]*?)<\/select>/);
    expect(baseBlockMatch).not.toBeNull();
    const baseOptions = [...baseBlockMatch[1].matchAll(/<option[^>]*value=\"([^\"]+)\"/g)].map((m) => m[1]);

    const ticketBlockMatch = modalContent.match(/(?:Ticket M[eé]dio das suas Vendas|Quanto rende uma venda sua)[\s\S]*?<select[^>]*>([\s\S]*?)<\/select>/);
    expect(ticketBlockMatch).not.toBeNull();
    const ticketOptions = [...ticketBlockMatch[1].matchAll(/<option[^>]*value=\"([^\"]+)\"/g)].map((m) => m[1]);

    expect(baseOptions.length).toBeGreaterThanOrEqual(4);
    expect(ticketOptions.length).toBeGreaterThanOrEqual(5);

    function extractDeclaredCeiling(label) {
      const rangeMatch = label.match(/\ba\s+(?:R\$\s*)?(\d[\d.]*)/i);
      if (rangeMatch) return parseInt(rangeMatch[1].replace(/\./g, ""), 10);
      const ateMatch = label.match(/at[ée]\s+(?:R\$\s*)?(\d[\d.]*)/i);
      if (ateMatch) return parseInt(ateMatch[1].replace(/\./g, ""), 10);
      const plusMatch = label.match(/(?:mais de|acima de)\s+(?:R\$\s*)?(\d[\d.]*)/i);
      if (plusMatch) return parseInt(plusMatch[1].replace(/\./g, ""), 10);
      throw new Error(`Não foi possível inferir teto de: ${label}`);
    }

    // Valida cada opção da base do frontend
    for (const option of baseOptions) {
      const parsed = parseBaseCount(option);
      const ceiling = extractDeclaredCeiling(option);
      expect(parsed).toBeGreaterThan(0);
      expect(parsed).toBeLessThanOrEqual(ceiling);
    }

    // Valida cada opção do ticket médio do frontend
    for (const option of ticketOptions) {
      const parsed = parseTicketMedio(option);
      const ceiling = extractDeclaredCeiling(option);
      expect(parsed).toBeGreaterThan(0);
      expect(parsed).toBeLessThanOrEqual(ceiling);
    }
  });

  it("dispara a mensagem via Evolution API pelo chip ativo do tenant", async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ name: "vexo-adm-vexo-atende", dispatch_webhook_token: "token-123" }],
      }),
    };

    const evoSendSpy = vi.spyOn(evolutionModule, "sendTextMessageViaEvolution").mockResolvedValue({
      success: true,
      waMessageId: "WA_12345",
    });

    const res = await dispatchCaptureAutoReply(mockPool, {
      clientId: "vexo-adm",
      phone: "5534991751267",
      messageText: "Oi Carlos!",
    });

    expect(res.sent).toBe(true);
    expect(res.instanceUsed).toBe("vexo-adm-vexo-atende");
    expect(evoSendSpy).toHaveBeenCalledWith({
      instanceName: "vexo-adm-vexo-atende",
      number: "5534991751267",
      text: "Oi Carlos!",
      webhookToken: "token-123",
    });
  });

  // --------------------------------------------------------------------------
  // c) Notificação do dono / SDR com os dados completos
  // --------------------------------------------------------------------------
  it("c) formata alerta completo para o dono e equipe de vendas", () => {
    const alert = formatOwnerAlertMessage({
      fullName: "Mariana Souza",
      phone: "5511999998888",
      email: "mariana@clinica.com",
      answers: {
        company: "Clínica Vida",
        segment: "Saúde / Clínicas",
        teamSize: "4 vendedores",
        baseSize: "5.000 contatos",
        ticketMedio: "R$ 1.500",
        stalledLeadsPct: "Mais de 50%",
        responseTime: "Mais de 2 horas",
        followupProcess: "Planilha manual",
        mainPain: "Leads esfriam antes do contato",
      },
      clientId: "vexo-adm",
    });

    expect(alert).toContain("🔔 *Novo Diagnóstico Comercial no Site!*");
    expect(alert).toContain("Mariana Souza");
    expect(alert).toContain("Clínica Vida");
    expect(alert).toContain("R$ 1.500");
    expect(alert).toContain("diagnostico-site");
  });

  // --------------------------------------------------------------------------
  // h) Falha no disparo NÃO perde o lead — lead salvo e erro registrado
  // --------------------------------------------------------------------------
  it("h) falha no disparo do WhatsApp NÃO perde o lead — erro é capturado e registrado", async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    vi.spyOn(evolutionModule, "sendTextMessageViaEvolution").mockRejectedValue(
      new Error("Evolution Instance Offline")
    );

    const res = await dispatchCaptureAutoReply(mockPool, {
      clientId: "vexo-adm",
      phone: "5534991751267",
      messageText: "Oi Carlos!",
    });

    expect(res.sent).toBe(false);
    expect(res.error).toBe("Evolution Instance Offline");

    // Verifica que registrou erro no lead no banco
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE public.leads"),
      expect.arrayContaining(["Evolution Instance Offline", "vexo-adm", "5534991751267"])
    );
  });

  it("mascara telefone para confirmação amigável na tela", () => {
    expect(maskPhoneForDisplay("5534991751267")).toBe("(34) *****-1267");
    expect(maskPhoneForDisplay("34991751267")).toBe("(34) *****-1267");
  });

  // --------------------------------------------------------------------------
  // i) 51ª captura do dia no mesmo tenant: lead SALVO, mensagem NÃO enviada, motivo registrado
  // --------------------------------------------------------------------------
  it("i) 51ª captura do dia no mesmo tenant: lead SALVO, mensagem NÃO enviada, motivo registrado", async () => {
    resetLeadCaptureDispatchesTableEnsured();

    const upsertSpy = vi.spyOn(leadUpsertModule, "upsertLeadByPhone").mockResolvedValue("inserted");
    const evoSendSpy = vi.spyOn(evolutionModule, "sendTextMessageViaEvolution").mockResolvedValue({ success: true });

    let leadUpdatedWithBlockedReason = null;

    const mockPool = {
      query: vi.fn(async (sql, params) => {
        // Checagem de telefone em 24h: 0 envios anteriores para este número novo
        if (sql.includes("COUNT(*)::int") && sql.includes("phone = $2")) {
          return { rows: [{ count: 0 }] };
        }
        // Checagem de teto global do tenant em 24h: já atingiu 50 envios hoje!
        if (sql.includes("COUNT(*)::int") && sql.includes("client_id = $1")) {
          return { rows: [{ count: 50 }] };
        }
        // Registro de bloqueio no lead
        if (sql.includes("UPDATE public.leads")) {
          leadUpdatedWithBlockedReason = params[0]; // motivo
          return { rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    // 1. Salva o 51º lead normalmente (nunca perder lead!)
    const leadData = {
      clientId: "vexo-adm",
      phone: "5534991751267",
      fullName: "Lead Cinquenta e Um",
      email: "lead51@empresa.com",
      answers: { company: "Empresa 51" },
    };
    const saveResult = await saveCaptureLead(mockPool, leadData);
    expect(saveResult.action).toBe("inserted");
    expect(upsertSpy).toHaveBeenCalledTimes(1);

    // 2. Tenta disparar a auto-resposta pelo chip
    const dispatchResult = await dispatchCaptureAutoReply(mockPool, {
      clientId: "vexo-adm",
      phone: "5534991751267",
      messageText: "Oi!",
    });

    // 3. Validações: Mensagem NÃO enviada, lead marcado com motivo no banco
    expect(dispatchResult.sent).toBe(false);
    expect(dispatchResult.blocked).toBe(true);
    expect(dispatchResult.reason).toBe("teto_diario_tenant_atingido");
    expect(evoSendSpy).not.toHaveBeenCalled();
    expect(leadUpdatedWithBlockedReason).toBe("teto_diario_tenant_atingido");
  });

  // --------------------------------------------------------------------------
  // j) mesmo telefone pela 6ª vez em 24h: salvo, não dispara (limite por telefone = 5)
  // --------------------------------------------------------------------------
  it("j) mesmo telefone pela 6ª vez em 24h: salvo, não dispara (limite por telefone = 5)", async () => {
    resetLeadCaptureDispatchesTableEnsured();
    expect(MAX_CAPTURE_DISPATCH_PER_PHONE_24H).toBe(5);

    const upsertSpy = vi.spyOn(leadUpsertModule, "upsertLeadByPhone").mockResolvedValue("updated");
    const evoSendSpy = vi.spyOn(evolutionModule, "sendTextMessageViaEvolution").mockResolvedValue({ success: true });

    let leadUpdatedWithBlockedReason = null;

    const mockPool = {
      query: vi.fn(async (sql, params) => {
        // Checagem de telefone em 24h: já teve 5 envios anteriores para este mesmo número!
        if (sql.includes("COUNT(*)::int") && (sql.includes("phone = $2") || sql.includes("phone = $3"))) {
          return { rows: [{ count: 5 }] };
        }
        // Checagem de teto global do tenant em 24h: apenas 5 envios gerais
        if (sql.includes("COUNT(*)::int") && sql.includes("client_id = $1")) {
          return { rows: [{ count: 5 }] };
        }
        // Registro de bloqueio no lead
        if (sql.includes("UPDATE public.leads")) {
          leadUpdatedWithBlockedReason = params[0];
          return { rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    // 1. Salva o lead pela 6ª vez (atualiza lead existente)
    const saveResult = await saveCaptureLead(mockPool, {
      clientId: "vexo-adm",
      phone: "5534991751267",
      fullName: "Cliente Repetido",
      answers: { company: "Repetido SA" },
    });
    expect(saveResult.action).toBe("updated");
    expect(upsertSpy).toHaveBeenCalledTimes(1);

    // 2. Disparo de WhatsApp
    const dispatchResult = await dispatchCaptureAutoReply(mockPool, {
      clientId: "vexo-adm",
      phone: "5534991751267",
      messageText: "Oi de novo!",
    });

    // 3. Validações: chip protegido, não dispara, motivo registrado
    expect(dispatchResult.sent).toBe(false);
    expect(dispatchResult.blocked).toBe(true);
    expect(dispatchResult.reason).toBe("limite_telefone_24h");
    expect(evoSendSpy).not.toHaveBeenCalled();
    expect(leadUpdatedWithBlockedReason).toBe("limite_telefone_24h");
  });

  // --------------------------------------------------------------------------
  // k) sdr_whatsapp_numbers vazio: registra no log que não há destino
  // --------------------------------------------------------------------------
  it("k) sdr_whatsapp_numbers vazio: registra expressamente no log que não há destino", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const evoSendSpy = vi.spyOn(evolutionModule, "sendTextMessageViaEvolution").mockResolvedValue({ success: true });

    const prevAdminEnv = process.env.ADMIN_ALERT_PHONE;
    delete process.env.ADMIN_ALERT_PHONE;

    const mockPool = {
      query: vi.fn(async (sql) => {
        if (sql.includes("lead_client_n8n_settings")) {
          // No vexo-adm este campo está vazio
          return { rows: [{ sdr_whatsapp_numbers: [], sdr_whatsapp_number: null }] };
        }
        return { rows: [] };
      }),
    };

    const res = await notifyOwnerOnCapture(mockPool, {
      clientId: "vexo-adm",
      alertText: "Alerta de lead",
    });

    if (prevAdminEnv) process.env.ADMIN_ALERT_PHONE = prevAdminEnv;

    expect(res.alerted).toBe(false);
    expect(res.reason).toBe("SEM_DESTINO");
    expect(evoSendSpy).not.toHaveBeenCalled();

    // Deve registrar explicitamente no log que não havia destino
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[leadCapture] Alerta ao dono NÃO enviado para o tenant "vexo-adm": nenhum número de SDR/Closer cadastrado')
    );
  });

  // --------------------------------------------------------------------------
  // MUTAÇÃO: teto em memória em vez de no banco -> morre (i) quando simulado com dois processos
  // --------------------------------------------------------------------------
  it("MUTAÇÃO: teto em memória morre com dois processos; teto no BANCO impede envio indevido na 51ª captura", async () => {
    resetLeadCaptureDispatchesTableEnsured();

    const evoSendSpy = vi.spyOn(evolutionModule, "sendTextMessageViaEvolution").mockResolvedValue({ success: true });

    // Simulador de Banco Compartilhado Postgres entre 2 processos Node (Cluster / PM2 / Deploy)
    const sharedDatabaseDispatches = [];
    for (let i = 0; i < 50; i++) {
      sharedDatabaseDispatches.push({
        id: `disp-${i}`,
        client_id: "vexo-adm",
        phone: `55349917512${i.toString().padStart(2, "0")}`,
        created_at: new Date(),
      });
    }

    const sharedPool = {
      query: vi.fn(async (sql, params) => {
        if (sql.includes("COUNT(*)::int") && sql.includes("phone = $2")) {
          const [tenant, phone] = params;
          const count = sharedDatabaseDispatches.filter((d) => d.client_id === tenant && d.phone === phone).length;
          return { rows: [{ count }] };
        }
        if (sql.includes("COUNT(*)::int") && sql.includes("client_id = $1")) {
          const tenant = params[0];
          const count = sharedDatabaseDispatches.filter((d) => d.client_id === tenant).length;
          return { rows: [{ count }] };
        }
        if (sql.includes("UPDATE public.leads")) {
          return { rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    // Cenário:
    // O Processo 1 atendeu 30 envios.
    // O Processo 2 atendeu 20 envios.
    // Total real no Banco: 50 envios.
    // Se a trava fosse em memória por processo:
    // Processo 1 teria count = 30 (< 50).
    // Processo 2 teria count = 20 (< 50).
    // Ambos autorizariam envios indevidos!
    const memoryCounterProcess1 = { "vexo-adm": 30 };
    const memoryWouldAllow = (memoryCounterProcess1["vexo-adm"] || 0) < 50;
    expect(memoryWouldAllow).toBe(true); // Prova da falha da trava em memória!

    // Agora testamos nossa implementação no BANCO através do Processo 1:
    const dispatchResult = await dispatchCaptureAutoReply(sharedPool, {
      clientId: "vexo-adm",
      phone: "5534999999999",
      messageText: "51º envio do dia",
    });

    // O banco identifica os 50 registros somados dos dois processos e BLOQUEIA!
    expect(dispatchResult.sent).toBe(false);
    expect(dispatchResult.blocked).toBe(true);
    expect(dispatchResult.reason).toBe("teto_diario_tenant_atingido");
    expect(evoSendSpy).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // l) BLOQUEIO A: normaliza telefone com a mesma função do upsert e avisa se rowCount === 0
  // --------------------------------------------------------------------------
  it("l) BLOQUEIO A: dispatchCaptureAutoReply normaliza telefone antes do UPDATE e emite warn se rowCount for 0", async () => {
    resetLeadCaptureDispatchesTableEnsured();

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    let updateSqlReceived = null;
    let updateParamsReceived = null;

    const mockPool = {
      query: vi.fn(async (sql, params) => {
        if (sql.includes("COUNT(*)::int") && (sql.includes("phone = $2") || sql.includes("phone = $3"))) {
          // Bloqueia por cota de telefone
          return { rows: [{ count: 5 }] };
        }
        if (sql.includes("UPDATE public.leads")) {
          updateSqlReceived = sql;
          updateParamsReceived = params;
          // Simula que nenhum lead casou (rowCount = 0) para testar o aviso explícito
          return { rowCount: 0 };
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    // Telefone cru formatado pelo usuário (com +, parênteses, espaço e hífen)
    const rawPhone = "+55 (34) 99781-7660";
    const expectedNormalized = "5534997817660";

    const res = await dispatchCaptureAutoReply(mockPool, {
      clientId: "vexo-adm",
      phone: rawPhone,
      messageText: "Oi!",
    });

    expect(res.blocked).toBe(true);
    expect(res.reason).toBe("limite_telefone_24h");

    // 1. O UPDATE precisa ter sido chamado com o telefone NORMALIZADO, não o cru
    expect(updateSqlReceived).toContain("UPDATE public.leads");
    expect(updateParamsReceived).toEqual([
      "limite_telefone_24h",
      "vexo-adm",
      expectedNormalized,
      `+${expectedNormalized}`,
    ]);

    // 2. Com rowCount = 0, NÃO engole silenciosamente: emite console.warn
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        `[leadCapture] Nenhum lead encontrado para registrar whatsapp_dispatch_blocked_reason="limite_telefone_24h" (telefone: ${expectedNormalized}, tenant: vexo-adm)`
      )
    );

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("l2) BLOQUEIO A: dispatchCaptureAutoReply normaliza telefone ao registrar sem_chip_configurado", async () => {
    resetLeadCaptureDispatchesTableEnsured();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    let updateParamsReceived = null;
    const mockPool = {
      query: vi.fn(async (sql, params) => {
        if (sql.includes("COUNT(*)::int")) return { rows: [{ count: 0 }] };
        if (sql.includes("lead_client_evolution_instances")) return { rows: [] };
        if (sql.includes("UPDATE public.leads")) {
          updateParamsReceived = params;
          return { rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    const rawPhone = "(11) 98765-4321";
    const expectedNormalized = "11987654321";

    const res = await dispatchCaptureAutoReply(mockPool, {
      clientId: "tenant-sem-chip",
      phone: rawPhone,
      messageText: "Oi!",
    });

    expect(res.sent).toBe(false);
    expect(res.reason).toBe("SEM_CHIP_CONFIGURADO");
    expect(updateParamsReceived).toEqual([
      "tenant-sem-chip",
      expectedNormalized,
      `+${expectedNormalized}`,
    ]);

    warnSpy.mockRestore();
  });

  // --------------------------------------------------------------------------
  // m) BLOQUEIO B: bloqueio de cota loga com console.error, prefixo [leadCapture], motivo e telefone mascarado
  // --------------------------------------------------------------------------
  it("m) BLOQUEIO B: bloqueio de cota é registrado em console.error com prefixo [leadCapture], motivo e telefone mascarado", async () => {
    resetLeadCaptureDispatchesTableEnsured();

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const mockPool = {
      query: vi.fn(async (sql) => {
        if (sql.includes("COUNT(*)::int") && (sql.includes("phone = $2") || sql.includes("phone = $3"))) {
          return { rows: [{ count: 5 }] };
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    const phone = "5534997817660";
    await dispatchCaptureAutoReply(mockPool, {
      clientId: "vexo-adm",
      phone,
      messageText: "Oi!",
    });

    // Deve ter chamado console.error (NÃO apenas warn)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /\[leadCapture\] Disparo de WhatsApp BLOQUEADO para \*{4,9}7660 no tenant "vexo-adm": .*\(limite_telefone_24h\)/
      )
    );

    errorSpy.mockRestore();
  });
});
