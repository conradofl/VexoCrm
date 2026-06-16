import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Database, KeyRound, Link2, RefreshCw, Save, Search, ServerCog } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";

interface EvolutionInstanceRow {
  id: string;
  client_id: string;
  client_name: string;
  name: string;
  dispatch_webhook_url: string | null;
  has_dispatch_webhook_token: boolean;
  has_inbound_bearer_token: boolean;
  active: boolean;
  is_default: boolean;
  chip_state: "cold" | "warm";
  daily_limit_override: number | null;
  updated_at: string | null;
  updated_by_email?: string | null;
}

interface LegacySettingsRow {
  client_id: string;
  client_name: string;
  dispatch_webhook_url: string | null;
  has_dispatch_webhook_token: boolean;
  has_inbound_bearer_token: boolean;
  active: boolean;
  chatbot_enabled: boolean;
  chatbot_model: string | null;
  sdr_whatsapp_number: string | null;
  updated_at: string | null;
}

interface FollowupCompanyRow {
  id: string;
  name: string;
  evolution_instance: string | null;
  webhook_url: string | null;
  panel_access: boolean;
  updated_at: string | null;
}

interface TenantOption {
  id: string;
  name: string;
}

interface RemoteEvolutionInstanceRow {
  name: string;
  display_name: string | null;
  status: string | null;
  integration: string | null;
  owner_jid: string | null;
  webhook_url: string | null;
  dispatch_webhook_url: string | null;
  updated_at: string | null;
  local_instance_id: string | null;
  local_client_id: string | null;
  local_client_name: string | null;
}

interface EvolutionInventory {
  env: {
    evolutionApiUrl: string | null;
    hasEvolutionApiKey: boolean;
    dispatchJsonFallbacks: { key: string; configured: boolean }[];
    tenantFallbacks: { key: string; value: string | null; configured: boolean; secret: boolean }[];
  };
  tenants: TenantOption[];
  remoteInstances: {
    configured: boolean;
    error: string | null;
    skipped?: boolean;
    items: RemoteEvolutionInstanceRow[];
  };
  instances: EvolutionInstanceRow[];
  legacySettings: LegacySettingsRow[];
  followupCompanies: FollowupCompanyRow[];
  bulkResult?: {
    evolutionInstancesUpdated: number;
    legacySettingsUpdated: number;
    dispatchTokenUpdated: boolean;
  };
}

type EditTarget =
  | { type: "instance"; row: EvolutionInstanceRow }
  | { type: "legacy"; row: LegacySettingsRow }
  | { type: "followup"; row: FollowupCompanyRow }
  | { type: "remote"; row: RemoteEvolutionInstanceRow };

interface EditForm {
  name: string;
  dispatchWebhookUrl: string;
  dispatchWebhookToken: string;
  inboundBearerToken: string;
  active: boolean;
  tenantId: string;
  isDefault: boolean;
  evolutionInstance: string;
  webhookUrl: string;
}

const emptyEditForm: EditForm = {
  name: "",
  dispatchWebhookUrl: "",
  dispatchWebhookToken: "",
  inboundBearerToken: "",
  active: true,
  tenantId: "",
  isDefault: false,
  evolutionInstance: "",
  webhookUrl: "",
};

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("pt-BR");
}

function secretBadge(defined: boolean) {
  return defined ? (
    <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
      definido
    </Badge>
  ) : (
    <Badge variant="secondary">vazio</Badge>
  );
}

function shortUrl(value?: string | null) {
  if (!value) return "-";
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
}

