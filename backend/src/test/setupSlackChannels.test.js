import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Setup Slack Channels Script", () => {
  it("o script deve existir e possuir a lista de 6 canais oficiais obrigatórios", () => {
    const srcScriptPath = path.resolve(__dirname, "../scripts/setup-slack-channels.mjs");
    const rootScriptPath = path.resolve(__dirname, "../../scripts/setup-slack-channels.mjs");
    expect(fs.existsSync(srcScriptPath) || fs.existsSync(rootScriptPath)).toBe(true);
    const activePath = fs.existsSync(srcScriptPath) ? srcScriptPath : rootScriptPath;
    const content = fs.readFileSync(activePath, "utf-8");
    const requiredChannels = [
      "00-comunicados",
      "01-ops-geral",
      "01-ops-trafego",
      "01-ops-criativos",
      "01-ops-comercial",
      "99-resenha",
    ];

    for (const ch of requiredChannels) {
      expect(content).toContain(ch);
    }
  });

  it("o script deve validar a presença do SLACK_BOT_TOKEN antes de criar canais", () => {
    const srcScriptPath = path.resolve(__dirname, "../scripts/setup-slack-channels.mjs");
    const rootScriptPath = path.resolve(__dirname, "../../scripts/setup-slack-channels.mjs");
    const activePath = fs.existsSync(srcScriptPath) ? srcScriptPath : rootScriptPath;
    const content = fs.readFileSync(activePath, "utf-8");
    expect(content).toContain("SLACK_BOT_TOKEN");
    expect(content).toContain("auth.test");
    expect(content).toContain("conversations.create");
  });
});
