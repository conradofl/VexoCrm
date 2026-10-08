// frontend/src/components/dashboard/SmartLinkEngagementCard.tsx
// Card de Engajamento de Smart Links & Cliques em Tempo Real no Dashboard do Vexo OS

import React from "react";
import {
  Flame,
  MousePointerClick,
  Users,
  Clock,
  ExternalLink,
  MessageCircle,
  Sparkles,
  Link2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSmartLinkMetrics, type SmartLinkMetrics, type SmartLinkTopLead } from "@/hooks/useSmartLinks";

interface SmartLinkEngagementCardProps {
  clientId: string;
  periodDays?: number;
  campaignId?: string | null;
}

function formatPhoneDisplay(rawPhone?: string | null): string {
  if (!rawPhone) return "";
  const cleaned = rawPhone.replace(/\D/g, "");
  const local = cleaned.startsWith("55") && cleaned.length >= 12 ? cleaned.slice(2) : cleaned;
  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  if (local.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  return rawPhone;
}

function formatCleanWhatsAppPhone(rawPhone?: string | null): string {
  if (!rawPhone) return "";
  const digits = rawPhone.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return digits;
}

function getInitials(name?: string | null): string {
  if (!name) return "LD";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "LD";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function SmartLinkEngagementCard({
  clientId,
  periodDays = 30,
  campaignId = null,
}: SmartLinkEngagementCardProps) {
  const { data: metrics, isLoading, error } = useSmartLinkMetrics(clientId, periodDays, campaignId);

  if (isLoading && !metrics) {
    return (
      <Card className="border border-border/60 shadow-sm overflow-hidden bg-card">
        <CardHeader className="pb-3 border-b border-border/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-5 rounded-full" />
              <Skeleton className="h-5 w-48" />
            </div>
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
          <Skeleton className="h-4 w-72 mt-1" />
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
          <div className="space-y-2 pt-2">
            <Skeleton className="h-12 w-full rounded-md" />
            <Skeleton className="h-12 w-full rounded-md" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return null; // Falha silenciosa para não degradar o restante do Dashboard
  }

  const totalLinks = metrics?.totalLinks ?? 0;
  const totalClicks = metrics?.totalClicks ?? 0;
  const uniqueLeadsClicked = metrics?.uniqueLeadsClicked ?? 0;
  const ctr = metrics?.ctr ?? 0;
  const clicksLast24h = metrics?.clicksLast24h ?? 0;
  const topLeads = metrics?.topLeads ?? [];

  return (
    <Card className="border border-border/70 shadow-sm overflow-hidden bg-gradient-to-b from-card via-card to-card/90">
      {/* ─── Cabeçalho do Card ─── */}
      <CardHeader className="pb-4 border-b border-border/40">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20">
              <Flame className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold tracking-tight text-foreground flex items-center gap-2">
                Engajamento de Links & Cliques
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-0.5">
                Rastreamento individualizado por lead com alertas em tempo real
              </CardDescription>
            </div>
          </div>

          {/* Badge Animada de Tempo Real */}
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[11px] font-medium py-0.5 px-2.5 flex items-center gap-1.5"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              Tempo Real
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-5">
        {/* ─── Métricas em Grid de 3 Colunas ─── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Card 1: Total de Cliques */}
          <div className="rounded-xl border border-border/50 bg-muted/20 p-3.5 flex flex-col justify-between">
            <div className="flex items-center justify-between text-muted-foreground mb-1.5">
              <span className="text-xs font-medium">Total de Cliques</span>
              <MousePointerClick className="h-4 w-4 text-muted-foreground/80" />
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold font-mono tracking-tight text-foreground">
              {totalClicks.toLocaleString("pt-BR")}
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">
              {totalLinks} {totalLinks === 1 ? "link gerado" : "links gerados"}
            </div>
          </div>

          {/* Card 2: Leads Únicos / CTR */}
          <div className="rounded-xl border border-border/50 bg-muted/20 p-3.5 flex flex-col justify-between">
            <div className="flex items-center justify-between text-muted-foreground mb-1.5">
              <span className="text-xs font-medium">Leads Únicos / CTR</span>
              <Users className="h-4 w-4 text-muted-foreground/80" />
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold font-mono tracking-tight text-foreground">
              {uniqueLeadsClicked}{" "}
              <span className="text-xs sm:text-sm font-sans font-semibold text-emerald-600 dark:text-emerald-400 ml-1">
                ({ctr.toFixed(1)}%)
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">
              Taxa de conversão de cliques
            </div>
          </div>

          {/* Card 3: Últimas 24 Horas */}
          <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-3.5 flex flex-col justify-between">
            <div className="flex items-center justify-between text-orange-600 dark:text-orange-400 mb-1.5">
              <span className="text-xs font-semibold">Últimas 24h</span>
              <Clock className="h-4 w-4 text-orange-500" />
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold font-mono tracking-tight text-orange-600 dark:text-orange-400">
              {clicksLast24h.toLocaleString("pt-BR")}
            </div>
            <div className="text-[11px] text-orange-600/80 dark:text-orange-400/80 mt-1">
              Aberturas recentes
            </div>
          </div>
        </div>

        {/* ─── Lista dos Leads Mais Quentes OU Empty State ─── */}
        {totalLinks === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 bg-muted/10 p-6 text-center space-y-3">
            <div className="mx-auto w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Link2 className="h-5 w-5" />
            </div>
            <div className="max-w-md mx-auto space-y-1">
              <h4 className="text-sm font-semibold text-foreground">
                Nenhum link rastreado no período
              </h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Ao disparar campanhas com links, o Vexo OS converte URLs automaticamente em links individuais e rastreia cada abertura por lead com alertas em tempo real.
              </p>
            </div>
          </div>
        ) : topLeads.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 bg-muted/10 p-5 text-center space-y-2">
            <p className="text-xs text-muted-foreground">
              {totalLinks} {totalLinks === 1 ? "link disparado" : "links disparados"}, mas ainda sem nenhum clique registrado no período selecionado.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between px-0.5">
              <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Flame className="h-3.5 w-3.5 text-orange-500" />
                Leads Mais Quentes
              </h4>
              <span className="text-[11px] text-muted-foreground">
                Top {topLeads.length} por aberturas
              </span>
            </div>

            <div className="divide-y divide-border/40 rounded-xl border border-border/50 bg-card overflow-hidden">
              {topLeads.map((lead: SmartLinkTopLead, idx: number) => {
                const cleanPhone = formatCleanWhatsAppPhone(lead.leadTelefone);
                const isHighEngagement = lead.clicksCount > 2;

                return (
                  <div
                    key={`${lead.leadId || idx}-${lead.linkCode}`}
                    className="p-3 sm:px-4 flex items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
                  >
                    {/* Lado Esquerdo: Avatar + Dados do Lead */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center shrink-0 border border-primary/20">
                        {getInitials(lead.leadNome)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-foreground truncate max-w-[150px] sm:max-w-[240px]">
                            {lead.leadNome}
                          </span>
                          {lead.campaignName && (
                            <Badge
                              variant="secondary"
                              className="text-[10px] py-0 px-1.5 h-4 truncate max-w-[120px] hidden sm:inline-flex"
                            >
                              {lead.campaignName}
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                          <span>{formatPhoneDisplay(lead.leadTelefone) || "Sem telefone"}</span>
                          {lead.linkTitle && (
                            <>
                              <span>·</span>
                              <span className="truncate max-w-[140px] text-[11px]">
                                {lead.linkTitle}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Lado Direito: Badge de Cliques + Botão de WhatsApp */}
                    <div className="flex items-center gap-2.5 shrink-0">
                      <Badge
                        variant="outline"
                        className={`text-xs font-semibold py-0.5 px-2 ${
                          isHighEngagement
                            ? "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30"
                            : "bg-muted/40 text-muted-foreground border-border/60"
                        }`}
                      >
                        {lead.clicksCount} {lead.clicksCount === 1 ? "clique" : "cliques"}
                      </Badge>

                      {cleanPhone ? (
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 w-8 p-0 rounded-full text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 border-emerald-500/30"
                                onClick={() => {
                                  window.open(
                                    `https://wa.me/${cleanPhone}`,
                                    "_blank",
                                    "noopener,noreferrer"
                                  );
                                }}
                                aria-label={`Conversar no WhatsApp com ${lead.leadNome}`}
                              >
                                <MessageCircle className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="text-xs">
                              Conversar no WhatsApp ({formatPhoneDisplay(lead.leadTelefone)})
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
export default SmartLinkEngagementCard;
