// O hook useCreateLeadImport de ponta a ponta (com o fetch real simulado): abre, manda os lotes, fecha; e, se um lote for recusado,
// o erro carrega a importação que ficou incompleta e a lista de planilhas é recarregada.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ImportBatchError } from "@/lib/leadImports/batchedImport";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ getIdToken: async () => "token", isAuthenticated: true, canAccessView: () => true }),
}));

import { useCreateBancoImport, useCreateLeadImport, useResumeLeadImport } from "@/hooks/useLeadImports";

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, headers: new Headers({ "content-type": "application/json" }), json: async () => body, text: async () => JSON.stringify(body) });
const planilha = (n: number) => Array.from({ length: n }, (_, i) => ({ Nome: `P${i}`, Telefone: `(34) 9${String(80000000 + i).padStart(8, "0")}` }));

let chamadas: Array<{ url: string; method: string; body: any }>;
let qc: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

beforeEach(() => {
  chamadas = [];
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function instalarFetch(resposta: (path: string, body: any, n: number) => ReturnType<typeof json>) {
  let n = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url, "http://localhost").pathname;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    chamadas.push({ url: path, method: init.method || "GET", body });
    n += 1;
    return resposta(path, body, n);
  }));
}

describe("useCreateLeadImport (envio em lotes pelo hook)", () => {
  it("mesma assinatura de sempre: mutateAsync(payload) → { item, preview, warnings }, agora com totals, e o progresso chega ao chamador", async () => {
    instalarFetch((path, body) => {
      if (path.endsWith("/open")) return json(201, { item: { id: "imp-1", status: "incomplete" }, warnings: [{ message: "aviso" }], batchSize: 500 });
      if (path.endsWith("/batches")) return json(200, { receivedOffset: body.startIndex + body.rows.length, expectedRows: 1200 });
      return json(200, { item: { id: "imp-1", status: "completed", imported_rows: 1080 }, preview: [{ rowNumber: 2 }], totals: { total: 1200, valid: 1080, intact: 0, completedWithDdd: 1080, withoutPhone: 120, uniquePhones: 1080 } });
    });
    const { result } = renderHook(() => useCreateLeadImport(), { wrapper });
    const progresso: string[] = [];

    let resposta: any;
    await act(async () => {
      resposta = await result.current.mutateAsync({ clientId: "t", sourceName: "p.xlsx", sourceType: "xlsx", rows: planilha(1_200), onProgress: (p) => progresso.push(`${p.phase}:${p.sentRows}`) });
    });

    expect(chamadas.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST /api/lead-imports/open",
      "POST /api/lead-imports/imp-1/batches",
      "POST /api/lead-imports/imp-1/batches",
      "POST /api/lead-imports/imp-1/batches",
      "POST /api/lead-imports/imp-1/close",
    ]);
    expect(chamadas.slice(1, 4).map((c) => [c.body.startIndex, c.body.rows.length])).toEqual([[0, 500], [500, 500], [1000, 200]]);
    expect(resposta.item.status).toBe("completed");
    expect(resposta.totals.withoutPhone).toBe(120);
    expect(resposta.warnings).toHaveLength(1);
    expect(progresso[0]).toBe("opening:0");
    expect(progresso[progresso.length - 1]).toBe("done:1200");
  });

  it("[TESTE OBRIGATÓRIO] lote recusado no meio: erro com a importação INCOMPLETA e o ponto, e a lista de planilhas é recarregada", async () => {
    instalarFetch((path, body) => {
      if (path.endsWith("/open")) return json(201, { item: { id: "imp-9" }, warnings: [] });
      if (path.endsWith("/batches")) {
        if (body.startIndex === 500) return json(409, { error: { code: "IMPORT_FILE_MISMATCH", message: "O arquivo enviado não é o mesmo da importação aberta" } });
        return json(200, { receivedOffset: body.startIndex + body.rows.length, expectedRows: 1500 });
      }
      throw new Error("não devia fechar");
    });
    const invalidar = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreateLeadImport(), { wrapper });

    let erro: any;
    await act(async () => {
      erro = await result.current.mutateAsync({ clientId: "t", sourceName: "p.xlsx", sourceType: "xlsx", rows: planilha(1_500) }).catch((e: unknown) => e);
    });

    expect(erro).toBeInstanceOf(ImportBatchError);
    expect(erro).toMatchObject({ importId: "imp-9", receivedOffset: 500, totalRows: 1_500, status: 409, code: "IMPORT_FILE_MISMATCH" });
    expect(erro.message).toMatch(/não é o mesmo/);
    expect(chamadas.some((c) => c.url.endsWith("/close"))).toBe(false);
    await waitFor(() => expect(invalidar).toHaveBeenCalledWith({ queryKey: ["lead-imports", "t"] })); // a lista mostra a incompleta
  });
});

