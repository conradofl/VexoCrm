import React, { useState, type ComponentType } from "react";
import {
  Snowflake,
  MessageCircle,
  FileText,
  Trophy,
  XCircle,
  ArrowRight,
  Loader2,
  CheckCircle2,
  ChevronRight,
  MoreHorizontal,
  Flame,
  Sun,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { StalledLeadBadge } from "@/components/leads/StalledLeadBadge";
import { cn } from "@/lib/utils";
import type { LeadIntelligenceItem } from "@/pages/BancoDeDados";

export interface LeadsKanbanViewProps {
  leads: LeadIntelligenceItem[];
  loading?: boolean;
  ticketMedio: number | null;
  onUpdateStage: (leadId: string, newStage: string, lostReason?: string | null) => Promise<void>;
  onOpenWhatsapp: (phone: string) => void;
}

export type CanonicalStage = "cold" | "inquiry" | "open_budget" | "buyer" | "lost";

export interface FunnelColumnConfig {
  id: CanonicalStage;
  title: string;
  shortTitle: string;
  icon: ComponentType<{ className?: string }>;
  headerBg: string;
  headerBorder: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  columnBg: string;
}

export const FUNNEL_COLUMNS: FunnelColumnConfig[] = [
  {
    id: "cold",
    title: "Primeiro Contato",
    shortTitle: "Novos",
    icon: Snowflake,
    headerBg: "bg-slate-100/80 dark:bg-slate-800/60",
    headerBorder: "border-slate-200 dark:border-slate-700",
    badgeBg: "bg-slate-200/70 dark:bg-slate-700/60",
    badgeText: "text-slate-800 dark:text-slate-200",
    badgeBorder: "border-slate-300 dark:border-slate-600",
    columnBg: "bg-slate-50/50 dark:bg-slate-900/30",
  },
  {
    id: "inquiry",
    title: "Em Atendimento",
    shortTitle: "Qualificação",
    icon: MessageCircle,
    headerBg: "bg-blue-100/70 dark:bg-blue-950/50",
    headerBorder: "border-blue-200 dark:border-blue-800/60",
    badgeBg: "bg-blue-200/70 dark:bg-blue-900/60",
    badgeText: "text-blue-800 dark:text-blue-200",
    badgeBorder: "border-blue-300 dark:border-blue-700",
    columnBg: "bg-blue-50/30 dark:bg-blue-950/20",
  },
  {
    id: "open_budget",
    title: "Proposta / Orçamento",
    shortTitle: "Negociação",
    icon: FileText,
    headerBg: "bg-amber-100/70 dark:bg-amber-950/50",
    headerBorder: "border-amber-200 dark:border-amber-800/60",
    badgeBg: "bg-amber-200/70 dark:bg-amber-900/60",
    badgeText: "text-amber-800 dark:text-amber-200",
    badgeBorder: "border-amber-300 dark:border-amber-700",
    columnBg: "bg-amber-50/30 dark:bg-amber-950/20",
  },
  {
    id: "buyer",
    title: "Venda Fechada",
    shortTitle: "Comprador",
    icon: Trophy,
    headerBg: "bg-emerald-100/70 dark:bg-emerald-950/50",
    headerBorder: "border-emerald-200 dark:border-emerald-800/60",
    badgeBg: "bg-emerald-200/70 dark:bg-emerald-900/60",
    badgeText: "text-emerald-800 dark:text-emerald-200",
    badgeBorder: "border-emerald-300 dark:border-emerald-700",
    columnBg: "bg-emerald-50/30 dark:bg-emerald-950/20",
  },
  {
    id: "lost",
    title: "Não Convertido",
    shortTitle: "Perdido",
    icon: XCircle,
    headerBg: "bg-rose-100/70 dark:bg-rose-950/50",
    headerBorder: "border-rose-200 dark:border-rose-800/60",
    badgeBg: "bg-rose-200/70 dark:bg-rose-900/60",
    badgeText: "text-rose-800 dark:text-rose-200",
    badgeBorder: "border-rose-300 dark:border-rose-700",
    columnBg: "bg-rose-50/30 dark:bg-rose-950/20",
  },
];

const NEXT_STAGE_MAP: Record<CanonicalStage, CanonicalStage | null> = {
  cold: "inquiry",
  inquiry: "open_budget",
  open_budget: "buyer",
  buyer: null,
  lost: "inquiry",
};

export function canonicalizeLeadStage(stage?: string | null): CanonicalStage {
  const k = String(stage || "").trim().toLowerCase();
  if (k === "inquiry" || k === "em_atendimento" || k === "atendimento" || k === "duvida") return "inquiry";
  if (
    k === "open_budget" ||
    k === "qualificado" ||
    k === "orcamento" ||
    k === "orcamentos" ||
    k === "proposta" ||
    k === "propostas"
  ) {
    return "open_budget";
  }
  if (k === "buyer" || k === "fechado" || k === "comprador" || k === "won" || k === "venda" || k === "cliente") {
    return "buyer";
  }
  if (k === "lost" || k === "perdido" || k === "cancelado" || k === "perdidos") return "lost";
  return "cold";
}

function formatPhoneDisplay(rawPhone?: string | null): string {
  if (!rawPhone) return "";
  const d = String(rawPhone).replace(/\D/g, "");
  const num = d.startsWith("55") && d.length > 11 ? d.slice(2) : d;
  if (num.length === 11) {
    return `(${num.slice(0, 2)}) ${num.slice(2, 7)}-${num.slice(7)}`;
  }
  if (num.length === 10) {
    return `(${num.slice(0, 2)}) ${num.slice(2, 6)}-${num.slice(6)}`;
  }
  return rawPhone;
}

function formatCurrency(val: number): string {
  return val.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

const STANDARD_LOST_REASONS = [
  { id: "preco", label: "Preço elevado / fora do orçamento" },
  { id: "concorrente", label: "Fechou com concorrente" },
  { id: "sem_contato", label: "Sem resposta / sumiu" },
  { id: "perfil", label: "Não era o perfil do produto" },
  { id: "prazo", label: "Prazo de atendimento incompatível" },
  { id: "outro", label: "Outro motivo" },
];

export function LeadsKanbanView({
  leads,
  loading = false,
  ticketMedio,
  onUpdateStage,
  onOpenWhatsapp,
}: LeadsKanbanViewProps) {
  const [updatingLeadId, setUpdatingLeadId] = useState<string | null>(null);
  const [lostModalLeadId, setLostModalLeadId] = useState<string | null>(null);
  const [selectedLostReason, setSelectedLostReason] = useState<string>("preco");

  const handleAdvance = async (lead: LeadIntelligenceItem) => {
    const currentCanonical = canonicalizeLeadStage(lead.stage);
    const next = NEXT_STAGE_MAP[currentCanonical];
    if (!next) return;
    try {
      setUpdatingLeadId(lead.id);
      await onUpdateStage(lead.id, next);
    } finally {
      setUpdatingLeadId(null);
    }
  };

  const handleDirectWon = async (lead: LeadIntelligenceItem) => {
    try {
      setUpdatingLeadId(lead.id);
      await onUpdateStage(lead.id, "buyer");
    } finally {
      setUpdatingLeadId(null);
    }
  };

  const handleDirectMove = async (leadId: string, stage: CanonicalStage) => {
    if (stage === "lost") {
      setLostModalLeadId(leadId);
      return;
    }
    try {
      setUpdatingLeadId(leadId);
      await onUpdateStage(leadId, stage);
    } finally {
      setUpdatingLeadId(null);
    }
  };

  const handleConfirmLost = async () => {
    if (!lostModalLeadId) return;
    try {
      setUpdatingLeadId(lostModalLeadId);
      await onUpdateStage(lostModalLeadId, "lost", selectedLostReason);
    } finally {
      setUpdatingLeadId(null);
      setLostModalLeadId(null);
    }
  };

  return (
    <div className="w-full space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3.5 items-start">
        {FUNNEL_COLUMNS.map((col) => {
          const colLeads = leads.filter((l) => canonicalizeLeadStage(l.stage) === col.id);
          const leadsCount = colLeads.length;
          const subtotalFinanceiro = leadsCount * (ticketMedio || 0);
          const ColIcon = col.icon;

          return (
            <div
              key={col.id}
              data-testid={`kanban-column-${col.id}`}
              className={cn(
                "rounded-xl border border-slate-200 dark:border-slate-800/80 p-2.5 flex flex-col min-h-[500px]",
                col.columnBg
              )}
            >
              {/* Cabeçalho da Coluna */}
              <div
                className={cn(
                  "flex flex-col gap-1.5 p-2.5 rounded-lg border mb-2.5 shadow-2xs",
                  col.headerBg,
                  col.headerBorder
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-bold text-xs text-foreground">
                    <ColIcon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{col.title}</span>
                  </div>
                  <Badge
                    variant="outline"
                    data-testid={`column-count-${col.id}`}
                    className={cn(
                      "text-[10px] font-bold px-1.5 py-0 h-4 min-w-4 justify-center",
                      col.badgeBg,
                      col.badgeText,
                      col.badgeBorder
                    )}
                  >
                    {leadsCount}
                  </Badge>
                </div>

                {/* Subtotal financeiro estimado */}
                <div
                  data-testid={`column-subtotal-${col.id}`}
                  className="text-[11px] font-semibold text-muted-foreground flex items-center justify-between"
                >
                  <span className="text-[10px] uppercase tracking-wide opacity-80">Volume est.:</span>
                  <span className="font-mono text-foreground font-bold">
                    {ticketMedio && ticketMedio > 0 ? formatCurrency(subtotalFinanceiro) : "R$ 0"}
                  </span>
                </div>
              </div>

              {/* Área dos Cards */}
              <div className="flex-1 space-y-2.5 overflow-y-auto max-h-[calc(100vh-280px)] pr-0.5">
                {colLeads.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground/70 border border-dashed border-border/50 rounded-lg p-4">
                    Nenhum lead nesta etapa
                  </div>
                ) : (
                  colLeads.map((lead) => {
                    const phoneToDisplay = formatPhoneDisplay(lead.phone || lead.telefone);
                    const rawPhone = lead.phone || lead.telefone || "";
                    const isUpdating = updatingLeadId === lead.id;
                    const leadTemp = String(lead.temperature || "").toLowerCase();
                    const originLabel = lead.campaign_name || lead.origem || lead.utm_source;

                    return (
                      <div
                        key={lead.id}
                        data-testid={`kanban-card-${lead.id}`}
                        className={cn(
                          "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-2xs hover:shadow-xs transition-all relative flex flex-col gap-2.5 text-xs",
                          isUpdating && "opacity-60 pointer-events-none"
                        )}
                      >
                        {/* Topo do Card: Nome e Telefone */}
                        <div className="flex items-start justify-between gap-1.5">
                          <div className="min-w-0 flex-1">
                            <p
                              className="font-bold text-foreground text-xs truncate"
                              title={lead.nome || "Lead sem nome"}
                            >
                              {lead.nome || "Lead sem nome"}
                            </p>
                            <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
                              {phoneToDisplay || "Sem telefone"}
                            </p>
                          </div>

                          {/* Menu de Estágios Rápido */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground shrink-0"
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44 text-xs">
                              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                Mover para:
                              </div>
                              {FUNNEL_COLUMNS.map((fCol) => (
                                <DropdownMenuItem
                                  key={fCol.id}
                                  disabled={fCol.id === col.id}
                                  onClick={() => handleDirectMove(lead.id, fCol.id)}
                                  className="text-xs gap-1.5 cursor-pointer"
                                >
                                  <fCol.icon className="h-3 w-3" />
                                  <span>{fCol.title}</span>
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>

                        {/* Metadados: Temperatura, Lead Parado, Origem, Tags */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          {/* Badge de Temperatura */}
                          {leadTemp === "hot" || leadTemp === "quente" ? (
                            <Badge
                              variant="outline"
                              data-testid={`badge-temp-${lead.id}`}
                              className="bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30 text-[10px] px-1.5 py-0 font-medium gap-0.5"
                            >
                              <span>🔥</span>
                              <span>Quente</span>
                            </Badge>
                          ) : leadTemp === "warm" || leadTemp === "morno" ? (
                            <Badge
                              variant="outline"
                              data-testid={`badge-temp-${lead.id}`}
                              className="bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30 text-[10px] px-1.5 py-0 font-medium gap-0.5"
                            >
                              <span>🌤️</span>
                              <span>Morno</span>
                            </Badge>
                          ) : leadTemp === "cold" || leadTemp === "frio" ? (
                            <Badge
                              variant="outline"
                              data-testid={`badge-temp-${lead.id}`}
                              className="bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30 text-[10px] px-1.5 py-0 font-medium gap-0.5"
                            >
                              <span>❄️</span>
                              <span>Frio</span>
                            </Badge>
                          ) : null}

                          {/* Aviso de Lead Parado */}
                          <StalledLeadBadge lead={lead} minDays={2} />

                          {/* Origem / Campanha */}
                          {originLabel && (
                            <Badge
                              variant="outline"
                              className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 text-[10px] px-1.5 py-0 truncate max-w-[130px]"
                              title={originLabel}
                            >
                              {originLabel}
                            </Badge>
                          )}
                        </div>

                        {/* Tags */}
                        {Array.isArray(lead.tags) && lead.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {lead.tags.slice(0, 3).map((tag) => (
                              <span
                                key={tag}
                                className="inline-flex items-center text-[10px] bg-slate-100 dark:bg-slate-800/80 text-muted-foreground px-1.5 py-0.2 rounded border border-border/50 truncate max-w-[100px]"
                              >
                                #{tag}
                              </span>
                            ))}
                            {lead.tags.length > 3 && (
                              <span className="text-[10px] text-muted-foreground">
                                +{lead.tags.length - 3}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Rodapé de Ações do Card */}
                        <div className="pt-2 border-t border-border/60 flex items-center justify-between gap-1 mt-auto">
                          {/* Botão de WhatsApp */}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onOpenWhatsapp(rawPhone)}
                            className="h-6 text-[10px] px-2 gap-1 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border-emerald-500/30 font-medium"
                          >
                            <MessageCircle className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                            WhatsApp
                          </Button>

                          {/* Botões de Ação de Etapa */}
                          <div className="flex items-center gap-1">
                            {col.id !== "buyer" && col.id !== "lost" && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                title="Marcar como Venda Fechada"
                                onClick={() => handleDirectWon(lead)}
                                className="h-6 px-1.5 text-[10px] text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 font-semibold gap-0.5"
                              >
                                🏆 Ganho
                              </Button>
                            )}

                            {col.id !== "buyer" && NEXT_STAGE_MAP[col.id] && (
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                title="Avançar para a próxima etapa"
                                onClick={() => handleAdvance(lead)}
                                className="h-6 px-1.5 text-[10px] font-semibold gap-1"
                              >
                                Avançar
                                <ArrowRight className="w-2.5 h-2.5" />
                              </Button>
                            )}

                            {col.id !== "lost" && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                title="Marcar como Perdido"
                                onClick={() => setLostModalLeadId(lead.id)}
                                className="h-6 px-1.5 text-[10px] text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                              >
                                Perda
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Indicador de carregamento no card */}
                        {isUpdating && (
                          <div className="absolute inset-0 bg-background/50 backdrop-blur-2xs rounded-xl flex items-center justify-center">
                            <Loader2 className="w-4 h-4 animate-spin text-primary" />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal de Motivo da Perda */}
      <Dialog open={!!lostModalLeadId} onOpenChange={(open) => !open && setLostModalLeadId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-600">
              <XCircle className="w-5 h-5" />
              Motivo da Perda
            </DialogTitle>
            <DialogDescription>
              Selecione o principal motivo pelo qual esta oportunidade não foi convertida.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            {STANDARD_LOST_REASONS.map((reason) => (
              <label
                key={reason.id}
                className={cn(
                  "flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors text-xs font-medium",
                  selectedLostReason === reason.id
                    ? "border-rose-500/60 bg-rose-50/50 dark:bg-rose-950/30 text-rose-900 dark:text-rose-200"
                    : "border-border hover:bg-muted/40 text-foreground"
                )}
              >
                <input
                  type="radio"
                  name="lost_reason"
                  value={reason.id}
                  checked={selectedLostReason === reason.id}
                  onChange={() => setSelectedLostReason(reason.id)}
                  className="text-rose-600 focus:ring-rose-500"
                />
                <span>{reason.label}</span>
              </label>
            ))}
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLostModalLeadId(null)}
              disabled={!!updatingLeadId}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleConfirmLost}
              disabled={!!updatingLeadId}
              className="gap-1.5"
            >
              {updatingLeadId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
              Confirmar Não Conversão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
