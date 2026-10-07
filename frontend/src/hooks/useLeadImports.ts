import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL } from "@/lib/api";
import {
  BANCO_IMPORT_BASE_PATH,
  resumeBatchedImport,
  runBatchedImport,
  type BatchedImportResult,
  type ImportProgress,
  type ImportTotals,
  type ImportTransport,
} from "@/lib/leadImports/batchedImport";

const LEAD_IMPORT_REQUEST_TIMEOUT_MS = 15000;

export const ALL_IMPORTS_VALUE = "__all__";
export const CRM_BASE_VALUE = "__crm__";

export interface LeadCustomField {
  id: string;
  client_id: string;
  key: string;
  label: string;
  type: "text" | "number" | "date";
  import_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadImportItem {
  id: string;
  client_id: string;
  source_name: string;
  source_type: string;
  total_rows: number;
  imported_rows: number;
  skipped_rows: number;
  uploaded_by_uid: string | null;
  uploaded_by_email: string | null;
  created_at: string;
  /** Importação em lotes: "incomplete" até o fechamento. Ausente (servidor antigo) = planilha completa. */
  status?: "incomplete" | "completed";
  expected_rows?: number | null;
  /** Linhas do arquivo já recebidas pelo servidor (ponto de retomada). */
  received_offset?: number;
  column_mapping?: {
    columns: string[];
    mapping: Array<{
      column: string;
      target: "ignore" | "telefone" | "telefone_adicional" | "nome" | "custom";
      label?: string;
      type?: "text" | "number" | "date";
      key?: string;
    }>;
  } | null;
}

export interface LeadImportPreviewItem {
  rowNumber: number;
  telefone: string | null;
  nome: string | null;
  cidade: string | null;
  status: string | null;
  imported: boolean;
  skipReason: string | null;
}

interface CreateLeadImportPayload {
  clientId: string;
  sourceName: string;
  sourceType: string;
  rows: Record<string, unknown>[];
  defaultDdd?: string;
  /** Progresso do envio em lotes (lote N de M, linhas aceitas). */
  onProgress?: (progress: ImportProgress) => void;
  columnMapping?: Array<{
    column: string;
    target: "ignore" | "telefone" | "telefone_adicional" | "nome" | "custom";
    label?: string;
    type?: "text" | "number" | "date";
    key?: string;
  }> | {
    columns: string[];
    mapping: Array<{
      column: string;
      target: "ignore" | "telefone" | "telefone_adicional" | "nome" | "custom";
      label?: string;
      type?: "text" | "number" | "date";
      key?: string;
    }>;
  };
  duplicateStrategy?: "merge" | "skip" | "overwrite";
}

interface CreateLeadImportResponse {
  item: LeadImportItem;
  totals?: ImportTotals;
  preview: LeadImportPreviewItem[];
  warnings?: Array<{
    column: string;
    label: string;
    key: string;
    detectedType: string;
    registeredType: string;
    message: string;
  }>;
}

interface CreateN8nDispatchPayload {
  clientId: string;
  importId: string;
  limit?: number;
}

export interface CreateN8nDispatchResponse {
  success: boolean;
  webhookUrl: string;
  total: number;
  phones: string[];
  n8nResponse: string | null;
}

export interface LeadImportItemDetail {
  id: string;
  import_id: string;
  client_id: string;
  row_number: number;
  telefone: string | null;
  normalized_data: Record<string, unknown> | null;
  /** Linha crua da planilha. So vem nas consultas de lead_import_items. */
  raw_data?: Record<string, unknown> | null;
  imported: boolean;
  skip_reason: string | null;
  created_at: string;
  dispatched: boolean;
}

interface LeadImportItemsResponse {
  items: LeadImportItemDetail[];
  total: number;
  pendingCount: number;
  /** Presentes so quando a consulta manda `limit` (paginacao ligada). */
  page?: number;
  limit?: number;
  matched?: number;
}

export interface DispatchCampaignPayload {
  clientId: string;
  importId?: string;
  campaignName?: string;
  channel?: string;
  scheduledAt?: string;
  limit?: number;
}

async function readApiError(res: Response) {
  const text = await res.text();
  const trimmed = text.trim();

  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) {
    return "Resposta HTML inesperada da API.";
  }

