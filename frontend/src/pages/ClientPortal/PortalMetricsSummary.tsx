import React from "react";
import { TrendingUp, CalendarCheck2, MessageCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface PortalMetricsSummaryProps {
  trafficStatus: {
    status: string;
    budget: string;
    activeCampaigns: number;
  };
  weeklyPacing: {
    delivered: number;
    target: number;
  };
  whatsappSupportNumber: string;
  companyName: string;
}

export const PortalMetricsSummary: React.FC<PortalMetricsSummaryProps> = ({
  trafficStatus,
  weeklyPacing,
  whatsappSupportNumber,
  companyName,
}) => {
  const pacingPercent =
    weeklyPacing.target > 0
      ? Math.round((weeklyPacing.delivered / weeklyPacing.target) * 100)
      : 0;

  const whatsappUrl = `https://wa.me/${whatsappSupportNumber.replace(/\D/g, "")}?text=${encodeURIComponent(
    `Olá equipe Geração Digital! Gostaria de tirar uma dúvida sobre o plano da ${companyName}.`
  )}`;

  return (
    <footer className="space-y-4 pt-6 border-t border-slate-800">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 1. Campanhas de Tráfego */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2 text-indigo-400">
              <TrendingUp className="w-5 h-5" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Mídia Paga & Tráfego
              </h3>
            </div>
            <p className="text-base font-extrabold text-white mt-1">
              {trafficStatus.status}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Investimento em anúncios: <strong className="text-slate-200">{trafficStatus.budget}</strong>
            </p>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
            <span>Campanhas no Ar:</span>
            <span className="font-bold text-emerald-400">
              {trafficStatus.activeCampaigns} conjuntos ativos
            </span>
          </div>
        </div>

        {/* 2. Ritmo de Postagens da Semana */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2 text-sky-400">
              <CalendarCheck2 className="w-5 h-5" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Ritmo da Semana
              </h3>
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-2xl font-black text-white">
                {weeklyPacing.delivered}{" "}
                <span className="text-sm font-medium text-slate-400">
                  / {weeklyPacing.target} entregas
                </span>
              </span>
              <span className="text-xs font-bold text-emerald-400">
                {pacingPercent}% da meta
              </span>
            </div>
            <Progress value={pacingPercent} className="h-2 bg-slate-800 mt-2.5" />
          </div>
          <div className="mt-3 pt-3 border-t border-slate-800/80 text-[11px] text-slate-400">
            Cronograma mantido rigorosamente dentro do prazo acordado.
          </div>
        </div>

        {/* 3. Atendimento Direto via WhatsApp */}
        <div className="bg-gradient-to-br from-indigo-950/40 via-slate-900 to-slate-900 border border-indigo-800/40 rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2 text-emerald-400">
              <MessageCircle className="w-5 h-5" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Canal de Atendimento
              </h3>
            </div>
            <p className="text-xs text-slate-300 mt-1 leading-relaxed">
              Dúvidas, solicitações ou alinhamentos de pautas diretamente com nossa assessoria executiva.
            </p>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-800/80">
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full inline-block"
            >
              <Button
                size="sm"
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs gap-1.5 shadow-md"
              >
                <span>Falar no WhatsApp da Assessoria</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </Button>
            </a>
          </div>
        </div>
      </div>

      <div className="text-center py-4 text-xs text-slate-500">
        Plataforma desenvolvida por <strong>Vexo OS</strong> · Todos os direitos reservados à {companyName}.
      </div>
    </footer>
  );
};
