// VexoCrm/frontend/src/lib/api.ts
// Base URL for the Node backend. In dev, default to local API (port 3001) when unset so
// fetches do not target the Vite dev server port (8080) by mistake.
const rawApiBaseUrl =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? "http://127.0.0.1:3001" : "");

if (!rawApiBaseUrl) {
  throw new Error(
    "Missing VITE_API_BASE_URL in frontend env (required for production builds)"
  );
}

export const API_BASE_URL = rawApiBaseUrl.replace(/\/$/, "");

export const API_REQUEST_TIMEOUT_MS = 15000;

export function getApiCandidates(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const absoluteApiUrl = `${API_BASE_URL}${normalizedPath}`;
  const preferSameOrigin = !import.meta.env.DEV && typeof window !== "undefined";

  return Array.from(new Set(preferSameOrigin ? [normalizedPath, absoluteApiUrl] : [absoluteApiUrl, normalizedPath]));
}

export function shouldRetryApiResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  return [502, 503, 504].includes(response.status) || (response.status >= 500 && contentType.includes("text/html"));
}

export async function fetchApi(path: string, init: RequestInit = {}) {
  const startedAt = Date.now();
  let networkError: unknown = null;
  const candidates = getApiCandidates(path);

  for (const [index, url] of candidates.entries()) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      const durationMs = Date.now() - startedAt;

      if (shouldRetryApiResponse(response) && index < candidates.length - 1) {
        console.warn("[api] retryable_response", {
          path,
          attempt: index + 1,
          status: response.status,
          durationMs,
        });
        continue;
      }

      if (index > 0) {
        console.info("[api] fallback_success", {
          path,
          status: response.status,
          durationMs,
        });
      }

      return response;
    } catch (error) {
      networkError = error;
      const durationMs = Date.now() - startedAt;
      const eventName = error instanceof DOMException && error.name === "AbortError" ? "request_timeout" : "network_error";
      console.warn("[api]", eventName, {
        path,
        attempt: index + 1,
        fallbackAvailable: index < candidates.length - 1,
        durationMs,
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  console.error("[api] request_failed", { path, durationMs: Date.now() - startedAt });
  throw networkError instanceof Error ? networkError : new Error("Falha de conexao com a API.");
}

export async function readApiErrorMessage(res: Response, fallback: string) {
  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const data = await res.json().catch(() => null);
    return data?.error?.message || data?.message || `${fallback}: ${res.status}`;
  }

  const text = await res.text().catch(() => "");
  if (text.trim().startsWith("<!DOCTYPE") || text.trim().startsWith("<html")) {
    return "Resposta HTML inesperada da API.";
  }

  return text ? `${fallback}: ${res.status} ${text.slice(0, 240)}` : `${fallback}: ${res.status}`;
}

export async function readApiJson<T>(res: Response, context: string): Promise<T> {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    console.error("[api] invalid_response", {
      context,
      status: res.status,
      contentType,
    });
    throw new Error("Resposta invalida da API.");
  }

  return res.json() as Promise<T>;
}
