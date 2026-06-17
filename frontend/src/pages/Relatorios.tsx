import { useMemo, useState } from "react";
import {
  BarChart2,
  TrendingUp,
  Activity,
  Smartphone,
  AlertTriangle,
  PieChart as PieChartIcon,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
} from "lucide-react";
import { useTheme } from "next-themes";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useLeadClients } from "@/hooks/useLeadClients";
import { useEvolutionUsageReport } from "@/hooks/useReports";

const REPORT_DAYS = 14;

// Paleta de marca (memória P4)
const CHIP_PALETTE = ["#6366F1", "#ff7a1a", "#22D3EE", "#8b5cf6", "#f43f5e", "#10b981"];

function formatDiaLabel(dia: string): string {
  const parts = String(dia).split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : dia;
}

export default function Relatorios() {
  const { clientId, isAdminUser } = useAuth();
  const { data: tenants = [] } = useLeadClients();
  const { resolvedTheme } = useTheme();

  const [selectedClientId, setSelectedClientId] = useState<string>(() => clientId ?? "");
  const showSelector = isAdminUser || !clientId;
  const activeClientId = selectedClientId || clientId || "";

  const { data, isLoading, error } = useEvolutionUsageReport(activeClientId || null, REPORT_DAYS);
  const items = data?.items ?? [];

  // Active tenant matching activeClientId for listing instances health
  const activeTenant = useMemo(() => {
    return tenants.find((t) => t.id === activeClientId);
  }, [tenants, activeClientId]);

  const tenantInstances = useMemo(() => {
    return activeTenant?.n8n_settings?.evolution_instances ?? [];
  }, [activeTenant]);

  // Pivot chips list
  const chips = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of items) {
      if (!map.has(row.chip_id)) map.set(row.chip_id, row.chip_label);
    }
    return Array.from(map, ([id, label]) => ({ id, label }));
  }, [items]);

  // Pivot values for Recharts
  const chartData = useMemo(() => {
    const byDay = new Map<string, Record<string, number | string>>();
    for (const row of items) {
      if (!byDay.has(row.dia)) byDay.set(row.dia, { dia: row.dia });
      byDay.get(row.dia)![row.chip_id] = row.enviados;
    }
    const rows = Array.from(byDay.values()).sort((a, b) =>
      String(a.dia).localeCompare(String(b.dia))
    );
    for (const r of rows) {
      for (const c of chips) {
        if (r[c.id] == null) r[c.id] = 0;
      }
    }
    return rows;
  }, [items, chips]);

  // Donut chart calculations: total volume per chip
  const pieData = useMemo(() => {
    const map: Record<string, { name: string; value: number }> = {};
    for (const row of items) {
      if (!map[row.chip_id]) {
        map[row.chip_id] = { name: row.chip_label, value: 0 };
      }
      map[row.chip_id].value += row.enviados;
    }
    return Object.values(map).sort((a, b) => b.value - a.value);
  }, [items]);

  // KPI calculations
  const kpis = useMemo(() => {
    let totalEnvios = 0;
    for (const row of items) {
      totalEnvios += row.enviados;
    }

    const mediaDiaria = chartData.length > 0 ? Math.round(totalEnvios / chartData.length) : 0;
    const liderChip = pieData[0]?.name || "Nenhum";

    let rotationStatus = "Estável (1 Chip)";
    if (pieData.length > 1) {
      const maxVal = pieData[0].value;
      const minVal = pieData[pieData.length - 1].value;
      // Alert if single chip carries more than 4x weight of smallest chip
      if (maxVal > minVal * 4 && minVal > 0) {
        rotationStatus = "Desbalanceado";
      } else {
        rotationStatus = "Balanceado (Excelente)";
      }
    }

    return { totalEnvios, mediaDiaria, liderChip, rotationStatus };
  }, [items, chartData, pieData]);

  const isDark = resolvedTheme !== "light";
  const axisColor = isDark ? "rgba(255,255,255,0.52)" : "rgba(71,85,105,0.92)";
  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(148,163,184,0.28)";
  const tooltipStyle = isDark
    ? {
        background: "rgba(8, 12, 32, 0.96)",
        border: "1px solid rgba(255, 255, 255, 0.12)",
        color: "rgba(255,255,255,0.92)",
        borderRadius: 16,
        boxShadow: "0 30px 80px rgba(0,0,0,0.35)",
      }
    : {
        background: "rgba(255,255,255,0.98)",
        border: "1px solid rgba(226,232,240,0.95)",
        color: "rgb(15 23 42)",
        borderRadius: 16,
        boxShadow: "0 20px 50px rgba(15,23,42,0.12)",
      };

  return (
    <PageShell
      title="Relatórios"
      subtitle={`Histórico de tráfego, consumo de limites e balanceamento de envios.`}
      spacing="space-y-6"
      compactHero
      headerRight={
        showSelector ? (
          <Select value={selectedClientId} onValueChange={setSelectedClientId}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Selecione um tenant" />
            </SelectTrigger>
            <SelectContent>
              {tenants.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null
      }
    >
      <ErrorMessage message={error ? (error as Error).message : null} variant="banner" />

      {!activeClientId ? (
        <EmptyState
          title="Selecione um tenant"
          description="Escolha um tenant no seletor acima para ver os relatórios de uso."
        />
      ) : isLoading ? (
        <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
          Carregando relatórios...
        </div>
      ) : chartData.length === 0 ? (
        <EmptyState
          title="Sem dados para exibir"
          description={`Nenhum envio registrado nos últimos ${REPORT_DAYS} dias para este tenant.`}
        />
      ) : (
        <>
          {/* KPI Analytics Grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="border-slate-200/80 bg-white/90 shadow-[0_10px_30px_rgba(15,23,42,0.04)] dark:border-white/5 dark:bg-white/[0.02] rounded-2xl">
              <CardContent className="p-5 flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-display">
                    Total de Envios
                  </p>
                  <p className="text-2xl font-bold font-num text-foreground">
                    {kpis.totalEnvios}
                  </p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-indigo-200/60 bg-indigo-50 dark:border-indigo-800/40 dark:bg-indigo-950/40">
                  <TrendingUp className="h-5 w-5 text-indigo-500" />
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200/80 bg-white/90 shadow-[0_10px_30px_rgba(15,23,42,0.04)] dark:border-white/5 dark:bg-white/[0.02] rounded-2xl">
              <CardContent className="p-5 flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-display">
                    Média por Dia
                  </p>
                  <p className="text-2xl font-bold font-num text-foreground">
                    {kpis.mediaDiaria}
                  </p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-200/60 bg-blue-50 dark:border-blue-800/40 dark:bg-blue-950/40">
                  <Activity className="h-5 w-5 text-blue-500" />
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200/80 bg-white/90 shadow-[0_10px_30px_rgba(15,23,42,0.04)] dark:border-white/5 dark:bg-white/[0.02] rounded-2xl">
              <CardContent className="p-5 flex items-center justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-display">
                    Chip Líder
                  </p>
                  <p className="text-lg font-bold text-foreground truncate">
                    {kpis.liderChip}
                  </p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-200/60 bg-cyan-50 dark:border-cyan-800/40 dark:bg-cyan-950/40">
                  <Smartphone className="h-5 w-5 text-cyan-500" />
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200/80 bg-white/90 shadow-[0_10px_30px_rgba(15,23,42,0.04)] dark:border-white/5 dark:bg-white/[0.02] rounded-2xl">
              <CardContent className="p-5 flex items-center justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-display">
                    Saúde de Rotação
                  </p>
                  <p className={`text-xs font-bold truncate ${
                    kpis.rotationStatus === "Desbalanceado" ? "text-rose-500" : "text-emerald-500"
                  }`}>
                    {kpis.rotationStatus}
                  </p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-200/60 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-950/40">
                  <AlertTriangle className={`h-5 w-5 ${
                    kpis.rotationStatus === "Desbalanceado" ? "text-rose-500" : "text-amber-500"
                  }`} />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Gráfico Barras + Donut Distribuição */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Grouped Bar Chart */}
            <Card className="lg:col-span-2 border-slate-200/80 bg-white/90 shadow-[0_20px_50px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-white/[0.04] rounded-2xl">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-indigo-400/20 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
                    <BarChart2 className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold">Histórico Diário de Envios</CardTitle>
                    <CardDescription className="text-xs">Volume de mensagens processadas por chip nos últimos {REPORT_DAYS} dias.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={chartData} margin={{ top: 8, right: 0, left: -25, bottom: 0 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={gridColor} />
                    <XAxis
                      dataKey="dia"
                      tickFormatter={formatDiaLabel}
                      tick={{ fill: axisColor, fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: axisColor, fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      width={38}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelFormatter={(label) => `Dia ${formatDiaLabel(String(label))}`}
                      labelStyle={{ color: isDark ? "rgba(255,255,255,0.7)" : "rgba(71,85,105,0.9)", fontSize: 11 }}
                      itemStyle={{ color: isDark ? "rgba(255,255,255,0.9)" : "rgb(15 23 42)", fontSize: 11 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {chips.map((chip, index) => (
                      <Bar
                        key={chip.id}
                        dataKey={chip.id}
                        name={chip.label}
                        fill={CHIP_PALETTE[index % CHIP_PALETTE.length]}
                        radius={[3, 3, 0, 0]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Donut Chart */}
            <Card className="lg:col-span-1 border-slate-200/80 bg-white/90 shadow-[0_20px_50px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-white/[0.04] rounded-2xl flex flex-col justify-between">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <PieChartIcon className="h-5 w-5 text-indigo-500" />
                  <div>
                    <CardTitle className="text-base font-bold">Participação Operacional</CardTitle>
                    <CardDescription className="text-xs">Distribuição percentual do volume.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex items-center justify-center py-2">
                {pieData.length === 0 ? (
                  <div className="text-xs text-muted-foreground">Sem envios no período.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={170}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={70}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={CHIP_PALETTE[index % CHIP_PALETTE.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={tooltipStyle}
                        itemStyle={{ color: isDark ? "rgba(255,255,255,0.9)" : "rgb(15 23 42)", fontSize: 11 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
              <div className="p-6 pt-0 border-t border-slate-100 dark:border-white/5 flex flex-wrap gap-x-4 gap-y-2 justify-center text-[10px] text-muted-foreground font-semibold">
                {pieData.map((item, index) => {
                  const percent = kpis.totalEnvios > 0 ? Math.round((item.value / kpis.totalEnvios) * 100) : 0;
                  return (
                    <div key={item.name} className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHIP_PALETTE[index % CHIP_PALETTE.length] }} />
                      <span>{item.name} ({percent}%)</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* Cota & Saúde do Chip Table */}
          <Card className="border-slate-200/80 bg-white/90 shadow-[0_20px_50px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-white/[0.04] rounded-2xl overflow-hidden">
            <CardHeader className="pb-3 border-b border-slate-100 dark:border-white/5">
              <CardTitle className="text-base font-bold">Saúde e Capacidade dos Chips (Hoje)</CardTitle>
              <CardDescription className="text-xs">Acompanhamento e integridade de cotas de segurança.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {tenantInstances.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  Nenhum chip WhatsApp cadastrado neste tenant.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-100 dark:border-white/5">
                      <TableHead className="px-6 py-4 text-xs font-bold uppercase tracking-wider font-display">Identificador</TableHead>
                      <TableHead className="px-4 py-4 text-xs font-bold uppercase tracking-wider font-display text-center">Estado</TableHead>
                      <TableHead className="px-4 py-4 text-xs font-bold uppercase tracking-wider font-display text-center">Cota Diária</TableHead>
                      <TableHead className="px-4 py-4 text-xs font-bold uppercase tracking-wider font-display text-center">Uso Hoje</TableHead>
                      <TableHead className="px-6 py-4 text-xs font-bold uppercase tracking-wider font-display text-right">Saúde</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tenantInstances.map((inst) => {
                      const isCold = inst.chip_state === "cold";
                      const currentLimit = inst.daily_limit_override ?? (isCold ? 100 : 500);
                      const sent = inst.sent_count_today ?? 0;
                      const pct = Math.min(100, Math.round((sent / currentLimit) * 100));
                      const isAlert = pct >= 80;

                      return (
                        <TableRow key={inst.id} className="border-slate-100 hover:bg-slate-50/50 dark:border-white/5 dark:hover:bg-white/[0.01]">
                          <TableCell className="px-6 py-4 font-semibold text-sm text-foreground">
                            {inst.name}
                            {inst.is_default && (
                              <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-xl border border-cyan-400/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200">
                                Padrão
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="px-4 py-4 text-center">
                            {isCold ? (
                              <Badge className="border border-blue-400/25 bg-blue-500/10 text-blue-700 dark:text-blue-200 text-[10px] rounded-xl">
                                Frio / Aquecendo
                              </Badge>
                            ) : (
                              <Badge className="border border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 text-[10px] rounded-xl">
                                Aquecido
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="px-4 py-4 text-center font-bold font-num text-sm text-foreground">
                            {currentLimit} envios
                          </TableCell>
                          <TableCell className="px-4 py-4">
                            <div className="flex flex-col items-center justify-center gap-1.5">
                              <span className="text-xs font-semibold font-num text-muted-foreground">
                                {sent} / {currentLimit} ({pct}%)
                              </span>
                              <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                                <div
                                  className={`h-full rounded-full transition-all duration-300 ${
                                    isAlert ? "bg-rose-500 animate-pulse" : "bg-indigo-500"
                                  }`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-1.5 text-xs">
                              {isAlert ? (
                                <span className="flex items-center gap-1 text-rose-500 font-bold">
                                  <AlertCircle className="h-4 w-4" />
                                  Limite Próximo
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-emerald-500 font-bold">
                                  <CheckCircle2 className="h-4 w-4" />
                                  Saudável
                                </span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </PageShell>
  );
}
