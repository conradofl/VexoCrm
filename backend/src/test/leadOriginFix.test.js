// backend/src/test/leadOriginFix.test.js
//
// Correção dos leads marcados "Instagram Direct" pelo padrão fabricado do importador de planilha: prévia
// (três grupos que fecham com o total), execução só dos determináveis, trava de contagem, tenancy,
// transação e auditoria. O SQL real é conferido contra Postgres real (pglite) fora do repositório.

import { describe, expect, it } from "vitest";
import {
  ORIGIN_FIX_ERRORS,
  TYPED_CONFIRMATION_THRESHOLD,
  classifyOriginFix,
  executeOriginFix,
  hasImportTagBesideFabricated,
  isFromInstagramImporter,
  previewOriginFix,
} from "../services/leadOriginFix.js";
import { createMemoryOriginFixRepo, fromInstagramImporter, onlyImportTag, undeterminable, withImportId } from "./helpers/memoryOriginFixRepo.js";

const actor = { uid: "uid-gestor", email: "gestor@vexo.com" };

function seed() {
  return createMemoryOriginFixRepo({
    leads: [
      ...[1, 2, 3].map((i) => withImportId("A", `A-id${i}`)),
      ...[1, 2, 3, 4].map((i) => onlyImportTag("A", `A-tag${i}`)),
      ...[1, 2].map((i) => undeterminable("A", `A-und${i}`)),
      ...[1, 2, 3, 4, 5].map((i) => fromInstagramImporter("A", `A-ig${i}`)),
      // outro cliente, mesmas assinaturas
      ...[1, 2].map((i) => withImportId("B", `B-id${i}`)),
      ...[1, 2, 3].map((i) => onlyImportTag("B", `B-tag${i}`)),
      // lead com origem de verdade — fora da população
      { id: "A-real", client_id: "A", tags: ["Lista Out/26"], dados: { origem: "Indicação", origem_marketing: "Indicação", lead_source: "Indicação" } },
    ],
  });
}

describe("prévia", () => {
  it("[TESTE OBRIGATÓRIO] separa os três grupos e os números fecham com o total", async () => {
    const repo = seed();

    const p = await previewOriginFix(repo, repo.store, { clientId: "A" });

    expect(p).toMatchObject({ withImportId: 3, onlyImportTag: 4, undeterminable: 2, total: 9, correctable: 7 });
    expect(p.withImportId + p.onlyImportTag + p.undeterminable).toBe(p.total);
    expect(p.correctable).toBe(p.withImportId + p.onlyImportTag);
  });

  it("[TESTE OBRIGATÓRIO] lead do importador de Instagram fica fora do total (é verdade ali) e vem contado à parte", async () => {
    const repo = seed();
    const p = await previewOriginFix(repo, repo.store, { clientId: "A" });

    expect(p.instagramImporterUntouched).toBe(5);
    expect(p.total).toBe(9); // não inclui os 5 do Instagram
  });

  it("é só leitura: nada é alterado, nenhuma transação aberta", async () => {
    const repo = seed();
    const antes = JSON.stringify(repo.store.leads);

    await previewOriginFix(repo, repo.store, { clientId: "A" });

    expect(JSON.stringify(repo.store.leads)).toBe(antes);
    expect(repo.calls.map((c) => c.op)).toEqual(["listCandidates"]);
  });

  it("[TESTE OBRIGATÓRIO] a prévia respeita o tenant: só conta os leads do cliente pedido", async () => {
    const repo = seed();

    const b = await previewOriginFix(repo, repo.store, { clientId: "B" });

    expect(b).toMatchObject({ withImportId: 2, onlyImportTag: 3, undeterminable: 0, total: 5 });
    expect(new Set(repo.calls.map((c) => c.clientId))).toEqual(new Set(["B"]));
  });

  it("diz o que vai gravar e se exige digitar o número", async () => {
    const repo = seed();
    const p = await previewOriginFix(repo, repo.store, { clientId: "A" });

    expect(p.willSet).toEqual({ origem: "Importação de planilha", origemMarketing: "importacao_planilha", leadSource: "importacao_planilha", removeTag: "Instagram Direct" });
    expect(p.confirmation).toEqual({ typedRequired: false, threshold: TYPED_CONFIRMATION_THRESHOLD });
  });
});

