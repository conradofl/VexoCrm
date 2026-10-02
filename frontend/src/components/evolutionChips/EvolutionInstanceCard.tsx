import { useState } from "react";
import { ChevronDown, RefreshCw, Save, Trash2, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { LeadClientEvolutionInstance, useEvolutionInstanceSyncStatus } from "@/hooks/useLeadClients";
import { EvolutionInstanceStatusBadge } from "./EvolutionInstanceStatusBadge";
import { resolveChipLimit, getChipColor } from "@/lib/evolutionChips/utils";

interface OperatorOption {
  uid: string;
  displayName?: string | null;
  email?: string | null;
}

interface EvolutionInstanceCardProps {
  tenantId: string;
  instance: LeadClientEvolutionInstance;
  draft: { chipState: "cold" | "warm"; dailyLimitOverride: string };
  onChipStateChange: (value: "cold" | "warm") => void;
  onLimitOverrideChange: (value: string) => void;
  onSaveChip: () => void;
  onToggleDefault: () => void;
  onToggleActive: () => void;
  onToggleWebhook: () => void;
  onDelete: () => void;
  onSyncNow?: () => void;
  canEdit: boolean;
  canManageOwner?: boolean;
  operatorOptions?: OperatorOption[];
  onOwnerChange?: (newOwnerUid: string | null) => void;
  isSavePending: boolean;
  isDeletePending: boolean;
  isSyncPending?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
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
  onToggleWebhook,
  onDelete,
  onSyncNow,
  canEdit,
  canManageOwner = false,
  operatorOptions = [],
  onOwnerChange,
  isSavePending,
  isDeletePending,
  isSyncPending = false,
  isExpanded,
  onToggleExpand,
}: EvolutionInstanceCardProps) {
  // Suporte a estado interno de expansão caso o pai não forneça controle
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = isExpanded !== undefined ? isExpanded : internalExpanded;
  const toggleExpand = onToggleExpand ?? (() => setInternalExpanded((prev) => !prev));

  const chipColor = getChipColor(instance.id);
  const displayLimit = resolveChipLimit(draft.chipState, draft.dailyLimitOverride);
  const sent = instance.sent_count_today ?? 0;
  const pct = displayLimit > 0 ? Math.min(100, Math.round((sent / displayLimit) * 100)) : 0;
  const barColor =
    pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-400" : "bg-emerald-500";

  const { data: syncProgress } = useEvolutionInstanceSyncStatus(tenantId, instance.id);
  const isSyncActive = isSyncPending || syncProgress?.status === "running";

  const assignedOperator = operatorOptions.find((op) => op.uid === instance.owner_uid);
  const operatorName = assignedOperator
    ? assignedOperator.displayName || assignedOperator.email || instance.owner_uid
    : instance.owner_uid || "Nenhum (compartilhado)";

  return (
    <div
      data-testid={`evolution-card-${instance.id}`}
      className={cn(
        "relative flex flex-col rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm hover:shadow-md transition-all duration-200 dark:border-white/10 dark:bg-white/[0.02]",
        // Faixa lateral com cor estável por chip
        "border-l-[5px]",
        chipColor.borderLeft
      )}
    >
      {/* 
        Cabeçalho resumido do cartão:
        Quando fechado, mostra estritamente os 4 campos essenciais:
        1. Nome do chip
        2. Estado da conexão
        3. Operador responsável
        4. Cota do dia no formato "enviados de limite"
      */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          {/* 1. Nome do chip com ponto de identificação estável */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span
              className={cn("h-2.5 w-2.5 rounded-full shrink-0", chipColor.dot)}
              title={`Chip: ${chipColor.name}`}
              aria-hidden="true"
            />
            <p
              className="truncate font-display font-semibold text-foreground text-sm"
              title={instance.name}
            >
              {instance.name}
            </p>
          </div>

          {/* 2. Estado da conexão (não misturado com a cor do chip) e botão de alternar */}
          <div className="flex items-center gap-1.5 shrink-0">
            <EvolutionInstanceStatusBadge tenantId={tenantId} instanceId={instance.id} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-slate-100 dark:hover:bg-white/5"
              onClick={toggleExpand}
              aria-expanded={expanded}
              aria-label={expanded ? `Recolher detalhes de ${instance.name}` : `Ver detalhes de ${instance.name}`}
              title={expanded ? "Recolher detalhes" : "Ver detalhes"}
            >
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform duration-200",
                  expanded && "rotate-180 text-foreground"
                )}
              />
            </Button>
          </div>
        </div>

        {/* 3. Operador Responsável */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
          <UserCheck className="h-3.5 w-3.5 shrink-0 text-sky-500" />
          <span className="truncate" title={`Operador responsável: ${operatorName}`}>
            {operatorName}
          </span>
        </div>

        {/* 4. Cota do dia no formato "enviados de limite" */}
        <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100 dark:border-white/5">
          <span className="text-muted-foreground">Cota hoje</span>
          <span className="font-num font-semibold text-foreground">
            {sent} de {displayLimit}
          </span>
        </div>
      </div>

      {/* 
        Conteúdo completo expandido:
        Tudo o que existia antes continua aqui dentro, abrindo dentro do próprio cartão.
      */}
      {expanded && (
        <div className="mt-3.5 pt-3.5 border-t border-slate-200/70 dark:border-white/10 space-y-3.5">
          {/* Badges de configuração e URL de Webhook */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
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
          </div>

          {/* Anti-ban: saúde do chip (cota diária detalhada com barra e ajuste) */}
          <div className="space-y-2 rounded-xl border border-slate-200/50 bg-slate-50/50 p-3 text-xs dark:border-white/5 dark:bg-white/[0.01]">
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
                <SelectTrigger className="h-8 w-[140px] text-xs rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="cold">Frio (50 msgs/dia)</SelectItem>
                  <SelectItem value="warm">Aquecido (500 msgs/dia)</SelectItem>
                </SelectContent>
              </Select>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Input
                    className="h-8 w-24 text-xs rounded-xl font-num"
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

          {/* Integração de Webhook (Inbox / Conversas) */}
          <div className="flex flex-col gap-2.5 rounded-xl border border-slate-200/50 bg-slate-50/50 p-3 text-xs dark:border-white/5 dark:bg-white/[0.01]">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <span className="font-semibold text-foreground">Sincronizar Conversas no CRM</span>
                <p className="text-[10px] text-muted-foreground">
                  Espelha em tempo real as mensagens recebidas e enviadas deste chip na aba "Conversas".
                </p>
              </div>
              <div className="flex items-center gap-2">
                {canEdit && onSyncNow && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg text-[11px]"
                    disabled={isSyncActive}
                    onClick={onSyncNow}
                    title="Importa o histórico de conversas deste chip para a aba Conversas"
                  >
                    <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isSyncActive && "animate-spin")} />
                    {syncProgress?.status === "running"
                      ? `Sincronizando (${syncProgress.processed_chats}/${syncProgress.total_chats || "..."})`
                      : isSyncPending
                        ? "Iniciando..."
                        : "Sincronizar agora"}
                  </Button>
                )}
                <Switch
                  checked={instance.webhook_enabled}
                  onCheckedChange={onToggleWebhook}
                  disabled={!canEdit || isSavePending}
                />
              </div>
            </div>

            {/* Progresso visível da sincronização em tempo real */}
            {syncProgress?.status === "running" && (
              <div className="mt-1 space-y-1.5 border-t border-slate-200/60 pt-2 dark:border-white/5">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Progresso: {syncProgress.processed_chats} de {syncProgress.total_chats} conversas
                  </span>
                  <span>
                    Lote {syncProgress.current_batch || 1} de {syncProgress.total_batches || 1}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                  <div
                    className="h-full bg-sky-500 transition-all duration-300"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          ((syncProgress.processed_chats || 0) / Math.max(1, syncProgress.total_chats || 1)) * 100
                        )
                      )}%`,
                    }}
                  />
                </div>
                <p className="text-[9px] text-muted-foreground">
                  {syncProgress.synced_chats} conversas sincronizadas ({syncProgress.inserted_messages} mensagens novas gravadas em lotes com pausa).
                </p>
              </div>
            )}

            {syncProgress?.status === "deferred" && syncProgress.blocked_by_campaign && (
              <div className="mt-1 rounded-lg bg-amber-500/10 p-2 text-[10px] text-amber-700 dark:text-amber-400">
                ⚠️ Sincronização em espera: a campanha "{syncProgress.blocked_by_campaign}" está em disparo ativo neste tenant.
              </div>
            )}

            {syncProgress?.status === "completed" && syncProgress.synced_chats > 0 && (
              <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
                ✓ Histórico sincronizado: {syncProgress.synced_chats} conversas ({syncProgress.inserted_messages} mensagens).
              </p>
            )}
          </div>

          {/* Atribuição de Leads: Operador Responsável (Edição/Configuração) */}
          <div className="flex flex-col gap-2 rounded-xl border border-slate-200/50 bg-slate-50/50 p-3 text-xs dark:border-white/5 dark:bg-white/[0.01]">
            <div className="space-y-0.5">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <UserCheck className="h-3.5 w-3.5 text-sky-500" />
                Operador Responsável
              </span>
              <p className="text-[10px] text-muted-foreground">
                Novos leads deste chip serão atribuídos automaticamente a este operador.
              </p>
            </div>
            <div className="flex items-center gap-2 pt-1">
              {canManageOwner && onOwnerChange ? (
                <Select
                  value={instance.owner_uid || "none"}
                  onValueChange={(val) => onOwnerChange(val === "none" ? null : val)}
                  disabled={isSavePending || !canEdit}
                >
                  <SelectTrigger className="h-8 w-full text-xs rounded-xl bg-background">
                    <SelectValue placeholder="Selecione um operador" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="none">Nenhum (compartilhado)</SelectItem>
                    {operatorOptions.map((op) => (
                      <SelectItem key={op.uid} value={op.uid}>
                        {op.displayName || op.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant="outline" className="text-xs py-1 px-2.5 font-normal rounded-lg">
                  {instance.owner_uid
                    ? operatorOptions.find((op) => op.uid === instance.owner_uid)?.displayName ||
                      operatorOptions.find((op) => op.uid === instance.owner_uid)?.email ||
                      instance.owner_uid
                    : "Nenhum (compartilhado)"}
                </Badge>
              )}
            </div>
          </div>

          {/* Ações de gerenciamento do chip */}
          {canEdit && (
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-white/5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-xl text-xs h-8 flex-1 sm:flex-none"
                disabled={isSavePending || instance.is_default}
                onClick={onToggleDefault}
              >
                Tornar Padrão
              </Button>
              <Button
                type="button"
                variant={instance.active ? "outline" : "default"}
                size="sm"
                className="rounded-xl text-xs h-8 flex-1 sm:flex-none"
                disabled={isSavePending}
                onClick={onToggleActive}
              >
                {instance.active ? "Desativar" : "Ativar"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-xl text-xs h-8 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20 flex-1 sm:flex-none"
                disabled={isDeletePending}
                onClick={onDelete}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Remover
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
