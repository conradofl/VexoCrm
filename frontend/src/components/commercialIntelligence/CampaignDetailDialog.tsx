import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import { DashboardPanel } from "@/components/DashboardPanel";
import { EmptyState } from "@/components/EmptyState";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CampaignPerformanceItem } from "@/hooks/useCommercialIntelligence";
import { formatCurrency, formatPercent } from "@/lib/commercialIntelligence/helpers";
import { EmptyChart } from "./EmptyChart";

export function CampaignDetailDialog({
  campaignDetail,
  onOpenChange,
}: {
  campaignDetail: CampaignPerformanceItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={Boolean(campaignDetail)} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto rounded-[1.5rem] border-border bg-card text-card-foreground shadow-2xl">
          <DialogHeader>
            <DialogTitle>{campaignDetail?.name}</DialogTitle>
            <DialogDescription>Evolucao temporal, consultores, cidades, gargalos e preview dos leads da campanha.</DialogDescription>
          </DialogHeader>
          {campaignDetail ? (
            <div className="space-y-4">
              <div className="grid gap-3 lg:grid-cols-4">
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Taxa de resposta</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{formatPercent(campaignDetail.responseRate)}</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Taxa de qualificacao</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{formatPercent(campaignDetail.qualificationRate)}</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Receita</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{formatCurrency(campaignDetail.revenue)}</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">ROI estimado</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{campaignDetail.roiEstimated === null ? "—" : `${campaignDetail.roiEstimated.toFixed(2)}x`}</p>
                </div>
              </div>

              <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.9fr)]">
                <DashboardPanel title="Evolucao no tempo" subtitle="Qualificados e fechamentos por data" className="p-4">
                  {campaignDetail.trend.length ? (
                    <ChartContainer config={{ qualificados: { label: "Qualificados", color: "#22d3ee" }, fechamentos: { label: "Fechamentos", color: "#a78bfa" } }} className="h-[280px] w-full">
                      <LineChart data={campaignDetail.trend}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="date" tickLine={false} axisLine={false} />
                        <YAxis tickLine={false} axisLine={false} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Line type="monotone" dataKey="qualificados" stroke="var(--color-qualificados)" strokeWidth={2.5} dot={false} />
                        <Line type="monotone" dataKey="fechamentos" stroke="var(--color-fechamentos)" strokeWidth={2.5} dot={false} />
                      </LineChart>
                    </ChartContainer>
                  ) : (
                    <EmptyChart title="Sem linha temporal" description="Ainda nao ha volume suficiente para evolucao da campanha." />
                  )}
                </DashboardPanel>

                <DashboardPanel title="Gargalos do funil" subtitle="Volume por etapa operacional" className="p-4">
                  {campaignDetail.funnel.length ? (
                    <ChartContainer config={{ value: { label: "Volume", color: "#22d3ee" } }} className="h-[280px] w-full">
                      <BarChart data={campaignDetail.funnel}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="stage" tickLine={false} axisLine={false} />
                        <YAxis tickLine={false} axisLine={false} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Bar dataKey="value" fill="var(--color-value)" radius={[10, 10, 0, 0]} />
                      </BarChart>
                    </ChartContainer>
                  ) : (
                    <EmptyChart title="Funil vazio" description="Sem dados suficientes para detalhar gargalos." />
                  )}
                </DashboardPanel>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <DashboardPanel title="Cidades com melhor resultado" subtitle="Melhor desempenho geografico" className="p-4">
                  <div className="space-y-2">
                    {campaignDetail.topCities.length ? campaignDetail.topCities.map((item) => (
                      <div key={item.city} className="flex items-center justify-between rounded-xl border border-border bg-card/60 px-3 py-3">
                        <span className="text-sm font-medium text-foreground">{item.city}</span>
                        <span className="text-xs text-muted-foreground">{formatPercent(item.qualificationRate)}</span>
                      </div>
                    )) : <EmptyState message="Nenhuma cidade performou acima da media ainda." />}
                  </div>
                </DashboardPanel>

                <DashboardPanel title="Consultores que mais converteram" subtitle="Conversao e receita por campanha" className="p-4">
                  <div className="space-y-2">
                    {campaignDetail.topConsultants.length ? campaignDetail.topConsultants.map((item) => (
                      <div key={item.consultantId} className="flex items-center justify-between rounded-xl border border-border bg-card/60 px-3 py-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">{item.consultantName}</p>
                          <p className="text-xs text-muted-foreground">{item.converted} fechamentos</p>
                        </div>
                        <span className="text-xs text-muted-foreground">{formatCurrency(item.revenue)}</span>
                      </div>
                    )) : <EmptyState message="Nenhum consultor fechou oportunidades desta campanha ainda." />}
                  </div>
                </DashboardPanel>
              </div>

              <DashboardPanel title="Leads gerados pela campanha" subtitle="Preview real dos leads vinculados a esta origem" className="p-4">
                {campaignDetail.previewLeads.length ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Nome</TableHead>
                          <TableHead>Telefone</TableHead>
                          <TableHead>Cidade</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Qualificacao</TableHead>
                          <TableHead>Criado em</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {campaignDetail.previewLeads.map((lead) => (
                          <TableRow key={lead.id}>
                            <TableCell>{lead.nome}</TableCell>
                            <TableCell>{lead.telefone}</TableCell>
                            <TableCell>{lead.cidade}</TableCell>
                            <TableCell>{lead.estado}</TableCell>
                            <TableCell>{lead.status}</TableCell>
                            <TableCell>{lead.qualificacao}</TableCell>
                            <TableCell>{lead.createdAt ? new Date(lead.createdAt).toLocaleString("pt-BR") : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <EmptyState message="Esta campanha ainda nao tem leads vinculados no recorte atual." />
                )}
              </DashboardPanel>
            </div>
          ) : null}
        </DialogContent>
    </Dialog>
  );
}
