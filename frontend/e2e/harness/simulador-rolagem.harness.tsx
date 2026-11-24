// Harness do Simulador de WhatsApp da tela de campanha (src/pages/LeadImports/WhatsAppPreviewPanel.tsx).
// Mesma grade da página (lg:grid-cols-3, items-start) com uma coluna de formulário bem comprida ao lado,
// e uma sequência longa (4 portas), como uma campanha elaborada de verdade.
import { createRoot } from "react-dom/client";
import "@/index.css";
import { WhatsAppPreviewPanel } from "@/pages/LeadImports/WhatsAppPreviewPanel";
import type { CampaignSequenceStep } from "@/hooks/useCampanhas";

const longo = "Texto de exemplo de uma mensagem mais comprida, que ocupa algumas linhas no balão do simulador. ".repeat(3);
const passo = (order: number, triggerMode: CampaignSequenceStep["triggerMode"], text: string, type: CampaignSequenceStep["type"] = "text"): CampaignSequenceStep => ({
  id: `p${order}`, type, order, text, enabled: true, delayAfterSeconds: 5, image: null, triggerMode,
  ...(type === "link" ? { linkUrl: "https://tingebrasil.com/#cores" } : {}),
});
const sequencia: CampaignSequenceStep[] = [
  passo(1, "immediate", "Primeira mensagem do disparo. " + longo),
  passo(2, "after_reply", "Porta 1. " + longo),
  passo(3, "with_previous", "Link da porta 1", "link"),
  passo(4, "after_reply", "Porta 2. " + longo),
  passo(5, "with_previous", "Junto com a porta 2. " + longo),
  passo(6, "after_reply", "Porta 3. " + longo),
  passo(7, "after_reply", "ULTIMA MENSAGEM DO ROTEIRO"),
];

createRoot(document.getElementById("root")!).render(
  <div className="p-6 bg-slate-50 min-h-screen">
    <div className="grid gap-6 lg:grid-cols-3 items-start">
      <div className="lg:col-span-2 space-y-4">
        {Array.from({ length: 30 }, (_, i) => (
          <div key={i} className="h-40 rounded-xl bg-white border">Bloco do formulário {i + 1}</div>
        ))}
      </div>
      <WhatsAppPreviewPanel campaignSequence={sequencia} multiAgendaEnabled={false} />
    </div>
  </div>
);
