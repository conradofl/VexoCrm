import { useState } from "react";
import { Building2, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLeadClients, useDeleteLeadClient } from "@/hooks/useLeadClients";

function formatDate(iso?: string): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).toUpperCase();
  } catch {
    return iso;
  }
}

export default function Empresas() {
  const { data: clients = [], isLoading, error } = useLeadClients();
  const deleteClient = useDeleteLeadClient();
  const { toast } = useToast();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function handleDelete(clientId: string) {
    if (confirmId !== clientId) {
      setConfirmId(clientId);
      return;
    }
    setConfirmId(null);

    try {
      await deleteClient.mutateAsync(clientId);
      toast({ title: "Empresa excluida com sucesso." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Nao foi possivel excluir a empresa.";
      toast({ title: "Erro ao excluir", description: msg, variant: "destructive" });
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-bold text-[#F8FAFC]">Empresas</h1>
        <p className="mt-1 text-sm text-[#E2E8F0]/60">
          Gerencie as empresas cadastradas no CRM.
        </p>
      </div>

      {isLoading && (
        <p className="text-sm text-[#E2E8F0]/60">Carregando...</p>
      )}

      {error && (
        <p className="text-sm text-red-400">Erro ao carregar empresas.</p>
      )}

      {!isLoading && !error && clients.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-[#E2E8F0]/50">
          <Building2 className="h-10 w-10 opacity-40" />
          <p className="text-sm">Nenhuma empresa cadastrada.</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {clients.map((client) => (
          <div
            key={client.id}
            className="flex flex-col gap-4 rounded-xl border border-[rgba(226,232,240,0.1)] bg-[rgba(11,14,20,0.4)] p-5 backdrop-blur-[10px]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="truncate text-base font-semibold text-[#F8FAFC]">{client.name}</p>
                <span className="mt-1 inline-block rounded-md border border-electric-indigo/20 bg-electric-indigo/10 px-2 py-0.5 font-mono text-[11px] text-electric-indigo">
                  {client.id}
                </span>
              </div>
            </div>

            <p className="text-xs text-[#E2E8F0]/50">{formatDate(client.created_at)}</p>

            <div className="rounded-lg border border-[rgba(226,232,240,0.08)] bg-white/[0.02] px-3 py-2">
              <p className="text-[11px] font-medium text-[#E2E8F0]/40">Rota base</p>
              <p className="mt-0.5 font-mono text-xs text-[#E2E8F0]/70">
                /clientes/{client.id}/dashboard
              </p>
            </div>

            {confirmId === client.id ? (
              <div className="flex gap-2">
                <button
                  onClick={() => handleDelete(client.id)}
                  disabled={deleteClient.isPending}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deleteClient.isPending ? "Excluindo..." : "Confirmar exclusao"}
                </button>
                <button
                  onClick={() => setConfirmId(null)}
                  disabled={deleteClient.isPending}
                  className="rounded-lg border border-[rgba(226,232,240,0.1)] px-3 py-2 text-xs font-semibold text-[#E2E8F0]/60 transition-colors hover:text-[#F8FAFC]"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                onClick={() => handleDelete(client.id)}
                className="flex items-center justify-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-400 transition-colors hover:bg-red-500/20"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Excluir empresa
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
