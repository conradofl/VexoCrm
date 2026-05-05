export const INTERNAL_PAGE_ORDER = [
  "dashboard",
  "leads",
  "planilhas",
  "whatsapp",
  "agente",
  "usuarios",
  "campanhas",
  "empresas",
] as const;

export type InternalPage = (typeof INTERNAL_PAGE_ORDER)[number];
export type AccessView = "dashboard" | "leads" | "planilhas" | "whatsapp";

export const CLIENT_VIEW_ORDER: AccessView[] = ["dashboard", "leads", "planilhas", "whatsapp"];

export const FIXED_ADMIN_ACCOUNTS = [
  {
    email: "luizz.felipe.santos17@gmail.com",
    uid: "IozfnQTmWHQAxopr3FyNb1SdYs52",
  },
  {
    email: "econradofl@gmail.com",
    uid: "pKpOKg3Fttf6AnYsTzZD7xjJLaN2",
  },
] as const;

export function normalizeString(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  const normalized = String(value).trim();
  if (!normalized) return null;

  return normalized.startsWith("=") ? normalized.slice(1).trim() : normalized;
}

export function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean)
      )
    );
  }

  if (typeof value === "string" && value.trim()) {
    return Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean)));
  }

  return [];
}

export function normalizeAccessRole(value: unknown): "internal" | "client" | "pending" {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";

  if (normalized === "client" || normalized === "cliente" || normalized === "customer") {
    return "client";
  }

  if (normalized === "pending" || normalized === "pendente" || normalized === "pending_client") {
    return "pending";
  }

  return "internal";
}

export function normalizeInternalPages(value: unknown, isAdmin = false): InternalPage[] {
  if (isAdmin) {
    return [...INTERNAL_PAGE_ORDER];
  }

  const pages = normalizeStringArray(value).filter(
    (item): item is InternalPage => (INTERNAL_PAGE_ORDER as readonly string[]).includes(item)
  );

  if (pages.length === 0) {
    return [...INTERNAL_PAGE_ORDER];
  }

  return Array.from(new Set(pages));
}

export function normalizeAllowedViews(value: unknown, role: "internal" | "client" | "pending"): AccessView[] {
  const views = normalizeStringArray(value).filter(
    (item): item is AccessView =>
      item === "dashboard" || item === "leads" || item === "planilhas" || item === "whatsapp"
  );

  if (role === "client" && views.length === 0) {
    return [...CLIENT_VIEW_ORDER];
  }

  return Array.from(new Set(views));
}

export function isFixedAdminAccount(uid: string | null | undefined, email: string | null | undefined) {
  return FIXED_ADMIN_ACCOUNTS.some(
    (item) => (uid && item.uid === uid) || (email && item.email.toLowerCase() === email.toLowerCase())
  );
}

export function getDefaultInternalRoute(
  internalPages: InternalPage[],
  isAdmin = false
): string {
  const pages = isAdmin ? [...INTERNAL_PAGE_ORDER] : internalPages;

  for (const page of INTERNAL_PAGE_ORDER) {
    if (pages.includes(page)) {
      return `/crm/${page}`;
    }
  }

  return "/crm/dashboard";
}

export function getDefaultClientRoute(clientId: string, allowedViews: AccessView[]): string {
  for (const view of CLIENT_VIEW_ORDER) {
    if (allowedViews.includes(view)) {
      return `/clientes/${clientId}/${view}`;
    }
  }

  return `/clientes/${clientId}/dashboard`;
}

export function canAccessInternalPage(
  page: InternalPage,
  internalPages: InternalPage[],
  isAdmin = false
): boolean {
  return isAdmin || internalPages.includes(page);
}
