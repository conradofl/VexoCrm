// Biblioteca de Áudios em Chromium de verdade: a PÁGINA real do Agente IA (aba "Áudios") e o
// editor de passo de follow-up real, com os hooks reais, contra um servidor de mentira que
// guarda estado (o que é enviado aparece na lista; o que é arquivado some).
//
// O que este arquivo prova, e que jsdom não prova:
//   - a aba cabe na janela, no computador e em 375 px, sem rolagem lateral, com os botões dentro da tela;
//   - enviar um arquivo de áudio de verdade faz a linha aparecer e abre o "quando usar" dentro da janela;
//   - o player TOCA: o Chromium decodifica o arquivo devolvido pela API e mede a duração;
//   - arquivar pede confirmação, e o aviso de "em uso" do servidor aparece na tela;
//   - no passo de follow-up, o seletor (Radix) abre, escolhe um áudio e o salvar manda audio_library_id.
//
// Uso: npx playwright test --config playwright.harness.config.ts agente-audios
import { expect, test, type Page } from "@playwright/test";

const SHOTS = process.env.HARNESS_SHOTS_DIR || "test-results/harness";
const ABA = "/e2e/harness/agente-audios.html";
const PASSO = "/e2e/harness/agente-audios.html?view=passo";

/** WAV PCM 8 bits mono, 8 kHz: áudio de verdade, que o navegador toca. */
function makeWav(seconds: number) {
  const rate = 8000;
  const dataSize = seconds * rate;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate, 28);
  buf.writeUInt16LE(1, 32);
  buf.writeUInt16LE(8, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < dataSize; i += 1) buf[44 + i] = Math.floor(i / 20) % 2 === 0 ? 140 : 116;
  return buf;
}

const LIMITS = { maxBytes: 5 * 1024 * 1024, maxSeconds: 180, nameMax: 80, whenToUseMax: 140 };

interface FakeAudio {
  id: string;
  name: string;
  whenToUse: string | null;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: null;
  followupSteps: number;
}

function seed(): FakeAudio[] {
  const base = { mimeType: "audio/ogg", createdAt: "2026-11-10T12:00:00Z", updatedAt: "2026-11-10T12:00:00Z", archivedAt: null as null };
  return [
    { ...base, id: "a1", name: "Apresentação da loja", whenToUse: "Quando o cliente pergunta quem somos e há quanto tempo estamos no mercado", sizeBytes: 412_000, durationSeconds: 47, followupSteps: 2 },
    { ...base, id: "a2", name: "Como funciona a entrega para outras cidades do Triângulo Mineiro", whenToUse: "Quando perguntam sobre frete ou prazo", sizeBytes: 1_250_000, durationSeconds: 125, followupSteps: 0 },
    { ...base, id: "a3", name: "Agradecimento", whenToUse: null, sizeBytes: 96_000, durationSeconds: 12, followupSteps: 0 },
  ];
}

interface Served {
  audios: FakeAudio[];
  uploads: { filename: string; bytes: number }[];
  patches: { id: string; body: { name: string; whenToUse: string | null } }[];
  archived: string[];
  templatePosts: Record<string, unknown>[];
}

async function serve(page: Page): Promise<Served> {
  const served: Served = { audios: seed(), uploads: [], patches: [], archived: [], templatePosts: [] };
  const wav = makeWav(2);
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname === "/api/audio-library/access") {
      return json(200, { success: true, allowed: true, reason: null, message: null, limits: LIMITS });
    }
    if (url.pathname === "/api/audio-library" && method === "GET") {
      return json(200, { success: true, audios: served.audios });
    }
    if (url.pathname === "/api/audio-library" && method === "POST") {
      const filename = decodeURIComponent(req.headers()["x-file-name"] || "audio");
      const bytes = req.postDataBuffer()?.length || 0;
      served.uploads.push({ filename, bytes });
      const novo: FakeAudio = {
        id: `novo-${served.uploads.length}`,
        name: filename.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " "),
        whenToUse: null,
        mimeType: "audio/wav",
        sizeBytes: bytes,
        durationSeconds: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        archivedAt: null,
        followupSteps: 0,
      };
      served.audios = [novo, ...served.audios];
      return json(201, { success: true, audio: novo });
    }
    const byId = url.pathname.match(/^\/api\/audio-library\/([^/]+)(\/file|\/archive)?$/);
    if (byId) {
      const [, id, action] = byId;
      const audio = served.audios.find((a) => a.id === id);
      if (!audio) return json(404, { success: false, error: { code: "NOT_FOUND", message: "Áudio não encontrado." } });
      if (action === "/file") return route.fulfill({ status: 200, contentType: "audio/wav", body: wav });
      if (action === "/archive") {
        if (audio.followupSteps > 0) {
          return json(409, {
            success: false,
            error: {
              code: "AUDIO_IN_USE",
              message: 'Este áudio está em uso no follow-up: "Passo 1" (Boas-vindas), "Passo 3" (Reativação). Troque o áudio desses passos antes de arquivar.',
            },
          });
        }
        served.archived.push(id);
        served.audios = served.audios.filter((a) => a.id !== id);
        return json(200, { success: true, audioId: id });
      }
      if (method === "PATCH") {
        const body = req.postDataJSON();
        served.patches.push({ id, body });
        audio.name = body.name;
        audio.whenToUse = body.whenToUse;
        return json(200, { success: true, audio });
      }
    }
    if (url.pathname === "/api/followup/templates" && method === "POST") {
      const body = req.postDataJSON();
      served.templatePosts.push(body);
      return json(201, { success: true, template: { id: "tpl-1", created_at: new Date().toISOString(), ...body } });
    }
    return json(200, {});
  });
  return served;
}

