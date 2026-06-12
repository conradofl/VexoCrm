import { useState } from "react";
import { Plus, Save, Trash2, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/use-toast";
import {
  useDeleteLeadClientEvolutionInstance,
  useProvisionLeadClientEvolutionInstance,
  useSaveLeadClientEvolutionInstance,
  type LeadClient,
  type LeadClientEvolutionInstance,
} from "@/hooks/useLeadClients";

interface Props {
  tenant: LeadClient;
  canEdit?: boolean;
}

function resolveChipLimit(chipState: "cold" | "warm", overrideStr?: string): number {
  const parsed = overrideStr ? parseInt(overrideStr, 10) : NaN;
  if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  return chipState === "warm" ? 500 : 100;
}

export function EvolutionChipsPanel({ tenant, canEdit = true }: Props) {
  const saveEvolutionInstance = useSaveLeadClientEvolutionInstance();
  const provisionEvolutionInstance = useProvisionLeadClientEvolutionInstance();
  const deleteEvolutionInstance = useDeleteLeadClientEvolutionInstance();

  const [chipDrafts, setChipDrafts] = useState<
    Record<string, { chipState?: "cold" | "warm"; dailyLimitOverride?: string }>
  >({});
  const [evolutionDrafts, setEvolutionDrafts] = useState<
    Record<
      string,
      {
        name?: string;
        dispatchWebhookUrl?: string;
        dispatchWebhookToken?: string;
        active?: boolean;
        isDefault?: boolean;
      }
    >
  >({});
  const [qrModal, setQrModal] = useState<{
    base64: string;
    tenantName: string;
    instanceName: string | null;
  } | null>(null);

  const evolutionInstances: LeadClientEvolutionInstance[] =
    tenant.n8n_settings?.evolution_instances ?? [];

  // ─── chip draft helpers ─────────────────────────────────────────────────────

  const getChipDraft = (instance: LeadClientEvolutionInstance) => {
    const draft = chipDrafts[instance.id] ?? {};
    return {
      chipState: draft.chipState ?? instance.chip_state ?? "cold",
      dailyLimitOverride:
        draft.dailyLimitOverride !== undefined
          ? draft.dailyLimitOverride
          : instance.daily_limit_override != null
            ? String(instance.daily_limit_override)
            : "",
    };
  };

  const updateChipDraft = (
    instanceId: string,
    patch: { chipState?: "cold" | "warm"; dailyLimitOverride?: string }
  ) => {
    setChipDrafts((cur) => ({ ...cur, [instanceId]: { ...cur[instanceId], ...patch } }));
  };

  const handleSaveChipSettings = async (instance: LeadClientEvolutionInstance) => {
    const draft = getChipDraft(instance);
    const limitNum = draft.dailyLimitOverride.trim()
      ? parseInt(draft.dailyLimitOverride, 10)
      : null;
    const dailyLimitOverride =
      limitNum != null && Number.isInteger(limitNum) && limitNum > 0 ? limitNum : null;
    try {
      await saveEvolutionInstance.mutateAsync({
        tenantId: tenant.id,
        instanceId: instance.id,
        name: instance.name,
        dispatchWebhookUrl: instance.dispatch_webhook_url ?? "",
        chipState: draft.chipState,
        dailyLimitOverride,
      });
      setChipDrafts((cur) => {
        const next = { ...cur };
        delete next[instance.id];
        return next;
      });
      toast({ title: "Cota atualizada", description: `${tenant.name}: ${instance.name}` });
    } catch (err) {
      toast({
        title: "Falha ao salvar cota",
        description: err instanceof Error ? err.message : "Nao foi possivel salvar.",
        variant: "destructive",
      });
    }
  };

  // ─── instance action helpers ─────────────────────────────────────────────────

  const handleUpdateEvolutionInstance = async (
    instance: LeadClientEvolutionInstance,
    patch: { active?: boolean; isDefault?: boolean }
  ) => {
    try {
      await saveEvolutionInstance.mutateAsync({
        tenantId: tenant.id,
        instanceId: instance.id,
        name: instance.name,
        dispatchWebhookUrl: instance.dispatch_webhook_url ?? "",
        active: patch.active ?? instance.active,
        isDefault: patch.isDefault ?? instance.is_default,
      });
      toast({
        title: patch.isDefault ? "Evolution padrao atualizada" : "Evolution atualizada",
        description: `${tenant.name}: ${instance.name}`,
      });
    } catch (err) {
      toast({
        title: "Falha ao atualizar Evolution",
        description: err instanceof Error ? err.message : "Nao foi possivel atualizar a instancia.",
        variant: "destructive",
      });
    }
  };

  const handleDeleteEvolutionInstance = async (instance: LeadClientEvolutionInstance) => {
    try {
      await deleteEvolutionInstance.mutateAsync({ tenantId: tenant.id, instanceId: instance.id });
      toast({ title: "Evolution removida", description: `${tenant.name}: ${instance.name}` });
    } catch (err) {
      toast({
        title: "Falha ao remover Evolution",
        description: err instanceof Error ? err.message : "Nao foi possivel remover a instancia.",
        variant: "destructive",
      });
    }
  };

  // ─── add-instance form helpers ───────────────────────────────────────────────

  const getEvolutionDraft = () => {
    const draft = evolutionDrafts[tenant.id] ?? {};
    return {
      name: draft.name ?? "",
      dispatchWebhookUrl: draft.dispatchWebhookUrl ?? "",
      dispatchWebhookToken: draft.dispatchWebhookToken ?? "",
      active: draft.active ?? true,
      isDefault: draft.isDefault ?? false,
    };
  };

  const updateEvolutionDraft = (patch: {
    name?: string;
    dispatchWebhookUrl?: string;
    dispatchWebhookToken?: string;
    active?: boolean;
    isDefault?: boolean;
  }) => {
    setEvolutionDrafts((cur) => ({
      ...cur,
      [tenant.id]: { ...cur[tenant.id], ...patch },
    }));
  };

  const clearEvolutionDraft = () => {
    setEvolutionDrafts((cur) => ({
      ...cur,
      [tenant.id]: { name: "", dispatchWebhookUrl: "", dispatchWebhookToken: "", active: true, isDefault: false },
    }));
  };

  const handleCreateEvolutionInstance = async () => {
    const draft = getEvolutionDraft();
    try {
      await saveEvolutionInstance.mutateAsync({
        tenantId: tenant.id,
        name: draft.name.trim() || "Evolution",
        dispatchWebhookUrl: draft.dispatchWebhookUrl.trim(),
        dispatchWebhookToken: draft.dispatchWebhookToken.trim() || undefined,
        active: draft.active,
        isDefault: draft.isDefault,
      });
      clearEvolutionDraft();
      toast({ title: "Evolution adicionada", description: `Instancia vinculada a ${tenant.name}.` });
    } catch (err) {
      toast({
        title: "Falha ao adicionar Evolution",
        description: err instanceof Error ? err.message : "Nao foi possivel adicionar a instancia.",
        variant: "destructive",
      });
    }
  };

  const handleProvisionEvolutionInstance = async () => {
    const draft = getEvolutionDraft();
    try {
      const result = await provisionEvolutionInstance.mutateAsync({
        tenantId: tenant.id,
        name: draft.name.trim() || tenant.name || "Evolution",
        dispatchWebhookToken: draft.dispatchWebhookToken.trim() || undefined,
        active: draft.active,
        isDefault: draft.isDefault,
      });
      clearEvolutionDraft();
      const qrBase64 = result.evolution?.qrcode?.base64 ?? null;
      if (qrBase64) {
        setQrModal({
          base64: qrBase64,
          tenantName: tenant.name,
          instanceName: result.evolution?.instanceName ?? result.item?.name ?? null,
        });
      } else {
        toast({
          title: "Evolution criada",
          description: `Instancia vinculada a ${tenant.name}, mas a Evolution nao retornou QR. Tente remover e criar de novo.`,
        });
      }
    } catch (err) {
      toast({
        title: "Falha ao criar na Evolution",
        description: err instanceof Error ? err.message : "Nao foi possivel criar a instancia na Evolution API.",
        variant: "destructive",
      });
    }
  };

  const evolutionDraft = getEvolutionDraft();

  // ─── render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="grid gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-foreground">Instancias Evolution</p>
            <p className="text-xs text-muted-foreground">
              Chips WhatsApp vinculados a este tenant. Cada chip tem cota diaria independente.
            </p>
          </div>
          <Badge className="border border-slate-300/80 bg-white/90 text-slate-700 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/80">
            {evolutionInstances.length} instancia{evolutionInstances.length === 1 ? "" : "s"}
          </Badge>
        </div>

        {evolutionInstances.length > 0 ? (
          <div className="grid gap-2">
            {evolutionInstances.map((instance) => {
              const draft = getChipDraft(instance);
              const displayLimit = resolveChipLimit(draft.chipState, draft.dailyLimitOverride);
              const sent = instance.sent_count_today ?? 0;
              const pct = displayLimit > 0 ? Math.min(100, Math.round((sent / displayLimit) * 100)) : 0;
              const barColor =
                pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-400" : "bg-emerald-500";

              return (
                <div
                  key={instance.id}
                  className="grid gap-3 rounded-xl border border-slate-200/80 bg-white/85 p-3 text-sm dark:border-white/10 dark:bg-white/[0.04] lg:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="max-w-[200px] truncate font-medium text-foreground">
                            {instance.name}
                          </p>
                        </TooltipTrigger>
                        <TooltipContent>{instance.name}</TooltipContent>
                      </Tooltip>
                      {instance.is_default ? (
                        <Badge className="border border-cyan-400/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200">
                          padrao
                        </Badge>
                      ) : null}
                      <Badge
                        className={
                          instance.active
                            ? "border border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
                            : "border border-slate-300/80 bg-white/90 text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/65"
                        }
                      >
                        {instance.active ? "ativa" : "inativa"}
                      </Badge>
                      {instance.has_dispatch_webhook_token ? (
                        <Badge className="border border-violet-400/25 bg-violet-500/10 text-violet-700 dark:text-violet-200">
                          api key
                        </Badge>
                      ) : null}
                    </div>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {instance.dispatch_webhook_url ?? "—"}
                        </p>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs break-all">
                        {instance.dispatch_webhook_url ?? "URL nao definida"}
                      </TooltipContent>
                    </Tooltip>

                    {/* Anti-ban: saúde do chip (cota diária) */}
                    <div className="mt-1 space-y-2 rounded-lg border border-slate-200/70 bg-slate-50/60 p-2.5 text-xs dark:border-white/10 dark:bg-white/[0.03]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">Enviadas hoje</span>
                        <span className="font-mono font-semibold text-foreground">
                          {sent} / {displayLimit}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                        <div
                          className={cn("h-full rounded-full transition-all duration-300", barColor)}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        <Select
                          value={draft.chipState}
                          onValueChange={(v) =>
                            updateChipDraft(instance.id, { chipState: v as "cold" | "warm" })
                          }
                          disabled={!canEdit}
                        >
                          <SelectTrigger className="h-7 w-[130px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cold">Frio (100/dia)</SelectItem>
                            <SelectItem value="warm">Aquecido (500/dia)</SelectItem>
                          </SelectContent>
                        </Select>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Input
                              className="h-7 w-24 text-xs"
                              placeholder="Limite custom"
                              title="Limite customizado de mensagens por dia"
                              type="number"
                              min="1"
                              disabled={!canEdit}
                              value={draft.dailyLimitOverride}
                              onChange={(e) =>
                                updateChipDraft(instance.id, { dailyLimitOverride: e.target.value })
                              }
                            />
                          </TooltipTrigger>
                          <TooltipContent>Limite customizado de mensagens por dia</TooltipContent>
                        </Tooltip>
                        {canEdit && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={saveEvolutionInstance.isPending}
                            onClick={() => void handleSaveChipSettings(instance)}
                          >
                            <Save className="mr-1 h-3 w-3" />
                            Salvar cota
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  {canEdit && (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={saveEvolutionInstance.isPending || instance.is_default}
                        onClick={() => void handleUpdateEvolutionInstance(instance, { isDefault: true })}
                      >
                        Padrao
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={saveEvolutionInstance.isPending}
                        onClick={() =>
                          void handleUpdateEvolutionInstance(instance, { active: !instance.active })
                        }
                      >
                        {instance.active ? "Desativar" : "Ativar"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={deleteEvolutionInstance.isPending}
                        onClick={() => void handleDeleteEvolutionInstance(instance)}
                      >
                        <Trash2 className="h-4 w-4" />
                        Remover
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300/80 bg-white/70 px-3 py-4 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/[0.03]">
            Nenhuma instancia cadastrada. Use o formulario abaixo para adicionar um chip.
          </div>
        )}

        {canEdit && (
          <div className="grid gap-3 rounded-xl border border-slate-200/80 bg-white/80 p-3 dark:border-white/10 dark:bg-white/[0.04]">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.4fr)_minmax(0,0.8fr)]">
              <div className="grid gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Input
                      placeholder="Nome da instancia"
                      title="Nome da instancia (ex: Chip Vendas)"
                      value={evolutionDraft.name}
                      onChange={(e) => updateEvolutionDraft({ name: e.target.value })}
                    />
                  </TooltipTrigger>
                  <TooltipContent>Nome da instancia (ex: Chip Vendas)</TooltipContent>
                </Tooltip>
                <p className="px-1 text-[11px] text-muted-foreground">
                  Espacos viram hifen ao criar (ex.: "Chip Vendas" → "chip-vendas").
                </p>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Input
                    placeholder="URL de disparo Evolution"
                    title="URL de disparo Evolution (ex: https://.../message/sendText/Instancia)"
                    value={evolutionDraft.dispatchWebhookUrl}
                    onChange={(e) => updateEvolutionDraft({ dispatchWebhookUrl: e.target.value })}
                  />
                </TooltipTrigger>
                <TooltipContent>URL de disparo Evolution (ex: https://…/message/sendText/Instancia)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Input
                    placeholder="API Key Evolution"
                    title="API Key Evolution (apikey do header)"
                    value={evolutionDraft.dispatchWebhookToken}
                    onChange={(e) => updateEvolutionDraft({ dispatchWebhookToken: e.target.value })}
                  />
                </TooltipTrigger>
                <TooltipContent>API Key Evolution (apikey do header)</TooltipContent>
              </Tooltip>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={evolutionDraft.active}
                    onChange={(e) => updateEvolutionDraft({ active: e.target.checked })}
                  />
                  ativa
                </label>
                <label className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={evolutionDraft.isDefault}
                    onChange={(e) => updateEvolutionDraft({ isDefault: e.target.checked })}
                  />
                  tornar padrao
                </label>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={provisionEvolutionInstance.isPending}
                  onClick={() => void handleProvisionEvolutionInstance()}
                >
                  <Wand2 className="h-4 w-4" />
                  {provisionEvolutionInstance.isPending ? "Criando..." : "Criar na Evolution"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={saveEvolutionInstance.isPending || !evolutionDraft.dispatchWebhookUrl.trim()}
                  onClick={() => void handleCreateEvolutionInstance()}
                >
                  <Plus className="h-4 w-4" />
                  {saveEvolutionInstance.isPending ? "Adicionando..." : "Adicionar manual"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal de QR — pareamento da instância recém-criada */}
      <Dialog open={!!qrModal} onOpenChange={(open) => !open && setQrModal(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Parear WhatsApp</DialogTitle>
            <DialogDescription>
              Instancia{qrModal?.instanceName ? ` "${qrModal.instanceName}"` : ""} criada para{" "}
              {qrModal?.tenantName ?? "a empresa"}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-2">
            {qrModal?.base64 && (
              <img
                src={qrModal.base64}
                alt="QR Code para parear o WhatsApp"
                className="h-64 w-64 rounded-xl border border-slate-200 bg-white p-2 dark:border-white/10"
              />
            )}
            <div className="text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                Escaneie em WhatsApp &gt; Aparelhos conectados
              </p>
              <p className="mt-2 text-xs">
                O QR expira em poucos minutos. Se expirar antes de escanear, use{" "}
                <span className="font-semibold">Remover</span> e crie a instancia de novo.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setQrModal(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
