import { useEffect, useState } from "react";
import { Building2, CheckCircle2, Database, KeyRound, Link2, Plus, Save, Search, ShieldCheck, Trash2, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
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
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  LeadClient,
  useCreateLeadClient,
  useDeleteLeadClientEvolutionInstance,
  useDeleteLeadClient,
  useLeadClients,
  useProvisionLeadClientEvolutionInstance,
  useSaveLeadClientEvolutionInstance,
  useUpdateLeadClientN8nSettings,
  useVerifyLeadClientTable,
  type LeadClientEvolutionInstance,
  type LeadClientTableStatus,
} from "@/hooks/useLeadClients";
import { createTenantSchema } from "@/lib/validationSchemas";

const CHATBOT_MODEL_OPTIONS = [
  {
    value: "outlier",
    title: "Consorcio / credito",
    description: "Campos para credito, parcela, FGTS, lance e objetivo de compra.",
  },
  {
    value: "infinie",
    title: "Energia solar",
    description: "Campos para instalacao, conta de luz, localidade e prazo.",
  },
  {
    value: "generico",
    title: "Modelo generico",
    description: "Campos comuns para operacoes que ainda serao modeladas.",
  },
] as const;

const CREATION_STEPS = [
  "Cria o tenant em leads_clients",
  "Cria a tabela dinamica de leads",
  "Libera dashboard, planilhas e portal",
];

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
  const saveEvolutionInstance = useSaveLeadClientEvolutionInstance();
  const provisionEvolutionInstance = useProvisionLeadClientEvolutionInstance();
  const deleteEvolutionInstance = useDeleteLeadClientEvolutionInstance();
  const verifyTenantTable = useVerifyLeadClientTable();
  const { hasPermission, isAdminUser } = useAuth();
  const [name, setName] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [dispatchWebhookUrl, setDispatchWebhookUrl] = useState("");
  const [dispatchWebhookToken, setDispatchWebhookToken] = useState("");
  const [inboundBearerToken, setInboundBearerToken] = useState("");
  const [search, setSearch] = useState("");
  const [formError, setFormError] = useState("");
  const [chatbotModel, setChatbotModel] = useState<"outlier" | "infinie" | "generico">("outlier");
  const [tenantIdEdited, setTenantIdEdited] = useState(false);
  const [tenantPendingDelete, setTenantPendingDelete] = useState<string | null>(null);
  const [tableStatuses, setTableStatuses] = useState<Record<string, LeadClientTableStatus>>({});
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
  const [chipDrafts, setChipDrafts] = useState<
    Record<string, { chipState?: "cold" | "warm"; dailyLimitOverride?: string }>
  >({});

  // QR exibido após criar a instância na Evolution (Fatia 1 do self-service).
  const [qrModal, setQrModal] = useState<{
    base64: string;
    tenantName: string;
    instanceName: string | null;
  } | null>(null);
  const canManageTenants = hasPermission("tenants.manage");
  const canManageN8n = isAdminUser;
  const tablePreviewName = tenantId ? `leads_${tenantId.replace(/-/g, "_")}` : "leads_tenant_id";
  const selectedModel = CHATBOT_MODEL_OPTIONS.find((option) => option.value === chatbotModel) || CHATBOT_MODEL_OPTIONS[0];
  const canSubmitTenant = canManageTenants && Boolean(name.trim()) && Boolean(tenantId.trim()) && !createTenant.isPending;

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

      const createdTenant = await createTenant.mutateAsync({
        ...payload,
        chatbotModel,
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

      if (createdTenant.leads_table) {
        setTableStatuses((current) => ({
          ...current,
          [createdTenant.id]: createdTenant.leads_table!,
        }));
      }

      toast({
        title: "Tenant criado",
        description: createdTenant.leads_table?.exists
          ? `Tabela ${createdTenant.leads_table.tableName} criada e empresa pronta para uso.`
          : `A empresa ${payload.name} ja pode ser vinculada aos usuarios do CRM.`,
      });

      setName("");
      setTenantId("");
      setDispatchWebhookUrl("");
      setDispatchWebhookToken("");
      setInboundBearerToken("");
      setChatbotModel("outlier");
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

  const handleCreateEvolutionInstance = async (tenant: LeadClient) => {
    const draft = getEvolutionDraft(tenant.id);

    try {
      await saveEvolutionInstance.mutateAsync({
        tenantId: tenant.id,
        name: draft.name.trim() || "Evolution",
        dispatchWebhookUrl: draft.dispatchWebhookUrl.trim(),
        dispatchWebhookToken: draft.dispatchWebhookToken.trim() || undefined,
        active: draft.active,
        isDefault: draft.isDefault,
      });

      setEvolutionDrafts((current) => ({
        ...current,
        [tenant.id]: {
          name: "",
          dispatchWebhookUrl: "",
          dispatchWebhookToken: "",
          active: true,
          isDefault: false,
        },
      }));

      toast({
        title: "Evolution adicionada",
        description: `A instancia foi vinculada a ${tenant.name}.`,
      });
    } catch (settingsError) {
      toast({
        title: "Falha ao adicionar Evolution",
        description:
          settingsError instanceof Error
            ? settingsError.message
            : "Nao foi possivel adicionar a instancia Evolution.",
        variant: "destructive",
      });
    }
  };

  const handleProvisionEvolutionInstance = async (tenant: LeadClient) => {
    const draft = getEvolutionDraft(tenant.id);

    try {
      const result = await provisionEvolutionInstance.mutateAsync({
        tenantId: tenant.id,
        name: draft.name.trim() || tenant.name || "Evolution",
        dispatchWebhookToken: draft.dispatchWebhookToken.trim() || undefined,
        active: draft.active,
        isDefault: draft.isDefault,
      });

      setEvolutionDrafts((current) => ({
        ...current,
        [tenant.id]: {
          name: "",
          dispatchWebhookUrl: "",
          dispatchWebhookToken: "",
          active: true,
          isDefault: false,
        },
      }));

      // Se a Evolution devolveu o QR, abre o modal de pareamento.
      const qrBase64 = result.evolution?.qrcode?.base64 || null;
      if (qrBase64) {
        setQrModal({
          base64: qrBase64,
          tenantName: tenant.name,
          instanceName: result.evolution?.instanceName || result.item?.name || null,
        });
      } else {
        toast({
          title: "Evolution criada",
          description: `Instancia vinculada a ${tenant.name}, mas a Evolution nao retornou QR. Tente remover e criar de novo.`,
        });
      }
    } catch (settingsError) {
      toast({
        title: "Falha ao criar na Evolution",
        description:
          settingsError instanceof Error
            ? settingsError.message
            : "Nao foi possivel criar a instancia na Evolution API.",
        variant: "destructive",
      });
    }
  };

  function resolveChipLimit(chipState: "cold" | "warm", overrideStr?: string): number {
    const parsed = overrideStr ? parseInt(overrideStr, 10) : NaN;
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    return chipState === "warm" ? 500 : 100;
  }

  const getChipDraft = (instance: LeadClientEvolutionInstance) => {
    const draft = chipDrafts[instance.id] || {};
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
    setChipDrafts((current) => ({
      ...current,
      [instanceId]: { ...current[instanceId], ...patch },
    }));
  };

  const handleSaveChipSettings = async (
    tenant: LeadClient,
    instance: LeadClientEvolutionInstance
  ) => {
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
        dispatchWebhookUrl: instance.dispatch_webhook_url || "",
        chipState: draft.chipState,
        dailyLimitOverride,
      });
      setChipDrafts((current) => {
        const next = { ...current };
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

  const handleUpdateEvolutionInstance = async (
    tenant: LeadClient,
    instance: LeadClientEvolutionInstance,
    patch: {
      active?: boolean;
      isDefault?: boolean;
    }
  ) => {
    try {
      await saveEvolutionInstance.mutateAsync({
        tenantId: tenant.id,
        instanceId: instance.id,
        name: instance.name,
        dispatchWebhookUrl: instance.dispatch_webhook_url || "",
        active: patch.active ?? instance.active,
        isDefault: patch.isDefault ?? instance.is_default,
      });

      toast({
        title: patch.isDefault ? "Evolution padrao atualizada" : "Evolution atualizada",
        description: `${tenant.name}: ${instance.name}`,
      });
    } catch (settingsError) {
      toast({
        title: "Falha ao atualizar Evolution",
        description:
          settingsError instanceof Error
            ? settingsError.message
            : "Nao foi possivel atualizar a instancia Evolution.",
        variant: "destructive",
      });
    }
  };

  const handleDeleteEvolutionInstance = async (
    tenant: LeadClient,
    instance: LeadClientEvolutionInstance
  ) => {
    try {
      await deleteEvolutionInstance.mutateAsync({
        tenantId: tenant.id,
        instanceId: instance.id,
      });

      toast({
        title: "Evolution removida",
        description: `${tenant.name}: ${instance.name}`,
      });
    } catch (settingsError) {
      toast({
        title: "Falha ao remover Evolution",
        description:
          settingsError instanceof Error
            ? settingsError.message
            : "Nao foi possivel remover a instancia Evolution.",
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

  const getEvolutionDraft = (tenantId: string) => {
    const draft = evolutionDrafts[tenantId] || {};
    return {
      name: draft.name ?? "",
      dispatchWebhookUrl: draft.dispatchWebhookUrl ?? "",
      dispatchWebhookToken: draft.dispatchWebhookToken ?? "",
      active: draft.active ?? true,
      isDefault: draft.isDefault ?? false,
    };
  };

  const updateEvolutionDraft = (
    tenantId: string,
    patch: {
      name?: string;
      dispatchWebhookUrl?: string;
      dispatchWebhookToken?: string;
      active?: boolean;
      isDefault?: boolean;
    }
  ) => {
    setEvolutionDrafts((current) => ({
      ...current,
      [tenantId]: {
        ...current[tenantId],
        ...patch,
      },
    }));
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
                <CardTitle className="text-xl">Criar empresa</CardTitle>
                <CardDescription>
                  Cadastre o cliente uma vez. O CRM cria o tenant, a tabela de leads e a rota do portal automaticamente.
                </CardDescription>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200">
                <Wand2 className="h-5 w-5" />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {CREATION_STEPS.map((step, index) => (
                <div
                  key={step}
                  className="rounded-xl border border-slate-200/80 bg-white/78 px-3 py-2 text-xs text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70"
                >
                  <span className="mb-1 flex h-5 w-5 items-center justify-center rounded-full bg-cyan-500/10 text-[11px] font-bold text-cyan-700 dark:text-cyan-200">
                    {index + 1}
                  </span>
                  {step}
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white/85 p-4 dark:border-white/10 dark:bg-white/[0.04]">
              <div className="mb-3 flex items-center gap-2">
                <Database className="h-4 w-4 text-cyan-700 dark:text-cyan-200" />
                <p className="text-sm font-medium text-foreground">Preview da criacao</p>
              </div>
              <div className="grid gap-2 text-xs sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground">Tenant ID</p>
                  <p className="truncate font-mono text-foreground">{tenantId || "tenant-id"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Tabela de leads</p>
                  <p className="truncate font-mono text-foreground">{tablePreviewName}</p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-muted-foreground">Portal</p>
                  <p className="truncate font-mono text-foreground">/clientes/{tenantId || "tenant-id"}/dashboard</p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-muted-foreground">Modelo inicial</p>
                  <p className="truncate text-foreground">{selectedModel.title}</p>
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

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Tipo de schema do chatbot
                </label>
                <Select
                  value={chatbotModel}
                  onValueChange={(v) => setChatbotModel(v as "outlier" | "infinie" | "generico")}
                  disabled={!canManageTenants || createTenant.isPending}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="outlier">Outlier — Consórcio (crédito, parcela, FGTS)</SelectItem>
                    <SelectItem value="infinie">Infinie — Solar (instalação, conta de luz)</SelectItem>
                    <SelectItem value="generico">Genérico — Campos padrão apenas</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Define quais colunas extras serão criadas na tabela de leads desta empresa.
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
                disabled={!canSubmitTenant}
              >
                <Plus className="h-4 w-4" />
                {createTenant.isPending ? "Criando tenant e tabela..." : "Criar empresa e tabela"}
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
                  {filteredTenants.map((tenant) => {
                    const tableStatus = tableStatuses[tenant.id] || tenant.leads_table;
                    const expectedTableName = tableStatus?.tableName || `leads_${tenant.id.replace(/-/g, "_")}`;
                    const evolutionInstances = tenant.n8n_settings?.evolution_instances || [];
                    const evolutionDraft = getEvolutionDraft(tenant.id);

                    return (
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
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 px-4 py-3 text-sm dark:border-white/10 dark:bg-white/[0.03]">
                        <div className="flex min-w-0 items-start gap-3">
                          <Database className="mt-0.5 h-4 w-4 shrink-0 text-cyan-700 dark:text-cyan-200" />
                          <div className="min-w-0">
                            <p className="font-medium text-foreground">Tabela dinamica de leads</p>
                            <p className="truncate font-mono text-xs text-muted-foreground">{expectedTableName}</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            className={
                              tableStatus?.exists
                                ? "border border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
                                : "border border-amber-400/25 bg-amber-500/10 text-amber-700 dark:text-amber-200"
                            }
                          >
                            {tableStatus?.exists ? "Tabela OK" : "Nao verificada"}
                          </Badge>
                          {tableStatus?.exists ? (
                            <Badge className="border border-slate-300/80 bg-white/90 text-slate-700 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/80">
                              {tableStatus.columns?.length || 0} colunas
                            </Badge>
                          ) : null}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={verifyTenantTable.isPending}
                            onClick={() => void handleVerifyTenantTable(tenant)}
                          >
                            {verifyTenantTable.isPending ? "Verificando..." : "Verificar"}
                          </Button>
                        </div>
                      </div>
                      {canManageN8n ? (
                        <div className="mt-4 grid gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium text-foreground">Instancias Evolution</p>
                              <p className="text-xs text-muted-foreground">
                                Cadastre mais de uma Evolution API dentro do mesmo tenant e escolha qual sera padrao.
                              </p>
                            </div>
                            <Badge className="border border-slate-300/80 bg-white/90 text-slate-700 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/80">
                              {evolutionInstances.length} instancia{evolutionInstances.length === 1 ? "" : "s"}
                            </Badge>
                          </div>

                          {evolutionInstances.length > 0 ? (
                            <div className="grid gap-2">
                              {evolutionInstances.map((instance) => (
                                <div
                                  key={instance.id}
                                  className="grid gap-3 rounded-xl border border-slate-200/80 bg-white/85 p-3 text-sm dark:border-white/10 dark:bg-white/[0.04] lg:grid-cols-[minmax(0,1fr)_auto]"
                                >
                                  <div className="min-w-0 space-y-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="font-medium text-foreground">{instance.name}</p>
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
                                    <p className="truncate font-mono text-xs text-muted-foreground">
                                      {instance.dispatch_webhook_url}
                                    </p>

                                    {/* Anti-ban: saúde do chip (cota diária) */}
                                    {(() => {
                                      const draft = getChipDraft(instance);
                                      const displayLimit = resolveChipLimit(draft.chipState, draft.dailyLimitOverride);
                                      const sent = instance.sent_count_today ?? 0;
                                      const pct = displayLimit > 0 ? Math.min(100, Math.round((sent / displayLimit) * 100)) : 0;
                                      const barColor =
                                        pct >= 90
                                          ? "bg-red-500"
                                          : pct >= 70
                                            ? "bg-amber-400"
                                            : "bg-emerald-500";
                                      return (
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
                                            >
                                              <SelectTrigger className="h-7 w-[130px] text-xs">
                                                <SelectValue />
                                              </SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="cold">Frio (100/dia)</SelectItem>
                                                <SelectItem value="warm">Aquecido (500/dia)</SelectItem>
                                              </SelectContent>
                                            </Select>
                                            <Input
                                              className="h-7 w-24 text-xs"
                                              placeholder="Limite custom"
                                              type="number"
                                              min="1"
                                              value={draft.dailyLimitOverride}
                                              onChange={(e) =>
                                                updateChipDraft(instance.id, { dailyLimitOverride: e.target.value })
                                              }
                                            />
                                            <Button
                                              type="button"
                                              variant="outline"
                                              size="sm"
                                              className="h-7 text-xs"
                                              disabled={saveEvolutionInstance.isPending}
                                              onClick={() => void handleSaveChipSettings(tenant, instance)}
                                            >
                                              <Save className="mr-1 h-3 w-3" />
                                              Salvar cota
                                            </Button>
                                          </div>
                                        </div>
                                      );
                                    })()}
                                  </div>
                                  <div className="flex flex-wrap items-center justify-end gap-2">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      disabled={saveEvolutionInstance.isPending || instance.is_default}
                                      onClick={() =>
                                        void handleUpdateEvolutionInstance(tenant, instance, { isDefault: true })
                                      }
                                    >
                                      Padrao
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      disabled={saveEvolutionInstance.isPending}
                                      onClick={() =>
                                        void handleUpdateEvolutionInstance(tenant, instance, {
                                          active: !instance.active,
                                        })
                                      }
                                    >
                                      {instance.active ? "Desativar" : "Ativar"}
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      disabled={deleteEvolutionInstance.isPending}
                                      onClick={() => void handleDeleteEvolutionInstance(tenant, instance)}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                      Remover
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="rounded-xl border border-dashed border-slate-300/80 bg-white/70 px-3 py-4 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/[0.03]">
                              Nenhuma instancia extra cadastrada. O fallback abaixo continua atendendo os disparos atuais.
                            </div>
                          )}

                          <div className="grid gap-3 rounded-xl border border-slate-200/80 bg-white/80 p-3 dark:border-white/10 dark:bg-white/[0.04]">
                            <div className="grid gap-3 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.4fr)_minmax(0,0.8fr)]">
                              <div className="grid gap-1">
                                <Input
                                  placeholder="Nome da instancia"
                                  value={evolutionDraft.name}
                                  onChange={(event) =>
                                    updateEvolutionDraft(tenant.id, { name: event.target.value })
                                  }
                                />
                                <p className="px-1 text-[11px] text-muted-foreground">
                                  Espacos e acentos viram hifen ao criar (ex.: "Chip Vendas" -&gt; "chip-vendas"). E normal.
                                </p>
                              </div>
                              <Input
                                placeholder="URL de disparo Evolution"
                                value={evolutionDraft.dispatchWebhookUrl}
                                onChange={(event) =>
                                  updateEvolutionDraft(tenant.id, {
                                    dispatchWebhookUrl: event.target.value,
                                  })
                                }
                              />
                              <Input
                                placeholder="API Key Evolution"
                                value={evolutionDraft.dispatchWebhookToken}
                                onChange={(event) =>
                                  updateEvolutionDraft(tenant.id, {
                                    dispatchWebhookToken: event.target.value,
                                  })
                                }
                              />
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="flex flex-wrap items-center gap-4">
                                <label className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                  <input
                                    type="checkbox"
                                    checked={evolutionDraft.active}
                                    onChange={(event) =>
                                      updateEvolutionDraft(tenant.id, { active: event.target.checked })
                                    }
                                  />
                                  ativa
                                </label>
                                <label className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                  <input
                                    type="checkbox"
                                    checked={evolutionDraft.isDefault}
                                    onChange={(event) =>
                                      updateEvolutionDraft(tenant.id, { isDefault: event.target.checked })
                                    }
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
                                  onClick={() => void handleProvisionEvolutionInstance(tenant)}
                                >
                                  <Wand2 className="h-4 w-4" />
                                  {provisionEvolutionInstance.isPending ? "Criando..." : "Criar na Evolution"}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={
                                    saveEvolutionInstance.isPending ||
                                    !evolutionDraft.dispatchWebhookUrl.trim()
                                  }
                                  onClick={() => void handleCreateEvolutionInstance(tenant)}
                                >
                                  <Plus className="h-4 w-4" />
                                  {saveEvolutionInstance.isPending ? "Adicionando..." : "Adicionar manual"}
                                </Button>
                              </div>
                            </div>
                          </div>

                          <div className="grid gap-3 rounded-xl border border-slate-200/80 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.02]">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-medium text-foreground">Fallback legado</p>
                                <p className="text-xs text-muted-foreground">
                                  Usado quando nenhuma instancia Evolution padrao estiver ativa.
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
                            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.85fr)]">
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
                                {updateN8nSettings.isPending ? "Salvando..." : "Salvar fallback"}
                              </Button>
                            </div>
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
                    );
                  })}
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

      {/* Modal de QR — pareamento da instância recém-criada (Fatia 1 do self-service) */}
      <Dialog open={!!qrModal} onOpenChange={(open) => !open && setQrModal(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Parear WhatsApp</DialogTitle>
            <DialogDescription>
              Instancia{qrModal?.instanceName ? ` "${qrModal.instanceName}"` : ""} criada para{" "}
              {qrModal?.tenantName || "a empresa"}.
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
                <br />
                (Re-gerar o QR sem recriar vem na proxima atualizacao.)
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
    </PageShell>
  );
}
