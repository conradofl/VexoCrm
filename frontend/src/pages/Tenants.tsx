import { useEffect, useState } from "react";
import { Building2, CheckCircle2, KeyRound, Link2, Plus, Save, Search, ShieldCheck, Trash2 } from "lucide-react";
import { ZodError } from "zod";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { PageShell } from "@/components/PageShell";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  LeadClient,
  useCreateLeadClient,
  useDeleteLeadClient,
  useLeadClients,
  useUpdateLeadClientN8nSettings,
} from "@/hooks/useLeadClients";
import { createTenantSchema } from "@/lib/validationSchemas";

function buildTenantKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 50);
}

function formatCreatedAt(value?: string) {
  if (!value) return "Sem data";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sem data";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function Tenants() {
  const { data: tenants = [], isLoading, error } = useLeadClients();
  const createTenant = useCreateLeadClient();
  const deleteTenant = useDeleteLeadClient();
  const updateN8nSettings = useUpdateLeadClientN8nSettings();
  const { hasPermission, isAdminUser } = useAuth();
  const [name, setName] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [dispatchWebhookUrl, setDispatchWebhookUrl] = useState("");
  const [dispatchWebhookToken, setDispatchWebhookToken] = useState("");
  const [inboundBearerToken, setInboundBearerToken] = useState("");
  const [search, setSearch] = useState("");
  const [formError, setFormError] = useState("");
  const [tenantIdEdited, setTenantIdEdited] = useState(false);
  const [tenantPendingDelete, setTenantPendingDelete] = useState<string | null>(null);
  const [n8nDrafts, setN8nDrafts] = useState<
    Record<
      string,
      {
        dispatchWebhookUrl?: string;
        dispatchWebhookToken?: string;
        inboundBearerToken?: string;
        active?: boolean;
      }
    >
  >({});
  const canManageTenants = hasPermission("tenants.manage");
  const canManageN8n = isAdminUser;

  useEffect(() => {
    if (!tenantIdEdited) {
      setTenantId(buildTenantKey(name));
    }
  }, [name, tenantIdEdited]);

  const filteredTenants = tenants.filter((tenant) => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return true;

    return (
      tenant.name.toLowerCase().includes(normalizedSearch) ||
      tenant.id.toLowerCase().includes(normalizedSearch)
    );
  });

  const latestTenant = tenants.reduce<string | null>((latest, tenant) => {
    if (!tenant.created_at) return latest;
    if (!latest) return tenant.created_at;
    return new Date(tenant.created_at).getTime() > new Date(latest).getTime()
      ? tenant.created_at
      : latest;
  }, null);

  const handleTenantIdChange = (value: string) => {
    setTenantIdEdited(true);
    setTenantId(buildTenantKey(value));
  };

  const resetSuggestedTenantId = () => {
    setTenantIdEdited(false);
    setTenantId(buildTenantKey(name));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");

    if (!canManageTenants) {
      setFormError("Seu acesso atual permite consultar empresas, mas nao criar novos tenants.");
      return;
    }

    try {
      const payload = createTenantSchema.parse({
        name,
        id: tenantId,
      });

      const hasN8nSettings =
        canManageN8n &&
        Boolean(
          dispatchWebhookUrl.trim() ||
            dispatchWebhookToken.trim() ||
            inboundBearerToken.trim()
        );

      await createTenant.mutateAsync({
        ...payload,
        ...(hasN8nSettings
          ? {
              n8nSettings: {
                dispatchWebhookUrl: dispatchWebhookUrl.trim() || null,
                dispatchWebhookToken: dispatchWebhookToken.trim() || null,
                inboundBearerToken: inboundBearerToken.trim() || null,
                active: true,
              },
            }
          : {}),
      });

      toast({
        title: "Tenant criado",
        description: `A empresa ${payload.name} ja pode ser vinculada aos usuarios do CRM.`,
      });

      setName("");
      setTenantId("");
      setDispatchWebhookUrl("");
      setDispatchWebhookToken("");
      setInboundBearerToken("");
      setTenantIdEdited(false);
    } catch (submissionError) {
      if (submissionError instanceof ZodError) {
        setFormError(submissionError.errors[0]?.message || "Dados invalidos.");
        return;
      }

      setFormError(
        submissionError instanceof Error ? submissionError.message : "Nao foi possivel criar o tenant."
      );
    }
  };

  const updateTenantN8nDraft = (
    tenantId: string,
    patch: {
      dispatchWebhookUrl?: string;
      dispatchWebhookToken?: string;
      inboundBearerToken?: string;
      active?: boolean;
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
      });

      setN8nDrafts((current) => ({
        ...current,
        [tenant.id]: {
          dispatchWebhookUrl: draft.dispatchWebhookUrl,
          dispatchWebhookToken: "",
          inboundBearerToken: "",
          active: draft.active,
        },
      }));

      toast({
        title: "Disparo Evolution atualizado",
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

  return (
    <PageShell
      title="Empresas"
      subtitle="Crie e organize os tenants que vao operar dentro do CRM e do portal do cliente."
      spacing="space-y-4"
      compactHero
      headerRight={
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="border border-cyan-400/25 bg-cyan-500/10 px-3 py-1 text-cyan-700 dark:text-cyan-200">
            {tenants.length} tenants
          </Badge>
          <Badge className="border border-slate-300/80 bg-white/90 px-3 py-1 text-slate-700 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/80">
            {canManageTenants ? "Criacao liberada" : "Consulta apenas"}
          </Badge>
          <Badge className="border border-emerald-400/25 bg-emerald-500/10 px-3 py-1 text-emerald-700 dark:text-emerald-200">
            {canManageN8n ? "Disparo Evolution liberado" : "Evolution restrito a admins"}
          </Badge>
        </div>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <Card className="overflow-hidden border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(239,246,255,0.96))] shadow-[0_24px_60px_rgba(15,23,42,0.10)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(13,18,54,0.92),rgba(8,10,32,0.96))]">
          <CardHeader className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1.5">
                <CardTitle className="text-xl">Novo tenant</CardTitle>
                <CardDescription>
                  Cada empresa criada aqui vira um `clientId` valido para dashboard, leads,
                  planilhas, WhatsApp e portal do cliente.
                </CardDescription>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200">
                <Building2 className="h-5 w-5" />
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 text-sm text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-200" />
                <div className="space-y-1">
                  <p className="font-medium text-foreground">Fluxo recomendado</p>
                  <p>
                    1. Crie o tenant. 2. Vincule usuarios em Usuarios. 3. Importe planilhas e
                    inicie a operacao.
                  </p>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground" htmlFor="tenant-name">
                  Nome da empresa
                </label>
                <Input
                  id="tenant-name"
                  placeholder="Ex.: Solar Prime Holding"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={!canManageTenants || createTenant.isPending}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-sm font-medium text-foreground" htmlFor="tenant-id">
                    Tenant ID
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={resetSuggestedTenantId}
                    disabled={!name || !canManageTenants || createTenant.isPending}
                  >
                    Regenerar
                  </Button>
                </div>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="tenant-id"
                    className="pl-10"
                    placeholder="solar-prime"
                    value={tenantId}
                    onChange={(event) => handleTenantIdChange(event.target.value)}
                    disabled={!canManageTenants || createTenant.isPending}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Portal previsto:{" "}
                  <span className="font-mono text-foreground">
                    /clientes/{tenantId || "tenant-id"}/dashboard
                  </span>
                </p>
              </div>

              <ErrorMessage message={formError} variant="banner" />

              {canManageN8n ? (
                <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-white/75 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                  <div className="flex items-start gap-3">
                    <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-700 dark:text-cyan-200" />
                    <div>
                      <p className="text-sm font-medium text-foreground">Evolution API</p>
                      <p className="text-xs text-muted-foreground">
                        URL e API Key da instância Evolution para envio de mensagens.
                      </p>
                    </div>
                  </div>
                  <Input
                    placeholder="URL de disparo Evolution (ex: https://.../message/sendText/Instancia)"
                    value={dispatchWebhookUrl}
                    onChange={(event) => setDispatchWebhookUrl(event.target.value)}
                    disabled={!canManageTenants || createTenant.isPending}
                  />
                  <Input
                    placeholder="API Key Evolution (apikey do header)"
                    value={dispatchWebhookToken}
                    onChange={(event) => setDispatchWebhookToken(event.target.value)}
                    disabled={!canManageTenants || createTenant.isPending}
                  />
                </div>
              ) : null}

              {!canManageTenants && (
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-200">
                  Seu perfil atual pode consultar os tenants cadastrados, mas a criacao esta
                  reservada para perfis com permissao de gestao.
                </div>
              )}

              <Button
                type="submit"
                className="w-full justify-center"
                disabled={!canManageTenants || createTenant.isPending}
              >
                <Plus className="h-4 w-4" />
                {createTenant.isPending ? "Criando tenant..." : "Criar empresa"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="border-slate-200/80 bg-white/90 shadow-[0_20px_50px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-white/[0.04]">
              <CardHeader className="pb-3">
                <CardDescription>Base operacional</CardDescription>
                <CardTitle className="text-3xl">{tenants.length}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-sm text-muted-foreground">
                Total de empresas prontas para receber usuarios, dados e campanhas.
              </CardContent>
            </Card>

            <Card className="border-slate-200/80 bg-white/90 shadow-[0_20px_50px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-white/[0.04]">
              <CardHeader className="pb-3">
                <CardDescription>Ultimo cadastro</CardDescription>
                <CardTitle className="text-lg">
                  {latestTenant ? formatCreatedAt(latestTenant) : "Nenhum tenant criado"}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-sm text-muted-foreground">
                Use esse painel para garantir que todo novo cliente entre com `clientId` padrao e
                rota consistente.
              </CardContent>
            </Card>
          </div>

          <Card className="border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(245,248,255,0.96))] shadow-[0_22px_56px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(9,12,38,0.9),rgba(7,10,28,0.96))]">
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>Tenants cadastrados</CardTitle>
                  <CardDescription>
                    Consulte IDs, datas de criacao e a rota base de cada empresa.
                  </CardDescription>
                </div>
                <div className="relative w-full max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-10"
                    placeholder="Buscar por nome ou tenant ID"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <ErrorMessage message={error ? (error as Error).message : null} variant="banner" />

              {isLoading ? (
                <div className="rounded-2xl border border-slate-200/80 bg-white/70 px-4 py-8 text-center text-sm text-muted-foreground dark:border-white/10 dark:bg-white/[0.03]">
                  Carregando empresas...
                </div>
              ) : filteredTenants.length === 0 ? (
                <EmptyState
                  title={search ? "Nenhuma empresa encontrada" : "Nenhuma empresa cadastrada"}
                  description={
                    search
                      ? "Ajuste o termo buscado para localizar outro tenant."
                      : "Crie o primeiro tenant para liberar operacao por empresa dentro do CRM."
                  }
                />
              ) : (
                <div className="grid gap-3">
                  {filteredTenants.map((tenant) => (
                    <div
                      key={tenant.id}
                      className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-white/[0.03]"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-base font-semibold text-foreground">{tenant.name}</p>
                            <Badge className="border border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200">
                              {tenant.id}
                            </Badge>
                            <Badge className="border border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200">
                              {tenant.n8n_onboarding_status || "pendente"}
                            </Badge>
                          </div>
                          <p className="font-mono text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-white/45">
                            {formatCreatedAt(tenant.created_at)}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/90 px-3 py-2 text-right text-xs text-muted-foreground dark:border-white/10 dark:bg-white/[0.03]">
                          <p className="font-medium text-foreground">Rota base</p>
                          <p className="mt-1 font-mono">/clientes/{tenant.id}/dashboard</p>
                        </div>
                      </div>
                      {canManageN8n ? (
                        <div className="mt-4 grid gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium text-foreground">Disparo Evolution</p>
                              <p className="text-xs text-muted-foreground">
                                A URL vale para campanhas novas e disparos futuros. Tokens existentes ficam mascarados.
                              </p>
                            </div>
                            <label className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={getTenantN8nDraft(tenant).active}
                                onChange={(event) =>
                                  updateTenantN8nDraft(tenant.id, { active: event.target.checked })
                                }
                              />
                              ativo
                            </label>
                          </div>
                          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.85fr)_minmax(0,0.85fr)]">
                            <Input
                              placeholder="URL de disparo Evolution"
                              value={getTenantN8nDraft(tenant).dispatchWebhookUrl}
                              onChange={(event) =>
                                updateTenantN8nDraft(tenant.id, {
                                  dispatchWebhookUrl: event.target.value,
                                })
                              }
                            />
                            <Input
                              placeholder={
                                tenant.n8n_settings?.has_dispatch_webhook_token
                                  ? "API Key Evolution definida"
                                  : "API Key Evolution (apikey do header)"
                              }
                              value={getTenantN8nDraft(tenant).dispatchWebhookToken}
                              onChange={(event) =>
                                updateTenantN8nDraft(tenant.id, {
                                  dispatchWebhookToken: event.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="flex flex-wrap justify-end gap-2">
                            {tenant.n8n_settings?.has_dispatch_webhook_token ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={updateN8nSettings.isPending}
                                onClick={() => void handleClearTenantToken(tenant, "dispatchWebhookToken")}
                              >
                                Remover API Key
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              size="sm"
                              disabled={updateN8nSettings.isPending}
                              onClick={() => void handleSaveTenantN8n(tenant)}
                            >
                              <Save className="h-4 w-4" />
                              {updateN8nSettings.isPending ? "Salvando..." : "Salvar"}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                      {canManageTenants ? (
                        <div className="mt-4 flex justify-end">
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
                              >
                                <Trash2 className="h-4 w-4" />
                                Excluir empresa
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Excluir empresa cadastrada?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Vamos remover <strong>{tenant.name}</strong> ({tenant.id}). Se
                                  esse tenant tiver leads, campanhas ou dados operacionais, eles
                                  tambem serao apagados. Se houver usuarios vinculados, a exclusao
                                  sera bloqueada automaticamente.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel disabled={deleteTenant.isPending}>
                                  Cancelar
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  disabled={deleteTenant.isPending}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    void handleDeleteTenant(tenant);
                                  }}
                                >
                                  {deleteTenant.isPending && tenantPendingDelete === tenant.id
                                    ? "Excluindo..."
                                    : "Confirmar exclusao"}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="rounded-[28px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(8,145,178,0.08),rgba(59,130,246,0.08),rgba(15,23,42,0.02))] px-5 py-4 text-sm text-slate-700 shadow-[0_22px_56px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-[linear-gradient(135deg,rgba(34,211,238,0.10),rgba(59,130,246,0.08),rgba(15,23,42,0.38))] dark:text-white/75">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-700 dark:text-cyan-200" />
              <div className="space-y-1">
                <p className="font-medium text-foreground">Tenant criado, operacao liberada</p>
                <p>
                  Depois do cadastro, o novo `clientId` fica disponivel para vinculacao no modulo
                  de acessos. Em perfis com escopo restrito, ele passa a aparecer nos seletores
                  assim que esse vinculo for aplicado ao usuario.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
