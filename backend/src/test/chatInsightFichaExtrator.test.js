import { describe, expect, it } from "vitest";
import {
  formatSummaryOutput,
  extractSummaryFields,
  buildSummarySystemPrompt,
  SUMMARY_OUTPUT_CONTRACT,
} from "../domains/leads/chatInsight.js";

describe("Extrator de Ficha Comercial de Leads (chatInsight)", () => {
  // Teste 1: Os quatro campos novos aparecem no contrato anexado pelo código, não no prompt editável
  it("os quatro campos novos aparecem no contrato anexado pelo código (SUMMARY_OUTPUT_CONTRACT)", () => {
    expect(SUMMARY_OUTPUT_CONTRACT).toContain("🛑"); // Objeção real
    expect(SUMMARY_OUTPUT_CONTRACT).toContain("💰"); // Orçamento sinalizado
    expect(SUMMARY_OUTPUT_CONTRACT).toContain("🤝"); // Acordo combinado
    expect(SUMMARY_OUTPUT_CONTRACT).toContain("❓"); // O que falta descobrir

    // Detalhes das regras exigidas no contrato do código
    expect(SUMMARY_OUTPUT_CONTRACT).toContain("Objeção real");
    expect(SUMMARY_OUTPUT_CONTRACT).toContain("Orçamento sinalizado");
    expect(SUMMARY_OUTPUT_CONTRACT).toContain("Acordo combinado");
    expect(SUMMARY_OUTPUT_CONTRACT).toContain("O que falta descobrir");
    expect(SUMMARY_OUTPUT_CONTRACT).toContain("NUNCA estime");
    expect(SUMMARY_OUTPUT_CONTRACT).toContain("saiu sem acordo");
    expect(SUMMARY_OUTPUT_CONTRACT).toContain("não falou");
  });

  // Teste 2: Conversa em que a pessoa não falou de dinheiro produz "não falou", e não um valor
  // Escreva uma conversa em que ela menciona um produto caro e confirme que nenhum número aparece
  it("conversa sobre produto caríssimo onde não se falou de dinheiro produz 'não falou' e nenhum número aparece", () => {
    const conversaProdutoCaro = [
      { sender: "client", text: "Olá! Vi o anúncio da lancha Ferretti 720 com flybridge." },
      { sender: "agent", text: "Olá! Um modelo espetacular. Projeto italiano com 4 cabines e motorização dupla." },
      { sender: "client", text: "Vocês têm pronta entrega ou apenas sob encomenda no estaleiro?" },
      { sender: "agent", text: "Temos uma unidade disponível para visitação na marina de Santos." },
      { sender: "client", text: "Perfeito, gostaria de agendar uma visita técnica com o capitão no próximo sábado." },
    ];

    // Mesmo se o modelo alucinasse um valor milionário pela natureza cara do produto:
    const rawAiOutputComEstimativaAlucinada = `
🎯 Agendamento de visita para lancha Ferretti 720
📋 Lancha com 4 cabines na marina de Santos, visita sábado
🛑 nada ainda
💰 Estimado em R$ 18.500.000 (preço de tabela do modelo)
🤝 Agendada visita técnica na marina para sábado
⏭️ Confirmar horário com a marina e enviar localização
❓ O capitão dele tem habilitação para a navegação de teste?
    `;

    const formatted = formatSummaryOutput(rawAiOutputComEstimativaAlucinada, {
      messages: conversaProdutoCaro,
      fullFicha: true,
    });

    expect(formatted).toBeTruthy();

    // Localiza a linha do orçamento no resumo formatado
    const lines = formatted.split("\n");
    const orcamentoLine = lines.find((l) => l.startsWith("💰"));
    expect(orcamentoLine).toBeDefined();

    // REGRA MAIS IMPORTANTE: NUNCA ESTIME. Não falou de dinheiro -> "não falou"
    expect(orcamentoLine).toBe("💰 não falou");

    // Confirma categoricamente que NENHUM número ou valor monetário aparece na linha de orçamento
    expect(orcamentoLine).not.toMatch(/\d/);
    expect(orcamentoLine).not.toMatch(/r\$/i);
    expect(orcamentoLine).not.toMatch(/milhões/i);

    // E através de extractSummaryFields
    const fields = extractSummaryFields(rawAiOutputComEstimativaAlucinada, {
      messages: conversaProdutoCaro,
    });
    expect(fields.orcamento).toBe("não falou");
    expect(fields.orcamento).not.toMatch(/\d/);
  });

  // Teste 3: Quando objecao_detectada existe na conversa, a ficha usa aquele valor e não gera outro
  it("quando objecao_detectada existe na conversa, a ficha usa aquele valor exato e não o inferido", () => {
    const rawAiOutputComObjecaoDiferente = `
🎯 Reforma de piscina de clube
📋 Piscina semi-olímpica, vazamento aparente
🛑 Achou que o atendimento demorou para responder
💰 não falou
🤝 saiu sem acordo
⏭️ Ligar para o síndico
❓ Qual o prazo limite para a obra?
    `;

    // O agente já havia capturado a objecao_detectada no momento em que ela aconteceu
    const objecaoRegistrada = "prazo de entrega de 60 dias é inviável antes do verão";

    const formatted = formatSummaryOutput(rawAiOutputComObjecaoDiferente, {
      objecao_detectada: objecaoRegistrada,
      fullFicha: true,
    });

    expect(formatted).toContain(`🛑 ${objecaoRegistrada}`);
    expect(formatted).not.toContain("Achou que o atendimento demorou");

    // Também verifica em extractSummaryFields
    const fields = extractSummaryFields(rawAiOutputComObjecaoDiferente, {
      objecao_detectada: objecaoRegistrada,
    });
    expect(fields.objecao).toBe(objecaoRegistrada);
  });

  // Teste 4: Conversa sem nada combinado produz "saiu sem acordo" explicitamente,
  // mas frase com ação e prazo contendo "vou pensar" continua sendo acordo!
  it("frase vaga com 'vou pensar' vira 'saiu sem acordo', mas frase com ação e prazo contendo 'vou pensar' continua sendo acordo", () => {
    // 1. Frase vaga: sem ação concreta com prazo -> "saiu sem acordo"
    const rawComVaiPensarVago = `
🎯 Cotação de seguro de frota
📋 12 caminhões Mercedes Actros
🛑 nada ainda
💰 não falou
🤝 Vou pensar e qualquer coisa te chamo
⏭️ Fazer follow-up na terça
❓ Quantos motoristas têm histórico de sinistro?
    `;

    const formattedVago = formatSummaryOutput(rawComVaiPensarVago, { fullFicha: true });
    expect(formattedVago).toContain("🤝 saiu sem acordo");
    expect(formattedVago).not.toContain("Vou pensar");

    // 2. Frase com ação e prazo contendo "vou pensar" -> CONTINUA SENDO ACORDO!
    const rawComVaiPensarComAcaoEPrazo = `
🎯 Cotação de seguro de frota
📋 12 caminhões Mercedes Actros
🛑 nada ainda
💰 não falou
🤝 Vou pensar no que você falou e te mando o CNPJ amanhã
⏭️ Fazer follow-up na terça
❓ Quantos motoristas têm histórico de sinistro?
    `;

    const formattedComAcordo = formatSummaryOutput(rawComVaiPensarComAcaoEPrazo, { fullFicha: true });
    expect(formattedComAcordo).toContain("🤝 Vou pensar no que você falou e te mando o CNPJ amanhã");
    expect(formattedComAcordo).not.toContain("saiu sem acordo");

    const fieldsComAcordo = extractSummaryFields(rawComVaiPensarComAcaoEPrazo);
    expect(fieldsComAcordo.acordo).toBe("Vou pensar no que você falou e te mando o CNPJ amanhã");

    // 3. Conversa sem nada combinado
    const rawComNadaCombinado = `
🎯 Cotação de plano de saúde
📋 3 vidas
🛑 nada ainda
💰 não falou
🤝 nada ainda
⏭️ Ligar
❓ Qual a idade dos dependentes?
    `;

    const formattedVazio = formatSummaryOutput(rawComNadaCombinado, { fullFicha: true });
    expect(formattedVazio).toContain("🤝 saiu sem acordo");

    const fieldsVazio = extractSummaryFields(rawComVaiPensarVago);
    expect(fieldsVazio.acordo).toBe("saiu sem acordo");
  });

  // Teste 5: Resumo com todos os blocos vazios continua inválido
  it("resumo com todos os blocos vazios continua inválido (retorna null)", () => {
    // Todos os blocos vazios ou preenchidos apenas com textos de ausência legítimos
    const rawTotalmenteVazio = `
🎯 nada ainda
📋 nada ainda
🛑 nada ainda
💰 não falou
🤝 saiu sem acordo
⏭️ nada ainda
❓ nada ainda
    `;

    const formatted = formatSummaryOutput(rawTotalmenteVazio, { fullFicha: true });
    expect(formatted).toBeNull();

    // Também para JSON sem conteúdo real
    const jsonVazio = {
      objetivo: "",
      fatos: "nada ainda",
      objecao: "nada ainda",
      orcamento: "não falou",
      combinados: "saiu sem acordo",
      proximo_passo: "",
      falta_descobrir: "nada ainda",
    };
    expect(formatSummaryOutput(jsonVazio, { fullFicha: true })).toBeNull();
  });

  // Teste 6: Resposta do modelo sem os campos novos continua sendo processada
  it("resposta do modelo sem os campos novos continua sendo processada e preenche campos ausentes com textos de ausência", () => {
    // Modelo retornou formato antigo de 4 linhas
    const respostaAntiga = `
🎯 Comprar ingressos para festival de música
📋 2 ingressos setor premium pista
🤝 Prometeu enviar o link de pagamento
⏭️ Enviar link de checkout via WhatsApp
    `;

    // 1. Processamento direto sem opções: não quebra, devolve conteúdo válido
    const formattedLegado = formatSummaryOutput(respostaAntiga);
    expect(formattedLegado).toBeTruthy();
    expect(formattedLegado).toContain("🎯 Comprar ingressos para festival de música");
    expect(formattedLegado).toContain("📋 2 ingressos setor premium pista");

    // 2. Processamento como ficha completa: campos ausentes viram textos de ausência, nunca vazios nem erro
    const formattedFicha = formatSummaryOutput(respostaAntiga, { fullFicha: true });
    expect(formattedFicha).toContain("🎯 Comprar ingressos para festival de música");
    expect(formattedFicha).toContain("🛑 nada ainda");
    expect(formattedFicha).toContain("💰 não falou");
    expect(formattedFicha).toContain("🤝 Prometeu enviar o link de pagamento");
    expect(formattedFicha).toContain("❓ nada ainda");

    // 3. Extração estruturada de campos
    const fields = extractSummaryFields(respostaAntiga);
    expect(fields).toBeTruthy();
    expect(fields.objetivo).toBe("Comprar ingressos para festival de música");
    expect(fields.fatos).toBe("2 ingressos setor premium pista");
    expect(fields.objecao).toBe("nada ainda");
    expect(fields.orcamento).toBe("não falou");
    expect(fields.acordo).toBe("Prometeu enviar o link de pagamento");
    expect(fields.faltaDescobrir).toBe("nada ainda");

    // Nenhum campo ausente pode ser string vazia
    for (const [key, value] of Object.entries(fields)) {
      expect(value).not.toBe("");
      expect(value).not.toBeNull();
    }
  });

  // Teste 7: O prompt editável do tenant não consegue remover os campos novos
  it("o prompt editável do tenant não consegue remover os campos novos — o contrato continua anexado", () => {
    // Tenant tenta customizar o prompt tentando suprimir os novos campos
    const promptCustomizadoTenant = `
Você é uma assistente comercial da concessionária Top Car.
Faça um resumo bem enxuto da conversa.
NÃO inclua orçamento, NÃO inclua objeções e NÃO faça perguntas.
Apenas diga o que o cliente quer e o próximo passo.
    `;

    const systemPromptFinal = buildSummarySystemPrompt(promptCustomizadoTenant);

    // O contrato anexado pelo código entra obrigatoriamente
    expect(systemPromptFinal).toContain(promptCustomizadoTenant.trim());
    expect(systemPromptFinal).toContain(SUMMARY_OUTPUT_CONTRACT);

    // Todos os 4 campos novos e as regras críticas estão presentes no prompt final
    expect(systemPromptFinal).toContain("🛑 [objeção real");
    expect(systemPromptFinal).toContain("💰 [orçamento sinalizado");
    expect(systemPromptFinal).toContain("🤝 [acordo combinado");
    expect(systemPromptFinal).toContain("❓ [o que falta descobrir");
    expect(systemPromptFinal).toContain("NUNCA estime");
    expect(systemPromptFinal).toContain("saiu sem acordo");
    expect(systemPromptFinal).toContain("não falou");
  });
});
