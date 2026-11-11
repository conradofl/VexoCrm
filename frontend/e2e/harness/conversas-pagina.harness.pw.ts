// Aba Conversas em Chromium de verdade: a PÁGINA real, com os hooks reais, contra um
// servidor de mentira (as respostas de /api/** saem daqui). Volume parecido com o da Geração
// Digital em 11/11/2026: 883 conversas na fila, 40 por página.
//
// O que este arquivo prova, e que jsdom não prova:
//   - a lista aparece DENTRO da coluna, com rolagem, e não some nem sai da janela;
//   - quando o servidor recusa ou não responde, a coluna mostra um erro com saída
//     ("Tentar de novo") em vez de "Carregando conversas..." para sempre;
//   - trocar de aba CANCELA o pedido anterior (o navegador aborta), não empilha.
//
// Uso: npx playwright test --config playwright.harness.config.ts
import { expect, test, type Page, type Route } from "@playwright/test";

const PAGE_URL = "/e2e/harness/conversas-pagina.html";
const TOTAL = 883;
const SHOTS = process.env.HARNESS_SHOTS_DIR || "test-results/harness";

const tenant = {
  id: "geracao-digital",
  name: "Geração Digital",
  n8n_settings: { evolution_instances: [{ id: "comercial-hostery", name: "Comercial - Hostery", active: true }] },
};

function chat(i: number) {
  const phone = `55349${String(90000000 + i).padStart(8, "0")}`;
  const ts = Math.floor(Date.now() / 1000) - i * 420;
  return {
    id: phone,
    name: i % 4 === 0 ? `+${phone}` : `Contato ${i} da Silva Albuquerque`,
    profilePic: null,
    isGroup: false,
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
    agentMutedAt: null,
    agentMutedReason: null,
    lastMessage: { id: String(i), body: `Mensagem ${i}: consegue me passar o valor ainda hoje, por favor?`, fromMe: i % 3 === 0, senderType: "lead", timestamp: ts, type: "chat", meta: null },
    leadOrigin: null,
    sourceCampaignId: null,
  };
}

const page0 = () => ({
  items: Array.from({ length: 40 }, (_, i) => chat(i + 1)),
  total: TOTAL,
  counts: { active: TOTAL, awaiting: 60, automations: 17, groups: 72, archived: 5, paused: 1, myUnopened: 0 },
  nextOffset: 40,
  hasMore: true,
});

type ChatsHandler = (route: Route, url: URL) => Promise<void> | void;

async function serve(page: Page, chats: ChatsHandler) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/whatsapp/chats") return chats(route, url);
    const body = url.pathname === "/api/lead-clients" ? { items: [tenant] } : { items: [], data: [], success: true };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

const ok = (route: Route, body: unknown = page0()) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

// A coluna da lista é o ancestral rolável do primeiro cartão (ou do aviso).
async function scrollBox(page: Page, inner: ReturnType<Page["locator"]>) {
  return inner.evaluate((el) => {
    let node: HTMLElement | null = el as HTMLElement;
    while (node && !/(auto|scroll)/.test(getComputedStyle(node).overflowY)) node = node.parentElement;
    const r = (node || (el as HTMLElement)).getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, scrollH: node?.scrollHeight ?? 0, clientH: node?.clientHeight ?? 0, vw: innerWidth, vh: innerHeight };
  });
}

test.describe("aba Conversas — página real em Chromium", () => {
  test("lista com volume da GD aparece dentro da coluna, com rolagem", async ({ page }) => {
    await serve(page, (route) => ok(route));
    await page.goto(PAGE_URL);

    const first = page.getByText("Contato 1 da Silva Albuquerque", { exact: true }).first();
    await expect(first).toBeVisible();
    await expect(page.getByText("Carregando conversas...")).toHaveCount(0);
    await expect(page.getByTestId("chats-error")).toHaveCount(0);

    const box = await scrollBox(page, first);
    expect(box.w).toBeGreaterThan(200);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.w).toBeLessThanOrEqual(box.vw);
    // O primeiro cartão está na janela. (Em 1366x768 a lista só começa perto da metade da
    // altura e passa ~46 px do fim da janela: é o layout que já está em produção, este PR
    // não mexe nele. Fica registrado para o redesenho da coluna.)
    await expect(first).toBeInViewport();
    expect(box.scrollH).toBeGreaterThan(box.clientH); // 40 cartões não cabem: tem que rolar

    const cardBox = await first.boundingBox();
    expect(cardBox!.x).toBeGreaterThanOrEqual(box.x);
    expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(box.x + box.w + 1);

    await page.screenshot({ path: `${SHOTS}/1-lista-volume-gd.png` });
  });

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
    await expect(page.getByText("Nenhuma conversa encontrada.")).toHaveCount(0);

    // Visível de verdade: dentro da janela e com tamanho.
    const b = await alert.boundingBox();
    const vp = page.viewportSize()!;
    expect(b!.width).toBeGreaterThan(150);
    expect(b!.height).toBeGreaterThan(40);
    expect(b!.x).toBeGreaterThanOrEqual(0);
    expect(b!.x + b!.width).toBeLessThanOrEqual(vp.width);
    expect(b!.y + b!.height).toBeLessThanOrEqual(vp.height);
    await page.screenshot({ path: `${SHOTS}/2-erro-visivel.png` });

    fail = false;
    const before = calls;
    await alert.getByRole("button", { name: "Tentar de novo" }).click();
    await expect(page.getByText("Contato 1 da Silva Albuquerque", { exact: true }).first()).toBeVisible();
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
    await page.screenshot({ path: `${SHOTS}/3-tempo-esgotado.png` });
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
      if (tab === "fila" || tab === "ativa") {
        pending.push(tab);
        return new Promise<void>(() => {}); // a primeira aba fica pendurada
      }
      return ok(route);
    });
    await page.goto(PAGE_URL);
    await expect(page.getByText("Carregando conversas...")).toBeVisible();
    await expect.poll(() => pending.length).toBeGreaterThan(0);

    await page.getByRole("button", { name: /Todas/ }).first().click();
    await expect(page.getByText("Contato 1 da Silva Albuquerque", { exact: true }).first()).toBeVisible();

    await expect.poll(() => aborted.length).toBeGreaterThan(0);
    expect(aborted[0]).toMatch(/^(fila|ativa):net::ERR_ABORTED$/);
  });
});
