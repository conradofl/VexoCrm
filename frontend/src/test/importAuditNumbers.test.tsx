// src/test/importAuditNumbers.test.tsx
//
// Relatório & Auditoria: cada número diz o que CONTA (linhas do arquivo, contatos válidos, linhas descartadas;
// receberam, falharam, ainda vão receber) e a soma fecha. Linha sem telefone válido tem estado próprio — nunca
// aparece como "pendente" (pendente é quem ainda vai receber). Campanha do caminho legado mostra o aviso de
// acompanhamento indisponível.

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { computeImportAuditStats, legacyTrackingNotice, DELIVERY_STATE_LABELS, type ImportAuditRow } from "../lib/importAudit";
import auditSrc from "../pages/LeadImports/LeadImportAuditReport.tsx?raw";

const getIdTokenMock = async () => "token";
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ getIdToken: getIdTokenMock }) }));
vi.mock("@/components/ui/use-toast", () => ({ toast: vi.fn() }));

const row = (over: Partial<ImportAuditRow> = {}): ImportAuditRow => ({
  imported: true,
  delivery_state: "pendente",
  duplicate_of_row: null,
  has_replied: false,
  skip_reason: null,
  ...over,
});

// 11 linhas: 6 contatos válidos (2 receberam — 1 por esta planilha e 1 por outra —, 1 falhou, 3 pendentes),
// 2 repetidas, 3 descartadas (2 sem telefone, 1 telefone inválido)
const MIXED: ImportAuditRow[] = [
  row({ delivery_state: "enviado_por_esta_planilha", has_replied: true }),
  row({ delivery_state: "enviado_por_outra_campanha" }),
  row({ delivery_state: "falhou" }),
  row(),
  row(),
  row(),
  row({ delivery_state: "enviado_por_esta_planilha", duplicate_of_row: 1 }),
  row({ delivery_state: "enviado_por_outra_campanha", duplicate_of_row: 2 }),
  row({ imported: false, delivery_state: "sem_telefone_valido", skip_reason: "Telefone ausente ou invalido" }),
  row({ imported: false, delivery_state: "sem_telefone_valido", skip_reason: "Telefone ausente ou invalido" }),
  row({ imported: false, delivery_state: "sem_telefone_valido", skip_reason: "Telefone incompleto (faltou DDD)" }),
];

