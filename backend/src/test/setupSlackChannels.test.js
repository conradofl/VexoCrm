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

  it("--dry-run carrega o ponto de entrada sem erro de importação e não faz nenhuma chamada de rede", async () => {
    const srcScriptPath = path.resolve(__dirname, "../scripts/setup-slack-channels.mjs");
    const rootScriptPath = path.resolve(__dirname, "../../scripts/setup-slack-channels.mjs");
    const activePath = fs.existsSync(srcScriptPath) ? srcScriptPath : rootScriptPath;

    // Token presente (falso) para o script passar da validação, e fetch trocado por um que acusa a chamada: se o
    // dry-run não parar antes da rede, o teste falha em vez de criar canal. Sem --dry-run, rodar o script aqui leria o
    // token real de backend/.env e criaria os seis canais.
    const fetchQueAcusa = `data:text/javascript,globalThis.fetch=async()=>{console.log("CHAMADA_DE_REDE");throw new Error("CHAMADA_DE_REDE")}`;
    const { stdout, stderr } = await execFileAsync(process.execPath, ["--import", fetchQueAcusa, activePath, "--dry-run"], {
      env: { ...process.env, SLACK_BOT_TOKEN: "xoxb-falso-de-teste" },
    });
    const output = `${stdout} ${stderr}`;
    expect(output).not.toContain("ERR_MODULE_NOT_FOUND");
    expect(output).not.toContain("CHAMADA_DE_REDE");
    expect(output).toContain("SETUP DE CANAIS OFICIAIS DO SLACK");
    expect(output).toContain("Nenhuma chamada ao Slack");
    for (const ch of ["00-comunicados", "01-ops-geral", "01-ops-trafego", "01-ops-criativos", "01-ops-comercial", "99-resenha"]) {
      expect(output).toContain(`#${ch}`);
    }
  });
});
