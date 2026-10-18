import { describe, it, expect, beforeEach, vi } from "vitest";
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
  DAILY_CAPTURE_DISPATCH_LIMIT_PER_TENANT,
  MAX_CAPTURE_DISPATCH_PER_PHONE_24H,
} from "../services/leadCapture.js";
import * as evolutionModule from "../services/evolution.js";
import * as leadUpsertModule from "../services/leadUpsert.js";

describe("Serviço de Captura de Leads e Diagnóstico Comercial", () => {
  beforeEach(() => {
    resetCaptureRateLimit();
    resetLeadCaptureDispatchesTableEnsured();
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
  // a) Gravação do Lead no Banco com Multi-tenant e tag 'diagnostico-site'
  // --------------------------------------------------------------------------
  it("a) formulário enviado cria o lead no Banco do tenant com tag 'diagnostico-site'", async () => {
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
    expect(calledFields.email).toBe("conrado@vexo.com.br");

    // Verifica que gravou notificação in-app no CRM
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO public.notifications"),
      expect.arrayContaining(["vexo-adm", expect.stringContaining("Conrado Finzi")])
    );
  });

  // --------------------------------------------------------------------------
  // b) A mensagem personalizada chega no WhatsApp do visitante
  // --------------------------------------------------------------------------
  it("b) formata mensagem de demonstração contendo os dados reais do visitante", () => {
    const msg = formatVisitorDiagnosticMessage({
      fullName: "Carlos Eduardo Finzi",
      baseSize: "10.000 contatos",
      responseTime: "30 minutos",
    });

    expect(msg).toContain("Oi Carlos! Aqui é a Vexo 👋");
    expect(msg).toContain("10.000 contatos");
    expect(msg).toContain("30 minutos");
    expect(msg).toContain("ponto onde a maioria das empresas perde venda");
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
  // j) mesmo telefone pela 3ª vez em 24h: salvo, não dispara
  // --------------------------------------------------------------------------
  it("j) mesmo telefone pela 3ª vez em 24h: salvo, não dispara", async () => {
    resetLeadCaptureDispatchesTableEnsured();

    const upsertSpy = vi.spyOn(leadUpsertModule, "upsertLeadByPhone").mockResolvedValue("updated");
    const evoSendSpy = vi.spyOn(evolutionModule, "sendTextMessageViaEvolution").mockResolvedValue({ success: true });

    let leadUpdatedWithBlockedReason = null;

    const mockPool = {
      query: vi.fn(async (sql, params) => {
        // Checagem de telefone em 24h: já teve 2 envios anteriores para este mesmo número!
        if (sql.includes("COUNT(*)::int") && sql.includes("phone = $2")) {
          return { rows: [{ count: 2 }] };
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

    // 1. Salva o lead pela 3ª vez (atualiza lead existente)
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
});
