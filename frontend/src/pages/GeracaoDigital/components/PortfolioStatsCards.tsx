import React from "react";
import { Users, Clock, AlertTriangle, CheckCircle2, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface PortfolioStatsCardsProps {
  totalClients: number;
  activeDemands: number;
  overdueDemands: number;
  slaPercent: number;
}

export function PortfolioStatsCards({
  totalClients,
  activeDemands,
  overdueDemands,
  slaPercent,
}: PortfolioStatsCardsProps) {
  const cards = [
    {
      label: "Clientes Ativos",
      value: totalClients,
      caption: "Carteira com contratos em esteira",
      icon: Users,
      iconColor: "text-purple-600 dark:text-purple-400",
      iconBg: "bg-purple-100 dark:bg-purple-950/50 border border-purple-200 dark:border-purple-800/40",
    },
    {
      label: "Demandas em Andamento",
      value: activeDemands,
      caption: "Tarefas ativas no Trello e produção",
      icon: Clock,
      iconColor: "text-blue-600 dark:text-blue-400",
      iconBg: "bg-blue-100 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800/40",
    },
    {
      label: "Demandas Atrasadas",
      value: overdueDemands,
      caption: overdueDemands > 0 ? "Exigem intervenção imediata do Maestro" : "Nenhum gargalo travado hoje",
      icon: AlertTriangle,
      iconColor: overdueDemands > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400",
      iconBg: overdueDemands > 0
        ? "bg-rose-100 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/40"
        : "bg-emerald-100 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/40",
      isWarning: overdueDemands > 0,
    },
    {
      label: "SLA da Semana",
      value: `${slaPercent}%`,
      caption: "Taxa de entregas no prazo acordado",
      icon: CheckCircle2,
      iconColor: "text-emerald-600 dark:text-emerald-400",
      iconBg: "bg-emerald-100 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/40",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((c, i) => {
        const Icon = c.icon;
        return (
          <Card
            key={i}
            className={cn(
              "border shadow-2xs transition-all duration-200",
              c.isWarning
                ? "bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/40"
                : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
            )}
          >
            <CardContent className="p-5 flex items-start gap-4">
              <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center shrink-0", c.iconBg)}>
                <Icon className={cn("w-5 h-5", c.iconColor)} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {c.label}
                </p>
                <p
                  className={cn(
                    "text-2xl md:text-3xl font-black tracking-tight leading-tight mt-0.5",
                    c.isWarning ? "text-rose-700 dark:text-rose-400" : "text-slate-900 dark:text-white"
                  )}
                >
                  {c.value}
                </p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">
                  {c.caption}
                </p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