describe("useResumeLeadImport", () => {
  it("lê o progresso e manda só o que falta", async () => {
    const rows = planilha(1_200);
    const { fingerprintRows } = await import("@/lib/leadImports/batchedImport");
    instalarFetch((path, body) => {
      if (path.endsWith("/progress")) return json(200, { importId: "imp-1", status: "incomplete", expectedRows: 1200, receivedOffset: 500, missingRows: 700, storedItems: 500, fingerprint: fingerprintRows(rows), batchSize: 500 });
      if (path.endsWith("/batches")) return json(200, { receivedOffset: body.startIndex + body.rows.length, expectedRows: 1200 });
      return json(200, { item: { id: "imp-1", status: "completed" }, preview: [], totals: { total: 1200, valid: 1200, intact: 0, completedWithDdd: 1200, withoutPhone: 0, uniquePhones: 1200 } });
    });
    const { result } = renderHook(() => useResumeLeadImport(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ clientId: "t", importId: "imp-1", rows });
    });

    expect(chamadas.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /api/lead-imports/imp-1/progress",
      "POST /api/lead-imports/imp-1/batches",
      "POST /api/lead-imports/imp-1/batches",
      "POST /api/lead-imports/imp-1/close",
    ]);
    expect(chamadas[1].body.startIndex).toBe(500);
  });
});

describe("useCreateBancoImport (importação do Banco de Dados em lotes)", () => {
  it("[TESTE OBRIGATÓRIO] usa as rotas do BANCO, manda o NOME DO ARQUIVO, as tags e vendas fechadas, e envia em lotes de 500", async () => {
    instalarFetch((path, body) => {
      if (path.endsWith("/open")) return json(201, { item: { id: "imp-b" }, warnings: [] });
      if (path.endsWith("/batches")) return json(200, { receivedOffset: body.startIndex + body.rows.length, expectedRows: 1200 });
      return json(200, { item: { id: "imp-b", status: "completed" }, preview: [], totals: { total: 1200, valid: 1080, intact: 0, completedWithDdd: 1080, withoutPhone: 120, uniquePhones: 1080 } });
    });
    const { result } = renderHook(() => useCreateBancoImport(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        clientId: "t", sourceName: "clientes-2026.xlsx", sourceType: "xlsx", rows: planilha(1_200), defaultDdd: "34",
        importTags: ["Feira 2026"], asClosedSales: true,
      });
    });
    expect(chamadas.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST /api/leads/import-batches/open",
      "POST /api/leads/import-batches/imp-b/batches",
      "POST /api/leads/import-batches/imp-b/batches",
      "POST /api/leads/import-batches/imp-b/batches",
      "POST /api/leads/import-batches/imp-b/close",
    ]);
    expect(chamadas[0].body).toMatchObject({ clientId: "t", sourceName: "clientes-2026.xlsx", sourceType: "xlsx", totalRows: 1200, importTags: ["Feira 2026"], asClosedSales: true, defaultDdd: "34" });
    expect(chamadas.slice(1, 4).map((c) => c.body.rows.length)).toEqual([500, 500, 200]);
    expect(chamadas.some((c) => c.url.startsWith("/api/lead-imports"))).toBe(false); // nunca as rotas da tela de Planilhas
  });

  it("sem tags nem vendas fechadas a abertura não leva esses campos", async () => {
    instalarFetch((path, body) => {
      if (path.endsWith("/open")) return json(201, { item: { id: "imp-c" }, warnings: [] });
      if (path.endsWith("/batches")) return json(200, { receivedOffset: body.startIndex + body.rows.length, expectedRows: 3 });
      return json(200, { item: { id: "imp-c" }, preview: [], totals: { total: 3, valid: 3, intact: 3, completedWithDdd: 0, withoutPhone: 0, uniquePhones: 3 } });
    });
    const { result } = renderHook(() => useCreateBancoImport(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ clientId: "t", sourceName: "a.csv", sourceType: "csv", rows: planilha(3) });
    });
    expect(chamadas[0].body.importTags).toBeUndefined();
    expect(chamadas[0].body.asClosedSales).toBeUndefined();
  });

  it("lote recusado no meio: ImportBatchError com a importação incompleta e o ponto (a tela mostra 'entraram N de M')", async () => {
    instalarFetch((path, body) => {
      if (path.endsWith("/open")) return json(201, { item: { id: "imp-d" }, warnings: [] });
      if (body.startIndex === 500) return json(400, { error: { code: "INVALID_BODY", message: "lote inválido" } });
      return json(200, { receivedOffset: body.startIndex + body.rows.length, expectedRows: 1000 });
    });
    const { result } = renderHook(() => useCreateBancoImport(), { wrapper });
    let erro: any;
    await act(async () => {
      try {
        await result.current.mutateAsync({ clientId: "t", sourceName: "a.xlsx", sourceType: "xlsx", rows: planilha(1_000) });
      } catch (e) {
        erro = e;
      }
    });
    expect(erro).toBeInstanceOf(ImportBatchError);
    expect(erro.importId).toBe("imp-d");
    expect(erro.receivedOffset).toBe(500);
    expect(erro.totalRows).toBe(1000);
  });
});
