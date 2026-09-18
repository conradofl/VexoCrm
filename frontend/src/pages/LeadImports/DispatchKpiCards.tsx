// frontend/src/pages/LeadImports/DispatchKpiCards.tsx
//
// Os quatro cartões que somam campanha (não lote): campanhas, leads,
// enviados, taxa de entrega — sempre com o período explícito na tela, pra
// não virar um número que muda de significado conforme onde aparece.
// Reaproveitado no topo da Fila de Envios, do Relatório & Auditoria e de
// Campanhas — os três lugares que hoje mostram "Lotes Criados".

import { useDispatchSummary, type DispatchSummaryKpis } from "@/hooks/useCampanhas";

export function DispatchKpiCards({ clientId }: { clientId: string | null }) {
  // pageSize=1: só precisamos de kpis (calculado sobre TODAS as campanhas do
  // tenant, não só a página), não da lista de campanhas em si.
  const { data } = useDispatchSummary(clientId, "active", 1, 1);
  if (!data?.kpis) return null;
  return <DispatchKpiCardsView kpis={data.kpis} />;
}

export function DispatchKpiCardsView({ kpis }: { kpis: DispatchSummaryKpis }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
      <KpiCard label="Campanhas" value={kpis.campaigns} periodLabel={kpis.periodLabel} />
      <KpiCard label="Leads" value={kpis.leads} periodLabel={kpis.periodLabel} />
      <KpiCard label="Enviados" value={kpis.sent} periodLabel={kpis.periodLabel} />
      <KpiCard
        label="Taxa de entrega"
        value={kpis.deliveryRate != null ? `${kpis.deliveryRate}%` : "—"}
        periodLabel={kpis.periodLabel}
      />
    </div>
  );
}

function KpiCard({ label, value, periodLabel }: { label: string; value: number | string; periodLabel: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground">{value}</p>
      <p className="text-[10px] text-muted-foreground">{periodLabel}</p>
    </div>
  );
}
