import { useState } from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Filter, RefreshCw, TrendingUp, Users, Send, MessageCircle, AlertCircle } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFupCompanies, useFupCampaigns, useFupAnalytics, type AnalyticsFilters } from "@/hooks/useFollowupAdmin";
import { useAuth } from "@/contexts/AuthContext";

// ─── Paleta de cores (dark-friendly) ─────────────────────────────────────────
const PALETTE = ["#818cf8", "#34d399", "#f59e0b", "#f87171", "#60a5fa", "#a78bfa", "#2dd4bf", "#fb923c"];

const STATUS_COLORS: Record<string, string> = {
  active: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  paused: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  draft: "border-slate-300 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400",
  archived: "border-slate-300 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-500",
};
const STATUS_LABELS: Record<string, string> = {
  active: "Ativa", paused: "Pausada", draft: "Rascunho", archived: "Arquivada",
};

// ─── KPI Card ─────────────────────────────────────────────────────────────────
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

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div
      className="animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800"
      style={{ height }}
    />
  );
}

// ─── Período pré-definido ─────────────────────────────────────────────────────
function periodDates(period: string): { from: string; to: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = fmt(now);

  if (period === "today") return { from: today, to: today };
  if (period === "7d") {
    const d = new Date(now); d.setDate(d.getDate() - 6);
    return { from: fmt(d), to: today };
  }
  if (period === "30d") {
    const d = new Date(now); d.setDate(d.getDate() - 29);
    return { from: fmt(d), to: today };
  }
  if (period === "thisMonth") {
    return { from: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  }
  if (period === "lastMonth") {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: fmt(first), to: fmt(last) };
  }
  return { from: "", to: "" };
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function FollowupAnalytics() {
  const { isAdminUser } = useAuth();
  const { data: companies = [] } = useFupCompanies();

  const [companyId, setCompanyId] = useState("");
  const [campaignId, setCampaignId] = useState("_all");
  const [period, setPeriod] = useState("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const { data: campaigns = [] } = useFupCampaigns(companyId || undefined);

  const { from, to } = period === "custom"
    ? { from: customFrom, to: customTo }
    : periodDates(period);

  const filters: AnalyticsFilters = {
    companyId: companyId || undefined,
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
    <PageShell title="FUP — Analytics" subtitle="Métricas do módulo de follow-up" spacing="space-y-6">

      {/* ── Filtros ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              <Filter className="h-4 w-4 text-slate-400" />
              Filtros
            </CardTitle>
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs"
              onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {isAdminUser && (
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500 dark:text-slate-400">Empresa</Label>
                <Select value={companyId} onValueChange={(v) => { setCompanyId(v); setCampaignId("_all"); }}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="" className="text-xs">Todas as empresas</SelectItem>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500 dark:text-slate-400">Campanha</Label>
              <Select value={campaignId} onValueChange={setCampaignId} disabled={!companyId}>
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
          <p className="text-sm text-red-700 dark:text-red-400">Erro ao carregar dados. Tente novamente.</p>
        </div>
      ) : (
        <>
          {/* ── KPI Cards ──────────────────────────────────────────────────── */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {isLoading ? (
              [1,2,3,4,5].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />)
            ) : (
              <>
                <KpiCard label="Total de leads" value={kpis?.totalLeads ?? 0} icon={Users}
                  color="bg-indigo-50 text-indigo-500 dark:bg-indigo-900/20 dark:text-indigo-400" />
                <KpiCard label="Com telefone" value={kpis?.validPhone ?? 0}
                  sub={kpis?.totalLeads ? `${Math.round((kpis.validPhone / kpis.totalLeads) * 100)}% do total` : undefined}
                  icon={Users} color="bg-cyan-50 text-cyan-500 dark:bg-cyan-900/20 dark:text-cyan-400" />
                <KpiCard label="Mensagens enviadas" value={kpis?.messagesSent ?? 0} icon={Send}
                  color="bg-emerald-50 text-emerald-500 dark:bg-emerald-900/20 dark:text-emerald-400" />
                <KpiCard label="Taxa de resposta" value={`${kpis?.replyRate ?? 0}%`} icon={MessageCircle}
                  color="bg-violet-50 text-violet-500 dark:bg-violet-900/20 dark:text-violet-400" />
                <KpiCard label="Taxa de falha" value={`${kpis?.failureRate ?? 0}%`} icon={AlertCircle}
                  color="bg-rose-50 text-rose-500 dark:bg-rose-900/20 dark:text-rose-400" />
              </>
            )}
          </div>

          {/* ── Gráfico 1 + 2 ──────────────────────────────────────────────── */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Pizza — por origem */}
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
                              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v: number, name: string) => [v, name]} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="flex-1 space-y-1.5">
                        {byOrigin.slice(0, 6).map((o, i) => (
                          <div key={o.origin} className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
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

            {/* Linha — leads ao longo do tempo */}
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
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} />
                        <YAxis tick={{ fontSize: 10 }} width={30} />
                        <Tooltip labelFormatter={(d) => String(d)} />
                        <Line type="monotone" dataKey="total" stroke={PALETTE[0]}
                          strokeWidth={2} dot={false} name="Leads" />
                      </LineChart>
                    </ResponsiveContainer>
                  )
                }
              </CardContent>
            </Card>
          </div>

          {/* ── Gráfico 3 — Conversão por campanha ─────────────────────────── */}
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
                      <Bar dataKey="rate" fill={PALETTE[0]} radius={[0, 4, 4, 0]} name="Taxa (%)">
                        {conversionByCampaign.map((_, i) => (
                          <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )
              }
            </CardContent>
          </Card>

          {/* ── Gráfico 4 — Mensagens enviadas vs falhas ────────────────────── */}
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
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} />
                      <YAxis tick={{ fontSize: 10 }} width={30} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="sent" stackId="a" fill="#34d399" name="Enviadas" />
                      <Bar dataKey="failed" stackId="a" fill="#f87171" name="Falhas" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )
              }
            </CardContent>
          </Card>

          {/* ── Gráfico 5 — Top Campanhas ───────────────────────────────────── */}
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
                            <Badge className={`border text-[10px] font-medium ${STATUS_COLORS[c.status] || ""}`}>
                              {STATUS_LABELS[c.status] || c.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                      {/* Totais */}
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
    </PageShell>
  );
}
