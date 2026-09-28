// frontend/src/test/waGroupExtractionSection.test.tsx
//
// Terceira procedência do Banco de Dados: membros de grupo. Aviso
// bloqueante antes de qualquer chamada, confirmado uma vez por sessão
// (o componente pai segura esse estado — o Dialog que o hospeda desmonta
// o conteúdo ao fechar). Prévia nunca mostra telefone, só contagem.

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { WaGroupExtractionSection, sumGroupSelection, type WaGroupPreviewItem } from "@/components/leads/WaGroupExtractionSection";

function Harness({ initialConfirmed = false }: { initialConfirmed?: boolean }) {
  const [confirmed, setConfirmed] = React.useState(initialConfirmed);
  const [selection, setSelection] = React.useState<string[]>([]);
  const [groupsEnabled, setGroupsEnabled] = React.useState(false);
  return (
    <div>
      <div data-testid="selection">{JSON.stringify(selection)}</div>
      <div data-testid="enabled">{String(groupsEnabled)}</div>
      <WaGroupExtractionSection
        clientId="tenant-teste"
        instanceId="inst-1"
        getIdToken={async () => "token"}
        confirmed={confirmed}
        onConfirmedChange={setConfirmed}
        onSelectionChange={setSelection}
        onEnabledChange={setGroupsEnabled}
      />
    </div>
  );
}

const GROUPS: WaGroupPreviewItem[] = [
  { id: "g1@g.us", name: "Clientes VIP", totalMembers: 300, usableCount: 150, lidCount: 150 },
  { id: "g2@g.us", name: "Leads Feira", totalMembers: 40, usableCount: 35, lidCount: 5 },
  { id: "g3@g.us", name: "Não Selecionado", totalMembers: 10, usableCount: 10, lidCount: 0 },
];

describe("WaGroupExtractionSection", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/api/leads/extract-wa-groups/preview")) {
        return {
          ok: true,
          json: async () => ({ success: true, groups: GROUPS }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    global.fetch = fetchMock as any;
  });

  it("[TESTE OBRIGATÓRIO] marcar grupos sem confirmar o aviso não dispara nenhuma chamada", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Membros de grupos" }));

    expect(screen.getByText("Antes de importar membros de grupo")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("[TESTE OBRIGATÓRIO] cancelar o aviso desmarca a opção", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Membros de grupos" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Membros de grupos" })).not.toBeChecked();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("[TESTE OBRIGATÓRIO] confirmado uma vez, marcar de novo não pergunta outra vez", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Membros de grupos" }));
    fireEvent.click(screen.getByRole("button", { name: "Entendi, quero ver os grupos" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await screen.findByText("Clientes VIP");

    // desmarca e marca de novo
    fireEvent.click(screen.getByRole("checkbox", { name: "Membros de grupos" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Membros de grupos" }));

    // não reaparece o aviso — vai direto pra prévia
    expect(screen.queryByText("Antes de importar membros de grupo")).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("[TESTE OBRIGATÓRIO] a soma do rodapé bate com os grupos marcados", async () => {
    render(<Harness initialConfirmed />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Membros de grupos" }));
    await screen.findByText("Clientes VIP");

    fireEvent.click(screen.getByRole("checkbox", { name: "Clientes VIP" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Leads Feira" }));

    // 150+35 entram, 150+5 se perdem — grupo "Não Selecionado" fora da soma
    await screen.findByText("Selecionados: 185 contatos entram, 155 se perdem.");
  });

  it("[TESTE OBRIGATÓRIO] importar manda só os groupIds marcados", async () => {
    render(<Harness initialConfirmed />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Membros de grupos" }));
    await screen.findByText("Clientes VIP");

    fireEvent.click(screen.getByRole("checkbox", { name: "Leads Feira" }));

    await waitFor(() => {
      expect(screen.getByTestId("selection").textContent).toBe(JSON.stringify(["g2@g.us"]));
    });
  });

  it("[TESTE OBRIGATÓRIO] nenhum telefone é renderizado na prévia", async () => {
    render(<Harness initialConfirmed />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Membros de grupos" }));
    await screen.findByText("Clientes VIP");

    const text = document.body.textContent || "";
    // nenhuma sequência de 8+ dígitos (telefone) nem marca de LID (@) na tela
    expect(text).not.toMatch(/\d{8,}/);
    expect(text).not.toContain("@");
  });

  it("estado vazio: instância sem grupo nenhum diz isso, não lista vazia", async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ success: true, groups: [] }) }));
    render(<Harness initialConfirmed />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Membros de grupos" }));

    await screen.findByText("Nenhum grupo encontrado nesta instância.");
  });

  it("erro na Evolution mostra a mensagem do erro, não um texto genérico", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 502,
      headers: { get: () => "application/json" },
      json: async () => ({ error: { code: "WA_FETCH_GROUPS_FAILED", message: "Erro ao buscar grupos no WhatsApp (HTTP 500): timeout" } }),
    }));
    render(<Harness initialConfirmed />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Membros de grupos" }));

    await screen.findByText(/Erro ao buscar grupos no WhatsApp \(HTTP 500\): timeout/);
  });

  it("sumGroupSelection soma só os grupos selecionados", () => {
    const selected = new Set(["g1@g.us", "g3@g.us"]);
    expect(sumGroupSelection(GROUPS, selected)).toEqual({ contacts: 160, lost: 150 });
    expect(sumGroupSelection(GROUPS, new Set())).toEqual({ contacts: 0, lost: 0 });
  });
});
