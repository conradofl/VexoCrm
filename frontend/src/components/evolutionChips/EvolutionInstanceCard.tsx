import { Save, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LeadClientEvolutionInstance } from "@/hooks/useLeadClients";
import { EvolutionInstanceStatusBadge } from "./EvolutionInstanceStatusBadge";
import { resolveChipLimit } from "@/lib/evolutionChips/utils";

interface EvolutionInstanceCardProps {
  tenantId: string;
  instance: LeadClientEvolutionInstance;
  draft: { chipState: "cold" | "warm"; dailyLimitOverride: string };
  onChipStateChange: (value: "cold" | "warm") => void;
  onLimitOverrideChange: (value: string) => void;
  onSaveChip: () => void;
  onToggleDefault: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  canEdit: boolean;
  isSavePending: boolean;
  isDeletePending: boolean;
}

export function EvolutionInstanceCard({
  tenantId,
  instance,
  draft,
  onChipStateChange,
  onLimitOverrideChange,
  onSaveChip,
  onToggleDefault,
  onToggleActive,
  onDelete,
  canEdit,
  isSavePending,
  isDeletePending,
}: EvolutionInstanceCardProps) {
  const displayLimit = resolveChipLimit(draft.chipState, draft.dailyLimitOverride);
  const sent = instance.sent_count_today ?? 0;
  const pct = displayLimit > 0 ? Math.min(100, Math.round((sent / displayLimit) * 100)) : 0;
  const barColor =
    pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-400" : "bg-emerald-500";

  return (
    <div
      className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-5 rounded-2xl border border-slate-200/60 bg-gradient-to-br from-white to-slate-50/30 dark:from-white/[0.02] dark:to-transparent shadow-sm hover:shadow-md transition-all duration-200 dark:border-white/5"
    >
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="max-w-[200px] truncate font-display font-semibold text-foreground text-sm">
                {instance.name}
              </p>
            </TooltipTrigger>
            <TooltipContent>{instance.name}</TooltipContent>
          </Tooltip>
          {instance.is_default ? (
            <Badge className="border border-cyan-400/25 bg-cyan-500/10 text-cyan-700 rounded-xl dark:text-cyan-200 text-[10px]">
              padrão
            </Badge>
          ) : null}
          <Badge
            className={cn(
              "rounded-xl text-[10px]",
              instance.active
                ? "border border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
                : "border border-slate-300/80 bg-white/90 text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/65"
            )}
          >
            {instance.active ? "ativa" : "inativa"}
          </Badge>
          <EvolutionInstanceStatusBadge tenantId={tenantId} instanceId={instance.id} />
          {instance.has_dispatch_webhook_token ? (
            <Badge className="border border-violet-400/25 bg-violet-500/10 text-violet-700 rounded-xl dark:text-violet-200 text-[10px]">
              api key
            </Badge>
          ) : null}
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {instance.dispatch_webhook_url ?? "—"}
            </p>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs break-all">
            {instance.dispatch_webhook_url ?? "URL não definida"}
          </TooltipContent>
        </Tooltip>

        {/* Anti-ban: saúde do chip (cota diária) */}
        <div className="space-y-2 rounded-xl border border-slate-200/50 bg-slate-50/50 p-3.5 text-xs dark:border-white/5 dark:bg-white/[0.01]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground font-medium">Cota Diária de Envios</span>
            <span className="font-num font-semibold text-foreground">
              {sent} / {displayLimit}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
            <div
              className={cn("h-full rounded-full transition-all duration-300", barColor)}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Select
              value={draft.chipState}
              onValueChange={onChipStateChange}
              disabled={!canEdit}
            >
              <SelectTrigger className="h-8 w-[150px] text-xs rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="cold">Frio (100 msgs/dia)</SelectItem>
                <SelectItem value="warm">Aquecido (500 msgs/dia)</SelectItem>
              </SelectContent>
            </Select>
            <Tooltip>
              <TooltipTrigger asChild>
                <Input
                  className="h-8 w-28 text-xs rounded-xl font-num"
                  placeholder="Limite custom"
                  title="Limite customizado de mensagens por dia"
                  type="number"
                  min="1"
                  disabled={!canEdit}
                  value={draft.dailyLimitOverride}
                  onChange={(e) => onLimitOverrideChange(e.target.value)}
                />
              </TooltipTrigger>
              <TooltipContent>Definir limite diário customizado de mensagens</TooltipContent>
            </Tooltip>
            {canEdit && (
              <Button
                type="button"
                variant="default"
                size="sm"
                className="h-8 text-xs rounded-xl"
                disabled={isSavePending}
                onClick={onSaveChip}
              >
                <Save className="mr-1.5 h-3.5 w-3.5" />
                Salvar cota
              </Button>
            )}
          </div>
        </div>
      </div>

      {canEdit && (
        <div className="flex flex-row lg:flex-col items-center justify-end gap-2 shrink-0 self-end lg:self-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-xl text-xs h-9 w-full lg:w-28"
            disabled={isSavePending || instance.is_default}
            onClick={onToggleDefault}
          >
            Tornar Padrão
          </Button>
          <Button
            type="button"
            variant={instance.active ? "outline" : "default"}
            size="sm"
            className="rounded-xl text-xs h-9 w-full lg:w-28"
            disabled={isSavePending}
            onClick={onToggleActive}
          >
            {instance.active ? "Desativar" : "Ativar"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-xl text-xs h-9 w-full lg:w-28 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20"
            disabled={isDeletePending}
            onClick={onDelete}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            Remover
          </Button>
        </div>
      )}
    </div>
  );
}
