// Fluxo da importação em lotes (lib/leadImports/batchedImport.ts), sem rede: um servidor falso que guarda o que recebeu e é
// idempotente por posição, como o de verdade (backend/src/services/leadImportBatches.js).
import { describe, expect, it, vi } from "vitest";
import backendSource from "../../../backend/src/services/leadImportBatches.js?raw";
import {
  IMPORT_BATCH_SIZE,
  ImportBatchError,
  ImportFileMismatchError,
  fingerprintRows,
  resumeBatchedImport,
  runBatchedImport,
  type ImportProgress,
  type ImportTransport,
} from "@/lib/leadImports/batchedImport";

const planilha = (n: number) => Array.from({ length: n }, (_, i) => ({ Nome: `Pessoa ${i}`, Telefone: `(34) 9${String(80000000 + i).padStart(8, "0")}` }));
const PAYLOAD = (rows: Record<string, unknown>[]) => ({ clientId: "t", sourceName: "p.xlsx", sourceType: "xlsx", rows, defaultDdd: "34", columnMapping: { columns: ["Nome", "Telefone"], mapping: [] } });
const semEspera = async () => {};

/** Servidor falso: guarda as posições recebidas (reenvio não duplica), responde como a API. `falhas` decide, por chamada, se falha. */
function servidorFalso(opts: { falhaNoLote?: (startIndex: number, tentativa: number) => { status?: number; message?: string } | null; fingerprint?: string | null; expected?: number } = {}) {
  const recebidas = new Set<number>();
  const chamadas: Array<{ path: string; body?: any }> = [];
  const tentativasPorLote = new Map<number, number>();
  let receivedOffset = 0;
  let expected = opts.expected ?? 0;
  let fingerprint = opts.fingerprint ?? null;
  let fechada = false;
  const politica = { falhaNoLote: opts.falhaNoLote }; // mutável: o teste "conserta" o servidor antes de retomar
  const transport: ImportTransport = {
    async postJson(path: string, body: any) {
      chamadas.push({ path, body });
      if (path === "/api/lead-imports/open") {
        expected = body.totalRows;
        fingerprint = body.fingerprint;
        return { item: { id: "imp-1" }, warnings: [{ message: "aviso" }], batchSize: 500 } as any;
      }
      if (path.endsWith("/batches")) {
        const n = (tentativasPorLote.get(body.startIndex) ?? 0) + 1;
        tentativasPorLote.set(body.startIndex, n);
        const falha = politica.falhaNoLote?.(body.startIndex, n);
        if (falha) throw Object.assign(new Error(falha.message || "falha"), { status: falha.status });
        for (let i = 0; i < body.rows.length; i += 1) recebidas.add(body.startIndex + i);
        receivedOffset = Math.max(receivedOffset, body.startIndex + body.rows.length);
        return { receivedOffset, expectedRows: expected } as any;
      }
      if (path.endsWith("/close")) {
        fechada = true;
        return { item: { id: "imp-1", status: "completed" }, preview: [{ rowNumber: 2 }], totals: { total: recebidas.size, valid: recebidas.size, intact: 0, completedWithDdd: recebidas.size, withoutPhone: 0, uniquePhones: recebidas.size } } as any;
      }
      throw new Error("rota inesperada " + path);
    },
    async getJson(path: string) {
      chamadas.push({ path });
      return { importId: "imp-1", status: fechada ? "completed" : "incomplete", expectedRows: expected, receivedOffset, missingRows: expected - receivedOffset, storedItems: recebidas.size, fingerprint, batchSize: 500 } as any;
    },
  };
  return { transport, recebidas, chamadas, tentativasPorLote, politica, get receivedOffset() { return receivedOffset; } };
}