describe("computeImportAuditStats", () => {
  it("[TESTE OBRIGATÓRIO] os três números do arquivo, cada um pelo que conta: linhas, contatos válidos, descartadas (e as repetidas que fecham a soma)", () => {
    const s = computeImportAuditStats(MIXED);

    expect(s.fileRows).toBe(11);
    expect(s.validContacts).toBe(6);
    expect(s.discardedRows).toBe(3);
    expect(s.repeatedRows).toBe(2);
  });

  it("[TESTE OBRIGATÓRIO] a soma fecha: linhas = contatos + repetidas + descartadas; contatos = receberam + falharam + ainda vão receber", () => {
    const s = computeImportAuditStats(MIXED);

    expect(s.fileRows).toBe(s.validContacts + s.repeatedRows + s.discardedRows);
    expect(s.fileCloses).toBe(true);
    expect(s.validContacts).toBe(s.received + s.failed + s.pending);
    expect(s.contactsClose).toBe(true);
    expect([s.received, s.receivedByThisImport, s.receivedByOther, s.failed, s.pending]).toEqual([2, 1, 1, 1, 3]);
  });

  it("[TESTE OBRIGATÓRIO] linha sem telefone válido NÃO é pendente: vai para descartadas, com o motivo, e não entra em 'ainda vão receber'", () => {
    const s = computeImportAuditStats([row({ imported: false, delivery_state: "sem_telefone_valido", skip_reason: "Telefone ausente ou invalido" }), row()]);

    expect(s.pending).toBe(1); // só a linha que ainda vai receber
    expect(s.discardedRows).toBe(1);
    expect(s.discardedByReason).toEqual([{ reason: "Telefone ausente ou invalido", count: 1 }]);
  });

  it("linha importada mas sem telefone utilizável também é descartada (nunca pendente)", () => {
    const s = computeImportAuditStats([row({ delivery_state: "sem_telefone_valido" })]);
    expect(s.discardedRows).toBe(1);
    expect(s.pending).toBe(0);
    expect(s.discardedByReason[0].reason).toBe("Telefone ausente ou inválido");
  });

  it("telefone repetido conta UMA vez como contato (a repetida não infla receberam nem pendentes)", () => {
    const s = computeImportAuditStats([row({ delivery_state: "enviado_por_esta_planilha" }), row({ delivery_state: "enviado_por_esta_planilha", duplicate_of_row: 1 })]);

    expect(s.fileRows).toBe(2);
    expect(s.validContacts).toBe(1);
    expect(s.received).toBe(1);
    expect(s.repeatedRows).toBe(1);
  });

  it("motivos de descarte agrupados e ordenados; retorno conta só contatos", () => {
    const s = computeImportAuditStats(MIXED);
    expect(s.discardedByReason).toEqual([
      { reason: "Telefone ausente ou invalido", count: 2 },
      { reason: "Telefone incompleto (faltou DDD)", count: 1 },
    ]);
    expect(s.replied).toBe(1);
  });

  it("planilha vazia: tudo zero e fecha", () => {
    const s = computeImportAuditStats([]);
    expect([s.fileRows, s.validContacts, s.discardedRows, s.received, s.failed, s.pending]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(s.fileCloses && s.contactsClose).toBe(true);
  });
});

describe("estados de linha", () => {
  it("cada estado tem rótulo próprio; 'sem telefone válido' nunca se confunde com 'ainda vai receber'", () => {
    expect(Object.keys(DELIVERY_STATE_LABELS).sort()).toEqual(["enviado_por_esta_planilha", "enviado_por_outra_campanha", "falhou", "pendente", "sem_telefone_valido"]);
    expect(DELIVERY_STATE_LABELS.sem_telefone_valido).not.toBe(DELIVERY_STATE_LABELS.pendente);
    expect(DELIVERY_STATE_LABELS.pendente).toBe("Ainda vai receber");
    expect(DELIVERY_STATE_LABELS.enviado_por_esta_planilha).toContain("desta planilha");
    expect(DELIVERY_STATE_LABELS.enviado_por_outra_campanha).toContain("outra campanha");
  });
});

describe("legacyTrackingNotice", () => {
  it("[TESTE OBRIGATÓRIO] sem campanha legada: nenhum aviso", () => {
    expect(legacyTrackingNotice([])).toBeNull();
  });

  it("[TESTE OBRIGATÓRIO] com campanha legada: diz que o acompanhamento está indisponível, quais campanhas, e que o contato pode ter recebido", () => {
    const texto = legacyTrackingNotice([{ id: "c1", name: "Black Friday" }])!;
    expect(texto).toContain("Acompanhamento indisponível");
    expect(texto).toContain('"Black Friday"');
    expect(texto).toContain("caminho antigo");
    expect(texto).toContain("podem ter recebido");
    expect(legacyTrackingNotice([{ id: "a", name: "A" }, { id: "b", name: "B" }])).toContain("as campanhas");
  });
});

// ── a tela ──────────────────────────────────────────────────────────────────────────────────────────
const IMPORT = { id: "import-1", source_name: "Planilha A", imported_rows: 6, skipped_rows: 5, created_at: "2026-09-01T00:00:00Z", source_type: "upload" };

const server = (items: any[], legacy: any[] = []) => {
  global.fetch = vi.fn(async () => ({
    ok: true,
    headers: { get: () => "application/json" },
    json: async () => ({ import: { id: "import-1", source_name: "Planilha A", created_at: "2026-09-01T00:00:00Z", total_rows: items.length }, items, legacy_dispatch_campaigns: legacy }),
  })) as any;
};

const asItems = (rows: ImportAuditRow[]) =>
  rows.map((r, i) => ({
    lead_import_item_id: `it-${i + 1}`,
    import_id: "import-1",
    telefone: r.imported ? `5534910000${String(i + 1).padStart(3, "0")}` : "",
    normalized_data: { nome: `Lead ${i + 1}` },
    imported_at: "2026-09-01T00:00:00Z",
    row_number: i + 1,
    dispatch_count: 0,
    last_sent_at: null,
    last_attempt_at: null,
    last_status: null,
    last_error_message: null,
    failure_reason: r.imported ? (r.delivery_state === "falhou" ? "Número inválido" : null) : r.skip_reason || "Motivo não registrado",
    ...r,
  }));

async function renderReport(items: any[], legacy: any[] = []) {
  server(items, legacy);
  const { LeadImportAuditReport } = await import("@/pages/LeadImports/LeadImportAuditReport");
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LeadImportAuditReport activeClientId="sonhare" imports={[IMPORT]} onSelectImportForFollowup={vi.fn()} />
    </QueryClientProvider>
  );
  await screen.findByTestId("stat-file-rows");
}
const valor = (id: string) => screen.getByTestId(`${id}-value`).textContent;
const norm = (el: HTMLElement) => (el.textContent || "").replace(/\s+/g, " ").trim();

