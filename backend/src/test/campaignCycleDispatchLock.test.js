import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  isLeadBlockedByActiveCycleProgress,
  extractCampaignProgress,
} from "../campaign/dispatch.js";

const routesSource = readFileSync(resolve("src/domains/campaigns/routes.js"), "utf8");
const recurrenceSource = readFileSync(resolve("src/services/campaignRecurrenceOccurrences.js"), "utf8");

describe("Trava por ciclo de disparo (isLeadBlockedByActiveCycleProgress)", () => {
  const CAMP_ID = "camp-alpha-123";

  it("lote avulso: bloqueia repetição do passo 1 enquanto a sequência está em andamento (aguardando_usuario)", () => {
    const progressAguardando = {
      campaignId: CAMP_ID,
      waitForReply: true,
      status: "aguardando_usuario",
      currentStepIndex: 0,
      nextStepIndex: 1,
    };
    const avulsoOccurrence = { isOccurrence: false, occurrenceAt: null };

    const blocked = isLeadBlockedByActiveCycleProgress({
      progress: progressAguardando,
      occurrence: avulsoOccurrence,
      campaignId: CAMP_ID,
      dispatchId: "disp-batch-2",
    });

    expect(blocked).toBe(true);
  });

  it("lote avulso: lead sem progresso ou finalizado NÃO é bloqueado", () => {
    const avulsoOccurrence = { isOccurrence: false, occurrenceAt: null };

    // Sem progresso
    expect(
      isLeadBlockedByActiveCycleProgress({
        progress: {},
        occurrence: avulsoOccurrence,
        campaignId: CAMP_ID,
        dispatchId: "disp-1",
      })
    ).toBe(false);

    // Finalizado
    expect(
      isLeadBlockedByActiveCycleProgress({
        progress: { campaignId: CAMP_ID, waitForReply: true, status: "finalizado" },
        occurrence: avulsoOccurrence,
        campaignId: CAMP_ID,
        dispatchId: "disp-1",
      })
    ).toBe(false);
  });

  it("lote avulso: progresso de OUTRA campanha não bloqueia este envio", () => {
    const progressOutra = {
      campaignId: "outra-campanha",
      waitForReply: true,
      status: "aguardando_usuario",
    };
    expect(
      isLeadBlockedByActiveCycleProgress({
        progress: progressOutra,
        occurrence: { isOccurrence: false },
        campaignId: CAMP_ID,
        dispatchId: "disp-1",
      })
    ).toBe(false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TESTE OBRIGATÓRIO F:
  // F) campanha recorrente com 2 ocorrências: o MESMO lead recebe o passo 1 nas duas.
  // ═══════════════════════════════════════════════════════════════════════
  it("F) campanha recorrente com 2 ocorrências: o MESMO lead recebe o passo 1 nas duas", () => {
    const OCC_1_TIME = "2026-10-01T10:00:00.000Z";
    const OCC_2_TIME = "2026-11-01T10:00:00.000Z";

    const occurrence1 = {
      isOccurrence: true,
      occurrenceAt: OCC_1_TIME,
      variantOffset: 0,
    };

    // 1. Primeira ocorrência: lead não tem progresso inicial
    const leadInitialData = {
      nome: "Lead Recorrente Teste",
      campaign_progress: {},
    };

    const initialProgress = extractCampaignProgress(leadInitialData, CAMP_ID);
    const blockedOcc1 = isLeadBlockedByActiveCycleProgress({
      progress: initialProgress,
      occurrence: occurrence1,
      campaignId: CAMP_ID,
      dispatchId: "dispatch-occ-1",
    });

    // O lead recebe o passo 1 na ocorrência 1
    expect(blockedOcc1).toBe(false);

    // Ocorrência 1 envia e grava progresso esperando resposta (ou ciclo da ocorrência 1)
    const progressAposOcc1 = {
      campaignId: CAMP_ID,
      waitForReply: true,
      status: "aguardando_usuario",
      occurrenceAt: OCC_1_TIME,
      dispatchId: "dispatch-occ-1",
      currentStepIndex: 0,
      nextStepIndex: 1,
    };

    // 2. Segunda ocorrência (novo ciclo no mês seguinte):
    const occurrence2 = {
      isOccurrence: true,
      occurrenceAt: OCC_2_TIME,
      variantOffset: 1,
    };

    const blockedOcc2 = isLeadBlockedByActiveCycleProgress({
      progress: progressAposOcc1,
      occurrence: occurrence2,
      campaignId: CAMP_ID,
      dispatchId: "dispatch-occ-2",
    });

    // O MESMO lead NÃO é bloqueado na ocorrência 2 e recebe o passo 1 novamente!
    expect(blockedOcc2).toBe(false);
  });

  it("campanha recorrente: na MESMA ocorrência em andamento, o passo 1 não é duplicado", () => {
    const OCC_TIME = "2026-10-01T10:00:00.000Z";
    const occurrence = {
      isOccurrence: true,
      occurrenceAt: OCC_TIME,
    };
    const progressMesmaOcorrencia = {
      campaignId: CAMP_ID,
      waitForReply: true,
      status: "aguardando_usuario",
      occurrenceAt: OCC_TIME,
      dispatchId: "dispatch-occ-1",
    };

    const blocked = isLeadBlockedByActiveCycleProgress({
      progress: progressMesmaOcorrencia,
      occurrence,
      campaignId: CAMP_ID,
      dispatchId: "dispatch-occ-1",
    });

    // Na mesma ocorrência ainda em aguardando_usuario, o passo 1 não se repete
    expect(blocked).toBe(true);
  });
});

describe("Contrato da trava por ciclo em routes.js e campaignRecurrenceOccurrences.js", () => {
  it("routes.js importa e utiliza isLeadBlockedByActiveCycleProgress", () => {
    expect(routesSource).toContain("isLeadBlockedByActiveCycleProgress");
    expect(routesSource).toContain("const cycleLeads = [];");
    expect(routesSource).toContain("isLeadBlockedByActiveCycleProgress({ progress, occurrence, campaignId: campaign.id, dispatchId })");
  });

  it("routes.js passa occurrenceAt e dispatchId ao gravar progresso de espera", () => {
    expect(routesSource).toContain("occurrenceAt: occurrence?.occurrenceAt || null");
    expect(routesSource).toContain("dispatchId,");
  });

  it("readOccurrenceInfo expõe occurrenceAt a partir de recurrence_occurrence_at", () => {
    expect(recurrenceSource).toContain("occurrenceAt = row?.recurrence_occurrence_at");
    expect(recurrenceSource).toContain("occurrenceAt,");
  });
});
