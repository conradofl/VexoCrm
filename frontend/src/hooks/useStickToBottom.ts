// frontend/src/hooks/useStickToBottom.ts
//
// Caixa de chat que acompanha o fim da conversa sem arrancar quem rolou para
// cima para reler. Regra:
//   - mudou o conteúdo (trigger) e a pessoa estava no fim -> desce;
//   - scrollOnNextChange() antes de mudar (ex.: a pessoa enviou) -> desce mesmo
//     que ela estivesse lendo lá em cima: enviar é pedido explícito;
//   - só rolar para CIMA solta do fim. Rolar para baixo sem chegar ao fim (o
//     meio da animação suave) não solta, senão a resposta que chega durante a
//     animação ficaria escondida.
// Usa scrollTo no próprio contêiner, não scrollIntoView, que puxaria a página
// inteira junto. Com prefers-reduced-motion o salto é instantâneo.

import { useCallback, useLayoutEffect, useRef } from "react";

const NEAR_BOTTOM_PX = 80;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useStickToBottom<T extends HTMLElement = HTMLDivElement>(trigger: unknown) {
  const containerRef = useRef<T>(null);
  const atBottomRef = useRef(true);
  const forceRef = useRef(false);
  const lastTopRef = useRef(0);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const previousTop = lastTopRef.current;
    lastTopRef.current = el.scrollTop;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX) {
      atBottomRef.current = true;
    } else if (el.scrollTop < previousTop) {
      atBottomRef.current = false;
    }
  }, []);

  const scrollOnNextChange = useCallback(() => {
    forceRef.current = true;
  }, []);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!forceRef.current && !atBottomRef.current) return;
    forceRef.current = false;
    atBottomRef.current = true;
    const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
    if (typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior });
    else el.scrollTop = el.scrollHeight;
  }, [trigger]);

  return { containerRef, onScroll, scrollOnNextChange };
}
