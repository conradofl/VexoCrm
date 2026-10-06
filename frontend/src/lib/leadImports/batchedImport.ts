// Importação de planilha em LOTES, do lado da tela. Sem teto de linhas: abre a importação, manda lotes de até
// IMPORT_BATCH_SIZE linhas em sequência (com progresso), e fecha. Se algo cair no meio, a importação fica INCOMPLETA no
// servidor (com o que já entrou) e pode ser retomada de onde parou. Reenviar um lote é seguro: o servidor é idempotente por
// (import_id, row_number).
//
// Este módulo não conhece fetch nem React: recebe um `transport` — assim o fluxo (lotes, tentativas, retomada) é testado
// sem rede (src/test/batchedImport.test.ts) e o hook só adapta o fetch.

/** Tem que ser igual a IMPORT_BATCH_SIZE de backend/src/services/leadImportBatches.js (o servidor recusa lote maior). */
export const IMPORT_BATCH_SIZE = 500;

export interface ImportProgress {
  phase: "opening" | "sending" | "closing" | "done";
  /** Linhas já aceitas pelo servidor (confirmadas pela resposta do lote). */
  sentRows: number;
  totalRows: number;
  /** Lote em andamento (1-based) e total de lotes DESTA execução. */
  batch: number;
  batches: number;
}

export interface ImportTransport {
  postJson<T>(path: string, body: unknown): Promise<T>;
  getJson<T>(path: string): Promise<T>;
}

export interface BatchedImportPayload {
  clientId: string;
  sourceName: string;
  sourceType: string;
  rows: Record<string, unknown>[];
  defaultDdd?: string;
  columnMapping?: unknown;
  /** Importação do Banco de Dados: tags da importação e "vendas fechadas" (o servidor guarda e usa em cada lote). */
  importTags?: string[];
  asClosedSales?: boolean;
}

export interface ImportTotals {
  total: number;
  valid: number;
  intact: number;
  completedWithDdd: number;
  withoutPhone: number;
  uniquePhones: number;
}

export interface BatchedImportResult<TItem = Record<string, unknown>, TPreview = unknown, TWarning = unknown> {
  item: TItem;
  preview: TPreview[];
  warnings: TWarning[];
  totals: ImportTotals;
}

/** Erro com o que ficou no servidor: a tela mostra "incompleta, entraram N de M" e oferece retomar. */
export class ImportBatchError extends Error {
  importId: string | null;
  /** Último ponto CONFIRMADO pelo servidor (linhas aceitas); null se a importação nem chegou a abrir. */
  receivedOffset: number | null;
  totalRows: number;
  status?: number;
  code?: string;
  constructor(message: string, info: { importId: string | null; receivedOffset: number | null; totalRows: number; status?: number; code?: string }) {
    super(message);
    this.name = "ImportBatchError";
    this.importId = info.importId;
    this.receivedOffset = info.receivedOffset;
    this.totalRows = info.totalRows;
    this.status = info.status;
    this.code = info.code;
  }
}

export class ImportFileMismatchError extends Error {
  constructor(message = "Este não é o mesmo arquivo da importação aberta. Selecione a planilha original para retomar.") {
    super(message);
    this.name = "ImportFileMismatchError";
  }
}

