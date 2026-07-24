import { describe, it, expect } from "vitest";
import { DEFAULT_BRIEFING_FIELDS } from "@/lib/geracaoDigital/defaults";
import { AI_PROCESSING_STEPS } from "@/lib/geracaoDigital/constants";
import { deriveExtractedValues } from "@/lib/geracaoDigital/briefingParser";

const idsDosCampos = new Set(DEFAULT_BRIEFING_FIELDS.map((f) => f.id));

describe("passos da IA apontam para campos que existem", () => {
  // Era exatamente isso que quebrava: os passos usavam "atuacao" e "publico",
  // ids inexistentes, e Localização e Público Alvo nunca eram preenchidos.
  it("todo fId corresponde a um campo real do briefing", () => {
    AI_PROCESSING_STEPS.filter((s) => s.fId).forEach((s) => {
      expect(idsDosCampos.has(s.fId as string), `fId órfão: ${s.fId}`).toBe(true);
    });
  });

  it("os campos que o usuário citou têm passo de preenchimento", () => {
    const comPasso = new Set(AI_PROCESSING_STEPS.map((s) => s.fId).filter(Boolean));
    ["localizacao", "publico_alvo", "produtos_trafego", "objetivo_trafego", "verba"].forEach((id) =>
      expect(comPasso.has(id), `sem passo: ${id}`).toBe(true)
    );
  });
});

describe("estrutura dos campos do briefing", () => {
  it("Produtos trabalhados no tráfego é campo grande (textarea)", () => {
    const f = DEFAULT_BRIEFING_FIELDS.find((x) => x.id === "produtos_trafego")!;
    expect(f.type).toBe("textarea");
  });

  it("Público Alvo mantém os cinco subcampos", () => {
    const f = DEFAULT_BRIEFING_FIELDS.find((x) => x.id === "publico_alvo")!;
    expect(f.subfields?.map((s) => s.id)).toEqual([
      "genero",
      "idade",
      "classe",
      "interesses",
      "outros_detalhes",
    ]);
  });

  it("os campos novos do briefing expandido existem", () => {
    [
      "ticket_margem",
      "diferencial",
      "ja_rodou_trafego",
      "trafego_historico",
      "dores_publico",
      "base_existente",
      "verba_periodicidade",
      "divisao_verba",
      "sazonalidade",
    ].forEach((id) => expect(idsDosCampos.has(id), `faltando: ${id}`).toBe(true));
  });

  it("objetivo do tráfego cobre as três etapas do funil", () => {
    const f = DEFAULT_BRIEFING_FIELDS.find((x) => x.id === "objetivo_trafego")!;
    const opts = (f.options || []).join(" ");
    expect(opts).toContain("Topo");
    expect(opts).toContain("Meio");
    expect(opts).toContain("Fundo");
    expect(f.options).toHaveLength(9);
  });

  it("nenhum id duplicado", () => {
    const ids = DEFAULT_BRIEFING_FIELDS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("extração da transcrição preenche os subcampos do público", () => {
  const transcricao = `
    Entrevistador: Qual o gênero do público?
    Cliente: O gênero é predominantemente mulheres.
    Entrevistador: E a faixa etária?
    Cliente: A idade fica entre 25 e 45 anos.
    Entrevistador: Qual a classe social?
    Cliente: A classe social é B e C.
    Entrevistador: Quais os interesses?
    Cliente: Os interesses são moda, beleza e bem estar.
    Entrevistador: Qual o ticket médio?
    Cliente: O ticket médio é de 800 reais com margem de 40%.
  `;

  it("devolve chave por subcampo no formato campo.subcampo", () => {
    const v = deriveExtractedValues(transcricao);
    const chaves = Object.keys(v);
    ["genero", "idade", "classe", "interesses", "outros_detalhes"].forEach((sub) =>
      expect(chaves, `sem chave publico_alvo.${sub}`).toContain(`publico_alvo.${sub}`)
    );
  });

  it("devolve chave para os campos novos", () => {
    const chaves = Object.keys(deriveExtractedValues(transcricao));
    ["ticket_margem", "diferencial", "dores_publico", "sazonalidade", "verba_periodicidade"].forEach(
      (id) => expect(chaves, `sem chave ${id}`).toContain(id)
    );
  });

  it("não quebra com transcrição vazia", () => {
    expect(() => deriveExtractedValues("")).not.toThrow();
  });
});
