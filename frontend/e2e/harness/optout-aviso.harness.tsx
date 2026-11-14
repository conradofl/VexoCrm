// Harness do aviso de opt-out para abrir em navegador de verdade (Chromium).
// - O diálogo REAL de destinatários do lote (src/pages/LeadImports/DispatchRecipientsDialog.tsx), com o hook real;
//   o servidor é de mentira (o teste responde a /api/** pelo Playwright).
// - O aviso do público nos dois recipientes em que ele entra: a caixa da lista do assistente (Banco de Dados) e o
//   cartão "Público do Banco de Dados Ativo" (Campanhas), com as mesmas classes dos dois lugares.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import { DispatchRecipientsDialog } from "@/pages/LeadImports/DispatchRecipientsDialog";
import { OptOutSkipNotice } from "@/components/leads/OptOutSkipNotice";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const params = new URLSearchParams(window.location.search);
const publico = params.get("publico");
const publicoCount = publico === null ? null : publico === "null" ? null : Number(publico);

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    {params.get("cena") === "lote" ? (
      <DispatchRecipientsDialog dispatchId="lote-1" onClose={() => {}} />
    ) : (
      <div className="p-4 space-y-4 max-w-xl">
        <div data-testid="caixa-assistente" className="border border-border rounded-lg overflow-hidden">
          <div className="bg-muted/50 px-3 py-2 border-b border-border flex items-center justify-between text-xs font-semibold">
            <span>Lista de Leads Selecionados (3 de 3)</span>
          </div>
          <OptOutSkipNotice count={publicoCount} className="px-3 py-2 border-b border-border" />
          <div className="max-h-48 overflow-y-auto px-3 py-2 text-xs">Ana · Bia · Caio</div>
        </div>
        <div data-testid="cartao-campanhas" className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-800">
          <div className="flex items-center gap-2.5">
            <div>
              <p className="font-semibold text-foreground">Público do Banco de Dados Ativo</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Público vindo do Banco de Dados (3 leads)</p>
              <OptOutSkipNotice count={publicoCount} className="mt-1.5 rounded-md px-2 py-1" />
            </div>
          </div>
        </div>
      </div>
    )}
  </QueryClientProvider>
);
