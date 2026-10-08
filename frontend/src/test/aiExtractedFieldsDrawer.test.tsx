// frontend/src/test/aiExtractedFieldsDrawer.test.tsx
// Pilar 4: Testes de Renderização e Interação dos Campos Extraídos pela IA no Drawer de Detalhes

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  LeadCustomFieldsSection,
  LeadCustomFieldsSectionProps,
} from "../components/leads/LeadCustomFieldsSection";
import {
  formatCustomFieldLabel,
  isFieldAiExtracted,
  isFieldManuallyEdited,
} from "../lib/leads/aiExtractedFields";

describe("Pilar 4: Campos Preenchidos pela IA e Edição no Drawer", () => {
  describe("Funções auxiliares puras (aiExtractedFields.ts)", () => {
    it("formatCustomFieldLabel formata chaves padrão e desconhecidas", () => {
      expect(formatCustomFieldLabel("interesse")).toBe("Interesse");
      expect(formatCustomFieldLabel("faixa_valor")).toBe("Faixa de Valor");
      expect(formatCustomFieldLabel("tipo_negocio")).toBe("Tipo de Negócio");
      expect(formatCustomFieldLabel("cidade_regiao")).toBe("Cidade / Região");
      expect(formatCustomFieldLabel("urgencia")).toBe("Urgência");
      expect(formatCustomFieldLabel("faturamento_anual")).toBe("Faturamento Anual");
      expect(formatCustomFieldLabel("campo_customizado_teste")).toBe("Campo Customizado Teste");
    });

    it("isFieldAiExtracted identifica campos da IA corretamente", () => {
      expect(isFieldAiExtracted("interesse", ["interesse", "faixa_valor"])).toBe(true);
      expect(isFieldAiExtracted("renda", ["interesse", "faixa_valor"])).toBe(false);
      expect(isFieldAiExtracted("interesse", null)).toBe(false);
    });

    it("isFieldManuallyEdited identifica campos validados pelo operador", () => {
      expect(isFieldManuallyEdited("faixa_valor", ["faixa_valor"])).toBe(true);
      expect(isFieldManuallyEdited("interesse", ["faixa_valor"])).toBe(false);
    });
  });

  describe("Componente LeadCustomFieldsSection", () => {
    const mockLead = {
      id: "lead-123",
      nome: "Renata Faria",
      dados: {
        campos: {
          interesse: "Consórcio Imobiliário",
          faixa_valor: "R$ 500k a 1M",
          tipo_negocio: "Clínica Odontológica",
          renda_declarada: "R$ 20.000",
        },
        ai_extracted_fields: ["interesse", "faixa_valor", "tipo_negocio"],
        manual_fields: ["renda_declarada"],
      },
    };

    it("1. renderiza campos comerciais e rótulos amigáveis", () => {
      render(<LeadCustomFieldsSection lead={mockLead} />);

      expect(screen.getByText("Campos Personalizados / Informações Comerciais")).toBeInTheDocument();
      expect(screen.getByText("Interesse:")).toBeInTheDocument();
      expect(screen.getByText("Consórcio Imobiliário")).toBeInTheDocument();
      expect(screen.getByText("Faixa de Valor:")).toBeInTheDocument();
      expect(screen.getByText("R$ 500k a 1M")).toBeInTheDocument();
      expect(screen.getByText("Tipo de Negócio:")).toBeInTheDocument();
      expect(screen.getByText("Clínica Odontológica")).toBeInTheDocument();
      expect(screen.getByText("R$ 20.000")).toBeInTheDocument();
    });

    it("2. exibe a badge '🤖 Preenchido pela IA' nos campos extraídos pelo robô", () => {
      render(<LeadCustomFieldsSection lead={mockLead} />);

      // Campos da IA devem ter a badge
      expect(screen.getByTestId("ai-badge-interesse")).toBeInTheDocument();
      expect(screen.getByTestId("ai-badge-faixa_valor")).toBeInTheDocument();
      expect(screen.getByTestId("ai-badge-tipo_negocio")).toBeInTheDocument();

      // Campo manual/importado NÃO deve ter a badge de IA
      expect(screen.queryByTestId("ai-badge-renda_declarada")).not.toBeInTheDocument();
      expect(screen.getByTestId("manual-badge-renda_declarada")).toBeInTheDocument();
    });

    it("3. permite operador humano clicar no lápis para editar um campo", async () => {
      const handleUpdateField = vi.fn().mockResolvedValue(undefined);

      render(
        <LeadCustomFieldsSection
          lead={mockLead}
          onUpdateField={handleUpdateField}
        />
      );

      // Clica no lápis de Faixa de Valor
      const editBtn = screen.getByTestId("edit-btn-faixa_valor");
      fireEvent.click(editBtn);

      // Input aparece preenchido com o valor atual
      const input = screen.getByDisplayValue("R$ 500k a 1M");
      expect(input).toBeInTheDocument();

      // Altera o valor
      fireEvent.change(input, { target: { value: "R$ 1.200.000" } });

      // Salva clicando no botão de confirmação
      const saveBtn = screen.getByTitle("Salvar alteração");
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(handleUpdateField).toHaveBeenCalledWith("faixa_valor", "R$ 1.200.000");
      });
    });

    it("4. aciona onTriggerAiExtraction ao clicar em 'Extrair com IA'", () => {
      const handleTriggerAi = vi.fn();

      render(
        <LeadCustomFieldsSection
          lead={mockLead}
          onTriggerAiExtraction={handleTriggerAi}
        />
      );

      const aiBtn = screen.getByTitle("Analisar a conversa com IA e preencher a ficha comercial automaticamente");
      fireEvent.click(aiBtn);

      expect(handleTriggerAi).toHaveBeenCalledTimes(1);
    });

    it("5. exibe estado vazio convidativo quando lead não possui campos", () => {
      const emptyLead = {
        id: "lead-empty",
        nome: "Lead Novo",
        dados: {},
      };

      const handleTriggerAi = vi.fn();

      render(
        <LeadCustomFieldsSection
          lead={emptyLead}
          onTriggerAiExtraction={handleTriggerAi}
        />
      );

      expect(screen.getByText("Nenhuma informação comercial anotada nesta ficha ainda.")).toBeInTheDocument();
      const actionBtn = screen.getByText("Preencher Ficha com IA");
      expect(actionBtn).toBeInTheDocument();
      fireEvent.click(actionBtn);
      expect(handleTriggerAi).toHaveBeenCalledTimes(1);
    });
  });
});
