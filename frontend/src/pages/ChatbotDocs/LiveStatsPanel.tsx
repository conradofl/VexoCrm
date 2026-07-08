import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useLeadClients } from "@/hooks/useLeadClients";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { TEMP_CONFIG } from "@/lib/chatbotDocs/constants";
import type { ChatbotLead } from "@/lib/chatbotDocs/types";

// Extraído de src/pages/ChatbotDocs.tsx (Onda 4 Run F8) — movimento puro, sem alteração de forma.

function useLiveStats(clientId: string) {
  const { isAuthenticated, getIdToken } = useAuth();
  return useQuery({
    queryKey: ["live-chatbot-stats", clientId],
    enabled: isAuthenticated && !!clientId,
    refetchInterval: 30_000,
    staleTime: 0,
    queryFn: async () => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");
      const res = await fetchApi(`/api/hardcoded-chat-leads?clientId=${clientId}&limit=500`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro"));
      const data = await readApiJson<{ leads: ChatbotLead[] }>(res, "live_stats");
      return data.leads ?? [];
    },
  });
}

export function LiveStatsPanel() {
  const { data: clients = [] } = useLeadClients();
  const [clientId, setClientId] = useState("");
  const { data: leads, isLoading, isFetching, dataUpdatedAt, error } = useLiveStats(clientId);

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const active = leads?.filter((l) => l.statusConversa === "em_atendimento").length ?? 0;
  const finalized = leads?.filter((l) => l.statusConversa === "finalizado").length ?? 0;
  const finalizedToday = leads?.filter(
    (l) => l.statusConversa === "finalizado" && new Date(l.updatedAt) >= todayStart
  ).length ?? 0;
  const total = leads?.length ?? 0;

  const byTemp = { QUENTE: 0, MORNO: 0, FRIO: 0 };
  leads?.forEach((l) => {
    const t = (l.leadTemperature ?? "").toUpperCase() as keyof typeof byTemp;
    if (t in byTemp) byTemp[t]++;
  });

  const spinFases = { situacao: 0, problema: 0, implicacao: 0, necessidade: 0 };
  leads?.forEach((l) => {
    const f = l.spinFase as keyof typeof spinFases | null;
    if (f && f in spinFases) spinFases[f]++;
  });

  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  return (
    <div className="space-y-4">
      {/* Seletor de empresa + timestamp */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-xs space-y-1.5">
          <Label className="text-xs text-slate-500 dark:text-slate-400">Empresa</Label>
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Selecione a empresa" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {lastUpdate && (
          <p className="flex items-center gap-1 text-[11px] text-slate-400">
            <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
            Atualizado {lastUpdate.toLocaleTimeString("pt-BR")} · auto 30s
          </p>
        )}
      </div>

      {!clientId ? (
        <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-white/10">
          <p className="text-sm text-slate-400">Selecione uma empresa para ver as métricas ao vivo.</p>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50/50 p-6 text-center dark:border-red-800/40 dark:bg-red-900/10">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">{(error as Error).message}</p>
        </div>
      ) : isLoading ? (
        <div className="grid gap-3 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              { label: "Total de leads", value: total, sub: "no histórico", color: "text-slate-800 dark:text-slate-100" },
              { label: "Em atendimento", value: active, sub: "aguardando resposta", color: "text-cyan-700 dark:text-cyan-400" },
              { label: "Finalizados hoje", value: finalizedToday, sub: `${finalized} no total`, color: "text-emerald-700 dark:text-emerald-400" },
              { label: "Taxa finalização", value: total > 0 ? `${((finalized / total) * 100).toFixed(0)}%` : "—", sub: `${finalized} finalizados`, color: "text-indigo-700 dark:text-indigo-400" },
            ].map(({ label, value, sub, color }) => (
              <Card key={label} className="border-slate-100 dark:border-white/8">
                <CardContent className="pt-4">
                  <p className={`text-2xl font-extrabold ${color}`}>{value}</p>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</p>
                  <p className="text-[11px] text-slate-400">{sub}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Temperatura */}
          {total > 0 && (
            <div className="grid gap-3 sm:grid-cols-3">
              {(Object.entries(TEMP_CONFIG) as [keyof typeof TEMP_CONFIG, typeof TEMP_CONFIG[keyof typeof TEMP_CONFIG]][]).map(([key, cfg]) => {
                const count = byTemp[key];
                const pct = total > 0 ? (count / total) * 100 : 0;
                return (
                  <div
                    key={key}
                    className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3 dark:border-white/8 dark:bg-white/[0.02]"
                  >
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${cfg.bg}`}>
                      <cfg.icon className={`h-4 w-4 ${cfg.color}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between">
                        <p className={`text-lg font-extrabold ${cfg.color}`}>{count}</p>
                        <p className="text-[11px] text-slate-400">{pct.toFixed(0)}%</p>
                      </div>
                      <p className="text-xs text-slate-500">{cfg.label}</p>
                      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                        <div className="h-full rounded-full bg-current transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* SPIN em andamento */}
          {active > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">SPIN — Fase atual (conversas ativas)</p>
              <div className="grid gap-2 sm:grid-cols-4">
                {([["situacao", "Situação"], ["problema", "Problema"], ["implicacao", "Implicação"], ["necessidade", "Necessidade"]] as const).map(([key, label]) => {
                  const count = spinFases[key];
                  return (
                    <div key={key} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 dark:border-white/8">
                      <p className="text-xs text-slate-600 dark:text-slate-300">{label}</p>
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{count}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {total === 0 && (
            <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-white/10">
              <p className="text-sm text-slate-400">Nenhum lead encontrado para esta empresa.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
