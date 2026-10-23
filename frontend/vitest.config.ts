import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // 5 s (padrão) estoura no runner do CI (2 vCPU) em telas grandes como o Banco de Dados; local passa em 1-2 s.
    testTimeout: 15_000,
    // src/lib/firebase.ts recusa subir sem essas chaves; sem elas no ambiente (CI, worktree sem .env) ~20 arquivos de
    // teste nem carregavam e o "Frontend checks" ficava vermelho em todo PR. Valores fictícios: teste não fala com o
    // Firebase de verdade.
    env: {
      VITE_FIREBASE_API_KEY: "test-api-key",
      VITE_FIREBASE_AUTH_DOMAIN: "test.firebaseapp.com",
      VITE_FIREBASE_PROJECT_ID: "test-project",
      VITE_FIREBASE_APP_ID: "test-app-id",
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