describe("tela: os números rotulados pelo que contam", () => {
  it("[TESTE OBRIGATÓRIO] mostra linhas do arquivo, contatos válidos e linhas descartadas, cada um com o seu rótulo — e a soma fecha na própria tela", async () => {
    await renderReport(asItems(MIXED));

    expect(screen.getByText("Linhas do arquivo")).toBeTruthy();
    expect(screen.getByText("Contatos válidos (telefones únicos)")).toBeTruthy();
    expect(screen.getByText("Linhas descartadas")).toBeTruthy();
    expect([valor("stat-file-rows"), valor("stat-valid-contacts"), valor("stat-discarded-rows")]).toEqual(["11", "6", "3"]);
    expect(norm(screen.getByTestId("audit-file-sum"))).toContain("11 linhas = 6 contatos válidos + 2 repetidas (mesmo telefone de outra linha) + 3 descartadas");
  });

  it("[TESTE OBRIGATÓRIO] as linhas descartadas aparecem com o motivo (quantas de cada)", async () => {
    await renderReport(asItems(MIXED));

    const motivos = norm(screen.getByTestId("audit-discard-reasons"));
    expect(motivos).toContain("2 × Telefone ausente ou invalido");
    expect(motivos).toContain("1 × Telefone incompleto (faltou DDD)");
  });

  it("[TESTE OBRIGATÓRIO] os números dos contatos: receberam (por esta planilha + por outra), falharam, ainda vão receber — e a soma fecha", async () => {
    await renderReport(asItems(MIXED));

    expect([valor("stat-received"), valor("stat-failed"), valor("stat-pending"), valor("stat-replied")]).toEqual(["2", "1", "3", "1"]);
    expect(norm(screen.getByTestId("audit-contact-sum"))).toContain("6 contatos = 2 receberam (1 por campanha desta planilha + 1 por outra campanha) + 1 falharam + 3 ainda vão receber");
  });

  it("[TESTE OBRIGATÓRIO] a tela diz o que 'receberam' significa: o telefone recebeu mensagem, não 'esta planilha disparou'", async () => {
    await renderReport(asItems(MIXED));

    const nota = norm(screen.getByTestId("audit-meaning-note"));
    expect(nota).toContain("telefones que receberam mensagem de qualquer campanha");
    expect(nota).toContain("não quer dizer que esta planilha disparou");
    expect(nota).toContain("duas planilhas");
  });

  it("[TESTE OBRIGATÓRIO] linha sem telefone válido aparece como 'Sem telefone válido' — nunca como pendente; pendente só quem ainda vai receber", async () => {
    await renderReport(asItems(MIXED));

    for (const n of [9, 10, 11]) expect(screen.getByTestId(`row-state-${n}`).textContent).toBe("Sem telefone válido");
    for (const n of [4, 5, 6]) expect(screen.getByTestId(`row-state-${n}`).textContent).toBe("Ainda vai receber");
    expect(screen.getByTestId("row-state-1").textContent).toBe("Recebeu (campanha desta planilha)");
    expect(screen.getByTestId("row-state-2").textContent).toBe("Recebeu (outra campanha)");
    expect(screen.getByTestId("row-state-3").textContent).toBe("Falhou");
  });

  it("linha repetida diz qual linha repete, e não é marcada como falha", async () => {
    await renderReport(asItems(MIXED));

    expect(screen.getByTestId("row-repeated-7").textContent).toBe("Repete a linha 1");
    expect(screen.getByTestId("row-repeated-8").textContent).toBe("Repete a linha 2");
    expect(screen.queryByTestId("row-repeated-1")).toBeNull();
  });

  it("o código da tela não conta mais 'enviados' por last_status === 'sent' nem 'pendentes' por ausência de status", () => {
    expect(auditSrc).not.toMatch(/last_status === "sent"/);
    expect(auditSrc).not.toMatch(/!i\.last_status \|\|/);
    expect(auditSrc).not.toContain('label="Total de leads"');
  });
});

describe("tela: caminho legado", () => {
  it("[TESTE OBRIGATÓRIO] campanha do caminho legado: mostra o aviso de acompanhamento indisponível, com o nome da campanha", async () => {
    await renderReport(asItems(MIXED), [{ id: "camp-1", name: "Black Friday", status: "sent", last_triggered_at: "2026-10-02T10:00:00Z" }]);

    const aviso = screen.getByTestId("audit-legacy-notice");
    expect(aviso.textContent).toContain("Acompanhamento indisponível");
    expect(aviso.textContent).toContain('"Black Friday"');
  });

  it("[TESTE OBRIGATÓRIO] sem campanha legada, não há aviso nenhum", async () => {
    await renderReport(asItems(MIXED), []);
    expect(screen.queryByTestId("audit-legacy-notice")).toBeNull();
  });
});