describe("classificação", () => {
  const lead = (over) => ({ id: "x", tags: [], origem: "Instagram Direct", origem_marketing: "Instagram Direct", lead_source: "Instagram Direct", lead_source_bruto: null, lead_source_column: null, import_ids: null, ...over });

  it("origem diferente de 'Instagram Direct' nem entra", () => {
    expect(classifyOriginFix([lead({ origem: "Indicação" }), lead({ origem: null })]).total).toBe(0);
  });

  it("importador de Instagram é reconhecido por qualquer das três marcas dele", () => {
    expect(isFromInstagramImporter(lead({ origem_marketing: "instagram_export" }))).toBe(true);
    expect(isFromInstagramImporter(lead({ lead_source_column: "instagram_export" }))).toBe(true);
    expect(isFromInstagramImporter(lead({ lead_source_bruto: "Instagram Direct" }))).toBe(true);
    expect(isFromInstagramImporter(lead({}))).toBe(false);
  });

  it("com identificador mas SEM a assinatura de planilha não é determinável (origem foi alterada por outro caminho)", () => {
    const c = classifyOriginFix([lead({ import_ids: ["i"], origem_marketing: "campanha" })]);
    expect(c.groups.undeterminable).toHaveLength(1);
    expect(c.correctable).toBe(0);
  });

  it("[TESTE OBRIGATÓRIO] com a tag de importação ao lado mas SEM a assinatura de planilha também não é determinável", () => {
    const c = classifyOriginFix([lead({ tags: ["Lista X", "Instagram Direct"], lead_source: "campanha" }), lead({ tags: ["Lista X", "Instagram Direct"], origem_marketing: "outro" })]);
    expect(c.groups.onlyImportTag).toHaveLength(0);
    expect(c.groups.undeterminable).toHaveLength(2);
    expect(c.correctable).toBe(0);
  });

  it("tag de importação ao lado: exige ao menos uma e nenhuma de canal ou do sistema", () => {
    expect(hasImportTagBesideFabricated({ tags: ["Lista X", "Instagram Direct"] })).toBe(true);
    expect(hasImportTagBesideFabricated({ tags: ["Instagram Direct"] })).toBe(false); // só ela: pode ter sido escolha
    expect(hasImportTagBesideFabricated({ tags: ["Lista X"] })).toBe(false); // nem tem a tag fabricada
    expect(hasImportTagBesideFabricated({ tags: ["Lista X", "Facebook Ads", "Instagram Direct"] })).toBe(false); // outro canal: ambíguo
    expect(hasImportTagBesideFabricated({ tags: ["Venda Fechada", "Instagram Direct"] })).toBe(false); // caminho de vendas fechadas
    expect(hasImportTagBesideFabricated({ tags: ["Lista X", "instagram direct "] })).toBe(true); // caixa e espaço
  });

  it("import_ids pode vir como texto JSON do banco", () => {
    const c = classifyOriginFix([lead({ import_ids: '["imp-9"]' })]);
    expect(c.groups.withImportId).toHaveLength(1);
  });
});

