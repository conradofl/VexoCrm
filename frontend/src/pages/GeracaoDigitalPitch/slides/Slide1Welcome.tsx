import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getInitials } from "@/lib/geracaoDigital/helpers";
import type { CustomTheme } from "@/lib/geracaoDigital/types";

// Extraído de src/pages/GeracaoDigitalPitch.tsx (Onda 4 Run F5) — Slide 1 (capa de boas-vindas), movimento puro.
interface Slide1WelcomeProps {
  theme: CustomTheme;
  onNext: () => void;
}

export function Slide1Welcome({ theme, onNext }: Slide1WelcomeProps) {
  return (
              <div className="max-w-4xl w-full text-center space-y-8 animate-fade-in-up">
                <div className="space-y-4">
                  <Badge className="bg-indigo-500/10 border-indigo-500/20 text-indigo-400 text-xs px-4 py-1.5 uppercase tracking-widest font-mono">
                    Slide 01 · Parceria Comercial
                  </Badge>
                  <h1 className="text-5xl md:text-7xl font-black tracking-tight text-white leading-tight">
                    Seja muito bem-vindo à <span className="bg-gradient-to-r from-indigo-400 via-cyan-400 to-purple-400 bg-clip-text text-transparent">{theme.agencyName}</span>
                  </h1>
                  <p className="text-base md:text-xl text-slate-300 max-w-2xl mx-auto leading-relaxed">
                    {theme.agencySubtitle}
                  </p>
                </div>

                <div className="max-w-md mx-auto p-6 rounded-2xl border border-white/5 bg-slate-900/20 backdrop-blur-lg space-y-4">
                  <p className="text-xs text-slate-400 font-medium">Reunião de Onboarding estruturada para:</p>
                  <div className="flex items-center justify-center gap-3">
                    {theme.prospectLogoUrl ? (
                      <div className="h-10 w-24 rounded-lg border border-white/10 p-1.5 bg-slate-900/60 flex items-center justify-center overflow-hidden">
                        <img src={theme.prospectLogoUrl} alt="Logo Prospect" className="max-h-full max-w-full object-contain" />
                      </div>
                    ) : (
                      <div className="h-9 w-9 rounded-lg bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center font-black text-emerald-400 text-xs">
                        {getInitials(theme.prospectName)}
                      </div>
                    )}
                    <span className="text-lg font-black text-white">{theme.prospectName}</span>
                  </div>
                  <div className="h-px bg-white/5" />
                  <p className="text-[10px] text-slate-500 font-mono">Status: Pronto para qualificação do plano tático</p>
                </div>

                <div className="pt-4 flex justify-center gap-3">
                  <Button
                    onClick={onNext}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold px-8 py-5 text-sm rounded-xl shadow-lg shadow-indigo-600/30 group"
                  >
                    Avançar para Metodologia
                    <ArrowRight className="h-4.5 w-4.5 ml-2 group-hover:translate-x-1 transition-transform" />
                  </Button>
                </div>
              </div>
  );
}
