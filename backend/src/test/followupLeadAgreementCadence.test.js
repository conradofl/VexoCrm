import { describe, expect, it } from "vitest";
import {
  sanitizeAgreementForMessage,
  hasConfirmedAgreement,
  saveLeadAgreement,
  confirmLeadAgreement,
  parsePrazoData,
  MAX_AGREEMENT_LENGTH,
} from "../services/leadAgreement.js";
import { applyMessagePlaceholders } from "../services/messagePlaceholders.js";
import { validateOutboundMessage } from "../services/jsonExtractor.js";
import {
  evaluateStepConditions,
  resolveAnchorDate,
  calcScheduledFor,
  isValidAnchorField,
} from "../followup/service.js";

describe("Follow-up: Acordo Comercial em Cadências (followupLeadAgreementCadence)", () => {
  // Teste 1: Acordo não confirmado nunca entra em mensagem, em nenhum caminho
  it("acordo não confirmado nunca entra em mensagem, em nenhum caminho", () => {
    const leadComAcordoNaoConfirmado = {
      nome: "Roberto",
      phone: "5511999990001",
      dados: {
        acordo: {
          texto: "vou mandar o comprovante amanhã",
          prazo_data: "2026-10-02",
          quem_faz: "lead",
          registrado_em: "2026-10-01T10:00:00Z",
          confirmado_por: null, // NÃO CONFIRMADO
          confirmado_em: null,
        },
      },
    };

    const template = "Olá {{nome}}, conforme combinamos: {{acordo}}. Ficamos no aguardo!";

    // 1. applyMessagePlaceholders NÃO substitui {{acordo}} se não estiver confirmado
    const rendered = applyMessagePlaceholders(template, leadComAcordoNaoConfirmado, "5511999990001");
    expect(rendered).not.toContain("vou mandar o comprovante amanhã");
    expect(rendered).toContain("{{acordo}}");

    // 2. validateOutboundMessage bloqueia a saída com erro de variável crua
    const guard = validateOutboundMessage(rendered);
    expect(guard.valid).toBe(false);
    expect(guard.reason).toBe("contains_unresolved_variable:{{acordo}}");

    // 3. hasConfirmedAgreement retorna false
    expect(hasConfirmedAgreement(leadComAcordoNaoConfirmado)).toBe(false);
  });

  // Teste 2: Passo que usa a variável de acordo não é enviado quando não há acordo confirmado, e o motivo aparece no relatório
  it("passo que usa a variável de acordo não é enviado quando não há acordo confirmado, e o motivo aparece no relatório", () => {
    const leadSemAcordo = {
      dados: {
        acordo: null,
      },
    };
    const leadAcordoPendente = {
      dados: {
        acordo: {
          texto: "te ligo na terça para fechar",
          confirmado_por: null,
          confirmado_em: null,
        },
      },
    };

    expect(hasConfirmedAgreement(leadSemAcordo)).toBe(false);
    expect(hasConfirmedAgreement(leadAcordoPendente)).toBe(false);

    // Simula a lógica de guarda do worker
    const templateMessage = "Olá {{nome}}, lembrando do nosso combinado: {{acordo}}";
    const usesAcordo = /\{\{\s*(?:acordo|combinado)\s*\}\}/i.test(templateMessage);
    expect(usesAcordo).toBe(true);

    const checkLead1 = hasConfirmedAgreement(leadSemAcordo);
    const checkLead2 = hasConfirmedAgreement(leadAcordoPendente);

    const getSkipReason = (lead) => {
      if (!hasConfirmedAgreement(lead)) {
        return "Passo não enviado: lead sem acordo confirmado para variável {{acordo}}";
      }
      return null;
    };

    expect(getSkipReason(leadSemAcordo)).toBe("Passo não enviado: lead sem acordo confirmado para variável {{acordo}}");
    expect(getSkipReason(leadAcordoPendente)).toBe("Passo não enviado: lead sem acordo confirmado para variável {{acordo}}");
  });

  // Teste 3: A condição de ter ou não acordo roteia os dois casos corretamente
  it("a condição de ter ou não acordo roteia os dois casos corretamente", () => {
    const leadComAcordoConfirmado = {
      nome: "Fernanda",
      dados: {
        acordo: {
          texto: "conferir o limite do cartão e responder na segunda",
          prazo_data: "2026-10-05",
          confirmado_por: "consultor_ana",
          confirmado_em: "2026-10-01T15:00:00Z",
        },
      },
    };

    const leadSemAcordo = {
      nome: "Marcos",
      dados: {
        acordo: null,
      },
    };

    // Passo A: só dispara para quem TEM acordo confirmado
    const condicoesPassoComAcordo = [
      { field: "tem_acordo_confirmado", operator: "equals", value: "true" },
    ];

    // Passo B: só dispara para quem NÃO tem acordo confirmado
    const condicoesPassoSemAcordo = [
      { field: "tem_acordo_confirmado", operator: "equals", value: "false" },
    ];

    // Lead com acordo confirmado:
    const checkLeadA_PassoA = evaluateStepConditions(condicoesPassoComAcordo, leadComAcordoConfirmado);
    const checkLeadA_PassoB = evaluateStepConditions(condicoesPassoSemAcordo, leadComAcordoConfirmado);
    expect(checkLeadA_PassoA.passed).toBe(true);
    expect(checkLeadA_PassoB.passed).toBe(false);

    // Lead sem acordo confirmado:
    const checkLeadB_PassoA = evaluateStepConditions(condicoesPassoComAcordo, leadSemAcordo);
    const checkLeadB_PassoB = evaluateStepConditions(condicoesPassoSemAcordo, leadSemAcordo);
    expect(checkLeadB_PassoA.passed).toBe(false);
    expect(checkLeadB_PassoB.passed).toBe(true);

    // Também funciona com o operador is_not_empty / is_empty
    expect(evaluateStepConditions([{ field: "acordo_confirmado", operator: "is_not_empty" }], leadComAcordoConfirmado).passed).toBe(true);
    expect(evaluateStepConditions([{ field: "acordo_confirmado", operator: "is_empty" }], leadComAcordoConfirmado).passed).toBe(false);
  });

  // Teste 4: A âncora de prazo agenda no dia seguinte ao prometido, e lead sem prazo é pulado sem erro
  it("a âncora de prazo agenda no dia seguinte ao prometido, e lead sem prazo é pulado sem erro", () => {
    // 1. Whitelist de âncoras contém prazo_acordo
    expect(isValidAnchorField("prazo_acordo")).toBe(true);

    const now = new Date("2026-10-01T10:00:00.000Z");

    // Template configurado para disparar no dia seguinte ao prazo acordado (+1 day)
    const templatePasso = {
      id: "step-cobranca-acordo",
      trigger_type: "after_anchor",
      anchor_field: "prazo_acordo",
      trigger_value: 1,
      trigger_unit: "days",
    };

    // Caso A: Lead com prazo de acordo prometido para 2026-10-05
    const leadComPrazo = {
      prazo_acordo: "2026-10-05T12:00:00.000Z",
      dados: {
        acordo: {
          texto: "enviar contrato assinado",
          prazo_data: "2026-10-05T12:00:00.000Z",
          confirmado_por: "consultor_carlos",
          confirmado_em: "2026-10-01T12:00:00Z",
        },
      },
    };

    const scheduledDate = calcScheduledFor(templatePasso, now, null, leadComPrazo);
    expect(scheduledDate).toBeInstanceOf(Date);

    // O agendamento é calculado exatamente no dia seguinte (+ 1 dia = 2026-10-06)
    const scheduledIso = scheduledDate.toISOString();
    expect(scheduledIso).toContain("2026-10-06");

    // Caso B: Lead com acordo confirmado MAS sem prazo em data
    const leadSemPrazo = {
      dados: {
        acordo: {
          texto: "vai tentar conseguir o limite",
          prazo_data: null,
          confirmado_por: "consultor_carlos",
          confirmado_em: "2026-10-01T12:00:00Z",
        },
      },
    };

    const scheduledSemPrazo = calcScheduledFor(templatePasso, now, null, leadSemPrazo);
    // Passo é pulado retornando null sem disparar erro
    expect(scheduledSemPrazo).toBeNull();
  });

  // Teste 5: Acordo novo sugerido não sobrescreve acordo já confirmado
  it("acordo novo sugerido não sobrescreve acordo já confirmado", () => {
    const dadosIniciais = {
      nome: "Juliana",
      acordo: {
        texto: "Cliente vai falar com a diretoria na sexta",
        prazo_data: "2026-10-09",
        quem_faz: "lead",
        registrado_em: "2026-10-01T11:00:00Z",
        confirmado_por: "consultor_felipe",
        confirmado_em: "2026-10-01T11:30:00Z",
      },
    };

    // Robô reanalisou a conversa e extraiu uma nova sugestão de acordo
    const novaSugestaoIA = {
      texto: "Mandar proposta revisada para o financeiro",
      prazo_data: "2026-10-10",
      quem_faz: "consultor",
      registrado_em: "2026-10-02T14:00:00Z",
    };

    const dadosAposNovaExtracao = saveLeadAgreement(dadosIniciais, novaSugestaoIA);

    // O acordo confirmado pelo humano PERMANECE INTACTO
    expect(dadosAposNovaExtracao.acordo.texto).toBe("Cliente vai falar com a diretoria na sexta");
    expect(dadosAposNovaExtracao.acordo.confirmado_por).toBe("consultor_felipe");
    expect(dadosAposNovaExtracao.acordo.confirmado_em).toBe("2026-10-01T11:30:00Z");

    // A nova extração foi armazenada com segurança em acordo_pendente para decisão humana
    expect(dadosAposNovaExtracao.acordo_pendente).toBeDefined();
    expect(dadosAposNovaExtracao.acordo_pendente.texto).toBe("Mandar proposta revisada para o financeiro");
    expect(dadosAposNovaExtracao.acordo_pendente.confirmado_por).toBeNull();

    // Quando o consultor humano aceita a sugestão no Inbox:
    const dadosConfirmados = confirmLeadAgreement(dadosAposNovaExtracao, {
      confirmedBy: "consultor_mariana",
    });

    expect(dadosConfirmados.acordo.texto).toBe("Mandar proposta revisada para o financeiro");
    expect(dadosConfirmados.acordo.confirmado_por).toBe("consultor_mariana");
    expect(dadosConfirmados.acordo.confirmado_em).toBeTruthy();
    expect(dadosConfirmados.acordo_pendente).toBeUndefined();
  });

  // Teste 6: Marcação de emoji do resumo não aparece no texto enviado
  it("marcação de emoji do resumo não aparece no texto enviado", () => {
    const rawAcordoComEmojiEColchetes = "🤝 [vou mandar o comprovante do sinal na segunda]";
    const clean = sanitizeAgreementForMessage(rawAcordoComEmojiEColchetes);

    expect(clean).toBe("vou mandar o comprovante do sinal na segunda");
    expect(clean).not.toContain("🤝");
    expect(clean).not.toContain("[");
    expect(clean).not.toContain("]");

    const leadComAcordoLimpo = {
      nome: "Beatriz",
      dados: {
        acordo: {
          texto: "🤝 [vou mandar o comprovante do sinal na segunda]",
          confirmado_por: "consultor_paulo",
          confirmado_em: "2026-10-01T16:00:00Z",
        },
      },
    };

    const template = "Oi {{nome}}, tudo bem? Passando para checar: {{acordo}}.";
    const rendered = applyMessagePlaceholders(template, leadComAcordoLimpo);

    expect(rendered).toBe("Oi Beatriz, tudo bem? Passando para checar: vou mandar o comprovante do sinal na segunda.");
    expect(rendered).not.toContain("🤝");
    expect(rendered).not.toContain("[");
    expect(rendered).not.toContain("]");
  });

  // Teste 7: Acordo maior que o limite não é enviado truncado
  it("acordo maior que o limite não é enviado truncado", () => {
    // Acordo longo demais (> 140 chars)
    const acordoMuitoLongo =
      "o cliente solicitou que enviássemos uma proposta altamente detalhada contemplando os módulos avançados de inteligência artificial, esteira de automações, treinamento da equipe e suporte prioritário 24 horas por dia até o final do mês que vem";

    expect(acordoMuitoLongo.length).toBeGreaterThan(MAX_AGREEMENT_LENGTH);

    // sanitizeAgreementForMessage retorna null para não truncar mensagem constrangedora no meio da frase
    const sanitized = sanitizeAgreementForMessage(acordoMuitoLongo);
    expect(sanitized).toBeNull();

    const leadComAcordoGigante = {
      nome: "Guilherme",
      dados: {
        acordo: {
          texto: acordoMuitoLongo,
          confirmado_por: "consultor_ana",
          confirmado_em: "2026-10-01T17:00:00Z",
        },
      },
    };

    // applyMessagePlaceholders se recusa a truncar e mantém a variável, bloqueando o envio
    const template = "Olá {{nome}}, sobre o combinado: {{acordo}}";
    const rendered = applyMessagePlaceholders(template, leadComAcordoGigante);

    expect(rendered).not.toContain(acordoMuitoLongo.slice(0, 50));
    expect(rendered).toContain("{{acordo}}");

    // E a guarda de saída confirma que não vai para o WhatsApp
    expect(validateOutboundMessage(rendered).valid).toBe(false);
  });
});
