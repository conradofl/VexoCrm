import { describe, it, expect, vi } from "vitest";
import { fetchCampaignsApi } from "../hooks/useCampanhas";
import { isMobileDevice } from "../components/HeloisaVoiceOrb";

describe("Heloísa Mobile Listening & Timeout de Campanhas", () => {
  it("detecta dispositivos móveis via User-Agent", () => {
    expect(isMobileDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15")).toBe(true);
    expect(isMobileDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36")).toBe(true);
    expect(isMobileDevice("Mozilla/5.0 (iPad; CPU OS 16_5 like Mac OS X) AppleWebKit/605.1.15")).toBe(true);
    expect(isMobileDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")).toBe(false);
    expect(isMobileDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
  });

  it("fetchCampaignsApi formata mensagem amigável quando ocorre AbortError / Timeout", async () => {
    const abortErr = new DOMException("The user aborted a request.", "AbortError");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        throw abortErr;
      })
    );

    await expect(fetchCampaignsApi("/api/campaigns/test", {})).rejects.toThrow(
      "Tempo limite de resposta excedido ao carregar destinatários. Tente novamente."
    );
  });
});
