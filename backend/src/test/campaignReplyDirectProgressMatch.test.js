import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { resolveMatchedImportItemForCampaign } from "../campaign/dispatch.js";

const dispatchSource = readFileSync(resolve("src/campaign/dispatch.js"), "utf8");

describe("A.1 & A.2: resolveMatchedImportItemForCampaign", () => {
  const CAMP_ID = "camp-100";
  const IMP_1 = "import-aaa";
  const IMP_2 = "import-bbb";

  it("A.1: prioriza o item que já tem progresso aguardando resposta para a campanha", () => {
    const itemSemProgresso = {
      id: "item-1",
      import_id: IMP_1,
      normalized_data: { nome: "Lead Sem Progresso" },
    };
    const itemComProgresso = {
      id: "item-2",
      import_id: IMP_2,
      normalized_data: {
        nome: "Lead Aguardando",
        campaign_progress: {
          [CAMP_ID]: {
            campaignId: CAMP_ID,
            waitForReply: true,
            status: "aguardando_usuario",
            nextStepIndex: 1,
          },
        },
      },
    };

    const campaign = {
      id: CAMP_ID,
      import_id: IMP_1, // campanha aponta para IMP_1, mas o lead avançou em IMP_2
    };

    const matched = resolveMatchedImportItemForCampaign(
      [itemSemProgresso, itemComProgresso],
      campaign
    );

    expect(matched).not.toBeNull();
    expect(matched.id).toBe("item-2");
    expect(matched.normalized_data.nome).toBe("Lead Aguardando");
  });

  it("A.2: suporta analytics_meta.importIds quando a campanha aponta para várias planilhas", () => {
    const item1 = {
      id: "item-planilha-2",
      import_id: IMP_2,
      normalized_data: { nome: "Lead da Planilha 2" },
    };

    const campaign = {
      id: CAMP_ID,
      import_id: IMP_1,
      analytics_meta: {
        importIds: [IMP_1, IMP_2],
      },
    };

    const matched = resolveMatchedImportItemForCampaign([item1], campaign);

    expect(matched).not.toBeNull();
    expect(matched.id).toBe("item-planilha-2");
    expect(matched.import_id).toBe(IMP_2);
  });

  it("A.1: casa diretamente por progresso mesmo se campaign.import_id for nulo (origem CRM ou tags)", () => {
    const item = {
      id: "item-crm-1",
      import_id: null,
      normalized_data: {
        nome: "Lead de Tag",
        campaign_progress: {
          [CAMP_ID]: {
            campaignId: CAMP_ID,
            waitForReply: true,
            status: "aguardando_usuario",
          },
        },
      },
    };

    const campaignSemImport = {
      id: CAMP_ID,
      import_id: null,
      analytics_meta: {},
    };

    const matched = resolveMatchedImportItemForCampaign([item], campaignSemImport);

    expect(matched).not.toBeNull();
    expect(matched.id).toBe("item-crm-1");
  });

  it("telefone com dois itens de planilhas diferentes: escolhe a planilha certa e não vaza item alheio", () => {
    const itemSheetA = {
      id: "item-sheet-a",
      import_id: "planilha-a",
      normalized_data: { nome: "Lead na Planilha A" },
    };
    const itemSheetB = {
      id: "item-sheet-b",
      import_id: "planilha-b",
      normalized_data: { nome: "Lead na Planilha B" },
    };

    const campaignB = {
      id: "camp-b",
      import_id: "planilha-b",
    };

    const campaignC = {
      id: "camp-c",
      import_id: "planilha-c", // nem A nem B
    };

    // Caso 1: casando com campanha B -> escolhe item B, mesmo item A vindo primeiro
    const matchB = resolveMatchedImportItemForCampaign([itemSheetA, itemSheetB], campaignB);
    expect(matchB).not.toBeNull();
    expect(matchB.id).toBe("item-sheet-b");
    expect(matchB.import_id).toBe("planilha-b");

    // Caso 2: campanha C (alvo específico que não é A nem B) -> não escolhe item de A nem de B
    const matchC = resolveMatchedImportItemForCampaign([itemSheetA, itemSheetB], campaignC);
    expect(matchC).toBeNull();
  });
});

describe("A.1, A.2 & A.4: findCampaignReplyMatches contrato no código", () => {
  it("A.1: matchedByProgress é definido como fonte primária", () => {
    expect(dispatchSource).toContain("const matchedByProgress = Boolean(hasProgress);");
  });

  it("A.2: suporta analytics_meta.importIds na verificação de importId", () => {
    const section = dispatchSource.slice(
      dispatchSource.indexOf("const matches = (campaignsResult.data || [])"),
      dispatchSource.indexOf("const waitForReplyMatches =")
    );
    expect(section).toContain("analyticsMeta.importIds");
    expect(section).toContain("campaignImportIds.add(norm)");
  });

  it("A.4: elimina o return null prematuro antes de avaliar o progresso", () => {
    const mappingSection = dispatchSource.slice(
      dispatchSource.indexOf("const matches = (campaignsResult.data || [])"),
      dispatchSource.indexOf("const waitForReplyMatches =")
    );
    // Não deve conter a exclusão antiga que descartava antes de checar progresso
    expect(mappingSection).not.toContain("if (!matchedByStoredPhones && !matchedByImportId) {\n        return null;\n      }");
    // Deve incluir matchedByProgress na condição
    expect(mappingSection).toContain("if (!matchedByProgress && !matchedByStoredPhones && !matchedByImportId) {");
  });

  it("A.1: define matchSource como 'progress' quando o match ocorre pelo progresso", () => {
    expect(dispatchSource).toContain('matchSource: matchedByProgress\n          ? "progress"');
  });
});