export default function EvolutionAdmin() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [editForm, setEditForm] = useState<EditForm>(emptyEditForm);
  const [includeRemote, setIncludeRemote] = useState(false);
  const [bulkForm, setBulkForm] = useState({
    oldBaseUrl: "",
    newBaseUrl: "",
    updateDispatchToken: false,
    dispatchWebhookToken: "",
  });

  const inventoryQuery = useQuery({
    queryKey: ["admin-evolution-config", includeRemote],
    queryFn: async (): Promise<EvolutionInventory> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");
      const res = await fetchApi(`/api/admin/evolution-config${includeRemote ? "?remote=true" : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Falha ao carregar Evolution"));
      return readApiJson<EvolutionInventory>(res, "admin-evolution-config");
    },
    // INCIDENTE 15/06: com remote=true esta query chama /instance/fetchInstances na
    // Evolution (query pesada no banco DELA). Com as opções default do react-query
    // (staleTime 0 + refetchOnWindowFocus + retry 3) a aba aberta martelava a Evolution
    // a cada foco/timeout → sobrecarga da Evo DB + Evo API. Busca remota é one-shot,
    // só via botão "Buscar Evolution": sem refetch automático nem retry.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ path, body, method = "PATCH" }: { path: string; body: Record<string, unknown>; method?: "PATCH" | "POST" }) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");
      const res = await fetchApi(path, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Falha ao atualizar Evolution"));
      return readApiJson<EvolutionInventory>(res, "admin-evolution-update");
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["admin-evolution-config", includeRemote], data);
      setEditTarget(null);
      toast({ title: "Configuracao atualizada" });
    },
    onError: (error) => {
      toast({ title: "Erro ao atualizar", description: error instanceof Error ? error.message : "Falha desconhecida", variant: "destructive" });
    },
  });

  const bulkMutation = useMutation({
    mutationFn: async () => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");
      const res = await fetchApi("/api/admin/evolution-config/bulk-replace", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(bulkForm),
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Falha na troca em massa"));
      return readApiJson<EvolutionInventory>(res, "admin-evolution-bulk");
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["admin-evolution-config", includeRemote], data);
      toast({
        title: "URLs atualizadas",
        description: `${data.bulkResult?.evolutionInstancesUpdated ?? 0} instancias e ${data.bulkResult?.legacySettingsUpdated ?? 0} settings legados.`,
      });
    },
    onError: (error) => {
      toast({ title: "Erro na troca em massa", description: error instanceof Error ? error.message : "Falha desconhecida", variant: "destructive" });
    },
  });

  const inventory = inventoryQuery.data;
  const needle = search.trim().toLowerCase();

  const filteredInstances = useMemo(() => {
    const rows = inventory?.instances ?? [];
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.client_id, row.client_name, row.name, row.dispatch_webhook_url].some((value) =>
        String(value ?? "").toLowerCase().includes(needle)
      )
    );
  }, [inventory?.instances, needle]);

  const filteredRemoteInstances = useMemo(() => {
    const rows = inventory?.remoteInstances.items ?? [];
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.name, row.display_name, row.status, row.integration, row.owner_jid, row.local_client_id, row.local_client_name].some((value) =>
        String(value ?? "").toLowerCase().includes(needle)
      )
    );
  }, [inventory?.remoteInstances.items, needle]);

  const filteredLegacy = useMemo(() => {
    const rows = inventory?.legacySettings ?? [];
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.client_id, row.client_name, row.dispatch_webhook_url].some((value) =>
        String(value ?? "").toLowerCase().includes(needle)
      )
    );
  }, [inventory?.legacySettings, needle]);

  const filteredFollowup = useMemo(() => {
    const rows = inventory?.followupCompanies ?? [];
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.name, row.evolution_instance, row.webhook_url].some((value) =>
        String(value ?? "").toLowerCase().includes(needle)
      )
    );
  }, [inventory?.followupCompanies, needle]);

  const openEdit = (target: EditTarget) => {
    setEditTarget(target);
    if (target.type === "instance") {
      setEditForm({
        ...emptyEditForm,
        name: target.row.name,
        dispatchWebhookUrl: target.row.dispatch_webhook_url || "",
        active: target.row.active,
      });
    } else if (target.type === "legacy") {
      setEditForm({
        ...emptyEditForm,
        dispatchWebhookUrl: target.row.dispatch_webhook_url || "",
        active: target.row.active,
      });
    } else {
      if (target.type === "remote") {
        setEditForm({
          ...emptyEditForm,
          name: target.row.display_name || target.row.name,
          tenantId: inventory?.tenants[0]?.id || "",
          dispatchWebhookUrl: target.row.dispatch_webhook_url || "",
          evolutionInstance: target.row.name,
          active: true,
        });
        return;
      }
      setEditForm({
        ...emptyEditForm,
        evolutionInstance: target.row.evolution_instance || "",
        webhookUrl: target.row.webhook_url || "",
      });
    }
  };

  const submitEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editTarget) return;

    if (editTarget.type === "instance") {
      updateMutation.mutate({
        path: `/api/admin/evolution-config/evolution-instances/${editTarget.row.id}`,
        body: {
          name: editForm.name,
          dispatchWebhookUrl: editForm.dispatchWebhookUrl,
          dispatchWebhookToken: editForm.dispatchWebhookToken || undefined,
          inboundBearerToken: editForm.inboundBearerToken || undefined,
          active: editForm.active,
        },
      });
      return;
    }

    if (editTarget.type === "legacy") {
      updateMutation.mutate({
        path: `/api/admin/evolution-config/n8n-settings/${editTarget.row.client_id}`,
        body: {
          dispatchWebhookUrl: editForm.dispatchWebhookUrl || null,
          dispatchWebhookToken: editForm.dispatchWebhookToken || undefined,
          inboundBearerToken: editForm.inboundBearerToken || undefined,
          active: editForm.active,
        },
      });
      return;
    }

    if (editTarget.type === "remote") {
      updateMutation.mutate({
        path: "/api/admin/evolution-config/remote-instances/link",
        method: "POST",
        body: {
          tenantId: editForm.tenantId,
          instanceName: editTarget.row.name,
          name: editForm.name || editTarget.row.name,
          dispatchWebhookToken: editForm.dispatchWebhookToken || undefined,
          inboundBearerToken: editForm.inboundBearerToken || undefined,
          active: editForm.active,
          isDefault: editForm.isDefault,
        },
      });
      return;
    }

    updateMutation.mutate({
      path: `/api/admin/evolution-config/followup-companies/${editTarget.row.id}`,
      body: {
        evolutionInstance: editForm.evolutionInstance,
        webhookUrl: editForm.webhookUrl || null,
      },
    });
  };

  return (
    <PageShell
      title="Evolution Admin"
      subtitle="Inventario operacional de instancias, URLs de disparo e chaves mascaradas."
      headerRight={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (includeRemote) {
                setIncludeRemote(false);
              } else {
                inventoryQuery.refetch();
              }
            }}
            disabled={inventoryQuery.isFetching}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Atualizar banco
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (includeRemote) {
                inventoryQuery.refetch();
              } else {
                setIncludeRemote(true);
              }
            }}
            disabled={inventoryQuery.isFetching}
          >
            <ServerCog className="mr-2 h-4 w-4" />
            Buscar Evolution
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-4">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <ServerCog className="h-5 w-5 text-cyan-600" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">EVOLUTION_API_URL</p>
                <p className="truncate text-sm font-medium">{inventory?.env.evolutionApiUrl || "Nao configurada"}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <KeyRound className="h-5 w-5 text-emerald-600" />
              <div>
                <p className="text-xs text-muted-foreground">EVOLUTION_API_KEY</p>
                <div className="mt-1">{secretBadge(Boolean(inventory?.env.hasEvolutionApiKey))}</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Database className="h-5 w-5 text-violet-600" />
              <div>
                <p className="text-xs text-muted-foreground">Instancias no banco</p>
                <p className="text-lg font-semibold">{inventory?.instances.length ?? 0}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <ServerCog className="h-5 w-5 text-amber-600" />
              <div>
                <p className="text-xs text-muted-foreground">Instancias na Evolution</p>
                <p className="text-lg font-semibold">{inventory?.remoteInstances.items.length ?? 0}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {inventory?.remoteInstances.error ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4" />
            Evolution API: {inventory.remoteInstances.error}
          </div>
        ) : null}
        {inventory?.remoteInstances.skipped ? (
          <div className="flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-700 dark:text-cyan-200">
            <ServerCog className="h-4 w-4" />
            Consulta remota pausada para nao sobrecarregar a Evolution. Use Buscar Evolution quando ela estiver saudavel.
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Troca de host em massa</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3 lg:grid-cols-[1fr_1fr_auto_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                bulkMutation.mutate();
              }}
            >
              <Input
                value={bulkForm.oldBaseUrl}
                onChange={(event) => setBulkForm((form) => ({ ...form, oldBaseUrl: event.target.value }))}
                placeholder="https://evolution-antiga.com"
              />
              <Input
                value={bulkForm.newBaseUrl}
                onChange={(event) => setBulkForm((form) => ({ ...form, newBaseUrl: event.target.value }))}
                placeholder="https://evolution-nova.com"
              />
              <div className="flex items-center gap-2 rounded-lg border px-3">
                <Switch
                  checked={bulkForm.updateDispatchToken}
                  onCheckedChange={(value) => setBulkForm((form) => ({ ...form, updateDispatchToken: value }))}
                />
                <span className="whitespace-nowrap text-xs text-muted-foreground">sobrescrever token</span>
              </div>
              <Button type="submit" disabled={bulkMutation.isPending}>
                <Save className="mr-2 h-4 w-4" />
                Aplicar
              </Button>
              {bulkForm.updateDispatchToken && (
                <Input
                  className="lg:col-span-2"
                  type="password"
                  value={bulkForm.dispatchWebhookToken}
                  onChange={(event) => setBulkForm((form) => ({ ...form, dispatchWebhookToken: event.target.value }))}
                  placeholder="Nova API key/token de disparo"
                />
              )}
            </form>
          </CardContent>
        </Card>

        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Filtrar por empresa, instancia ou URL" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Instancias na Evolution API</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Instancia</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Integracao</TableHead>
                  <TableHead>Vinculo local</TableHead>
                  <TableHead>URL de disparo</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRemoteInstances.map((row) => (
                  <TableRow key={row.name}>
                    <TableCell>
                      <div className="font-medium">{row.display_name || row.name}</div>
                      <div className="text-[11px] text-muted-foreground">{row.name}</div>
                    </TableCell>
                    <TableCell>{row.status ? <Badge variant="secondary">{row.status}</Badge> : "-"}</TableCell>
                    <TableCell className="font-mono text-[11px]">{row.integration || "-"}</TableCell>
                    <TableCell>
                      {row.local_instance_id ? (
                        <>
                          <div className="font-medium">{row.local_client_name}</div>
                          <div className="text-[11px] text-muted-foreground">{row.local_client_id}</div>
                        </>
                      ) : (
                        <Badge variant="secondary">sem vinculo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[360px] truncate font-mono text-[11px]" title={row.dispatch_webhook_url || ""}>
                      {shortUrl(row.dispatch_webhook_url)}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.local_instance_id ? (
                        <Badge>editavel no banco</Badge>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => openEdit({ type: "remote", row })}>
                          <Link2 className="mr-2 h-3.5 w-3.5" />
                          Vincular
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Instancias Evolution por tenant</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Instancia</TableHead>
                  <TableHead>URL de disparo</TableHead>
                  <TableHead>API key</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Atualizado</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInstances.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-medium">{row.client_name}</div>
                      <div className="text-[11px] text-muted-foreground">{row.client_id}</div>
                    </TableCell>
                    <TableCell>
                      <div>{row.name}</div>
                      <div className="text-[11px] text-muted-foreground">{row.is_default ? "default" : row.chip_state}</div>
                    </TableCell>
                    <TableCell className="max-w-[360px] truncate font-mono text-[11px]" title={row.dispatch_webhook_url || ""}>
                      {shortUrl(row.dispatch_webhook_url)}
                    </TableCell>
                    <TableCell>{secretBadge(row.has_dispatch_webhook_token)}</TableCell>
                    <TableCell>{row.active ? <Badge>ativa</Badge> : <Badge variant="secondary">inativa</Badge>}</TableCell>
                    <TableCell>{formatDate(row.updated_at)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => openEdit({ type: "instance", row })}>Editar</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Settings legados por tenant</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>URL de disparo</TableHead>
                  <TableHead>API key</TableHead>
                  <TableHead>Inbound</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLegacy.map((row) => (
                  <TableRow key={row.client_id}>
                    <TableCell>
                      <div className="font-medium">{row.client_name}</div>
                      <div className="text-[11px] text-muted-foreground">{row.client_id}</div>
                    </TableCell>
                    <TableCell className="max-w-[420px] truncate font-mono text-[11px]" title={row.dispatch_webhook_url || ""}>
                      {shortUrl(row.dispatch_webhook_url)}
                    </TableCell>
                    <TableCell>{secretBadge(row.has_dispatch_webhook_token)}</TableCell>
                    <TableCell>{secretBadge(row.has_inbound_bearer_token)}</TableCell>
                    <TableCell>{row.active ? <Badge>ativo</Badge> : <Badge variant="secondary">inativo</Badge>}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => openEdit({ type: "legacy", row })}>Editar</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Follow-up</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Instancia Evolution</TableHead>
                  <TableHead>Webhook de repasse</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredFollowup.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="font-mono text-[11px]">{row.evolution_instance || "-"}</TableCell>
                    <TableCell className="max-w-[420px] truncate font-mono text-[11px]" title={row.webhook_url || ""}>
                      {shortUrl(row.webhook_url)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => openEdit({ type: "followup", row })}>Editar</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(editTarget)} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar configuracao Evolution</DialogTitle>
            <DialogDescription>Campos de segredo vazios preservam o valor atual.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitEdit}>
            {editTarget?.type === "instance" && (
              <>
                <div className="grid gap-2">
                  <Label>Nome da instancia</Label>
                  <Input value={editForm.name} onChange={(event) => setEditForm((form) => ({ ...form, name: event.target.value }))} />
                </div>
                <div className="grid gap-2">
                  <Label>URL de disparo</Label>
                  <Input value={editForm.dispatchWebhookUrl} onChange={(event) => setEditForm((form) => ({ ...form, dispatchWebhookUrl: event.target.value }))} />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>API key/token</Label>
                    <Input type="password" value={editForm.dispatchWebhookToken} onChange={(event) => setEditForm((form) => ({ ...form, dispatchWebhookToken: event.target.value }))} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Inbound bearer token</Label>
                    <Input type="password" value={editForm.inboundBearerToken} onChange={(event) => setEditForm((form) => ({ ...form, inboundBearerToken: event.target.value }))} />
                  </div>
                </div>
              </>
            )}
            {editTarget?.type === "legacy" && (
              <>
                <div className="grid gap-2">
                  <Label>URL de disparo legada</Label>
                  <Input value={editForm.dispatchWebhookUrl} onChange={(event) => setEditForm((form) => ({ ...form, dispatchWebhookUrl: event.target.value }))} />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>API key/token</Label>
                    <Input type="password" value={editForm.dispatchWebhookToken} onChange={(event) => setEditForm((form) => ({ ...form, dispatchWebhookToken: event.target.value }))} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Inbound bearer token</Label>
                    <Input type="password" value={editForm.inboundBearerToken} onChange={(event) => setEditForm((form) => ({ ...form, inboundBearerToken: event.target.value }))} />
                  </div>
                </div>
              </>
            )}
            {editTarget?.type === "followup" && (
              <>
                <div className="grid gap-2">
                  <Label>Nome da instancia Evolution</Label>
                  <Input value={editForm.evolutionInstance} onChange={(event) => setEditForm((form) => ({ ...form, evolutionInstance: event.target.value }))} />
                </div>
                <div className="grid gap-2">
                  <Label>Webhook de repasse</Label>
                  <Input value={editForm.webhookUrl} onChange={(event) => setEditForm((form) => ({ ...form, webhookUrl: event.target.value }))} />
                </div>
              </>
            )}
            {editTarget?.type === "remote" && (
              <>
                <div className="grid gap-2">
                  <Label>Empresa</Label>
                  <Select value={editForm.tenantId} onValueChange={(value) => setEditForm((form) => ({ ...form, tenantId: value }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a empresa" />
                    </SelectTrigger>
                    <SelectContent>
                      {(inventory?.tenants ?? []).map((tenant) => (
                        <SelectItem key={tenant.id} value={tenant.id}>
                          {tenant.name} ({tenant.id})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Nome local</Label>
                  <Input value={editForm.name} onChange={(event) => setEditForm((form) => ({ ...form, name: event.target.value }))} />
                </div>
                <div className="grid gap-2">
                  <Label>URL de disparo</Label>
                  <Input value={editForm.dispatchWebhookUrl} disabled />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>API key/token</Label>
                    <Input type="password" value={editForm.dispatchWebhookToken} onChange={(event) => setEditForm((form) => ({ ...form, dispatchWebhookToken: event.target.value }))} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Inbound bearer token</Label>
                    <Input type="password" value={editForm.inboundBearerToken} onChange={(event) => setEditForm((form) => ({ ...form, inboundBearerToken: event.target.value }))} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={editForm.isDefault} onCheckedChange={(value) => setEditForm((form) => ({ ...form, isDefault: value }))} />
                  <Label>Definir como padrao da empresa</Label>
                </div>
              </>
            )}
            {editTarget?.type !== "followup" && (
              <div className="flex items-center gap-2">
                <Switch checked={editForm.active} onCheckedChange={(value) => setEditForm((form) => ({ ...form, active: value }))} />
                <Label>Ativo</Label>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>Cancelar</Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                <Save className="mr-2 h-4 w-4" />
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
