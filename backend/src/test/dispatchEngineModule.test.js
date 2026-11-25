// PR 8 do untangle: o motor do lote mora em campaign/dispatchEngine.js e pode ser criado sem registrar as rotas.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createCampaignDispatchEngine } from "../campaign/dispatchEngine.js";

describe("campaign/dispatchEngine.js", () => {
  it("cria o motor sem registrar rota nenhuma", () => {
    const engine = createCampaignDispatchEngine({});
    expect(typeof engine.runCampaignDispatchSemRegistro).toBe("function");
  });

  it("routes.js não tem mais o corpo do motor, só o repasse", () => {
    const rotas = readFileSync(resolve("src/domains/campaigns/routes.js"), "utf8");
    expect(rotas).not.toMatch(/async function runCampaignDispatchSemRegistro\(/);
    expect(rotas).toMatch(/createCampaignDispatchEngine\(\{/);
    const motor = readFileSync(resolve("src/campaign/dispatchEngine.js"), "utf8");
    expect(motor).toMatch(/async function runCampaignDispatchSemRegistro\(\{ dispatch, campaign, supabase: db, ignoreSendWindow = false \}\)/);
    expect(motor).not.toMatch(/from "\.\.\/domains\/campaigns\/routes\.js"/);
  });
});
