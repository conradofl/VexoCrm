// backend/src/test/leadMassDelete.test.js
//
// Exclusão em massa de leads por tag / importação. Operação irreversível: os testes são sobre o que
// ela IMPEDE. A regra é pura (services/leadMassDelete.js); o banco é um repositório em memória que
// honra as mesmas barreiras (escopo por cliente, transação com commit/rollback). O SQL real foi
// executado contra Postgres de verdade por scratchpad/pglite/mass-delete-real.mjs.

import { describe, expect, it, vi } from "vitest";
import {
  MASS_DELETE_ERRORS,
  TYPED_CONFIRMATION_THRESHOLD,
  buildDeletableCsv,
  classifyTargets,
  createPgMassDeleteRepo,
  executeMassDelete,
  hasOtherImport,
  normalizeCriterion,
  normalizeOptions,
  previewMassDelete,
  requiresTypedConfirmation,
  selectMassDeleteTargets,
} from "../services/leadMassDelete.js";
import { createMemoryMassDeleteRepo, makeLeads, poolOf } from "./helpers/memoryMassDeleteRepo.js";

const TAG = "Lista Out/26";
const CRIT = { type: "tag", value: TAG };
const NONE = normalizeOptions({});
const ACTOR = { uid: "uid-gestor", email: "gestor@vexo.com" };

const run = (repo, over = {}) =>
  executeMassDelete(repo, poolOf(repo), { clientId: "A", criterion: CRIT, options: NONE, expectedCount: 0, actor: ACTOR, ...over });
const view = (repo, over = {}) => previewMassDelete(repo, poolOf(repo), { clientId: "A", criterion: CRIT, options: NONE, ...over });

function cenario() {
  const limpos = makeLeads("A", 10);
  const multi = makeLeads("A", 3, { prefix: "m", offset: 1000, fields: { tags: [TAG, "Outra Lista Nov/26"] } });
  const comMsg = makeLeads("A", 2, { prefix: "g", offset: 2000 });
  const ambos = makeLeads("A", 1, { prefix: "b", offset: 3000, fields: { tags: [TAG, "Outra Lista Nov/26"] } });
  const repo = createMemoryMassDeleteRepo({
    leads: [...limpos, ...multi, ...comMsg, ...ambos, ...makeLeads("B", 6, { offset: 9000 })],
    messages: [
      ...comMsg.map((l) => ({ client_id: "A", lead_id: l.id, phone: null })),
      { client_id: "A", lead_id: ambos[0].id, phone: null },
    ],
  });
  return { repo, limpos, multi, comMsg, ambos };
}

describe("Critério e opções", () => {
  it("critério: só 'tag' e 'import', com valor", () => {
    expect(normalizeCriterion({ type: "tag", value: "  X " })).toEqual({ ok: true, criterion: { type: "tag", value: "X" } });
    expect(normalizeCriterion({ type: "import", value: "abc" }).ok).toBe(true);
    expect(normalizeCriterion({ type: "tag", value: "" }).ok).toBe(false);
    expect(normalizeCriterion({ type: "todos", value: "x" }).ok).toBe(false);
    expect(normalizeCriterion(undefined).ok).toBe(false);
    expect(normalizeCriterion({ type: "tag", value: "x".repeat(201) }).ok).toBe(false);
  });

  it("[TESTE OBRIGATÓRIO] normalização e deduplicação de múltiplas tags: remove vazios, espaços e duplicadas insensíveis a maiúsculas", () => {
    const res = normalizeCriterion({
      type: "tags",
      values: ["  vip  ", "novos", "VIP", "  ", null, "novos", "urgente"],
    });
    expect(res.ok).toBe(true);
    expect(res.criterion).toEqual({
      type: "tag",
      value: "vip, novos, urgente",
      values: ["vip", "novos", "urgente"],
    });
  });

  it("[TESTE OBRIGATÓRIO] as exceções são opt-in: só `true` de verdade liga (texto, número e ausência ficam desligados)", () => {
    expect(normalizeOptions({})).toEqual({ includeMultiImport: false, includeWithMessages: false });
    expect(normalizeOptions(undefined)).toEqual({ includeMultiImport: false, includeWithMessages: false });
    expect(normalizeOptions({ includeMultiImport: "true", includeWithMessages: 1 })).toEqual({ includeMultiImport: false, includeWithMessages: false });
    expect(normalizeOptions({ includeMultiImport: true })).toEqual({ includeMultiImport: true, includeWithMessages: false });
  });
});