describe("execução", () => {
  const run = (repo, over = {}) => executeOriginFix(repo, repo.store, { clientId: "A", expectedCount: 7, actor, ...over });

  it("[TESTE OBRIGATÓRIO] corrige só os determináveis (grupos 1 e 2): origem vira importação e a tag falsa sai", async () => {
    const repo = seed();

    const out = await run(repo);

    expect(out.ok).toBe(true);
    expect(out.report).toMatchObject({ corrected: 7, correctedWithImportId: 3, correctedOnlyImportTag: 4, leftUndeterminable: 2, leftInstagramImporter: 5 });
    for (const l of repo.store.leads.filter((x) => /^A-(id|tag)/.test(x.id))) {
      expect(l.dados).toMatchObject({ origem: "Importação de planilha", origem_marketing: "importacao_planilha", lead_source: "importacao_planilha" });
      expect(l.tags).not.toContain("Instagram Direct");
    }
    // a tag da importação e o identificador continuam
    expect(repo.store.leads.find((l) => l.id === "A-id1").tags).toEqual(["Lista Out/26"]);
    expect(repo.store.leads.find((l) => l.id === "A-id1").dados.import_ids).toEqual(["imp-1"]);
  });

  it("[TESTE OBRIGATÓRIO] a correção não altera lead vindo do importador de Instagram", async () => {
    const repo = seed();
    const antes = JSON.stringify(repo.store.leads.filter((l) => l.id.startsWith("A-ig")));

    await run(repo);

    expect(JSON.stringify(repo.store.leads.filter((l) => l.id.startsWith("A-ig")))).toBe(antes);
  });

  it("[TESTE OBRIGATÓRIO] não toca nos indetermináveis, nem em lead de origem verdadeira", async () => {
    const repo = seed();
    const antes = JSON.stringify(repo.store.leads.filter((l) => l.id.startsWith("A-und") || l.id === "A-real"));

    await run(repo);

    expect(JSON.stringify(repo.store.leads.filter((l) => l.id.startsWith("A-und") || l.id === "A-real"))).toBe(antes);
  });

  it("[TESTE OBRIGATÓRIO] a correção respeita o tenant: corrigir A nunca altera B (mesmas assinaturas)", async () => {
    const repo = seed();
    const antes = JSON.stringify(repo.store.leads.filter((l) => l.client_id === "B"));

    await run(repo);

    expect(JSON.stringify(repo.store.leads.filter((l) => l.client_id === "B"))).toBe(antes);
    expect(new Set(repo.calls.filter((c) => c.clientId).map((c) => c.clientId))).toEqual(new Set(["A"]));
  });

  it("[TESTE OBRIGATÓRIO] número divergente do da prévia: recusa, nada é alterado, e diz o número real", async () => {
    const repo = seed();
    const antes = JSON.stringify(repo.store.leads);

    const out = await run(repo, { expectedCount: 5 });

    expect(out.ok).toBe(false);
    expect(out.code).toBe(ORIGIN_FIX_ERRORS.COUNT_MISMATCH);
    expect(out.details).toMatchObject({ expected: 5, actual: 7 });
    expect(out.message).toContain("Nada foi alterado");
    expect(JSON.stringify(repo.store.leads)).toBe(antes);
    expect(repo.calls.some((c) => c.op === "fixLeads")).toBe(false);
    expect(repo.calls.map((c) => c.op)).toContain("rollback");
  });

  it("[TESTE OBRIGATÓRIO] lead que entra no grupo entre a prévia e a execução também derruba a execução", async () => {
    const repo = seed();
    const visto = (await previewOriginFix(repo, repo.store, { clientId: "A" })).correctable;
    repo.store.leads.push(onlyImportTag("A", "A-nova")); // uma importação rodou no meio

    const out = await run(repo, { expectedCount: visto });

    expect(out.ok).toBe(false);
    expect(out.details).toMatchObject({ expected: 7, actual: 8 });
  });

  it("sem expectedCount (ou inválido): recusa — a execução nunca roda às cegas", async () => {
    const repo = seed();
    for (const bad of [undefined, null, "", "abc", -1, 2.5]) {
      const out = await run(repo, { expectedCount: bad });
      expect(out.ok, String(bad)).toBe(false);
      expect(out.code).toBe(ORIGIN_FIX_ERRORS.INVALID_EXPECTED);
    }
    expect(repo.calls.some((c) => c.op === "begin")).toBe(false);
  });

  it("[TESTE OBRIGATÓRIO] acima de 500: exige o número digitado, no servidor", async () => {
    const leads = Array.from({ length: 501 }, (_, i) => onlyImportTag("A", `A-n${i}`));
    const repo = createMemoryOriginFixRepo({ leads });

    const sem = await executeOriginFix(repo, repo.store, { clientId: "A", expectedCount: 501, actor });
    expect(sem.ok).toBe(false);
    expect(sem.code).toBe(ORIGIN_FIX_ERRORS.CONFIRMATION_REQUIRED);
    expect(repo.store.leads.every((l) => l.dados.origem === "Instagram Direct")).toBe(true);

    const com = await executeOriginFix(repo, repo.store, { clientId: "A", expectedCount: 501, typedConfirmation: "501", actor });
    expect(com.ok).toBe(true);
  });

  it("500 leads ainda é confirmação comum (só acima de 500 exige digitar)", async () => {
    const leads = Array.from({ length: 500 }, (_, i) => onlyImportTag("A", `A-m${i}`));
    const repo = createMemoryOriginFixRepo({ leads });

    const out = await executeOriginFix(repo, repo.store, { clientId: "A", expectedCount: 500, actor });

    expect(out.ok).toBe(true);
    expect(out.report.corrected).toBe(500);
  });

  it("[TESTE OBRIGATÓRIO] registra quem corrigiu o quê: usuário, quantidades por grupo, o que ficou e os ids corrigidos", async () => {
    const repo = seed();

    const out = await run(repo);

    expect(repo.store.audit).toHaveLength(1);
    expect(repo.store.audit[0]).toMatchObject({
      clientId: "A",
      userUid: "uid-gestor",
      userEmail: "gestor@vexo.com",
      expectedCount: 7,
      corrected: 7,
      correctedWithImportId: 3,
      correctedOnlyImportTag: 4,
      leftUndeterminable: 2,
      leftInstagramImporter: 5,
    });
    expect([...repo.store.audit[0].leadIds].sort()).toEqual(["A-id1", "A-id2", "A-id3", "A-tag1", "A-tag2", "A-tag3", "A-tag4"]);
    expect(out.report.audit).toMatchObject({ id: "audit-1", byEmail: "gestor@vexo.com" });
  });

  it("[TESTE OBRIGATÓRIO] falha ao gravar a auditoria desfaz a correção: nada muda sem registro", async () => {
    const repo = seed();
    const antes = JSON.stringify(repo.store.leads);
    repo.failNextAudit();

    await expect(run(repo)).rejects.toThrow(/auditoria/);

    expect(JSON.stringify(repo.store.leads)).toBe(antes);
    expect(repo.store.audit).toHaveLength(0);
  });

  it("[TESTE OBRIGATÓRIO] se o banco corrigir menos do que a seleção contou, desfaz tudo", async () => {
    const repo = seed();
    const antes = JSON.stringify(repo.store.leads);
    repo.fixShortBy(1);

    await expect(run(repo)).rejects.toThrow(/inconsistente/);

    expect(JSON.stringify(repo.store.leads)).toBe(antes);
  });

  it("rodar de novo depois de corrigir: não há mais nada determinável (idempotente) e a prévia mostra os que sobraram", async () => {
    const repo = seed();
    await run(repo);

    const p = await previewOriginFix(repo, repo.store, { clientId: "A" });
    expect(p).toMatchObject({ correctable: 0, undeterminable: 2, total: 2, instagramImporterUntouched: 5 });

    const out = await run(repo, { expectedCount: 0 });
    expect(out.code).toBe(ORIGIN_FIX_ERRORS.NOTHING_TO_FIX);
  });
});
