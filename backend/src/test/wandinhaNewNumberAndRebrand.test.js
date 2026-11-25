import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("../services/evolution.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    sendTextMessageViaEvolution: vi.fn(async () => ({ key: { id: "wa-wandinha-1" } })),
  };
});

import { sendTextMessageViaEvolution } from "../services/evolution.js";
import {
  obterInstanciaWhatsAppAtiva,
  enviarMensagemWhatsAppComFallback,
  WANDINHA_OFFICIAL_PHONE,
} from "../domains/goclaw/heloisaEngine.js";

describe("Wandinha (ex-Heloísa) · Novo número +553488370439 (Wandinha GD) e rebrand completo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prioriza o chip 'Wandinha GD' (+553488370439) em Vexo Adm, ignora 'Conrado Extracao' e envia normalmente para Conrado e Caio (+553497719779)", async () => {
    expect(WANDINHA_OFFICIAL_PHONE).toBe("553488370439");

    const mockPool = {
      query: vi.fn(async () => ({
        rows: [
          {
            name: "Conrado Extracao",
            phone: "+553497817660",
            client_id: "vexo-adm",
            is_default: true,
            connection_state: "open",
            dispatch_webhook_url: "https://evo.exemplo/message/sendText/vexo-adm-conrado-extracao",
            dispatch_webhook_token: "tok-conrado",
          },
          {
            name: "Vexo campanha",
            phone: "+553491751267",
            client_id: "vexo-adm",
            is_default: false,
            connection_state: "open",
            dispatch_webhook_url: "https://evo.exemplo/message/sendText/vexo-adm-vexo-campanha",
            dispatch_webhook_token: "tok-campanha",
          },
          {
            name: "Wandinha GD",
            phone: "+553488370439",
            client_id: "vexo-adm",
            is_default: false,
            connection_state: "open",
            dispatch_webhook_url: "https://evo.exemplo/message/sendText/vexo-adm-wandinha-gd",
            dispatch_webhook_token: "tok-wandinha",
          },
        ],
      })),
    };

    const slug = await obterInstanciaWhatsAppAtiva(mockPool, "vexo-adm");
    expect(slug).toBe("vexo-adm-wandinha-gd");

    const resConrado = await enviarMensagemWhatsAppComFallback({
      numero: "5534997817660",
      texto: "Oi Conrado, tudo pronto!",
      instanceName: "vexo-adm-vexo-atende",
      pool: mockPool,
    });

    expect(resConrado.instanceName).toBe("vexo-adm-wandinha-gd");
    expect(sendTextMessageViaEvolution).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceName: "vexo-adm-wandinha-gd",
        number: "5534997817660",
        webhookToken: "tok-wandinha",
      })
    );

    const resCaio = await enviarMensagemWhatsAppComFallback({
      numero: "5534997719779",
      texto: "Oi Caio, aviso de agenda!",
      instanceName: "vexo-adm-wandinha-gd",
      pool: mockPool,
    });

    expect(resCaio.instanceName).toBe("vexo-adm-wandinha-gd");
    expect(sendTextMessageViaEvolution).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceName: "vexo-adm-wandinha-gd",
        number: "5534997719779",
        webhookToken: "tok-wandinha",
      })
    );
  });

  it("prompts, menu lateral, orbe de voz e painel GoClaw foram atualizados para Wandinha (+55 34 8837-0439)", () => {
    const promptWandinha = readFileSync(resolve("../goclaw/prompts/wandinha_executiva.md"), "utf8");
    const promptLegacy = readFileSync(resolve("../goclaw/prompts/heloisa_executiva.md"), "utf8");
    expect(promptWandinha).toContain("Você é a **Wandinha**");
    expect(promptWandinha).toContain("+55 34 8837-0439");
    expect(promptLegacy).toContain("Você é a **Wandinha**");
    expect(promptLegacy).toContain("+55 34 8837-0439");

    const sidebarSrc = readFileSync(resolve("../frontend/src/lib/appSidebar/constants.ts"), "utf8");
    expect(sidebarSrc).toContain('label: "GoClaw & Wandinha"');
    expect(sidebarSrc).not.toContain("GoClaw & Heloísa");

    const orbSrc = readFileSync(resolve("../frontend/src/components/HeloisaVoiceOrb.tsx"), "utf8");
    expect(orbSrc).toContain("Sou a Wandinha");
    expect(orbSrc).toContain("Falar com a Wandinha (Voz)");
    expect(orbSrc).not.toContain("Sou a Heloísa");

    const configSrc = readFileSync(resolve("../frontend/src/pages/GeracaoDigitalGoclawConfig.tsx"), "utf8");
    expect(configSrc).toContain("Central Executiva · GoClaw & Wandinha");
    expect(configSrc).toContain("Wandinha · Secretária Executiva Master");
    expect(configSrc).not.toContain("Heloísa");
  });
});
