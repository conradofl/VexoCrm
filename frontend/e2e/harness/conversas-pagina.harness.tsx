// Harness da aba Conversas para abrir em navegador de verdade (Chromium).
// Monta a PÁGINA REAL (src/pages/WhatsAppInbox.tsx) com os hooks reais. Só duas coisas são de
// mentira: quem está logado (stubs/AuthContext, trocado por alias no vite.harness.config.ts) e
// o servidor (o teste responde a /api/** pelo Playwright).
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import { CrmClientContext, type CrmClientContextValue } from "@/contexts/crm-client-context";
import WhatsAppInbox from "@/pages/WhatsAppInbox";

const queryClient = new QueryClient();
const crm = {
  clients: [],
  selectedClientId: "geracao-digital",
  selectedClient: null,
  isLoading: false,
  error: null,
  setSelectedClientId: () => {},
} as CrmClientContextValue;

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <MemoryRouter>
      <CrmClientContext.Provider value={crm}>
        <WhatsAppInbox />
      </CrmClientContext.Provider>
    </MemoryRouter>
  </QueryClientProvider>
);
