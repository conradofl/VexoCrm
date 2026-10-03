// Modo de exibição das abas de registros (cartão ou lista). Uma implementação só, usada por Campanhas, Fila de
// Envios, Planilhas Salvas, Propostas e Contratos (como getStableColor para a cor e listFilter para a busca).
//
// É preferência de TELA, não dado: fica no navegador, por aba, e não sincroniza entre dispositivos nem vai ao
// servidor. Em tela estreita a lista vira cartão (tabela não funciona ali).

export type ViewMode = "card" | "list";

/** Abaixo disto a lista não cabe e a aba mostra cartões (mesmo ponto de corte do restante do app). */
export const NARROW_BREAKPOINT_PX = 768;

export const LIST_UNAVAILABLE_REASON = "A lista precisa de mais largura. Nesta tela os registros aparecem como cartões.";

export const viewModeStorageKey = (tabId: string) => `vexo:view-mode:${tabId}`;

/** Preferência antiga de uma aba (de antes do alternador único), para ninguém perder a escolha que já fez. */
export interface LegacyViewModeKey {
  key: string;
  /** valor antigo → modo novo (null = não reconhece) */
  map: (raw: string) => ViewMode | null;
}

const isViewMode = (v: unknown): v is ViewMode => v === "card" || v === "list";

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // sem storage (janela privada, bloqueado): a tela funciona sem lembrar
  }
}

export function readViewMode(tabId: string, legacy?: LegacyViewModeKey): ViewMode {
  const stored = readRaw(viewModeStorageKey(tabId));
  if (stored !== null) {
    try {
      const parsed = JSON.parse(stored);
      if (isViewMode(parsed)) return parsed;
    } catch {
      /* valor corrompido: cai no padrão */
    }
  }
  if (legacy) {
    const raw = readRaw(legacy.key);
    if (raw !== null) {
      let value = raw;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "string") value = parsed;
      } catch {
        /* usa o texto cru */
      }
      const mapped = legacy.map(value);
      if (mapped) return mapped;
    }
  }
  return "card";
}

export function writeViewMode(tabId: string, mode: ViewMode): void {
  try {
    window.localStorage.setItem(viewModeStorageKey(tabId), JSON.stringify(mode));
  } catch {
    /* sem storage: a escolha vale só nesta visita */
  }
}

/** O modo que vale na tela: em tela estreita é sempre cartão, seja qual for a preferência. */
export function effectiveViewMode(preference: ViewMode, narrow: boolean): ViewMode {
  return narrow ? "card" : preference;
}

export function isNarrowWidth(width: number): boolean {
  return width < NARROW_BREAKPOINT_PX;
}
