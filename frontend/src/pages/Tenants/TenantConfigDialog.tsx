import { useState } from "react";
import { Database, Save, Trash2 } from "lucide-react";
import { EvolutionChipsPanel } from "@/components/EvolutionChipsPanel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  LeadClient,
  useDeleteLeadClient,
  useUpdateLeadClientN8nSettings,
  useVerifyLeadClientTable,
  type LeadClientTableStatus,
} from "@/hooks/useLeadClients";
import { ALL_TAB_KEYS, TABS_HIERARCHY } from "@/lib/tenants/constants";

interface TenantConfigDialogProps {
  tenant: LeadClient | null;
  onClose: () => void;
  tableStatuses: Record<string, LeadClientTableStatus>;
  setTableStatuses: React.Dispatch<React.SetStateAction<Record<string, LeadClientTableStatus>>>;
}

export function TenantConfigDialog({ tenant, onClose, tableStatuses, setTableStatuses }: TenantConfigDialogProps) {
  const { hasPermission, isAdminUser } = useAuth();
  const deleteTenant = useDeleteLeadClient();
  const updateN8nSettings = useUpdateLeadClientN8nSettings();
  const verifyTenantTable = useVerifyLeadClientTable();
  const [tenantPendingDelete, setTenantPendingDelete] = useState<string | null>(null);
  const [n8nDrafts, setN8nDrafts] = useState<
    Record<
      string,
      {
        dispatchWebhookUrl?: string;
        dispatchWebhookToken?: string;
        inboundBearerToken?: string;
        active?: boolean;
        allowedTabs?: string[] | null;
      }
    >
  >({});
  const canManageTenants = hasPermission("tenants.manage");
  const canManageN8n = isAdminUser;

  const updateTenantN8nDraft = (
    tenantId: string,
    patch: {
      dispatchWebhookUrl?: string;
      dispatchWebhookToken?: string;
      inboundBearerToken?: string;
      active?: boolean;
      allowedTabs?: string[] | null;
    }
  ) => {
    setN8nDrafts((current) => ({
      ...current,
      [tenantId]: {
        ...current[tenantId],
        ...patch,
      },
    }));
  };

  const getTenantN8nDraft = (tenant: LeadClient) => {
    const draft = n8nDrafts[tenant.id] || {};
    return {
      dispatchWebhookUrl:
        draft.dispatchWebhookUrl ?? tenant.n8n_settings?.dispatch_webhook_url ?? "",
      dispatchWebhookToken: draft.dispatchWebhookToken ?? "",
      inboundBearerToken: draft.inboundBearerToken ?? "",
      active: draft.active ?? tenant.n8n_settings?.active ?? true,
      allowedTabs: draft.allowedTabs ?? tenant.n8n_settings?.allowed_tabs ?? null,
    };
  };

  const handleSaveTenantN8n = async (tenant: LeadClient) => {
    const draft = getTenantN8nDraft(tenant);

    try {
      await updateN8nSettings.mutateAsync({
        tenantId: tenant.id,
        dispatchWebhookUrl: draft.dispatchWebhookUrl.trim() || null,
        dispatchWebhookToken: draft.dispatchWebhookToken.trim() || undefined,
        inboundBearerToken: draft.inboundBearerToken.trim() || undefined,
        active: draft.active,
        allowedTabs: draft.allowedTabs,
      });

      setN8nDrafts((current) => ({
        ...current,
        [tenant.id]: {
          dispatchWebhookUrl: draft.dispatchWebhookUrl,
          dispatchWebhookToken: "",
          inboundBearerToken: "",
          active: draft.active,
          allowedTabs: draft.allowedTabs,
        },
      }));

      toast({
        title: "Configurações da empresa atualizadas",
        description: `As configuracoes da empresa ${tenant.name} foram salvas.`,
      });
    } catch (settingsError) {
      toast({
        title: "Falha ao salvar Evolution",
        description:
          settingsError instanceof Error
            ? settingsError.message
            : "Nao foi possivel atualizar a configuracao de disparo.",
        variant: "destructive",
      });
    }
  };

  const handleClearTenantToken = async (
    tenant: LeadClient,
    tokenField: "dispatchWebhookToken" | "inboundBearerToken"
  ) => {
    try {
      await updateN8nSettings.mutateAsync({
        tenantId: tenant.id,
        [tokenField]: null,
      });

      toast({
        title: "Token removido",
        description: `O token da empresa ${tenant.name} foi removido.`,
      });
    } catch (settingsError) {
      toast({
        title: "Falha ao remover token",
        description:
          settingsError instanceof Error
            ? settingsError.message
            : "Nao foi possivel remover o token.",
        variant: "destructive",
      });
    }
  };

  const handleDeleteTenant = async (tenant: { id: string; name: string }) => {
    try {
      await deleteTenant.mutateAsync(tenant.id);

      toast({
        title: "Empresa excluida",
        description: `A empresa ${tenant.name} foi removida do cadastro.`,
      });

      setTenantPendingDelete(null);
    } catch (deleteError) {
      toast({
        title: "Nao foi possivel excluir",
        description:
          deleteError instanceof Error
            ? deleteError.message
            : "O tenant nao pode ser removido agora.",
        variant: "destructive",
      });
    }
  };

  const handleVerifyTenantTable = async (tenant: LeadClient) => {
    try {
      const status = await verifyTenantTable.mutateAsync(tenant.id);
      setTableStatuses((current) => ({
        ...current,
        [tenant.id]: status,
      }));
      toast({
        title: status.exists ? "Tabela encontrada" : "Tabela nao encontrada",
        description: status.exists
          ? `${status.tableName} existe com ${status.columns?.length || 0} colunas.`
          : `A tabela ${status.tableName} nao existe no banco.`,
        variant: status.exists ? "default" : "destructive",
      });
    } catch (statusError) {
      toast({
        title: "Falha ao verificar tabela",
        description:
          statusError instanceof Error
            ? statusError.message
            : "Nao foi possivel consultar o status da tabela.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog
      open={tenant !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      {tenant && (() => {
        const tableStatus = tableStatuses[tenant.id] || tenant.leads_table;
        const expectedTableName = tableStatus?.tableName || `leads_${tenant.id.replace(/-/g, "_")}`;
        return (
          <DialogContent className="max-h-[95vh] max-w-[95vw] md:max-w-5xl lg:max-w-6xl w-full overflow-y-auto p-0 border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-white/10 dark:bg-[#0b0e1a] dark:text-white">
            <DialogHeader className="space-y-1 px-6 pt-6 pb-4 border-b border-slate-100 dark:border-white/5">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <DialogTitle className="text-lg font-bold flex items-center gap-2">
                    <span>Configurações de {tenant.name}</span>
                    <Badge className="border border-cyan-400/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200 text-[10px] font-mono">
                      {tenant.id}
                    </Badge>
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground">
                    Gerencie conexões do WhatsApp (instâncias Evolution), fallback, banco de dados e ações operacionais.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="p-6 space-y-6">
              {/* Database Verification */}
              <div className="space-y-3 rounded-lg border border-slate-200/80 bg-slate-50/50 p-4 dark:border-white/10 dark:bg-white/[0.01]">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Database className="h-4 w-4 shrink-0 text-cyan-700 dark:text-cyan-200" />
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground text-xs">Tabela no Banco de Dados</p>
                      <p className="font-mono text-[11px] text-muted-foreground">{expectedTableName}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge
                      className={
                        tableStatus?.exists
                          ? "border border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 text-[10px] font-medium"
                          : "border border-amber-400/25 bg-amber-500/10 text-amber-700 dark:text-amber-200 text-[10px] font-medium"
                      }
                    >
                      {tableStatus?.exists ? "OK" : "Não verif."}
                    </Badge>
                    {tableStatus?.exists ? (
                      <Badge className="border border-slate-300/80 bg-white/90 text-[10px] text-slate-700 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/80">
                        {tableStatus.columns?.length || 0} colunas
                      </Badge>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs font-semibold px-3 bg-white hover:bg-slate-50 dark:bg-white/[0.02] dark:hover:bg-white/[0.05]"
                      disabled={verifyTenantTable.isPending}
                      onClick={() => void handleVerifyTenantTable(tenant)}
                    >
                      {verifyTenantTable.isPending ? "Verificando..." : "Verificar agora"}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Chips and integrations settings */}
              {canManageN8n ? (
                <div className="space-y-4 rounded-lg border border-slate-200/80 bg-slate-50/50 p-4 dark:border-white/10 dark:bg-white/[0.01]">
                  <div className="pb-2 border-b border-slate-200/60 dark:border-white/5">
                    <h4 className="text-xs font-semibold text-foreground">Conexão WhatsApp (Evolution API)</h4>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Gerencie os chips conectados e o fluxo de disparos.</p>
                  </div>
                  <EvolutionChipsPanel tenant={tenant} />

                  {/* Fallback legado */}
                  <div className="grid gap-3 rounded-xl border border-slate-200/80 bg-white p-4 dark:border-white/10 dark:bg-black/20">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-foreground">Fallback Redundante (Legado)</p>
                        <p className="text-[11px] text-muted-foreground">
                          URL e Token usados quando nenhuma instância Evolution padrão estiver configurada.
                        </p>
                      </div>
                      <label className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground cursor-pointer">
                        <input
                          type="checkbox"
                          className="rounded border-slate-300 dark:border-white/10 text-cyan-600 focus:ring-cyan-500"
                          checked={getTenantN8nDraft(tenant).active}
                          onChange={(event) =>
                            updateTenantN8nDraft(tenant.id, { active: event.target.checked })
                          }
                        />
                        Ativo
                      </label>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-muted-foreground uppercase">URL de Disparo</label>
                        <Input
                          placeholder="https://.../message/sendText/Instancia"
                          className="h-9 text-xs"
                          value={getTenantN8nDraft(tenant).dispatchWebhookUrl}
                          onChange={(event) =>
                            updateTenantN8nDraft(tenant.id, {
                              dispatchWebhookUrl: event.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-muted-foreground uppercase">API Key (apikey)</label>
                        <Input
                          placeholder={
                            tenant.n8n_settings?.has_dispatch_webhook_token
                              ? "API Key definida"
                              : "Insira a API Key"
                          }
                          className="h-9 text-xs"
                          value={getTenantN8nDraft(tenant).dispatchWebhookToken}
                          onChange={(event) =>
                            updateTenantN8nDraft(tenant.id, {
                              dispatchWebhookToken: event.target.value,
                            })
                          }
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2 pt-1">
                      {tenant.n8n_settings?.has_dispatch_webhook_token ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs font-medium"
                          disabled={updateN8nSettings.isPending}
                          onClick={() => void handleClearTenantToken(tenant, "dispatchWebhookToken")}
                        >
                          Remover API Key
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 text-xs font-semibold"
                        disabled={updateN8nSettings.isPending}
                        onClick={() => void handleSaveTenantN8n(tenant)}
                      >
                        <Save className="h-3.5 w-3.5" />
                        {updateN8nSettings.isPending ? "Salvando..." : "Salvar fallback"}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Liberação de abas e sub-abas */}
              {canManageN8n ? (
                <div className="space-y-4 rounded-lg border border-slate-200/80 bg-slate-50/50 p-4 dark:border-white/10 dark:bg-white/[0.01]">
                  <div className="pb-2 border-b border-slate-200/60 dark:border-white/5 flex flex-wrap justify-between items-center gap-2">
                    <div>
                      <h4 className="text-xs font-semibold text-foreground">Liberação de Abas e Telas</h4>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Defina quais abas e sub-abas os usuários desta empresa terão acesso.</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-[10px] px-2 bg-white dark:bg-white/[0.02]"
                        onClick={() => updateTenantN8nDraft(tenant.id, { allowedTabs: [...ALL_TAB_KEYS] })}
                      >
                        Liberar Tudo
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-[10px] px-2 text-rose-500 hover:text-rose-600 bg-white dark:bg-white/[0.02]"
                        onClick={() => updateTenantN8nDraft(tenant.id, { allowedTabs: [] })}
                      >
                        Bloquear Tudo
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-3 pt-1">
                    {TABS_HIERARCHY.map((module) => {
                      const activeTabs = getTenantN8nDraft(tenant).allowedTabs;
                      const isSelected = (key: string) => {
                        if (activeTabs === null) return true;
                        return activeTabs.includes(key);
                      };

                      const handleToggleKey = (key: string, isChecked: boolean) => {
                        let currentTabs = activeTabs ? [...activeTabs] : [...ALL_TAB_KEYS];
                        if (isChecked) {
                          if (!currentTabs.includes(key)) currentTabs.push(key);
                          if (key.includes(":")) {
                            const parent = key.split(":")[0];
                            if (!currentTabs.includes(parent)) currentTabs.push(parent);
                          }
                          const children = ALL_TAB_KEYS.filter(k => k.startsWith(key + ":"));
                          children.forEach(child => {
                            if (!currentTabs.includes(child)) currentTabs.push(child);
                          });
                        } else {
                          currentTabs = currentTabs.filter(k => k !== key);
                          if (!key.includes(":")) {
                            currentTabs = currentTabs.filter(k => !k.startsWith(key + ":"));
                          }
                        }
                        updateTenantN8nDraft(tenant.id, { allowedTabs: currentTabs });
                      };

                      return (
                        <div
                          key={module.key}
                          className="space-y-3 p-3 rounded-lg border border-slate-200/80 bg-white dark:border-white/5 dark:bg-black/20"
                        >
                          <h5 className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                            {module.label}
                          </h5>
                          <div className="space-y-3.5">
                            {module.children.map((tab) => (
                              <div key={tab.key} className="space-y-1.5">
                                <label className="inline-flex items-center gap-2 text-xs font-semibold text-foreground cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    className="rounded border-slate-300 dark:border-white/10 text-cyan-600 focus:ring-cyan-500"
                                    checked={isSelected(tab.key)}
                                    onChange={(e) => handleToggleKey(tab.key, e.target.checked)}
                                  />
                                  {tab.label}
                                </label>

                                {tab.children && tab.children.length > 0 && (
                                  <div className="pl-4 border-l border-slate-100 dark:border-white/5 space-y-1.5 ml-1.5 mt-1">
                                    {tab.children.map((subTab) => (
                                      <label
                                        key={subTab.key}
                                        className={`inline-flex items-center gap-2 text-[11px] cursor-pointer select-none ${
                                          isSelected(tab.key)
                                            ? "text-muted-foreground"
                                            : "text-muted-foreground/40 pointer-events-none"
                                        }`}
                                      >
                                        <input
                                          type="checkbox"
                                          className="rounded border-slate-300 dark:border-white/10 text-cyan-600 focus:ring-cyan-500 size-3"
                                          disabled={!isSelected(tab.key)}
                                          checked={isSelected(tab.key) && isSelected(subTab.key)}
                                          onChange={(e) => handleToggleKey(subTab.key, e.target.checked)}
                                        />
                                        {subTab.label}
                                      </label>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex justify-end pt-1">
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 text-xs font-semibold"
                      disabled={updateN8nSettings.isPending}
                      onClick={() => void handleSaveTenantN8n(tenant)}
                    >
                      <Save className="h-3.5 w-3.5 mr-1" />
                      {updateN8nSettings.isPending ? "Salvando..." : "Salvar liberação de abas"}
                    </Button>
                  </div>
                </div>
              ) : null}

              {/* Danger zone / Delete button */}
              {canManageTenants ? (
                <div className="flex items-center justify-between p-4 rounded-lg border border-rose-200/60 bg-rose-50/10 dark:border-rose-950/20 dark:bg-rose-950/5">
                  <div>
                    <p className="text-xs font-semibold text-foreground">Zona de Perigo</p>
                    <p className="text-[11px] text-muted-foreground">Exclusão irreversível da empresa e de todos os dados operacionais.</p>
                  </div>
                  <AlertDialog
                    open={tenantPendingDelete === tenant.id}
                    onOpenChange={(open) => {
                      setTenantPendingDelete(open ? tenant.id : null);
                    }}
                  >
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={deleteTenant.isPending}
                        className="h-8 text-xs font-semibold"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Excluir empresa
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-white/10 dark:bg-[#0b0e1a] dark:text-white">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Excluir empresa cadastrada?</AlertDialogTitle>
                        <AlertDialogDescription className="text-xs text-muted-foreground">
                          Você tem certeza que deseja remover <strong>{tenant.name}</strong> ({tenant.id})? Se
                          esse tenant tiver leads, campanhas ou dados operacionais, eles
                          também serão apagados de forma irreversível. Se houver usuários vinculados, a exclusão
                          será bloqueada automaticamente pelo sistema.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleteTenant.isPending} className="h-8 text-xs">
                          Cancelar
                        </AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90 h-8 text-xs"
                          disabled={deleteTenant.isPending}
                          onClick={(event) => {
                            event.preventDefault();
                            void handleDeleteTenant(tenant);
                          }}
                        >
                          {deleteTenant.isPending && tenantPendingDelete === tenant.id
                            ? "Excluindo..."
                            : "Confirmar exclusão"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ) : null}
            </div>
          </DialogContent>
        );
      })()}
    </Dialog>
  );
}
