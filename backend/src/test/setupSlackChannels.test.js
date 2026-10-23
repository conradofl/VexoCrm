import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);

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

  it("deve carregar o ponto de entrada do script sem erro de importação", async () => {
    const srcScriptPath = path.resolve(__dirname, "../scripts/setup-slack-channels.mjs");
    const rootScriptPath = path.resolve(__dirname, "../../scripts/setup-slack-channels.mjs");
    const activePath = fs.existsSync(srcScriptPath) ? srcScriptPath : rootScriptPath;

    try {
      await execFileAsync(process.execPath, [activePath], {
        env: { ...process.env, SLACK_BOT_TOKEN: "" },
      });
      expect.unreachable("Deveria sair com código de erro quando token não é fornecido");
    } catch (err) {
      // O script deve rodar, validar o token e exibir erro amigável, sem lançar ERR_MODULE_NOT_FOUND
      const output = `${err.stdout || ""} ${err.stderr || ""}`;
      expect(output).not.toContain("ERR_MODULE_NOT_FOUND");
      expect(output).toContain("SETUP DE CANAIS OFICIAIS DO SLACK");
      expect(output).toContain("ERRO FATAL: SLACK_BOT_TOKEN não informado");
    }
  });
});