describe("Prévia e execução usam exatamente o mesmo critério", () => {
  it("[TESTE OBRIGATÓRIO] a prévia e a execução dão o MESMO número, com a mesma seleção", async () => {
    const { repo } = cenario();

    const preview = await view(repo);
    const outcome = await run(repo, { expectedCount: preview.willDelete });

    expect(outcome.ok).toBe(true);
    expect(outcome.report.deleted).toBe(preview.willDelete);
    expect(outcome.report.matched).toBe(preview.matched);
    // a mesma leitura (mesmo cliente, mesmo critério) nas duas chamadas
    const reads = repo.calls.filter((c) => c.op === "listCandidates");
    expect(reads).toHaveLength(2);
    expect(reads[0]).toEqual(reads[1]);
  });

  it("a prévia é só leitura: não apaga, não audita, não abre transação", async () => {
    const { repo } = cenario();
    const antes = repo.store.leads.length;

    await view(repo);

    expect(repo.store.leads).toHaveLength(antes);
    expect(repo.store.audit).toHaveLength(0);
    expect(repo.calls.map((c) => c.op)).not.toEqual(expect.arrayContaining(["deleteLeads", "begin", "insertAudit"]));
  });

  it("os números da prévia são nomeados: batem, multi-importação, mensagens, serão apagados e ficam", async () => {
    const { repo } = cenario();

    const p = await view(repo);

    expect(p).toMatchObject({ matched: 16, multiImport: 4, withMessages: 3, both: 1, willDelete: 10, kept: 6 });
    expect(p.keptReasons).toEqual({ multiImport: 3, withMessages: 2, both: 1 });
  });
});

describe("Trava de contagem: o número visto na prévia", () => {
  it("[TESTE OBRIGATÓRIO] execução com número divergente do da prévia é RECUSADA e nada é apagado", async () => {
    const { repo } = cenario();

    const outcome = await run(repo, { expectedCount: 9 }); // viu 10... mandou 9

    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe(MASS_DELETE_ERRORS.COUNT_MISMATCH);
    expect(outcome.message).toContain("Nada foi apagado");
    expect(outcome.details).toMatchObject({ expected: 9, actual: 10 });
    expect(repo.store.leads.filter((l) => l.client_id === "A")).toHaveLength(16);
    expect(repo.store.audit).toHaveLength(0);
    expect(repo.calls.some((c) => c.op === "deleteLeads")).toBe(false);
    expect(repo.calls.filter((c) => c.op === "rollback")).toHaveLength(1);
  });

  it("[TESTE OBRIGATÓRIO] uma importação rodou entre ver e confirmar: apagaria MAIS do que ele viu → recusa", async () => {
    const { repo } = cenario();
    const preview = await view(repo); // vê 10
    repo.store.leads.push(...makeLeads("A", 3, { prefix: "novo", offset: 5000 })); // a importação adiciona 3 com a mesma tag

    const outcome = await run(repo, { expectedCount: preview.willDelete });

    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe(MASS_DELETE_ERRORS.COUNT_MISMATCH);
    expect(outcome.details.actual).toBe(13);
    expect(outcome.details.expected).toBe(10);
    expect(outcome.details.preview.willDelete).toBe(13); // devolve a prévia nova para ele revisar
    expect(repo.store.leads.filter((l) => l.client_id === "A")).toHaveLength(19);
  });

  it("a contagem que SOBROU também é recusada (menos do que viu)", async () => {
    const { repo } = cenario();
    const preview = await view(repo);
    repo.store.leads = repo.store.leads.filter((l) => l.id !== "A-l0");

    const outcome = await run(repo, { expectedCount: preview.willDelete });

    expect(outcome.ok).toBe(false);
    expect(outcome.details.actual).toBe(9);
  });

  it("número ausente ou inválido é recusado antes de tocar no banco", async () => {
    for (const expectedCount of [undefined, null, "", "abc", -1, 1.5]) {
      const { repo } = cenario();

      const outcome = await run(repo, { expectedCount });

      expect(outcome.ok, String(expectedCount)).toBe(false);
      expect(outcome.code).toBe(MASS_DELETE_ERRORS.INVALID_EXPECTED);
      expect(repo.calls.some((c) => c.op === "begin")).toBe(false);
    }
  });

  it("critério que não bate com nada: 'nada a apagar', sem auditoria", async () => {
    const repo = createMemoryMassDeleteRepo({ leads: makeLeads("A", 3, { fields: { tags: ["Outra"] } }) });

    const outcome = await run(repo, { expectedCount: 0 });

    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe(MASS_DELETE_ERRORS.NOTHING_TO_DELETE);
    expect(repo.store.audit).toHaveLength(0);
  });
});

