import { describe, it, expect } from "vitest";
import {
  gerarTresPerguntasSugeridas,
  EXPLICACAO_FORA_DA_BASE,
  PERGUNTAS_KIT_SEGMENTO,
} from "../lib/geracaoDigital/briefingSimulatorQuestions";
import {
  calculateImplementationReadiness,
} from "../lib/geracaoDigital/briefingReadiness";

describe("Simulador no Fim da Implantação e Três Perguntas Sugeridas (Frontend)", () => {
  it("as três perguntas mudam conforme o segmento e conforme as objeções preenchidas", () => {
    // 1. Segmento Restaurantes e Bares com objeção personalizada
    const perguntasRestaurante = gerarTresPerguntasSugeridas({
      segmento: "restaurantes_bares",
      cincoObjecoes: [
        { id: 1, objecao: "Achei a taxa de entrega um absurdo para o meu condomínio.", resposta: "Oferecemos entrega grátis acima de R$ 80." },
      ],
    });

    expect(perguntasRestaurante).toHaveLength(3);
    expect(perguntasRestaurante[0].id).toBe("pergunta_1_segmento");
    expect(perguntasRestaurante[0].pergunta).toBe(PERGUNTAS_KIT_SEGMENTO.restaurantes_bares.pergunta1);
    expect(perguntasRestaurante[0].tipo).toBe("segmento");

    // Pergunta 2 deve usar as palavras que o cliente acabou de escrever
    expect(perguntasRestaurante[1].id).toBe("pergunta_2_objecao");
    expect(perguntasRestaurante[1].pergunta).toBe("Achei a taxa de entrega um absurdo para o meu condomínio.");
    expect(perguntasRestaurante[1].tipo).toBe("objecao");

    // Pergunta 3 é fora da base
    expect(perguntasRestaurante[2].id).toBe("pergunta_3_fora_da_base");
    expect(perguntasRestaurante[2].pergunta).toBe(PERGUNTAS_KIT_SEGMENTO.restaurantes_bares.pergunta3ForaDaBase);

    // 2. Segmento Turismo com outra objeção personalizada
    const perguntasTurismo = gerarTresPerguntasSugeridas({
      segmento: "turismo",
      cincoObjecoes: [
        { id: 1, objecao: "E se chover torrencialmente no dia do passeio de barco?", resposta: "Reagendamos sem custo ou devolvemos o valor." },
      ],
    });

    expect(perguntasTurismo[0].pergunta).toBe(PERGUNTAS_KIT_SEGMENTO.turismo.pergunta1);
    expect(perguntasTurismo[1].pergunta).toBe("E se chover torrencialmente no dia do passeio de barco?");
    expect(perguntasTurismo[2].pergunta).toBe(PERGUNTAS_KIT_SEGMENTO.turismo.pergunta3ForaDaBase);

    // As perguntas de Restaurante e Turismo são comprovadamente diferentes
    expect(perguntasRestaurante[0].pergunta).not.toBe(perguntasTurismo[0].pergunta);
    expect(perguntasRestaurante[1].pergunta).not.toBe(perguntasTurismo[1].pergunta);
    expect(perguntasRestaurante[2].pergunta).not.toBe(perguntasTurismo[2].pergunta);
  });

  it("cliente que não preencheu nenhuma objeção recebe três perguntas assim mesmo, sem campo vazio na tela", () => {
    // Array vazio
    const perguntasSemObjecao = gerarTresPerguntasSugeridas({
      segmento: "contabilidade",
      cincoObjecoes: [],
    });

    expect(perguntasSemObjecao).toHaveLength(3);
    perguntasSemObjecao.forEach((p, idx) => {
      expect(p.pergunta).toBeTruthy();
      expect(p.pergunta.trim().length).toBeGreaterThan(10);
      expect(p.tituloBadge).toBeTruthy();
    });

    // Pergunta 2 deve conter a objeção padrão do segmento contábil
    expect(perguntasSemObjecao[1].pergunta).toBe(PERGUNTAS_KIT_SEGMENTO.contabilidade.pergunta2Padrao);

    // Objeções com strings em branco
    const perguntasEspacosEmBranco = gerarTresPerguntasSugeridas({
      segmento: "comercio_local",
      cincoObjecoes: [
        { id: 1, objecao: "   ", resposta: "" },
        { id: 2, objecao: "", resposta: "" },
      ],
    });

    expect(perguntasEspacosEmBranco[1].pergunta).toBe(PERGUNTAS_KIT_SEGMENTO.comercio_local.pergunta2Padrao);
    expect(perguntasEspacosEmBranco[1].pergunta.trim().length).toBeGreaterThan(0);
  });

  it("a terceira pergunta é marcada como 'fora da base' na interface, com a explicação exata", () => {
    const perguntas = gerarTresPerguntasSugeridas({
      segmento: "prestadores_servico",
    });

    const p3 = perguntas[2];
    expect(p3.isForaDaBase).toBe(true);
    expect(p3.tituloBadge).toBe("Fora da base");
    expect(p3.tipo).toBe("fora_da_base");
    expect(p3.explicacao).toBe(EXPLICACAO_FORA_DA_BASE);
    expect(p3.explicacao).toBe("esta é para você ver o que acontece quando ele não sabe");

    // As duas primeiras NÃO são fora da base
    expect(perguntas[0].isForaDaBase).toBe(false);
    expect(perguntas[1].isForaDaBase).toBe(false);
  });

  it("a lista do que falta reflete o estado real: desligue o agente e o item correspondente muda", () => {
    // Estado 1: Tudo ligado e configurado
    const reportLigado = calculateImplementationReadiness({
      activeChipsCount: 1,
      inboundAgent: {
        id: "comp-1",
        evolution_instances: ["Chip Principal"],
        inbound_enabled: true,
        inbound_prompt: "Você é um assistente de vendas...",
      },
      chatbotEnabled: true,
      documentsCount: 2,
      promptContent: "Prompt padrão do tenant",
    });

    const itemLigado = reportLigado.itens.find((i) => i.id === "agente_ligado");
    expect(itemLigado).toBeDefined();
    expect(itemLigado?.pronto).toBe(true);
    expect(reportLigado.prontoParaSoltar).toBe(true);
    expect(reportLigado.itensProntos).toBe(5);

    // Estado 2: O consultor desliga o agente
    const reportDesligado = calculateImplementationReadiness({
      activeChipsCount: 1,
      inboundAgent: {
        id: "comp-1",
        evolution_instances: ["Chip Principal"],
        inbound_enabled: false, // DESLIGOU O AGENTE
        inbound_prompt: "Você é um assistente de vendas...",
      },
      chatbotEnabled: false, // DESLIGADO NO TENANT
      documentsCount: 2,
      promptContent: "Prompt padrão do tenant",
    });

    const itemDesligado = reportDesligado.itens.find((i) => i.id === "agente_ligado");
    expect(itemDesligado?.pronto).toBe(false);
    expect(reportDesligado.prontoParaSoltar).toBe(false);
    expect(reportDesligado.itensProntos).toBe(4);
  });

  it("a lista do que falta possui exatamente os 5 itens com nome de coisa e links para onde resolver", () => {
    const report = calculateImplementationReadiness({
      activeChipsCount: 0,
      inboundAgent: null,
      chatbotEnabled: false,
      documentsCount: 0,
      promptContent: "",
    });

    expect(report.totalItens).toBe(5);
    expect(report.itensProntos).toBe(0);
    expect(report.prontoParaSoltar).toBe(false);

    const nomes = report.itens.map((i) => i.nome);
    expect(nomes).toEqual([
      "Chip conectado",
      "Agente vinculado ao chip",
      "Agente ligado",
      "Base de conhecimento com pelo menos um documento",
      "Prompt aprovado",
    ]);

    // Cada item possui link e linkTexto definidos
    report.itens.forEach((i) => {
      expect(i.link).toBeTruthy();
      expect(i.linkTexto).toBeTruthy();
      expect(i.pronto).toBe(false);
    });

    expect(report.itens.find((i) => i.id === "chip_conectado")?.link).toBe("/crm/chips-whatsapp?tab=conexoes");
    expect(report.itens.find((i) => i.id === "agente_vinculado_chip")?.link).toBe("/crm/agente");
    expect(report.itens.find((i) => i.id === "agente_ligado")?.link).toBe("/crm/agente");
    expect(report.itens.find((i) => i.id === "base_conhecimento")?.link).toBe("/crm/agente?tab=docs");
    expect(report.itens.find((i) => i.id === "prompt_aprovado")?.link).toBe("/crm/padroes-da-empresa");
  });
});
