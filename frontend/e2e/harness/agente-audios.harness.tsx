// Harness da Biblioteca de Áudios para abrir em navegador de verdade (Chromium).
//   ?view=aba   (padrão) -> a PÁGINA REAL do Agente IA (src/pages/AgenteIA.tsx) na aba "Áudios";
//   ?view=passo          -> o editor de passo de follow-up real (StepDrawer), para escolher áudio da biblioteca.
// Hooks reais. De mentira só quem está logado (stubs/AuthContext, por alias no vite.harness.config.ts)
// e o servidor (o teste responde a /api/** pelo Playwright).
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import "@/index.css";
import { CrmClientContext, type CrmClientContextValue } from "@/contexts/crm-client-context";
import AgenteIA from "@/pages/AgenteIA";
import StepDrawer from "@/components/followup/StepDrawer";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const crm = {
  clients: [],
  selectedClientId: "empresa-a",
  selectedClient: null,
  isLoading: false,
  error: null,
  setSelectedClientId: () => {},
} as CrmClientContextValue;

const view = new URLSearchParams(window.location.search).get("view") || "aba";

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <MemoryRouter initialEntries={["/crm/agente?tab=audios"]}>
      <CrmClientContext.Provider value={crm}>
        {view === "passo" ? (
          <StepDrawer
            isOpen
            onClose={() => {}}
            editingStep={null}
            campaignId="cadencia-1"
            stepCount={0}
            anchorFields={[]}
            selectedCrmClient={{ id: "empresa-a" }}
            onSuccess={() => {}}
          />
        ) : (
          <AgenteIA />
        )}
        <Toaster />
      </CrmClientContext.Provider>
    </MemoryRouter>
  </QueryClientProvider>
);
