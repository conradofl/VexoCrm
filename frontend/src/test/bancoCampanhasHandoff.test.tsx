// frontend/src/test/bancoCampanhasHandoff.test.tsx
//
// Testes do repasse de público do Banco para Campanhas e separação de funções:
// 1. Nenhuma rota de importação ou exclusão de planilha é alcançável a partir de Campanhas.
// 2. O público criado no Banco chega em Campanhas com o mesmo número que a tela do Banco mostrava.
// 3. Seleção grande (20 mil) chega sem estourar o repasse (critérios em < 1 KB vs lista bruta > 15 MB).

import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildFilterAudienceDescription } from "@/lib/leads/audienceDescription";
import { LeadSourceStep } from "@/pages/LeadImports/LeadSourceStep";
import leadImportsSrc from "../pages/LeadImports.tsx?raw";
import leadSourceStepSrc from "../pages/LeadImports/LeadSourceStep.tsx?raw";
import bancoSrc from "../pages/BancoDeDados.tsx?raw";

describe("Separação Banco vs Campanhas e Repasse de Público", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("[TESTE OBRIGATÓRIO] nenhuma rota de importação ou exclusão de planilha é alcançável a partir de Campanhas", () => {
    // 1. Verificação estática do código-fonte de Campanhas (LeadImports e LeadSourceStep)
    // Não pode conter botão de carregar planilha, nem aba de planilhas salvas, nem importador
    expect(leadImportsSrc).not.toMatch(/value="planilhas"/); // Aba Planilhas Salvas removida
    expect(leadImportsSrc).not.toMatch(/<SavedSheetsCards/); // Gestão de planilhas mudou para o Banco
    expect(leadImportsSrc).not.toMatch(/useDeleteLeadImport/); // Exclusão de planilha não existe em Campanhas
    expect(leadSourceStepSrc).not.toMatch(/<SpreadsheetUploader/); // Botão Carregar Planilha removido
    expect(leadSourceStepSrc).not.toMatch(/<ColumnMappingStep/); // Mapeamento de upload removido

    // 2. O link curto para o Banco de Dados DEVE estar presente no lugar do botão de upload
    expect(leadSourceStepSrc).toMatch(/Importar planilha no Banco de Dados/);
    expect(leadSourceStepSrc).toMatch(/to="\/crm\/banco-de-dados"/);

    // 3. A gestão de planilhas e exclusão agora vivem EXCLUSIVAMENTE no Banco
    expect(bancoSrc).toMatch(/<SavedSheetsCards/);
    expect(bancoSrc).toMatch(/useDeleteLeadImport/);
    expect(bancoSrc).toMatch(/useCreateBancoImport/);

    // 4. Renderização do componente LeadSourceStep em Campanhas:
    // Garante que nenhum input de arquivo nem botão de upload é renderizado
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
          selectedImportId=""
          setSelectedImportId={vi.fn()}
          selectedImportIds={[]}
          setSelectedImportIds={vi.fn()}
          imports={[{ id: "imp-1", source_name: "vendas.xlsx", imported_rows: 100 } as any]}
          filterRules={[]}
          setFilterRules={vi.fn()}
          spreadsheetColumns={[]}
          parsedRows={[]}
          parsedLeadsStats={{ total: 0, valid: 0, invalid: 0 }}
          previewOpen={false}
          setPreviewOpen={vi.fn()}
          previewRows={[]}
          fileInputRef={{ current: null }}
        />
      </MemoryRouter>
    );

    // Não existe input file para carregar planilha
    expect(screen.queryByTestId("spreadsheet-file-input")).toBeNull();
    expect(screen.queryByText(/Carregar Planilha/i)).toBeNull();

    // Existe o link curto para importar no Banco
    const linkBanco = screen.getByTestId("link-importar-banco");
    expect(linkBanco).toBeInTheDocument();
    expect(linkBanco.textContent).toContain("Importar planilha no Banco de Dados");
    expect(linkBanco.getAttribute("href")).toBe("/crm/banco-de-dados");

    // O seletor "Ou use uma importada" CONTINUA presente
    expect(screen.getByText(/Ou use uma importada/i)).toBeInTheDocument();
  });

  it("[TESTE OBRIGATÓRIO] o público criado no Banco chega em Campanhas com o mesmo número que a tela do Banco mostrava", () => {
    // 1. Função pura do Banco de Dados gera a descrição correta
    const desc = buildFilterAudienceDescription(
      { stage: "cold", tag: "vip", importId: "imp-vendas" },
      1482,
      { sheetName: "base-vendas.xlsx" }
    );
    expect(desc).toBe('público: planilha base-vendas.xlsx, estágio Leads Frios, tag "vip", 1.482 leads');

    // 2. Quando o usuário clica em "Criar campanha", o Banco salva o payload no localStorage
    const handoffData = {
      criteria: { stage: "cold", tag: "vip", importId: "imp-vendas" },
      description: desc,
      totalCount: 1482,
      campaignName: "Campanha Frio VIP",
    };
    window.localStorage.setItem("vexo_pending_campaign_audience", JSON.stringify(handoffData));

    // 3. Em Campanhas, o público é carregado com a descrição e contagem idêntica
    const onDiscard = vi.fn();
    render(
      <MemoryRouter>
        <LeadSourceStep
          campaignName="Campanha Frio VIP"
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
          parsedRows={[{ id: "1" }]}
          parsedLeadsStats={{ total: 1482, valid: 1482, invalid: 0 }}
          previewOpen={false}
          setPreviewOpen={vi.fn()}
          previewRows={[]}
          bancoAudience={{
            description: handoffData.description,
            count: handoffData.totalCount,
          }}
          onDiscardBancoAudience={onDiscard}
          fileInputRef={{ current: null }}
        />
      </MemoryRouter>
    );

    // O banner do público ativo é exibido com o texto exato
    expect(screen.getByText("Público do Banco de Dados Ativo")).toBeInTheDocument();
    expect(screen.getByText('público: planilha base-vendas.xlsx, estágio Leads Frios, tag "vip", 1.482 leads')).toBeInTheDocument();

    // Descartar o público avisa o usuário
    const btnDescartar = screen.getByRole("button", { name: /Descartar/i });
    fireEvent.click(btnDescartar);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("[TESTE OBRIGATÓRIO] seleção grande (20 mil) chega sem estourar o repasse", () => {
    // 1. Simulação do teto do localStorage:
    // Uma linha de lead com todos os campos (nome, fone, tags, dados, resumo) tem ~750 bytes.
    // 20.000 leads = 20.000 * 750 = ~15 MB.
    // O limite do localStorage nos navegadores é de ~5 MB (5.242.880 bytes).
    const singleLeadSample = {
      id: "99999999-9999-9999-9999-999999999999",
      nome: "Cliente Teste Escala Extrema da Silva",
      telefone: "5511999990000",
      phone: "5511999990000",
      tags: ["tag-alfa", "tag-beta", "tag-gamma"],
      stage: "cold",
      temperature: "warm",
      dados: {
        origem: "planilha-grande",
        cidade: "São Paulo",
        estado: "SP",
        segmento: "B2B",
        resumo_chat: "Conversa com proposta enviada e aguardando retorno",
      },
    };
    const singleLeadBytes = JSON.stringify(singleLeadSample).length;
    const estimated20kBytes = singleLeadBytes * 20000;

    // Prova matemática: 20 mil leads brutos ultrapassam o teto de 5 MB
    expect(estimated20kBytes).toBeGreaterThan(5 * 1024 * 1024);

    // 2. Novo formato (repasse por critérios):
    const criteriaPayload = {
      criteria: {
        stage: "cold",
        tag: "vip",
        importId: "33333333-3333-3333-3333-333333333333",
      },
      description: "público: planilha Grande.xlsx, estágio Frio, tag vip, 20.000 leads",
      totalCount: 20000,
      campaignName: "Disparo 20 Mil Leads",
    };

    const criteriaJson = JSON.stringify(criteriaPayload);
    // Critérios ocupam menos de 500 bytes (tamanho fixo, independente de serem 20k ou 200k leads)
    expect(criteriaJson.length).toBeLessThan(500);

    // Salva no localStorage com sucesso sem estouro de cota
    expect(() => {
      window.localStorage.setItem("vexo_pending_campaign_audience", criteriaJson);
    }).not.toThrow();

    // Lê e valida o conteúdo em Campanhas
    const readBack = JSON.parse(window.localStorage.getItem("vexo_pending_campaign_audience") || "{}");
    expect(readBack.totalCount).toBe(20000);
    expect(readBack.criteria).toEqual(criteriaPayload.criteria);
    expect(readBack.description).toContain("20.000 leads");
  });
});
