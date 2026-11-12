// Aba Conversas em Chromium de verdade: a PÁGINA real, com os hooks reais, contra um
// servidor de mentira (as respostas de /api/** saem daqui). Volume parecido com o da Geração
// Digital em 11/11/2026: 883 conversas na fila, 40 por página.
//
// O que este arquivo prova, e que jsdom não prova:
//   - a fila começa no topo da tela e rola dentro da coluna;
//   - cabeçalho, faixa de contexto e campo de resposta cabem na janela, no computador e em 375 px;
//   - a gaveta do dossiê abre POR CIMA da conversa, fecha (X, clique fora, Esc) e a conversa volta;
//   - trocar de aba troca a lista, e enviar mensagem chega ao servidor com o texto digitado;
//   - quando o servidor recusa ou não responde, a coluna mostra erro com saída;
//   - trocar de aba CANCELA o pedido anterior (o navegador aborta), não empilha;
//   - chip da conversa desconectado: a mensagem NÃO sai até o operador confirmar outro chip;
//   - mensagem sem texto aparece com o nome do tipo, nunca "[Mensagem]";
//   - Registrar → Reunião grava a reunião e a mesma gaveta cancela.
//
// Uso: npx playwright test --config playwright.harness.config.ts
import { expect, test, type Page, type Route } from "@playwright/test";

const PAGE_URL = "/e2e/harness/conversas-pagina.html";
const TOTAL = 883;
const SHOTS = process.env.HARNESS_SHOTS_DIR || "test-results/harness";
const NOW_S = () => Math.floor(Date.now() / 1000);

