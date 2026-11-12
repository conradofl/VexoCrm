// Tela de celular e teclado virtual.
//
// No celular a aba Conversas ocupa a tela inteira (position: fixed). O problema clássico é o
// teclado: no iPhone ele NÃO encolhe a página, só cobre a parte de baixo, e o campo de resposta
// some atrás dele. window.visualViewport diz a área realmente visível; a tela usa essa altura
// (e o deslocamento, quando o navegador rola a página para mostrar o campo) em vez de 100vh.
import { useEffect, useState } from "react";

export const MOBILE_QUERY = "(max-width: 767px)";

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(MOBILE_QUERY).matches : false
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

export interface VisibleArea {
  /** Altura realmente visível, já sem o teclado. */
  height: number;
  /** Quanto o navegador rolou a página para mostrar o campo em foco (iPhone). */
  offsetTop: number;
}

const readArea = (): VisibleArea => {
  if (typeof window === "undefined") return { height: 0, offsetTop: 0 };
  const vv = window.visualViewport;
  return vv ? { height: Math.round(vv.height), offsetTop: Math.round(vv.offsetTop) } : { height: window.innerHeight, offsetTop: 0 };
};

/** Área visível da tela, atualizada quando o teclado abre, fecha ou a tela gira. Só escuta quando `enabled`. */
export function useVisibleArea(enabled: boolean): VisibleArea {
  const [area, setArea] = useState<VisibleArea>(readArea);
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const update = () => {
      const next = readArea();
      setArea((prev) => (prev.height === next.height && prev.offsetTop === next.offsetTop ? prev : next));
    };
    update();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [enabled]);
  return area;
}

/**
 * O teclado está aberto? Compara a área visível de agora com a maior já vista nesta largura de
 * tela (virar o aparelho recomeça a conta). Vale para iPhone e Android, que avisam de jeitos diferentes.
 */
export function useKeyboardOpen(enabled: boolean, area: VisibleArea): boolean {
  const [full, setFull] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const width = window.innerWidth;
    setFull((prev) => (prev.width !== width ? { width, height: area.height } : area.height > prev.height ? { width, height: area.height } : prev));
  }, [enabled, area.height]);
  return enabled && full.height - area.height > 150;
}
