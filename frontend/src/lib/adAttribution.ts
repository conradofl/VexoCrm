// Origem do anúncio que trouxe o visitante (Gestor de Tráfego, PR 4a).
//
// A página lê os parâmetros de campanha da URL de chegada e manda junto com o
// formulário. Quem decide se é anúncio pago é o servidor; aqui só se copia o
// que veio, sem deduzir nada. Sem parâmetro nenhum, não vai origem: o lead fica
// "sem registro".

export const AD_PARAM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "campaign_id",
  "adset_id",
  "ad_id",
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
] as const;

export type AdAttribution = Partial<Record<(typeof AD_PARAM_KEYS)[number], string>> & {
  landing_path?: string;
  referrer?: string;
};

const STORAGE_KEY = "vexo:ad-attribution";
const VALUE_MAX = 500;

/** Parâmetros de campanha de uma URL. null quando não há nenhum. */
export function readAdAttribution(search: string, pathname = "/", referrer = ""): AdAttribution | null {
  const params = new URLSearchParams(search || "");
  const found: AdAttribution = {};
  let any = false;
  for (const key of AD_PARAM_KEYS) {
    const value = (params.get(key) || "").trim();
    if (value) {
      found[key] = value.slice(0, VALUE_MAX);
      any = true;
    }
  }
  if (!any) return null;
  found.landing_path = pathname || "/";
  if (referrer) found.referrer = referrer.slice(0, 2000);
  return found;
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/**
 * Guarda a origem da chegada para a sessão: o visitante pode abrir o
 * formulário depois de a URL perder os parâmetros. Chegada nova com
 * parâmetros substitui a anterior.
 */
export function rememberAdAttribution(): AdAttribution | null {
  if (typeof window === "undefined") return null;
  const current = readAdAttribution(window.location.search, window.location.pathname, document.referrer);
  if (current) {
    try {
      storage()?.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      // Sem armazenamento (aba anônima, bloqueio): segue com a URL atual.
    }
  }
  return current;
}

/** Origem a mandar com o formulário: a da URL atual; se não houver, a guardada na sessão. */
export function getAdAttribution(): AdAttribution | null {
  if (typeof window === "undefined") return null;
  const current = readAdAttribution(window.location.search, window.location.pathname, document.referrer);
  if (current) return current;
  try {
    const stored = storage()?.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as AdAttribution) : null;
  } catch {
    return null;
  }
}