describe("[TESTE OBRIGATÓRIO] a tela envia a planilha em lotes de 500, em sequência, mostrando progresso", () => {
  it("20.000 linhas: abre uma vez, manda 40 lotes de 500 em ordem, fecha uma vez; o servidor recebe todas as posições", async () => {
    const srv = servidorFalso();
    const progresso: ImportProgress[] = [];

    const r = await runBatchedImport(PAYLOAD(planilha(20_000)), { transport: srv.transport, onProgress: (p) => progresso.push(p), sleep: semEspera });

    const lotes = srv.chamadas.filter((c) => c.path.endsWith("/batches"));
    expect(srv.chamadas[0].path).toBe("/api/lead-imports/open");
    expect(srv.chamadas.filter((c) => c.path.endsWith("/close"))).toHaveLength(1);
    expect(lotes).toHaveLength(40);
    expect(lotes.map((l) => l.body.startIndex)).toEqual(Array.from({ length: 40 }, (_, i) => i * 500));
    for (const l of lotes) expect(l.body.rows.length).toBeLessThanOrEqual(IMPORT_BATCH_SIZE);
    expect(srv.recebidas.size).toBe(20_000);
    expect(r.totals.total).toBe(20_000);
    expect(r.warnings).toHaveLength(1); // os avisos da abertura chegam ao resultado
    // progresso: começa abrindo, avança lote a lote, termina em 100%
    expect(progresso[0]).toMatchObject({ phase: "opening", totalRows: 20_000 });
    const envio = progresso.filter((p) => p.phase === "sending");
    expect(envio[envio.length - 1]).toMatchObject({ sentRows: 20_000, batch: 40, batches: 40 });
    expect(envio.map((p) => p.sentRows)).toEqual([...envio.map((p) => p.sentRows)].sort((a, b) => a - b)); // nunca anda para trás
    expect(progresso[progresso.length - 1]).toMatchObject({ phase: "done", sentRows: 20_000 });
  });

  it("a abertura leva o total esperado, uma amostra para o mapeamento automático e a impressão digital do arquivo", async () => {
    const srv = servidorFalso();
    const rows = planilha(1_200);

    await runBatchedImport(PAYLOAD(rows), { transport: srv.transport, sleep: semEspera });

    const abertura = srv.chamadas[0].body;
    expect(abertura).toMatchObject({ clientId: "t", totalRows: 1_200, defaultDdd: "34", fingerprint: fingerprintRows(rows) });
    expect(abertura.sampleRows).toHaveLength(15);
    expect(abertura.rows).toBeUndefined(); // a abertura NÃO leva linha nenhuma
  });

  it("o tamanho do lote da tela é o do servidor (o servidor recusa lote maior)", () => {
    const m = backendSource.match(/export const IMPORT_BATCH_SIZE = (\d+);/);
    expect(Number(m?.[1])).toBe(IMPORT_BATCH_SIZE);
  });
});

describe("[TESTE OBRIGATÓRIO] falha no meio", () => {
  it("o lote 15 de 40 não passa (erro 400): para ali, e o erro diz o que entrou e qual importação ficou aberta", async () => {
    const srv = servidorFalso({ falhaNoLote: (inicio) => (inicio === 7_000 ? { status: 400, message: "lote inválido" } : null) });

    const erro = await runBatchedImport(PAYLOAD(planilha(20_000)), { transport: srv.transport, sleep: semEspera }).catch((e) => e);

    expect(erro).toBeInstanceOf(ImportBatchError);
    expect(erro).toMatchObject({ importId: "imp-1", receivedOffset: 7_000, totalRows: 20_000, status: 400 });
    expect(srv.chamadas.filter((c) => c.path.endsWith("/close"))).toHaveLength(0); // nunca fechou: nada pela metade com cara de completa
    expect(srv.chamadas.filter((c) => c.path.endsWith("/batches"))).toHaveLength(15); // 14 aceitos + o que falhou, e nenhum depois
    expect(srv.tentativasPorLote.get(7_000)).toBe(1); // 4xx não se repete
  });

  it("queda de rede ou 5xx: o MESMO lote é reenviado (seguro, o servidor é idempotente) e o envio continua", async () => {
    const srv = servidorFalso({ falhaNoLote: (inicio, tentativa) => (inicio === 7_000 && tentativa <= 2 ? { status: tentativa === 1 ? undefined : 503, message: "caiu" } : null) });
    const espera = vi.fn(async (_ms: number) => {});

    const r = await runBatchedImport(PAYLOAD(planilha(20_000)), { transport: srv.transport, sleep: espera });

    expect(srv.tentativasPorLote.get(7_000)).toBe(3); // falhou 2 vezes, passou na 3ª
    expect(espera.mock.calls.map((c) => c[0])).toEqual([500, 1500]); // espera crescente entre tentativas
    expect(srv.recebidas.size).toBe(20_000);
    expect(r.totals.total).toBe(20_000);
  });

  it("depois de esgotar as tentativas desiste com ImportBatchError (e o último ponto CONFIRMADO)", async () => {
    const srv = servidorFalso({ falhaNoLote: (inicio) => (inicio === 1_000 ? { status: 503, message: "fora do ar" } : null) });

    const erro = await runBatchedImport(PAYLOAD(planilha(5_000)), { transport: srv.transport, retries: 3, sleep: semEspera }).catch((e) => e);

    expect(erro).toBeInstanceOf(ImportBatchError);
    expect(erro).toMatchObject({ importId: "imp-1", receivedOffset: 1_000, totalRows: 5_000 });
    expect(srv.tentativasPorLote.get(1_000)).toBe(4); // 1 + 3 tentativas
  });

  it("falha ao ABRIR: não há importação criada (importId nulo) e nenhum lote sai", async () => {
    const transport: ImportTransport = { postJson: vi.fn().mockRejectedValue(Object.assign(new Error("sem acesso"), { status: 403 })), getJson: vi.fn() };

    const erro = await runBatchedImport(PAYLOAD(planilha(10)), { transport, sleep: semEspera }).catch((e) => e);

    expect(erro).toBeInstanceOf(ImportBatchError);
    expect(erro).toMatchObject({ importId: null, receivedOffset: null, status: 403 });
    expect(transport.postJson).toHaveBeenCalledTimes(1);
  });

  it("falha ao FECHAR depois de todos os lotes: a importação segue incompleta, com o ponto certo", async () => {
    const srv = servidorFalso();
    const original = srv.transport.postJson.bind(srv.transport);
    srv.transport.postJson = (async (path: string, body: unknown) => {
      if (path.endsWith("/close")) throw Object.assign(new Error("timeout"), { status: 504 });
      return original(path, body);
    }) as ImportTransport["postJson"];

    const erro = await runBatchedImport(PAYLOAD(planilha(1_000)), { transport: srv.transport, sleep: semEspera }).catch((e) => e);

    expect(erro).toBeInstanceOf(ImportBatchError);
    expect(erro).toMatchObject({ importId: "imp-1", receivedOffset: 1_000 });
  });
});

