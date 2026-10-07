import { describe, it, expect } from "vitest";
import {
  buildFilterAudienceDescription,
  buildFilterCriterionSummary,
  formatSelectionBarLabel,
} from "../lib/leads/audienceDescription";

describe("buildFilterAudienceDescription", () => {
  it("formats sheet and stage filter with lead count", () => {
    const desc = buildFilterAudienceDescription(
      { stage: "buyer", importId: "import-123" },
      1482,
      { sheetName: "Lista_Outubro.xlsx" }
    );
    expect(desc).toBe("público: planilha Lista_Outubro.xlsx, estágio Compradores, 1.482 leads");
  });

  it("formats multiple criteria (sheet, stage, tag, channel)", () => {
    const desc = buildFilterAudienceDescription(
      { stage: "open_budget", tag: "vip", channel: "meta_ads", importId: "imp-1" },
      350,
      { sheetName: "Novos.xlsx", channelName: "Meta Ads" }
    );
    expect(desc).toBe('público: planilha Novos.xlsx, estágio Orçamento Aberto, tag "vip", canal Meta Ads, 350 leads');
  });

  it("formats when no specific filters are applied", () => {
    const desc = buildFilterAudienceDescription({}, 20000);
    expect(desc).toBe("público: 20.000 leads");
  });

  it("formats stage 'cold' as Leads Frios", () => {
    const desc = buildFilterAudienceDescription({ stage: "cold" }, 50);
    expect(desc).toBe("público: estágio Leads Frios, 50 leads");
  });

  it("buildFilterCriterionSummary generates clean filter summary", () => {
    const summary = buildFilterCriterionSummary(
      { stage: "cold", importId: "imp-udia" },
      { sheetName: "UDIA 5.xlsx" }
    );
    expect(summary).toBe("filtro: planilha UDIA 5.xlsx, estágio Leads Frios");
  });

  it("formatSelectionBarLabel formats selection with and without excluded items", () => {
    const withoutExceptions = formatSelectionBarLabel({
      totalCount: 77551,
      filterSummary: "filtro: planilha UDIA 5, estágio Leads Frios",
    });
    expect(withoutExceptions).toBe("77.551 leads (filtro: planilha UDIA 5, estágio Leads Frios)");

    const withExceptions = formatSelectionBarLabel({
      totalCount: 77551,
      filterSummary: "filtro: planilha UDIA 5, estágio Leads Frios",
      excludedCount: 3,
    });
    expect(withExceptions).toBe("77.551 leads (filtro: planilha UDIA 5, estágio Leads Frios) − 3 desmarcados");

    const withOneException = formatSelectionBarLabel({
      totalCount: 77551,
      filterSummary: "filtro: planilha UDIA 5, estágio Leads Frios",
      excludedCount: 1,
    });
    expect(withOneException).toBe("77.551 leads (filtro: planilha UDIA 5, estágio Leads Frios) − 1 desmarcado");
  });
});
