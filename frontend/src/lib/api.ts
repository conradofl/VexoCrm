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
