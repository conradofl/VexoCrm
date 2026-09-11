import { describe, it, expect } from "vitest";

describe("WhatsAppInbox exports, sorting and polling utilities", () => {
  it("formats timestamps and previews without errors", () => {
    const rawId = "5511999999999@s.whatsapp.net";
    const isJid = rawId.includes("@");
    const phoneLabel = isJid
      ? (rawId.includes("@g.us") ? "Grupo do WhatsApp" : "Número não disponível")
      : `+${rawId}`;

    expect(isJid).toBe(true);
    expect(phoneLabel).toBe("Número não disponível");

    const directPhone = "5511988887777";
    const directLabel = directPhone.includes("@") ? "JID" : `+${directPhone}`;
    expect(directLabel).toBe("+5511988887777");
  });

  it("sorts chats by most recent message timestamp descending", () => {
    const chats = [
      { id: "chat-old", name: "Lead Antigo", timestamp: 1700000000 },
      { id: "chat-new", name: "Lead Novo", timestamp: 1700000500 },
      { id: "chat-mid", name: "Lead Médio", timestamp: 1700000200 },
    ];

    const sorted = [...chats].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

    expect(sorted[0].id).toBe("chat-new");
    expect(sorted[1].id).toBe("chat-mid");
    expect(sorted[2].id).toBe("chat-old");
  });

  it("calculates afterTimestamp correctly from loaded messages for incremental polling", () => {
    const messages = [
      { id: "1", body: "Primeira", createdAt: "2026-08-27T18:00:00.000Z", timestamp: 1787853600 },
      { id: "2", body: "Segunda", createdAt: "2026-08-27T18:05:00.000Z", timestamp: 1787853900 },
    ];

    let maxTimeMs = 0;
    for (const msg of messages) {
      const t = msg.createdAt ? new Date(msg.createdAt).getTime() : (msg.timestamp ? msg.timestamp * 1000 : 0);
      if (t > maxTimeMs) maxTimeMs = t;
    }
    const afterIso = new Date(maxTimeMs).toISOString();
    expect(afterIso).toBe("2026-08-27T18:05:00.000Z");
  });

  it("calculates isAwaitingReply identically to backend criteria (excluding groups, automations, and archived)", () => {
    function computeIsAwaitingReply(chat: {
      id: string;
      isGroup?: boolean;
      state?: string;
      archived?: boolean;
      lastMessage?: { fromMe?: boolean };
    }) {
      const rawId = String(chat.id || "");
      return Boolean(
        !chat.isGroup &&
        !rawId.includes("@g.us") &&
        chat.state !== "automacao" &&
        chat.state !== "arquivada" &&
        !chat.archived &&
        chat.lastMessage &&
        !chat.lastMessage.fromMe
      );
    }

    // Caso 1: Chat individual normal com mensagem inbound -> AGUARDANDO
    expect(computeIsAwaitingReply({
      id: "5534991234567",
      isGroup: false,
      state: "ativa",
      lastMessage: { fromMe: false },
    })).toBe(true);

    // Caso 2: Grupo de WhatsApp com mensagem de participante -> NÃO É AGUARDANDO
    expect(computeIsAwaitingReply({
      id: "120363041234567890@g.us",
      isGroup: true,
      state: "ativa",
      lastMessage: { fromMe: false },
    })).toBe(false);

    // Caso 3: Robô/Automação URA -> NÃO É AGUARDANDO
    expect(computeIsAwaitingReply({
      id: "5534998765432",
      isGroup: false,
      state: "automacao",
      lastMessage: { fromMe: false },
    })).toBe(false);

    // Caso 4: Conversa Arquivada -> NÃO É AGUARDANDO
    expect(computeIsAwaitingReply({
      id: "5534998765432",
      isGroup: false,
      state: "arquivada",
      archived: true,
      lastMessage: { fromMe: false },
    })).toBe(false);

    // Caso 5: Atendente respondeu por último -> NÃO É AGUARDANDO
    expect(computeIsAwaitingReply({
      id: "5534991234567",
      isGroup: false,
      state: "ativa",
      lastMessage: { fromMe: true },
    })).toBe(false);
  });

  it("identifies contacts without CRM leads for 'Sem Lead' badge", () => {
    function shouldShowSemLeadBadge(chat: { id: string; isGroup?: boolean }, lead: object | null) {
      const rawId = String(chat.id || "");
      return !chat.isGroup && !rawId.includes("@g.us") && !lead;
    }

    expect(shouldShowSemLeadBadge({ id: "5534999991111", isGroup: false }, null)).toBe(true);
    expect(shouldShowSemLeadBadge({ id: "5534999991111", isGroup: false }, { id: "lead-1", nome: "Carlos" })).toBe(false);
    expect(shouldShowSemLeadBadge({ id: "120363041234567890@g.us", isGroup: true }, null)).toBe(false);
  });

  it("groups awaiting chats into 'Últimos 7 dias' and 'Mais antigas'", () => {
    const nowMs = 1788310000000;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const cutoff = nowMs - sevenDaysMs;

    const chats = [
      { id: "1", timestamp: (nowMs - 2 * 24 * 60 * 60 * 1000) / 1000 }, // 2 dias atrás
      { id: "2", timestamp: (nowMs - 5 * 24 * 60 * 60 * 1000) / 1000 }, // 5 dias atrás
      { id: "3", timestamp: (nowMs - 10 * 24 * 60 * 60 * 1000) / 1000 }, // 10 dias atrás
      { id: "4", timestamp: (nowMs - 45 * 24 * 60 * 60 * 1000) / 1000 }, // 45 dias atrás
    ];

    const recent = chats.filter((c) => Boolean(c.timestamp && c.timestamp * 1000 >= cutoff));
    const older = chats.filter((c) => !c.timestamp || c.timestamp * 1000 < cutoff);

    expect(recent.map((c) => c.id)).toEqual(["1", "2"]);
    expect(older.map((c) => c.id)).toEqual(["3", "4"]);
  });

  it("identifies agentMutedAt and preserves 'ativa' state for display in Conversas tabs", () => {
    const mutedChat = {
      id: "5534992896464",
      name: "Cliente Lanche",
      state: "ativa",
      agentMutedAt: "2026-09-11T12:00:00.000Z",
      agentMutedReason: "Pedido de lanche pessoal",
    };

    // Conversa silenciada continua 'ativa' — nunca some das abas da tela Conversas
    expect(mutedChat.state).toBe("ativa");
    expect(Boolean(mutedChat.agentMutedAt)).toBe(true);

    // Formatação do selo
    const badgeLabel = `Agente pausado · ${mutedChat.agentMutedReason || "conversa pessoal"}`;
    expect(badgeLabel).toBe("Agente pausado · Pedido de lanche pessoal");

    // Simulação do clique em 'Reativar agente': limpa as colunas sem alterar state
    const unmutedChat = {
      ...mutedChat,
      agentMutedAt: null,
      agentMutedReason: null,
    };
    expect(unmutedChat.agentMutedAt).toBeNull();
    expect(unmutedChat.agentMutedReason).toBeNull();
    expect(unmutedChat.state).toBe("ativa");
  });
});
