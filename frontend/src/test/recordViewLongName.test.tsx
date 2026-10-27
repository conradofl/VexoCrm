// frontend/src/test/recordViewLongName.test.tsx
//
// SPEC 15 — na Fila de Envios o nome longo da campanha escorria por cima da coluna Estado.
// Causa (RecordView.tsx): a célula do nome era o único campo embrulhado num div extra, sem min-w-0. Item de grid tem
// min-width:auto: a célula não encolhia abaixo do conteúdo, a coluna estourava e o truncate nunca entrava. E o
// truncate estava num <span> inline, onde overflow não vale.
//
// O jsdom não calcula layout: este teste confere, no componente renderizado de verdade, a estrutura que faz o corte
// funcionar no navegador — célula que encolhe (min-w-0), valor em bloco com corte de duas linhas, nome inteiro no
// title — e que o Estado continua na própria célula, inteiro.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecordView, type RecordField } from "@/components/records/RecordView";

type Lote = { id: string; nome: string; estado: string };

const NOME_120 =
  "Funil Spazio — Reativação de clientes inativos [importação planilha-bia-do-spazio-outubro-2026-lote-final-revisado-v3.1]";

const campos: RecordField<Lote>[] = [
  { key: "nome", label: "Campanha", render: (l) => l.nome },
  { key: "estado", label: "Estado", render: (l) => l.estado },
];

function renderLista(item: Lote) {
  return render(
    <RecordView<Lote>
      mode="list"
      items={[item]}
      getId={(l) => l.id}
      fields={campos}
      stripeClass={() => "bg-slate-200"}
      renderCard={() => null}
      renderExpanded={() => null}
      testIdPrefix="fila"
      labelOf={(l) => l.nome}
    />
  );
}

describe("SPEC 15 — nome longo de campanha na lista não invade a coluna do lado", () => {
  it("nome de 120 caracteres: célula encolhe (min-w-0), corta em duas linhas, nome inteiro no title; Estado legível", () => {
    expect(NOME_120).toHaveLength(120);
    renderLista({ id: "lote-1", nome: NOME_120, estado: "Aguardando janela de envio" });

    const celulaNome = screen.getByTestId("fila-row-name-lote-1");
    expect(celulaNome.className.split(/\s+/)).toContain("min-w-0");
    expect(celulaNome.getAttribute("title")).toBe(NOME_120);

    const valorNome = celulaNome.querySelector('[data-field="nome"]') as HTMLElement;
    expect(valorNome.textContent).toBe(NOME_120);
    const classesNome = valorNome.className.split(/\s+/);
    // line-clamp-2 já é caixa de bloco (display:-webkit-box): o tailwind-merge tira o "block" por conflito de display
    expect(classesNome).toEqual(expect.arrayContaining(["min-w-0", "line-clamp-2", "break-words"]));
    expect(classesNome).not.toContain("truncate"); // uma linha só não diz nada: os nomes carregam a tag inteira

    // o Estado é a célula seguinte do grid, fora da do nome, inteiro
    const estado = screen.getByText("Aguardando janela de envio");
    expect(celulaNome.contains(estado)).toBe(false);
    expect(estado.getAttribute("data-field")).toBe("estado");
    expect(estado.className.split(/\s+/)).toEqual(expect.arrayContaining(["block", "min-w-0", "truncate"]));
  });
});