  try {
    const payload = JSON.parse(text);
    return payload?.error?.message || payload?.message || text;
  } catch {
    return text.length > 240 ? `${text.slice(0, 240)}...` : text;
  }
}

async function readLeadImportsJson<T>(res: Response, context: string): Promise<T> {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    console.error("[lead-imports-api] invalid_response", {
      context,
      status: res.status,
      contentType,
    });
    throw new Error("Resposta invalida da API de importacoes.");
  }

  return res.json() as Promise<T>;
}

function getLeadImportsApiCandidates(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const absoluteApiUrl = `${API_BASE_URL}${normalizedPath}`;
  const preferSameOrigin = !import.meta.env.DEV && typeof window !== "undefined";

  return Array.from(new Set(preferSameOrigin ? [normalizedPath, absoluteApiUrl] : [absoluteApiUrl, normalizedPath]));
}

function shouldRetryLeadImportsResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  return [502, 503, 504].includes(response.status) || (response.status >= 500 && contentType.includes("text/html"));
}

async function fetchLeadImports(path: string, init: RequestInit) {
  let networkError: unknown = null;
  const candidates = getLeadImportsApiCandidates(path);

  for (const [index, url] of candidates.entries()) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), LEAD_IMPORT_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (shouldRetryLeadImportsResponse(response) && index < candidates.length - 1) {
        console.warn("[lead-imports-api] retryable_response", {
          path,
          attempt: index + 1,
          status: response.status,
        });
        continue;
      }

      if (index > 0) {
        console.info("[lead-imports-api] fallback_success", { path, status: response.status });
      }

      return response;
    } catch (error) {
      networkError = error;
      const eventName = error instanceof DOMException && error.name === "AbortError" ? "request_timeout" : "network_error";
      console.warn("[lead-imports-api]", eventName, {
        path,
        attempt: index + 1,
        fallbackAvailable: index < candidates.length - 1,
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  console.error("[lead-imports-api] request_failed", { path });
  throw networkError instanceof Error ? networkError : new Error("Falha de conexao com a API de importacoes.");
}

function isClientTerminalError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message;
    return msg.includes("404") || msg.includes("403") || msg.includes("401");
  }
  return false;
}

export function useLeadImports(clientId?: string) {
  const { isAuthenticated, canAccessView, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["lead-imports", clientId],
    enabled: isAuthenticated && !!clientId && canAccessView("planilhas"),
    queryFn: async (): Promise<LeadImportItem[]> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const res = await fetchLeadImports(
        `/api/lead-imports?clientId=${encodeURIComponent(clientId || "")}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!res.ok) {
        const errText = await readApiError(res);
        throw new Error(`Lead imports fetch failed: ${res.status} ${errText}`);
      }

      const payload = await readLeadImportsJson<{ items?: LeadImportItem[] }>(res, "list_imports");
      return Array.isArray(payload.items) ? payload.items : [];
    },
    retry: (failureCount, error) => !isClientTerminalError(error) && failureCount < 1,
    staleTime: 30 * 1000,
  });
}

export interface LeadImportItemsOptions {
  /** "imported" (default, contrato antigo) | "skipped" | "all" */
  status?: "imported" | "skipped" | "all";
  search?: string;
  page?: number;
  /** Enviar limit liga a paginacao; omitido, a rota devolve tudo como sempre. */
  limit?: number;
  enabled?: boolean;
}

export function useLeadImportItems(
  clientId?: string,
  importId?: string,
  dispatched?: string,
  options: LeadImportItemsOptions = {}
) {
  const { isAuthenticated, canAccessView, getIdToken } = useAuth();
  const { status, search, page, limit, enabled = true } = options;

  return useQuery({
    queryKey: ["lead-import-items", clientId, importId, dispatched, status, search, page, limit],
    enabled: enabled && isAuthenticated && !!clientId && canAccessView("planilhas"),
    queryFn: async (): Promise<LeadImportItemsResponse> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const params = new URLSearchParams();
      if (clientId) params.set("clientId", clientId);
      if (importId) params.set("importId", importId);
      if (dispatched !== undefined) params.set("dispatched", dispatched);
      if (status) params.set("status", status);
      if (search) params.set("search", search);
      if (page) params.set("page", String(page));
      if (limit) params.set("limit", String(limit));

      const res = await fetchLeadImports(`/api/lead-import-items?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const errText = await readApiError(res);
        throw new Error(`Lead import items fetch failed: ${res.status} ${errText}`);
      }

      const payload = await readLeadImportsJson<Partial<LeadImportItemsResponse>>(res, "list_import_items");
      return {
        items: Array.isArray(payload.items) ? payload.items : [],
        total: Number(payload.total || 0),
        pendingCount: Number(payload.pendingCount || 0),
        page: payload.page,
        limit: payload.limit,
        matched: payload.matched,
      };
    },
    retry: (failureCount, error) => !isClientTerminalError(error) && failureCount < 1,
    staleTime: 30 * 1000,
  });
}

