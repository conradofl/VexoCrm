// Servidor de mentira da aba Conversas, usado pelas provas em Chromium (computador e celular).
// Responde a /api/** com o volume da Geração Digital e guarda o que a tela pediu.
import { expect, type Page, type Route } from "@playwright/test";

export const PAGE_URL = "/e2e/harness/conversas-pagina.html";
export const TOTAL = 883;
export const SHOTS = process.env.HARNESS_SHOTS_DIR || "test-results/harness";
export const NOW_S = () => Math.floor(Date.now() / 1000);

export const tenant = {
  id: "geracao-digital",
  name: "Geração Digital",
  n8n_settings: {
    evolution_instances: [
      { id: "comercial-hostery", name: "Comercial - Hostery", active: true, is_default: true },
      { id: "caio", name: "Caio", active: true, is_default: false },
      { id: "chip-caido", name: "Chip Caído", active: true, is_default: false, connection_state: "close" },
    ],
  },
};

export const NAMES = ["Jéssica Mendonça", "AM. Conrado — 30.09", "Gabriel Oliveira", "+55 (34) 9 9221-0017", "Moacir Pires"];

export function chat(i: number, tab: string) {
  const phone = `55349${String(90000000 + i).padStart(8, "0")}`;
  // Fila "esperam": o mais parado primeiro. 1º há 2 dias, 2º há 38 min, 3º há 1h12, depois crescente.
  const waitedMin = i === 1 ? 2 * 24 * 60 : i === 2 ? 38 : i === 3 ? 72 : 5 + i;
  const ts = NOW_S() - waitedMin * 60 - 20; // 20 s de folga: o rótulo não vira o minuto no meio do teste
  const fromMe = tab === "com_lead" || tab === "robo";
  return {
    id: phone,
    name: NAMES[i - 1] || `Contato ${i} da Silva Albuquerque`,
    profilePic: null,
    isGroup: tab === "grupos",
    unreadCount: 0,
    timestamp: ts,
    archived: false,
    state: "ativa",
    stateReason: null,
    stateSource: "auto",
    isNumberChange: false,
    pinned: false,
    muted: false,
    attendedAt: null,
    attendedBy: null,
    agentMutedAt: i === 2 ? new Date(Date.now() - 3_600_000).toISOString() : null,
    agentMutedReason: i === 2 ? "Atendimento humano" : null,
    lastMessage: {
      id: String(i),
      body:
        i === 1
          ? "Quero aproveitar, pode mandar"
          : i === 4
          ? "[Mensagem]"
          : i === 5
          ? "[sticker]"
          : i === 6
          ? "[Localização] Padaria Central · Rua A, 10"
          : `Mensagem ${i} (${tab}): consegue me passar o valor ainda hoje, por favor?`,
      fromMe,
      senderType: tab === "robo" ? "bot" : fromMe ? "device" : "lead",
      timestamp: ts,
      type: "chat",
      meta: null,
    },
    leadOrigin: i === 1 || i === 3 ? "campaign" : null,
    sourceCampaignId: i === 1 ? "camp-1" : null,
    workState: tab,
    waitingSince: fromMe ? null : new Date(ts * 1000).toISOString(),
    leadNeverSpoke: false,
    // Conversa 3: o lead escreveu num chip que está desconectado.
    leadChip: i === 1 ? "caio" : i === 3 ? "chip-caido" : "comercial-hostery",
  };
}

export const COUNTS = {
  active: TOTAL,
  awaiting: 60,
  automations: 17,
  groups: 72,
  archived: 5,
  paused: 2,
  myUnopened: 0,
  work: { esperam: 14, com_lead: 31, robo: 171, esfriaram: 667 },
};

export const chatsPage = (tab = "esperam") => ({
  items: Array.from({ length: 40 }, (_, i) => chat(i + 1, tab)),
  total: TOTAL,
  counts: COUNTS,
  chipAgents: {
    "comercial-hostery": { kind: "empresa", agentName: null, reason: "robo_da_empresa" },
    caio: { kind: "nenhum", agentName: null, reason: "chip_pessoal" },
  },
  nextOffset: 40,
  hasMore: true,
});

export const leads = [
  {
    id: "lead-1",
    client_id: "geracao-digital",
    telefone: "5534990000001",
    nome: "Jéssica Mendonça",
    stage: "inquiry",
    status: "inquiry",
    assigned_to: null,
    dados: {},
    created_at: "2026-11-03T12:00:00Z",
  },
];

// Mensagens sem texto no meio da conversa: uma antiga (só "[Mensagem]"), uma figurinha e uma localização.
export const SPECIAL_BODIES: Record<number, string> = { 24: "[Mensagem]", 26: "[sticker]", 28: "[Localização] Padaria Central · Rua A, 10" };

