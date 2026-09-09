import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const gdRoutesSource = readFileSync(resolve("src/domains/geracaoDigitalRoutes.js"), "utf8");

/**
 * ---------------------------------------------------------------------------
 * CATÁLOGO DE CLASSIFICAÇÃO DE COLUNAS DE public.gd_proposals
 * ---------------------------------------------------------------------------
 * [PÚBLICA]  — O cliente precisa ver/interagir para visualizar ou assinar.
 * [INTERNA]  — Operacional/sistema, o cliente não deve receber.
 * [SIGILOSA] — Margem, custo, notas de reunião, comissões, repasse entre empresas.
 */
export const CLASSIFIED_PUBLIC_COLUMNS = [
  "id",
  "package_id",
  "package_vexo_id",
  "prospect_name",
  "itens",
  "valor_total",
  "condicoes",
  "status",
  "payment_link",
  "sent_at",
  "assinatura",
  "signer_name",
  "signed_at",
  "created_at",
  "cobrar_setup",
  "valor_setup_vexo",
  "condicoes_pagamento",
  "periodo_plano",
  "validade_ate",
  "valor_apos_validade",
  "observacao_validade",
  "descontos_concedidos",
  "assinatura_metodo",
  "valor_vp",
  "meio_pagamento",
  "carencia_dias",
  "pacotes_ofertados",
  "presentation_slides",
  "owner_company",
  "condicoes_especiais",
  "desconto_setup_pct",
  "desconto_mensal_pct",
  "vexi_plan",
  "vexi_price",
  "vexo_plan",
  "vexo_price",
  "prospect_logo",
  "segment_id",
  "descontos_por_periodo",
  "vp_percent",
];

export const CLASSIFIED_INTERNAL_OR_SENSITIVE_COLUMNS = [
  "tenant_id",        // [INTERNA] ID interno do tenant
  "presentation_id",  // [INTERNA] ID da apresentação vinculada
  "signer_ip",        // [INTERNA] IP da assinatura (auditoria interna)
  "termo_aceite",     // [INTERNA] Cópia de minuta contratual interna
  "arquivada",        // [INTERNA] Flag de arquivamento no CRM
  "meeting_notes",    // [SIGILOSA] Anotações de reunião comercial / SDR / fechamento
  "repasse_vexo_pct", // [SIGILOSA] Margem de repasse comercial / comissionamento
];

/** Extrai todas as colunas declaradas no schema de gd_proposals */
function extractGdProposalsSchemaColumns(source) {
  const columns = new Set();

  // 1. Colunas do CREATE TABLE
  const createTableMatch = source.match(/CREATE TABLE IF NOT EXISTS public\.gd_proposals\s*\(([\s\S]*?)\);/);
  if (createTableMatch) {
    const lines = createTableMatch[1].split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("PRIMARY KEY") || trimmed.startsWith("CONSTRAINT")) continue;
      const colMatch = trimmed.match(/^([a-z0-9_]+)\s+[A-Z]/i);
      if (colMatch) {
        columns.add(colMatch[1].toLowerCase());
      }
    }
  }

  // 2. Colunas do ALTER TABLE ADD COLUMN
  const alterRegex = /ALTER TABLE public\.gd_proposals ADD COLUMN IF NOT EXISTS\s+([a-z0-9_]+)/gi;
  let alterMatch;
  while ((alterMatch = alterRegex.exec(source)) !== null) {
    columns.add(alterMatch[1].toLowerCase());
  }

  return Array.from(columns);
}

describe("Trava de Segurança e Classificação de Colunas — GET /api/gd/public/proposals/:id", () => {
  const schemaColumns = extractGdProposalsSchemaColumns(gdRoutesSource);

  it("TRAVA 1: Todas as colunas existentes no banco de dados devem estar explicitamente classificadas", () => {
    const allClassified = new Set([
      ...CLASSIFIED_PUBLIC_COLUMNS,
      ...CLASSIFIED_INTERNAL_OR_SENSITIVE_COLUMNS,
    ]);

    const unclassified = schemaColumns.filter((col) => !allClassified.has(col));
    expect(
      unclassified,
      `COLUNA NOVA NO BANCO SEM CLASSIFICAÇÃO DETECTADA: ${unclassified.join(", ")}. Você DEVE adicioná-la a CLASSIFIED_PUBLIC_COLUMNS ou CLASSIFIED_INTERNAL_OR_SENSITIVE_COLUMNS.`
    ).toEqual([]);
  });

  it("TRAVA 2: Listas de colunas públicas e internas/sigilosas são mutuamente exclusivas", () => {
    const publicSet = new Set(CLASSIFIED_PUBLIC_COLUMNS);
    const intersecao = CLASSIFIED_INTERNAL_OR_SENSITIVE_COLUMNS.filter((col) => publicSet.has(col));
    expect(intersecao).toEqual([]);
  });

  it("TRAVA 3: O endpoint público NÃO utiliza SELECT * e possui query SQL explícita", () => {
    const endpointRegex = /app\.get\(\s*["']\/api\/gd\/public\/proposals\/:id["'][\s\S]*?const result = await pool\.query\([\s\S]*?\);/;
    const match = gdRoutesSource.match(endpointRegex);
    expect(match).toBeTruthy();

    const querySnippet = match[0];
    expect(querySnippet).not.toContain("SELECT * FROM public.gd_proposals");
    expect(querySnippet).toContain("SELECT id, tenant_id, presentation_id, package_id");
  });

  it("TRAVA 4: O serializer do endpoint público entrega todas as colunas públicas necessárias", () => {
    const endpointRegex = /const publicData = \{([\s\S]*?)\};/;
    const match = gdRoutesSource.match(endpointRegex);
    expect(match).toBeTruthy();

    const serializerSnippet = match[1];
    for (const pubCol of CLASSIFIED_PUBLIC_COLUMNS) {
      expect(serializerSnippet).toContain(pubCol);
    }
  });

  it("TRAVA 5: O serializer do endpoint público NUNCA entrega colunas internas ou sigilosas (repasse_vexo_pct, meeting_notes, etc.)", () => {
    const endpointRegex = /const publicData = \{([\s\S]*?)\};/;
    const match = gdRoutesSource.match(endpointRegex);
    expect(match).toBeTruthy();

    const serializerSnippet = match[1];
    for (const sensCol of CLASSIFIED_INTERNAL_OR_SENSITIVE_COLUMNS) {
      const directKeyRegex = new RegExp(`\\b${sensCol}\\s*:`, "i");
      expect(directKeyRegex.test(serializerSnippet)).toBe(false);
    }
    // Também não pode fazer spread do row (...row) que vazaria campos extras
    expect(serializerSnippet).not.toContain("...row");
  });

  it("TESTE DE MUTAÇÃO: Adicionar uma coluna sigilosa na allowlist pública faz o teste quebrar", () => {
    const allowlistMutadaComVazamento = [...CLASSIFIED_PUBLIC_COLUMNS, "meeting_notes"];
    const publicSet = new Set(allowlistMutadaComVazamento);
    const vazamento = CLASSIFIED_INTERNAL_OR_SENSITIVE_COLUMNS.filter((col) => publicSet.has(col));
    expect(vazamento).toContain("meeting_notes");
  });
});