/** Erro da API com status e código, para o fluxo em lotes decidir se repete o lote. */
class LeadImportsApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "LeadImportsApiError";
    this.status = status;
    this.code = code;
  }
}

async function throwApiError(res: Response): Promise<never> {
  const text = await res.text();
  let message = text.length > 240 ? `${text.slice(0, 240)}...` : text;
  let code: string | undefined;
  try {
    const payload = JSON.parse(text);
    message = payload?.error?.message || payload?.message || message;
    code = typeof payload?.error?.code === "string" ? payload.error.code : undefined;
  } catch {
    if (text.trim().startsWith("<")) message = "Resposta HTML inesperada da API.";
  }
  throw new LeadImportsApiError(message || `Falha ${res.status}`, res.status, code);
}

function useImportTransport(): () => Promise<ImportTransport> {
  const { getIdToken } = useAuth();
  return async () => {
    const token = await getIdToken();
    if (!token) throw new Error("Usuario nao autenticado.");
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
    return {
      async postJson<T>(path: string, body: unknown): Promise<T> {
        const res = await fetchLeadImports(path, { method: "POST", headers, body: JSON.stringify(body) });
        if (!res.ok) await throwApiError(res);
        return readLeadImportsJson<T>(res, `post_${path}`);
      },
      async getJson<T>(path: string): Promise<T> {
        const res = await fetchLeadImports(path, { headers });
        if (!res.ok) await throwApiError(res);
        return readLeadImportsJson<T>(res, `get_${path}`);
      },
    };
  };
}

function invalidateImportQueries(queryClient: ReturnType<typeof useQueryClient>, clientId: string) {
  queryClient.invalidateQueries({ queryKey: ["lead-imports", clientId] });
  queryClient.invalidateQueries({ queryKey: ["lead-import-items", clientId] });
  queryClient.invalidateQueries({ queryKey: ["leads", clientId] });
  queryClient.invalidateQueries({ queryKey: ["lead-custom-fields", clientId] });
}

/**
 * Importa a planilha em LOTES (abrir → lotes de 500 → fechar), sem teto de linhas. A assinatura é a de sempre
 * (mutateAsync(payload) → { item, preview, warnings }), com `onProgress` opcional e `totals` a mais. Se cair no meio, a
 * importação fica INCOMPLETA no servidor (aparece assim em Planilhas Salvas) e o erro carrega o ponto: ver ImportBatchError.
 */
export function useCreateLeadImport() {
  const getTransport = useImportTransport();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateLeadImportPayload): Promise<CreateLeadImportResponse> => {
      const transport = await getTransport();
      const { onProgress, ...rest } = payload;
      const result: BatchedImportResult = await runBatchedImport(rest, { transport, onProgress });
      return result as unknown as CreateLeadImportResponse;
    },
    // sucesso OU falha no meio: a lista precisa refletir o que ficou (completa, ou incompleta com o progresso)
    onSettled: (_data, _error, variables) => invalidateImportQueries(queryClient, variables.clientId),
  });
}

export interface CreateBancoImportPayload {
  clientId: string;
  /** Nome do arquivo escolhido: é o nome do registro (aparece em Planilhas e Campanhas). */
  sourceName: string;
  sourceType: string;
  rows: Record<string, unknown>[];
  defaultDdd?: string;
  columnMapping?: unknown;
  importTags?: string[];
  asClosedSales?: boolean;
  duplicateStrategy?: "merge" | "skip" | "overwrite";
  onProgress?: (progress: ImportProgress) => void;
}

