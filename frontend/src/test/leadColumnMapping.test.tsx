import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import sharedCases from "../../../shared/leadColumnMappingTestCases.json";
import {
  extractFirstFilledColumnValue,
  extractColumnSamples,
  inferColumnType,
  normalizeFieldKey,
  guessPhoneColumnCandidate,
  areColumnSetsEqual,
  findMatchingRememberedMapping,
  proposeColumnMappings,
  validateColumnMappings,
  detectTypeDivergences,
  applyColumnMappingsToRow,
  parseNumberValue,
  type ColumnMappingItem,
  type StoredColumnMapping,
} from "../lib/leadImports/spreadsheet";
import { ColumnMappingStep } from "../pages/LeadImports/ColumnMappingStep";

describe("Mapeamento de colunas na importação de planilhas - Frontend & UI", () => {
  // Teste 1
  it("1. planilha com dez colunas mostra as dez, cada uma com um exemplo real e não vazio, inclusive quando a primeira linha daquela coluna está em branco", () => {
    const columns = [
      "col_nome",
      "col_fone",
      "col_cidade",
      "col_cargo",
      "col_salario",
      "col_data_nasc",
      "col_empresa",
      "col_email",
      "col_segmento",
      "col_obs",
    ];

    const sampleRows = [
      {
        col_nome: "Alice",
        col_fone: "", // Vazia na primeira linha!
        col_cidade: "Uberlândia",
        col_cargo: "", // Vazia na primeira linha!
        col_salario: "5000",
        col_data_nasc: "1990-01-01",
        col_empresa: "Vexo Tech",
        col_email: "alice@vexo.com",
        col_segmento: "B2B",
        col_obs: "", // Vazia na primeira linha!
      },
      {
        col_nome: "Bob",
        col_fone: "(34) 99123-4567", // Exemplo real na segunda linha
        col_cidade: "Araguari",
        col_cargo: "Diretora de Vendas", // Exemplo real na segunda linha
        col_salario: "8000",
        col_data_nasc: "1985-05-15",
        col_empresa: "Tech Corp",
        col_email: "bob@tech.com",
        col_segmento: "Varejo",
        col_obs: "Cliente prioritário", // Exemplo real na segunda linha
      },
    ];

    // Validação da função pura de extração de amostras
    const samples = extractColumnSamples(columns, sampleRows);
    expect(extractFirstFilledColumnValue(sampleRows, "col_fone")).toBe("(34) 99123-4567");
    expect(extractFirstFilledColumnValue(sampleRows, "col_cargo")).toBe("Diretora de Vendas");
    expect(extractFirstFilledColumnValue(sampleRows, "col_obs")).toBe("Cliente prioritário");
    expect(samples.col_fone).toBe("(34) 99123-4567");

    // Validação de renderização pela UI (comportamento visível)
    const mappings: ColumnMappingItem[] = columns.map((col) => ({
      column: col,
      target: col === "col_fone" ? "telefone" : col === "col_nome" ? "nome" : "ignore",
      label: col,
      type: "text",
      key: normalizeFieldKey(col),
    }));

    render(
      <ColumnMappingStep
        columns={columns}
        sampleRows={sampleRows}
        mappings={mappings}
        onMappingChange={vi.fn()}
        onConfirmImport={vi.fn()}
        totalRowsCount={sampleRows.length}
        fileName="clientes_dez_colunas.xlsx"
      />
    );

    // Mostra as 10 colunas
    for (const col of columns) {
      expect(screen.getByTestId(`column-row-${col}`)).toBeInTheDocument();
    }

    // Cada uma com exemplo real não vazio
    expect(screen.getByTestId("sample-val-col_fone")).toHaveTextContent("(34) 99123-4567");
    expect(screen.getByTestId("sample-val-col_cargo")).toHaveTextContent("Diretora de Vendas");
    expect(screen.getByTestId("sample-val-col_obs")).toHaveTextContent("Cliente prioritário");
    expect(screen.getByTestId("sample-val-col_nome")).toHaveTextContent("Alice");
  });

  // Teste 2
  it("2. telefone e nome chegam pré-selecionados quando os apelidos batem", () => {
    const columns = ["WhatsApp_Lead", "Nome Completo", "Observação"];
    const sampleRows = [
      {
        WhatsApp_Lead: "34991234567",
        "Nome Completo": "Carlos Silva",
        Observação: "Lead quente",
      },
    ];

    const proposed = proposeColumnMappings({
      columns,
      sampleRows,
    });

    const phoneItem = proposed.find((p) => p.column === "WhatsApp_Lead");
    const nameItem = proposed.find((p) => p.column === "Nome Completo");
    const obsItem = proposed.find((p) => p.column === "Observação");

    expect(phoneItem?.target).toBe("telefone");
    expect(nameItem?.target).toBe("nome");
    expect(obsItem?.target).toBe("ignore");

    // Renderização no componente
    render(
      <ColumnMappingStep
        columns={columns}
        sampleRows={sampleRows}
        mappings={proposed}
        onMappingChange={vi.fn()}
        onConfirmImport={vi.fn()}
      />
    );

    // Verifica que o trigger do select tem o valor correspondente
    expect(screen.getByTestId("target-select-WhatsApp_Lead")).toHaveTextContent("Telefone");
    expect(screen.getByTestId("target-select-Nome Completo")).toHaveTextContent("Nome");
  });

  // Teste 3
  it("3. sem telefone mapeado, a importação é bloqueada e a mensagem indica qual coluna parece ser o telefone", () => {
    const columns = ["Celular_Contato", "Nome_Lead", "Cidade"];
    const sampleRows = [
      { Celular_Contato: "34991234567", Nome_Lead: "Bruna", Cidade: "Patos de Minas" },
    ];

    // Nenhuma coluna mapeada para telefone
    const mappings: ColumnMappingItem[] = [
      { column: "Celular_Contato", target: "ignore", label: "Celular_Contato", type: "text", key: "celular_contato" },
      { column: "Nome_Lead", target: "nome", label: "Nome_Lead", type: "text", key: "nome_lead" },
      { column: "Cidade", target: "ignore", label: "Cidade", type: "text", key: "cidade" },
    ];

    // Função pura
    const candidate = guessPhoneColumnCandidate(columns, sampleRows);
    expect(candidate).toBe("Celular_Contato");

    const validation = validateColumnMappings(mappings, columns, sampleRows);
    expect(validation.isValid).toBe(false);
    expect(validation.candidatePhoneColumn).toBe("Celular_Contato");
    expect(validation.errorMessage).toContain("Celular_Contato");
    expect(validation.errorMessage).toContain("parece ser o telefone");

    // Comportamento visível na tela: alerta renderizado e botão desabilitado
    render(
      <ColumnMappingStep
        columns={columns}
        sampleRows={sampleRows}
        mappings={mappings}
        onMappingChange={vi.fn()}
        onConfirmImport={vi.fn()}
      />
    );

    const errorBanner = screen.getByTestId("mapping-validation-error");
    expect(errorBanner).toBeInTheDocument();
    expect(errorBanner).toHaveTextContent(/Celular_Contato/i);
    expect(errorBanner).toHaveTextContent(/parece ser o telefone/i);

    const confirmBtn = screen.getByTestId("confirm-import-btn");
    expect(confirmBtn).toBeDisabled();
  });

  // Teste 4
  it("4. duas colunas para o mesmo destino é impedido", () => {
    const columns = ["Telefone_1", "Telefone_2", "Cargo_A", "Cargo_B"];
    const sampleRows = [
      { Telefone_1: "34991112222", Telefone_2: "34998887777", Cargo_A: "Gerente", Cargo_B: "Diretor" },
    ];

    // Caso A: Duas colunas para telefone
    const duplicatePhoneMappings: ColumnMappingItem[] = [
      { column: "Telefone_1", target: "telefone", label: "Telefone 1", type: "text", key: "telefone_1" },
      { column: "Telefone_2", target: "telefone", label: "Telefone 2", type: "text", key: "telefone_2" },
      { column: "Cargo_A", target: "ignore", label: "Cargo A", type: "text", key: "cargo_a" },
      { column: "Cargo_B", target: "ignore", label: "Cargo B", type: "text", key: "cargo_b" },
    ];
    const valPhone = validateColumnMappings(duplicatePhoneMappings, columns, sampleRows);
    expect(valPhone.isValid).toBe(false);
    expect(valPhone.errorMessage).toContain("Mais de uma coluna foi mapeada como Telefone");

    // Caso B: Dois custom fields com o mesmo rótulo/chave
    const duplicateCustomMappings: ColumnMappingItem[] = [
      { column: "Telefone_1", target: "telefone", label: "Telefone 1", type: "text", key: "telefone_1" },
      { column: "Telefone_2", target: "ignore", label: "Telefone 2", type: "text", key: "telefone_2" },
      { column: "Cargo_A", target: "custom", label: "Cargo", type: "text", key: "cargo" },
      { column: "Cargo_B", target: "custom", label: "Cargo", type: "text", key: "cargo" },
    ];
    const valCustom = validateColumnMappings(duplicateCustomMappings, columns, sampleRows);
    expect(valCustom.isValid).toBe(false);
    expect(valCustom.errorMessage).toContain("não podem ter o mesmo rótulo");

    // Comportamento visível na tela
    const { unmount } = render(
      <ColumnMappingStep
        columns={columns}
        sampleRows={sampleRows}
        mappings={duplicatePhoneMappings}
        onMappingChange={vi.fn()}
        onConfirmImport={vi.fn()}
      />
    );
    expect(screen.getByTestId("mapping-validation-error")).toHaveTextContent(/Telefone é único/i);
    expect(screen.getByTestId("confirm-import-btn")).toBeDisabled();

    unmount();

    render(
      <ColumnMappingStep
        columns={columns}
        sampleRows={sampleRows}
        mappings={duplicateCustomMappings}
        onMappingChange={vi.fn()}
        onConfirmImport={vi.fn()}
      />
    );
    expect(screen.getByTestId("mapping-validation-error")).toHaveTextContent(/não podem ter o mesmo rótulo/i);
    expect(screen.getByTestId("confirm-import-btn")).toBeDisabled();
  });

  // Teste 5
  it("5. coluna só de números propõe número; só de datas propõe data; mista propõe texto", () => {
    // Só números
    expect(inferColumnType([10, "20", "30.5", "", null])).toBe("number");
    expect(inferColumnType(["1.500,50", "200", "0"])).toBe("number");

    // Só datas
    expect(inferColumnType(["2026-05-10", "2026-12-31T10:00:00Z", ""])).toBe("date");
    expect(inferColumnType(["15/03/2026", "01/01/2025", ""])).toBe("date");

    // Mista ou texto
    expect(inferColumnType(["100", "duzentos", "300"])).toBe("text");
    expect(inferColumnType(["2026-05-10", "data não informada"])).toBe("text");
    expect(inferColumnType(["Texto simples", "Outro texto"])).toBe("text");

    // Teste integrado com proposeColumnMappings
    const columns = ["idade", "aniversario", "observacao"];
    const sampleRows = [
      { idade: "25", aniversario: "1999-04-12", observacao: "100 e texto" },
      { idade: "30", aniversario: "1994-08-20", observacao: "apenas texto" },
    ];

    const proposed = proposeColumnMappings({ columns, sampleRows });
    expect(proposed.find((p) => p.column === "idade")?.type).toBe("number");
    expect(proposed.find((p) => p.column === "aniversario")?.type).toBe("date");
    expect(proposed.find((p) => p.column === "observacao")?.type).toBe("text");
  });

  // Teste 6
  it("6. as colunas marcadas entram em dados.campos com a chave normalizada; as ignoradas não entram em lugar nenhum", () => {
    const mappings: ColumnMappingItem[] = [
      { column: "Telefone Lead", target: "telefone", label: "Telefone", type: "text", key: "telefone" },
      { column: "Nome Completo", target: "nome", label: "Nome", type: "text", key: "nome" },
      { column: "Área de Atuação", target: "custom", label: "Área de Atuação", type: "text", key: "area_de_atuacao" },
      { column: "Score do Lead", target: "custom", label: "Score do Lead", type: "number", key: "score_do_lead" },
      { column: "Coluna Descartável", target: "ignore", label: "Coluna Descartável", type: "text", key: "coluna_descartavel" },
    ];

    const row = {
      "Telefone Lead": "34991234567",
      "Nome Completo": "Renato Garcia",
      "Área de Atuação": "Engenharia Solar",
      "Score do Lead": "85.5",
      "Coluna Descartável": "Não deve aparecer",
    };

    const mapped = applyColumnMappingsToRow(row, mappings);

    expect(mapped.telefone).toBe("34991234567");
    expect(mapped.nome).toBe("Renato Garcia");
    expect(mapped.dados.campos.area_de_atuacao).toBe("Engenharia Solar");
    expect(mapped.dados.campos.score_do_lead).toBe(85.5);
    expect(mapped.dados.campos).not.toHaveProperty("coluna_descartavel");
    expect(mapped.dados.campos).not.toHaveProperty("Coluna Descartável");
  });

  // Teste 7
  it("7. valor vazio não cria a chave para aquele lead — nem string vazia, nem zero", () => {
    const mappings: ColumnMappingItem[] = [
      { column: "Telefone", target: "telefone", label: "Telefone", type: "text", key: "telefone" },
      { column: "Nome", target: "nome", label: "Nome", type: "text", key: "nome" },
      { column: "Empresa", target: "custom", label: "Empresa", type: "text", key: "empresa" },
      { column: "Desconto", target: "custom", label: "Desconto", type: "number", key: "desconto" },
    ];

    // Lead com empresa preenchida mas desconto em branco (string vazia)
    const rowA = {
      Telefone: "34991111111",
      Nome: "Lead A",
      Empresa: "Acme Corp",
      Desconto: "   ", // Espaços em branco
    };

    // Lead com desconto preenchido mas empresa null
    const rowB = {
      Telefone: "34992222222",
      Nome: "Lead B",
      Empresa: null,
      Desconto: "15",
    };

    const mappedA = applyColumnMappingsToRow(rowA, mappings);
    const mappedB = applyColumnMappingsToRow(rowB, mappings);

    // Lead A: tem empresa, NÃO TEM desconto (não é "" nem 0)
    expect(mappedA.dados.campos).toHaveProperty("empresa", "Acme Corp");
    expect(mappedA.dados.campos).not.toHaveProperty("desconto");
    expect(Object.keys(mappedA.dados.campos)).toEqual(["empresa"]);

    // Lead B: tem desconto, NÃO TEM empresa (não é null nem "")
    expect(mappedB.dados.campos).toHaveProperty("desconto", 15);
    expect(mappedB.dados.campos).not.toHaveProperty("empresa");
    expect(Object.keys(mappedB.dados.campos)).toEqual(["desconto"]);
  });

  // Teste 10
  it("10. planilha com as mesmas colunas de uma anterior chega com o mapeamento preenchido", () => {
    const pastMapping: StoredColumnMapping = {
      columns: ["Telefone", "Nome", "Setor", "Faturamento"],
      mapping: [
        { column: "Telefone", target: "telefone", label: "Telefone", type: "text", key: "telefone" },
        { column: "Nome", target: "nome", label: "Nome", type: "text", key: "nome" },
        { column: "Setor", target: "custom", label: "Ramo de Atuação", type: "text", key: "ramo_de_atuacao" },
        { column: "Faturamento", target: "custom", label: "Faturamento Anual", type: "number", key: "faturamento_anual" },
      ],
    };

    const pastImports = [
      {
        id: "import-1",
        column_mapping: pastMapping,
      },
    ];

    // Nova planilha com exatamente as mesmas colunas (mesmo em ordem ligeiramente diferente)
    const currentColumns = ["Faturamento", "Telefone", "Setor", "Nome"];
    expect(areColumnSetsEqual(currentColumns, pastMapping.columns)).toBe(true);

    const remembered = findMatchingRememberedMapping(currentColumns, pastImports);
    expect(remembered).not.toBeNull();
    expect(remembered?.columns).toEqual(pastMapping.columns);

    // proposeColumnMappings preenche tudo usando a memória
    const proposed = proposeColumnMappings({
      columns: currentColumns,
      rememberedMapping: remembered,
    });

    const faturamentoProp = proposed.find((p) => p.column === "Faturamento");
    expect(faturamentoProp?.target).toBe("custom");
    expect(faturamentoProp?.label).toBe("Faturamento Anual");
    expect(faturamentoProp?.type).toBe("number");
    expect(faturamentoProp?.key).toBe("faturamento_anual");

    const telefoneProp = proposed.find((p) => p.column === "Telefone");
    expect(telefoneProp?.target).toBe("telefone");

    const setorProp = proposed.find((p) => p.column === "Setor");
    expect(setorProp?.target).toBe("custom");
    expect(setorProp?.label).toBe("Ramo de Atuação");
  });

  // Teste 9 (Parte Frontend / UI)
  it("9. tipo divergente na segunda importação não sobrescreve o registro e avisa (detecção e banner UI)", () => {
    const knownCustomFields = [
      { key: "cargo", label: "Cargo", type: "text" as const },
      { key: "faturamento", label: "Faturamento", type: "number" as const },
    ];

    const currentMappings: ColumnMappingItem[] = [
      { column: "Telefone", target: "telefone", label: "Telefone", type: "text", key: "telefone" },
      { column: "Cargo", target: "custom", label: "Cargo", type: "number", key: "cargo" }, // Divergente: veio como number, registrado como text!
      { column: "Faturamento", target: "custom", label: "Faturamento", type: "number", key: "faturamento" }, // Consistente
    ];

    const divergences = detectTypeDivergences(currentMappings, knownCustomFields);
    expect(divergences).toHaveLength(1);
    expect(divergences[0].column).toBe("Cargo");
    expect(divergences[0].detectedType).toBe("number");
    expect(divergences[0].registeredType).toBe("text");
    expect(divergences[0].message).toContain("já está cadastrado como 'text'");
    expect(divergences[0].message).toContain("O tipo original será mantido no registro");

    // Validação de renderização pela UI (banner de aviso exibido)
    render(
      <ColumnMappingStep
        columns={["Telefone", "Cargo", "Faturamento"]}
        sampleRows={[{ Telefone: "34991112222", Cargo: "123", Faturamento: "50000" }]}
        mappings={currentMappings}
        knownCustomFields={knownCustomFields}
        onMappingChange={vi.fn()}
        onConfirmImport={vi.fn()}
      />
    );

    const warningBanner = screen.getByTestId("type-divergence-warning");
    expect(warningBanner).toBeInTheDocument();
    expect(warningBanner).toHaveTextContent(/já está cadastrado como 'text'/i);
    expect(warningBanner).toHaveTextContent(/O tipo original será mantido/i);
  });

  // Ajuste 3: Teste de espelho (Frontend) usando a tabela compartilhada
  describe("Teste de espelho: normalização de chaves e parsing numérico (Frontend)", () => {
    it("normalizeFieldKey produz exatamente as chaves esperadas da tabela compartilhada", () => {
      expect(sharedCases.keyNormalizationCases.length).toBeGreaterThan(0);
      for (const item of sharedCases.keyNormalizationCases) {
        expect(normalizeFieldKey(item.label)).toBe(item.expected);
      }
    });

    it("parseNumberValue converte valores numéricos conforme a tabela compartilhada", () => {
      expect(sharedCases.numberParsingCases.length).toBeGreaterThan(0);
      for (const item of sharedCases.numberParsingCases) {
        const result = parseNumberValue(item.input);
        if (item.expected === null) {
          expect(Number.isNaN(result)).toBe(true);
        } else {
          expect(result).toBe(item.expected);
        }
      }
    });
  });
});

