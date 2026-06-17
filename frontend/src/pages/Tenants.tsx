import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Database, Info, KeyRound, Link2, Plus, Save, Search, SlidersHorizontal, Trash2, Wand2 } from "lucide-react";
import { ZodError } from "zod";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { EvolutionChipsPanel } from "@/components/EvolutionChipsPanel";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  LeadClient,
  type LeadClientSegmentationKpi,
  useCreateLeadClient,
  useDeleteLeadClient,
  useLeadClients,
  useUpdateLeadClientSegmentationConfig,
  useUpdateLeadClientN8nSettings,
  useVerifyLeadClientTable,
  type LeadClientTableStatus,
} from "@/hooks/useLeadClients";
import { createTenantSchema } from "@/lib/validationSchemas";

const CHATBOT_MODEL_OPTIONS = [
  {
    value: "outlier",
    title: "Consorcio / credito",
    description: "Campos e filtros para credito, parcela, FGTS, lance e objetivo de compra.",
  },
  {
    value: "infinie",
    title: "Energia solar",
    description: "Campos e filtros para instalacao, conta de luz, localidade e prazo.",
  },
  {
    value: "generico",
    title: "Modelo generico",
    description: "Campos basicos para empresas que ainda nao tem segmentacao propria.",
  },
] as const;

const CREATION_STEPS = [
  "Cria o tenant em leads_clients",
  "Cria a tabela dinamica de leads",
  "Libera dashboard, planilhas e portal",
];

const TENANTS_PAGE_SIZE = 8;

const DEFAULT_SEGMENTATION_KPIS: Record<"outlier" | "infinie" | "generico", LeadClientSegmentationKpi[]> = {
  outlier: [
    { id: "objetivo", label: "Objetivo", field: "objetivo_compra", type: "category", enabled: true },
    { id: "credito", label: "Credito", field: "valor_credito", type: "money", enabled: true },
    { id: "entrada", label: "Entrada/FGTS", field: "fgts_entrada", type: "money", enabled: true },
  ],
  infinie: [
    { id: "consumo", label: "Conta de luz", field: "faixa_consumo", type: "money", enabled: true },
    { id: "cidade", label: "Cidade", field: "cidade", type: "category", enabled: true },
    { id: "prazo", label: "Prazo", field: "prazo_instalacao", type: "category", enabled: true },
  ],
  generico: [
    { id: "origem", label: "Origem", field: "origem", type: "category", enabled: true },
    { id: "interesse", label: "Interesse", field: "interesse", type: "category", enabled: true },
    { id: "valor", label: "Valor", field: "valor", type: "money", enabled: true },
  ],
};

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

