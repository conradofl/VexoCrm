// Harness do Gestor de Tráfego para abrir em navegador de verdade (Chromium).
//   ?tab=conexao | metas | desempenho (padrão) -> a PÁGINA REAL (src/pages/Trafego.tsx).
// Hooks reais. De mentira só quem está logado (stubs/AuthContext, por alias no
// vite.harness.config.ts) e o servidor (o teste responde a /api/** pelo Playwright).
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import "@/index.css";
import { CrmClientContext, type CrmClientContextValue } from "@/contexts/crm-client-context";
import Trafego from "@/pages/Trafego";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const crm = {
  clients: [],
  selectedClientId: "geracao-digital",
  selectedClient: null,
  isLoading: false,
  error: null,
  setSelectedClientId: () => {},
} as CrmClientContextValue;

const tab = new URLSearchParams(window.location.search).get("tab") || "desempenho";

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <MemoryRouter initialEntries={[`/crm/trafego?tab=${tab}`]}>
      <CrmClientContext.Provider value={crm}>
        <Trafego />
        <Toaster />
      </CrmClientContext.Provider>
    </MemoryRouter>
  </QueryClientProvider>
);
