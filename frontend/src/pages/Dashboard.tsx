import { useMemo, useState, type ReactNode } from "react";
import * as XLSX from "xlsx";
import { useTheme } from "next-themes";
import { FileSpreadsheet, FileText, Flame, Percent, Send, TimerReset, TrendingUp, Calendar } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageShell } from "@/components/PageShell";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { useDashboard } from "@/hooks/useDashboard";
import { useEvolutionUsageReport } from "@/hooks/useReports";
import { useCampanhas } from "@/hooks/useCampanhas";

interface DashboardProps {
  fixedClientId?: string;
  fixedClientName?: string;
  title?: string;
  subtitle?: string;
  headerRight?: ReactNode;
}

// Paleta sólida da Direção C (sem gradiente roxo).
const SOLID = {
  indigo: "#6366F1",
  orange: "#ff7a1a",
  cyan: "#22D3EE",
  emerald: "#10b981",
  amber: "#f59e0b",
  red: "#ef4444",
  slate: "#94a3b8",
};
const TEMP_COLORS: Record<string, string> = {
  Quente: SOLID.red,
  Morno: SOLID.amber,
  Frio: SOLID.cyan,
  "Sem sinal": SOLID.slate,
};

// Placeholder honesto para métrica sem fonte de dado real.
const DASH = "—";

// Helper ÚNICO de formatação: mostra "—" quando o valor é null/undefined/NaN,
// e o número formatado quando existe. Aplicado a TODOS os KPIs/células (uniforme),
// para que assim que o backend retornar o campo, o número apareça sozinho —
// zero edição neste arquivo. NÃO chumbar "—" como texto fixo em lugar nenhum.
function formatMetric(value: number | null | undefined, kind: "int" | "pct" = "int"): string {
  if (value == null || (typeof value === "number" && !Number.isFinite(value))) return DASH;
  return kind === "pct" ? `${value}%` : Number(value).toLocaleString("pt-BR");
}