describe("O que não se apaga por padrão", () => {
  it("[TESTE OBRIGATÓRIO] lead com tag de OUTRA importação NÃO é apagado por padrão — e é, quando a opção é ligada", async () => {
    const { repo, multi } = cenario();

    const padrao = await run(repo, { expectedCount: 10 });
    expect(padrao.ok).toBe(true);
    for (const l of multi) expect(repo.store.leads.some((x) => x.id === l.id), l.id).toBe(true); // continuam

    const { repo: repo2, multi: multi2 } = cenario();
    const ligado = normalizeOptions({ includeMultiImport: true });
    const p = await view(repo2, { options: ligado });
    const comOpcao = await run(repo2, { options: ligado, expectedCount: p.willDelete });
    expect(comOpcao.ok).toBe(true);
    expect(p.willDelete).toBe(13);
    for (const l of multi2) expect(repo2.store.leads.some((x) => x.id === l.id), l.id).toBe(false); // apagados
  });

  it("[TESTE OBRIGATÓRIO] lead que já trocou MENSAGEM NÃO é apagado por padrão — e é, quando a opção é ligada", async () => {
    const { repo, comMsg } = cenario();

    await run(repo, { expectedCount: 10 });
    for (const l of comMsg) expect(repo.store.leads.some((x) => x.id === l.id), l.id).toBe(true);

    const { repo: repo2, comMsg: comMsg2 } = cenario();
    const ligado = normalizeOptions({ includeWithMessages: true });
    const p = await view(repo2, { options: ligado });
    await run(repo2, { options: ligado, expectedCount: p.willDelete });
    expect(p.willDelete).toBe(12);
    for (const l of comMsg2) expect(repo2.store.leads.some((x) => x.id === l.id), l.id).toBe(false);
  });

  it("o lead com mensagem só pelo TELEFONE (formato diferente do cadastro) também é protegido", async () => {
    const lead = { ...makeLeads("A", 1)[0], telefone: "+5511977771111" };
    const repo = createMemoryMassDeleteRepo({
      leads: [lead],
      messages: [{ client_id: "A", lead_id: null, phone: "(11) 97777-1111" }],
    });

    const p = await view(repo);

    expect(p).toMatchObject({ matched: 1, withMessages: 1, willDelete: 0, kept: 1 });
  });

  it("mensagem de OUTRO cliente com o mesmo telefone não protege o lead deste", async () => {
    const lead = makeLeads("A", 1)[0];
    const repo = createMemoryMassDeleteRepo({
      leads: [lead],
      messages: [{ client_id: "B", lead_id: null, phone: lead.telefone }],
    });

    expect((await view(repo)).withMessages).toBe(0);
  });

  it("[TESTE OBRIGATÓRIO] apagados + mantidos = o total da prévia, e os motivos de quem fica somam os mantidos", async () => {
    const { repo } = cenario();
    const p = await view(repo);

    const outcome = await run(repo, { expectedCount: p.willDelete });

    expect(outcome.report.deleted + outcome.report.kept).toBe(p.matched);
    const r = outcome.report.keptReasons;
    expect(r.multiImport + r.withMessages + r.both).toBe(outcome.report.kept);
    expect(p.willDelete + p.kept).toBe(p.matched);
  });

  it("critério por IMPORTAÇÃO: o lead que lista outro identificador fica; o exato é apagado", async () => {
    const importId = "imp-1";
    const so = makeLeads("A", 3, { prefix: "i", fields: { tags: ["x"], import_ids: [importId] } });
    const dois = makeLeads("A", 1, { prefix: "d", offset: 100, fields: { tags: ["x"], import_ids: [importId, "imp-2"] } });
    const repo = createMemoryMassDeleteRepo({ leads: [...so, ...dois] });
    const criterion = { type: "import", value: importId };

    const p = await view(repo, { criterion });

    expect(p).toMatchObject({ matched: 4, multiImport: 1, willDelete: 3 });
  });

  it("tags do sistema (origem, venda fechada, classificação) NÃO contam como 'outra importação'", () => {
    const lead = { tags: [TAG, "Instagram Direct", "Orçamento", "Prioridade alta", "Cliente Histórico", "Facebook Ads"], import_ids: null };
    expect(hasOtherImport(lead, CRIT)).toBe(false);
    expect(hasOtherImport({ ...lead, tags: [TAG, "Outra Lista"] }, CRIT)).toBe(true);
    expect(hasOtherImport({ ...lead, import_ids: ["a", "b"] }, CRIT)).toBe(true); // dois identificadores
  });
});

