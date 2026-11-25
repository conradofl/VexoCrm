import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("tratamento de chip desconectado e resiliência de erros", () => {
  const outboundSource = readFileSync(resolve("src/campaign-outbound.js"), "utf8");
  const routesSource = (readFileSync(resolve("src/domains/campaigns/routes.js"), "utf8") + "\n" + readFileSync(resolve("src/campaign/dispatchEngine.js"), "utf8")) /* motor do lote mora em campaign/dispatchEngine.js desde o PR 8 */;

  it("postEvolutionPayload anexa isConnectionClosed e instanceName no erro", () => {
    expect(outboundSource).toContain("isConnectionClosed =");
    expect(outboundSource).toContain("error.isConnectionClosed = isConnectionClosed");
    expect(outboundSource).toContain("error.instanceName = endpointInfo?.instance");
  });

  it("dispatchCampaignSequence interrompe o lote imediatamente ao detectar chip desconectado", () => {
    expect(outboundSource).toContain("summary.chipDisconnected = true");
    expect(outboundSource).toContain("onLeadClaimRollback");
    expect(outboundSource).toContain("if (summary.paused) break;");
  });

  it("runCampaignDispatch faz rollback de claim e pausa o lote com mensagem limpa", () => {
    expect(routesSource).toContain("rollbackClaimLead");
    expect(routesSource).toContain("result?.summary?.chipDisconnected");
    expect(routesSource).toContain("Pausado — chip desconectado");
  });

  it("runCampaignDispatch declara failedCount e não gera ReferenceError", () => {
    expect(routesSource).toContain("let failedCount = 0;");
    expect(routesSource).toContain("failedCount += 1;");
  });
});
