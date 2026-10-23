import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  categorizeTrelloCards,
  formatDailyReport,
  fetchTrelloBoardData,
  runTrelloDailyAudit,
} from "../services/trelloSlackReporter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);

describe("Trello Slack Daily Reporter Service", () => {
  const baseLists = [
    { id: "l1", name: "Backlog" },
    { id: "l2", name: "Em Produção" },
    { id: "l3", name: "Aguardando Aprovação" },
    { id: "l4", name: "Concluído" },
  ];

  it("deve categorizar cartões em atrasados, vencendo hoje e concluídos corretamente", () => {
    const fixedNow = new Date("2026-10-22T12:00:00Z");

    const cards = [
      {
        id: "c_ontem",
        name: "Card de Ontem",
        idList: "l2",
        due: "2026-10-21T18:00:00Z",
        dueComplete: false,
      },
      {
        id: "c_hoje",
        name: "Card de Hoje",
        idList: "l2",
        due: "2026-10-22T18:00:00Z",
        dueComplete: false,
      },
      {
        id: "c_bloqueado",
        name: "Card Bloqueado",
        idList: "l3",
        due: "2026-10-23T18:00:00Z",
        dueComplete: false,
      },
      {
        id: "c_concluido",
        name: "Card Entregue",
        idList: "l4",
        due: "2026-10-22T10:00:00Z",
        dueComplete: true,
      },
    ];

    const res = categorizeTrelloCards(cards, baseLists, fixedNow);

    expect(res.overdue.length).toBe(1);
    expect(res.overdue[0].name).toBe("Card de Ontem");

    expect(res.dueToday.length).toBe(1);
    expect(res.dueToday[0].name).toBe("Card de Hoje");

    expect(res.blocked.length).toBe(1);
    expect(res.blocked[0].name).toBe("Card Bloqueado");

    expect(res.completed.length).toBe(1);
    expect(res.completed[0].name).toBe("Card Entregue");
  });

  it("deve formatar relatório matinal com alertas e foco nas prioridades", () => {
    const summary = {
      overdue: [{ name: "Atraso 1", listName: "Design" }],
      dueToday: [{ name: "Entrega 1", listName: "Tráfego" }],
      blocked: [{ name: "Gargalo 1", listName: "Aguardando Cliente" }],
      completed: [],
      inProgress: [],
    };

    const text = formatDailyReport({
      boardName: "Operações Teste",
      summary,
      mode: "morning",
    });

    expect(text).toContain("CHECK-IN MATINAL OPERACIONAL (09h00)");
    expect(text).toContain("DEMANDAS ATRASADAS (1)");
    expect(text).toContain("Atraso 1");
    expect(text).toContain("ENTREGAS INEGOCIÁVEIS DE HOJE (1)");
    expect(text).toContain("GARGALOS & DEMANDAS AGUARDANDO APROVAÇÃO (1)");
  });

  it("deve formatar relatório vespertino com concluídos e fila de amanhã", () => {
    const summary = {
      overdue: [{ name: "Pendente 1", listName: "Design" }],
      dueToday: [],
      blocked: [],
      completed: [{ name: "Entrega Finalizada" }],
      inProgress: [],
    };

    const text = formatDailyReport({
      boardName: "Operações Teste",
      summary,
      mode: "evening",
    });

    expect(text).toContain("CHECK-OUT VESPERTINO OPERACIONAL (18h00)");
    expect(text).toContain("ENTREGAS CONCLUÍDAS HOJE (1)");
    expect(text).toContain("Entrega Finalizada");
    expect(text).toContain("ENCABEÇAM A FILA DE AMANHÃ (1)");
  });

  it("deve executar em modo dry-run sem disparar chamadas externas ao Slack", async () => {
    const auditRes = await runTrelloDailyAudit({
      mode: "morning",
      dryRun: true,
      allowMock: true,
    });

    expect(auditRes.success).toBe(true);
    expect(auditRes.dryRun).toBe(true);
    expect(auditRes.reportText).toContain("CHECK-IN MATINAL");
  });

  it("deve executar o script CLI com --dry-run e gerar saída válida no stdout", async () => {
    const scriptPath = path.resolve(__dirname, "../scripts/trello-slack-daily-reporter.mjs");
    expect(fs.existsSync(scriptPath)).toBe(true);

    const { stdout } = await execFileAsync(process.execPath, [
      scriptPath,
      "--mode=morning",
      "--dry-run",
    ]);

    expect(stdout).toContain("AUDITORIA OPERACIONAL TRELLO ↔ SLACK (MORNING)");
    expect(stdout).toContain("Execução em modo Dry Run finalizada com sucesso!");
    expect(stdout).toContain("CHECK-IN MATINAL OPERACIONAL (09h00)");
  });

  it("deve executar o script CLI com --evening --dry-run e gerar saída válida no stdout", async () => {
    const scriptPath = path.resolve(__dirname, "../scripts/trello-slack-daily-reporter.mjs");
    expect(fs.existsSync(scriptPath)).toBe(true);

    const { stdout } = await execFileAsync(process.execPath, [
      scriptPath,
      "--evening",
      "--dry-run",
    ]);

    expect(stdout).toContain("AUDITORIA OPERACIONAL TRELLO ↔ SLACK (EVENING)");
    expect(stdout).toContain("Execução em modo Dry Run finalizada com sucesso!");
    expect(stdout).toContain("CHECK-OUT VESPERTINO OPERACIONAL (18h00)");
  });
});
