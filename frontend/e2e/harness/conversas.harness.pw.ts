import { expect, test, type Page } from "@playwright/test";

const URL = "/e2e/harness/conversas.html";

async function itemIds(page: Page) {
  return page
    .locator('[data-testid="inbox-list"] > button')
    .evaluateAll((els) => els.map((el) => (el.getAttribute("data-testid") || "").replace("inbox-item-", "")));
}

test.describe("coluna da esquerda da aba Conversas (Chromium)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId("inbox-column")).toBeVisible();
  });

  test("as três abas aparecem com contador igual à quantidade de itens da aba", async ({ page }) => {
    for (const key of ["esperam", "com_lead", "robo"]) {
      await page.getByTestId(`inbox-tab-${key}`).click();
      const shown = Number(await page.getByTestId(`inbox-tab-count-${key}`).innerText());
      expect((await itemIds(page)).length, `itens da aba ${key}`).toBe(shown);
    }
    await expect(page.getByTestId("inbox-tab-esperam")).toContainText("Esperam você");
    await expect(page.getByTestId("inbox-tab-com_lead")).toContainText("Com o lead");
    await expect(page.getByTestId("inbox-tab-robo")).toContainText("Robô cuida");
  });

  test("'Esperam você' abre por padrão, na ordem recebida, com tempo de espera no lugar do relógio", async ({ page }) => {
    await expect(page.getByTestId("inbox-tab-esperam")).toHaveAttribute("aria-selected", "true");
    expect(await itemIds(page)).toEqual(["e1", "e2", "e3", "e4", "e5"]);
    await expect(page.getByTestId("inbox-item-time-e1")).toHaveText("3 dias parada");
    await expect(page.getByTestId("inbox-item-time-e2")).toHaveText("desde ontem");
    await expect(page.getByTestId("inbox-item-time-e3")).toHaveText("4h parada");
    await expect(page.getByTestId("inbox-item-time-e4")).toHaveText("1h12 parada");
    await expect(page.getByTestId("inbox-item-time-e5")).toHaveText("38min parada");
  });

  test("fora das abas de espera o item mostra o horário, não o tempo parado", async ({ page }) => {
    await page.getByTestId("inbox-tab-com_lead").click();
    await expect(page.getByTestId("inbox-item-time-c1")).toHaveText("14:10");
    await expect(page.getByTestId("inbox-item-c1")).toHaveAttribute("data-urgency", "none");
  });

  test("a urgência vira cor na borda esquerda", async ({ page }) => {
    const border = (id: string) =>
      page.getByTestId(`inbox-item-${id}`).evaluate((el) => {
        const cs = getComputedStyle(el);
        return { color: cs.borderLeftColor, width: cs.borderLeftWidth };
      });
    const late = await border("e1");
    const warm = await border("e4");
    const fresh = await border("e5");
    const attention = await border("e3");
    for (const b of [late, warm, fresh, attention]) expect(b.width).toBe("4px");
    expect(new Set([late.color, warm.color, fresh.color]).size, "três cores diferentes").toBe(3);
    expect(attention.color, "atenção humana usa o vermelho do atrasado").toBe(late.color);
    await expect(page.getByTestId("inbox-item-e1")).toHaveAttribute("data-urgency", "late");
    await expect(page.getByTestId("inbox-item-e4")).toHaveAttribute("data-urgency", "warm");
    await expect(page.getByTestId("inbox-item-e5")).toHaveAttribute("data-urgency", "fresh");
  });

  test("o item cabe em duas linhas e nada vaza da coluna de 300px", async ({ page }) => {
    const column = (await page.getByTestId("inbox-column").boundingBox())!;
    expect(Math.round(column.width)).toBe(300);
    for (const id of ["e1", "e2", "e3", "e4", "e5"]) {
      const box = (await page.getByTestId(`inbox-item-${id}`).boundingBox())!;
      expect(box.height, `altura do item ${id}`).toBeLessThanOrEqual(56);
      const time = (await page.getByTestId(`inbox-item-time-${id}`).boundingBox())!;
      expect(time.x + time.width, `tempo do item ${id} dentro da coluna`).toBeLessThanOrEqual(column.x + column.width);
      const flags = (await page.getByTestId(`inbox-item-flags-${id}`).boundingBox())!;
      expect(flags.x + flags.width, `ícones do item ${id} dentro da coluna`).toBeLessThanOrEqual(column.x + column.width);
    }
    const overflow = await page
      .getByTestId("inbox-list")
      .evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow, "sem rolagem horizontal").toBeLessThanOrEqual(0);
  });

  test("campanha é ícone com nome no título, não etiqueta de texto", async ({ page }) => {
    const item = page.getByTestId("inbox-item-e1");
    await expect(item.getByRole("img", { name: "Veio da campanha: Black Friday" })).toBeVisible();
    await expect(item).not.toContainText("Campanha");
  });

  test("o rodapé fica dentro da janela e cada filtro troca a lista", async ({ page }) => {
    const viewport = page.viewportSize()!;
    const expected: Record<string, string[]> = {
      esfriaram: ["f1"],
      grupos: ["g1"],
      automacao: ["a1"],
      arquivadas: ["x1"],
    };
    for (const [key, ids] of Object.entries(expected)) {
      const button = page.getByTestId(`inbox-footer-${key}`);
      await expect(button).toBeVisible();
      const box = (await button.boundingBox())!;
      expect(box.y + box.height, `filtro ${key} dentro da janela`).toBeLessThanOrEqual(viewport.height);
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      expect(await itemIds(page), `itens de ${key}`).toEqual(ids);
      await expect(page.getByTestId(`inbox-footer-count-${key}`)).toHaveText(String(ids.length));
      if (key === "esfriaram") {
        await expect(page.getByTestId("inbox-item-time-f1")).toHaveText("40 dias parada");
      }
    }
    for (const key of ["minhas", "hoje", "pausadas", "todas"]) {
      await expect(page.getByTestId(`inbox-footer-${key}`)).toBeVisible();
    }
  });

  test("tela inteira para conferência visual", async ({ page }) => {
    await page.screenshot({ path: "test-results/conversas-coluna.png" });
  });

  test("o seletor diz 'Ver conversas de', filtra por chip e mostra quem responde em texto", async ({ page }) => {
    const scope = page.getByTestId("inbox-chip-scope");
    await expect(scope).toContainText("Ver conversas de");
    await expect(page.getByTestId("inbox-chip-agent-text")).toHaveCount(0);

    await scope.getByRole("combobox").click();
    await expect(page.getByRole("option", { name: "Comercial - Gabriel (desconectado)" })).toBeVisible();
    await page.getByRole("option", { name: "Comercial - Gabriel (desconectado)" }).click();

    expect(await itemIds(page)).toEqual(["e4"]);
    await expect(page.getByTestId("inbox-tab-count-esperam")).toHaveText("1");
    await expect(page.getByTestId("inbox-chip-agent-text")).toHaveText(
      'Agente "Agente de Atendimento" está desligado: ninguém responde sozinho aqui.'
    );
    // Texto, não seletor: dentro do escopo só existe um controle de escolha.
    await expect(scope.getByRole("combobox")).toHaveCount(1);
  });
});
