import { useEffect, useState } from "react";
import { Database, KeyRound, Link2, Plus, SlidersHorizontal, Wand2 } from "lucide-react";
import { ZodError } from "zod";
import { ErrorMessage } from "@/components/ErrorMessage";
import { Button } from "@/components/ui/button";
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
import { LeadClient, useCreateLeadClient } from "@/hooks/useLeadClients";
import { createTenantSchema } from "@/lib/validationSchemas";
import { CHATBOT_MODEL_OPTIONS, CREATION_STEPS, type ChatbotModelValue } from "@/lib/tenants/constants";
import { buildTenantKey } from "@/lib/tenants/helpers";

interface CreateTenantDialogProps {
  onTenantCreated: (tenant: LeadClient) => void;
}

export function CreateTenantDialog({ onTenantCreated }: CreateTenantDialogProps) {
  const createTenant = useCreateLeadClient();
  const { hasPermission, isAdminUser } = useAuth();
  const [name, setName] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [dispatchWebhookUrl, setDispatchWebhookUrl] = useState("");
  const [dispatchWebhookToken, setDispatchWebhookToken] = useState("");
  const [inboundBearerToken, setInboundBearerToken] = useState("");
  const [formError, setFormError] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [chatbotModel, setChatbotModel] = useState<ChatbotModelValue>("energia-solar");
  const [tenantIdEdited, setTenantIdEdited] = useState(false);
  const canManageTenants = hasPermission("tenants.manage");
  const canManageN8n = isAdminUser;
  const tablePreviewName = tenantId ? `leads_${tenantId.replace(/-/g, "_")}` : "leads_tenant_id";
  const selectedModel = CHATBOT_MODEL_OPTIONS.find((option) => option.value === chatbotModel) || CHATBOT_MODEL_OPTIONS[0];
  const canSubmitTenant = canManageTenants && Boolean(name.trim()) && Boolean(tenantId.trim()) && !createTenant.isPending;

  const handleModelChange = (value: ChatbotModelValue) => {
    setChatbotModel(value);
  };

  useEffect(() => {
    if (!tenantIdEdited) {
      setTenantId(buildTenantKey(name));
    }
  }, [name, tenantIdEdited]);

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

      onTenantCreated(createdTenant);

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
      setChatbotModel("energia-solar");
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

  return (
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
                  onValueChange={(v) => handleModelChange(v as ChatbotModelValue)}
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
  );
}
