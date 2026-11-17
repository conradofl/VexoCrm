// Harness do lote calado (Nous, 16/11/2026) para abrir em Chromium de verdade.
// - cena=lote: o diálogo REAL de destinatários (src/pages/LeadImports/DispatchRecipientsDialog.tsx) com o hook real.
// - cena=cartao: o acompanhamento REAL de disparos (DispatchCampaignTracker) com o hook real do resumo.
// O servidor é de mentira: o teste responde a /api/** pelo Playwright.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import { DispatchRecipientsDialog } from "@/pages/LeadImports/DispatchRecipientsDialog";
import { DispatchCampaignTracker } from "@/pages/LeadImports/DispatchCampaignTracker";
import { Toaster } from "@/components/ui/toaster";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const params = new URLSearchParams(window.location.search);

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    {params.get("cena") === "lote" ? (
      <DispatchRecipientsDialog dispatchId="lote-1" onClose={() => {}} />
    ) : (
      <div className="p-3 sm:p-6">
        <DispatchCampaignTracker clientId="nous-gestao" onOpenDispatch={() => {}} />
      </div>
    )}
    <Toaster />
  </QueryClientProvider>
);
