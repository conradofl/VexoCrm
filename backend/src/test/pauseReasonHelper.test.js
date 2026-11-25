// PR 6b do untangle: uma regra só para "lote pausado volta sozinho?" (services/pauseReason.js).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PAUSE_REASON, isAutoResumablePause, pauseReasonFromText, pauseReasonOf } from "../services/pauseReason.js";
import { QUOTA_PAUSE_MARKER } from "../services/campaignQuotaGate.js";

describe("pauseReason", () => {
  it("lê a coluna quando a linha traz pause_reason", () => {
    expect(pauseReasonOf({ pause_reason: "cota_chip", error_message: "qualquer coisa" })).toBe("cota_chip");
    expect(pauseReasonOf({ pause_reason: null, error_message: "Pausado — fora da janela de envio" })).toBeNull();
  });

  it("sem a coluna, aplica a regra da migration ao texto (sem diferenciar maiúscula)", () => {
    expect(pauseReasonFromText("Pausado — fora da janela de envio (08:00–18:00).")).toBe(PAUSE_REASON.FORA_DA_JANELA);
    expect(pauseReasonFromText(`Retomará amanhã. ${QUOTA_PAUSE_MARKER}`)).toBe(PAUSE_REASON.COTA_CHIP);
    expect(pauseReasonFromText("FORA DA JANELA DE ENVIO")).toBe(PAUSE_REASON.FORA_DA_JANELA);
    expect(pauseReasonFromText("Pausado manualmente")).toBeNull();
    expect(pauseReasonFromText(null)).toBeNull();
  });

  it("só janela e cota voltam sozinhos", () => {
    expect(isAutoResumablePause({ error_message: "Pausado — fora da janela de envio" })).toBe(true);
    expect(isAutoResumablePause({ error_message: `x ${QUOTA_PAUSE_MARKER}` })).toBe(true);
    expect(isAutoResumablePause({ error_message: "Pausado — chip desconectado (Chip 2)." })).toBe(false);
    expect(isAutoResumablePause(null)).toBe(false);
  });

  it("os valores são os mesmos que a migration gera", () => {
    const mig = readFileSync(resolve(__dirname, "../../supabase/migrations/20261125030000_add_pause_reason_to_campaign_dispatches.sql"), "utf8");
    expect(mig).toContain(`'${PAUSE_REASON.FORA_DA_JANELA}'`);
    expect(mig).toContain(`'${PAUSE_REASON.COTA_CHIP}'`);
  });

  it("o agendador decide pelo helper, não por includes de frase solta", () => {
    const rotas = readFileSync(resolve(__dirname, "../domains/campaigns/routes.js"), "utf8");
    expect(rotas).not.toMatch(/errMsg\.includes\("fora da janela de envio"\)/);
  });
});