function buildFieldKey(value: string) {
  return buildTenantKey(value).replace(/-/g, "_");
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
  const updateSegmentationConfig = useUpdateLeadClientSegmentationConfig();
  const verifyTenantTable = useVerifyLeadClientTable();
  const { hasPermission, isAdminUser } = useAuth();
  const [name, setName] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [dispatchWebhookUrl, setDispatchWebhookUrl] = useState("");
  const [dispatchWebhookToken, setDispatchWebhookToken] = useState("");
  const [inboundBearerToken, setInboundBearerToken] = useState("");
  const [search, setSearch] = useState("");
  const [formError, setFormError] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [chatbotModel, setChatbotModel] = useState<"outlier" | "infinie" | "generico">("outlier");
  const [segmentationKpis, setSegmentationKpis] = useState<LeadClientSegmentationKpi[]>(DEFAULT_SEGMENTATION_KPIS.outlier);
  const [tenantsPage, setTenantsPage] = useState(1);
  const [tenantIdEdited, setTenantIdEdited] = useState(false);
  const [tenantPendingDelete, setTenantPendingDelete] = useState<string | null>(null);
  const [tableStatuses, setTableStatuses] = useState<Record<string, LeadClientTableStatus>>({});
  const [expandedTenants, setExpandedTenants] = useState<Record<string, boolean>>({});

  const toggleTenantExpanded = (id: string) => {
    setExpandedTenants((current) => ({
      ...current,
      [id]: !current[id],
    }));
  };
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
  const [segmentationDrafts, setSegmentationDrafts] = useState<Record<string, LeadClientSegmentationKpi[]>>({});
  const canManageTenants = hasPermission("tenants.manage");
  const canManageN8n = isAdminUser;
  const tablePreviewName = tenantId ? `leads_${tenantId.replace(/-/g, "_")}` : "leads_tenant_id";
  const selectedModel = CHATBOT_MODEL_OPTIONS.find((option) => option.value === chatbotModel) || CHATBOT_MODEL_OPTIONS[0];
  const canSubmitTenant = canManageTenants && Boolean(name.trim()) && Boolean(tenantId.trim()) && !createTenant.isPending;

  const handleModelChange = (value: "outlier" | "infinie" | "generico") => {
    setChatbotModel(value);
    setSegmentationKpis(DEFAULT_SEGMENTATION_KPIS[value]);
  };

  const updateSegmentationKpi = (index: number, patch: Partial<LeadClientSegmentationKpi>) => {
    setSegmentationKpis((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              ...patch,
            }
          : item
      )
    );
  };

  useEffect(() => {
    if (!tenantIdEdited) {
      setTenantId(buildTenantKey(name));
    }
  }, [name, tenantIdEdited]);

  useEffect(() => {
    setTenantsPage(1);
  }, [search]);

  const filteredTenants = tenants.filter((tenant) => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return true;

    return (
      tenant.name.toLowerCase().includes(normalizedSearch) ||
      tenant.id.toLowerCase().includes(normalizedSearch)
    );
  });
  const totalTenantPages = Math.max(1, Math.ceil(filteredTenants.length / TENANTS_PAGE_SIZE));
  const safeTenantsPage = Math.min(tenantsPage, totalTenantPages);
  const paginatedTenants = filteredTenants.slice(
    (safeTenantsPage - 1) * TENANTS_PAGE_SIZE,
    safeTenantsPage * TENANTS_PAGE_SIZE
  );

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
        id: payload.id!,
        name: payload.name!,
        chatbotModel,
        segmentationConfig: {
          version: 1,
          kpis: segmentationKpis
            .filter((item) => item.enabled && item.label.trim() && item.field.trim())
            .map((item) => ({
              ...item,
              label: item.label.trim(),
              field: buildFieldKey(item.field),
            })),
        },
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
      setSegmentationKpis(DEFAULT_SEGMENTATION_KPIS.outlier);
      setTenantIdEdited(false);
      setCreateDialogOpen(false);
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

  const getTenantSegmentationDraft = (tenant: LeadClient) => {
    const currentModel = (tenant.n8n_settings?.chatbot_model || "generico") as "outlier" | "infinie" | "generico";
    return (
      segmentationDrafts[tenant.id] ||
      tenant.n8n_settings?.segmentation_config?.kpis ||
      DEFAULT_SEGMENTATION_KPIS[currentModel] ||
      DEFAULT_SEGMENTATION_KPIS.generico
    );
  };

  const updateTenantSegmentationKpi = (tenant: LeadClient, index: number, patch: Partial<LeadClientSegmentationKpi>) => {
    setSegmentationDrafts((current) => {
      const base = current[tenant.id] || getTenantSegmentationDraft(tenant);
      return {
        ...current,
        [tenant.id]: base.map((item, itemIndex) =>
          itemIndex === index
            ? {
                ...item,
                ...patch,
              }
            : item
        ),
      };
    });
  };

  const handleSaveTenantSegmentation = async (tenant: LeadClient) => {
    const kpis = getTenantSegmentationDraft(tenant)
      .filter((item) => item.enabled !== false && item.label.trim() && item.field.trim())
      .map((item) => ({
        ...item,
        label: item.label.trim(),
        field: buildFieldKey(item.field),
      }));

    try {
      await updateSegmentationConfig.mutateAsync({
        tenantId: tenant.id,
        segmentationConfig: {
          version: 1,
          kpis,
        },
      });

      setSegmentationDrafts((current) => ({
        ...current,
        [tenant.id]: kpis,
      }));

      toast({
        title: "KPIs de segmentacao atualizados",
        description: `A segmentacao da empresa ${tenant.name} foi salva.`,
      });
    } catch (settingsError) {
      toast({
        title: "Falha ao salvar KPIs",
        description:
          settingsError instanceof Error
            ? settingsError.message
            : "Nao foi possivel atualizar a segmentacao.",
        variant: "destructive",
      });
    }
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
          <Badge className="border border-cyan-400/25 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-700 dark:text-cyan-200">
            {tenants.length} tenants
          </Badge>
          <Badge className="border border-slate-300/80 bg-white/90 px-2 py-0.5 text-[11px] text-slate-700 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/80">
            {canManageTenants ? "Criacao liberada" : "Consulta apenas"}
          </Badge>
          <Badge className="border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-200">
            {canManageN8n ? "Disparo Evolution liberado" : "Evolution restrito a admins"}
          </Badge>
          <Dialog
            open={createDialogOpen}
            onOpenChange={(open) => {
              setCreateDialogOpen(open);
              if (open) setFormError("");
            }}
          >
            <DialogTrigger asChild>
              <Button type="button" disabled={!canManageTenants}>
                <Plus className="h-4 w-4" />
                Nova empresa
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto p-0">
              <DialogHeader className="space-y-3 px-4 pb-0 pt-4">
                <div className="flex items-start justify-between gap-3 pr-8">
                  <div className="space-y-1">
                    <DialogTitle className="text-lg">Criar empresa</DialogTitle>
                    <DialogDescription className="text-xs">
                      Cadastre o cliente uma vez. O CRM cria o tenant, a tabela de leads e a rota do portal automaticamente.
                    </DialogDescription>
                  </div>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200">
                    <Wand2 className="h-4 w-4" />
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {CREATION_STEPS.map((step, index) => (
                    <div
                      key={step}
                      className="rounded-lg border border-border/70 bg-slate-50/50 px-2.5 py-2 text-[11px] leading-snug text-slate-600 dark:border-white/5 dark:bg-white/[0.02] dark:text-white/70"
                    >
                      <span className="mb-1 flex h-4 w-4 items-center justify-center rounded-full bg-cyan-500/10 text-[10px] font-bold text-cyan-700 dark:text-cyan-200">
                        {index + 1}
                      </span>
                      {step}
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-border/70 bg-slate-50/50 p-3 dark:border-white/5 dark:bg-white/[0.02]">
                  <div className="mb-2 flex items-center gap-2">
                    <Database className="h-4 w-4 text-cyan-700 dark:text-cyan-200" />
                    <p className="text-xs font-semibold text-foreground">Preview</p>
                  </div>
                  <div className="grid gap-2 text-[11px] sm:grid-cols-2">
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
              </DialogHeader>
              <form className="space-y-3 px-4 pb-4 pt-3" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-foreground" htmlFor="tenant-name">
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
                    <label className="text-xs font-semibold text-foreground" htmlFor="tenant-id">
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
                  <p className="text-[11px] text-muted-foreground">
                    Portal previsto:{" "}
                    <span className="font-mono text-foreground">
                      /clientes/{tenantId || "tenant-id"}/dashboard
                    </span>
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-start gap-3 rounded-lg border border-border/70 bg-slate-50/50 p-3 dark:border-white/5 dark:bg-white/[0.02]">
                    <SlidersHorizontal className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1 space-y-3">
                      <div>
                        <label className="text-xs font-semibold text-foreground">
                          Segmentacao da empresa
                        </label>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                          Escolha o perfil do negocio. Ele define os campos de leads e os filtros que farao sentido para este tenant.
                        </p>
                      </div>
                      <Select
                        value={chatbotModel}
                        onValueChange={(v) => handleModelChange(v as "outlier" | "infinie" | "generico")}
                        disabled={!canManageTenants || createTenant.isPending}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CHATBOT_MODEL_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="rounded-lg border border-border/70 bg-slate-100/50 p-2.5 text-[11px] leading-relaxed text-muted-foreground dark:border-white/5 dark:bg-black/25">
                        <span className="font-semibold text-foreground">{selectedModel.title}:</span>{" "}
                        {selectedModel.description}
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-foreground">KPIs de segmentacao</p>
                        <div className="grid gap-2">
                          {segmentationKpis.map((kpi, index) => (
                            <div key={kpi.id} className="grid gap-2 rounded-lg border border-border/70 bg-slate-100/50 p-2 dark:border-white/5 dark:bg-black/25 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px]">
                              <Input
                                className="h-9"
                                placeholder="Nome do KPI"
                                value={kpi.label}
                                onChange={(event) => updateSegmentationKpi(index, { label: event.target.value })}
                                disabled={!canManageTenants || createTenant.isPending}
                              />
                              <Input
                                className="h-9 font-mono text-xs"
                                placeholder="campo_da_planilha"
                                value={kpi.field}
                                onChange={(event) => updateSegmentationKpi(index, { field: buildFieldKey(event.target.value) })}
                                disabled={!canManageTenants || createTenant.isPending}
                              />
                              <Select
                                value={kpi.type}
                                onValueChange={(value) => updateSegmentationKpi(index, { type: value as LeadClientSegmentationKpi["type"] })}
                                disabled={!canManageTenants || createTenant.isPending}
                              >
                                <SelectTrigger className="h-9">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="category">Categoria</SelectItem>
                                  <SelectItem value="money">Valor</SelectItem>
                                  <SelectItem value="number">Numero</SelectItem>
                                  <SelectItem value="date">Data</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          ))}
                        </div>
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          Esses KPIs aparecem na criacao de campanha e usam os campos importados na planilha desta empresa.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <ErrorMessage message={formError} variant="banner" />

                {canManageN8n ? (
                  <div className="space-y-3 rounded-lg border border-border/70 bg-slate-50/50 p-3 dark:border-white/5 dark:bg-white/[0.02]">
                    <div className="flex items-start gap-3">
                      <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-700 dark:text-cyan-200" />
                      <div>
                        <p className="text-xs font-semibold text-foreground">Evolution API</p>
                        <p className="text-[11px] text-muted-foreground">
                          URL e API Key da instancia Evolution para envio de mensagens.
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

                <Button
                  type="submit"
                  className="w-full justify-center"
                  disabled={!canSubmitTenant}
                >
                  <Plus className="h-4 w-4" />
                  {createTenant.isPending ? "Criando tenant e tabela..." : "Criar empresa e tabela"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      }
    >
      <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Base operacional</CardDescription>
                <CardTitle className="text-2xl">{tenants.length}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground">
                Total de empresas prontas para receber usuarios, dados e campanhas.
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Ultimo cadastro</CardDescription>
                <CardTitle className="text-base">
                  {latestTenant ? formatCreatedAt(latestTenant) : "Nenhum tenant criado"}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground">
                Use esse painel para garantir que todo novo cliente entre com `clientId` padrao e
                rota consistente.
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle>Tenants cadastrados</CardTitle>
                  <CardDescription>
                    Consulte IDs, datas de criacao e a rota base de cada empresa.
                  </CardDescription>
                </div>
                <div className="relative w-full max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Buscar por nome ou tenant ID"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <ErrorMessage message={error ? (error as Error).message : null} variant="banner" />

              {isLoading ? (
                <div className="rounded-lg border border-slate-200/80 bg-white/70 px-4 py-6 text-center text-xs text-muted-foreground dark:border-white/10 dark:bg-white/[0.03]">
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
                <div className="grid gap-2">
                  {paginatedTenants.map((tenant) => {
                    const tableStatus = tableStatuses[tenant.id] || tenant.leads_table;
                    const expectedTableName = tableStatus?.tableName || `leads_${tenant.id.replace(/-/g, "_")}`;
                    const tenantSegmentationKpis = getTenantSegmentationDraft(tenant);
                    return (
                    <div
                      key={tenant.id}
                      className="rounded-xl border border-border/70 bg-card/60 p-4 shadow-sm"
                    >
                      {/* Compact Header */}
                      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-white/5">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{tenant.name}</p>
                            <Badge className="border border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200 text-[10px]">
                              {tenant.id}
                            </Badge>
                            <Badge className="border border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 text-[10px]">
                              {tenant.n8n_onboarding_status || "pendente"}
                            </Badge>
                          </div>
                          <p className="text-[10px] text-slate-400 dark:text-white/30 uppercase tracking-[0.1em] font-mono">
                            Criado em: {formatCreatedAt(tenant.created_at)}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleTenantExpanded(tenant.id)}
                          className="h-8 text-xs gap-1.5 hover:bg-slate-100 dark:hover:bg-white/5 border border-slate-200 dark:border-white/10"
                        >
                          <SlidersHorizontal className="h-3.5 w-3.5" />
                          {expandedTenants[tenant.id] ? "Recolher Configurações" : "Configurações Avançadas & KPIs"}
                          {expandedTenants[tenant.id] ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>

                      {/* Summary Metrics Row */}
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {/* Rota base */}
                        <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 px-3 py-2 text-xs dark:border-white/10 dark:bg-white/[0.03] flex items-center justify-between">
                          <div>
                            <p className="font-medium text-foreground text-[11px]">Rota base do portal</p>
                            <p className="font-mono text-xs text-muted-foreground">/clientes/{tenant.id}/dashboard</p>
                          </div>
                          <Badge variant="outline" className="text-[10px] uppercase font-mono">link</Badge>
                        </div>
                        {/* Tabela de leads */}
                        <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 px-3 py-2 text-xs dark:border-white/10 dark:bg-white/[0.03] flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Database className="h-3.5 w-3.5 shrink-0 text-cyan-700 dark:text-cyan-200" />
                            <div className="min-w-0">
                              <p className="font-medium text-foreground text-[11px]">Tabela de leads</p>
                              <p className="truncate font-mono text-[10px] text-muted-foreground">{expectedTableName}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Badge
                              className={
                                tableStatus?.exists
                                  ? "border border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 text-[10px]"
                                  : "border border-amber-400/25 bg-amber-500/10 text-amber-700 dark:text-amber-200 text-[10px]"
                              }
                            >
                              {tableStatus?.exists ? "OK" : "Não verif."}
                            </Badge>
                            {tableStatus?.exists ? (
                              <Badge className="border border-slate-300/80 bg-white/90 text-[10px] text-slate-700 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/80">
                                {tableStatus.columns?.length || 0} col
                              </Badge>
                            ) : null}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-[10px] px-2"
                              disabled={verifyTenantTable.isPending}
                              onClick={() => void handleVerifyTenantTable(tenant)}
                            >
                              {verifyTenantTable.isPending ? "..." : "Verificar"}
                            </Button>
                          </div>
                        </div>
                      </div>

                      {/* Collapsible Panel */}
                      {expandedTenants[tenant.id] && (
                        <div className="mt-4 pt-4 border-t border-slate-200/60 dark:border-white/10 space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
                          {/* KPIs de segmentacao */}
                          {canManageTenants ? (
                            <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3 dark:border-white/10 dark:bg-white/[0.01]">
                              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <SlidersHorizontal className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
                                    <p className="text-xs font-semibold text-foreground">KPIs de Segmentação</p>
                                  </div>
                                  <p className="text-[11px] text-muted-foreground mt-0.5">
                                    Configure as colunas de dados do lead que viram filtros de campanhas no CRM.
                                  </p>
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={updateSegmentationConfig.isPending}
                                  onClick={() => void handleSaveTenantSegmentation(tenant)}
                                  className="h-8"
                                >
                                  <Save className="h-3.5 w-3.5" />
                                  {updateSegmentationConfig.isPending ? "Salvando..." : "Salvar KPIs"}
                                </Button>
                              </div>

                              {/* Help box for KPIs */}
                              <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-blue-400/25 bg-blue-500/5 p-3 text-[11px] leading-relaxed text-blue-700 dark:text-blue-300">
                                <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                                <div className="space-y-1">
                                  <p className="font-semibold">O que são os KPIs de Segmentação?</p>
                                  <p>
                                    Eles conectam os campos do seu Excel/banco de dados com os filtros na tela de criação de campanhas de disparo.
                                  </p>
                                  <ul className="list-disc pl-4 space-y-0.5 mt-1">
                                    <li><strong>Rótulo de Exibição (CRM):</strong> Como o filtro aparecerá para você na interface do CRM (ex: <em>Origem</em>).</li>
                                    <li><strong>Coluna da Planilha:</strong> O nome exato da coluna da tabela de leads no banco de dados (ex: <em>origem</em>).</li>
                                    <li><strong>Tipo do Dado:</strong> Define como os leads serão filtrados (Categoria, Valor/Dinheiro, Número ou Data).</li>
                                  </ul>
                                  <p className="text-muted-foreground text-[10px] mt-1">
                                    * A repetição (ex: Origem {"->"} origem) é comum se você está usando o modelo padrão. Não é um erro.
                                  </p>
                                </div>
                              </div>

                              {/* KPI Inputs Grid */}
                              <div className="space-y-2">
                                {/* Column Headers */}
                                <div className="hidden md:grid gap-2 px-2 text-[10px] uppercase font-semibold tracking-wider text-muted-foreground md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px]">
                                  <div>Rótulo de Exibição (CRM)</div>
                                  <div>Coluna da Planilha (Banco)</div>
                                  <div>Tipo do Dado</div>
                                </div>

                                {tenantSegmentationKpis.map((kpi, index) => (
                                  <div key={`${tenant.id}-${kpi.id}-${index}`} className="grid gap-2 rounded-lg border border-slate-200/70 bg-white p-2 dark:border-white/10 dark:bg-black/20 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px]">
                                    <div className="space-y-1">
                                      <label className="text-[10px] font-medium text-muted-foreground md:hidden">Rótulo de Exibição (CRM)</label>
                                      <Input
                                        className="h-8"
                                        placeholder="Ex: Origem do Lead"
                                        value={kpi.label}
                                        onChange={(event) => updateTenantSegmentationKpi(tenant, index, { label: event.target.value })}
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[10px] font-medium text-muted-foreground md:hidden">Coluna da Planilha (Banco)</label>
                                      <Input
                                        className="h-8 font-mono text-xs"
                                        placeholder="Ex: origem"
                                        value={kpi.field}
                                        onChange={(event) => updateTenantSegmentationKpi(tenant, index, { field: buildFieldKey(event.target.value) })}
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[10px] font-medium text-muted-foreground md:hidden">Tipo do Dado</label>
                                      <Select
                                        value={kpi.type}
                                        onValueChange={(value) => updateTenantSegmentationKpi(tenant, index, { type: value as LeadClientSegmentationKpi["type"] })}
                                      >
                                        <SelectTrigger className="h-8">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="category">Categoria</SelectItem>
                                          <SelectItem value="money">Valor</SelectItem>
                                          <SelectItem value="number">Numero</SelectItem>
                                          <SelectItem value="date">Data</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {/* Chips and integrations settings */}
                          {canManageN8n ? (
                            <div className="space-y-3 rounded-lg border border-slate-200/80 bg-slate-50/50 p-3 dark:border-white/10 dark:bg-white/[0.01]">
                              <EvolutionChipsPanel tenant={tenant} />

                              {/* Fallback legado */}
                              <div className="grid gap-3 rounded-xl border border-slate-200/80 bg-white p-3 dark:border-white/10 dark:bg-black/20">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <p className="text-xs font-semibold text-foreground">Fallback Legado</p>
                                    <p className="text-[11px] text-muted-foreground">
                                      URL e Token usados quando nenhuma instância Evolution padrão estiver configurada.
                                    </p>
                                  </div>
                                  <label className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
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
                                <div className="grid gap-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.85fr)]">
                                  <Input
                                    placeholder="URL de disparo Evolution"
                                    className="h-8 text-xs"
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
                                    className="h-8 text-xs"
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
                                      className="h-8 text-xs"
                                      disabled={updateN8nSettings.isPending}
                                      onClick={() => void handleClearTenantToken(tenant, "dispatchWebhookToken")}
                                    >
                                      Remover API Key
                                    </Button>
                                  ) : null}
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="h-8 text-xs"
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

                          {/* Danger zone / Delete button */}
                          {canManageTenants ? (
                            <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-white/5">
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
                                    className="h-8 text-xs animate-pulse hover:animate-none"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
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
                      )}
                    </div>
                    );
                  })}
                  {totalTenantPages > 1 ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 pt-3 text-xs text-muted-foreground dark:border-white/10">
                      <span>
                        Mostrando {(safeTenantsPage - 1) * TENANTS_PAGE_SIZE + 1}-
                        {Math.min(safeTenantsPage * TENANTS_PAGE_SIZE, filteredTenants.length)} de {filteredTenants.length}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={safeTenantsPage <= 1}
                          onClick={() => setTenantsPage((page) => Math.max(1, page - 1))}
                        >
                          Anterior
                        </Button>
                        <span className="rounded-md border border-slate-200/80 bg-white px-2 py-1 font-semibold text-foreground dark:border-white/10 dark:bg-white/[0.04]">
                          {safeTenantsPage}/{totalTenantPages}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={safeTenantsPage >= totalTenantPages}
                          onClick={() => setTenantsPage((page) => Math.min(totalTenantPages, page + 1))}
                        >
                          Proxima
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="rounded-[22px] border border-cyan-500/20 bg-cyan-500/5 px-5 py-4 text-sm text-slate-700 dark:text-white/75 shadow-sm">
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

    </PageShell>
  );
}