describe("Confirmação por número digitado (acima de 500)", () => {
  const grande = (n) => {
    const leads = makeLeads("A", n);
    return createMemoryMassDeleteRepo({ leads });
  };

  it("o limite é 500: acima exige digitar, até 500 não", () => {
    expect(TYPED_CONFIRMATION_THRESHOLD).toBe(500);
    expect(requiresTypedConfirmation(500)).toBe(false);
    expect(requiresTypedConfirmation(501)).toBe(true);
    expect(requiresTypedConfirmation(20000)).toBe(true);
  });

  it("[TESTE OBRIGATÓRIO] 501 leads sem o número digitado: recusa NO SERVIDOR e nada é apagado", async () => {
    const repo = grande(501);

    const outcome = await run(repo, { expectedCount: 501 });

    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe(MASS_DELETE_ERRORS.CONFIRMATION_REQUIRED);
    expect(repo.store.leads).toHaveLength(501);
    expect(repo.calls.some((c) => c.op === "begin")).toBe(false);
  });

  it("número digitado errado: recusa; certo: apaga (aceita separador de milhar)", async () => {
    const repo = grande(501);
    expect((await run(repo, { expectedCount: 501, typedConfirmation: "500" })).ok).toBe(false);
    expect((await run(repo, { expectedCount: 501, typedConfirmation: "" })).ok).toBe(false);
    expect(repo.store.leads).toHaveLength(501);

    const ok = await run(repo, { expectedCount: 501, typedConfirmation: "501" });

    expect(ok.ok).toBe(true);
    expect(ok.report.deleted).toBe(501);
    const mil = grande(1200);
    expect((await run(mil, { expectedCount: 1200, typedConfirmation: "1.200" })).ok).toBe(true);
  });

  it("até 500 leads não exige digitar", async () => {
    const repo = grande(500);

    expect((await run(repo, { expectedCount: 500 })).ok).toBe(true);
  });

  it("a tela vê 'typedRequired' na prévia", async () => {
    expect((await view(grande(501))).confirmation).toEqual({ typedRequired: true, threshold: 500 });
    expect((await view(grande(5))).confirmation.typedRequired).toBe(false);
  });
});

