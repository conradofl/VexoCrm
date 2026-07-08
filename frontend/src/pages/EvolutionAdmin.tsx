import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw, Search, ServerCog } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";
import { EditForm, EditTarget, EvolutionInventory } from "@/lib/evolutionAdmin/types";
import { emptyEditForm } from "@/lib/evolutionAdmin/helpers";
import { EnvironmentMetrics } from "./EvolutionAdmin/EnvironmentMetrics";
import { RemoteInstancesTable } from "./EvolutionAdmin/RemoteInstancesTable";
import { InstancesTable } from "./EvolutionAdmin/InstancesTable";
import { LegacySettingsTable } from "./EvolutionAdmin/LegacySettingsTable";
import { FollowupTable } from "./EvolutionAdmin/FollowupTable";
import { BulkReplaceForm } from "./EvolutionAdmin/BulkReplaceForm";
import { EditDialog } from "./EvolutionAdmin/EditDialog";

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
        <EnvironmentMetrics inventory={inventory} />

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

        <BulkReplaceForm
          form={bulkForm}
          onChange={setBulkForm}
          onSubmit={(event) => {
            event.preventDefault();
            bulkMutation.mutate();
          }}
          isPending={bulkMutation.isPending}
        />

        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Filtrar por empresa, instancia ou URL" />
        </div>

        <RemoteInstancesTable instances={filteredRemoteInstances} onEdit={(row) => openEdit({ type: "remote", row })} />
        <InstancesTable instances={filteredInstances} onEdit={(row) => openEdit({ type: "instance", row })} />
        <LegacySettingsTable rows={filteredLegacy} onEdit={(row) => openEdit({ type: "legacy", row })} />
        <FollowupTable companies={filteredFollowup} onEdit={(row) => openEdit({ type: "followup", row })} />
      </div>

      <EditDialog
        open={Boolean(editTarget)}
        target={editTarget}
        form={editForm}
        inventory={inventory}
        onFormChange={setEditForm}
        onSubmit={submitEdit}
        onClose={() => setEditTarget(null)}
        isPending={updateMutation.isPending}
      />
    </PageShell>
  );
}
