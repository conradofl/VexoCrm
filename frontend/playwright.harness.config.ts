import { defineConfig, devices } from "@playwright/test";

// Prova de tela em Chromium de verdade, contra o harness em e2e/harness.
// Uso: npx playwright test --config playwright.harness.config.ts
export default defineConfig({
  testDir: "./e2e/harness",
  testMatch: /.*\.harness\.pw\.ts/,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:8097", headless: true },
  webServer: {
    command: "npx vite --config vite.harness.config.ts --port 8097 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:8097/e2e/harness/conversas-pagina.html",
    reuseExistingServer: true,
    timeout: 120_000,
    // A API do harness é o próprio endereço do Vite: o teste intercepta /api/** antes de sair.
    env: { VITE_API_BASE_URL: "http://127.0.0.1:8097" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } } }],
});
