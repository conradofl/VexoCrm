// Harness do diário do chip (Nous, 17/11/2026) para abrir em Chromium de verdade: a aba "Saúde & Volume" montada como
// em src/pages/ChipsWhatsapp.tsx, com o relatório REAL de saúde e o diário REAL, cada um com o seu hook real.
// O servidor é de mentira: o teste responde a /api/** pelo Playwright.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import { ChipsHealthReport } from "@/components/chips/ChipsHealthReport";
import { ChipDiary } from "@/components/chips/ChipDiary";
import type { LeadClient } from "@/hooks/useLeadClients";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const tenant = { id: "nous-gestao", name: "Nous Gestao", n8n_settings: { evolution_instances: [] } } as unknown as LeadClient;

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <div className="p-3 sm:p-6">
      <div className="space-y-6">
        <ChipsHealthReport tenant={tenant} />
        <ChipDiary clientId={tenant.id} />
      </div>
    </div>
  </QueryClientProvider>
);
