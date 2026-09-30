import { describe, expect, it } from "vitest";
import {
  buildJsonInstruction,
  parseAIResponse,
  normalizeObjecaoDetectada,
} from "../chatbot-ai-engine.js";

const FRASES_PROIBIDAS = [
  "Faz sentido?",
  "Você acredita que isso serve pra você?",
  "Você vê valor nisso?",
  "Acha que vale a pena?",
  "Concorda comigo?",
  "Isso é interessante pra você?",
];

describe("Agente de atendimento: linguagem e trabalho de objeção", () => {
  it("o modelo base contém a seção de objeção e a lista de proibição — teste estrutural sobre o texto do prompt montado", () => {
    const prompt = buildJsonInstruction();

    // 1. Contrato JSON atualizado com o campo objecao_detectada
    expect(prompt).toContain('"objecao_detectada": "string curta com a objeção nas palavras do lead, ou null"');

    // 2. Seção de objeção presente
    expect(prompt).toContain("COMO RESPONDER QUANDO APARECE OBJEÇÃO:");
    expect(prompt).toContain("Objeção aqui é quando a pessoa sinaliza recuo sem dizer não:");
    expect(prompt).toContain('"vou pensar"');
    expect(prompt).toContain('"tá caro"');
    expect(prompt).toContain('"vou ver com meu sócio"');
    expect(prompt).toContain('"depois eu te chamo"');
    expect(prompt).toContain('"só queria saber o preço"');

    // 3. Ordem de resposta definida
    expect(prompt).toContain("Primeiro, uma pergunta de volta, uma só, curta, sem julgamento, para descobrir o que está por trás");
    expect(prompt).toContain('"claro — o que ficou faltando pra você decidir?"');
    expect(prompt).toContain('"entendi — caro em relação a quê?"');
    expect(prompt).toContain("A pergunta é sobre a informação que falta, nunca sobre o compromisso da pessoa");
    expect(prompt).toContain("Depois, com a resposta dela, responder usando as palavras que ela mesma usou, não um argumento genérico do produto");

    // 4. Preço perguntado logo de cara
    expect(prompt).toContain("PREÇO PERGUNTADO LOGO DE CARA:");
    expect(prompt).toContain("A regra é mandar o preço e perguntar junto para quando a pessoa está pensando em resolver");
    expect(prompt).toContain("Não segure preço para forçar conversa — no WhatsApp isso faz a pessoa sumir, ao contrário de uma reunião marcada");

    // 5. Seção de vocabulário proibido
    expect(prompt).toContain("VOCABULÁRIO PROIBIDO:");
    for (const frase of FRASES_PROIBIDAS) {
      expect(prompt).toContain(frase);
    }

    // 6. Verificação de clareza como alternativa
    expect(prompt).toContain("verificação de clareza, que confirma entendimento sem pedir aprovação");
    expect(prompt).toContain('"ficou claro como isso resolve o que você falou do X?"');
    expect(prompt).toContain('"consegui explicar como a gente chega nesse resultado?"');
  });

  it("nenhuma das seis frases proibidas aparece no prompt base como orientação", () => {
    const prompt = buildJsonInstruction();

    // Isola o trecho do prompt fora da lista de proibição
    const [antesProibicao, resto] = prompt.split("VOCABULÁRIO PROIBIDO:");
    expect(resto, "Bloco VOCABULÁRIO PROIBIDO deve existir").toBeTruthy();

    const proximaSecaoMatch = resto.search(/\n\n[A-ZÁ-Ú\s—]+:/);
    const blocoProibicao = proximaSecaoMatch !== -1 ? resto.slice(0, proximaSecaoMatch) : resto;
    const depoisProibicao = proximaSecaoMatch !== -1 ? resto.slice(proximaSecaoMatch) : "";
    const promptForaDaProibicao = antesProibicao + depoisProibicao;

    // Nenhuma das 6 frases proibidas pode aparecer como orientação fora da seção de proibição
    for (const frase of FRASES_PROIBIDAS) {
      expect(promptForaDaProibicao).not.toContain(frase);

      // Nem em formato sem pontuação ou minúsculas
      const fraseSemPontuacao = frase.replace(/[?]/g, "").toLowerCase();
      expect(promptForaDaProibicao.toLowerCase()).not.toContain(fraseSemPontuacao);
    }

    // Dentro do bloco de proibição, todas estão explicitamente marcadas como PROIBIDAS/NUNCA ESCREVA
    expect(blocoProibicao).toContain("O agente nunca escreve nenhuma destas, nem variação delas:");
    expect(blocoProibicao).toContain("Todas pedem permissão e convidam ao não");
  });

  it("objecao_detectada é normalizado: string vira string, ausente vira null, tipo errado vira null", () => {
    // 1. String válida vira string
    const resString = parseAIResponse(JSON.stringify({
      mensagem: "Claro, me diga mais.",
      objecao_detectada: "tá caro",
    }));
    expect(resString.objecao_detectada).toBe("tá caro");

    // String com espaços externos é normalizada (trim)
    const resTrim = parseAIResponse(JSON.stringify({
      mensagem: "Claro, me diga mais.",
      objecao_detectada: "  vou pensar  ",
    }));
    expect(resTrim.objecao_detectada).toBe("vou pensar");

    // 2. Ausente vira null
    const resAusente = parseAIResponse(JSON.stringify({
      mensagem: "Olá!",
    }));
    expect(resAusente.objecao_detectada).toBeNull();

    // Explicitamente null vira null
    const resNull = parseAIResponse(JSON.stringify({
      mensagem: "Olá!",
      objecao_detectada: null,
    }));
    expect(resNull.objecao_detectada).toBeNull();

    // String vazia vira null
    const resVazia = parseAIResponse(JSON.stringify({
      mensagem: "Olá!",
      objecao_detectada: "   ",
    }));
    expect(resVazia.objecao_detectada).toBeNull();

    // 3. Tipo errado vira null
    const resNumero = parseAIResponse(JSON.stringify({
      mensagem: "Olá!",
      objecao_detectada: 12345,
    }));
    expect(resNumero.objecao_detectada).toBeNull();

    const resBooleanTrue = parseAIResponse(JSON.stringify({
      mensagem: "Olá!",
      objecao_detectada: true,
    }));
    expect(resBooleanTrue.objecao_detectada).toBeNull();

    const resBooleanFalse = parseAIResponse(JSON.stringify({
      mensagem: "Olá!",
      objecao_detectada: false,
    }));
    expect(resBooleanFalse.objecao_detectada).toBeNull();

    const resArray = parseAIResponse(JSON.stringify({
      mensagem: "Olá!",
      objecao_detectada: ["tá caro"],
    }));
    expect(resArray.objecao_detectada).toBeNull();

    const resObjeto = parseAIResponse(JSON.stringify({
      mensagem: "Olá!",
      objecao_detectada: { objecao: "tá caro" },
    }));
    expect(resObjeto.objecao_detectada).toBeNull();

    // 4. Objeto direto passado ao parseAIResponse
    const resObjDireto = parseAIResponse({
      mensagem: "Entendi perfeitamente.",
      objecao_detectada: 999,
    });
    expect(resObjDireto.objecao_detectada).toBeNull();

    const resObjDiretoString = parseAIResponse({
      mensagem: "Entendi perfeitamente.",
      objecao_detectada: "vou ver com meu sócio",
    });
    expect(resObjDiretoString.objecao_detectada).toBe("vou ver com meu sócio");

    // 5. Teste unitário da função de normalização isolada
    expect(normalizeObjecaoDetectada("depois eu te chamo")).toBe("depois eu te chamo");
    expect(normalizeObjecaoDetectada("   só queria saber o preço   ")).toBe("só queria saber o preço");
    expect(normalizeObjecaoDetectada("")).toBeNull();
    expect(normalizeObjecaoDetectada("   ")).toBeNull();
    expect(normalizeObjecaoDetectada(null)).toBeNull();
    expect(normalizeObjecaoDetectada(undefined)).toBeNull();
    expect(normalizeObjecaoDetectada(42)).toBeNull();
    expect(normalizeObjecaoDetectada(true)).toBeNull();
    expect(normalizeObjecaoDetectada({})).toBeNull();
    expect(normalizeObjecaoDetectada([])).toBeNull();
  });

  it("resposta do modelo sem o campo continua sendo processada sem erro — compatibilidade com o que já está em produção", () => {
    const payloadProducao = JSON.stringify({
      mensagem: "Olá! O valor do nosso plano inicial é R$ 297/mês. Para quando você planeja iniciar?",
      status_conversa: "aguardando_usuario",
      dados: { interesse: "CRM de vendas", segmento: "tecnologia" },
      lead_source: "Instagram",
      classificacao: "QUENTE",
      spin_fase: "necessidade",
      finalizado: false,
      nao_comercial: false,
      motivo_nao_comercial: null,
      precisa_humano: false,
    });

    const parsed = parseAIResponse(payloadProducao);
    expect(parsed.contratoQuebrado).toBeUndefined();
    expect(parsed.mensagem).toBe("Olá! O valor do nosso plano inicial é R$ 297/mês. Para quando você planeja iniciar?");
    expect(parsed.status_conversa).toBe("aguardando_usuario");
    expect(parsed.dados).toEqual({ interesse: "CRM de vendas", segmento: "tecnologia" });
    expect(parsed.lead_source).toBe("organico");
    expect(parsed.classificacao).toBe("QUENTE");
    expect(parsed.spin_fase).toBe("necessidade");
    expect(parsed.finalizado).toBe(false);
    expect(parsed.nao_comercial).toBe(false);
    expect(parsed.motivo_nao_comercial).toBeNull();
    expect(parsed.precisa_humano).toBe(false);
    expect(parsed.objecao_detectada).toBeNull();
  });

  it("as regras que já existiam continuam presentes e inalteradas no prompt: base de conhecimento, não-comercial, origem do lead, finalizado", () => {
    const prompt = buildJsonInstruction();

    // 1. Base de conhecimento
    expect(prompt).toContain('BASE DE CONHECIMENTO (QUANDO HOUVER UM BLOCO "BASE DE CONHECIMENTO" ANEXADO ABAIXO NESTE PROMPT):');
    expect(prompt).toContain('• Responda a pergunta do lead SOMENTE com o que estiver naquele bloco. Não complete com conhecimento geral, não invente, não "ache que sabe".');
    expect(prompt).toContain('• Se a resposta não estiver lá, marque "precisa_humano": true e escreva em "mensagem" uma frase curta e natural avisando que vai chamar um especialista');
    expect(prompt).toContain('• Saudação, agradecimento ou mensagem sem pergunta factual NÃO aciona esta regra, com ou sem bloco anexado — continue a conversa normalmente.');
    expect(prompt).toContain('• Fora desse cenário (sem bloco de Base de Conhecimento anexado — não achou trecho relevante para esta mensagem, ou o tenant não tem base configurada), "precisa_humano" fica false — isso não muda em nada como você atende hoje.');

    // 2. Rastreamento de origem do lead
    expect(prompt).toContain("RASTREAMENTO DE ORIGEM DO LEAD:");
    expect(prompt).toContain('• Se a origem do lead (lead_source ou origem_marketing nos dados) ainda não estiver definida, faça uma pergunta leve e natural durante a conversa para saber como ele conheceu a empresa (ex.: "Por sinal, como nos conheceu? Instagram, indicação, Google?").');
    expect(prompt).toContain('• Sempre preencha o campo "lead_source" (ou "origem_marketing" dentro de "dados") assim que identificar o canal de origem (ex.: Instagram, Google Ads, Facebook Ads, TikTok, Indicação, Formulário, WhatsApp, etc.).');

    // 3. Conversa não-comercial
    expect(prompt).toContain("DETECÇÃO DE CONVERSA NÃO-COMERCIAL (SILENCIAMENTO DO AGENTE):");
    expect(prompt).toContain('• Marque "nao_comercial": true e informe "motivo_nao_comercial" com um texto curto (ex.: "pedido de comida", "conversa pessoal", "engano") caso a mensagem seja claramente:');
    expect(prompt).toContain("- Conversa pessoal (amigos, familiares, pedidos de comida/lanche, assuntos domésticos).");
    expect(prompt).toContain("- Engano ou número errado (a pessoa procurava outra pessoa ou serviço alheio ao negócio).");
    expect(prompt).toContain("- Reação a status ou mensagem isolada sem nenhum contexto comercial.");
    expect(prompt).toContain('• REGRA EXPLÍCITA: Na dúvida, marque "nao_comercial": false e "motivo_nao_comercial": null. É melhor responder uma mensagem a mais do que calar um cliente real.');

    // 4. Finalizado
    expect(prompt).toContain('REGRA CRÍTICA — quando setar "finalizado": true:');
    expect(prompt).toContain('• Sempre que você emitir a mensagem final de encerramento (ex.: "Fechado. Vou passar pro consultor...", "Vou repassar pro nosso time", ou qualquer despedida que sinalize que o consultor humano vai assumir).');
    expect(prompt).toContain("• Quando todos os dados obrigatórios já foram coletados E a conversa foi encerrada.");
    expect(prompt).toContain('• Se "finalizado": true, então "status_conversa" DEVE ser "finalizado".');
    expect(prompt).toContain('Se "finalizado" não for true, o briefing NÃO é enviado ao SDR. Não esqueça desse campo no encerramento.');
  });

  it("a trava de uma pergunta por objeção está escrita no prompt", () => {
    const prompt = buildJsonInstruction();

    // A trava literal obrigatória
    expect(prompt).toContain("uma pergunta por objeção, nunca duas");

    // Comportamento detalhado da trava
    expect(prompt).toContain("se a pessoa repetir a objeção ou não responder à pergunta, o agente para de perguntar");
    expect(prompt).toContain('Marca precisa_humano: true e encerra com naturalidade');
    expect(prompt).toContain("Sem segunda tentativa, sem reformular a pergunta, sem insistir");
    expect(prompt).toContain("Robô que insiste em desconhecido no WhatsApp é bloqueado e denunciado");
  });

  it("o prompt base declara explicitamente que a instrução da empresa tem precedência sobre a regra de preço", () => {
    const prompt = buildJsonInstruction();

    // A declaração explícita de precedência da instrução da empresa sobre o preço
    expect(prompt).toContain("Se o prompt da empresa orientar a não informar preço, a instrução da empresa vence");
    expect(prompt).toContain("diz que quem passa o valor é um consultor");
    expect(prompt).toContain("pergunta para quando a pessoa está pensando em resolver");
    expect(prompt).toContain("marca precisa_humano: true");
  });
});
