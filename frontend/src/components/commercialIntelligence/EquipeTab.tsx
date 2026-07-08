import type { Dispatch, SetStateAction } from "react";
import {
  Gauge,
  HandCoins,
  Plus,
  Search,
  Trash2,
  UserCog,
  Users,
} from "lucide-react";
import { KpiGrid } from "@/components/KpiGrid";
import { KpiCard } from "@/components/KpiCard";
import { DashboardPanel } from "@/components/DashboardPanel";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
  CommercialIntelligencePayload,
  CommercialIntelligenceSettings,
  ConsultantItem,
  DistributionHistoryRow,
  DistributionQueueRow,
  DistributionRuleItem,
} from "@/hooks/useCommercialIntelligence";
import {
  formatCurrency,
  formatHours,
  formatNumber,
  formatPercent,
  statusClasses,
} from "@/lib/commercialIntelligence/helpers";
import { PaginationBar } from "./PaginationBar";

interface EquipeTabProps {
  consultantSearch: string;
  setConsultantSearch: Dispatch<SetStateAction<string>>;
  consultantsFiltered: ConsultantItem[];
  pagedConsultants: { items: ConsultantItem[]; page: number; totalPages: number };
  setConsultantPage: Dispatch<SetStateAction<number>>;
  resetConsultantForm: () => void;
  setConsultantDialogOpen: Dispatch<SetStateAction<boolean>>;
  openConsultantForEdit: (consultant: ConsultantItem) => void;
  setConsultantDetail: Dispatch<SetStateAction<ConsultantItem | null>>;
  handleConsultantStatusToggle: (consultant: ConsultantItem, nextActive: boolean) => Promise<void> | void;
  handleDeleteConsultant: (consultant: ConsultantItem) => Promise<void> | void;
  consultantSummary: { active: number; available: number; revenue: number };
  consultants: ConsultantItem[];
  data: CommercialIntelligencePayload;
  settingsDraft: CommercialIntelligenceSettings;
  handleStrategyToggle: (strategy: string, enabled: boolean) => Promise<void> | void;
  distributionRules: DistributionRuleItem[];
  resetRuleForm: () => void;
  setRuleDialogOpen: Dispatch<SetStateAction<boolean>>;
  openRuleForEdit: (rule: DistributionRuleItem) => void;
  openRankingDetails: (title: string, rows: Array<{ label: string; value: string }>) => void;
  distributionQueue: DistributionQueueRow[];
  pagedQueue: { items: DistributionQueueRow[]; page: number; totalPages: number };
  setQueuePage: Dispatch<SetStateAction<number>>;
  openAssignmentDialog: (row: DistributionQueueRow) => void;
  handleAssignmentMutation: (
    payload: { id: string; action: string; consultantId?: string; reason?: string },
    successMessage: string,
  ) => Promise<void> | void;
  distributionHistory: DistributionHistoryRow[];
  pagedHistory: { items: DistributionHistoryRow[]; page: number; totalPages: number };
  setHistoryPage: Dispatch<SetStateAction<number>>;
}

