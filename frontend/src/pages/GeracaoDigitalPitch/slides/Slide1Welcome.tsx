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
              <div className="max-w-4xl w-full text-center space-y-10 animate-fade-in-up">
                <div className="space-y-6">
                  <Badge className="bg-indigo-50 border-indigo-200 text-indigo-700 text-sm px-5 py-2 uppercase tracking-widest font-mono shadow-sm">
                    Slide 01 · Parceria Comercial
                  </Badge>
                  <h1 className="text-6xl md:text-8xl font-black tracking-tight text-slate-900 leading-tight">
                    Seja muito bem-vindo à <span className="bg-gradient-to-r from-indigo-600 via-blue-600 to-indigo-800 bg-clip-text text-transparent">{theme.agencyName}</span>
                  </h1>
                  <p className="text-lg md:text-2xl text-slate-600 max-w-2xl mx-auto leading-relaxed">
                    {theme.agencySubtitle}
                  </p>
                </div>

                <div className="max-w-lg mx-auto p-8 rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/50 space-y-6">
                  <p className="text-sm text-slate-500 font-semibold uppercase tracking-wider">Reunião de Onboarding estruturada para:</p>
                  <div className="flex items-center justify-center gap-4">
                    {theme.prospectLogoUrl ? (
                      <div className="h-14 w-32 rounded-xl border border-slate-100 p-2 bg-slate-50 flex items-center justify-center overflow-hidden shadow-sm">
                        <img src={theme.prospectLogoUrl} alt="Logo Prospect" className="max-h-full max-w-full object-contain" />
                      </div>
                    ) : (
                      <div className="h-12 w-12 rounded-xl bg-emerald-100 border border-emerald-200 flex items-center justify-center font-black text-emerald-700 text-lg shadow-sm">
                        {getInitials(theme.prospectName)}
                      </div>
                    )}
                    <span className="text-2xl font-black text-slate-900">{theme.prospectName}</span>
                  </div>
                  <div className="h-px bg-slate-100" />
                  <p className="text-xs text-slate-500 font-mono font-medium">Status: Pronto para qualificação do plano tático</p>
                </div>

                <div className="pt-6 flex justify-center gap-3">
                  <Button
                    onClick={onNext}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold px-10 py-7 text-lg rounded-2xl shadow-xl shadow-indigo-600/20 group transition-all"
                  >
                    Avançar para Metodologia
                    <ArrowRight className="h-6 w-6 ml-3 group-hover:translate-x-1 transition-transform" />
                  </Button>
                </div>
              </div>
  );
}
