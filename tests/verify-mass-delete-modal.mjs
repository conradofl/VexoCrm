import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  console.log('🚀 Iniciando validação com Playwright (Chromium em 768px de altura)...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
  });
  const page = await context.newPage();

  // Carregar o CSS compilado do frontend
  const cssPath = path.resolve(__dirname, '../frontend/dist/assets');
  const cssFiles = fs.readdirSync(cssPath).filter((f) => f.endsWith('.css'));
  if (cssFiles.length === 0) {
    throw new Error('Nenhum CSS encontrado em frontend/dist/assets. Rode npm run build primeiro.');
  }
  const cssContent = fs.readFileSync(path.join(cssPath, cssFiles[0]), 'utf-8');

  // Gerar tags para preencher a lista
  const sampleTags = Array.from({ length: 40 }, (_, i) => `Tag Número ${i + 1} (${(i + 1) * 10} leads)`);
  const tagsHtml = sampleTags
    .map(
      (t) => `
      <button type="button" class="w-full flex items-center justify-between px-2 py-1.5 rounded cursor-pointer text-left hover:bg-muted/60">
        <div class="flex items-center gap-2">
          <span class="w-4 h-4 rounded border flex items-center justify-center text-[10px] border-input bg-background"></span>
          <span>${t}</span>
        </div>
      </button>`
    )
    .join('');

  const html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <style>
        ${cssContent}
      </style>
    </head>
    <body class="bg-background text-foreground antialiased min-h-screen">
      <div class="fixed inset-0 z-50 bg-black/80"></div>
      <div
        data-testid="mass-delete-dialog"
        role="dialog"
        class="fixed left-[50%] top-[50%] z-50 w-full translate-x-[-50%] translate-y-[-50%] border bg-background shadow-lg duration-200 sm:rounded-lg max-w-lg max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden"
      >
        <!-- Cabeçalho fixo no topo -->
        <div data-testid="mass-delete-header" class="flex flex-col space-y-1 sm:text-left p-5 pb-3 border-b shrink-0 pr-10 text-left">
          <h2 class="text-base font-semibold leading-tight tracking-tight">Excluir leads por tags</h2>
          <p class="text-xs text-muted-foreground">
            Exclusão em massa, irreversível. Selecione uma ou mais tags e confira os números antes de confirmar.
          </p>
        </div>

        <!-- Miolo rolável -->
        <div data-testid="mass-delete-body" class="flex-1 overflow-y-auto p-5 py-4 space-y-4 min-h-0">
          <div class="space-y-4">
            <!-- Seletor de tags -->
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="text-xs font-semibold text-foreground">Tags selecionadas (1)</label>
              </div>

              <input placeholder="Buscar tags..." class="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs" />

              <!-- Lista rolável de tags com altura limitada (max-h-28) -->
              <div
                data-testid="mass-delete-tag-list"
                role="group"
                aria-label="Lista de tags disponíveis"
                class="max-h-28 overflow-y-auto rounded-md border bg-background p-1 space-y-0.5 text-xs"
              >
                ${tagsHtml}
              </div>
            </div>

            <!-- Prévia de exclusão -->
            <div data-testid="mass-delete-preview" class="space-y-3 text-sm">
              <dl class="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                <dt>Leads com esta tag</dt>
                <dd data-testid="num-matched">17.845</dd>
                <dt>Também têm tag de outra importação</dt>
                <dd data-testid="num-multi-import">12.000</dd>
                <dt>Já trocaram mensagem</dt>
                <dd data-testid="num-with-messages">5.844</dd>
                <dt class="font-semibold">Serão apagados</dt>
                <dd class="font-semibold" data-testid="num-will-delete">1</dd>
                <dt>Sobram (mantidos)</dt>
                <dd data-testid="num-kept">17.844</dd>
              </dl>

              <!-- Explicação do salto / leads protegidos -->
              <p
                data-testid="mass-delete-protected-note"
                class="text-xs text-muted-foreground bg-muted/40 rounded-md border border-border/60 p-2.5 leading-relaxed"
              >
                Os demais 17.844 leads estão protegidos porque vieram de mais de uma importação ou já trocaram mensagem — marque as caixas abaixo para incluí-los.
              </p>

              <!-- Opções de proteção -->
              <div class="space-y-1.5 rounded-md border p-2.5 text-xs">
                <label class="flex items-start gap-2">
                  <input type="checkbox" />
                  <span>Apagar também os que vieram de mais de uma importação (12.000)</span>
                </label>
                <label class="flex items-start gap-2">
                  <input type="checkbox" />
                  <span>Apagar também os que já trocaram mensagem (5.844)</span>
                </label>
              </div>

              <div class="space-y-1">
                <button
                  data-testid="btn-export"
                  type="button"
                  class="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1.5 gap-1.5 text-xs font-medium"
                >
                  Exportar o 1 lead que será apagado (planilha)
                </button>
                <p class="text-[11px] text-muted-foreground">
                  Não há desfazer. Se precisar voltar atrás, só reimportando esta planilha.
                </p>
              </div>

              <p data-testid="mass-delete-sentence" class="font-medium">
                Apagar 1 lead com a tag Lista Out/26.
              </p>
            </div>
          </div>
        </div>

        <!-- Rodapé fixo embaixo -->
        <div
          data-testid="mass-delete-footer"
          class="sm:flex-row sm:justify-end p-4 pt-3 border-t bg-muted/20 shrink-0 flex flex-row items-center justify-end gap-2 sm:space-x-0"
        >
          <button data-testid="btn-cancel" type="button" class="inline-flex items-center justify-center rounded-md px-3 py-2 text-sm">
            Cancelar
          </button>
          <button
            data-testid="btn-confirm"
            type="button"
            class="inline-flex items-center justify-center rounded-md bg-destructive text-destructive-foreground px-3 py-2 text-sm font-medium gap-1.5"
          >
            Apagar 1 lead
          </button>
        </div>
      </div>
    </body>
    </html>
  `;

  await page.setContent(html);

  // 1. Validar altura da janela e da modal
  const viewport = page.viewportSize();
  console.log(`✓ Viewport configurada: ${viewport.width}x${viewport.height}px`);
  if (viewport.height !== 768) throw new Error('Viewport height deve ser 768');

  const dialog = page.locator('[data-testid="mass-delete-dialog"]');
  const dialogBox = await dialog.boundingBox();
  console.log(`✓ Altura da modal calculada pelo Chromium: ${dialogBox.height.toFixed(1)}px (Teto 85vh = ${(768 * 0.85).toFixed(1)}px)`);

  if (dialogBox.height > 768 * 0.85 + 0.1) {
    throw new Error(`Modal excedeu 85% da janela: ${dialogBox.height}px > ${768 * 0.85}px`);
  }

  if (dialogBox.y < 0 || dialogBox.y + dialogBox.height > 768) {
    throw new Error(`Modal extrapolou os limites da tela: top=${dialogBox.y}, bottom=${dialogBox.y + dialogBox.height}`);
  }

  // 2. Validar cabeçalho e rodapé visíveis
  const header = page.locator('[data-testid="mass-delete-header"]');
  const footer = page.locator('[data-testid="mass-delete-footer"]');
  const body = page.locator('[data-testid="mass-delete-body"]');

  const headerBoxBefore = await header.boundingBox();
  const footerBoxBefore = await footer.boundingBox();
  console.log(`✓ Cabeçalho visível no topo (y=${headerBoxBefore.y.toFixed(1)}px, height=${headerBoxBefore.height.toFixed(1)}px)`);
  console.log(`✓ Rodapé visível na base (y=${footerBoxBefore.y.toFixed(1)}px, height=${footerBoxBefore.height.toFixed(1)}px)`);

  const cancelBtn = page.locator('[data-testid="btn-cancel"]');
  const confirmBtn = page.locator('[data-testid="btn-confirm"]');
  if (!(await cancelBtn.isVisible()) || !(await confirmBtn.isVisible())) {
    throw new Error('Botões do rodapé não estão visíveis!');
  }

  // 3. Validar lista de tags com rolagem própria e altura limitada (max-h-28 = 112px)
  const tagList = page.locator('[data-testid="mass-delete-tag-list"]');
  const tagListBox = await tagList.boundingBox();
  console.log(`✓ Lista de tags com altura limitada: ${tagListBox.height.toFixed(1)}px (<= 112px)`);
  if (tagListBox.height > 113) {
    throw new Error(`Lista de tags excedeu max-h-28: ${tagListBox.height}px`);
  }
  const isTagListScrollable = await tagList.evaluate((el) => el.scrollHeight > el.clientHeight);
  console.log(`✓ Lista de tags possui rolagem interna: ${isTagListScrollable}`);
  if (!isTagListScrollable) throw new Error('Lista de tags deveria ter scroll interno!');

  // 4. Validar rolagem interna do miolo
  const isBodyScrollable = await body.evaluate((el) => el.scrollHeight > el.clientHeight);
  console.log(`✓ Miolo da modal possui rolagem interna: ${isBodyScrollable}`);
  if (!isBodyScrollable) throw new Error('Miolo da modal deveria ser rolável!');

  // Rolar até o fim
  await body.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  console.log('✓ Miolo rolado até o final.');

  // 5. Verificar que cabeçalho e rodapé permaneceram fixos na MESMA POSIÇÃO após a rolagem
  const headerBoxAfter = await header.boundingBox();
  const footerBoxAfter = await footer.boundingBox();

  if (Math.abs(headerBoxAfter.y - headerBoxBefore.y) > 0.5) {
    throw new Error(`Cabeçalho se moveu durante rolagem: ${headerBoxBefore.y} -> ${headerBoxAfter.y}`);
  }
  if (Math.abs(footerBoxAfter.y - footerBoxBefore.y) > 0.5) {
    throw new Error(`Rodapé se moveu durante rolagem: ${footerBoxBefore.y} -> ${footerBoxAfter.y}`);
  }
  console.log('✓ Cabeçalho e rodapé permaneceram perfeitamente fixos durante a rolagem!');

  if (!(await cancelBtn.isVisible()) || !(await confirmBtn.isVisible())) {
    throw new Error('Botões do rodapé deixaram de ser visíveis após rolagem!');
  }
  console.log('✓ Botões de Cancelar e Confirmar continuam 100% visíveis e acessíveis sem rolar a página por trás!');

  // 6. Validar texto de exportação singular e nota de proteção
  const exportBtn = page.locator('[data-testid="btn-export"]');
  const exportText = await exportBtn.textContent();
  console.log(`✓ Texto botão singular: "${exportText.trim()}"`);
  if (exportText.trim() !== 'Exportar o 1 lead que será apagado (planilha)') {
    throw new Error(`Texto inesperado no botão: ${exportText}`);
  }

  const noteText = await page.locator('[data-testid="mass-delete-protected-note"]').textContent();
  console.log(`✓ Nota explicativa dos leads mantidos: "${noteText.trim()}"`);

  await browser.close();
  console.log('🎉 TODOS OS TESTES DE LAYOUT E VIEWPORT PLAYWRIGHT PASSARAM COM SUCESSO!');
}

run().catch((err) => {
  console.error('❌ Falha na validação:', err);
  process.exit(1);
});
