import { describe, it, expect, vi } from "vitest";
import React, { useState } from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { TagMultiSelect } from "@/components/leads/TagMultiSelect";
import { fetchCampaignAudience } from "@/lib/leads/leadListApi";

describe("Público da Campanha - Seleção de Múltiplas Tags na Tela", () => {
  const sampleTags = [
    { tag: "VIP", kind: "minhas", count: 15 },
    { tag: "Proposta", kind: "minhas", count: 10 },
    { tag: "Outubro", kind: "planilha", count: 25 },
    { tag: "Instagram", kind: "origem", count: 50 },
  ];

  it("renderiza TagMultiSelect com contador e texto explicativo da regra OU", () => {
    const onChange = vi.fn();
    render(
      <TagMultiSelect
        selectedTags={["VIP"]}
        onChange={onChange}
        tags={sampleTags}
        helperText="Entram os leads que tiverem QUALQUER UMA das tags marcadas."
        data-testid="campaign-tag-select"
      />
    );

    expect(screen.getByText("Tags selecionadas (1)")).toBeTruthy();
    expect(screen.getByText("Entram os leads que tiverem QUALQUER UMA das tags marcadas.")).toBeTruthy();
    expect(screen.getByLabelText("Buscar tags")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Lista de tags disponíveis" })).toBeTruthy();
    expect(screen.getByText("Limpar seleção")).toBeTruthy();
  });

  it("permite marcar e desmarcar tags e limpar toda a seleção", () => {
    function ControlledTagSelector() {
      const [selectedTags, setSelectedTags] = useState<string[]>([]);
      return (
        <TagMultiSelect
          selectedTags={selectedTags}
          onChange={setSelectedTags}
          tags={sampleTags}
          helperText="Entram os leads que tiverem QUALQUER UMA das tags marcadas."
        />
      );
    }

    render(<ControlledTagSelector />);

    expect(screen.getByText("Tags selecionadas (0)")).toBeTruthy();

    const tagList = screen.getByRole("group", { name: "Lista de tags disponíveis" });

    // Clicar em VIP
    fireEvent.click(within(tagList).getByText("VIP"));
    expect(screen.getByText("Tags selecionadas (1)")).toBeTruthy();

    // Clicar em Proposta
    fireEvent.click(within(tagList).getByText("Proposta"));
    expect(screen.getByText("Tags selecionadas (2)")).toBeTruthy();

    // Limpar seleção
    fireEvent.click(screen.getByText("Limpar seleção"));
    expect(screen.getByText("Tags selecionadas (0)")).toBeTruthy();
  });

  // Teste (f) - OBRIGATÓRIO: marcar 3 tags envia as 3 ao backend
  it("f) marcar 3 tags envia as 3 ao backend", async () => {
    const calls: any[] = [];
    const mockRequest = vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, body: JSON.parse(String(init?.body || "{}")) });
      return {
        status: 200,
        ok: true,
        json: async () => ({ items: [{ id: "l1", nome: "Lead 1" }], total: 1, truncated: false }),
      } as Response;
    });

    const selectedTags = ["VIP", "Proposta", "Outubro"];

    await fetchCampaignAudience(mockRequest, {
      clientId: "client-teste",
      stages: ["all"],
      tags: selectedTags,
      rules: [],
    });

    expect(calls).toHaveLength(1);
    const sentBody = calls[0].body;

    // Deve enviar exatamente o array com as 3 tags
    expect(sentBody.tags).toEqual(["VIP", "Proposta", "Outubro"]);
    expect(sentBody.tags).toHaveLength(3);
  });

  // Teste (g) - OBRIGATÓRIO: desmarcar volta o público
  it("g) desmarcar volta o público", async () => {
    const audienceResponses: Record<string, { total: number; items: any[] }> = {
      "3-tags": { total: 50, items: Array.from({ length: 50 }, (_, i) => ({ id: `l-${i}` })) },
      "2-tags": { total: 35, items: Array.from({ length: 35 }, (_, i) => ({ id: `l-${i}` })) },
      "0-tags": { total: 100, items: Array.from({ length: 100 }, (_, i) => ({ id: `l-${i}` })) },
    };

    const calls: any[] = [];
    const mockRequest = vi.fn(async (_path: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      calls.push(body);
      const tagCount = body.tags?.length ?? 0;
      const key = tagCount === 3 ? "3-tags" : tagCount === 2 ? "2-tags" : "0-tags";
      return {
        status: 200,
        ok: true,
        json: async () => audienceResponses[key],
      } as Response;
    });

    // 1. Consulta com 3 tags selecionadas
    let res = await fetchCampaignAudience(mockRequest, {
      clientId: "client-teste",
      stages: ["all"],
      tags: ["VIP", "Proposta", "Outubro"],
      rules: [],
    });
    expect(res.total).toBe(50);

    // 2. Desmarcar 1 tag (restando 2 tags): o público recalculado diminui/muda
    res = await fetchCampaignAudience(mockRequest, {
      clientId: "client-teste",
      stages: ["all"],
      tags: ["VIP", "Proposta"],
      rules: [],
    });
    expect(res.total).toBe(35);

    // 3. Desmarcar todas as tags: o público volta para a base sem filtro de tag
    res = await fetchCampaignAudience(mockRequest, {
      clientId: "client-teste",
      stages: ["all"],
      tags: [],
      rules: [],
    });
    expect(res.total).toBe(100);

    expect(calls).toHaveLength(3);
    expect(calls[0].tags).toEqual(["VIP", "Proposta", "Outubro"]);
    expect(calls[1].tags).toEqual(["VIP", "Proposta"]);
    expect(calls[2].tags).toEqual([]);
  });
});
