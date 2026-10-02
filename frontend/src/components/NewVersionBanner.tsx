import { Button } from "@/components/ui/button";
import { useNewVersionAvailable } from "@/hooks/useNewVersionAvailable";

interface NewVersionBannerProps {
  currentVersion?: string | null;
  intervalMs?: number;
  fetchLatest?: () => Promise<string | null>;
  onReload?: () => void;
}

// Aviso discreto e persistente, no canto — só informa e oferece atualizar.
// Quem decide recarregar é o usuário: recarregar por conta própria apagaria
// o que ele está escrevendo ou uma importação em andamento.
export function NewVersionBanner({ currentVersion, intervalMs, fetchLatest, onReload }: NewVersionBannerProps) {
  const { updateAvailable, dismiss } = useNewVersionAvailable({ currentVersion, intervalMs, fetchLatest });

  if (!updateAvailable) return null;

  const reload = onReload ?? (() => window.location.reload());

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[90] flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-card-foreground shadow-lg"
    >
      <span>Nova versão disponível.</span>
      <Button size="sm" onClick={reload}>
        Atualizar
      </Button>
      <Button size="sm" variant="ghost" onClick={dismiss} aria-label="Dispensar aviso de nova versão">
        Depois
      </Button>
    </div>
  );
}
