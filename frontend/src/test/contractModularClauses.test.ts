import { describe, it, expect } from "vitest";
import {
  toExtenseOrdinal,
  assembleContractFromBlocks,
  parseTemplateContentToClauses,
  extractPlaceholders,
  extractDynamicPlaceholders,
  formatFieldLabel,
  applyContractMerge,
  ContractClauseBlock,
} from "@/lib/geracaoDigital/contractMerge";

describe("Item 10: Cláusulas Modulares e Numeração Ordinal Dinâmica (Frontend)", () => {
  const sampleClauses: ContractClauseBlock[] = [
    {
      id: "partes",
      titulo: "Das Partes",
      conteudo: "Contratante: {{razao_social}}, CNPJ {{cnpj}}.\nContratada: {{contratada_razao_social}}.",
      ativo: true,
      obrigatorio: true,
    },
    {
      id: "objeto",
      titulo: "Do Objeto do Contrato",
      conteudo: "Prestação de serviços digitais incluindo {{produtos}} com potência de {{potencia_kwp}} kWp.",
      ativo: true,
    },
    {
      id: "plataforma",
      titulo: "Da Plataforma Vexo OS",
      conteudo: "Acesso à plataforma sob licença mensal com taxa de setup de {{taxa_setup}}.",
      ativo: true,
    },
    {
      id: "preco",
      titulo: "Do Preço e Condições",
      conteudo: "Pagamento em {{num_parcelas}} parcelas no valor de R$ {{valor_parcela}}.",
      ativo: true,
    },
    {
      id: "foro",
      titulo: "Do Foro Competente",
      conteudo: "Fica eleito o foro da comarca de {{foro_cidade}}.",
      ativo: true,
    },
  ];

  it("deve converter índices numéricos em ordinais por extenso em português", () => {
    expect(toExtenseOrdinal(1)).toBe("Primeira");
    expect(toExtenseOrdinal(2)).toBe("Segunda");
    expect(toExtenseOrdinal(3)).toBe("Terceira");
    expect(toExtenseOrdinal(4)).toBe("Quarta");
    expect(toExtenseOrdinal(5)).toBe("Quinta");
    expect(toExtenseOrdinal(10)).toBe("Décima");
    expect(toExtenseOrdinal(21)).toBe("Vigésima Primeira");
  });

  it("deve montar contrato com numeração ordinal contínua quando todas estão ativas", () => {
    const text = assembleContractFromBlocks({
      tituloPrincipal: "CONTRATO DE PRESTAÇÃO DE SERVIÇOS",
      clausulas: sampleClauses,
      fechamento: "E, por estarem assim justas e contratadas, firmam o presente instrumento.",
    });

    expect(text).toContain("CONTRATO DE PRESTAÇÃO DE SERVIÇOS");
    expect(text).toContain("Cláusula Primeira – Das Partes");
    expect(text).toContain("Cláusula Segunda – Do Objeto do Contrato");
    expect(text).toContain("Cláusula Terceira – Da Plataforma Vexo OS");
    expect(text).toContain("Cláusula Quarta – Do Preço e Condições");
    expect(text).toContain("Cláusula Quinta – Do Foro Competente");
    expect(text).toContain("E, por estarem assim justas e contratadas");
  });

  it("deve recalcular a numeração sem buracos quando uma cláusula intermediária for desativada", () => {
    // Desativa a Cláusula 3 ("Da Plataforma Vexo OS")
    const modifiedClauses = sampleClauses.map((c) =>
      c.id === "plataforma" ? { ...c, ativo: false } : c
    );

    const text = assembleContractFromBlocks({
      tituloPrincipal: "CONTRATO COMERCIAL",
      clausulas: modifiedClauses,
    });

    // A cláusula desativada não deve aparecer
    expect(text).not.toContain("Da Plataforma Vexo OS");

    // A antiga Cláusula 4 ("Do Preço e Condições") deve assumir como Terceira
    expect(text).toContain("Cláusula Primeira – Das Partes");
    expect(text).toContain("Cláusula Segunda – Do Objeto do Contrato");
    expect(text).toContain("Cláusula Terceira – Do Preço e Condições");
    expect(text).toContain("Cláusula Quarta – Do Foro Competente");
    expect(text).not.toContain("Cláusula Quinta");
  });

  it("deve refletir a reordenação das cláusulas na numeração ordinal", () => {
    // Inverte a ordem entre Foro e Preço
    const reordered = [
      sampleClauses[0], // Partes -> Primeira
      sampleClauses[1], // Objeto -> Segunda
      sampleClauses[4], // Foro -> Terceira
      sampleClauses[3], // Preço -> Quarta
    ];

    const text = assembleContractFromBlocks({ clausulas: reordered });

    expect(text).toContain("Cláusula Primeira – Das Partes");
    expect(text).toContain("Cláusula Segunda – Do Objeto do Contrato");
    expect(text).toContain("Cláusula Terceira – Do Foro Competente");
    expect(text).toContain("Cláusula Quarta – Do Preço e Condições");
  });

  it("deve decompor template de texto legado em blocos de cláusulas estruturados", () => {
    const legacyText = `CONTRATO DE SERVIÇOS DE MARKETING
    
Cláusula 1ª – Das Partes
A CONTRATANTE {{razao_social}} e a CONTRATADA {{contratada_razao_social}}.

Cláusula Segunda – Do Objeto
O objeto deste contrato consiste em {{produtos}}.

Cláusula Terceira – Do Foro
Eleito o foro de {{foro_cidade}}.

E, por estarem assim acordadas, assinam.`;

    const parsed = parseTemplateContentToClauses(legacyText);

    expect(parsed.tituloPrincipal).toContain("CONTRATO DE SERVIÇOS DE MARKETING");
    expect(parsed.clausulas).toHaveLength(3);
    expect(parsed.clausulas[0].titulo).toBe("Das Partes");
    expect(parsed.clausulas[0].conteudo).toContain("{{razao_social}}");
    expect(parsed.clausulas[0].obrigatorio).toBe(true); // Partes é identificada como obrigatória
    expect(parsed.clausulas[1].titulo).toBe("Do Objeto");
    expect(parsed.clausulas[2].titulo).toBe("Do Foro");
    expect(parsed.fechamento).toContain("E, por estarem assim acordadas, assinam.");
  });

  it("deve extrair placeholders e ignorar variáveis de cláusulas inativas", () => {
    const clausesWithInactive: ContractClauseBlock[] = [
      {
        id: "c1",
        titulo: "Cláusula 1",
        conteudo: "Olá {{razao_social}}, seu CNPJ é {{cnpj}} e sua potência é {{potencia_kwp}}.",
        ativo: true,
      },
      {
        id: "c2",
        titulo: "Cláusula 2",
        conteudo: "Área construída de {{area_m2}} metros quadrados.",
        ativo: false, // Inativa!
      },
    ];

    const allPlaceholders = extractPlaceholders(clausesWithInactive);
    expect(allPlaceholders).toContain("razao_social");
    expect(allPlaceholders).toContain("cnpj");
    expect(allPlaceholders).toContain("potencia_kwp");
    expect(allPlaceholders).not.toContain("area_m2");
  });

  it("deve filtrar campos padrão do sistema e retornar apenas variáveis dinâmicas do modelo", () => {
    const dynamicVars = extractDynamicPlaceholders(sampleClauses);

    // Campos do sistema e padrões comerciais NÃO devem ser listados como variáveis dinâmicas
    expect(dynamicVars).not.toContain("razao_social");
    expect(dynamicVars).not.toContain("cnpj");
    expect(dynamicVars).not.toContain("produtos");
    expect(dynamicVars).not.toContain("num_parcelas");
    expect(dynamicVars).not.toContain("valor_parcela");
    expect(dynamicVars).not.toContain("foro_cidade");
    expect(dynamicVars).not.toContain("contratada_razao_social");

    // Variáveis customizadas (agnósticas de segmento) DEVEM ser detectadas
    expect(dynamicVars).toContain("potencia_kwp");
    expect(dynamicVars).toContain("taxa_setup");
  });

  it("deve formatar labels das variáveis dinâmicas com elegância", () => {
    expect(formatFieldLabel("potencia_kwp")).toBe("Potencia Kwp");
    expect(formatFieldLabel("area_m2")).toBe("Area M2");
    expect(formatFieldLabel("registro_cro")).toBe("Registro Cro");
  });

  it("deve mesclar dados incluindo variáveis dinâmicas no contrato montado", () => {
    const assembled = assembleContractFromBlocks({ clausulas: sampleClauses });

    const merged = applyContractMerge(assembled, {
      razao_social: "Solar Max Ltda",
      cnpj: "12.345.678/0001-90",
      produtos: "Painéis Fotovoltaicos",
      potencia_kwp: "75",
      taxa_setup: "R$ 1.500,00",
      num_parcelas: "12",
      valor_parcela: "2.800,00",
      foro_cidade: "Belo Horizonte",
      contratada_razao_social: "Vexo Tecnologia",
    });

    expect(merged).toContain("Solar Max Ltda");
    expect(merged).toContain("75 kWp");
    expect(merged).toContain("taxa de setup de R$ 1.500,00");
    expect(merged).toContain("Cláusula Primeira – Das Partes");
  });
});
