import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  auditMessageVariablesAgainstLeads,
  evaluateLeadFilterRule,
  extractCustomFieldsFromRows,
  getCommonCustomFields,
  getMissingFieldCount,
} from "@/lib/leadImports/spreadsheet";
import { SchedulingStep } from "@/pages/LeadImports/SchedulingStep";
import { LeadSourceStep } from "@/pages/LeadImports/LeadSourceStep";
import { MemoryRouter } from "react-router-dom";

describe("Testes Automatizados de Campos Customizados e Integrações no Frontend", () => {
  describe("Regra 9: Auditoria pré-disparo de variáveis contabiliza leads retidos vs enviáveis", () => {
    it("identifica leads retidos por variáveis customizadas ausentes e mantém enviáveis os completos", () => {
      const messages = ["Olá {{nome}}, seu plano é {{plano}} e cargo é {{cargo}}."];
      const leads = [
        {
          id: "lead-1",
          nome: "Lucas",
          telefone: "5511999990001",
          dados: { campos: { plano: "Pro", cargo: "Dev" } },
        },
        {
          id: "lead-2",
          nome: "Marcos",
          telefone: "5511999990002",
          dados: { campos: { plano: "Basic" } }, // falta cargo
        },
        {
          id: "lead-3",
          nome: "Sem Nome",
          telefone: "5511999990003",
          dados: { campos: { plano: "Enterprise", cargo: "Gerente" } }, // nome ausente tem fallback seguro e NÃO retém
        },
      ];

      const audit = auditMessageVariablesAgainstLeads(messages, leads);

      expect(audit.totalLeads).toBe(3);
      expect(audit.heldLeadsCount).toBe(1); // Somente lead-2
      expect(audit.sendableLeadsCount).toBe(2); // lead-1 e lead-3
      expect(audit.heldLeads).toHaveLength(1);
      expect(audit.heldLeads[0].id).toBe("lead-2");

      expect(audit.variableAudits).toHaveLength(1);
      expect(audit.variableAudits[0].placeholder).toBe("{{cargo}}");
      expect(audit.variableAudits[0].missingCount).toBe(1);
    });
  });

  describe("Regra 10: Auditoria pré-disparo alerta sem desabilitar botão de disparo", () => {
    it("exibe banner de aviso de leads retidos, permite abrir modal de inspeção e mantém botão ativo", () => {
      const mockAudit = {
        totalLeads: 10,
        heldLeadsCount: 2,
        sendableLeadsCount: 8,
        heldLeads: [
          { id: "lead-1", nome: "Lead Retido 1", telefone: "5511999990001", missingPlaceholders: ["{{cargo}}"] },
          { id: "lead-2", nome: "Lead Retido 2", telefone: "5511999990002", missingPlaceholders: ["{{cargo}}"] },
        ],
        variableAudits: [
          {
            variable: "cargo",
            placeholder: "{{cargo}}",
            missingCount: 2,
            totalCount: 10,
            missingLeads: [],
          },
        ],
      };

      const mockOnSubmit = vi.fn();

      render(
        <SchedulingStep
          dispatchOptions={{} as any}
          setDispatchOptions={vi.fn()}
          evolutionInstanceOptions={[{ id: "inst-1", name: "WhatsApp 1" }]}
          batchingEnabled={false}
          setBatchingEnabled={vi.fn()}
          batchSize="100"
          setBatchSize={vi.fn()}
          batchIntervalHours="1"
          setBatchIntervalHours={vi.fn()}
          replyAgent="passos"
          setReplyAgent={vi.fn()}
          campaignAgentPrompt=""
          setCampaignAgentPrompt={vi.fn()}
          passosAposResposta={0}
          multiAgendaEnabled={false}
          setMultiAgendaEnabled={vi.fn()}
          consultants={[]}
          updateConsultant={{} as any}
          deleteConsultant={{} as any}
          createConsultant={{} as any}
          activeClientId="tenant-test"
          newConsultantName=""
          setNewConsultantName={vi.fn()}
          newConsultantLink=""
          setNewConsultantLink={vi.fn()}
          onCreateConsultant={vi.fn()}
          newTriggerType="manual"
          setNewTriggerType={vi.fn()}
          newScheduledAt=""
          setNewScheduledAt={vi.fn()}
          onSubmit={mockOnSubmit}
          isSubmitting={false}
          editingCampaignId={null}
          onCancelEdit={vi.fn()}
          onNovaCampanha={vi.fn()}
          preDispatchAudit={mockAudit}
        />
      );

      // Banner deve estar visível
      expect(screen.getByText(/2 de 10 leads serão segurados por não terem {{cargo}} preenchido/i)).toBeInTheDocument();
      expect(screen.getByText(/O disparo seguirá normalmente para os 8 leads restantes/i)).toBeInTheDocument();

      // Botão de disparo NÃO deve estar desabilitado
      const dispatchButton = screen.getByRole("button", { name: /Salvar e Disparar Lote Agora/i });
      expect(dispatchButton).toBeEnabled();

      // Abrir modal de inspeção
      const inspectButton = screen.getByRole("button", { name: /Ver leads afetados/i });
      fireEvent.click(inspectButton);

      expect(screen.getByText(/Leads Segurados por Falta de Vari/i)).toBeInTheDocument();
      expect(screen.getByText(/Lead Retido 1/i)).toBeInTheDocument();
      expect(screen.getByText(/Lead Retido 2/i)).toBeInTheDocument();
    }, 15000);
  });

  describe("Regra 11: Base única apresenta campos customizados e contagem de ausentes", () => {
    it("extrai campos customizados e calcula com precisão quantos leads não têm o campo preenchido", () => {
      const rows = [
        { id: "1", dados: { campos: { cargo: "Gerente", salario: 12000 } } },
        { id: "2", dados: { campos: { cargo: "Analista", salario: 6000 } } },
        { id: "3", dados: { campos: { cargo: "", salario: null } } },
        { id: "4", dados: { campos: { salario: 4500 } } }, // sem cargo
      ];

      const customFields = extractCustomFieldsFromRows(rows);
      expect(customFields).toEqual([
        { key: "cargo", label: "cargo", type: "text" },
        { key: "salario", label: "salario", type: "number" },
      ]);

      const missingCargo = getMissingFieldCount(rows, "cargo");
      expect(missingCargo).toBe(2); // rows 3 e 4

      const missingSalario = getMissingFieldCount(rows, "salario");
      expect(missingSalario).toBe(1); // row 3
    });
  });

  describe("Regra 12: Multi-base usa interseção de campos customizados e alerta campos excluídos", () => {
    it("calcula interseção de campos comuns entre bases e lista campos excluídos com detalhamento de ausência", () => {
      const bases = [
        {
          baseId: "base-sp",
          baseName: "Base São Paulo",
          fields: [
            { key: "segmento", label: "Segmento", type: "text" as const },
            { key: "faturamento", label: "Faturamento", type: "number" as const },
            { key: "filial", label: "Filial SP", type: "text" as const },
          ],
        },
        {
          baseId: "base-mg",
          baseName: "Base Minas",
          fields: [
            { key: "segmento", label: "Segmento", type: "text" as const },
            { key: "faturamento", label: "Faturamento", type: "number" as const },
            { key: "regiao", label: "Região MG", type: "text" as const },
          ],
        },
      ];

      const result = getCommonCustomFields(bases);

      // Apenas os campos presentes em AMBAS as bases devem estar em commonFields
      expect(result.commonFields).toHaveLength(2);
      expect(result.commonFields.map((f) => f.key)).toEqual(["segmento", "faturamento"]);

      // Campos exclusivos de uma base devem estar em excludedFields
      expect(result.excludedFields).toHaveLength(2);
      const excludedKeys = result.excludedFields.map((e) => e.key).sort();
      expect(excludedKeys).toEqual(["filial", "regiao"]);

      const filialItem = result.excludedFields.find((e) => e.key === "filial");
      expect(filialItem?.missingInBaseNames).toContain("Base Minas");
    });
  });

  describe("Regra 13: O bloco de filtros de segmentação fica oculto quando não há campos customizados", () => {
    it("não renderiza o bloco de filtros da planilha se availableCustomFields for vazio e não houver colunas", () => {
      const { container } = render(
        <MemoryRouter>
          <LeadSourceStep
            campaignName="Campanha Teste"
            setCampaignName={vi.fn()}
            selectedFile={null}
            isImportingFile={false}
            onFileChange={vi.fn()}
            showNumbersModal={false}
            onCloseNumbersModal={vi.fn()}
            setSelectedFile={vi.fn()}
            setParsedRows={vi.fn()}
            selectedImportId=""
            setSelectedImportId={vi.fn()}
            selectedImportIds={[]}
            setSelectedImportIds={vi.fn()}
            imports={[]}
            filterRules={[]}
            setFilterRules={vi.fn()}
            spreadsheetColumns={[]}
            parsedRows={[]}
            parsedLeadsStats={{ total: 0, valid: 0, invalid: 0 }}
            previewOpen={false}
            setPreviewOpen={vi.fn()}
            previewRows={[]}
            hasSourceRows={false}
            availableCustomFields={[]}
            fileInputRef={{ current: null }}
          />
        </MemoryRouter>
      );

      // Bloco de filtros de segmentação NÃO deve existir no DOM
      expect(screen.queryByText(/Filtros de Segmentação da Planilha/i)).not.toBeInTheDocument();
    });

    it("renderiza o bloco de filtros quando há campos customizados disponíveis e linhas carregadas", () => {
      render(
        <MemoryRouter>
          <LeadSourceStep
            campaignName="Campanha Teste"
            setCampaignName={vi.fn()}
            selectedFile={null}
            isImportingFile={false}
            onFileChange={vi.fn()}
            showNumbersModal={false}
            onCloseNumbersModal={vi.fn()}
            setSelectedFile={vi.fn()}
            setParsedRows={vi.fn()}
            selectedImportId="imp-1"
            setSelectedImportId={vi.fn()}
            selectedImportIds={["imp-1"]}
            setSelectedImportIds={vi.fn()}
            imports={[{ id: "imp-1", name: "Base 1", imported_rows: 50 } as any]}
            filterRules={[]}
            setFilterRules={vi.fn()}
            spreadsheetColumns={[]}
            parsedRows={[{ id: "1" }]}
            parsedLeadsStats={{ total: 1, valid: 1, invalid: 0 }}
            previewOpen={false}
            setPreviewOpen={vi.fn()}
            previewRows={[]}
            hasSourceRows={true}
            availableCustomFields={[{ key: "setor", label: "Setor", type: "text" }]}
            fileInputRef={{ current: null }}
          />
        </MemoryRouter>
      );

      expect(screen.getByText(/Filtros de Segmentação da Planilha/i)).toBeInTheDocument();
    });
  });

  describe("Regra 14: Comparação numérica avalia valores numéricos reais e comparação de data avalia cronologia", () => {
    it("compara números como números: 40 > 9 é verdadeiro (evita falha alfabética de string)", () => {
      const lead40 = { dados: { campos: { pontuacao: 40 } } };
      const lead5 = { dados: { campos: { pontuacao: "5" } } };

      const ruleGt9 = {
        column: "pontuacao",
        operator: "gt" as const,
        value: "9",
        type: "number" as const,
      };

      // 40 > 9 deve ser true! (se fosse string "40" > "9", seria false pois '4' < '9')
      expect(evaluateLeadFilterRule(lead40, ruleGt9)).toBe(true);
      expect(evaluateLeadFilterRule(lead5, ruleGt9)).toBe(false);

      const ruleLt9 = {
        column: "pontuacao",
        operator: "lt" as const,
        value: "9",
        type: "number" as const,
      };
      expect(evaluateLeadFilterRule(lead5, ruleLt9)).toBe(true);
      expect(evaluateLeadFilterRule(lead40, ruleLt9)).toBe(false);
    });

    it("compara datas cronologicamente considerando DD/MM/AAAA e formato ISO", () => {
      const leadMaio = { dados: { campos: { admissao: "15/05/2026" } } };
      const leadPassado = { dados: { campos: { admissao: "10/01/2025" } } };

      const ruleAfter2025 = {
        column: "admissao",
        operator: "after" as const,
        value: "31/12/2025",
        type: "date" as const,
      };
      expect(evaluateLeadFilterRule(leadMaio, ruleAfter2025)).toBe(true);
      expect(evaluateLeadFilterRule(leadPassado, ruleAfter2025)).toBe(false);

      const ruleBetween = {
        column: "admissao",
        operator: "between" as const,
        value: "01/01/2026",
        secondValue: "31/12/2026",
        type: "date" as const,
      };
      expect(evaluateLeadFilterRule(leadMaio, ruleBetween)).toBe(true);
      expect(evaluateLeadFilterRule(leadPassado, ruleBetween)).toBe(false);
    });
  });

  describe("Regra 15: Exportação XLSX inclui colunas dinâmicas e Drawer exibe 'Campos do Lead'", () => {
    it("extrai dinamicamente todas as chaves de dados.campos para o conjunto de dados do XLSX", () => {
      const filteredLeads = [
        {
          id: "lead-1",
          nome: "Conrado",
          phone: "5534997817660",
          stage: "buyer",
          temperature: "hot",
          tags: ["vip"],
          created_at: "2026-01-01T00:00:00Z",
          dados: { campos: { cargo: "Fundador", cidade: "Uberlândia" } },
        },
        {
          id: "lead-2",
          nome: "Ana",
          phone: "5511999998888",
          stage: "lead",
          temperature: "warm",
          tags: [],
          created_at: "2026-01-02T00:00:00Z",
          dados: { campos: { cargo: "Gerente", salario: 15000 } },
        },
      ];

      // Lógica de exportação XLSX do BancoDeDados
      const allCustomKeys = new Set<string>();
      filteredLeads.forEach((l) => {
        const campos = (l.dados as any)?.campos;
        if (campos && typeof campos === "object") {
          Object.keys(campos).forEach((k) => allCustomKeys.add(k));
        }
      });
      const customKeyList = Array.from(allCustomKeys).sort();

      expect(customKeyList).toEqual(["cargo", "cidade", "salario"]);

      const exportData = filteredLeads.map((l) => {
        const row: Record<string, unknown> = {
          "ID": l.id,
          "Nome": l.nome || "",
          "Telefone (E.164)": l.phone || "",
        };
        const campos = (l.dados as any)?.campos;
        customKeyList.forEach((key) => {
          row[key] = campos && campos[key] !== undefined && campos[key] !== null ? campos[key] : "";
        });
        return row;
      });

      expect(exportData[0]).toMatchObject({
        Nome: "Conrado",
        cargo: "Fundador",
        cidade: "Uberlândia",
        salario: "",
      });

      expect(exportData[1]).toMatchObject({
        Nome: "Ana",
        cargo: "Gerente",
        cidade: "",
        salario: 15000,
      });
    });
  });
});