const tenant = {
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

const NAMES = ["Jéssica Mendonça", "AM. Conrado — 30.09", "Gabriel Oliveira", "+55 (34) 9 9221-0017", "Moacir Pires"];

function chat(i: number, tab: string) {
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

const COUNTS = {
  active: TOTAL,
  awaiting: 60,
  automations: 17,
  groups: 72,
  archived: 5,
  paused: 2,
  myUnopened: 0,
  work: { esperam: 14, com_lead: 31, robo: 171, esfriaram: 667 },
};

const chatsPage = (tab = "esperam") => ({
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

const leads = [
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
const SPECIAL_BODIES: Record<number, string> = { 24: "[Mensagem]", 26: "[sticker]", 28: "[Localização] Padaria Central · Rua A, 10" };

const messagesFor = (chatId: string) =>
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

type ChatsHandler = (route: Route, url: URL) => Promise<void> | void;
interface Served {
  sent: { chatId: string; body: string; confirmChipId?: string }[];
  /** Pedidos de envio que o servidor recusou com 409 (chip da conversa desconectado). */
  refused: { chatId: string; body: string }[];
  tabs: string[];
  /** Lembretes/reuniões gravados, como o servidor de verdade guardaria. */
  reminders: Record<string, unknown>[];
  deletedReminders: string[];
}

const CHAT_ON_DOWN_CHIP = "5534990000003";

async function serve(page: Page, chats: ChatsHandler = (route, url) => ok(route, chatsPage(url.searchParams.get("tab") || "esperam"))) {
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

const ok = (route: Route, body: unknown = chatsPage()) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const inViewport = async (page: Page, testId: string) => {
  const box = await page.getByTestId(testId).boundingBox();
  const vp = page.viewportSize()!;
  expect(box, testId).not.toBeNull();
  expect(box!.x, `${testId} x`).toBeGreaterThanOrEqual(0);
  expect(box!.y, `${testId} y`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${testId} direita`).toBeLessThanOrEqual(vp.width + 0.5);
  expect(box!.y + box!.height, `${testId} base`).toBeLessThanOrEqual(vp.height + 0.5);
  return box!;
};

const firstCard = (page: Page) => page.getByTestId("inbox-item-5534990000001");

test.describe("aba Conversas — tela nova, computador (1440x900)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a fila começa no topo, rola dentro da coluna e a página não rola", async ({ page }) => {
    await serve(page);
    await page.goto(PAGE_URL);
    await expect(firstCard(page)).toBeVisible();

    const column = await inViewport(page, "inbox-column");
    const card = (await firstCard(page).boundingBox())!;
    // Antes do redesenho o primeiro cartão ficava a 388 px do topo da janela.
    expect(card.y).toBeLessThan(260);
    expect(card.y - column.y).toBeLessThan(180);
    expect(card.x).toBeGreaterThanOrEqual(column.x);
    expect(card.x + card.width).toBeLessThanOrEqual(column.x + column.width + 1);

    const list = await page.getByTestId("inbox-list").evaluate((el) => ({ scrollH: el.scrollHeight, clientH: el.clientHeight }));
    expect(list.scrollH).toBeGreaterThan(list.clientH); // 40 cartões não cabem: rola dentro da coluna
    const pageScroll = await page.evaluate(() => {
      const el = document.scrollingElement!;
      return { scrollH: el.scrollHeight, clientH: el.clientHeight, scrollW: el.scrollWidth, clientW: el.clientWidth };
    });
    expect(pageScroll.scrollH).toBeLessThanOrEqual(pageScroll.clientH);
    expect(pageScroll.scrollW).toBeLessThanOrEqual(pageScroll.clientW);

    // Os três estados com o número do servidor, e o rodapé.
    await expect(page.getByTestId("inbox-tab-count-esperam")).toHaveText("14");
    await expect(page.getByTestId("inbox-tab-count-com_lead")).toHaveText("31");
    await expect(page.getByTestId("inbox-tab-count-robo")).toHaveText("171");
    await expect(page.getByTestId("inbox-order-label")).toHaveText(/mais parado primeiro/i);
    await expect(page.getByTestId("inbox-footer-count-grupos")).toHaveText("72");
    await expect(page.getByTestId("inbox-footer-count-automacao")).toHaveText("17");
    await inViewport(page, "inbox-footer-filters");

    // Urgência na borda e espera em vez de relógio.
    await expect(firstCard(page)).toHaveAttribute("data-urgency", "late");
    await expect(page.getByTestId("inbox-item-time-5534990000001")).toHaveText("2 dias parada");
    await expect(page.getByTestId("inbox-item-time-5534990000002")).toHaveText("38min");
    await expect(page.getByTestId("inbox-item-time-5534990000003")).toHaveText("1h12");
    await expect(page.getByTestId("inbox-item-flags-5534990000002")).toContainText(/você atende/i);
    await expect(page.getByTestId("inbox-item-flags-5534990000004")).toContainText(/sem lead/i);

    await page.screenshot({ path: `${SHOTS}/main-computador.png` });
    await page.getByTestId("inbox-column").screenshot({ path: `${SHOTS}/lista-computador.png` });
  });

  test("cabeçalho, faixa de contexto e campo de resposta: cabem na janela e o modo nota muda o campo inteiro", async ({ page }) => {
    await serve(page);
    await page.goto(PAGE_URL);
    await firstCard(page).click();

    await expect(page.getByTestId("chat-header-name")).toHaveText("Jéssica Mendonça");
    await expect(page.getByTestId("chat-header-sub")).toContainText("chip Caio");
    await expect(page.getByTestId("chat-context")).toContainText("Campanha: teste de bastão");
    await expect(page.getByTestId("chat-stage")).toBeVisible();
    await expect(page.getByTestId("chat-responsible")).toHaveText(/Compartilhado/);
    for (const id of ["chat-header", "chat-context", "composer", "composer-send", "dossier-open", "chat-menu"]) await inViewport(page, id);

    // O chip que assina o envio aparece antes de escrever, e é o chip em que o lead escreveu
    // (Caio), não o chip padrão da empresa (Comercial - Hostery).
    await expect(page.getByTestId("composer-hint")).toHaveText("sai do chip Caio");

    const box = page.getByTestId("composer-box");
    await expect(box).toHaveAttribute("data-mode", "whatsapp");
    const whatsappBg = await box.evaluate((el) => getComputedStyle(el).backgroundColor);
    await expect(page.getByTestId("composer-send")).toHaveText(/Enviar/);
    await page.getByTestId("composer").screenshot({ path: `${SHOTS}/composer-whatsapp.png` });

    await page.getByTestId("composer-mode-note").click();
    await expect(box).toHaveAttribute("data-mode", "note");
    await expect(page.getByTestId("composer-hint")).toHaveText("o cliente NÃO vê");
    await expect(page.getByTestId("composer-send")).toHaveText(/Salvar nota/);
    await expect.poll(() => box.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(whatsappBg);
    await page.getByTestId("composer").screenshot({ path: `${SHOTS}/composer-nota.png` });

    // Conversa com o robô pausado: uma etiqueta com a saída ao lado.
    await page.getByTestId("inbox-item-5534990000002").click();
    await expect(page.getByTestId("robot-pill")).toContainText("Robô pausado");
    await expect(page.getByTestId("robot-pill").getByRole("button", { name: "reativar" })).toBeVisible();
    await expect(page.getByTestId("chat-create-lead")).toBeVisible(); // este contato não é lead
    await expect(page.getByText("Resposta nossa número 29.")).toBeInViewport(); // abre no fim da conversa
    await page.getByTestId("inbox-conversation").screenshot({ path: `${SHOTS}/cabecalho-computador.png` });
  });

  test("enviar mensagem: Enter envia o texto digitado para a conversa aberta e o campo limpa", async ({ page }) => {
    const served = await serve(page);
    await page.goto(PAGE_URL);
    await firstCard(page).click();

    const field = page.getByLabel("Mensagem para o cliente");
    await field.fill("Oi Jéssica, já te mando o acesso.");
    await field.press("Enter");
    await expect.poll(() => served.sent.length).toBe(1);
    expect(served.sent[0]).toEqual({ chatId: "5534990000001", body: "Oi Jéssica, já te mando o acesso." });
    await expect(field).toHaveValue("");
    await expect(field).toBeFocused();

    await field.fill("Segunda mensagem");
    await page.getByTestId("composer-send").click();
    await expect.poll(() => served.sent.length).toBe(2);

    // Nota interna NÃO vai para o servidor de mensagens.
    await page.getByTestId("composer-mode-note").click();
    await page.getByLabel("Nota interna para a equipe").fill("cliente pediu retorno na sexta");
    await page.getByTestId("composer-send").click();
    await expect(page.getByText("cliente pediu retorno na sexta")).toBeVisible();
    expect(served.sent.length).toBe(2);
  });

  test("chip da conversa desconectado: nada sai sem confirmação, e a confirmação envia pelo chip escolhido", async ({ page }) => {
    const served = await serve(page);
    await page.goto(PAGE_URL);
    await page.getByTestId(`inbox-item-${CHAT_ON_DOWN_CHIP}`).click();

    // Antes de escrever a tela já avisa.
    await expect(page.getByTestId("composer-hint")).toHaveText("chip Chip Caído desconectado · vai pedir confirmação");

    const field = page.getByLabel("Mensagem para o cliente");
    await field.fill("Gabriel, segue a proposta.");
    await field.press("Enter");

    // O servidor recusou: nada enviado, a tela pede confirmação e mostra o texto que ficou parado.
    const confirm = page.getByTestId("chip-confirm");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("Mensagem não enviada");
    await expect(confirm).toContainText("está desconectado");
    await expect(page.getByTestId("chip-confirm-pending")).toContainText("Gabriel, segue a proposta.");
    await expect(page.getByTestId("chip-confirm-option")).toHaveCount(2);
    expect(served.refused).toHaveLength(1);
    expect(served.sent).toHaveLength(0);
    await inViewport(page, "chip-confirm");
    await page.getByTestId("composer").screenshot({ path: `${SHOTS}/chip-confirmacao.png` });

    // Desistir devolve o texto ao campo e continua sem enviar nada.
    await page.getByTestId("chip-confirm-cancel").click();
    await expect(confirm).toHaveCount(0);
    await expect(field).toHaveValue("Gabriel, segue a proposta.");
    expect(served.sent).toHaveLength(0);

    // Tenta de novo e confirma outro chip: aí sim envia, dizendo ao servidor qual chip foi confirmado.
    await page.getByTestId("composer-send").click();
    await expect(confirm).toBeVisible();
    await page.getByTestId("chip-confirm-option").filter({ hasText: "Comercial - Hostery" }).click();
    await expect.poll(() => served.sent.length).toBe(1);
    expect(served.sent[0]).toEqual({ chatId: CHAT_ON_DOWN_CHIP, body: "Gabriel, segue a proposta.", confirmChipId: "comercial-hostery" });
    await expect(confirm).toHaveCount(0);
    await expect(field).toHaveValue("");
  });

  test("mensagem sem texto mostra o nome do tipo, na fila e na conversa, nunca [Mensagem]", async ({ page }) => {
    await serve(page);
    await page.goto(PAGE_URL);
    await expect(firstCard(page)).toBeVisible();

    await expect(page.getByTestId("inbox-item-5534990000004")).toContainText("Mensagem sem texto (tipo não registrado)");
    await expect(page.getByTestId("inbox-item-5534990000005")).toContainText("Figurinha");
    await expect(page.getByTestId("inbox-item-5534990000006")).toContainText("[Localização] Padaria Central");
    await expect(page.getByTestId("inbox-list")).not.toContainText("[Mensagem]");
    await expect(page.getByTestId("inbox-list")).not.toContainText("[sticker]");

    await firstCard(page).click();
    const conversation = page.getByTestId("inbox-conversation");
    await expect(conversation.getByText("Mensagem sem texto (tipo não registrado)")).toBeVisible();
    await expect(conversation.getByText("Figurinha", { exact: true })).toBeVisible();
    await expect(conversation.getByText("[Localização] Padaria Central · Rua A, 10")).toBeVisible();
    await expect(conversation).not.toContainText("[Mensagem]");
    await conversation.screenshot({ path: `${SHOTS}/rotulos-conversa.png` });
  });

  test("Registrar → Reunião grava a reunião, a gaveta mostra, e a mesma gaveta cancela", async ({ page }) => {
    const served = await serve(page);
    await page.goto(PAGE_URL);
    await firstCard(page).click();
    await page.getByTestId("dossier-open").click();

    const register = page.getByTestId("register-meeting");
    await expect(register).toHaveText("Reunião");
    await register.click();
    await page.getByRole("button", { name: "Apenas Salvar" }).click();

    await expect.poll(() => served.reminders.length).toBe(1);
    expect(served.reminders[0]).toMatchObject({ activityType: "meeting", phone: "5534990000001", leadName: "Jéssica Mendonça" });

    // A gaveta passa a mostrar a reunião e o botão muda de estado.
    await expect(register).toHaveText("Reunião marcada");
    const cancel = page.getByTestId("meeting-cancel");
    await expect(cancel).toBeVisible();
    await page.getByTestId("dossier-drawer").screenshot({ path: `${SHOTS}/gaveta-reuniao-marcada.png` });

    // Cancelar pede confirmação; "Manter" não cancela nada.
    await cancel.click();
    await expect(page.getByTestId("meeting-cancel-confirm")).toBeVisible();
    await page.getByTestId("meeting-cancel-area").getByRole("button", { name: "Manter" }).click();
    expect(served.deletedReminders).toHaveLength(0);

    await page.getByTestId("meeting-cancel").click();
    await page.getByTestId("meeting-cancel-confirm").click();
    await expect.poll(() => served.deletedReminders).toEqual(["rem-1"]);
    await expect(register).toHaveText("Reunião");
    await expect(page.getByTestId("meeting-cancel-area")).toHaveCount(0);
  });

  test("gaveta do dossiê: fechada por padrão, abre por cima da conversa, e fecha por X, clique fora e Esc", async ({ page }) => {
    await serve(page);
    await page.goto(PAGE_URL);
    await firstCard(page).click();
    await expect(page.getByTestId("dossier-panel")).toHaveCount(0);

    const convBefore = (await page.getByTestId("inbox-conversation").boundingBox())!;
    await page.getByTestId("dossier-open").click();
    const drawer = page.getByTestId("dossier-drawer");
    await expect(drawer).toBeVisible();
    const box = await inViewport(page, "dossier-drawer");
    expect(box.width).toBeGreaterThan(280);
    expect(box.width).toBeLessThanOrEqual(340);
    // Por cima: a conversa não encolheu.
    const convOpen = (await page.getByTestId("inbox-conversation").boundingBox())!;
    expect(convOpen.width).toBe(convBefore.width);
    // É o elemento de cima naquele ponto da tela (não está atrás de nada).
    const onTop = await drawer.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + 20);
      return Boolean(hit && el.contains(hit));
    });
    expect(onTop).toBe(true);

    await expect(drawer).toContainText("Dossiê do lead");
    await expect(drawer).toContainText("Leitura do robô");
    await expect(drawer).toContainText("Registrar");
    for (const name of ["Ligação", "Reunião", "Lembrete", "Cadência", "Agendar mensagem"]) {
      await expect(drawer.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await expect(drawer.getByRole("button", { name: "Gerar proposta comercial" })).toBeVisible();
    await expect(drawer).toContainText("Bloquear disparos em massa");
    await page.screenshot({ path: `${SHOTS}/gaveta-computador.png` });

    await page.getByTestId("dossier-close").click();
    await expect(page.getByTestId("dossier-panel")).toHaveCount(0);
    await expect(page.getByLabel("Mensagem para o cliente")).toBeVisible();

    await page.getByTestId("dossier-open").click();
    await expect(drawer).toBeVisible();
    await page.getByTestId("dossier-backdrop").click({ position: { x: 40, y: 200 } });
    await expect(page.getByTestId("dossier-panel")).toHaveCount(0);

    await page.getByTestId("dossier-open").click();
    await drawer.getByRole("button", { name: "Ligação", exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("dossier-panel")).toHaveCount(0);

    // Depois de fechar, dá para escrever na conversa.
    await page.getByLabel("Mensagem para o cliente").fill("voltei");
    await expect(page.getByTestId("composer-send")).toBeEnabled();
  });

  test("gaveta fixada vira coluna ao lado, a escolha sobrevive a recarregar, e o X desfaz", async ({ page }) => {
    await serve(page);
    await page.goto(PAGE_URL);
    await firstCard(page).click();
    const convBefore = (await page.getByTestId("inbox-conversation").boundingBox())!;

    await page.getByTestId("dossier-open").click();
    await page.getByTestId("dossier-pin").click();
    await expect(page.getByTestId("dossier-pinned")).toBeVisible();
    await expect(page.getByTestId("dossier-drawer")).toHaveCount(0);
    const convPinned = (await page.getByTestId("inbox-conversation").boundingBox())!;
    expect(convPinned.width).toBeLessThan(convBefore.width);
    await inViewport(page, "dossier-pinned");

    await page.reload();
    await firstCard(page).click();
    await expect(page.getByTestId("dossier-pinned")).toBeVisible();

    await page.getByTestId("dossier-close").click();
    await expect(page.getByTestId("dossier-panel")).toHaveCount(0);
    await page.reload();
    await firstCard(page).click();
    await expect(page.getByTestId("dossier-panel")).toHaveCount(0);
  });

  test("trocar de aba troca a lista, e as listas que saíram das abas estão no botão de filtros e no rodapé", async ({ page }) => {
    const served = await serve(page);
    await page.goto(PAGE_URL);
    await expect(firstCard(page)).toBeVisible();
    expect(served.tabs[0]).toBe("esperam");

    await page.getByTestId("inbox-tab-com_lead").click();
    await expect(page.getByTestId("inbox-tab-com_lead")).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => served.tabs.includes("com_lead")).toBe(true);
    await expect(page.getByTestId("inbox-list")).toContainText("(com_lead)");
    await expect(page.getByTestId("inbox-order-label")).toHaveText(/mais recente primeiro/i);

    await page.getByTestId("inbox-tab-robo").click();
    await expect(page.getByTestId("inbox-list")).toContainText("Robô: Mensagem 7 (robo)");

    await page.getByTestId("inbox-footer-grupos").click();
    await expect.poll(() => served.tabs.includes("grupos")).toBe(true);
    await expect(page.getByTestId("inbox-footer-grupos")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("inbox-order-label")).toHaveText(/Grupos/i);

    // Botão de filtros: escopo de chip, outras listas e seleção em massa.
    await page.getByTestId("inbox-filters-button").click();
    const panel = page.getByTestId("inbox-filters-panel");
    await expect(panel).toBeVisible();
    await inViewport(page, "inbox-filters-panel");
    for (const key of ["esfriaram", "minhas", "hoje", "pausadas", "todas"]) await expect(panel.getByTestId(`inbox-footer-${key}`)).toBeVisible();
    await expect(panel.getByTestId("inbox-footer-count-esfriaram")).toHaveText("667");
    await page.screenshot({ path: `${SHOTS}/filtros-computador.png` });
    await panel.getByTestId("inbox-footer-esfriaram").click();
    await expect.poll(() => served.tabs.includes("esfriaram")).toBe(true);
    await expect(page.getByTestId("inbox-order-label")).toHaveText(/Esfriaram · mais parado primeiro/i);

    // "Todos os chips" abre o mesmo painel.
    await page.getByTestId("inbox-chip-link").click();
    await expect(panel).toBeVisible();
    // O painel só escuta o Esc depois de receber o foco (um instante depois de aparecer).
    await expect.poll(() => panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden(); // espera a animação de fechar antes de abrir de novo

    // Seleção em massa: nada disso sumiu.
    await page.getByTestId("inbox-filters-button").click();
    await expect(panel).toBeVisible();
    await page.getByTestId("inbox-select-mode").click();
    await expect(page.getByTestId("inbox-bulk-bar")).toBeVisible();
    await page.getByRole("checkbox", { name: /Selecionar Jéssica/ }).click();
    await expect(page.getByTestId("inbox-bulk-bar")).toContainText("1 selecionada");
  });
});

test.describe("aba Conversas — tela nova, celular (375x812)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("fila ocupa a tela, abrir conversa troca de tela, a gaveta cobre tudo e fecha, e voltar devolve a fila", async ({ page }) => {
    const served = await serve(page);
    await page.goto(PAGE_URL);
    await expect(firstCard(page)).toBeVisible();

    const noSideScroll = async () => {
      const s = await page.evaluate(() => ({ w: document.scrollingElement!.scrollWidth, c: document.scrollingElement!.clientWidth }));
      expect(s.w).toBeLessThanOrEqual(s.c);
    };
    await noSideScroll();
    const column = await inViewport(page, "inbox-column");
    expect(column.width).toBeGreaterThan(330);
    await expect(page.getByTestId("inbox-conversation")).toBeHidden();
    for (const id of ["inbox-tab-esperam", "inbox-tab-com_lead", "inbox-tab-robo", "inbox-filters-button", "inbox-footer-filters"]) await inViewport(page, id);
    const card = (await firstCard(page).boundingBox())!;
    expect(card.y).toBeLessThan(300);
    await page.screenshot({ path: `${SHOTS}/lista-375.png` });

    await page.getByTestId("inbox-tab-com_lead").click();
    await expect(page.getByTestId("inbox-list")).toContainText("(com_lead)");
    await page.getByTestId("inbox-tab-esperam").click();

    await firstCard(page).click();
    await expect(page.getByTestId("inbox-column")).toBeHidden();
    await expect(page.getByTestId("chat-header-name")).toHaveText("Jéssica Mendonça");
    for (const id of ["chat-header", "chat-back", "chat-menu", "chat-context", "dossier-open", "composer", "composer-send"]) await inViewport(page, id);
    await noSideScroll();
    await expect(page.getByText("Resposta nossa número 29.")).toBeInViewport(); // abre no fim da conversa
    await page.screenshot({ path: `${SHOTS}/conversa-375.png` });

    const field = page.getByLabel("Mensagem para o cliente");
    await field.fill("Mensagem pelo celular");
    await page.getByTestId("composer-send").click();
    await expect.poll(() => served.sent.length).toBe(1);

    await page.getByTestId("dossier-open").click();
    const drawer = page.getByTestId("dossier-drawer");
    await expect(drawer).toBeVisible();
    const box = await inViewport(page, "dossier-drawer");
    expect(box.width).toBeGreaterThan(300);
    await inViewport(page, "dossier-close");
    await page.screenshot({ path: `${SHOTS}/gaveta-375.png` });
    await page.getByTestId("dossier-close").click();
    await expect(page.getByTestId("dossier-panel")).toHaveCount(0);
    await expect(field).toBeVisible();

    await page.getByTestId("chat-back").click();
    await expect(page.getByTestId("inbox-column")).toBeVisible();
    await expect(page.getByTestId("inbox-conversation")).toBeHidden();
    await expect(firstCard(page)).toBeVisible();
  });
});

test.describe("aba Conversas — falha e cancelamento (1366x768)", () => {
  test("servidor recusa (503 do teto de tempo): a coluna mostra o erro e 'Tentar de novo' recupera", async ({ page }) => {
    let fail = true;
    let calls = 0;
    await serve(page, (route) => {
      calls += 1;
      if (!fail) return ok(route);
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ success: false, error: { code: "INBOX_QUERY_TIMEOUT", message: "A lista de conversas demorou demais para responder. Tente de novo em instantes." } }),
      });
    });
    await page.goto(PAGE_URL);

    const alert = page.getByTestId("chats-error");
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await expect(alert).toContainText("Não foi possível carregar as conversas.");
    await expect(alert).toContainText("demorou demais para responder");
    await expect(page.getByText("Carregando conversas...")).toHaveCount(0);
    await expect(page.getByTestId("inbox-empty")).toHaveCount(0);
    await inViewport(page, "chats-error");
    await page.screenshot({ path: `${SHOTS}/erro-visivel.png` });

    fail = false;
    const before = calls;
    await alert.getByRole("button", { name: "Tentar de novo" }).click();
    await expect(firstCard(page)).toBeVisible();
    await expect(alert).toHaveCount(0);
    expect(calls).toBeGreaterThan(before);
  });

  test("servidor não responde: em vez de 'Carregando...' eterno, erro de tempo esgotado", async ({ page }) => {
    await page.clock.install();
    await serve(page, () => new Promise<void>(() => {})); // nunca responde
    await page.goto(PAGE_URL);

    await expect(page.getByText("Carregando conversas...")).toBeVisible();
    await page.clock.runFor(14_000);
    await expect(page.getByText("Carregando conversas...")).toBeVisible();
    await page.clock.runFor(2_000);

    const alert = page.getByTestId("chats-error");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("A lista de conversas demorou demais para responder.");
    await expect(page.getByText("Carregando conversas...")).toHaveCount(0);
  });

  test("trocar de aba cancela o pedido anterior em vez de empilhar", async ({ page }) => {
    const aborted: string[] = [];
    page.on("requestfailed", (req) => {
      const u = new URL(req.url());
      if (u.pathname === "/api/whatsapp/chats") aborted.push(`${u.searchParams.get("tab")}:${req.failure()?.errorText}`);
    });
    const pending: string[] = [];
    await serve(page, (route, url) => {
      const tab = url.searchParams.get("tab") || "";
      if (tab === "esperam") {
        pending.push(tab);
        return new Promise<void>(() => {}); // a primeira aba fica pendurada
      }
      return ok(route, chatsPage(tab));
    });
    await page.goto(PAGE_URL);
    await expect(page.getByText("Carregando conversas...")).toBeVisible();
    await expect.poll(() => pending.length).toBeGreaterThan(0);

    await page.getByTestId("inbox-tab-com_lead").click();
    await expect(firstCard(page)).toBeVisible();

    await expect.poll(() => aborted.length).toBeGreaterThan(0);
    expect(aborted[0]).toBe("esperam:net::ERR_ABORTED");
  });
});
