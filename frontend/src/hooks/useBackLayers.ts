// Botão voltar do aparelho (gesto do Android, seta do navegador) dentro de uma tela que abre
// camadas por cima de si mesma, como a aba Conversas no celular: fila → conversa → dossiê.
//
// Sem isto, "voltar" sai da página inteira. Cada camada aberta ganha uma entrada no histórico do
// navegador, com o MESMO endereço; voltar desfaz a entrada e a tela fecha a camada de cima.
// Fechar pela própria tela (seta, X) também anda uma casa para trás no histórico, para as duas
// coisas nunca saírem de sintonia.
import { useCallback, useEffect, useRef } from "react";

export function useBackLayers<Layer extends string>(enabled: boolean, onBack: (layer: Layer) => void) {
  const stack = useRef<Layer[]>([]);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const onPop = () => {
      const top = stack.current.pop();
      if (top) onBackRef.current(top);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [enabled]);

  /** Abriu uma camada: registra no histórico. Fora do celular não faz nada. */
  const push = useCallback(
    (layer: Layer) => {
      if (!enabled || typeof window === "undefined") return;
      if (stack.current[stack.current.length - 1] === layer) return;
      stack.current.push(layer);
      // Mantém o que o roteador guardou na entrada atual (ele usa para saber onde está).
      const current = (window.history.state && typeof window.history.state === "object" ? window.history.state : {}) as Record<string, unknown>;
      window.history.pushState({ ...current, inboxLayer: layer }, "");
    },
    [enabled]
  );

  /** Fechou pela tela. Se a camada é a de cima, volta uma casa no histórico (e o voltar fecha a camada). */
  const close = useCallback(
    (layer: Layer) => {
      if (enabled && typeof window !== "undefined" && stack.current[stack.current.length - 1] === layer) {
        window.history.back();
        return;
      }
      stack.current = stack.current.filter((l) => l !== layer);
      onBackRef.current(layer);
    },
    [enabled]
  );

  return { push, close };
}