describe("[TESTE OBRIGATÓRIO] retomar de onde parou", () => {
  it("manda só o que falta, a partir do ponto que o SERVIDOR confirmou, e fecha", async () => {
    const rows = planilha(20_000);
    const srv = servidorFalso({ falhaNoLote: (inicio) => (inicio === 7_000 ? { status: 400 } : null) });
    await runBatchedImport(PAYLOAD(rows), { transport: srv.transport, sleep: semEspera }).catch(() => null);
    expect(srv.receivedOffset).toBe(7_000); // a queda deixou 14 lotes no servidor
    srv.politica.falhaNoLote = undefined; // o servidor volta a aceitar
    srv.chamadas.length = 0;
    const progresso: ImportProgress[] = [];

    const r = await resumeBatchedImport("imp-1", rows, { transport: srv.transport, onProgress: (p) => progresso.push(p), sleep: semEspera });

    const lotes = srv.chamadas.filter((c) => c.path.endsWith("/batches"));
    expect(lotes[0].body.startIndex).toBe(7_000); // não reenvia o que já entrou
    expect(lotes).toHaveLength(26); // 13.000 linhas faltantes ÷ 500
    expect(srv.recebidas.size).toBe(20_000);
    expect(r.totals.total).toBe(20_000);
    expect(progresso.find((p) => p.phase === "sending")).toMatchObject({ sentRows: 7_000, batches: 26 });
  });

  it("[TESTE OBRIGATÓRIO] arquivo DIFERENTE do original é recusado antes de enviar qualquer lote", async () => {
    const original = planilha(2_000);
    const srv = servidorFalso({ fingerprint: fingerprintRows(original), expected: 2_000 });

    const outroArquivo = planilha(2_000).map((r, i) => (i === 1_999 ? { ...r, Nome: "outra pessoa" } : r));
    const erro = await resumeBatchedImport("imp-1", outroArquivo, { transport: srv.transport, sleep: semEspera }).catch((e) => e);

    expect(erro).toBeInstanceOf(ImportFileMismatchError);
    expect(srv.chamadas.some((c) => c.path.endsWith("/batches"))).toBe(false);
  });

  it("arquivo com outro número de linhas é recusado, mesmo sem impressão digital guardada", async () => {
    const srv = servidorFalso({ fingerprint: null, expected: 2_000 });

    const erro = await resumeBatchedImport("imp-1", planilha(1_999), { transport: srv.transport, sleep: semEspera }).catch((e) => e);

    expect(erro).toBeInstanceOf(ImportFileMismatchError);
  });

  it("importação já concluída não é retomada", async () => {
    const transport: ImportTransport = {
      getJson: async () => ({ importId: "imp-1", status: "completed", expectedRows: 10, receivedOffset: 10, missingRows: 0, storedItems: 10, fingerprint: fingerprintRows(planilha(10)), batchSize: 500 }) as any,
      postJson: vi.fn(),
    };

    const erro = await resumeBatchedImport("imp-1", planilha(10), { transport, sleep: semEspera }).catch((e) => e);

    expect(erro).toMatchObject({ code: "IMPORT_ALREADY_COMPLETED" });
    expect(transport.postJson).not.toHaveBeenCalled();
  });
});

describe("impressão digital do arquivo", () => {
  it("é estável e muda quando muda a contagem, a primeira ou a última linha", () => {
    const base = planilha(50);
    expect(fingerprintRows(base)).toBe(fingerprintRows(planilha(50)));
    expect(fingerprintRows(base)).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprintRows(base)).not.toBe(fingerprintRows(planilha(51)));
    expect(fingerprintRows(base)).not.toBe(fingerprintRows([{ ...base[0], Nome: "x" }, ...base.slice(1)]));
    expect(fingerprintRows(base)).not.toBe(fingerprintRows([...base.slice(0, -1), { ...base[49], Nome: "x" }]));
  });
});
