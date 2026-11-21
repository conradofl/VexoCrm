// Harness da tela de IA (PR #179 trazido para o main, 21/11/2026), para abrir em Chromium de verdade.
//   ?view=geral  (padrão) -> aba Geral real (TabGeral): a lista de motores de IA;
//   ?view=teste           -> aba Teste real (TabTeste): o simulador.
// Hooks reais. De mentira só quem está logado (stubs/AuthContext, por alias no vite.harness.config.ts)
// e o servidor (o teste responde a /api/** pelo Playwright).
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TabGeral } from "@/pages/ChatbotSettings/TabGeral";
import { TabTeste } from "@/pages/ChatbotSettings/TabTeste";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const view = new URLSearchParams(window.location.search).get("view") || "geral";

const client = {
  id: "sonhare",
  name: "Sonhare",
  n8n_settings: { chatbot_enabled: true, chatbot_model: "generico", chatbot_llm_model: "" },
} as unknown as Parameters<typeof TabGeral>[0]["client"];

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
    <MemoryRouter initialEntries={["/crm/chatbot"]}>
      <main style={{ padding: 16 }}>
        {view === "teste" ? (
          <TabTeste clientId="sonhare" />
        ) : (
          <TabGeral clientId="sonhare" clientName="Sonhare" client={client} />
        )}
      </main>
    </MemoryRouter>
    </TooltipProvider>
  </QueryClientProvider>
);
