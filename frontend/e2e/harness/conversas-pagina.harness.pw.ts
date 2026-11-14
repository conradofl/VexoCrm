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
import { expect, test } from "@playwright/test";
import { CHAT_ON_DOWN_CHIP, CHAT_ON_REMOVED_CHIP, COUNTS, NAMES, NOW_S, PAGE_URL, SHOTS, SPECIAL_BODIES, TOTAL, chat, chatsPage, firstCard, inViewport, leads, messagesFor, ok, serve, tenant } from "./conversas-servidor";

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

  test("Nova conversa: botão no topo da lista, lead achado pelo nome, chip padrão escolhido, envia e abre a conversa", async ({ page }) => {
    const served = await serve(page);
    await page.goto(PAGE_URL);
    await expect(firstCard(page)).toBeVisible();

    // O botão fica no topo da coluna, acima da primeira conversa.
    const button = await inViewport(page, "new-conversation-button");
    expect(button.y).toBeLessThan((await firstCard(page).boundingBox())!.y);
    await page.getByTestId("new-conversation-button").click();

    const dialog = page.getByTestId("new-conversation-dialog");
    await expect(dialog).toBeVisible();
    // Só chips conectados; o padrão já vem escolhido. O "Chip Caído" (desconectado) não aparece.
    const chip = page.getByTestId("new-conversation-chip");
    await expect(chip.locator("option")).toHaveText(["Comercial - Hostery (padrão)", "Caio"]);
    await expect(chip).toHaveValue("comercial-hostery");
    await expect(page.getByTestId("new-conversation-send")).toBeDisabled();

    await page.getByTestId("new-conversation-target").fill("marina");
    await expect(page.getByTestId("new-conversation-suggestion")).toHaveText(/Marina Prado.*\(34\) 98888-7777/);
    await page.getByTestId("new-conversation-suggestion").click();
    await expect(page.getByTestId("new-conversation-picked")).toContainText("Marina Prado");
    await page.getByTestId("new-conversation-body").fill("Oi Marina, aqui é o Caio da Geração Digital.");
    await dialog.screenshot({ path: `${SHOTS}/nova-conversa-janela.png` });
    await page.getByTestId("new-conversation-send").click();

    await expect.poll(() => served.started).toEqual([
      { chatId: "5534988887777", body: "Oi Marina, aqui é o Caio da Geração Digital.", chipId: "comercial-hostery" },
    ]);
    // A janela fecha e a conversa abre, com a mensagem enviada, na aba "Com o lead".
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("chat-header-name")).toHaveText("Marina Prado");
    await expect(page.getByTestId("inbox-conversation").getByText("Oi Marina, aqui é o Caio da Geração Digital.")).toBeVisible();
    await expect(page.getByTestId("inbox-tab-com_lead")).toHaveAttribute("aria-selected", "true");
    expect(served.sent).toHaveLength(0); // foi pela nova conversa, não pela resposta comum
    await page.screenshot({ path: `${SHOTS}/nova-conversa-aberta.png` });
  });

  test("Nova conversa: número inválido, chip desconectado e opt-out dão erro NA JANELA e nada é enviado", async ({ page }) => {
    const served = await serve(page);
    await page.goto(PAGE_URL);
    await expect(firstCard(page)).toBeVisible();
    await page.getByTestId("new-conversation-button").click();
    const dialog = page.getByTestId("new-conversation-dialog");
    const target = page.getByTestId("new-conversation-target");
    const send = page.getByTestId("new-conversation-send");
    const error = page.getByTestId("new-conversation-error");
    await page.getByTestId("new-conversation-body").fill("Olá, tudo bem?");

    // Número sem DDD: o botão nem habilita, e a janela explica.
    await target.fill("99999-0000");
    await expect(send).toBeDisabled();
    await expect(page.getByTestId("new-conversation-target-hint")).toContainText("com DDD");

    // Chip que caiu: o servidor recusa, o erro aparece na janela e ela continua aberta.
    await target.fill("(34) 98888-1111");
    await page.getByTestId("new-conversation-chip").selectOption("caio");
    await send.click();
    await expect(error).toContainText("Mensagem não enviada");
    await expect(error).toContainText("O chip Caio está desconectado");
    await expect(dialog).toBeVisible();
    await dialog.screenshot({ path: `${SHOTS}/nova-conversa-erro-chip.png` });

    // Trocar de chip limpa o erro. Número com opt-out: aviso, nada enviado.
    await page.getByTestId("new-conversation-chip").selectOption("comercial-hostery");
    await expect(error).toHaveCount(0);
    await target.fill("34 97777-0001");
    await send.click();
    await expect(error).toContainText("pediu para não receber mensagens");
    await expect(dialog).toBeVisible();

    expect(served.started).toHaveLength(0);
    expect(served.sent).toHaveLength(0);
    expect(served.startRefused.map((r) => r.code)).toEqual(["CHIP_NOT_CONNECTED", "CONTACT_OPTED_OUT"]);
    // O que a pessoa escreveu continua lá.
    await expect(page.getByTestId("new-conversation-body")).toHaveValue("Olá, tudo bem?");
  });

  test("Nova conversa para número que já tem conversa: não envia, abre a conversa e deixa o texto no campo", async ({ page }) => {
    const served = await serve(page);
    await page.goto(PAGE_URL);
    await expect(firstCard(page)).toBeVisible();
    await page.getByTestId("new-conversation-button").click();
    await page.getByTestId("new-conversation-target").fill("(34) 99000-0005");
    await page.getByTestId("new-conversation-body").fill("Moacir, conseguiu ver a proposta?");
    await page.getByTestId("new-conversation-send").click();

    await expect(page.getByTestId("new-conversation-dialog")).toHaveCount(0);
    await expect(page.getByTestId("chat-header-name")).toHaveText("Moacir Pires");
    await expect(page.getByLabel("Mensagem para o cliente")).toHaveValue("Moacir, conseguiu ver a proposta?");
    expect(served.started).toHaveLength(0);
    expect(served.sent).toHaveLength(0);
  });

  test("conversa em chip que saiu do cadastro: a tela avisa, pede confirmação a cada envio e não envia sozinha", async ({ page }) => {
    // Retrato do comportamento de hoje nas conversas com nome antigo de chip (40 na GD em 12/11/2026).
    const served = await serve(page);
    await page.goto(PAGE_URL);
    await page.getByTestId(`inbox-item-${CHAT_ON_REMOVED_CHIP}`).click();

    await expect(page.getByTestId("chat-header-sub")).toContainText("chip geracao-digital-caio-pessoal");
    await expect(page.getByTestId("composer-hint")).toHaveText("chip geracao-digital-caio-pessoal fora do cadastro · vai pedir confirmação");

    const field = page.getByLabel("Mensagem para o cliente");
    for (const text of ["Primeira resposta", "Segunda resposta"]) {
      await field.fill(text);
      await field.press("Enter");
      const confirm = page.getByTestId("chip-confirm");
      await expect(confirm).toContainText("não está mais cadastrado");
      if (text === "Primeira resposta") await page.getByTestId("composer").screenshot({ path: `${SHOTS}/chip-fora-do-cadastro.png` });
      await page.getByTestId("chip-confirm-option").filter({ hasText: "Caio" }).click();
      await expect(confirm).toHaveCount(0);
    }
    // Hoje: a confirmação não fica guardada. Duas respostas, duas confirmações.
    expect(served.refused).toHaveLength(2);
    expect(served.sent.map((m) => m.confirmChipId)).toEqual(["caio", "caio"]);
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

  test("reunião: o sistema não fabrica link; sem link o convite vai só com dia e hora, com link colado vai o link colado", async ({ page }) => {
    const served = await serve(page);
    await page.goto(PAGE_URL);
    await firstCard(page).click();
    await page.getByTestId("dossier-open").click();
    await page.getByTestId("register-meeting").click();

    // O campo do link começa vazio e a janela diz que o sistema não cria sala.
    const link = page.getByTestId("meeting-link");
    await expect(link).toHaveValue("");
    await expect(page.getByTestId("meeting-link-help")).toContainText("O sistema não cria a sala");
    await expect(page.getByRole("dialog")).not.toContainText("Gerar sala");
    await page.getByRole("dialog").screenshot({ path: `${SHOTS}/reuniao-link-opcional.png` });

    // Texto que não é endereço é recusado e nada é gravado.
    await link.fill("depois eu mando");
    await page.getByRole("button", { name: "Apenas Salvar" }).click();
    await expect(page.getByTestId("meeting-link-error")).toContainText("não parece um endereço válido");
    expect(served.reminders).toHaveLength(0);

    // Sem link: grava sem link, e o convite que vai para o campo de resposta não tem endereço nenhum.
    await link.fill("");
    await page.getByRole("button", { name: "Salvar e preparar convite" }).click();
    await expect.poll(() => served.reminders.length).toBe(1);
    expect(served.reminders[0].meetingUrl).toBeNull();
    const field = page.getByLabel("Mensagem para o cliente");
    await expect(field).toHaveValue(/nossa reunião está agendada para/);
    expect(await field.inputValue()).not.toMatch(/https?:|meet\.google|Link/i);
    expect(served.sent).toHaveLength(0); // o convite fica no campo; quem envia é a pessoa

    // Remarcar colando um link de verdade: o convite leva exatamente o link colado.
    await page.getByTestId("register-meeting").click();
    await page.getByTestId("meeting-link").fill("https://zoom.us/j/123456789");
    await expect(page.getByTestId("meeting-link-open")).toHaveAttribute("href", "https://zoom.us/j/123456789");
    await page.getByRole("button", { name: "Salvar e preparar convite" }).click();
    await expect(field).toHaveValue(/Link da reunião: https:\/\/zoom\.us\/j\/123456789/);
    await page.getByTestId("composer").screenshot({ path: `${SHOTS}/reuniao-convite-com-link-colado.png` });
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
    await expect(panel).toBeHidden(); // escolher uma lista fecha o painel; espera fechar antes de reabrir

    // "Todos os chips" abre o mesmo painel.
    await page.getByTestId("inbox-chip-link").click();
    await expect(panel).toBeVisible();
    // O painel só escuta o Esc depois de receber o foco (um instante depois de aparecer).
    await expect.poll(() => panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    // O Esc fecha a camada de cima. Se uma dica (tooltip) abriu sob o mouse parado, o primeiro Esc
    // fecha a dica e o seguinte fecha o painel: aperta até o painel sumir.
    await expect(async () => {
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden({ timeout: 700 });
    }).toPass({ timeout: 6000 });

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
    await expect.poll(async () => (await drawer.boundingBox())!.x).toBe(0); // espera a gaveta terminar de entrar
    const box = await inViewport(page, "dossier-drawer");
    expect(box.width).toBe(375); // no celular a gaveta cobre a tela inteira
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
