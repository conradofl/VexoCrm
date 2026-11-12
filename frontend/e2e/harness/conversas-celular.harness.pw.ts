// Aba Conversas no CELULAR, em Chromium de verdade com emulação de telefone (375x812, toque,
// tela de alta densidade, navegador identificado como celular). A página é a real; o servidor é
// o de mentira de conversas-servidor.ts.
//
// Prova o caminho inteiro de quem atende pelo telefone:
//   fila em tela cheia → toque abre a conversa em tela cheia → responder → abrir o dossiê em
//   tela cheia → registrar reunião → fechar → voltar para a fila NA MESMA POSIÇÃO.
// E mais duas coisas que só aparecem em tela de verdade:
//   - com o teclado aberto, o campo de resposta e o botão Enviar continuam visíveis;
//   - tudo o que se toca tem pelo menos 44 px.
//
// Limite: o teclado virtual não existe no Chromium de teste. O teste encolhe a área visível
// (window.visualViewport), que é exatamente o que o teclado faz no iPhone e no Android.
//
// Uso: npx playwright test --config playwright.harness.config.ts conversas-celular
import { expect, test, type Page } from "@playwright/test";
import { PAGE_URL, SHOTS, firstCard, serve } from "./conversas-servidor";

const W = 375;
const H = 812;
const KEYBOARD = 336; // altura típica do teclado do iPhone em pé

test.use({
  viewport: { width: W, height: H },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
});

const box = async (page: Page, testId: string) => {
  const b = await page.getByTestId(testId).boundingBox();
  expect(b, testId).not.toBeNull();
  return b!;
};

// Tudo o que é tocável e está visível dentro da tela de Conversas, com o tamanho de cada um.
const touchTargets = (page: Page) =>
  page.evaluate(() => {
    const out: { label: string; w: number; h: number }[] = [];
    const selector = 'button, a[href], select, summary, [role="button"], [role="tab"], [role="menuitem"]';
    for (const root of Array.from(document.querySelectorAll(".inbox-touch"))) {
      for (const el of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
        if (el.matches('[role="switch"], [role="checkbox"], [data-touch-exempt], [tabindex="-1"][aria-label="Fechar o dossiê"]')) continue;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 || style.pointerEvents === "none") continue;
        if (rect.width === 0 || rect.height === 0) continue;
        if (!el.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true })) continue;
        // Fora da tela (lista rolada): não é alvo neste momento.
        if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) continue;
        const label = (el.getAttribute("data-testid") || el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40);
        out.push({ label, w: Math.round(rect.width * 10) / 10, h: Math.round(rect.height * 10) / 10 });
      }
    }
    return out;
  });

async function expectTouchTargets(page: Page, where: string) {
  // Janelas e painéis entram com animação (opacidade e escala 95% → 100%), e enquanto uma janela
  // abre o resto da tela fica sem toque: mede depois que assenta. Exige que haja alvos E que
  // nenhum seja menor que 44 px.
  await expect
    .poll(
      async () => {
        const targets = await touchTargets(page);
        return { enough: targets.length > 3, small: targets.filter((t) => t.w < 44 || t.h < 44) };
      },
      { message: `${where}: alvos de toque menores que 44 px (ou nenhum alvo)`, timeout: 4000 }
    )
    .toEqual({ enough: true, small: [] });
}

const noSideScroll = async (page: Page) => {
  const s = await page.evaluate(() => ({ w: document.scrollingElement!.scrollWidth, c: document.scrollingElement!.clientWidth }));
  expect(s.w).toBeLessThanOrEqual(s.c);
};

