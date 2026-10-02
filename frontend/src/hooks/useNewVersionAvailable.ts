import { useCallback, useEffect, useRef, useState } from "react";
import { APP_VERSION, VERSION_CHECK_INTERVAL_MS, fetchLatestVersion } from "@/lib/appVersion";

interface Options {
  currentVersion?: string | null;
  intervalMs?: number;
  fetchLatest?: () => Promise<string | null>;
}

/**
 * Diz se saiu versão nova desde que esta aba carregou. Nunca recarrega nada
 * sozinho — o usuário pode estar no meio de uma mensagem de campanha ou de
 * uma importação.
 *
 *  - Só consulta com a aba visível.
 *  - No máximo uma consulta por intervalo: cada consulta reinicia o timer, e
 *    voltar pra aba só consulta se já passou um intervalo desde a última.
 *  - Dispensar esconde o aviso, mas a próxima consulta que ainda ver versão
 *    diferente mostra de novo — a aba continua velha.
 */
export function useNewVersionAvailable({
  currentVersion = APP_VERSION,
  intervalMs = VERSION_CHECK_INTERVAL_MS,
  fetchLatest = fetchLatestVersion,
}: Options = {}) {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const fetchLatestRef = useRef(fetchLatest);
  fetchLatestRef.current = fetchLatest;

  useEffect(() => {
    if (!currentVersion) return;

    let lastCheckAt = Date.now();
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const isTabVisible = () => document.visibilityState === "visible";

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(onTimer, intervalMs);
    };

    const runCheck = async () => {
      inFlight = true;
      lastCheckAt = Date.now();
      schedule();
      try {
        const latest = await fetchLatestRef.current();
        if (!cancelled && latest) setUpdateAvailable(latest !== currentVersion);
      } finally {
        inFlight = false;
      }
    };

    function onTimer() {
      if (inFlight || !isTabVisible()) {
        schedule();
        return;
      }
      void runCheck();
    }

    const onVisibilityChange = () => {
      if (!isTabVisible() || inFlight) return;
      if (Date.now() - lastCheckAt < intervalMs) return;
      void runCheck();
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [currentVersion, intervalMs]);

  const dismiss = useCallback(() => setUpdateAvailable(false), []);

  return { updateAvailable, dismiss };
}