function formatDiaLabel(dia: string): string {
  const p = String(dia).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}` : dia;
}

function pctDelta(current: number, previous: number): number | null {
  if (!previous) return null; // sem base anterior → sem delta confiável
  return Math.round(((current - previous) / previous) * 100);
}

const Dashboard = ({
  fixedClientId,
  fixedClientName,
  title = "Dashboard",
  // Vocabulário corrigido: Supabase está morto.
  subtitle = "Dados do cliente selecionado",
  headerRight,
}: DashboardProps) => {
  const crmClient = useOptionalCrmClient();
  const { resolvedTheme } = useTheme();
  const effectiveClientId = fixedClientId || crmClient?.selectedClientId || "";
  const selectedClient = crmClient?.selectedClient || null;
  const resolvedClientName = fixedClientName || selectedClient?.name || effectiveClientId;

  const [periodDays, setPeriodDays] = useState(14);
  const { data, isLoading, error } = useDashboard(effectiveClientId);
  // 2× janela para calcular delta (atual vs período anterior) a partir da mesma série.
  const usage = useEvolutionUsageReport(effectiveClientId || null, periodDays * 2);
  const { data: campaigns = [] } = useCampanhas(effectiveClientId || undefined);

  const summary = data?.summary;
  const isDark = resolvedTheme !== "light";
  const axisColor = isDark ? "rgba(255,255,255,0.52)" : "rgba(71,85,105,0.92)";
  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(148,163,184,0.28)";
  const tooltipStyle = {
    background: isDark ? "rgba(8,12,32,0.96)" : "rgba(255,255,255,0.98)",
    border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(226,232,240,0.95)"}`,
    color: isDark ? "rgba(255,255,255,0.92)" : "rgb(15 23 42)",
    borderRadius: 14,
  };

  // ── Enviados por dia (real) + total do período + delta ────────────────────────
  const sentByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of usage.data?.items ?? []) {
      map.set(row.dia, (map.get(row.dia) ?? 0) + (row.enviados ?? 0));
    }
    return Array.from(map, ([dia, enviados]) => ({ dia, enviados })).sort((a, b) =>
      a.dia.localeCompare(b.dia)
    );
  }, [usage.data]);

  // Respostas por dia: PRÉ-CABEADO em leadsByDay[].respostas (backend ainda não envia).
  // Mapeado por data; renderiza vazio enquanto nulo, sem quebrar o gráfico.
  const repliesByDay = useMemo(() => {
    const map = new Map<string, number | null | undefined>();
    for (const p of data?.leadsByDay ?? []) map.set(p.day, p.respostas);
    return map;
  }, [data]);

  const { sentCurrent, sentDelta, currentSeries } = useMemo(() => {
    const withReplies = sentByDay.map((r) => ({ ...r, respostas: repliesByDay.get(r.dia) ?? undefined }));
    if (withReplies.length === 0) {
      return { sentCurrent: null as number | null, sentDelta: null as number | null, currentSeries: [] as typeof withReplies };
    }
    const half = withReplies.slice(-periodDays);
    const prev = withReplies.slice(0, Math.max(0, withReplies.length - periodDays));
    const sum = (arr: typeof withReplies) => arr.reduce((s, r) => s + r.enviados, 0);
    return { sentCurrent: sum(half), sentDelta: pctDelta(sum(half), sum(prev)), currentSeries: half };
  }, [sentByDay, repliesByDay, periodDays]);

  const hasUsage = (usage.data?.items?.length ?? 0) > 0;

  // ── Composição por temperatura (real) ────────────────────────────────────────
  const tempData = useMemo(
    () => (data?.temperatureBreakdown ?? []).filter((t) => t.value > 0),
    [data]
  );

  // ── Funil (Novo / Em contato / Qualificado / Fechado) ─────────────────────────
  // "Em contato" ligado a summary.contactedLeads (pré-cabeado): "—" enquanto nulo.
  const funnel = useMemo(() => {
    if (!summary) return [] as { stage: string; value: number | null | undefined }[];
    return [
      { stage: "Novo", value: summary.totalLeads },
      { stage: "Em contato", value: summary.contactedLeads },
      { stage: "Qualificado", value: summary.qualifiedLeads },
      { stage: "Fechado", value: summary.conversions },
    ];
  }, [summary]);

  // ── Export ────────────────────────────────────────────────────────────────────
  const handleExportExcel = () => {
    // Mesmo critério do helper de UI: null/undefined/NaN → "—".
    const cell = (v: number | null | undefined) =>
      v == null || (typeof v === "number" && !Number.isFinite(v)) ? DASH : v;
    const wb = XLSX.utils.book_new();
    const kpis = [
      ["Métrica", "Valor"],
      ["Mensagens enviadas (período)", cell(sentCurrent)],
      ["Taxa de resposta (%)", cell(summary?.responseRate)],
      ["Leads quentes", cell(summary?.hotLeads)],
      ["Leads sem contato +3 dias", cell(summary?.noContact3d)],
      ["Conversão (%)", cell(summary?.conversionRate)],
      ["Total de leads", cell(summary?.totalLeads)],
      ["Em contato", cell(summary?.contactedLeads)],
      ["Qualificados", cell(summary?.qualifiedLeads)],
      ["Fechamentos", cell(summary?.conversions)],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(kpis), "KPIs");
    const camp = [
      ["Campanha", "Status", "Enviados", "Respostas", "Conversão (%)"],
      ...campaigns.map((c) => [c.name, c.status, cell(c.sent), cell(c.replies), cell(c.conversionRate)]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(camp), "Campanhas");
    XLSX.writeFile(wb, `dashboard-${effectiveClientId || "cliente"}.xlsx`);
  };

  const handleExportPdf = () => window.print();

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!effectiveClientId) {
    return (
      <PageShell title={title} subtitle={subtitle} compactHero spacing="space-y-4">
        <EmptyState title="Selecione uma empresa" description="Escolha um cliente para ver o painel." />
      </PageShell>
    );
  }

  return (
    <PageShell
      title={title}
      subtitle={`${subtitle} · ${resolvedClientName} · últimos ${periodDays} dias`}
      compactHero
      spacing="space-y-5"
      headerRight={
        headerRight ?? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleExportPdf}>
              <FileText className="mr-1 h-4 w-4" /> Exportar PDF
            </Button>
            <Button size="sm" onClick={handleExportExcel}>
              <FileSpreadsheet className="mr-1 h-4 w-4" /> Exportar Excel
            </Button>
          </div>
        )
      }
    >
      <ErrorMessage message={error ? (error as Error).message : null} variant="banner" />
      {isLoading ? (
        <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">Carregando painel...</div>
      ) : (
        <>
          <div className="flex items-center gap-2.5 rounded-xl border border-slate-200/60 bg-white/40 p-2.5 dark:border-white/10 dark:bg-white/[0.02] max-w-xs shadow-sm mb-1">
            <Calendar className="h-4 w-4 text-slate-500" />
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Período:</span>
            <Select value={String(periodDays)} onValueChange={(val) => setPeriodDays(Number(val))}>
              <SelectTrigger className="h-8 w-[140px] text-xs rounded-lg border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900 shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Últimos 7 dias</SelectItem>
                <SelectItem value="14">Últimos 14 dias</SelectItem>
                <SelectItem value="30">Últimos 30 dias</SelectItem>
                <SelectItem value="90">Últimos 90 dias</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* ── SEÇÃO: Visão geral ───────────────────────────────────────────── */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Visão geral</h2>
            <div className="grid gap-4 lg:grid-cols-3">
              {/* KPI herói */}
              <Card className="lg:col-span-1 border-primary/20 bg-primary/[0.04]">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2 text-primary">
                    <Send className="h-5 w-5" />
                    <CardDescription className="text-primary/80">Mensagens enviadas</CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-extrabold tracking-tight text-foreground">
                    {formatMetric(sentCurrent)}
                  </div>
                  <DeltaBadge delta={sentDelta} />
                </CardContent>
              </Card>

              {/* KPIs de apoio — todos via formatMetric + campo nomeado (pré-cabeado) */}
              <div className="grid grid-cols-2 gap-4 lg:col-span-2">
                <KpiMini icon={<Percent className="h-4 w-4" />} label="Taxa de resposta" value={formatMetric(summary?.responseRate, "pct")} delta={null} />
                <KpiMini icon={<Flame className="h-4 w-4" />} label="Leads quentes" value={formatMetric(summary?.hotLeads)} delta={summary?.hotLeadsDelta ?? null} />
                <KpiMini icon={<TimerReset className="h-4 w-4" />} label="Sem contato +3 dias" value={formatMetric(summary?.noContact3d)} delta={null} />
                <KpiMini icon={<TrendingUp className="h-4 w-4" />} label="Conversão" value={formatMetric(summary?.conversionRate, "pct")} delta={summary?.conversionRateDelta ?? null} />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {/* Barras: enviados por dia (real). Respostas: sem fonte. */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Enviados vs respostas por dia</CardTitle>
                  <CardDescription>Enviados e respostas reais registradas no período.</CardDescription>
                </CardHeader>
                <CardContent>
                  {hasUsage ? (
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={currentSeries} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={gridColor} />
                        <XAxis dataKey="dia" tickFormatter={formatDiaLabel} tick={{ fill: axisColor, fontSize: 12 }} axisLine={false} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fill: axisColor, fontSize: 12 }} axisLine={false} tickLine={false} width={40} />
                        <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => `Dia ${formatDiaLabel(String(l))}`} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="enviados" name="Enviados" fill={SOLID.indigo} radius={[4, 4, 0, 0]} />
                        {/* Série pré-cabeada: vazia até leadsByDay[].respostas existir */}
                        <Bar dataKey="respostas" name="Respostas" fill={SOLID.orange} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyState title="Sem envios no período" description="Nenhum envio registrado nos últimos dias." />
                  )}
                </CardContent>
              </Card>

              {/* Rosca: composição por temperatura (real) */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Composição da base</CardTitle>
                  <CardDescription>Leads por temperatura (quente / morno / frio).</CardDescription>
                </CardHeader>
                <CardContent>
                  {tempData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={240}>
                      <PieChart>
                        <Pie data={tempData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={2}>
                          {tempData.map((t) => (
                            <Cell key={t.name} fill={TEMP_COLORS[t.name] ?? SOLID.slate} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyState title="Sem dados no período" description="A base ainda não tem leads classificados." />
                  )}
                </CardContent>
              </Card>
            </div>
          </section>

          {/* ── SEÇÃO: Funil comercial ───────────────────────────────────────── */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Funil comercial</h2>
            <Card>
              <CardContent className="grid gap-3 p-4 sm:grid-cols-4">
                {funnel.map((step, i) => {
                  const prev = i > 0 ? funnel[i - 1] : null;
                  const drop =
                    prev && prev.value != null && prev.value > 0 && step.value != null
                      ? Math.round(((prev.value - step.value) / prev.value) * 100)
                      : null;
                  return (
                    <div key={step.stage} className="rounded-xl border border-border/70 bg-card/60 p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{step.stage}</p>
                      <p className="mt-1 text-2xl font-extrabold text-foreground">{formatMetric(step.value)}</p>
                      {i > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {drop != null ? `↓ ${drop}% da etapa anterior` : `queda: ${DASH}`}
                        </p>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </section>

          {/* ── SEÇÃO: Desempenho por campanha ───────────────────────────────── */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Desempenho por campanha</h2>
            <Card>
              <CardContent className="p-0">
                {campaigns.length === 0 ? (
                  <EmptyState title="Nenhuma campanha" description="Crie uma campanha para ver o desempenho aqui." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/70 text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="px-4 py-3">Campanha</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3 text-right">Enviados</th>
                          <th className="px-4 py-3 text-right">Respostas</th>
                          <th className="px-4 py-3 text-right">Conversão</th>
                        </tr>
                      </thead>
                      <tbody>
                        {campaigns.map((c) => (
                          <tr key={c.id} className="border-b border-border/40 last:border-0">
                            <td className="px-4 py-3 font-medium text-foreground">{c.name}</td>
                            <td className="px-4 py-3">
                              <Badge variant="outline">
                                {c.status === "active" ? "Ativa" : c.status === "paused" ? "Pausada" : c.status}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-right text-muted-foreground">{formatMetric(c.sent)}</td>
                            <td className="px-4 py-3 text-right text-muted-foreground">{formatMetric(c.replies)}</td>
                            <td className="px-4 py-3 text-right text-muted-foreground">{formatMetric(c.conversionRate, "pct")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </PageShell>
  );
};

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta == null) return <p className="mt-1 text-xs text-muted-foreground">vs período anterior: —</p>;
  const up = delta >= 0;
  return (
    <p className={cn("mt-1 text-xs font-medium", up ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
      {up ? "▲" : "▼"} {Math.abs(delta)}% vs período anterior
    </p>
  );
}

function KpiMini({
  icon,
  label,
  value,
  delta,
  note,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  delta: number | null;
  note?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <span className="text-xs font-medium">{label}</span>
        </div>
        <p className="mt-2 text-2xl font-extrabold text-foreground">{value}</p>
        {note ? (
          <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>
        ) : (
          <DeltaBadge delta={delta} />
        )}
      </CardContent>
    </Card>
  );
}

export default Dashboard;