export function EquipeTab({
  consultantSearch,
  setConsultantSearch,
  consultantsFiltered,
  pagedConsultants,
  setConsultantPage,
  resetConsultantForm,
  setConsultantDialogOpen,
  openConsultantForEdit,
  setConsultantDetail,
  handleConsultantStatusToggle,
  handleDeleteConsultant,
  consultantSummary,
  consultants,
  data,
  settingsDraft,
  handleStrategyToggle,
  distributionRules,
  resetRuleForm,
  setRuleDialogOpen,
  openRuleForEdit,
  openRankingDetails,
  distributionQueue,
  pagedQueue,
  setQueuePage,
  openAssignmentDialog,
  handleAssignmentMutation,
  distributionHistory,
  pagedHistory,
  setHistoryPage,
}: EquipeTabProps) {
  return (
    <>
          {/* KPI Grid for Consultants */}
          <KpiGrid cols={4} className="gap-3">
            <KpiCard title="Consultores ativos" value={formatNumber(consultantSummary.active)} icon={<Users className="h-4 w-4" />} tone="cyan" trend="elegiveis para distribuicao" />
            <KpiCard title="Disponiveis agora" value={formatNumber(consultantSummary.available)} icon={<UserCog className="h-4 w-4" />} tone="teal" trend="recebimento imediato" />
            <KpiCard title="Receita atribuida" value={formatCurrency(consultantSummary.revenue)} icon={<HandCoins className="h-4 w-4" />} tone="amber" trend="soma por consultor" />
            <KpiCard title="Capacidade media" value={consultants.length ? `${Math.round(consultants.reduce((sum, item) => sum + item.dailyCapacity, 0) / consultants.length)}` : "0"} icon={<Gauge className="h-4 w-4" />} tone="purple" trend="leads por dia" />
          </KpiGrid>

          {/* Consultant Management Section */}
          <DashboardPanel title="Gestao de consultores" subtitle="CRUD real para distribuicao, capacidade e elegibilidade regional" className="p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="relative w-full max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9" value={consultantSearch} onChange={(event) => setConsultantSearch(event.target.value)} placeholder="Buscar por nome, email ou cidade" />
              </div>
              <Button
                onClick={() => {
                  resetConsultantForm();
                  setConsultantDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
                Novo consultor
              </Button>
            </div>

            {consultantsFiltered.length ? (
              <>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {pagedConsultants.items.map((consultant) => (
                    <div 
                      key={consultant.id}
                      className="rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:shadow-md flex flex-col justify-between"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div className="h-10 w-10 rounded-full bg-cyan-500/10 text-cyan-600 dark:text-cyan-200 flex items-center justify-center font-bold text-sm">
                              {consultant.name.slice(0, 2).toUpperCase()}
                            </div>
                            <span className={cn(
                              "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white dark:border-slate-900",
                              consultant.status === "ativo" ? "bg-emerald-500" : "bg-slate-400"
                            )} />
                          </div>
                          <div>
                            <h4 className="font-semibold text-sm text-foreground">{consultant.name}</h4>
                            <p className="text-xs text-muted-foreground">{consultant.position || "Consultor"}</p>
                          </div>
                        </div>
                        <Badge className={cn("border-0 text-[10px] px-2 py-0.5", statusClasses(consultant.status))}>
                          {consultant.status}
                        </Badge>
                      </div>

                      <div className="mt-4 space-y-2 text-xs text-muted-foreground border-t border-border pt-3">
                        <div className="flex justify-between">
                          <span>Telefone:</span>
                          <span className="font-medium text-foreground">{consultant.phone || "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Email:</span>
                          <span className="font-medium text-foreground truncate max-w-[150px]">{consultant.email || "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Cidade/UF:</span>
                          <span className="font-medium text-foreground">{consultant.city || "—"} / {consultant.state || "—"}</span>
                        </div>
                        {consultant.territoryRegions.length > 0 && (
                          <div className="flex justify-between">
                            <span>Regiões:</span>
                            <span className="font-medium text-foreground truncate max-w-[150px]" title={consultant.territoryRegions.join(", ")}>
                              {consultant.territoryRegions.join(", ")}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="mt-4 grid grid-cols-3 gap-2 bg-muted/30 p-2.5 rounded-xl border border-border">
                        <div className="text-center">
                          <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Leads</p>
                          <p className="font-semibold text-[11px] text-foreground mt-0.5">{consultant.leadsReceived}/{consultant.dailyCapacity}</p>
                        </div>
                        <div className="text-center border-x border-border">
                          <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Conversão</p>
                          <p className="font-semibold text-[11px] text-foreground mt-0.5">{formatPercent(consultant.conversionRate)}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Tempo Resp</p>
                          <p className="font-semibold text-[11px] text-foreground mt-0.5">{formatHours(consultant.responseTimeHours)}</p>
                        </div>
                      </div>

                      <div className="mt-3">
                        <div className="flex justify-between text-[9px] text-muted-foreground mb-1">
                          <span>Capacidade Diária</span>
                          <span>{Math.round((consultant.leadsReceived / (consultant.dailyCapacity || 1)) * 100)}%</span>
                        </div>
                        <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-cyan-500 rounded-full" 
                            style={{ width: `${Math.min(100, (consultant.leadsReceived / (consultant.dailyCapacity || 1)) * 100)}%` }}
                          />
                        </div>
                      </div>

                      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-foreground border-t border-border pt-3">
                        <span className="text-muted-foreground">Disponível:</span>
                        <Switch 
                          checked={consultant.available} 
                          onCheckedChange={(checked) => void handleConsultantStatusToggle(consultant, checked)}
                        />
                      </div>

                      <div className="mt-4 flex gap-2 pt-2 border-t border-border">
                        <Button variant="outline" size="sm" className="flex-1 text-[11px] h-8" onClick={() => openConsultantForEdit(consultant)}>
                          Editar
                        </Button>
                        <Button variant="outline" size="sm" className="flex-1 text-[11px] h-8" onClick={() => setConsultantDetail(consultant)}>
                          Desempenho
                        </Button>
                        <Button variant="outline" size="icon" className="h-8 w-8 text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20" onClick={() => void handleDeleteConsultant(consultant)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                <PaginationBar page={pagedConsultants.page} totalPages={pagedConsultants.totalPages} onChange={setConsultantPage} />
              </>
            ) : (
              <EmptyState title="Nenhum consultor encontrado" description="Cadastre o primeiro consultor ou ajuste a busca aplicada." />
            )}
          </DashboardPanel>

          {/* Distribution Strategy selectors */}
          <DashboardPanel title="Estrategia de distribuicao de leads" subtitle="Ative a estrategia principal e acompanhe a fila em execucao" className="p-4">
            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {data.distribution.strategies.map((strategy) => {
                const active = settingsDraft.distributionStrategy === strategy.key || strategy.enabled;
                return (
                  <div key={strategy.key} className={cn("rounded-[1.35rem] border p-4 transition-colors", active ? "border-cyan-500/30 bg-cyan-500/5 text-cyan-600 dark:text-cyan-300" : "border-border bg-card text-foreground")}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{strategy.label}</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{strategy.description}</p>
                      </div>
                      <Switch checked={active} onCheckedChange={(checked) => void handleStrategyToggle(strategy.key, checked)} />
                    </div>
                    <div className="mt-3">
                      <Badge className={cn("border-0", active ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200" : "bg-slate-500/10 text-slate-700 dark:text-slate-200")}>
                        {active ? "Estrategia ativa" : "Pronta para ativacao"}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </DashboardPanel>

          {/* Regras de prioridade */}
          <DashboardPanel title="Regras de prioridade de Leads" subtitle="Cidade, regiao, valor potencial, tipo de lead e SLA com persistencia real" className="p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">Ajuste criterios para rodizio, peso por performance ou distribuicao hibrida.</p>
              <Button onClick={() => { resetRuleForm(); setRuleDialogOpen(true); }}>
                <Plus className="h-4 w-4" />
                Nova regra
              </Button>
            </div>
            {distributionRules.length ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Regra</TableHead>
                      <TableHead>Modo</TableHead>
                      <TableHead>Prioridades</TableHead>
                      <TableHead>SLA</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Acoes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {distributionRules.map((rule) => (
                      <TableRow key={rule.id}>
                        <TableCell>
                          <div>
                            <p className="font-semibold text-foreground">{rule.name}</p>
                            <p className="text-xs text-muted-foreground">cap {rule.maxOpenLeadsPerConsultant} • fairness {rule.fairnessFloor}</p>
                          </div>
                        </TableCell>
                        <TableCell>{rule.distributionMode}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {[rule.prioritizeRegion && "regiao", rule.prioritizeContractValue && "valor", rule.prioritizeLeadType && "tipo"].filter(Boolean).join(" • ") || "padrao"}
                        </TableCell>
                        <TableCell>{rule.reassignAfterMinutes} min</TableCell>
                        <TableCell>
                          <Badge className={cn("border-0", rule.active ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200" : "bg-slate-500/10 text-slate-700 dark:text-slate-200")}>
                            {rule.active ? "Ativa" : "Pausada"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" onClick={() => openRuleForEdit(rule)}>
                              Editar
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                openRankingDetails(rule.name, [
                                  { label: "Modo", value: rule.distributionMode },
                                  { label: "Prioriza regiao", value: rule.prioritizeRegion ? "Sim" : "Nao" },
                                  { label: "Prioriza valor", value: rule.prioritizeContractValue ? "Sim" : "Nao" },
                                  { label: "Prioriza tipo", value: rule.prioritizeLeadType ? "Sim" : "Nao" },
                                  { label: "Reatribui em", value: `${rule.reassignAfterMinutes} min` },
                                ])
                              }
                            >
                              Detalhar
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptyState title="Nenhuma regra cadastrada" description="Crie regras reais para priorizar regiao, valor potencial e SLA de resposta." />
            )}
          </DashboardPanel>

          {/* Fila atual de distribuicao */}
          <DashboardPanel title="Fila atual de distribuicao" subtitle="Reatribua, trave, libere ou envie manualmente lead a lead" className="p-4">
            {distributionQueue.length ? (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Lead</TableHead>
                        <TableHead>Campanha</TableHead>
                        <TableHead>Cidade</TableHead>
                        <TableHead>Valor Potencial</TableHead>
                        <TableHead>Consultor Vinculado</TableHead>
                        <TableHead>Regra Aplicada</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>SLA</TableHead>
                        <TableHead>Acoes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedQueue.items.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>
                            <div>
                              <p className="font-semibold text-foreground">{row.leadName}</p>
                              <p className="text-xs text-muted-foreground">recebido em {new Date(row.receivedAt).toLocaleString("pt-BR")}</p>
                            </div>
                          </TableCell>
                          <TableCell>{row.campaignName}</TableCell>
                          <TableCell>{row.city}</TableCell>
                          <TableCell className="font-semibold">{formatCurrency(row.potentialValue)}</TableCell>
                          <TableCell>{row.consultantName || "—"}</TableCell>
                          <TableCell>{row.ruleApplied}</TableCell>
                          <TableCell>
                            <Badge className={cn("border-0", row.status === "atribuido" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200" : "bg-amber-500/10 text-amber-700 dark:text-amber-200")}>
                              {row.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className={cn("border-0", row.slaStatus === "no_prazo" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200" : "bg-rose-500/10 text-rose-700 dark:text-rose-200")}>
                              {row.slaStatus === "no_prazo" ? "No prazo" : "Atrasado"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-2">
                              <Button variant="outline" size="sm" onClick={() => openAssignmentDialog(row)}>Reatribuir</Button>
                              <Button variant="outline" size="sm" onClick={() => void handleAssignmentMutation({ id: row.id, action: "aprovar" }, "Lead aprovado na fila.")}>Aprovar</Button>
                              <Button variant="outline" size="sm" onClick={() => void handleAssignmentMutation({ id: row.id, action: "rejeitar" }, "Lead rejeitado na fila.")}>Rejeitar</Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <PaginationBar page={pagedQueue.page} totalPages={pagedQueue.totalPages} onChange={setQueuePage} />
              </>
            ) : (
              <EmptyState title="Fila vazia" description="Nenhuma atribuicao esta pendente ou em execucao agora." />
            )}
          </DashboardPanel>

          {/* Historico de atribuicoes */}
          <DashboardPanel title="Historico de atribuicoes" subtitle="Rastreabilidade de reatribuicoes manuais e automaticas" className="p-4">
            {distributionHistory.length ? (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data e hora</TableHead>
                        <TableHead>Lead</TableHead>
                        <TableHead>Consultor anterior</TableHead>
                        <TableHead>Consultor atual</TableHead>
                        <TableHead>Motivo</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Responsavel</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedHistory.items.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{row.dateTime ? new Date(row.dateTime).toLocaleString("pt-BR") : "—"}</TableCell>
                          <TableCell>{row.leadName}</TableCell>
                          <TableCell>{row.previousConsultant}</TableCell>
                          <TableCell>{row.currentConsultant}</TableCell>
                          <TableCell>{row.reason}</TableCell>
                          <TableCell>{row.distributionType}</TableCell>
                          <TableCell>{row.responsible}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <PaginationBar page={pagedHistory.page} totalPages={pagedHistory.totalPages} onChange={setHistoryPage} />
              </>
            ) : (
              <EmptyState title="Sem historico recente" description="A trilha de atribuicoes vai aparecer assim que o sistema distribuir ou reatribuir leads." />
            )}
          </DashboardPanel>
    </>
  );
}
