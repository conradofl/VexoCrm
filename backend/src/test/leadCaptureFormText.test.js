// backend/src/test/leadCaptureFormText.test.js
// Testes de Linguagem Simples e Congelamento de Values no Formulário de Diagnóstico.
//
// Especificação: CORREÇÃO — português simples no formulário de diagnóstico
// Objetivo: Garantir que o texto visível e labels do formulário utilizem termos
// acessíveis para clientes leigos sem quebrar os parsers do backend (os values das
// options permanecem rigorosamente congelados).

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  parseBaseCount,
  parseTicketMedio,
  parseStalledPct,
  calculateStalledRevenue,
  formatVisitorDiagnosticMessage,
} from "../services/leadCapture.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Lista congelada dos 36 values das <option> em LeadCaptureModal.tsx
export const FROZEN_OPTION_VALUES = [
  "Serviços B2B / Consultoria",
  "Saúde / Clínicas / Estética",
  "Imobiliária / Construção Civil",
  "Energia Solar / Engenharia",
  "Tecnologia / SaaS",
  "Varejo / E-commerce / Franquias",
  "Outro Segmento",
  "Apenas eu (vendedor único)",
  "2 a 5 vendedores",
  "6 a 15 vendedores",
  "Mais de 15 pessoas vendendo",
  "Até 2.000 contatos",
  "2.000 a 10.000 contatos",
  "10.000 a 50.000 contatos",
  "Mais de 50.000 contatos",
  "Até R$ 500",
  "R$ 500 a R$ 2.000",
  "R$ 2.000 a R$ 5.000",
  "R$ 5.000 a R$ 20.000",
  "Acima de R$ 20.000",
  "Menos de 30% da base",
  "30% a 50% da base",
  "Mais de 50% da base",
  "Não sei dizer (a maioria parada)",
  "Até 5 minutos",
  "5 a 30 minutos",
  "30 minutos a 2 horas",
  "Mais de 2 horas ou dia seguinte",
  "Manual (planilha ou lembrete do vendedor)",
  "CRM tradicional (mas o time não alimenta)",
  "Automação básica que não converte",
  "Não temos processo de follow-up",
  "Leads esfriam antes do primeiro contato",
  "Vendedores esquecem o follow-up",
  "Base antiga está parada sem reativação",
  "Demora para emitir proposta e contrato",
];

const FORBIDDEN_WORDS = [
  "ticket",
  "lead",
  "follow-up",
  "followup",
  "gargalo",
  "base total",
  "reativação",
  "reativacao",
  "segmento",
  "estimativa",
  "b2b",
  "saas",
  "crm",
];

function loadModalFile() {
  const modalPath = resolve(__dirname, "../../../frontend/src/pages/LandingPage/LeadCaptureModal.tsx");
  return readFileSync(modalPath, "utf8");
}