export const messagesFor = (chatId: string) =>
  Array.from({ length: 30 }, (_, i) => ({
    id: `${chatId}-${i}`,
    body: SPECIAL_BODIES[i] ?? (i % 2 === 0 ? `Mensagem do lead número ${i}, com texto suficiente para ocupar a linha.` : `Resposta nossa número ${i}.`),
    fromMe: i % 2 === 1,
    senderType: i % 2 === 1 ? "device" : "lead",
    timestamp: NOW_S() - (30 - i) * 300,
    type: "chat",
    hasMedia: false,
    from: null,
    to: null,
    author: null,
  }));

export type ChatsHandler = (route: Route, url: URL) => Promise<void> | void;
export interface Served {
  sent: { chatId: string; body: string; confirmChipId?: string }[];
  /** Pedidos de envio que o servidor recusou com 409 (chip da conversa desconectado). */
  refused: { chatId: string; body: string }[];
  tabs: string[];
  /** Lembretes/reuniões gravados, como o servidor de verdade guardaria. */
  reminders: Record<string, unknown>[];
  deletedReminders: string[];
}

export const CHAT_ON_DOWN_CHIP = "5534990000003";

export async function serve(page: Page, chats: ChatsHandler = (route, url) => ok(route, chatsPage(url.searchParams.get("tab") || "esperam"))) {
  const served: Served = { sent: [], refused: [], tabs: [], reminders: [], deletedReminders: [] };
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/whatsapp/chats") {
      served.tabs.push(url.searchParams.get("tab") || "");
      return chats(route, url);
    }
    if (url.pathname === "/api/whatsapp/messages" && req.method() === "POST") {
      const body = req.postDataJSON();
      // Mesma regra do servidor: chip da conversa desconectado e sem confirmação = 409, nada enviado.
      if (body.chatId === CHAT_ON_DOWN_CHIP && !body.confirmChipId) {
        served.refused.push({ chatId: body.chatId, body: body.body });
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "REPLY_CHIP_UNAVAILABLE",
              message: "O chip Chip Caído, em que o lead escreveu, está desconectado. Confirme por qual chip enviar.",
              details: {
                reason: "disconnected",
                conversationChip: "Chip Caído",
                alternatives: [
                  { id: "comercial-hostery", name: "Comercial - Hostery", isDefault: true },
                  { id: "caio", name: "Caio", isDefault: false },
                ],
              },
            },
          }),
        });
      }
      served.sent.push({ chatId: body.chatId, body: body.body, ...(body.confirmChipId ? { confirmChipId: body.confirmChipId } : {}) });
      return json({ item: { id: "novo", body: body.body, fromMe: true, timestamp: NOW_S(), type: "chat", hasMedia: false } });
    }
    if (url.pathname === "/api/reminders/inbox-summary") {
      const itemsByPhone: Record<string, unknown> = {};
      for (const r of served.reminders) {
        const phone = String(r.phone);
        itemsByPhone[phone] = { phone, activeSchedule: null, activeReminders: [r], todayDue: null };
      }
      return json({ success: true, todayCount: 0, scheduledTodayCount: 0, remindersTodayCount: 0, itemsByPhone });
    }
    if (url.pathname === "/api/reminders" && req.method() === "POST") {
      const body = req.postDataJSON();
      const reminder = {
        id: `rem-${served.reminders.length + 1}`,
        clientId: "geracao-digital",
        leadId: body.leadId ?? null,
        phone: String(body.phone).replace(/\D/g, ""),
        leadName: body.leadName ?? null,
        title: body.title,
        notes: body.notes ?? null,
        remindAt: body.remindAt,
        status: "pending",
        activityType: body.activityType,
        meetingUrl: body.meetingUrl ?? null,
        createdAt: new Date().toISOString(),
      };
      served.reminders.push(reminder);
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ success: true, reminder }) });
    }
    if (url.pathname.startsWith("/api/reminders/") && req.method() === "DELETE") {
      const id = decodeURIComponent(url.pathname.split("/").pop() || "");
      served.reminders = served.reminders.filter((r) => r.id !== id);
      served.deletedReminders.push(id);
      return json({ success: true, deletedId: id });
    }
    if (url.pathname === "/api/whatsapp/messages") {
      return json({ items: messagesFor(url.searchParams.get("chatId") || ""), hasMore: false });
    }
    if (url.pathname === "/api/lead-clients") return json({ items: [tenant] });
    if (url.pathname === "/api/leads") return json({ items: leads });
    if (url.pathname === "/api/campaigns") return json({ items: [{ id: "camp-1", name: "teste de bastão" }] });
    return json({ items: [], data: [], success: true });
  });
  return served;
}

export const ok = (route: Route, body: unknown = chatsPage()) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

export const inViewport = async (page: Page, testId: string) => {
  const box = await page.getByTestId(testId).boundingBox();
  const vp = page.viewportSize()!;
  expect(box, testId).not.toBeNull();
  expect(box!.x, `${testId} x`).toBeGreaterThanOrEqual(0);
  expect(box!.y, `${testId} y`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${testId} direita`).toBeLessThanOrEqual(vp.width + 0.5);
  expect(box!.y + box!.height, `${testId} base`).toBeLessThanOrEqual(vp.height + 0.5);
  return box!;
};

export const firstCard = (page: Page) => page.getByTestId("inbox-item-5534990000001");