test.describe("aba Conversas no celular (375x812, toque)", () => {
  test("caminho inteiro: abrir conversa, responder, abrir dossiê, registrar reunião e voltar à fila na mesma posição", async ({ page }) => {
    const served = await serve(page);
    await page.goto(PAGE_URL);
    await expect(firstCard(page)).toBeVisible();

    // 1. Fila em tela cheia: de ponta a ponta na largura, até o pé da tela, sem moldura.
    const listLayout = await box(page, "inbox-layout");
    expect(listLayout.x).toBe(0);
    expect(listLayout.width).toBe(W);
    expect(Math.round(listLayout.y + listLayout.height)).toBe(H);
    expect(listLayout.y).toBeLessThan(90); // só a barra do sistema acima
    await expect(page.getByTestId("inbox-conversation")).toBeHidden();
    await noSideScroll(page);
    await expectTouchTargets(page, "fila");
    await page.screenshot({ path: `${SHOTS}/celular-1-fila.png` });

    // Desce a fila e abre uma conversa lá de baixo.
    const list = page.getByTestId("inbox-list");
    await list.evaluate((el) => { el.scrollTop = 1400; });
    const scrolledTo = await list.evaluate((el) => el.scrollTop);
    expect(scrolledTo).toBeGreaterThan(1000);
    const target = page.getByTestId("inbox-item-5534990000024");
    await expect(target).toBeInViewport();
    await target.tap();

    // 2. Conversa em tela cheia: cobre a tela inteira, inclusive a barra do sistema.
    await expect(page.getByTestId("inbox-column")).toBeHidden();
    const chatLayout = await box(page, "inbox-layout");
    expect(chatLayout).toEqual({ x: 0, y: 0, width: W, height: H });
    await expect(page.getByTestId("chat-header-name")).toHaveText("Contato 24 da Silva Albuquerque");
    for (const id of ["chat-header", "chat-back", "chat-menu", "dossier-open", "composer", "composer-send"]) {
      await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 });
    }
    await expect(page.getByText("Resposta nossa número 29.")).toBeInViewport(); // abre no fim da conversa
    await noSideScroll(page);
    await expectTouchTargets(page, "conversa");
    await page.screenshot({ path: `${SHOTS}/celular-2-conversa.png` });

    // 3. Responder.
    const field = page.getByLabel("Mensagem para o cliente");
    await field.tap();
    await field.fill("Oi! Consigo te atender agora.");
    await page.getByTestId("composer-send").tap();
    await expect.poll(() => served.sent.length).toBe(1);
    expect(served.sent[0]).toEqual({ chatId: "5534990000024", body: "Oi! Consigo te atender agora." });
    await expect(field).toHaveValue("");

    // 4. Dossiê em tela cheia, com o fechar visível.
    await page.getByTestId("dossier-open").tap();
    await expect(page.getByTestId("dossier-drawer")).toBeVisible();
    await expect.poll(async () => (await box(page, "dossier-drawer")).x).toBe(0); // espera a gaveta terminar de entrar
    expect(await box(page, "dossier-drawer")).toEqual({ x: 0, y: 0, width: W, height: H });
    await expect(page.getByTestId("dossier-close")).toBeInViewport({ ratio: 1 });
    const close = await box(page, "dossier-close");
    expect(close.width).toBeGreaterThanOrEqual(44);
    expect(close.height).toBeGreaterThanOrEqual(44);
    await expectTouchTargets(page, "dossiê");
    await page.screenshot({ path: `${SHOTS}/celular-3-dossie.png` });

    // 5. Registrar reunião.
    const register = page.getByTestId("register-meeting");
    await register.scrollIntoViewIfNeeded();
    await register.tap();
    const save = page.getByRole("button", { name: "Apenas Salvar" });
    await expect(save).toBeInViewport({ ratio: 1 });
    await expectTouchTargets(page, "janela da reunião");
    await page.screenshot({ path: `${SHOTS}/celular-4-reuniao.png` });
    await save.tap();
    await expect.poll(() => served.reminders.length).toBe(1);
    expect(served.reminders[0]).toMatchObject({ activityType: "meeting", phone: "5534990000024" });
    await expect(register).toHaveText("Reunião marcada");
    await expect(page.getByTestId("meeting-cancel")).toBeVisible();
    await page.getByTestId("meeting-cancel").scrollIntoViewIfNeeded();
    await expectTouchTargets(page, "dossiê com reunião");
    await page.screenshot({ path: `${SHOTS}/celular-5-reuniao-marcada.png` });

    // 6. Fechar o dossiê e voltar: a fila reaparece exatamente onde estava.
    await page.getByTestId("dossier-close").tap();
    await expect(page.getByTestId("dossier-panel")).toHaveCount(0);
    await page.getByTestId("chat-back").tap();
    await expect(page.getByTestId("inbox-column")).toBeVisible();
    await expect(page.getByTestId("inbox-conversation")).toBeHidden();
    expect(await list.evaluate((el) => el.scrollTop)).toBe(scrolledTo);
    await expect(target).toBeInViewport();
    await page.screenshot({ path: `${SHOTS}/celular-6-voltou-mesma-posicao.png` });
  });

  test("teclado aberto: o campo de resposta e o Enviar continuam visíveis, e a conversa encolhe em vez de sumir", async ({ page }) => {
    // Dublê do teclado: a área visível encolhe, como no iPhone (a página não muda de tamanho).
    await page.addInitScript(() => {
      const target = new EventTarget();
      let keyboard = 0;
      let offsetTop = 0;
      Object.defineProperties(target, {
        height: { get: () => window.innerHeight - keyboard },
        width: { get: () => window.innerWidth },
        offsetTop: { get: () => offsetTop },
        offsetLeft: { get: () => 0 },
        scale: { get: () => 1 },
      });
      Object.defineProperty(window, "visualViewport", { value: target, configurable: true });
      (window as unknown as { __keyboard: (px: number, scrolled?: number) => void }).__keyboard = (px, scrolled = 0) => {
        keyboard = px;
        offsetTop = scrolled;
        target.dispatchEvent(new Event("resize"));
      };
    });
    const setKeyboard = (px: number, scrolled = 0) =>
      page.evaluate(([p, s]) => (window as unknown as { __keyboard: (px: number, scrolled?: number) => void }).__keyboard(p, s), [px, scrolled]);

    const served = await serve(page);
    await page.goto(PAGE_URL);
    await firstCard(page).tap();
    const field = page.getByLabel("Mensagem para o cliente");
    await field.tap();

    await setKeyboard(KEYBOARD);
    const visible = H - KEYBOARD;
    await expect.poll(async () => (await box(page, "inbox-layout")).height).toBe(visible);
    // Com o teclado aberto a faixa de contexto sai, para a conversa ter espaço.
    await expect(page.getByTestId("chat-context")).toHaveCount(0);
    for (const id of ["chat-header", "composer", "composer-send"]) {
      const b = await box(page, id);
      expect(b.y, `${id} topo`).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height, `${id} acima do teclado`).toBeLessThanOrEqual(visible + 0.5);
    }
    const fieldBox = (await field.boundingBox())!;
    expect(fieldBox.y + fieldBox.height).toBeLessThanOrEqual(visible + 0.5);
    // A última mensagem continua à vista, acima do campo.
    const last = (await page.getByText("Resposta nossa número 29.").boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual((await box(page, "composer")).y + 0.5);
    expect(last.y).toBeGreaterThanOrEqual(0);
    // E sobra conversa de verdade: pelo menos 180 px de mensagens entre o cabeçalho e o campo.
    const header = await box(page, "chat-header");
    expect((await box(page, "composer")).y - (header.y + header.height)).toBeGreaterThanOrEqual(180);
    await page.screenshot({ path: `${SHOTS}/celular-7-teclado-aberto.png`, clip: { x: 0, y: 0, width: W, height: visible } });

    // Dá para escrever e enviar com o teclado aberto.
    await field.fill("Mandando com o teclado aberto");
    await page.getByTestId("composer-send").tap();
    await expect.poll(() => served.sent.length).toBe(1);

    // iPhone também rola a página para mostrar o campo: a tela acompanha o deslocamento.
    await setKeyboard(KEYBOARD, 120);
    await expect.poll(async () => (await box(page, "inbox-layout")).y).toBe(120);
    expect((await box(page, "inbox-layout")).height).toBe(visible);

    // Teclado fecha: a conversa volta a ocupar a tela inteira.
    await setKeyboard(0);
    await expect.poll(async () => (await box(page, "inbox-layout")).height).toBe(H);
    await expect(page.getByTestId("chat-context")).toBeVisible();
  });

  test("campos de texto têm letra de 16 px: o iPhone não dá zoom ao tocar", async ({ page }) => {
    await serve(page);
    await page.goto(PAGE_URL);
    await expect(firstCard(page)).toBeVisible();
    const fontSize = (testIdOrLabel: { label?: string; placeholder?: string }) =>
      (testIdOrLabel.label ? page.getByLabel(testIdOrLabel.label) : page.getByPlaceholder(testIdOrLabel.placeholder!)).evaluate((el) =>
        parseFloat(getComputedStyle(el).fontSize)
      );
    expect(await fontSize({ placeholder: "Buscar nome, número ou mensagem" })).toBeGreaterThanOrEqual(16);
    await firstCard(page).tap();
    expect(await fontSize({ label: "Mensagem para o cliente" })).toBeGreaterThanOrEqual(16);
  });

  test("botão de filtros no celular: o painel cabe na tela e os alvos têm 44 px", async ({ page }) => {
    await serve(page);
    await page.goto(PAGE_URL);
    await expect(firstCard(page)).toBeVisible();
    await page.getByTestId("inbox-filters-button").tap();
    const panel = page.getByTestId("inbox-filters-panel");
    await expect(panel).toBeVisible();
    const b = (await panel.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(W);
    expect(b.y + b.height).toBeLessThanOrEqual(H);
    await expectTouchTargets(page, "painel de filtros");
    await page.screenshot({ path: `${SHOTS}/celular-8-filtros.png` });
  });
});
