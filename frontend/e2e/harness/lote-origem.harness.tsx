// Harness do "De onde tirar o lote" (24/11/2026): a janela REAL do Separar lotes com tags, planilhas e um filtro da tela,
// como a página do Banco passa. ?modo=filtro abre como o botão "Separar lote deste filtro". O servidor é de mentira.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import { SepararLotesDialog } from "@/components/leads/SepararLotesDialog";

const TAG = 'LEADS - "clientes" - TINGE BRASIL';
const modoFiltro = new URLSearchParams(window.location.search).get("modo") === "filtro";

function Pagina() {
  const [aberto, setAberto] = useState(true);
  return (
    <main className="p-3 sm:p-6">
      <button type="button" onClick={() => setAberto(true)} data-testid="abrir">Abrir</button>
      <SepararLotesDialog
        open={aberto}
        onOpenChange={setAberto}
        clientId="tinge-brasil"
        chips={[{ id: "chip-comercial", name: "Comercial- Tinge Brasil", connection_state: "open" }]}
        tags={[
          { tag: "agenda-whatsapp", count: 2263 },
          { tag: TAG, count: 685 },
          { tag: "Clientes atendidos (conversas)", count: 56 },
        ]}
        planilhas={[{ id: "imp-1", nome: "Lead extraídos - Comercial Tinge Brasil.xlsx", linhas: 688 }]}
        filtroAtual={{ filtro: { stage: "all", tag: TAG, search: "Cliente" }, rotulo: `tag ${TAG}, busca "Cliente"`, total: 557 }}
        origemInicial={modoFiltro ? { tipo: "filtro", filtro: { stage: "all", tag: TAG, search: "Cliente" } } : undefined}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Pagina />);
