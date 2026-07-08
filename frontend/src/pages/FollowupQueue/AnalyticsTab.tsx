// Extraído de src/pages/FollowupQueue.tsx (Onda 4 Run F6) — movimento puro, sem alteração de forma.
import { useState } from "react";
import {
  Filter,
  RefreshCw,
  TrendingUp,
  Send,
  AlertCircle,
  Users,
  MessageSquare,
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  useFupCampaigns,
  useFupAnalytics,
  type AnalyticsFilters,
} from "@/hooks/useFollowupAdmin";
import { periodDates } from "@/lib/followup/helpers";
import { ANALYTICS_COLORS } from "@/lib/followup/constants";

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTES DE MÉTRICAS (ANALYTICS)
// ═══════════════════════════════════════════════════════════════════════════════

function KpiCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
            <p className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{value}</p>
            {sub && <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{sub}</p>}
          </div>
          <div className={`rounded-xl p-2.5 ${color}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div
      className="animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800"
      style={{ height }}
    />
  );
}

export function AnalyticsTab({ companyId }: { companyId: string }) {
  const [campaignId, setCampaignId] = useState("_all");
  const [period, setPeriod] = useState("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const { data: campaigns = [] } = useFupCampaigns(companyId !== "all" ? companyId : undefined);

  const { from, to } = period === "custom"
    ? { from: customFrom, to: customTo }
    : periodDates(period);

  const filters: AnalyticsFilters = {
    companyId: companyId !== "all" ? companyId : undefined,
    campaignId: campaignId !== "_all" ? campaignId : undefined,
    from: from || undefined,
    to: to || undefined,
  };

  const { data, isLoading, isFetching, refetch, error } = useFupAnalytics(filters);

  const kpis = data?.kpis;
  const byOrigin = data?.byOrigin || [];
  const byDay = data?.byDay || [];
  const conversionByCampaign = data?.conversionByCampaign || [];
  const messagesByDay = data?.messagesByDay || [];
  const topCampaigns = data?.topCampaigns || [];

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              <Filter className="h-4 w-4 text-slate-400" />
              Filtros de Métricas
            </CardTitle>
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs"
              onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500 dark:text-slate-400">Campanha</Label>
              <Select value={campaignId} onValueChange={setCampaignId} disabled={companyId === "all"}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all" className="text-xs">Todas</SelectItem>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500 dark:text-slate-400">Período</Label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today" className="text-xs">Hoje</SelectItem>
                  <SelectItem value="7d" className="text-xs">7 dias</SelectItem>
                  <SelectItem value="30d" className="text-xs">30 dias</SelectItem>
                  <SelectItem value="thisMonth" className="text-xs">Este mês</SelectItem>
                  <SelectItem value="lastMonth" className="text-xs">Mês anterior</SelectItem>
                  <SelectItem value="custom" className="text-xs">Personalizado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {period === "custom" && (
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500 dark:text-slate-400">De / Até</Label>
                <div className="flex gap-1.5">
                  <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-8 text-xs" />
                  <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-8 text-xs" />
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {error ? (
        <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50/50 dark:border-red-800/40 dark:bg-red-900/10">
          <AlertCircle className="h-6 w-6 text-red-400" />
          <p className="text-sm text-red-700 dark:text-red-400">Erro ao carregar dados operacionais. Tente novamente.</p>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {isLoading ? (
              [1, 2, 3, 4, 5].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />)
            ) : (
              <>
                <KpiCard label="Total de leads" value={kpis?.totalLeads ?? 0} icon={Users}
                  color="bg-indigo-50 text-indigo-500 dark:bg-indigo-900/20 dark:text-indigo-400" />
                <KpiCard label="Com telefone" value={kpis?.validPhone ?? 0}
                  sub={kpis?.totalLeads ? `${Math.round((kpis.validPhone / kpis.totalLeads) * 100)}% do total` : undefined}
                  icon={Users} color="bg-cyan-50 text-cyan-500 dark:bg-cyan-900/20 dark:text-cyan-400" />
                <KpiCard label="Mensagens enviadas" value={kpis?.messagesSent ?? 0} icon={Send}
                  color="bg-emerald-50 text-emerald-500 dark:bg-emerald-900/20 dark:text-emerald-400" />
                <KpiCard label="Taxa de resposta" value={`${kpis?.replyRate ?? 0}%`} icon={MessageSquare}
                  color="bg-violet-50 text-violet-500 dark:bg-violet-900/20 dark:text-violet-400" />
                <KpiCard label="Taxa de falha" value={`${kpis?.failureRate ?? 0}%`} icon={AlertCircle}
                  color="bg-rose-50 text-rose-500 dark:bg-rose-900/20 dark:text-rose-400" />
              </>
            )}
          </div>

          {/* Gráficos */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Leads por Origem
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? <ChartSkeleton height={240} /> :
                  byOrigin.length === 0 ? (
                    <div className="flex h-40 items-center justify-center text-sm text-slate-400">Sem dados</div>
                  ) : (
                    <div className="flex items-center gap-4">
                      <ResponsiveContainer width="60%" height={200}>
                        <PieChart>
                          <Pie data={byOrigin} dataKey="total" nameKey="origin"
                            innerRadius={40} outerRadius={80} paddingAngle={2}>
                            {byOrigin.map((_, i) => (
                              <Cell key={i} fill={ANALYTICS_COLORS[i % ANALYTICS_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v: number, name: string) => [v, name]} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="flex-1 space-y-1.5">
                        {byOrigin.slice(0, 6).map((o, i) => (
                          <div key={o.origin} className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ANALYTICS_COLORS[i % ANALYTICS_COLORS.length] }} />
                              <span className="truncate text-[11px] text-slate-600 dark:text-slate-300">{o.origin}</span>
                            </div>
                            <span className="shrink-0 text-[11px] font-medium text-slate-700 dark:text-slate-200">
                              {o.percentage}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                }
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Leads ao longo do tempo
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? <ChartSkeleton height={240} /> :
                  byDay.length === 0 ? (
                    <div className="flex h-40 items-center justify-center text-sm text-slate-400">Sem dados</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={byDay}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => (typeof d === "string" ? d.slice(5) : String(d))} />
                        <YAxis tick={{ fontSize: 10 }} width={30} />
                        <Tooltip />
                        <Line type="monotone" dataKey="total" stroke={ANALYTICS_COLORS[0]}
                          strokeWidth={2} dot={false} name="Leads" />
                      </LineChart>
                    </ResponsiveContainer>
                  )
                }
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Taxa de conversão por Campanha
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? <ChartSkeleton height={200} /> :
                conversionByCampaign.length === 0 ? (
                  <div className="flex h-32 items-center justify-center text-sm text-slate-400">Sem dados</div>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(120, conversionByCampaign.length * 40)}>
                    <BarChart data={conversionByCampaign} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                      <XAxis type="number" unit="%" tick={{ fontSize: 10 }} domain={[0, 100]} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
                      <Tooltip formatter={(v: number) => [`${v}%`, "Taxa"]} />
                      <Bar dataKey="rate" fill={ANALYTICS_COLORS[0]} radius={[0, 4, 4, 0]} name="Taxa (%)">
                        {conversionByCampaign.map((_, i) => (
                          <Cell key={i} fill={ANALYTICS_COLORS[i % ANALYTICS_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )
              }
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Mensagens enviadas vs falhas por dia
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? <ChartSkeleton height={200} /> :
                messagesByDay.length === 0 ? (
                  <div className="flex h-32 items-center justify-center text-sm text-slate-400">Sem dados</div>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={messagesByDay}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => (typeof d === "string" ? d.slice(5) : String(d))} />
                      <YAxis tick={{ fontSize: 10 }} width={30} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="sent" stackId="a" fill="#34d399" name="Enviadas" />
                      <Bar dataKey="failed" stackId="a" fill="#f87171" name="Falhas" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )
              }
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                <TrendingUp className="h-4 w-4 text-slate-400" />
                Top Campanhas
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4"><ChartSkeleton height={160} /></div>
              ) : topCampaigns.length === 0 ? (
                <div className="flex h-32 items-center justify-center text-sm text-slate-400">Sem dados</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-white/5">
                        {["#", "Campanha", "Origem", "Leads", "Enviadas", "Taxa Resp.", "Status"].map((h) => (
                          <th key={h} className="px-4 py-2.5 text-left font-medium text-slate-500 dark:text-slate-400">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-white/5">
                      {topCampaigns.map((c) => (
                        <tr key={c.campaignId} className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-2.5 font-mono text-slate-400">{c.rank}</td>
                          <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-100 max-w-[160px] truncate">
                            {c.name}
                          </td>
                          <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{c.origin}</td>
                          <td className="px-4 py-2.5 text-slate-700 dark:text-slate-200">{c.leads}</td>
                          <td className="px-4 py-2.5 text-slate-700 dark:text-slate-200">{c.sent}</td>
                          <td className="px-4 py-2.5 font-medium text-slate-700 dark:text-slate-200">{c.replyRate}%</td>
                          <td className="px-4 py-2.5">
                            <Badge className="border text-[10px] font-medium border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
                              Ativa
                            </Badge>
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t border-slate-200 bg-slate-50/50 dark:border-white/10 dark:bg-white/[0.02] font-medium">
                        <td className="px-4 py-2.5 text-slate-500" colSpan={3}>Total</td>
                        <td className="px-4 py-2.5 text-slate-800 dark:text-slate-100">
                          {topCampaigns.reduce((s, c) => s + c.leads, 0)}
                        </td>
                        <td className="px-4 py-2.5 text-slate-800 dark:text-slate-100">
                          {topCampaigns.reduce((s, c) => s + c.sent, 0)}
                        </td>
                        <td className="px-4 py-2.5" colSpan={2} />
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
