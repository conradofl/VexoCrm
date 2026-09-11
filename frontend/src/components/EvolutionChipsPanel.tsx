import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminUsers } from "@/hooks/useAdminUsers";
import {
  useDeleteLeadClientEvolutionInstance,
  useProvisionLeadClientEvolutionInstance,
  useSaveLeadClientEvolutionInstance,
  useSyncLeadClientEvolutionInstance,
  type LeadClient,
  type LeadClientEvolutionInstance,
} from "@/hooks/useLeadClients";
import {
  EvolutionInstanceCard,
  CreateEvolutionForm,
  QRCodeModal,
} from "./evolutionChips";

interface Props {
  tenant: LeadClient;
  canEdit?: boolean;
}

export function EvolutionChipsPanel({ tenant, canEdit = true }: Props) {
  const { isAdminUser, canAccessInternalPage } = useAuth();
  const canManageOwner = canEdit && (isAdminUser || canAccessInternalPage("usuarios"));
  const adminUsersQuery = useAdminUsers();

  const operatorOptions = useMemo(() => {
    if (!adminUsersQuery.data) return [];
    return adminUsersQuery.data.filter(
      (u) =>
        u.access?.role === "internal" &&
        (!tenant.id || u.access.clientId === tenant.id || u.access.clientIds?.includes(tenant.id))
    );
  }, [adminUsersQuery.data, tenant.id]);

  const saveEvolutionInstance = useSaveLeadClientEvolutionInstance();
  const provisionEvolutionInstance = useProvisionLeadClientEvolutionInstance();
  const deleteEvolutionInstance = useDeleteLeadClientEvolutionInstance();
  const syncEvolutionInstance = useSyncLeadClientEvolutionInstance(tenant.id);
  const queryClientRef = useQueryClient();
  const [syncingInstanceId, setSyncingInstanceId] = useState<string | null>(null);

  // Importa o histórico de conversas do chip para a aba Conversas, sob comando
  // explícito do usuário (antes dependia de efeito colateral do toggle e o
  // segundo chip nunca sincronizava).
  const handleSyncInstance = async (instance: LeadClientEvolutionInstance) => {
    setSyncingInstanceId(instance.id);
    try {
      const res = await syncEvolutionInstance.mutateAsync(instance.id);
      if (res?.deferred) {
        toast({
          title: "Sincronização adiada",
          description:
            res.message ||
            `A campanha "${res.campaignName}" está em disparo ativo. Aguarde a finalização do disparo para sincronizar.`,
          variant: "destructive",
        });
        return;
      }
      if (res?.running) {
        toast({
          title: "Sincronização em andamento",
          description:
            res.message ||
            `Este chip já possui uma sincronização em andamento (${res.progress?.processed_chats || 0}/${res.progress?.total_chats || 0} conversas).`,
        });
        return;
      }
      toast({
        title: "Sincronização iniciada",
        description: `${instance.name}: importando o histórico em lotes com proteção contra sobrecarga. O progresso é exibido no card.`,
      });
      // Recarrega a lista depois de um tempo, já com parte do histórico.
      setTimeout(() => {
        queryClientRef.invalidateQueries({ queryKey: ["whatsapp-chats"] });
      }, 10000);
    } catch (e) {
      toast({
        title: "Falha ao sincronizar",
        description: e instanceof Error ? e.message : "Não foi possível importar as conversas deste chip.",
        variant: "destructive",
      });
    } finally {
      setSyncingInstanceId(null);
    }
  };

  const [chipDrafts, setChipDrafts] = useState<
    Record<string, { chipState?: "cold" | "warm"; dailyLimitOverride?: string }>
  >({});
  const [evolutionDrafts, setEvolutionDrafts] = useState<
    Record<string, { name?: string; dispatchWebhookUrl?: string; dispatchWebhookToken?: string; active?: boolean; isDefault?: boolean }>
  >({});
  const [qrModal, setQrModal] = useState<{ base64: string; tenantName: string; instanceName: string | null; instanceId: string | null } | null>(null);
  const [createMode, setCreateMode] = useState<"provision" | "manual">("provision");

  const evolutionInstances: LeadClientEvolutionInstance[] = tenant.n8n_settings?.evolution_instances ?? [];

  // Chip draft helpers
  const getChipDraft = (instance: LeadClientEvolutionInstance) => {
    const draft = chipDrafts[instance.id] ?? {};
    return {
      chipState: draft.chipState ?? instance.chip_state ?? "cold" as const,
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
    const limitNum = draft.dailyLimitOverride.trim() ? parseInt(draft.dailyLimitOverride, 10) : null;
    const dailyLimitOverride = limitNum != null && Number.isInteger(limitNum) && limitNum > 0 ? limitNum : null;
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

  // Instance action helpers
  const handleUpdateEvolutionInstance = async (
    instance: LeadClientEvolutionInstance,
    patch: { active?: boolean; isDefault?: boolean; webhookEnabled?: boolean; ownerUid?: string | null }
  ) => {
    try {
      const salva = await saveEvolutionInstance.mutateAsync({
        tenantId: tenant.id,
        instanceId: instance.id,
        name: instance.name,
        dispatchWebhookUrl: instance.dispatch_webhook_url ?? "",
        active: patch.active ?? instance.active,
        isDefault: patch.isDefault ?? instance.is_default,
        webhookEnabled: patch.webhookEnabled ?? instance.webhook_enabled,
        ownerUid: patch.ownerUid !== undefined ? patch.ownerUid : (instance.owner_uid ?? null),
      });
      // O chip salvou, mas a Evolution pode ter recusado o webhook. Antes isso
      // so aparecia no log do servidor e o numero ficava mudo sem aviso.
      if (salva?.webhook_error) {
        toast({
          title: "Chip salvo, mas o webhook falhou",
          description: salva.webhook_error,
          variant: "destructive",
        });
        return;
      }
      toast({
        title: patch.isDefault
          ? "Evolution padrao atualizada"
          : patch.webhookEnabled !== undefined
            ? "Integração de webhook atualizada"
            : patch.ownerUid !== undefined
              ? "Operador responsável atualizado"
              : "Evolution atualizada",
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

  // Add-instance form helpers
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
          instanceId: result.item?.id ?? null,
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
              return (
                <EvolutionInstanceCard
                  key={instance.id}
                  tenantId={tenant.id}
                  instance={instance}
                  draft={draft}
                  onChipStateChange={(v) => updateChipDraft(instance.id, { chipState: v })}
                  onLimitOverrideChange={(v) => updateChipDraft(instance.id, { dailyLimitOverride: v })}
                  onSaveChip={() => void handleSaveChipSettings(instance)}
                  onToggleDefault={() => void handleUpdateEvolutionInstance(instance, { isDefault: true })}
                  onToggleActive={() => void handleUpdateEvolutionInstance(instance, { active: !instance.active })}
                  onToggleWebhook={() => void handleUpdateEvolutionInstance(instance, { webhookEnabled: !instance.webhook_enabled })}
                  onDelete={() => void handleDeleteEvolutionInstance(instance)}
                  onSyncNow={() => void handleSyncInstance(instance)}
                  canEdit={canEdit}
                  canManageOwner={canManageOwner}
                  operatorOptions={operatorOptions}
                  onOwnerChange={(newOwnerUid) => void handleUpdateEvolutionInstance(instance, { ownerUid: newOwnerUid })}
                  isSavePending={saveEvolutionInstance.isPending}
                  isDeletePending={deleteEvolutionInstance.isPending}
                  isSyncPending={syncingInstanceId === instance.id}
                />
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300/80 bg-white/70 px-4 py-6 text-sm text-center text-muted-foreground dark:border-white/10 dark:bg-white/[0.01]">
            Nenhuma conexão de chip cadastrada. Use o formulário abaixo para parear ou adicionar uma nova.
          </div>
        )}

        {canEdit && (
          <CreateEvolutionForm
            createMode={createMode}
            evolutionDraft={evolutionDraft}
            onModeChange={setCreateMode}
            onUpdateDraft={updateEvolutionDraft}
            onCreateEvolution={() => void handleCreateEvolutionInstance()}
            onProvisionEvolution={() => void handleProvisionEvolutionInstance()}
            isCreatePending={saveEvolutionInstance.isPending}
            isProvisionPending={provisionEvolutionInstance.isPending}
          />
        )}
      </div>

      <QRCodeModal open={!!qrModal} tenantId={tenant.id} qrModal={qrModal} onClose={() => setQrModal(null)} />
    </>
  );
}