export interface LeadImportAnalysisResult {
  totalRows: number;
  newCount: number;
  duplicateCount: number;
  duplicatesByPhone: number;
  duplicatesByName: number;
  sampleDuplicates: Array<{
    nome: string;
    telefone: string;
    existingTags?: string[];
  }>;
}

export interface AnalyzeLeadImportPayload {
  clientId: string;
  rows: Record<string, unknown>[];
  columnMapping?: unknown;
  defaultDdd?: string;
}

export function useAnalyzeLeadImport() {
  const { getIdToken } = useAuth();
  return useMutation({
    mutationFn: async (payload: AnalyzeLeadImportPayload): Promise<LeadImportAnalysisResult> => {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/lead-imports/analyze`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Falha na análise de duplicados.");
      }
      return res.json();
    },
  });
}

/**
 * Importação do Banco de Dados em LOTES (abrir → lotes de 500 → fechar): cada lote cria os leads e registra a importação no mesmo
 * lugar da tela de Planilhas. Sem o corpo único que estourava o limite do servidor com milhares de linhas.
 */
export function useCreateBancoImport() {
  const getTransport = useImportTransport();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateBancoImportPayload): Promise<BatchedImportResult> => {
      const transport = await getTransport();
      const { onProgress, ...rest } = payload;
      return runBatchedImport(rest, { transport, onProgress, basePath: BANCO_IMPORT_BASE_PATH });
    },
    onSettled: (_data, _error, variables) => invalidateImportQueries(queryClient, variables.clientId),
  });
}

export interface ResumeLeadImportPayload {
  clientId: string;
  importId: string;
  /** As linhas do MESMO arquivo, lidas de novo (o servidor confere pela impressão digital). */
  rows: Record<string, unknown>[];
  onProgress?: (progress: ImportProgress) => void;
}

/** Retoma uma importação incompleta de onde o servidor parou. */
export function useResumeLeadImport() {
  const getTransport = useImportTransport();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ importId, rows, onProgress }: ResumeLeadImportPayload) => {
      const transport = await getTransport();
      return resumeBatchedImport(importId, rows, { transport, onProgress });
    },
    onSettled: (_data, _error, variables) => invalidateImportQueries(queryClient, variables.clientId),
  });
}

export function useLeadCustomFields(clientId?: string | null) {
  const { getIdToken } = useAuth();

  return useQuery({
    queryKey: ["lead-custom-fields", clientId],
    queryFn: async (): Promise<LeadCustomField[]> => {
      if (!clientId) return [];
      const token = await getIdToken();
      if (!token) return [];

      const res = await fetchLeadImports(`/api/lead-custom-fields?clientId=${encodeURIComponent(clientId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch custom fields: ${res.status}`);
      }

      const json = await readLeadImportsJson<{ items: LeadCustomField[] }>(res, "lead_custom_fields");
      return json.items || [];
    },
    enabled: !!clientId,
    staleTime: 60 * 1000,
  });
}

export function useDeleteLeadImport() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (importId: string): Promise<{ success: boolean; deletedId: string }> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetchLeadImports(`/api/lead-imports/${importId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const errText = await readApiError(res);
        throw new Error(`Delete failed: ${res.status} ${errText}`);
      }

      return readLeadImportsJson<{ success: boolean; deletedId: string }>(res, "delete_import");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-imports"] });
      queryClient.invalidateQueries({ queryKey: ["lead-import-items"] });
    },
  });
}

export function useDispatchCampaign() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: DispatchCampaignPayload): Promise<CreateN8nDispatchResponse> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetchLeadImports("/api/n8n-dispatches", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await readApiError(res);
        throw new Error(`Dispatch failed: ${res.status} ${errText}`);
      }

      return readLeadImportsJson<CreateN8nDispatchResponse>(res, "create_dispatch");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-import-items"] });
      queryClient.invalidateQueries({ queryKey: ["lead-imports"] });
    },
  });
}

export function useCreateN8nDispatch() {
  return useDispatchCampaign();
}
