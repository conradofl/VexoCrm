import { describe, it, expect, vi } from "vitest";
import { useState, useRef, useEffect } from "react";
import { renderHook, act } from "@testing-library/react";
import {
  toggleStageFilter,
  buildCampaignTitle,
  calculateEffectiveSelectedCount,
  serializeCampaignFiltersKey,
  reconcileCampaignSelection,
} from "../pages/BancoDeDados";
import {
  resolveEffectiveAudienceSource,
  validateCampaignSubmission,
  type BancoAudienceInfo,
} from "../pages/LeadImports";
import { handleSelectSavedBaseAudience } from "../pages/LeadImports/LeadSourceStep";

describe("Correção de Campanha por Tag e Isolamento de Público", () => {
  // Teste 1
  it("chegando com público do Banco, a base salva fica desmarcada e o total exibido é o do público recebido", () => {
    const bancoAudience: BancoAudienceInfo = {
      description: "294 contatos vindos do Banco de Dados, filtrados por tag",
      count: 294,
    };
    const parsedRows = Array.from({ length: 294 }, (_, i) => ({
      id: `lead-${i}`,
      nome: `Lead ${i}`,
      telefone: `1199999${String(i).padStart(4, "0")}`,
    }));
    const importedRows = Array.from({ length: 8387 }, (_, i) => ({
      id: `imp-${i}`,
      nome: `Imported ${i}`,
      telefone: `1198888${String(i).padStart(4, "0")}`,
    }));

    // Ao chegar do Banco, base salva é limpa (selectedImportId: "", selectedImportIds: [])
    const selectedImportId = "";
    const selectedImportIds: string[] = [];

    const result = resolveEffectiveAudienceSource({
      selectedFile: null,
      bancoAudience,
      selectedImportId,
      selectedImportIds,
      parsedRows,
      importedRows,
    });

    expect(result.sourceType).toBe("banco");
    expect(result.rows.length).toBe(294);
    expect(result.activeImportIdParam).toBeNull();
    expect(result.rows.length).not.toBe(8387);
  });

  // Teste 2
  it("escolher base salva depois avisa que o público do Banco será descartado", () => {
    let bancoAudience: BancoAudienceInfo | null = {
      description: "294 contatos vindos do Banco de Dados, filtrados por tag",
      count: 294,
    };
    const onDiscardBancoAudience = vi.fn(() => {
      bancoAudience = null;
    });
    const clearUpload = vi.fn();
    let selectedBase = "";
    const action = () => {
      selectedBase = "import-abc";
    };

    // Usuário escolhe uma base salva após carregar público do Banco
    const res = handleSelectSavedBaseAudience(
      !!bancoAudience,
      onDiscardBancoAudience,
      clearUpload,
      action
    );

    expect(res.discarded).toBe(true);
    expect(res.warningMessage).toBe(
      "Público do Banco de Dados descartado ao selecionar uma base salva."
    );
    expect(onDiscardBancoAudience).toHaveBeenCalledTimes(1);
    expect(clearUpload).toHaveBeenCalledTimes(1);
    expect(bancoAudience).toBeNull();
    expect(selectedBase).toBe("import-abc");
  });

  // Teste 3
  it("marcar um estágio desmarca \"todos\"; desmarcar o último volta para \"todos\"", () => {
    // Começa com "todos"
    let stages = ["all"];

    // Marcar um estágio específico ("buyer") deve desmarcar "all"
    stages = toggleStageFilter(stages, "buyer");
    expect(stages).toEqual(["buyer"]);
    expect(stages).not.toContain("all");

    // Marcar outro estágio específico ("open_budget") adiciona
    stages = toggleStageFilter(stages, "open_budget");
    expect(stages).toEqual(["buyer", "open_budget"]);

    // Marcar "all" desmarca todos os específicos
    stages = toggleStageFilter(stages, "all");
    expect(stages).toEqual(["all"]);

    // Marcar "cold" desmarca "all"
    stages = toggleStageFilter(stages, "cold");
    expect(stages).toEqual(["cold"]);

    // Desmarcar o último estágio volta para "all" (nunca fica nenhum marcado)
    stages = toggleStageFilter(stages, "cold");
    expect(stages).toEqual(["all"]);
  });

  // Teste 4
  it("mudar o filtro de tag reduz a seleção ao filtrado — selecionados nunca maior que listados", () => {
    const allLeads = [
      { id: "1", nome: "Lead 1", tags: ["vip", "hot"] },
      { id: "2", nome: "Lead 2", tags: ["vip"] },
      { id: "3", nome: "Lead 3", tags: ["vip", "newsletter"] },
      { id: "4", nome: "Lead 4", tags: ["outra"] },
      { id: "5", nome: "Lead 5", tags: [] },
    ];

    // Seleção anterior tinha todos os 5 leads
    const previousSelectedIds = allLeads.map((l) => l.id);

    // Aplica filtro por tag "vip"
    const tagFilter = "vip";
    const filteredLeads = allLeads.filter((l) => l.tags.includes(tagFilter));
    expect(filteredLeads.length).toBe(3);

    // Cálculo do effectiveSelectedCount: selecionados válidos dentro dos filtrados
    const effectiveSelectedCount = calculateEffectiveSelectedCount(
      filteredLeads.map((l) => l.id),
      previousSelectedIds
    );

    // Selecionados deve ser exatamente 3, nunca 5 ("5 de 3" é proibido)
    expect(effectiveSelectedCount).toBe(3);
    expect(effectiveSelectedCount).toBeLessThanOrEqual(filteredLeads.length);
  });

  // Teste 5
  it("campanha com filtro de tag dispara só para os leads daquela tag, e o nome cita a tag", () => {
    const leads = [
      { id: "1", nome: "Ana", tags: ["cliente-vip"], telefone: "11999990001" },
      { id: "2", nome: "Beto", tags: ["cliente-vip"], telefone: "11999990002" },
      { id: "3", nome: "Carlos", tags: ["outra-tag"], telefone: "11999990003" },
      { id: "4", nome: "Diana", tags: [], telefone: "11999990004" },
    ];

    const tagFilter = "cliente-vip";
    const filteredByTag = leads.filter((l) => l.tags.includes(tagFilter));

    // Garante que apenas os leads da tag foram filtrados
    expect(filteredByTag.map((l) => l.id)).toEqual(["1", "2"]);

    // Nome da campanha gerado para essa seleção deve citar a tag explicitamente
    const titleAllStages = buildCampaignTitle(["all"], tagFilter, filteredByTag.length);
    expect(titleAllStages).toBe("Campanha Funil [Tag: cliente-vip] (2 leads)");
    expect(titleAllStages).toContain("Tag: cliente-vip");
    expect(titleAllStages).not.toContain("TODOS OS ESTÁGIOS");

    const titleSpecificStage = buildCampaignTitle(["buyer"], tagFilter, filteredByTag.length);
    expect(titleSpecificStage).toBe("Campanha Funil [BUYER | Tag: cliente-vip] (2 leads)");
    expect(titleSpecificStage).toContain("Tag: cliente-vip");
  });

  // Teste 6
  it("disparar sem nenhum lead selecionado é bloqueado com mensagem clara", () => {
    const validationZeroLeads = validateCampaignSubmission({
      activeClientId: "client-123",
      campaignName: "Campanha Teste",
      hasFile: false,
      hasBancoAudience: true,
      selectedImportIds: [],
      selectedImportId: "",
      enabledStepsCount: 1,
      filteredRowsCount: 0,
    });

    expect(validationZeroLeads.isValid).toBe(false);
    expect(validationZeroLeads.errorMessage).toBe(
      "Não é possível disparar uma campanha sem nenhum lead selecionado."
    );

    const validationValid = validateCampaignSubmission({
      activeClientId: "client-123",
      campaignName: "Campanha Teste",
      hasFile: false,
      hasBancoAudience: true,
      selectedImportIds: [],
      selectedImportId: "",
      enabledStepsCount: 1,
      filteredRowsCount: 10,
    });

    expect(validationValid.isValid).toBe(true);
    expect(validationValid.errorMessage).toBeUndefined();
  });

  // Teste 7
  it("selecionar todos, desmarcar alguns, recarregar a lista de leads sem tocar em filtro nenhum — a seleção permanece", () => {
    const initialLeads = [
      { id: "lead-1", nome: "Lead 1" },
      { id: "lead-2", nome: "Lead 2" },
      { id: "lead-3", nome: "Lead 3" },
      { id: "lead-4", nome: "Lead 4" },
      { id: "lead-5", nome: "Lead 5" },
    ];

    // 1. Função pura:
    const prevKey = serializeCampaignFiltersKey(["all"], "");
    const currentKey = serializeCampaignFiltersKey(["all"], ""); // Sem mudança de filtro
    const userSelected = ["lead-1", "lead-3", "lead-5"]; // Usuário desmarcou 2 e 4

    // Recarga da lista de leads gera novas instâncias/array de leads
    const reloadedLeads = initialLeads.map((l) => ({ ...l, nome: `${l.nome} Atualizado` }));

    const res = reconcileCampaignSelection({
      prevFiltersKey: prevKey,
      currentFiltersKey: currentKey,
      currentFilteredLeads: reloadedLeads,
      currentSelection: userSelected,
    });

    expect(res.filtersChanged).toBe(false);
    expect(res.newSelection).toEqual(["lead-1", "lead-3", "lead-5"]);

    // E a contagem efetiva continua sendo 3 (interseção)
    const effectiveCount = calculateEffectiveSelectedCount(
      reloadedLeads.map((l) => l.id),
      res.newSelection
    );
    expect(effectiveCount).toBe(3);

    // 2. Lifecycle no React (renderHook):
    function useSelectionLifecycle() {
      const [leads, setLeads] = useState(initialLeads);
      const [tagFilter, setTagFilter] = useState("");
      const [stageFilters, setStageFilters] = useState(["all"]);
      const [selectedIds, setSelectedIds] = useState<string[]>(initialLeads.map((l) => l.id));
      const prevKeyRef = useRef(serializeCampaignFiltersKey(["all"], ""));
      const selectedIdsRef = useRef(selectedIds);
      selectedIdsRef.current = selectedIds;

      useEffect(() => {
        const curKey = serializeCampaignFiltersKey(stageFilters, tagFilter);
        const { newSelection, filtersChanged } = reconcileCampaignSelection({
          prevFiltersKey: prevKeyRef.current,
          currentFiltersKey: curKey,
          currentFilteredLeads: leads,
          currentSelection: selectedIdsRef.current,
        });
        if (filtersChanged) {
          prevKeyRef.current = curKey;
          setSelectedIds(newSelection);
        }
      }, [stageFilters, tagFilter, leads]);

      return { leads, setLeads, tagFilter, setTagFilter, selectedIds, setSelectedIds };
    }

    const { result } = renderHook(() => useSelectionLifecycle());
    expect(result.current.selectedIds).toEqual(["lead-1", "lead-2", "lead-3", "lead-4", "lead-5"]);

    // Usuário desmarca lead-2 e lead-4
    act(() => {
      result.current.setSelectedIds(["lead-1", "lead-3", "lead-5"]);
    });
    expect(result.current.selectedIds).toEqual(["lead-1", "lead-3", "lead-5"]);

    // Recarga de leads (dados novos sem mexer em filtros)
    act(() => {
      result.current.setLeads([...reloadedLeads]);
    });

    // A seleção manual DEVE permanecer intacta!
    expect(result.current.selectedIds).toEqual(["lead-1", "lead-3", "lead-5"]);
  });

  // Teste 8
  it("mudar o filtro de tag — a seleção passa a ser o novo filtrado", () => {
    const allLeads = [
      { id: "lead-1", nome: "Lead 1", tags: ["vip"] },
      { id: "lead-2", nome: "Lead 2", tags: ["outra"] },
      { id: "lead-3", nome: "Lead 3", tags: ["vip"] },
      { id: "lead-4", nome: "Lead 4", tags: [] },
      { id: "lead-5", nome: "Lead 5", tags: ["vip"] },
    ];

    // 1. Função pura:
    const prevKey = serializeCampaignFiltersKey(["all"], "");
    const currentKey = serializeCampaignFiltersKey(["all"], "vip"); // Tag mudou para "vip"
    const currentSelection = ["lead-2", "lead-4"]; // Seleção anterior do usuário

    const vipLeads = allLeads.filter((l) => l.tags.includes("vip"));
    expect(vipLeads.map((l) => l.id)).toEqual(["lead-1", "lead-3", "lead-5"]);

    const res = reconcileCampaignSelection({
      prevFiltersKey: prevKey,
      currentFiltersKey: currentKey,
      currentFilteredLeads: vipLeads,
      currentSelection,
    });

    expect(res.filtersChanged).toBe(true);
    // A seleção DEVE ter sido resetada para todos os leads da nova tag ("vip")
    expect(res.newSelection).toEqual(["lead-1", "lead-3", "lead-5"]);

    // 2. Lifecycle no React (renderHook):
    function useTagFilterLifecycle() {
      const [tagFilter, setTagFilter] = useState("");
      const [stageFilters, setStageFilters] = useState(["all"]);
      const [leads, setLeads] = useState(allLeads);
      const [selectedIds, setSelectedIds] = useState<string[]>(allLeads.map((l) => l.id));
      const prevKeyRef = useRef(serializeCampaignFiltersKey(["all"], ""));
      const selectedIdsRef = useRef(selectedIds);
      selectedIdsRef.current = selectedIds;

      useEffect(() => {
        const curKey = serializeCampaignFiltersKey(stageFilters, tagFilter);
        const { newSelection, filtersChanged } = reconcileCampaignSelection({
          prevFiltersKey: prevKeyRef.current,
          currentFiltersKey: curKey,
          currentFilteredLeads: leads,
          currentSelection: selectedIdsRef.current,
        });
        if (filtersChanged) {
          prevKeyRef.current = curKey;
          setSelectedIds(newSelection);
        }
      }, [stageFilters, tagFilter, leads]);

      return { tagFilter, setTagFilter, leads, setLeads, selectedIds, setSelectedIds };
    }

    const { result } = renderHook(() => useTagFilterLifecycle());
    // Usuário tinha desmarcado alguns
    act(() => {
      result.current.setSelectedIds(["lead-1"]);
    });
    expect(result.current.selectedIds).toEqual(["lead-1"]);

    // Usuário altera a tag para "vip"
    act(() => {
      result.current.setLeads(vipLeads);
      result.current.setTagFilter("vip");
    });

    // A seleção DEVE passar a ser todos os leads da nova tag!
    expect(result.current.selectedIds).toEqual(["lead-1", "lead-3", "lead-5"]);
  });
});
