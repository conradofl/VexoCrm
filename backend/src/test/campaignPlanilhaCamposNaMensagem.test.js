import { describe, expect, it } from "vitest";
import { applyMessagePlaceholders } from "../services/messagePlaceholders.js";
import { buildTextPayload, leadVariableIsFilled } from "../campaign-outbound.js";

// Lead de planilha como o disparo o monta (campaign/dispatch.js buildDispatchLeads): os campos personalizados
// moram em normalized_data.dados.campos, como services/leadImport.js normalizeImportedLead os grava.
const leadDePlanilha = () => {
  const normalized = {
    nome: "Vitta Sul Pilates",
    telefone: "5534999104370",
    dados: { campos: { negocio: "Vitta Sul Pilates", pagina: "vitta-sul-pilates", bairro: "Jardim Karaíba" } },
  };
  return { id: "item-1", telefone: "5534999104370", nome: normalized.nome, normalized_data: normalized };
};

describe("campos da planilha chegam à mensagem da campanha", () => {
  it("troca {{campo}} que está em normalized_data.dados.campos", () => {
    const texto = applyMessagePlaceholders("Oi, pessoal do {{negocio}} no {{bairro}}!", leadDePlanilha(), "5534999104370");
    expect(texto).toBe("Oi, pessoal do Vitta Sul Pilates no Jardim Karaíba!");
  });

  it("passo de link monta a URL de cada lead, sem cair no link padrão", () => {
    const step = { type: "link", text: "Olha a página:", linkUrl: "https://demo.vexoia.com/{{pagina}}" };
    const payload = buildTextPayload("5534999104370", step, { lead: leadDePlanilha() });
    const corpo = JSON.stringify(payload);
    expect(corpo).toContain("https://demo.vexoia.com/vitta-sul-pilates");
    expect(corpo).not.toContain("mktgeracaodigital");
  });

  it("variação com campo da planilha conta como preenchida", () => {
    expect(leadVariableIsFilled("negocio", leadDePlanilha(), "5534999104370")).toBe(true);
    expect(leadVariableIsFilled("campo_que_nao_existe", leadDePlanilha(), "5534999104370")).toBe(false);
  });

  it("campo da planilha não sobrescreve nome nem telefone do sistema", () => {
    const lead = leadDePlanilha();
    lead.normalized_data.dados.campos.telefone = "000";
    expect(applyMessagePlaceholders("{{telefone}}", lead, "5534999104370")).toBe("5534999104370");
  });

  it("lead do CRM com dados.campos no topo continua igual", () => {
    const lead = { nome: "Ana", telefone: "5534999990000", dados: { campos: { plano: "Ouro" } } };
    expect(applyMessagePlaceholders("Plano {{plano}}", lead, "5534999990000")).toBe("Plano Ouro");
  });
});
