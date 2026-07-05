import type { Dispatch, SetStateAction } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  CircleUserRound,
  Gauge,
  HandCoins,
  LayoutPanelTop,
  MapPinned,
  MessageCircleReply,
  Settings2,
  Sparkles,
  Target,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Funnel,
  FunnelChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { KpiGrid } from "@/components/KpiGrid";
import { KpiCard } from "@/components/KpiCard";
import { DashboardPanel } from "@/components/DashboardPanel";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type {
  CampaignPerformanceItem,
  CommercialIntelligencePayload,
  CommercialMetricRow,
  ConsultantItem,
  InsightItem,
} from "@/hooks/useCommercialIntelligence";
import {
  deltaLabel,
  directionClasses,
  formatCompact,
  formatCurrency,
  formatHours,
  formatNumber,
  formatPercent,
  severityClasses,
  STATUS_COLORS,
  statusClasses,
  toneFromAccent,
  type SortOrder,
  type TabId,
} from "@/lib/commercialIntelligence/helpers";
import { EmptyChart } from "./EmptyChart";
import { FilterField } from "./FilterField";
import { PaginationBar } from "./PaginationBar";

interface PerformanceTabProps {
  data: CommercialIntelligencePayload;
  metricsSorted: CommercialMetricRow[];
  campaignsFiltered: CampaignPerformanceItem[];
  pagedCampaigns: { items: CampaignPerformanceItem[]; page: number; totalPages: number };
  setCampaignPage: Dispatch<SetStateAction<number>>;
  compareCampaignA: string;
  compareCampaignB: string;
  setCompareCampaignA: Dispatch<SetStateAction<string>>;
  setCompareCampaignB: Dispatch<SetStateAction<string>>;
  compareCampaignRows: CampaignPerformanceItem[];
  campaigns: CampaignPerformanceItem[];
  showCampaignsPanel: boolean;
  setShowCampaignsPanel: Dispatch<SetStateAction<boolean>>;
  showDetailedMetrics: boolean;
  setShowDetailedMetrics: Dispatch<SetStateAction<boolean>>;
  setActiveTab: Dispatch<SetStateAction<TabId>>;
  setCampaignDetail: Dispatch<SetStateAction<CampaignPerformanceItem | null>>;
  setConsultantDetail: Dispatch<SetStateAction<ConsultantItem | null>>;
  handleInsightAction: (insight: InsightItem) => Promise<void> | void;
  openRankingDetails: (title: string, rows: Array<{ label: string; value: string }>) => void;
  metricSort: { key: keyof CommercialMetricRow; order: SortOrder };
  setMetricSort: Dispatch<SetStateAction<{ key: keyof CommercialMetricRow; order: SortOrder }>>;
}

