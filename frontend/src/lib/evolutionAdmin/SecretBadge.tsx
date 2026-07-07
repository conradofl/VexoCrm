import { Badge } from "@/components/ui/badge";

export function SecretBadge({ defined }: { defined: boolean }) {
  return defined ? (
    <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
      definido
    </Badge>
  ) : (
    <Badge variant="secondary">vazio</Badge>
  );
}
