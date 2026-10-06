// Importação com mais de uma coluna de telefone — lado da tela: a regra da prévia é a do servidor (fixture compartilhada), a validação aceita
// vários "Telefone adicional" e um só "Telefone", a sugestão automática marca as outras colunas com cara de telefone, e o mapeamento mostra o destino.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import cases from "../../../shared/multiPhoneCases.json";
import { resolveRowPhones, summarizePhonePreview } from "@/lib/leadImports/multiPhone";
import {
  applyColumnMappingsToRow,
  looksLikePhoneHeader,
  proposeColumnMappings,
  validateColumnMappings,
  type ColumnMappingItem,
} from "@/lib/leadImports/spreadsheet";
import { ColumnMappingStep } from "@/pages/LeadImports/ColumnMappingStep";

const item = (column: string, target: ColumnMappingItem["target"]): ColumnMappingItem => ({ column, target, label: column, type: "text", key: column.toLowerCase().replace(/\W+/g, "_") });

describe("resolveRowPhones: a regra do servidor, caso a caso (fixture compartilhada)", () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      const r = resolveRowPhones(c.row as Record<string, unknown>, c.mapping, c.ddd);
      expect({ telefone: r.telefone, colunaPrincipal: r.colunaPrincipal, brutoPrincipal: r.brutoPrincipal, extras: r.extras.map((e) => ({ telefone: e.telefone, coluna: e.coluna })) }).toEqual(c.expected);
    });
  }
});

describe("prévia: só principal / com adicional / puladas", () => {
  it("conta cada linha numa categoria só, e as três somam o total", () => {
    const mapping = [item("Tel 1", "telefone"), item("Tel 2", "telefone_adicional")];
    const rows = [
      { "Tel 1": "(34) 99810-0001", "Tel 2": "(34) 99810-0002" }, // com adicional
      { "Tel 1": "", "Tel 2": "(34) 99810-0003" }, // adicional vira principal → só principal
      { "Tel 1": "(34) 99810-0004", "Tel 2": "34998100004" }, // iguais → só principal
      { "Tel 1": "lixo", "Tel 2": "" }, // pulada
      { "Tel 1": "", "Tel 2": "" }, // pulada
    ];
    expect(summarizePhonePreview(rows, mapping, null)).toEqual({ total: 5, onlyPrincipal: 2, withExtras: 1, skipped: 2 });
  });
});

describe("mapeamento com colunas de 'Telefone adicional'", () => {
  it("aceita quantos adicionais o usuário marcar, mas o Telefone principal continua obrigatório e único", () => {
    const colunas = ["Empresa", "T1", "T2", "T3"];
    expect(validateColumnMappings([item("Empresa", "nome"), item("T1", "telefone"), item("T2", "telefone_adicional"), item("T3", "telefone_adicional")], colunas).isValid).toBe(true);
    const semPrincipal = validateColumnMappings([item("Empresa", "nome"), item("T2", "telefone_adicional")], colunas);
    expect(semPrincipal.isValid).toBe(false);
    const doisPrincipais = validateColumnMappings([item("T1", "telefone"), item("T2", "telefone")], colunas);
    expect(doisPrincipais.isValid).toBe(false);
    expect(doisPrincipais.errorMessage).toMatch(/Telefone adicional/);
  });

  it("a sugestão automática marca as outras colunas com cara de telefone como adicionais (e não mexe nas demais)", () => {
    expect(looksLikePhoneHeader("Telefone 2")).toBe(true);
    expect(looksLikePhoneHeader("Celular comercial")).toBe(true);
    expect(looksLikePhoneHeader("WhatsApp")).toBe(true);
    expect(looksLikePhoneHeader("Telefone")).toBe(true);
    expect(looksLikePhoneHeader("Empresa")).toBe(false);
    expect(looksLikePhoneHeader("Endereço")).toBe(false);
    const columns = ["Empresa", "Telefone", "Telefone 2", "Cidade"];
    const sampleRows = [{ Empresa: "A", Telefone: "(34) 99810-0001", "Telefone 2": "(34) 99810-0002", Cidade: "Uberlândia" }];
    const m = proposeColumnMappings({ columns, sampleRows });
    const alvo = Object.fromEntries(m.map((x) => [x.column, x.target]));
    expect(alvo.Telefone).toBe("telefone");
    expect(alvo["Telefone 2"]).toBe("telefone_adicional");
    expect(alvo.Empresa).not.toBe("telefone_adicional");
    expect(alvo.Cidade).toBe("ignore");
  });

  it("applyColumnMappingsToRow usa o telefone que vira principal (principal vazio → o adicional)", () => {
    const mapping = [item("Nome", "nome"), item("T1", "telefone"), item("T2", "telefone_adicional")];
    const r = applyColumnMappingsToRow({ Nome: "X", T1: "", T2: "(34) 99810-0002" }, mapping, null);
    expect(r.telefone).toBe("(34) 99810-0002");
    const sem = applyColumnMappingsToRow({ Nome: "X", T1: "(34) 99810-0001", T2: "(34) 99810-0002" }, mapping, null);
    expect(sem.telefone).toBe("(34) 99810-0001");
  });

  it("a tela de mapeamento mostra o destino e a explicação do telefone adicional", () => {
    render(
      <ColumnMappingStep
        columns={["Empresa", "Tel 1", "Tel 2"]}
        sampleRows={[{ Empresa: "A", "Tel 1": "(34) 99810-0001", "Tel 2": "(34) 99810-0002" }]}
        mappings={[item("Empresa", "nome"), item("Tel 1", "telefone"), item("Tel 2", "telefone_adicional")]}
        onMappingChange={() => {}}
        hideActions
      />
    );
    expect(screen.getByTestId("extra-phone-hint-Tel 2")).toHaveTextContent(/dados\.telefones_extras/);
    expect(screen.getByTestId("extra-phone-hint-Tel 2")).toHaveTextContent(/primeiro adicional válido identifica/);
    expect(screen.queryByTestId("mapping-validation-error")).not.toBeInTheDocument();
  });
});