describe("Depois: relatório e auditoria", () => {
  it("[TESTE OBRIGATÓRIO] o registro de auditoria é gravado com usuário, critério, quantidade e data", async () => {
    const { repo } = cenario();

    const outcome = await run(repo, { expectedCount: 10 });

    expect(repo.store.audit).toHaveLength(1);
    expect(repo.store.audit[0]).toMatchObject({
      clientId: "A",
      userUid: "uid-gestor",
      userEmail: "gestor@vexo.com",
      criterion: CRIT,
      options: NONE,
      matched: 16,
      expectedCount: 10,
      deleted: 10,
      kept: 6,
      keptMultiImport: 3,
      keptWithMessages: 2,
      keptBoth: 1,
    });
    expect(repo.store.audit[0].created_at).toBeTruthy();
    expect(outcome.report.audit).toMatchObject({ id: "audit-1", byEmail: "gestor@vexo.com" });
  });

  it("o relatório diz quantos apagou, quantos manteve e por qual motivo cada grupo (não 'pronto')", async () => {
    const { repo } = cenario();

    const { report } = await run(repo, { expectedCount: 10 });

    expect(report).toMatchObject({ matched: 16, deleted: 10, kept: 6, keptReasons: { multiImport: 3, withMessages: 2, both: 1 } });
  });

  it("[TESTE OBRIGATÓRIO] sem auditoria não há exclusão: se gravar o registro falhar, NADA é apagado (mesma transação)", async () => {
    const { repo } = cenario();
    repo.failNextAudit();

    await expect(run(repo, { expectedCount: 10 })).rejects.toThrow("auditoria");

    expect(repo.store.leads.filter((l) => l.client_id === "A")).toHaveLength(16);
    expect(repo.store.audit).toHaveLength(0);
    expect(repo.calls.filter((c) => c.op === "commit")).toHaveLength(0);
    expect(repo.calls.filter((c) => c.op === "rollback")).toHaveLength(1);
  });

  it("exclusão inconsistente (o banco apagou menos que o contado) desfaz tudo", async () => {
    const { repo } = cenario();
    repo.deleteShortBy(1);

    await expect(run(repo, { expectedCount: 10 })).rejects.toThrow("inconsistente");

    expect(repo.store.leads.filter((l) => l.client_id === "A")).toHaveLength(16);
    expect(repo.store.audit).toHaveLength(0);
  });
});

describe("Exportação: a planilha traz exatamente os leads que seriam apagados", () => {
  it("[TESTE OBRIGATÓRIO] mesma seleção da execução: nem mais, nem menos", async () => {
    const { repo, limpos, multi, comMsg } = cenario();

    const selection = await selectMassDeleteTargets(repo, poolOf(repo), { clientId: "A", criterion: CRIT, options: NONE });
    const csv = buildDeletableCsv(selection.deletable);

    for (const l of limpos) expect(csv, l.id).toContain(`"${l.id}"`);
    for (const l of [...multi, ...comMsg]) expect(csv, l.id).not.toContain(`"${l.id}"`);
    expect(csv.trim().split("\n")).toHaveLength(1 + 10); // cabeçalho + 10
    // e é o mesmo conjunto que a execução apaga
    const antes = new Set(repo.store.leads.map((l) => l.id));
    await run(repo, { expectedCount: 10 });
    const apagados = [...antes].filter((id) => !repo.store.leads.some((l) => l.id === id));
    expect(new Set(apagados)).toEqual(new Set(selection.deletable.map((l) => l.id)));
  });

  it("com as opções ligadas, a exportação acompanha (inclui o que será apagado a mais)", async () => {
    const { repo, multi } = cenario();
    const sel = await selectMassDeleteTargets(repo, poolOf(repo), { clientId: "A", criterion: CRIT, options: normalizeOptions({ includeMultiImport: true }) });

    const csv = buildDeletableCsv(sel.deletable);

    for (const l of multi) expect(csv).toContain(`"${l.id}"`);
  });

  it("protege contra injeção de fórmula em planilha e escapa aspas", () => {
    const csv = buildDeletableCsv([{ id: "1", nome: '=HYPERLINK("http://x")', telefone: "+55", tags: ['a"b'], stage: "cold", temperature: "warm", created_at: "2026-10-01" }]);

    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).toContain('"a""b"');
    expect(csv.startsWith("﻿")).toBe(true);
  });
});

