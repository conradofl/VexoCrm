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
});
