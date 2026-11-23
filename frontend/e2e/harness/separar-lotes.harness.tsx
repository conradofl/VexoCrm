// Harness do "Separar lotes" do Banco de Dados para abrir em Chromium de verdade: a barra de ações REAL com o botão novo
// e a janela REAL. O servidor é de mentira: o teste responde a /api/** pelo Playwright.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import { BancoActionsBar } from "@/components/leads/BancoActionsBar";
import { SepararLotesDialog } from "@/components/leads/SepararLotesDialog";

const nada = () => {};

function Pagina() {
  const [aberto, setAberto] = useState(false);
  return (
    <main className="p-3 sm:p-6">
      <BancoActionsBar
        loading={false}
        onRefresh={nada}
        onExtractWhatsApp={nada}
        onImportInstagram={nada}
        onPasteText={nada}
        onImportSpreadsheet={nada}
        onExportXLSX={nada}
        onExportCSV={nada}
        onCreateCampaign={nada}
        onSeparateBatches={() => setAberto(true)}
        onNewLead={nada}
        selectedCount={0}
        onApplyFollowup={nada}
        onSingleReminder={nada}
        clientId="tinge-brasil"
        canManageBulk={false}
      />
      <div style={{ height: 1400 }} />
      <SepararLotesDialog
        open={aberto}
        onOpenChange={setAberto}
        clientId="tinge-brasil"
        chips={[
          { id: "chip-comercial", name: "Comercial- Tinge Brasil", connection_state: "open" },
          { id: "chip-disparo", name: "Chip disparo - Fixo", connection_state: "open" },
        ]}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Pagina />);
