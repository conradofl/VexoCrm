import { describe, it, expect } from "vitest";
import {
  SEGMENTOS_KITS,
  LISTA_SEGMENTOS,
  DEFAULT_CINCO_OBJECOES,
  resolveSegmentoKey,
  getKitForSegmento,
  mergeKitWithSegmento,
  normalizeObjecoes,
  countFilledObjecoes,
  getUnlockingText,
} from "@/lib/geracaoDigital/briefingSegmentKits";

describe("Kit de Documentos por Segmento e As Cinco Objeções (Frontend)", () => {
  it("o kit muda conforme o segmento escolhido, e segmento desconhecido cai no genérico", () => {
    // Restaurantes e bares
    const kitRest = getKitForSegmento("Restaurantes e bares");
    expect(kitRest.map((i) => i.titulo)).toEqual([
      "Cardápio com preço",
      "Área e taxa de entrega",
      "Horário de funcionamento",
      "O que não tem no delivery",
    ]);

    // Turismo
    const kitTurismo = getKitForSegmento("Turismo");
    expect(kitTurismo.map((i) => i.titulo)).toEqual([
      "Planilha de pacotes com preço e o que está incluso",
      "Política de cancelamento e remarcação",
      "Formas de pagamento e parcelamento",
    ]);

    // Contabilidade
    const kitContabil = getKitForSegmento("Contabilidade");
    expect(kitContabil.map((i) => i.titulo)).toEqual([
      "Tabela de honorários por regime",
      "Lista de documentos para abertura",
      "Prazos das obrigações que o cliente precisa cumprir",
    ]);

    // Comércio local
    const kitComercio = getKitForSegmento("Comércio local");
    expect(kitComercio.map((i) => i.titulo)).toEqual([
      "Lista de produtos com preço",
      "Formas de pagamento",
      "Política de troca",
      "Horário e endereço",
    ]);

    // Prestadores de serviço
    const kitServico = getKitForSegmento("Prestadores de serviço");
    expect(kitServico.map((i) => i.titulo)).toEqual([
      "Tabela de serviços com faixa de preço",
      "O que está incluso e o que é cobrado à parte",
      "Prazo médio",
      "Área de atendimento",
    ]);

    // Clubes de permuta e redes de negócios
    const kitPermuta = getKitForSegmento("Clubes de permuta e redes de negócios");
    expect(kitPermuta.map((i) => i.titulo)).toEqual([
      "Como funciona o crédito",
      "O que pode e o que não pode ser comprado com ele",
      "Tabela de mensalidade e adesão",
      "Lista de segmentos disponíveis na rede",
    ]);

    // Segmento desconhecido / fora da lista cai no genérico
    const kitDesconhecido = getKitForSegmento("Indústria Aeroespacial Quântica XYZ");
    expect(kitDesconhecido.map((i) => i.titulo)).toEqual([
      "O que vende",
      "Quanto custa",
      "Como funciona",
      "Prazo",
    ]);

    // Vazio ou nulo também cai no genérico
    const kitVazio = getKitForSegmento("");
    expect(kitVazio.map((i) => i.titulo)).toEqual([
      "O que vende",
      "Quanto custa",
      "Como funciona",
      "Prazo",
    ]);
  });

  it("permite registrar os três estados de cada item do kit, inclusive 'o cliente não tem' com observação", () => {
    const kit = getKitForSegmento("restaurantes_bares");
    expect(kit[0].status).toBe("pendente");

    // Item 1: recebido
    kit[0].status = "recebido";
    expect(kit[0].status).toBe("recebido");

    // Item 2: pendente
    kit[1].status = "pendente";
    expect(kit[1].status).toBe("pendente");

    // Item 3: o cliente não tem + observação
    kit[2].status = "nao_tem";
    kit[2].observacao = "Cliente informou verbalmente que abre de 11h às 23h seg a sáb e não abre domingo.";
    expect(kit[2].status).toBe("nao_tem");
    expect(kit[2].observacao).toContain("11h às 23h");
  });

  it("exemplo sugerido nunca é gravado como resposta do cliente por padrão", () => {
    // DEFAULT_CINCO_OBJECOES inicializa sempre vazio
    expect(DEFAULT_CINCO_OBJECOES).toHaveLength(5);
    DEFAULT_CINCO_OBJECOES.forEach((par) => {
      expect(par.objecao).toBe("");
      expect(par.resposta).toBe("");
    });

    // Os exemplos existem na definição do segmento para consulta visual
    const defRest = SEGMENTOS_KITS.restaurantes_bares;
    expect(defRest.objecoesExemplos).toHaveLength(5);
    expect(defRest.objecoesExemplos[0].objecao).toContain("taxa de entrega");

    // Mas eles nunca se misturam com o estado do cliente sem preenchimento
    const objecoesDoCliente = normalizeObjecoes([]);
    expect(objecoesDoCliente[0].objecao).toBe("");
    expect(objecoesDoCliente[0].resposta).toBe("");
    expect(objecoesDoCliente[0].objecao).not.toBe(defRest.objecoesExemplos[0].objecao);
  });

  it("briefing sem nenhuma objeção continua válido e contador indica 0 de 5", () => {
    const emptyObjecoes = normalizeObjecoes([]);
    expect(countFilledObjecoes(emptyObjecoes)).toBe(0);
    expect(getUnlockingText(0)).toContain("preencha as objeções reais");
  });

  it("calcula progresso e destravamento conforme o consultor preenche as objeções", () => {
    const objecoes = [
      { id: 1, objecao: "Tá caro", resposta: "Explicamos o valor entregue e garantia" },
      { id: 2, objecao: "Vou pensar", resposta: "Perguntamos o que ficou faltando" },
      { id: 3, objecao: "", resposta: "" },
      { id: 4, objecao: "", resposta: "" },
      { id: 5, objecao: "", resposta: "" },
    ];

    expect(countFilledObjecoes(objecoes)).toBe(2);
    expect(getUnlockingText(2)).toContain("não encerra no primeiro recuo");

    // 5 preenchidas
    const completas = objecoes.map((o) => ({
      ...o,
      objecao: o.objecao || "Dúvida",
      resposta: o.resposta || "Explicação da equipe",
    }));
    expect(countFilledObjecoes(completas)).toBe(5);
    expect(getUnlockingText(5)).toContain("cobertura completa");
  });
});
