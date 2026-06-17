import { useMemo, useState } from "react";
import { BarChart2 } from "lucide-react";
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
} from "recharts";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useLeadClients } from "@/hooks/useLeadClients";
import { useEvolutionUsageReport } from "@/hooks/useReports";

const REPORT_DAYS = 14;

// Paleta de marca (memória P4): Electric Indigo estrutura, laranja ação/marca,
// Cyan Neon complemento — ciclada para múltiplos chips. Não improvisar fora disso.
const CHIP_PALETTE = ["#6366F1", "#ff7a1a", "#22D3EE", "#8b5cf6", "#f43f5e", "#10b981"];

function formatDiaLabel(dia: string): string {
  // "YYYY-MM-DD" → "DD/MM"
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

  // Lista de chips (legenda humana), na ordem de aparição.
  const chips = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of items) {
      if (!map.has(row.chip_id)) map.set(row.chip_id, row.chip_label);
    }
    return Array.from(map, ([id, label]) => ({ id, label }));
  }, [items]);

  // Pivot longo → largo p/ recharts: uma linha por dia, uma série por chip.
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
      subtitle={`Envios por dia, por chip — últimos ${REPORT_DAYS} dias.`}
      spacing="space-y-4"
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
      <Card className="border-slate-200/80 bg-white/90 shadow-[0_20px_50px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-white/[0.04]">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-indigo-400/20 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
              <BarChart2 className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Envios por dia</CardTitle>
              <CardDescription>Uma série por chip. Origem: cota diária registrada por instância.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ErrorMessage message={error ? (error as Error).message : null} variant="banner" />

          {!activeClientId ? (
            <EmptyState
              title="Selecione um tenant"
              description="Escolha um tenant no seletor acima para ver os envios por chip."
            />
          ) : isLoading ? (
            <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
              Carregando relatório...
            </div>
          ) : chartData.length === 0 ? (
            <EmptyState
              title="Sem envios no período"
              description={`Nenhum envio registrado nos últimos ${REPORT_DAYS} dias para este tenant.`}
            />
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={gridColor} />
                <XAxis
                  dataKey="dia"
                  tickFormatter={formatDiaLabel}
                  tick={{ fill: axisColor, fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: axisColor, fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={42}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(label) => `Dia ${formatDiaLabel(String(label))}`}
                  labelStyle={{ color: isDark ? "rgba(255,255,255,0.7)" : "rgba(71,85,105,0.9)" }}
                  itemStyle={{ color: isDark ? "rgba(255,255,255,0.9)" : "rgb(15 23 42)" }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {chips.map((chip, index) => (
                  <Bar
                    key={chip.id}
                    dataKey={chip.id}
                    name={chip.label}
                    fill={CHIP_PALETTE[index % CHIP_PALETTE.length]}
                    radius={[4, 4, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
