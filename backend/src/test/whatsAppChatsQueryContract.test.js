import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

describe("WhatsApp Chats Query Contract — Integridade de countsQueryText e joins", () => {
  it("countsQueryText possui obrigatoriamente o LEFT JOIN com whatsapp_chat_states cs", () => {
    const filePath = path.resolve(__dirname, "../domains/chatbot/routes.js");
    const content = fs.readFileSync(filePath, "utf-8");

    // Encontra o bloco countsQueryText
    const match = content.match(/countsQueryText\s*=\s*`([\s\S]*?)`;/);
    expect(match).toBeTruthy();
    const query = match[1];

    // 1. Deve conter FROM latest_messages m
    expect(query).toMatch(/FROM\s+latest_messages\s+m/i);

    // 2. Deve conter LEFT JOIN com whatsapp_chat_states cs usando $1 e cs.phone = m.phone
    expect(query).toMatch(/LEFT\s+JOIN\s+public\.whatsapp_chat_states\s+cs\s+ON\s+cs\.client_id\s*=\s*\$1\s+AND\s+cs\.phone\s*=\s*m\.phone/i);

    // 3. Deve usar countsParams condicional
    expect(content).toMatch(/const\s+countsParams\s*=\s*instanceAliases\s*&&\s*instanceAliases\.length\s*>\s*0\s*\?\s*\[clientId,\s*instanceAliases\]\s*:\s*\[clientId\]/);

    // 4. Todas as referências a colunas cs. (state, attended_at) estão protegidas pela presença do alias cs
    const hasCsReferences = query.includes("cs.state") && query.includes("cs.attended_at");
    expect(hasCsReferences).toBe(true);
    expect(query.includes("LEFT JOIN public.whatsapp_chat_states cs")).toBe(true);
  });

  it("garante que falhas de Postgres na rota /api/whatsapp/chats registram erro detalhado com step, sql e params", () => {
    const filePath = path.resolve(__dirname, "../domains/chatbot/routes.js");
    const content = fs.readFileSync(filePath, "utf-8");

    // Verifica presença de lastQueryInfo rastreando step, sql e params
    expect(content).toContain("lastQueryInfo = { step:");
    expect(content).toContain("lastQueryInfo.step");
    expect(content).toContain("lastQueryInfo.params");
    expect(content).toContain("lastQueryInfo.sql");
    expect(content).toContain("console.error(\"[whatsapp/chats] Falha na consulta PostgreSQL no inbox:\"");
  });

  it("garante que identificador de chip desconhecido emite log de alerta", async () => {
    const { resolveInstanceIdentifier } = await import("../services/evolution.js");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mockDb = {
      query: vi.fn(async () => ({
        rows: [
          {
            id: "chip-1",
            client_id: "geracao-digital",
            name: "Gabriel - Comercial Agência GD",
            dispatch_webhook_url: "https://vexo-evolution.com/gd-gabriel",
          },
        ],
      })),
    };

    const res = await resolveInstanceIdentifier({
      clientId: "geracao-digital",
      identifier: "GD Gabriel", // Nome amigável inexistente (o cadastrado é "Gabriel - Comercial Agência GD")
      pool: mockDb,
    });

    expect(res.chip).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    const warnMessage = warnSpy.mock.calls.find((call) =>
      typeof call[0] === "string" && call[0].includes("[resolveInstanceIdentifier] Identificador de chip \"GD Gabriel\"")
    );
    expect(warnMessage).toBeTruthy();
    warnSpy.mockRestore();
  });
});