/** A caixa do elemento está inteira dentro da janela (na horizontal), e tem tamanho. */
async function expectInsideViewport(page: Page, locator: ReturnType<Page["locator"]>) {
  const box = await locator.boundingBox();
  const vw = page.viewportSize()!.width;
  expect(box, "elemento sem caixa (não está na tela)").not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 0.5);
}

async function expectNoSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "a página tem rolagem lateral").toBeLessThanOrEqual(0);
}

for (const viewport of [
  { nome: "computador", width: 1366, height: 768 },
  { nome: "375", width: 375, height: 812 },
]) {
  test.describe(`aba Áudios — ${viewport.nome}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("a aba abre dentro da janela, com a lista e os botões visíveis", async ({ page }) => {
      await serve(page);
      await page.goto(ABA);

      const aba = page.getByRole("tab", { name: "Áudios" });
      await expect(aba).toBeVisible();
      await expect(aba).toHaveAttribute("data-state", "active");

      const rows = page.getByTestId("audio-library-row");
      await expect(rows).toHaveCount(3);
      await expectNoSideScroll(page);

      await expectInsideViewport(page, page.getByRole("button", { name: "Enviar áudio" }));
      for (let i = 0; i < 3; i += 1) {
        const row = rows.nth(i);
        await expectInsideViewport(page, row);
        await expectInsideViewport(page, row.getByRole("button", { name: "Editar" }));
        await expectInsideViewport(page, row.getByRole("button", { name: "Arquivar" }));
        await expectInsideViewport(page, row.getByRole("button", { name: /^Ouvir / }));
      }
      // Nome comprido quebra a linha em vez de empurrar os botões para fora.
      await expect(rows.nth(1).getByText("Como funciona a entrega para outras cidades do Triângulo Mineiro")).toBeVisible();
      await expect(rows.nth(0).getByText(/em uso em 2 passos de follow-up/)).toBeVisible();
      await expect(rows.nth(2).getByText(/Sem “quando usar”/)).toBeVisible();

      await page.screenshot({ path: `${SHOTS}/audios-${viewport.nome}-lista.png`, fullPage: true });
    });

    test("enviar um áudio de verdade, dizer quando usar, ouvir e arquivar", async ({ page }) => {
      const served = await serve(page);
      await page.goto(ABA);
      await expect(page.getByTestId("audio-library-row")).toHaveCount(3);

      // Enviar
      await page.getByTestId("audio-library-file-input").setInputFiles({
        name: "boas_vindas-loja.wav",
        mimeType: "audio/wav",
        buffer: makeWav(2),
      });
      await expect(page.getByTestId("audio-library-row")).toHaveCount(4);
      expect(served.uploads).toEqual([{ filename: "boas_vindas-loja.wav", bytes: 44 + 16000 }]);

      // O "quando usar" abre sozinho, dentro da janela.
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("Editar áudio")).toBeVisible();
      await expectInsideViewport(page, dialog);
      await expect(dialog.getByLabel("Nome")).toHaveValue("boas vindas loja");

      await dialog.getByLabel("Quando usar").fill("x".repeat(141));
      await expect(dialog.getByTestId("audio-library-when-counter")).toHaveText("141/140");
      await expect(dialog.getByRole("button", { name: "Salvar" })).toBeDisabled();

      await dialog.getByLabel("Nome").fill("Boas-vindas da loja");
      await dialog.getByLabel("Quando usar").fill("Na primeira mensagem de quem chegou pelo anúncio");
      await expectInsideViewport(page, dialog.getByRole("button", { name: "Salvar" }));
      await page.screenshot({ path: `${SHOTS}/audios-${viewport.nome}-quando-usar.png` });
      await dialog.getByRole("button", { name: "Salvar" }).click();
      await expect(dialog).toBeHidden();
      expect(served.patches).toEqual([
        { id: "novo-1", body: { name: "Boas-vindas da loja", whenToUse: "Na primeira mensagem de quem chegou pelo anúncio" } },
      ]);
      const nova = page.getByTestId("audio-library-row").first();
      await expect(nova.getByText("Boas-vindas da loja")).toBeVisible();
      await expect(nova.getByText("Na primeira mensagem de quem chegou pelo anúncio")).toBeVisible();

      // Ouvir: o Chromium decodifica o arquivo devolvido pela API.
      await nova.getByRole("button", { name: "Ouvir Boas-vindas da loja" }).click();
      const player = nova.getByTestId("audio-library-player");
      await expect(player).toBeVisible();
      await expectInsideViewport(page, player);
      await expect
        .poll(() => player.evaluate((el: HTMLAudioElement) => (el.error ? -1 : el.duration)), { timeout: 10_000 })
        .toBeCloseTo(2, 1);
      await page.screenshot({ path: `${SHOTS}/audios-${viewport.nome}-tocando.png`, fullPage: true });
      await nova.getByRole("button", { name: "Parar Boas-vindas da loja" }).click();
      await expect(player).toHaveCount(0);

      // Arquivar um áudio em uso: pede confirmação e mostra o aviso do servidor.
      const emUso = page.getByTestId("audio-library-row").filter({ hasText: "Apresentação da loja" });
      await emUso.getByRole("button", { name: "Arquivar" }).click();
      const confirm = page.getByRole("alertdialog");
      await expect(confirm.getByText("Arquivar “Apresentação da loja”?")).toBeVisible();
      await expectInsideViewport(page, confirm);
      expect(served.archived).toEqual([]);
      await confirm.getByRole("button", { name: "Arquivar" }).click();
      const aviso = page.getByText(/Este áudio está em uso no follow-up: "Passo 1" \(Boas-vindas\)/);
      await expect(aviso).toBeVisible();
      await expectInsideViewport(page, aviso);
      await page.screenshot({ path: `${SHOTS}/audios-${viewport.nome}-em-uso.png` });
      await expect(emUso).toHaveCount(1);

      // Arquivar um áudio livre: some da lista.
      const livre = page.getByTestId("audio-library-row").filter({ hasText: "Agradecimento" });
      await livre.getByRole("button", { name: "Arquivar" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Arquivar" }).click();
      await expect(livre).toHaveCount(0);
      expect(served.archived).toEqual(["a3"]);
      await expectNoSideScroll(page);
    });
  });

  test.describe(`passo de follow-up com áudio da biblioteca — ${viewport.nome}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("escolhe um áudio no seletor, vê o aviso e salva sem digitar texto", async ({ page }) => {
      const served = await serve(page);
      await page.goto(PASSO);

      const bloco = page.getByTestId("step-library-audio");
      await bloco.scrollIntoViewIfNeeded();
      await expect(bloco).toBeVisible();
      await expectInsideViewport(page, bloco);

      await bloco.getByRole("combobox", { name: "Escolher áudio da biblioteca" }).click();
      const opcao = page.getByRole("option", { name: /Apresentação da loja · 0:47/ });
      await expect(opcao).toBeVisible();
      await expectInsideViewport(page, opcao);
      await page.screenshot({ path: `${SHOTS}/passo-${viewport.nome}-seletor.png` });
      await opcao.click();

      await expect(bloco.getByText("Apresentação da loja")).toBeVisible();
      await expect(bloco.getByText(/Neste passo vai só o áudio/)).toBeVisible();
      // Áudio da biblioteca e anexo solto não convivem: o bloco de anexo some.
      await expect(page.getByText("Anexo de Mídia (Opcional)")).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}/passo-${viewport.nome}-escolhido.png` });

      const salvar = page.getByRole("button", { name: /Salvar|Adicionar|Criar/ }).last();
      await expectInsideViewport(page, salvar);
      await salvar.click();

      await expect.poll(() => served.templatePosts.length).toBe(1);
      expect(served.templatePosts[0]).toMatchObject({
        campaign_id: "cadencia-1",
        audio_library_id: "a1",
        media_path: null,
        media_type: null,
        message: "",
      });
    });
  });
}