export function PerformanceTab({
  data,
  metricsSorted,
  campaignsFiltered,
  pagedCampaigns,
  setCampaignPage,
  compareCampaignA,
  compareCampaignB,
  setCompareCampaignA,
  setCompareCampaignB,
  compareCampaignRows,
  campaigns,
  showCampaignsPanel,
  setShowCampaignsPanel,
  showDetailedMetrics,
  setShowDetailedMetrics,
  setActiveTab,
  setCampaignDetail,
  setConsultantDetail,
  handleInsightAction,
  openRankingDetails,
  metricSort,
  setMetricSort,
}: PerformanceTabProps) {
  return (
    <>
          <KpiGrid cols={4} className="gap-3">
            {data.overview.kpis.map((item) => (
              <KpiCard
                key={item.key}
                title={item.title}
                value={item.valueLabel}
                tone={toneFromAccent(item.tone)}
                trend={item.delta === null ? "sem comparativo" : deltaLabel(item.delta, item.kind)}
                icon={
                  item.key.includes("response") ? (
                    <MessageCircleReply className="h-4 w-4" />
                  ) : item.key.includes("revenue") ? (
                    <HandCoins className="h-4 w-4" />
                  ) : item.key.includes("qualification") ? (
                    <Target className="h-4 w-4" />
                  ) : item.key.includes("closing") ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : item.key.includes("time") ? (
                    <CalendarClock className="h-4 w-4" />
                  ) : (
                    <Gauge className="h-4 w-4" />
                  )
                }
              />
            ))}
          </KpiGrid>

          <div className="grid gap-3 xl:grid-cols-2">
            <DashboardPanel title="Evolucao de qualificados" subtitle="Qualificados, respondidos e fechamentos ao longo do periodo" className="p-4">
              {data.overview.charts.qualifiedByDay.length ? (
                <ChartContainer
                  config={{
                    qualificados: { label: "Qualificados", color: "#22d3ee" },
                    respondidos: { label: "Respondidos", color: "#a78bfa" },
                    fechamentos: { label: "Fechamentos", color: "#fb7185" },
                  }}
                  className="h-[300px] w-full"
                >
                  <LineChart data={data.overview.charts.qualifiedByDay}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line type="monotone" dataKey="qualificados" stroke="var(--color-qualificados)" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="respondidos" stroke="var(--color-respondidos)" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="fechamentos" stroke="var(--color-fechamentos)" strokeWidth={2.5} dot={false} />
                    <ChartLegend content={<ChartLegendContent />} />
                  </LineChart>
                </ChartContainer>
              ) : (
                <EmptyChart title="Sem evolucao registrada" description="Ative conversas, qualificacoes ou fechamentos para habilitar o grafico." />
              )}
            </DashboardPanel>

            <DashboardPanel title="Funil de conversao" subtitle="Entrada, resposta, qualificacao e fechamento no periodo" className="p-4">
              {data.overview.charts.funnel.length ? (
                <ChartContainer config={{ value: { label: "Volume", color: "#22d3ee" } }} className="h-[300px] w-full">
                  <FunnelChart>
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Funnel dataKey="value" data={data.overview.charts.funnel} isAnimationActive>
                      <LabelList position="right" fill="currentColor" stroke="none" dataKey="stage" />
                    </Funnel>
                  </FunnelChart>
                </ChartContainer>
              ) : (
                <EmptyChart title="Funil indisponivel" description="Precisamos de leads abordados e respostas para desenhar o funil." />
              )}
            </DashboardPanel>
          </div>

          <div className="grid gap-3 xl:grid-cols-3">
            <DashboardPanel title="Performance por cidade" subtitle="Leads, qualificados e receita" className="p-4 xl:col-span-1">
              {data.overview.charts.byCity.length ? (
                <ChartContainer config={{ qualificados: { label: "Qualificados", color: "#22d3ee" } }} className="h-[280px] w-full">
                  <BarChart data={data.overview.charts.byCity.slice(0, 6)} layout="vertical" margin={{ left: 8 }}>
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" width={90} tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="qualificados" fill="var(--color-qualificados)" radius={[0, 10, 10, 0]} />
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyChart title="Sem cidades suficientes" description="Quando os leads tiverem cidade preenchida, este ranking aparece aqui." />
              )}
            </DashboardPanel>

            <DashboardPanel title="Performance por campanha" subtitle="Qualificados e receita gerada" className="p-4 xl:col-span-1">
              {data.overview.charts.byCampaign.length ? (
                <ChartContainer
                  config={{
                    qualificados: { label: "Qualificados", color: "#a78bfa" },
                    receita: { label: "Receita", color: "#22d3ee" },
                  }}
                  className="h-[280px] w-full"
                >
                  <BarChart data={data.overview.charts.byCampaign.slice(0, 6)}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} angle={-15} height={60} />
                    <YAxis tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Legend />
                    <Bar dataKey="qualificados" fill="var(--color-qualificados)" radius={[10, 10, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyChart title="Sem campanhas no recorte" description="Importe ou dispare campanhas para acompanhar a performance aqui." />
              )}
            </DashboardPanel>

            <DashboardPanel title="Distribuicao por status" subtitle="Leitura rapida da base atual" className="p-4 xl:col-span-1">
              {data.overview.charts.statusDonut.length ? (
                <ChartContainer config={{ status: { label: "Status", color: "#22d3ee" } }} className="h-[280px] w-full">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                    <Pie data={data.overview.charts.statusDonut} dataKey="value" nameKey="name" innerRadius={68} outerRadius={102} paddingAngle={2}>
                      {data.overview.charts.statusDonut.map((entry, index) => (
                        <Cell key={entry.name} fill={STATUS_COLORS[index % STATUS_COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
              ) : (
                <EmptyChart title="Sem status para distribuir" description="Assim que houver leads com status, a distribuicao visual aparece aqui." />
              )}
            </DashboardPanel>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.9fr)]">
            <DashboardPanel title="Comparativo entre consultores" subtitle="Conversao, receita e volume recebido" className="p-4">
              {data.overview.charts.consultantComparison.length ? (
                <ChartContainer config={{ conversao: { label: "Conversao", color: "#22d3ee" } }} className="h-[300px] w-full">
                  <BarChart data={data.overview.charts.consultantComparison.slice(0, 6)}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} angle={-12} height={56} />
                    <YAxis tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="conversao" fill="var(--color-conversao)" radius={[10, 10, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyChart title="Sem consultores atribuidos" description="Atribua leads para destravar o comparativo operacional." />
              )}
            </DashboardPanel>

            <DashboardPanel title="Alertas principais" subtitle="Leituras automaticas da operacao com acao rapida" className="p-4">
              <div className="space-y-3">
                {data.overview.alerts.length ? (
                  data.overview.alerts.slice(0, 4).map((insight) => (
                    <div key={`${insight.title}-${insight.generatedAt}`} className="rounded-[1.2rem] border border-border bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{insight.title}</p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">{insight.message}</p>
                        </div>
                        <Badge className={cn("border-0", severityClasses(insight.severity))}>{insight.severity}</Badge>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="text-xs text-muted-foreground">{insight.impact}</span>
                        <Button variant="outline" size="sm" onClick={() => void handleInsightAction(insight)}>
                          {insight.actionLabel}
                        </Button>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState message="Nenhum alerta critico para a empresa selecionada." />
                )}
              </div>
            </DashboardPanel>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <DashboardPanel title="Cidades em destaque" subtitle="Resumo rapido do ranking de cidades" className="p-4">
              <div className="space-y-2">
                {data.overview.rankingSummary.cities.slice(0, 5).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      openRankingDetails(item.name, [
                        { label: "Taxa de qualificacao", value: formatPercent(item.qualificationRate) },
                        { label: "Taxa de conversao", value: formatPercent(item.conversionRate) },
                        { label: "Volume de leads", value: formatNumber(item.volumeLeads) },
                        { label: "Receita gerada", value: formatCurrency(item.revenue) },
                        { label: "Tempo medio ate fechamento", value: formatHours(item.avgCloseHours) },
                      ])
                    }
                    className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-3 py-3 text-left transition hover:border-cyan-500/50 hover:bg-cyan-500/5"
                  >
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.name}</p>
                      <p className="text-xs text-muted-foreground">Qualificacao {formatPercent(item.qualificationRate)}</p>
                    </div>
                    <MapPinned className="h-4 w-4 text-cyan-600 dark:text-cyan-200" />
                  </button>
                ))}
              </div>
            </DashboardPanel>

            <DashboardPanel title="Campanhas em destaque" subtitle="Melhores campanhas no recorte atual" className="p-4">
              <div className="space-y-2">
                {data.overview.rankingSummary.campaigns.slice(0, 5).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      openRankingDetails(item.name, [
                        { label: "Taxa de resposta", value: formatPercent(item.responseRate) },
                        { label: "Taxa de qualificacao", value: formatPercent(item.qualificationRate) },
                        { label: "Taxa de conversao", value: formatPercent(item.conversionRate) },
                        { label: "Qualificados", value: formatNumber(item.qualifiedLeads) },
                        { label: "Receita", value: formatCurrency(item.revenue) },
                      ])
                    }
                    className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-3 py-3 text-left transition hover:border-violet-500/50 hover:bg-violet-500/5"
                  >
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.name}</p>
                      <p className="text-xs text-muted-foreground">Resposta {formatPercent(item.responseRate)}</p>
                    </div>
                    <Target className="h-4 w-4 text-violet-600 dark:text-violet-200" />
                  </button>
                ))}
              </div>
            </DashboardPanel>

            <DashboardPanel title="Consultores em destaque" subtitle="Quem mais converte no periodo filtrado" className="p-4">
              <div className="space-y-2">
                {data.overview.rankingSummary.consultants.slice(0, 5).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setConsultantDetail(item)}
                    className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-3 py-3 text-left transition hover:border-fuchsia-500/50 hover:bg-fuchsia-500/5"
                  >
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.name}</p>
                      <p className="text-xs text-muted-foreground">Conversao {formatPercent(item.conversionRate)}</p>
                    </div>
                    <CircleUserRound className="h-4 w-4 text-fuchsia-600 dark:text-fuchsia-200" />
                  </button>
                ))}
              </div>
            </DashboardPanel>
          </div>

          {/* Campanhas de Marketing Collapsible Section */}
          <div className="pt-2">
            <Button 
              variant="outline" 
              className="w-full flex items-center justify-between py-5 border-border bg-card/50 rounded-2xl backdrop-blur-md"
              onClick={() => setShowCampaignsPanel(!showCampaignsPanel)}
            >
              <span className="text-sm font-semibold text-foreground">
                {showCampaignsPanel ? "Ocultar Painel de Campanhas" : "Gerenciar & Comparar Campanhas"}
              </span>
              <LayoutPanelTop className={cn("h-4 w-4 transition-transform", showCampaignsPanel ? "rotate-90" : "")} />
            </Button>
            
            {showCampaignsPanel && (
              <div className="mt-3 space-y-4">
                <KpiGrid cols={4} className="gap-3">
                  <KpiCard title="Campanhas totais" value={formatNumber(data.campaigns.summary.total)} icon={<LayoutPanelTop className="h-4 w-4" />} tone="cyan" trend="base acompanhada" />
                  <KpiCard title="Campanhas ativas" value={formatNumber(data.campaigns.summary.active)} icon={<Target className="h-4 w-4" />} tone="teal" trend="em operacao" />
                  <KpiCard title="Receita atribuida" value={formatCurrency(data.campaigns.summary.revenue)} icon={<HandCoins className="h-4 w-4" />} tone="amber" trend="por campanha" />
                  <KpiCard title="Qualificados" value={formatNumber(data.campaigns.summary.qualifiedLeads)} icon={<Sparkles className="h-4 w-4" />} tone="purple" trend="no periodo filtrado" />
                </KpiGrid>
                
                <div className="grid gap-3 xl:grid-cols-2">
                  <DashboardPanel title="Ranking interno" subtitle="Melhores campanhas por resposta, qualificacao e ROI" className="p-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-[1.2rem] border border-border bg-card p-3">
                        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Maior resposta</p>
                        <p className="mt-2 text-sm font-semibold text-foreground">{[...campaigns].sort((a, b) => b.responseRate - a.responseRate)[0]?.name || "—"}</p>
                      </div>
                      <div className="rounded-[1.2rem] border border-border bg-card p-3">
                        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Maior qualificacao</p>
                        <p className="mt-2 text-sm font-semibold text-foreground">{[...campaigns].sort((a, b) => b.qualificationRate - a.qualificationRate)[0]?.name || "—"}</p>
                      </div>
                      <div className="rounded-[1.2rem] border border-border bg-card p-3">
                        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Maior ROI</p>
                        <p className="mt-2 text-sm font-semibold text-foreground">{[...campaigns].sort((a, b) => (b.roiEstimated || 0) - (a.roiEstimated || 0))[0]?.name || "—"}</p>
                      </div>
                    </div>
                  </DashboardPanel>

                  <DashboardPanel title="Comparar campanhas" subtitle="Selecione duas campanhas e compare os numeros lado a lado" className="p-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <FilterField label="Campanha A">
                        <Select value={compareCampaignA || "all"} onValueChange={(value) => setCompareCampaignA(value === "all" ? "" : value)}>
                          <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Selecione</SelectItem>
                            {campaigns.map((campaign) => (
                              <SelectItem key={campaign.id} value={campaign.id}>{campaign.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FilterField>
                      <FilterField label="Campanha B">
                        <Select value={compareCampaignB || "all"} onValueChange={(value) => setCompareCampaignB(value === "all" ? "" : value)}>
                          <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Selecione</SelectItem>
                            {campaigns.map((campaign) => (
                              <SelectItem key={campaign.id} value={campaign.id}>{campaign.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FilterField>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {compareCampaignRows.length ? compareCampaignRows.map((campaign) => (
                        <div key={campaign.id} className="rounded-[1.2rem] border border-border bg-card p-4">
                          <p className="text-sm font-semibold text-foreground">{campaign.name}</p>
                          <div className="mt-3 grid gap-2 text-sm">
                            <div className="flex items-center justify-between"><span className="text-muted-foreground">Resposta</span><span>{formatPercent(campaign.responseRate)}</span></div>
                            <div className="flex items-center justify-between"><span className="text-muted-foreground">Qualificacao</span><span>{formatPercent(campaign.qualificationRate)}</span></div>
                            <div className="flex items-center justify-between"><span className="text-muted-foreground">Fechamentos</span><span>{formatNumber(campaign.closings)}</span></div>
                            <div className="flex items-center justify-between"><span className="text-muted-foreground">Receita</span><span>{formatCurrency(campaign.revenue)}</span></div>
                          </div>
                        </div>
                      )) : <EmptyState message="Selecione duas campanhas para comparar." />}
                    </div>
                  </DashboardPanel>
                </div>

                <DashboardPanel title="Analise de campanhas" subtitle="Visualizacao e comparativo operacional" className="p-4">
                  {campaignsFiltered.length ? (
                    <>
                      <div className="mb-4">
                        <ChartContainer config={{ qualificados: { label: "Qualificados", color: "#22d3ee" } }} className="h-[280px] w-full">
                          <BarChart data={campaignsFiltered.slice(0, 8)}>
                            <CartesianGrid vertical={false} />
                            <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} angle={-15} height={64} />
                            <YAxis tickLine={false} axisLine={false} />
                            <ChartTooltip content={<ChartTooltipContent />} />
                            <Bar dataKey="leadsQualified" fill="var(--color-qualificados)" radius={[10, 10, 0, 0]} />
                          </BarChart>
                        </ChartContainer>
                      </div>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Campanha</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Periodo</TableHead>
                              <TableHead>Importados</TableHead>
                              <TableHead>Abordados</TableHead>
                              <TableHead>Respondidos</TableHead>
                              <TableHead>Qualificados</TableHead>
                              <TableHead>Tx resposta</TableHead>
                              <TableHead>Tx qualificacao</TableHead>
                              <TableHead>Fechamentos</TableHead>
                              <TableHead>Receita</TableHead>
                              <TableHead>Custo</TableHead>
                              <TableHead>CPLQ</TableHead>
                              <TableHead>ROI</TableHead>
                              <TableHead>Acoes</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {pagedCampaigns.items.map((campaign) => (
                              <TableRow key={campaign.id}>
                                <TableCell><p className="font-semibold text-foreground">{campaign.name}</p></TableCell>
                                <TableCell><Badge className={cn("border-0", statusClasses(campaign.status))}>{campaign.status}</Badge></TableCell>
                                <TableCell>{campaign.period}</TableCell>
                                <TableCell>{formatNumber(campaign.leadsImported)}</TableCell>
                                <TableCell>{formatNumber(campaign.leadsApproached)}</TableCell>
                                <TableCell>{formatNumber(campaign.leadsResponded)}</TableCell>
                                <TableCell>{formatNumber(campaign.leadsQualified)}</TableCell>
                                <TableCell>{formatPercent(campaign.responseRate)}</TableCell>
                                <TableCell>{formatPercent(campaign.qualificationRate)}</TableCell>
                                <TableCell>{formatNumber(campaign.closings)}</TableCell>
                                <TableCell>{formatCurrency(campaign.revenue)}</TableCell>
                                <TableCell>{formatCurrency(campaign.cost)}</TableCell>
                                <TableCell>{campaign.cplq === null ? "—" : formatCurrency(campaign.cplq)}</TableCell>
                                <TableCell>{campaign.roiEstimated === null ? "—" : `${campaign.roiEstimated.toFixed(2)}x`}</TableCell>
                                <TableCell>
                                  <div className="flex flex-wrap gap-2">
                                    <Button variant="outline" size="sm" onClick={() => setCampaignDetail(campaign)}>Ver detalhes</Button>
                                    <Button variant="outline" size="sm" onClick={() => setActiveTab("performance")}>Comparar</Button>
                                    <Button variant="outline" size="sm" onClick={() => setCampaignDetail(campaign)}>Abrir leads</Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      <PaginationBar page={pagedCampaigns.page} totalPages={pagedCampaigns.totalPages} onChange={setCampaignPage} />
                    </>
                  ) : (
                    <EmptyState title="Nenhuma campanha encontrada" description="Ajuste a busca ou ative campanhas." />
                  )}
                </DashboardPanel>
              </div>
            )}
          </div>

          {/* Collapsible Detailed Metrics Section */}
          <div className="pt-2">
            <Button 
              variant="outline" 
              className="w-full flex items-center justify-between py-5 border-border bg-card/50 rounded-2xl backdrop-blur-md"
              onClick={() => setShowDetailedMetrics(!showDetailedMetrics)}
            >
              <span className="text-sm font-semibold text-foreground">
                {showDetailedMetrics ? "Ocultar Métricas Detalhadas" : "Visualizar Todas as Métricas Detalhadas"}
              </span>
              <Settings2 className={cn("h-4 w-4 transition-transform", showDetailedMetrics ? "rotate-90" : "")} />
            </Button>
            
            {showDetailedMetrics && (
              <div className="mt-3">
                <DashboardPanel title="Leitura detalhada das metricas" subtitle="Valor atual, delta e tendencia operacional" className="p-4">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>
                            <button type="button" onClick={() => setMetricSort((current) => ({ key: "name", order: current.key === "name" && current.order === "asc" ? "desc" : "asc" }))} className="inline-flex items-center gap-2">
                              Metrica {metricSort.key === "name" ? metricSort.order === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : null}
                            </button>
                          </TableHead>
                          <TableHead>Atual</TableHead>
                          <TableHead>Periodo anterior</TableHead>
                          <TableHead>
                            <button type="button" onClick={() => setMetricSort((current) => ({ key: "delta", order: current.key === "delta" && current.order === "asc" ? "desc" : "asc" }))} className="inline-flex items-center gap-2">
                              Delta {metricSort.key === "delta" ? metricSort.order === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : null}
                            </button>
                          </TableHead>
                          <TableHead>Tendencia</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {metricsSorted.map((metric) => (
                          <TableRow key={metric.key}>
                            <TableCell>
                              <div>
                                <p className="font-semibold text-foreground">{metric.name}</p>
                                <p className="text-xs text-muted-foreground">meta {metric.target === null ? "nao definida" : formatCompact(metric.target, metric.kind)}</p>
                              </div>
                            </TableCell>
                            <TableCell className="font-semibold text-foreground">{metric.currentLabel}</TableCell>
                            <TableCell>{metric.previousLabel}</TableCell>
                            <TableCell>{metric.deltaLabel}</TableCell>
                            <TableCell>
                              <Badge className={cn("border", directionClasses(metric.direction))}>
                                {metric.direction === "up" ? "Alta" : metric.direction === "down" ? "Queda" : "Estavel"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </DashboardPanel>
              </div>
            )}
          </div>
    </>
  );
}