describe("Tenancy: o critério de um cliente nunca alcança lead de outro", () => {
  it("[TESTE OBRIGATÓRIO] dois clientes com a MESMA tag: apagar no A não toca em nenhum lead do B", async () => {
    const { repo } = cenario(); // B tem 6 leads com a mesma tag

    const everything = normalizeOptions({ includeMultiImport: true, includeWithMessages: true });
    const p = await view(repo, { options: everything });
    await run(repo, { options: everything, expectedCount: p.willDelete });

    expect(repo.store.leads.filter((l) => l.client_id === "A")).toHaveLength(0);
    expect(repo.store.leads.filter((l) => l.client_id === "B")).toHaveLength(6);
    // todas as chamadas ao repositório carregaram o cliente A — nenhuma carregou o B
    const clientes = new Set(repo.calls.filter((c) => c.clientId).map((c) => c.clientId));
    expect(clientes).toEqual(new Set(["A"]));
  });

  it("a prévia do cliente A não conta os leads do B (nem a tag, nem as mensagens)", async () => {
    const { repo } = cenario();
    repo.store.messages.push(...makeLeads("B", 6, { offset: 9000 }).map((l) => ({ client_id: "B", lead_id: l.id, phone: l.telefone })));

    const a = await view(repo);
    const b = await view(repo, { clientId: "B" });

    expect(a.matched).toBe(16);
    expect(b.matched).toBe(6);
    expect(b.withMessages).toBe(6); // as mensagens de B só contam para B
    expect(a.withMessages).toBe(3);
  });

  it("critério por importação: o mesmo identificador em outro cliente não entra", async () => {
    const repo = createMemoryMassDeleteRepo({
      leads: [
        ...makeLeads("A", 2, { fields: { tags: ["x"], import_ids: ["imp-1"] } }),
        ...makeLeads("B", 5, { prefix: "b", fields: { tags: ["x"], import_ids: ["imp-1"] } }),
      ],
    });

    const p = await view(repo, { criterion: { type: "import", value: "imp-1" } });

    expect(p.matched).toBe(2);
  });

  it("[TESTE OBRIGATÓRIO] o SQL real: TODA consulta do repositório Postgres filtra por client_id = $1, com o cliente como 1º parâmetro", async () => {
    const repo = createPgMassDeleteRepo();
    const queries = [];
    const db = {
      query: vi.fn(async (sql, params) => {
        queries.push({ sql: String(sql), params });
        return { rows: [], rowCount: 0 };
      }),
    };

    await repo.listCandidates(db, "cliente-A", { type: "tag", value: "x" });
    await repo.listCandidates(db, "cliente-A", { type: "import", value: "imp" });
    await repo.listMessageKeys(db, "cliente-A");
    await repo.deleteLeads(db, "cliente-A", ["1", "2"]);
    await repo.listTags(db, "cliente-A");

    expect(queries.length).toBe(6);
    for (const q of queries) {
      expect(q.sql, q.sql).toMatch(/client_id\s*=\s*\$1/);
      expect(q.params[0]).toBe("cliente-A");
    }
    // a exclusão não aceita ids soltos: sempre amarrada ao cliente
    const del = queries.find((q) => q.sql.includes("DELETE FROM public.leads"));
    expect(del.sql).toMatch(/WHERE client_id = \$1 AND id = ANY/);
  });
});

describe("classifyTargets é uma função pura", () => {
  it("não altera os candidatos recebidos", () => {
    const candidates = makeLeads("A", 3);
    const copia = JSON.stringify(candidates);

    classifyTargets({ candidates, messageKeys: { leadIds: new Set(), phones: new Set() }, criterion: CRIT, options: NONE });

    expect(JSON.stringify(candidates)).toBe(copia);
  });
});
