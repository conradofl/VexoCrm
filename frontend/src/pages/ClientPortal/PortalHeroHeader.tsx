import React from "react";
import { Sparkles, Calendar, Target, ShieldCheck, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface PortalHeroHeaderProps {
  companyName: string;
  tagline: string;
  partnershipBadge: string;
  period: string;
  commercialGoal: string;
  whatsappSupportNumber: string;
}

export const PortalHeroHeader: React.FC<PortalHeroHeaderProps> = ({
  companyName,
  tagline,
  partnershipBadge,
  period,
  commercialGoal,
  whatsappSupportNumber,
}) => {
  const whatsappUrl = `https://wa.me/${whatsappSupportNumber.replace(/\D/g, "")}?text=${encodeURIComponent(
    `Olá equipe Geração Digital! Estou acompanhando o Portal do Cliente da ${companyName}.`
  )}`;

  return (
    <header className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white p-6 sm:p-8 md:p-10 shadow-2xl border border-indigo-800/40">
      {/* Decorative background glow */}
      <div className="absolute top-0 right-0 -mt-12 -mr-12 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-1/3 -mb-16 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div className="space-y-4 max-w-2xl">
          {/* Partnership & Security Badges */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="bg-indigo-500/15 text-indigo-300 border-indigo-400/30 font-medium py-1 px-3 text-xs flex items-center gap-1.5 backdrop-blur-sm"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
              {partnershipBadge}
            </Badge>
            <Badge
              variant="outline"
              className="bg-emerald-500/10 text-emerald-300 border-emerald-400/30 text-xs py-1 px-2.5 flex items-center gap-1"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Portal em Tempo Real
            </Badge>
          </div>

          {/* Company Title & Slogan */}
          <div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight text-white flex items-center gap-3">
              <span>{companyName}</span>
              <Sparkles className="w-6 h-6 text-amber-400 flex-shrink-0 hidden sm:inline-block" />
            </h1>
            <p className="mt-1.5 text-base sm:text-lg text-indigo-200/90 font-medium italic">
              "{tagline}"
            </p>
          </div>

          {/* Period & Commercial Goal Chips */}
          <div className="flex flex-wrap items-center gap-3 pt-1 text-xs sm:text-sm text-slate-300">
            <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 px-3 py-1.5 rounded-lg backdrop-blur-sm">
              <Calendar className="w-4 h-4 text-indigo-400" />
              <span>
                <strong className="text-white">Período:</strong> {period}
              </span>
            </div>
            <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 px-3 py-1.5 rounded-lg backdrop-blur-sm">
              <Target className="w-4 h-4 text-emerald-400" />
              <span>
                <strong className="text-white">Foco:</strong> {commercialGoal}
              </span>
            </div>
          </div>
        </div>

        {/* Quick Action Button for Mobile & Desktop */}
        <div className="flex flex-col sm:flex-row md:flex-col items-start md:items-end justify-center gap-3 flex-shrink-0">
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto"
          >
            <Button className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-lg shadow-emerald-950/40 border border-emerald-400/30 gap-2">
              <MessageCircle className="w-4 h-4" />
              <span>Falar com a Assessoria</span>
            </Button>
          </a>
          <span className="text-[11px] text-slate-400 text-center md:text-right">
            Atendimento prioritário · WhatsApp oficial
          </span>
        </div>
      </div>
    </header>
  );
};
