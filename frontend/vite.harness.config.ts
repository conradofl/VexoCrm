import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Vite do harness de tela (e2e/harness). Igual ao da aplicação, com o contexto de
// autenticação trocado por um dublê: o harness não fala com o Firebase.
export default defineConfig({
  define: { __APP_VERSION__: "null" },
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@/contexts/AuthContext", replacement: path.resolve(__dirname, "./e2e/harness/stubs/AuthContext.tsx") },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
  },
});
