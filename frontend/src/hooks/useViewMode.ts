import { useCallback, useEffect, useState } from "react";
import {
  effectiveViewMode,
  isNarrowWidth,
  readViewMode,
  writeViewMode,
  type LegacyViewModeKey,
  type ViewMode,
} from "@/lib/viewMode";

export interface ViewModeControls {
  /** A escolha da pessoa (o que fica lembrado). */
  preference: ViewMode;
  /** O que a tela mostra de fato: em tela estreita, sempre "card". */
  mode: ViewMode;
  /** A tela é estreita demais para lista? */
  narrow: boolean;
  setPreference: (mode: ViewMode) => void;
}

const currentNarrow = () => (typeof window === "undefined" ? false : isNarrowWidth(window.innerWidth));

/**
 * Modo de exibição de uma aba, lembrado POR ABA (`tabId`) no navegador. Sem matchMedia: a largura vem de
 * window.innerWidth + resize, que funciona em qualquer ambiente.
 */
export function useViewMode(tabId: string, legacy?: LegacyViewModeKey): ViewModeControls {
  const [preference, setPreferenceState] = useState<ViewMode>(() => readViewMode(tabId, legacy));
  const [narrow, setNarrow] = useState<boolean>(currentNarrow);

  useEffect(() => {
    const onResize = () => setNarrow(currentNarrow());
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const setPreference = useCallback(
    (mode: ViewMode) => {
      setPreferenceState(mode);
      writeViewMode(tabId, mode);
    },
    [tabId]
  );

  return { preference, mode: effectiveViewMode(preference, narrow), narrow, setPreference };
}
