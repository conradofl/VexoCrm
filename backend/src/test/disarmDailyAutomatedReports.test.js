import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HELOISA_TOOLS } from "../domains/goclaw/heloisaEngine.js";

describe("Corte de relatórios automáticos diários (economia de tokens)", () => {
  it("server.js NÃO inicia startGdVigiaScheduler nem startTrelloSlackScheduler no boot", () => {
    const serverSrc = readFileSync(resolve("src/server.js"), "utf8");
    const fnMatch = serverSrc.match(/function startBackgroundServices\(\)\s*\{([\s\S]*?)\n\}/);
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch[1];

    expect(fnBody).not.toMatch(/\bstartGdVigiaScheduler\s*\(/);
    expect(fnBody).not.toMatch(/\bstartTrelloSlackScheduler\s*\(/);
    expect(fnBody).not.toMatch(/\bstartGdCustomerSuccessScheduler\s*\(/);
  });

  it("goclaw/goclaw.yaml NÃO possui schedules automáticos 09h00/18h00 para whatsapp:donos", () => {
    const goclawYaml = readFileSync(resolve("../goclaw/goclaw.yaml"), "utf8");
    expect(goclawYaml).not.toMatch(/0\s+9\s+\*\s+\*\s+1-5/);
    expect(goclawYaml).not.toMatch(/0\s+18\s+\*\s+\*\s+1-5/);
    expect(goclawYaml).not.toMatch(/whatsapp:donos/);
  });

  it("Heloísa mantém ferramentas sob demanda (consultar_operacao e auditar_geral_vexo) para quando o diretor pedir", () => {
    const toolNames = HELOISA_TOOLS.map((t) => t.function?.name);
    expect(toolNames).toContain("consultar_operacao");
    expect(toolNames).toContain("auditar_geral_vexo");
    expect(toolNames).toContain("consultar_campanhas_vexo");
    expect(toolNames).toContain("consultar_dashboard_vexo");
  });
});