describe("Português Simples no Formulário de Diagnóstico (LeadCaptureModal.tsx)", () => {
  // Teste (n) da SPEC: para CADA <option> do formulário, o atributo value é EXATAMENTE igual ao congelado
  it("n) para CADA <option> do formulário, o atributo value é EXATAMENTE igual ao congelado", () => {
    const modalContent = loadModalFile();
    const optionMatches = [...modalContent.matchAll(/<option\s+value="([^"]+)">/g)];
    const actualValues = optionMatches.map((m) => m[1]);

    expect(actualValues.length).toBe(FROZEN_OPTION_VALUES.length);
    expect(actualValues).toEqual(FROZEN_OPTION_VALUES);
  });

  // Teste (o) da SPEC: nenhum <label> nem texto visível de <option> contém jargão técnico
  it("o) nenhum <label> nem texto visível de <option> contém jargão técnico proibido", () => {
    const modalContent = loadModalFile();

    // 1. Extração de todos os <label> do formulário
    const labelMatches = [...modalContent.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/g)];
    expect(labelMatches.length).toBeGreaterThanOrEqual(12);

    for (const match of labelMatches) {
      const labelText = match[1].trim().toLowerCase();
      for (const word of FORBIDDEN_WORDS) {
        expect(
          labelText.includes(word),
          `Label "${match[1].trim()}" contém palavra proibida "${word}"`
        ).toBe(false);
      }
    }

    // 2. Extração de todos os textos visíveis entre <option> e </option>
    const optionMatches = [...modalContent.matchAll(/<option[^>]*>([\s\S]*?)<\/option>/g)];
    expect(optionMatches.length).toBe(FROZEN_OPTION_VALUES.length);

    for (const match of optionMatches) {
      const visibleText = match[1].trim().toLowerCase();
      for (const word of FORBIDDEN_WORDS) {
        expect(
          visibleText.includes(word),
          `Opção visível "${match[1].trim()}" contém palavra proibida "${word}"`
        ).toBe(false);
      }
    }
  });

  // Teste (p) da SPEC: o cálculo honesto (R$ 60.000) continua passando sem alteração
  it("p) o cálculo honesto (R$ 60.000) continua passando usando as options reais do formulário", () => {
    const modalContent = loadModalFile();

    // Extrai o value da opção de 2.000 a 10.000 contatos diretamente do arquivo
    const baseMatch = modalContent.match(/<option\s+value="(2\.000 a 10\.000 contatos)">/);
    expect(baseMatch).not.toBeNull();
    const baseSize = baseMatch[1];

    const ticketMatch = modalContent.match(/<option\s+value="(R\$\s*500 a R\$\s*2\.000)">/);
    expect(ticketMatch).not.toBeNull();
    const ticketMedio = ticketMatch[1];

    const stalledMatch = modalContent.match(/<option\s+value="(30%\s*a\s*50%\s*da\s*base)">/);
    expect(stalledMatch).not.toBeNull();
    const stalledLeadsPct = stalledMatch[1];

    // Executa os parsers de produção
    const baseCount = parseBaseCount(baseSize);
    const ticketVal = parseTicketMedio(ticketMedio);
    const pct = parseStalledPct(stalledLeadsPct);

    expect(baseCount).toBe(10000);
    expect(ticketVal).toBe(2000);
    expect(pct).toBe(0.40);

    const calc = calculateStalledRevenue({ baseSize, ticketMedio, stalledLeadsPct });
    expect(calc.leadsParados).toBe(4000);
    expect(calc.receitaPotencial).toBe(60000);

    const msg = formatVisitorDiagnosticMessage({
      fullName: "Prospect Teste",
      baseSize,
      ticketMedio,
      stalledLeadsPct,
      responseTime: "5 a 30 minutos",
    });

    const revenueMatch = msg.match(/há cerca de R\$\s*([\d.]+)/);
    expect(revenueMatch).not.toBeNull();
    const extractedRevenue = parseInt(revenueMatch[1].replace(/\./g, ""), 10);
    expect(extractedRevenue).toBe(60000);
    expect(msg).toContain("Com 4.000 leads parados nesse ticket, há cerca de R$ 60.000 esperando na sua base. Estimando 15% de resposta e 5% de fechamento.");
  });

  // Teste (q) da SPEC (ADENDO passos 1 e 2): nenhum <label> contém "Corporativo" nem "Comercial"
  it("q) nenhum <label> contém 'Corporativo' nem 'Comercial'", () => {
    const modalContent = loadModalFile();
    const labelMatches = [...modalContent.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/g)];
    expect(labelMatches.length).toBeGreaterThanOrEqual(12);

    for (const match of labelMatches) {
      const labelText = match[1].trim();
      expect(
        /corporativo/i.test(labelText),
        `Label "${labelText}" não pode conter "Corporativo"`
      ).toBe(false);
      expect(
        /comercial/i.test(labelText),
        `Label "${labelText}" não pode conter "Comercial"`
      ).toBe(false);
    }
  });
});