/** Hash determinístico e síncrono (FNV-1a de 64 bits em BigInt) de [contagem, primeira, última linha]. */
export function fingerprintRows(rows: Record<string, unknown>[]): string {
  const text = JSON.stringify([rows.length, rows[0] ?? null, rows[rows.length - 1] ?? null]);
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

interface TransportErrorLike {
  status?: number;
  code?: string;
  message?: string;
}

/** Erro de rede (sem status) e 5xx valem nova tentativa; 4xx é erro do pedido e não adianta repetir. */
function isRetryable(error: unknown): boolean {
  const status = (error as TransportErrorLike)?.status;
  return status === undefined || status === 0 || status >= 500;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface RunOptions {
  transport: ImportTransport;
  onProgress?: (progress: ImportProgress) => void;
  /** Tentativas extras por lote antes de desistir (cada uma reenvia o MESMO lote, o que é seguro). */
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  /** Prefixo das rotas: "/api/lead-imports" (tela de Planilhas, padrão) ou "/api/leads/import-batches" (Banco de Dados, que cria os leads). */
  basePath?: string;
}

export const PLANILHAS_IMPORT_BASE_PATH = "/api/lead-imports";
export const BANCO_IMPORT_BASE_PATH = "/api/leads/import-batches";

interface OpenResponse {
  item: Record<string, unknown> & { id: string };
  warnings?: unknown[];
  batchSize?: number;
}
interface BatchResponse {
  receivedOffset: number;
  expectedRows: number;
}
interface CloseResponse {
  item: Record<string, unknown>;
  preview?: unknown[];
  totals: ImportTotals;
}
export interface ImportProgressResponse {
  importId: string;
  status: "incomplete" | "completed";
  expectedRows: number | null;
  receivedOffset: number;
  missingRows: number;
  storedItems: number;
  fingerprint: string | null;
  batchSize: number;
}

async function sendBatches(
  importId: string,
  rows: Record<string, unknown>[],
  fromOffset: number,
  fingerprint: string,
  opts: RunOptions,
  state: { receivedOffset: number }
): Promise<void> {
  const { transport, onProgress, retries = 3, sleep = defaultSleep, signal, basePath = PLANILHAS_IMPORT_BASE_PATH } = opts;
  const total = rows.length;
  const pending = total - fromOffset;
  const batches = Math.ceil(pending / IMPORT_BATCH_SIZE);
  let sent = fromOffset;

  for (let start = fromOffset, n = 1; start < total; start += IMPORT_BATCH_SIZE, n += 1) {
    if (signal?.aborted) throw new ImportBatchError("Importação cancelada.", { importId, receivedOffset: state.receivedOffset, totalRows: total });
    const slice = rows.slice(start, start + IMPORT_BATCH_SIZE);
    onProgress?.({ phase: "sending", sentRows: sent, totalRows: total, batch: n, batches });

    let attempt = 0;
    for (;;) {
      try {
        const res = await transport.postJson<BatchResponse>(`${basePath}/${importId}/batches`, { startIndex: start, rows: slice, fingerprint });
        state.receivedOffset = Math.max(state.receivedOffset, res.receivedOffset);
        break;
      } catch (error) {
        const info = error as TransportErrorLike;
        if (!isRetryable(error) || attempt >= retries) {
          throw new ImportBatchError(info.message || "Falha ao enviar um lote da planilha.", {
            importId, receivedOffset: state.receivedOffset, totalRows: total, status: info.status, code: info.code,
          });
        }
        attempt += 1;
        await sleep(500 * 3 ** (attempt - 1)); // 0,5 s, 1,5 s, 4,5 s
      }
    }
    sent = Math.min(start + slice.length, total);
    onProgress?.({ phase: "sending", sentRows: sent, totalRows: total, batch: n, batches });
  }
}

async function closeImport(importId: string, total: number, opts: RunOptions, state: { receivedOffset: number }): Promise<CloseResponse> {
  opts.onProgress?.({ phase: "closing", sentRows: total, totalRows: total, batch: 0, batches: 0 });
  try {
    return await opts.transport.postJson<CloseResponse>(`${opts.basePath ?? PLANILHAS_IMPORT_BASE_PATH}/${importId}/close`, {});
  } catch (error) {
    const info = error as TransportErrorLike;
    throw new ImportBatchError(info.message || "Falha ao concluir a importação.", { importId, receivedOffset: state.receivedOffset, totalRows: total, status: info.status, code: info.code });
  }
}

/** Importação nova: abrir → lotes → fechar. */
export async function runBatchedImport(payload: BatchedImportPayload, opts: RunOptions): Promise<BatchedImportResult> {
  const { rows } = payload;
  const total = rows.length;
  const fingerprint = fingerprintRows(rows);
  opts.onProgress?.({ phase: "opening", sentRows: 0, totalRows: total, batch: 0, batches: Math.ceil(total / IMPORT_BATCH_SIZE) });

  let opened: OpenResponse;
  try {
    opened = await opts.transport.postJson<OpenResponse>(`${opts.basePath ?? PLANILHAS_IMPORT_BASE_PATH}/open`, {
      clientId: payload.clientId,
      sourceName: payload.sourceName,
      sourceType: payload.sourceType,
      defaultDdd: payload.defaultDdd,
      columnMapping: payload.columnMapping ?? null,
      totalRows: total,
      sampleRows: rows.slice(0, 15), // o mapeamento automático decide por uma amostra
      fingerprint,
      ...(payload.importTags ? { importTags: payload.importTags } : {}),
      ...(payload.asClosedSales ? { asClosedSales: true } : {}),
    });
  } catch (error) {
    const info = error as TransportErrorLike;
    throw new ImportBatchError(info.message || "Falha ao abrir a importação.", { importId: null, receivedOffset: null, totalRows: total, status: info.status, code: info.code });
  }

  const importId = opened.item.id;
  const state = { receivedOffset: 0 };
  await sendBatches(importId, rows, 0, fingerprint, opts, state);
  const closed = await closeImport(importId, total, opts, state);
  opts.onProgress?.({ phase: "done", sentRows: total, totalRows: total, batch: 0, batches: 0 });
  return { item: closed.item, preview: closed.preview ?? [], warnings: opened.warnings ?? [], totals: closed.totals };
}

/** Retomada: lê o progresso, confere que é o MESMO arquivo e manda só o que falta (do ponto que o SERVIDOR confirmou). */
export async function resumeBatchedImport(importId: string, rows: Record<string, unknown>[], opts: RunOptions): Promise<BatchedImportResult> {
  const total = rows.length;
  const progress = await opts.transport.getJson<ImportProgressResponse>(`${opts.basePath ?? PLANILHAS_IMPORT_BASE_PATH}/${importId}/progress`);
  const fingerprint = fingerprintRows(rows);

  if (progress.status === "completed") {
    throw new ImportBatchError("Esta importação já foi concluída.", { importId, receivedOffset: progress.receivedOffset, totalRows: total, code: "IMPORT_ALREADY_COMPLETED" });
  }
  if ((progress.fingerprint && progress.fingerprint !== fingerprint) || (progress.expectedRows != null && progress.expectedRows !== total)) {
    throw new ImportFileMismatchError();
  }

  const state = { receivedOffset: progress.receivedOffset };
  await sendBatches(importId, rows, progress.receivedOffset, fingerprint, opts, state);
  const closed = await closeImport(importId, total, opts, state);
  opts.onProgress?.({ phase: "done", sentRows: total, totalRows: total, batch: 0, batches: 0 });
  return { item: closed.item, preview: closed.preview ?? [], warnings: [], totals: closed.totals };
}
