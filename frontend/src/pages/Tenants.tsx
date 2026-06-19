import { useEffect, useState, useMemo } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Database, Info, KeyRound, Link2, Plus, Save, Search, SlidersHorizontal, Trash2, Wand2, Settings } from "lucide-react";
import { ZodError } from "zod";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { EvolutionChipsPanel } from "@/components/EvolutionChipsPanel";
import { PageShell } from "@/components/PageShell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
  useCreateLeadClient,
  useDeleteLeadClient,
  useLeadClients,
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

const ALL_TAB_KEYS = [
  "dashboard",
  "leads",
  "conversas",
  "inteligencia",
  "inteligencia:visao-geral",
  "inteligencia:metricas",
  "inteligencia:rankings",
  "inteligencia:distribuicao",
  "inteligencia:consultores",
  "inteligencia:campanhas",
  "inteligencia:insights",
  "inteligencia:configuracoes",
  "chatbot-kanban",
  "chatbot",
  "chatbot:geral",
  "chatbot:template",
  "chatbot:prompts",
  "chatbot:teste",
  "followup",
  "followup:fila",
  "followup:sugestoes",
  "followup:campanhas",
  "followup:metrics",
  "followup:config",
  "conexoes",
  "campanhas",
  "aquecimento",
  "relatorios",
  "apresentacao",
  "onboarding",
  "chatbot-docs",
  "usuarios"
];

const TABS_HIERARCHY = [
  {
    key: "vendas",
    label: "Máquina de Vendas",
    children: [
      { key: "dashboard", label: "Dashboard" },
      { key: "leads", label: "Leads" },
      { key: "conversas", label: "Conversas" },
      {
        key: "inteligencia",
        label: "Inteligência Comercial",
        children: [
          { key: "inteligencia:visao-geral", label: "Visão Geral" },
          { key: "inteligencia:metricas", label: "Métricas" },
          { key: "inteligencia:rankings", label: "Rankings" },
          { key: "inteligencia:distribuicao", label: "Distribuição" },
          { key: "inteligencia:consultores", label: "Consultores" },
          { key: "inteligencia:campanhas", label: "Campanhas" },
          { key: "inteligencia:insights", label: "Insights" },
          { key: "inteligencia:configuracoes", label: "Ajustes" },
        ]
      },
      { key: "chatbot-kanban", label: "Chatbot Kanban" },
      {
        key: "chatbot",
        label: "Chatbot (Configurações)",
        children: [
          { key: "chatbot:geral", label: "Geral" },
          { key: "chatbot:template", label: "Template" },
          { key: "chatbot:prompts", label: "Prompts" },
          { key: "chatbot:teste", label: "Teste" },
        ]
      },
      {
        key: "followup",
        label: "Follow-up",
        children: [
          { key: "followup:fila", label: "Fila de Envios" },
          { key: "followup:sugestoes", label: "Sugestões de IA" },
          { key: "followup:campanhas", label: "Campanhas & Templates" },
          { key: "followup:metrics", label: "Métricas" },
          { key: "followup:config", label: "Configuração" },
        ]
      }
    ]
  },
  {
    key: "disparos",
    label: "Máquina de Disparos",
    children: [
      { key: "conexoes", label: "Chips WhatsApp" },
      { key: "campanhas", label: "Envios por Planilha" },
      { key: "aquecimento", label: "Aquecimento" },
      { key: "relatorios", label: "Relatórios" }
    ]
  },
  {
    key: "sistema",
    label: "Sistema",
    children: [
      { key: "apresentacao", label: "Demonstração Vexo" },
      { key: "onboarding", label: "Treinamento Vexo" },
      { key: "chatbot-docs", label: "Chatbot Docs" },
      { key: "usuarios", label: "Usuários" }
    ]
  }
];

const CREATION_STEPS = [
  "Cria o tenant em leads_clients",
  "Cria a tabela dinamica de leads",
  "Libera dashboard, planilhas e portal",
];

