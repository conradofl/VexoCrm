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

  const [createMode, setCreateMode] = useState<"provision" | "manual">("provision");

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
      <div className="grid gap-4 rounded-2xl border border-slate-200/60 bg-slate-50/50 p-5 dark:border-white/10 dark:bg-white/[0.02]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/60 dark:border-white/10 pb-3 mb-2">
          <div>
            <p className="text-base font-bold font-display text-foreground">Chips WhatsApp Conectados</p>
            <p className="text-xs text-muted-foreground">
              Chips de WhatsApp vinculados a esta empresa. Cada chip possui cota diária e rotação automática.
            </p>
          </div>
          <Badge className="border border-slate-200 bg-white text-slate-700 rounded-xl dark:border-white/5 dark:bg-white/[0.05] dark:text-white/80 font-num">
            {evolutionInstances.length} {evolutionInstances.length === 1 ? "conexão" : "conexões"}
          </Badge>
        </div>

        {evolutionInstances.length > 0 ? (
          <div className="grid gap-3">
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
                          onValueChange={(v) =>
                            updateChipDraft(instance.id, { chipState: v as "cold" | "warm" })
                          }
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
                              onChange={(e) =>
                                updateChipDraft(instance.id, { dailyLimitOverride: e.target.value })
                              }
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
                            disabled={saveEvolutionInstance.isPending}
                            onClick={() => void handleSaveChipSettings(instance)}
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
                        disabled={saveEvolutionInstance.isPending || instance.is_default}
                        onClick={() => void handleUpdateEvolutionInstance(instance, { isDefault: true })}
                      >
                        Tornar Padrão
                      </Button>
                      <Button
                        type="button"
                        variant={instance.active ? "outline" : "default"}
                        size="sm"
                        className="rounded-xl text-xs h-9 w-full lg:w-28"
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
                        className="rounded-xl text-xs h-9 w-full lg:w-28 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20"
                        disabled={deleteEvolutionInstance.isPending}
                        onClick={() => void handleDeleteEvolutionInstance(instance)}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                        Remover
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300/80 bg-white/70 px-4 py-6 text-sm text-center text-muted-foreground dark:border-white/10 dark:bg-white/[0.01]">
            Nenhuma conexão de chip cadastrada. Use o formulário abaixo para parear ou adicionar uma nova.
          </div>
        )}

        {canEdit && (
          <div className="grid gap-4 rounded-2xl border border-slate-200/60 bg-white/80 p-5 mt-4 dark:border-white/5 dark:bg-white/[0.03]">
            {/* Abas Internas de Criação (Linearidade e Organização) */}
            <div className="flex border-b border-slate-200/60 dark:border-white/10 pb-2 gap-2">
              <button
                type="button"
                onClick={() => setCreateMode("provision")}
                className={cn(
                  "pb-2 px-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all font-display",
                  createMode === "provision"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                Conectar Novo Chip (Automático)
              </button>
              <button
                type="button"
                onClick={() => setCreateMode("manual")}
                className={cn(
                  "pb-2 px-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all font-display",
                  createMode === "manual"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                Vincular Manualmente
              </button>
            </div>

            {createMode === "provision" ? (
              /* ABA A: Criar com QR Code automático */
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                  <div className="grid gap-1.5">
                    <label className="text-xs font-semibold text-foreground">Identificador do Chip</label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Input
                          className="rounded-xl h-10"
                          placeholder="Ex: chip-vendas-financeiro"
                          value={evolutionDraft.name}
                          onChange={(e) => updateEvolutionDraft({ name: e.target.value })}
                        />
                      </TooltipTrigger>
                      <TooltipContent>Escolha um nome simples para identificar este chip no Vexo OS</TooltipContent>
                    </Tooltip>
                    <p className="px-1 text-[10px] text-muted-foreground">
                      Espaços viram hifen ao criar (ex.: "Chip Vendas" → "chip-vendas").
                    </p>
                  </div>
                  <div className="grid gap-1.5">
                    <label className="text-xs font-semibold text-foreground">Chave de API Secundária (Opcional)</label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Input
                          className="rounded-xl h-10"
                          placeholder="Chave customizada para segurança"
                          value={evolutionDraft.dispatchWebhookToken}
                          onChange={(e) => updateEvolutionDraft({ dispatchWebhookToken: e.target.value })}
                        />
                      </TooltipTrigger>
                      <TooltipContent>Chave secreta para autorização na Evolution API (opcional)</TooltipContent>
                    </Tooltip>
                    <p className="px-1 text-[10px] text-muted-foreground">
                      O sistema auto-gera uma chave segura se deixada em branco.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <div className="flex items-center gap-4">
                    <label className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        className="rounded border-slate-300 text-primary focus:ring-primary h-4 w-4"
                        checked={evolutionDraft.active}
                        onChange={(e) => updateEvolutionDraft({ active: e.target.checked })}
                      />
                      Chip Ativo
                    </label>
                    <label className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        className="rounded border-slate-300 text-primary focus:ring-primary h-4 w-4"
                        checked={evolutionDraft.isDefault}
                        onChange={(e) => updateEvolutionDraft({ isDefault: e.target.checked })}
                      />
                      Tornar Padrão de Envio
                    </label>
                  </div>
                  <Button
                    type="button"
                    variant="default"
                    className="rounded-xl px-5 h-10"
                    disabled={provisionEvolutionInstance.isPending}
                    onClick={() => void handleProvisionEvolutionInstance()}
                  >
                    <Wand2 className="mr-2 h-4 w-4 animate-pulse" />
                    {provisionEvolutionInstance.isPending ? "Conectando..." : "Gerar QR Code de Pareamento"}
                  </Button>
                </div>
              </div>
            ) : (
              /* ABA B: Vinculação manual para dev/infra existente */
              <div className="space-y-4">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)_minmax(0,0.8fr)]">
                  <div className="grid gap-1.5">
                    <label className="text-xs font-semibold text-foreground">Identificador do Chip</label>
                    <Input
                      className="rounded-xl h-10"
                      placeholder="Ex: chip-suporte-manual"
                      value={evolutionDraft.name}
                      onChange={(e) => updateEvolutionDraft({ name: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <label className="text-xs font-semibold text-foreground">URL de Disparo Evolution</label>
                    <Input
                      className="rounded-xl h-10"
                      placeholder="https://.../message/sendText/Instancia"
                      value={evolutionDraft.dispatchWebhookUrl}
                      onChange={(e) => updateEvolutionDraft({ dispatchWebhookUrl: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <label className="text-xs font-semibold text-foreground">API Key da Conexão</label>
                    <Input
                      className="rounded-xl h-10"
                      placeholder="Chave do header apikey"
                      value={evolutionDraft.dispatchWebhookToken}
                      onChange={(e) => updateEvolutionDraft({ dispatchWebhookToken: e.target.value })}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <div className="flex items-center gap-4">
                    <label className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        className="rounded border-slate-300 text-primary focus:ring-primary h-4 w-4"
                        checked={evolutionDraft.active}
                        onChange={(e) => updateEvolutionDraft({ active: e.target.checked })}
                      />
                      Chip Ativo
                    </label>
                    <label className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        className="rounded border-slate-300 text-primary focus:ring-primary h-4 w-4"
                        checked={evolutionDraft.isDefault}
                        onChange={(e) => updateEvolutionDraft({ isDefault: e.target.checked })}
                      />
                      Tornar Padrão de Envio
                    </label>
                  </div>
                  <Button
                    type="button"
                    variant="default"
                    className="rounded-xl px-5 h-10"
                    disabled={saveEvolutionInstance.isPending || !evolutionDraft.dispatchWebhookUrl.trim()}
                    onClick={() => void handleCreateEvolutionInstance()}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {saveEvolutionInstance.isPending ? "Adicionando..." : "Vincular Conexão Existente"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal de QR — pareamento da instância recém-criada */}
      <Dialog open={!!qrModal} onOpenChange={(open) => !open && setQrModal(null)}>
        <DialogContent className="sm:max-w-md rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-bold">Parear WhatsApp</DialogTitle>
            <DialogDescription className="text-xs">
              Siga as instruções abaixo para vincular o chip <strong>{qrModal?.instanceName ?? "da empresa"}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            {qrModal?.base64 && (
              <div className="p-3 bg-white border border-slate-200/80 rounded-2xl shadow-sm dark:border-white/10">
                <img
                  src={qrModal.base64}
                  alt="QR Code para parear o WhatsApp"
                  className="h-60 w-60 rounded-xl"
                />
              </div>
            )}
            <div className="text-center text-sm space-y-2">
              <p className="font-medium text-foreground text-xs">
                No celular, abra o WhatsApp &gt; Aparelhos conectados &gt; Conectar um aparelho
              </p>
              <p className="text-[11px] text-muted-foreground px-4">
                O QR Code expira rapidamente. Se necessário, feche este modal, remova a conexão criada e gere um novo QR Code.
              </p>
            </div>
          </div>
          <DialogFooter className="sm:justify-center">
            <Button type="button" variant="outline" className="rounded-xl w-full sm:w-28" onClick={() => setQrModal(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