const TENANTS_PAGE_SIZE = 8;

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
  const [tenantsPage, setTenantsPage] = useState(1);
  const [tenantIdEdited, setTenantIdEdited] = useState(false);
  const [tenantPendingDelete, setTenantPendingDelete] = useState<string | null>(null);
  const [tableStatuses, setTableStatuses] = useState<Record<string, LeadClientTableStatus>>({});
  const [selectedTenantForConfig, setSelectedTenantForConfig] = useState<LeadClient | null>(null);
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "alphabetical_asc" | "alphabetical_desc">("newest");
  const [pageSize, setPageSize] = useState<10 | 20>(10);
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
  const tablePreviewName = tenantId ? `leads_${tenantId.replace(/-/g, "_")}` : "leads_tenant_id";
  const selectedModel = CHATBOT_MODEL_OPTIONS.find((option) => option.value === chatbotModel) || CHATBOT_MODEL_OPTIONS[0];
  const canSubmitTenant = canManageTenants && Boolean(name.trim()) && Boolean(tenantId.trim()) && !createTenant.isPending;

  const handleModelChange = (value: "outlier" | "infinie" | "generico") => {
    setChatbotModel(value);
  };

  useEffect(() => {
    if (!tenantIdEdited) {
      setTenantId(buildTenantKey(name));
    }
  }, [name, tenantIdEdited]);

  useEffect(() => {
    setTenantsPage(1);
  }, [search, sortBy, pageSize]);

  const filteredTenants = useMemo(() => {
    let result = [...tenants];
    const normalizedSearch = search.trim().toLowerCase();
    if (normalizedSearch) {
      result = result.filter(
        (tenant) =>
          tenant.name.toLowerCase().includes(normalizedSearch) ||
          tenant.id.toLowerCase().includes(normalizedSearch)
      );
    }

    result.sort((a, b) => {
      if (sortBy === "newest") {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateB - dateA;
      }
      if (sortBy === "oldest") {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateA - dateB;
      }
      if (sortBy === "alphabetical_asc") {
        return a.name.localeCompare(b.name, "pt-BR");
      }
      if (sortBy === "alphabetical_desc") {
        return b.name.localeCompare(a.name, "pt-BR");
      }
      return 0;
    });

    return result;
  }, [tenants, search, sortBy]);

  const totalTenantPages = Math.max(1, Math.ceil(filteredTenants.length / pageSize));
  const safeTenantsPage = Math.min(tenantsPage, totalTenantPages);
  const paginatedTenants = filteredTenants.slice(
    (safeTenantsPage - 1) * pageSize,
    safeTenantsPage * pageSize
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
          kpis: [],
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>Tenants cadastrados</CardTitle>
                  <CardDescription>
                    Consulte IDs, datas de criacao e a rota base de cada empresa.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  <div className="relative w-full max-w-xs sm:w-64">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-9 text-xs"
                      placeholder="Buscar por nome ou tenant ID"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </div>
                  <Select
                    value={sortBy}
                    onValueChange={(value) => setSortBy(value as any)}
                  >
                    <SelectTrigger className="h-9 w-44 rounded-xl text-xs bg-white/80 dark:bg-white/[0.02] border-slate-200 dark:border-white/10">
                      <SelectValue placeholder="Ordenar por" />
                    </SelectTrigger>
                    <SelectContent className="border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-white/10 dark:bg-[#0b0e1a] dark:text-white text-xs">
                      <SelectItem value="newest">Mais recentes</SelectItem>
                      <SelectItem value="oldest">Mais antigas</SelectItem>
                      <SelectItem value="alphabetical_asc">Ordem alfabética A-Z</SelectItem>
                      <SelectItem value="alphabetical_desc">Ordem alfabética Z-A</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
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
                <div className="space-y-4">
                  <div className="overflow-x-auto rounded-xl border border-slate-200/60 dark:border-white/5 bg-slate-50/20 dark:bg-white/[0.01]">
                    <Table className="text-xs">
                      <TableHeader className="bg-slate-50/50 dark:bg-white/[0.02]">
                        <TableRow className="border-slate-200/60 dark:border-white/5">
                          <TableHead className="px-4 py-3 font-semibold uppercase text-[10px] tracking-wider text-slate-500">Nome / ID</TableHead>
                          <TableHead className="px-4 py-3 font-semibold uppercase text-[10px] tracking-wider text-slate-500">Criado em</TableHead>
                          <TableHead className="px-4 py-3 font-semibold uppercase text-[10px] tracking-wider text-slate-500 text-center">Onboarding</TableHead>
                          <TableHead className="px-4 py-3 font-semibold uppercase text-[10px] tracking-wider text-slate-500">Tabela de Leads</TableHead>
                          <TableHead className="px-4 py-3 font-semibold uppercase text-[10px] tracking-wider text-slate-500 text-right">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedTenants.map((tenant) => {
                          const tableStatus = tableStatuses[tenant.id] || tenant.leads_table;
                          const expectedTableName = tableStatus?.tableName || `leads_${tenant.id.replace(/-/g, "_")}`;
                          return (
                            <TableRow
                              key={tenant.id}
                              className="border-slate-200/60 hover:bg-slate-50/50 dark:border-white/5 dark:hover:bg-white/[0.01] cursor-pointer"
                              onClick={() => setSelectedTenantForConfig(tenant)}
                            >
                              <TableCell className="px-4 py-3 font-medium text-foreground">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold">{tenant.name}</span>
                                  <Badge className="border border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200 text-[10px] font-mono font-medium">
                                    {tenant.id}
                                  </Badge>
                                </div>
                              </TableCell>
                              <TableCell className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                                {formatCreatedAt(tenant.created_at)}
                              </TableCell>
                              <TableCell className="px-4 py-3 text-center">
                                <Badge className="border border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 text-[10px] font-medium capitalize">
                                  {tenant.n8n_onboarding_status || "pendente"}
                                </Badge>
                              </TableCell>
                              <TableCell className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-[11px] text-muted-foreground truncate max-w-[160px]" title={expectedTableName}>
                                    {expectedTableName}
                                  </span>
                                  <Badge
                                    className={
                                      tableStatus?.exists
                                        ? "border border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 text-[10px]"
                                        : "border border-amber-400/25 bg-amber-500/10 text-amber-700 dark:text-amber-200 text-[10px]"
                                    }
                                  >
                                    {tableStatus?.exists ? "OK" : "Não verif."}
                                  </Badge>
                                </div>
                              </TableCell>
                              <TableCell className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5"
                                  onClick={() => setSelectedTenantForConfig(tenant)}
                                  title="Configurações Avançadas"
                                >
                                  <Settings className="h-3.5 w-3.5" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  {filteredTenants.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 pt-3 text-xs text-muted-foreground dark:border-white/10">
                      <div className="flex items-center gap-4">
                        <span>
                          Mostrando {filteredTenants.length === 0 ? 0 : (safeTenantsPage - 1) * pageSize + 1}-
                          {Math.min(safeTenantsPage * pageSize, filteredTenants.length)} de {filteredTenants.length}
                        </span>

                        <div className="flex items-center gap-1.5">
                          <span>Empresas por página:</span>
                          <Select
                            value={String(pageSize)}
                            onValueChange={(val) => setPageSize(Number(val) as 10 | 20)}
                          >
                            <SelectTrigger className="h-7 w-16 rounded-lg text-xs bg-white/80 dark:bg-white/[0.02] border-slate-200 dark:border-white/10">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-white/10 dark:bg-[#0b0e1a] dark:text-white text-xs">
                              <SelectItem value="10">10</SelectItem>
                              <SelectItem value="20">20</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {totalTenantPages > 1 && (
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-lg"
                            disabled={safeTenantsPage <= 1}
                            onClick={() => setTenantsPage((page) => Math.max(1, page - 1))}
                          >
                            Anterior
                          </Button>
                          <span className="rounded-md border border-slate-200/80 bg-white px-2.5 py-1 font-semibold text-foreground dark:border-white/10 dark:bg-white/[0.04]">
                            {safeTenantsPage}/{totalTenantPages}
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-lg"
                            disabled={safeTenantsPage >= totalTenantPages}
                            onClick={() => setTenantsPage((page) => Math.min(totalTenantPages, page + 1))}
                          >
                            Próxima
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── MODAL DE CONFIGURAÇÕES DA EMPRESA ───────────────────────────────── */}
          <Dialog
            open={selectedTenantForConfig !== null}
            onOpenChange={(open) => {
              if (!open) {
                setSelectedTenantForConfig(null);
              }
            }}
          >
            {selectedTenantForConfig && (() => {
              const tenant = selectedTenantForConfig;
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
