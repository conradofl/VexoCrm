import { Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { roadmapSteps } from "@/lib/geracaoDigital/constants";

// Extraído de src/pages/GeracaoDigitalPitch.tsx (Onda 4 Run F5) — Slide 4 (cronograma), movimento puro. roadmapSteps é constante, sem props.
export function Slide4Timeline() {
  return (
              <div className="max-w-5xl w-full space-y-6 animate-fade-in-up">
                <div className="text-center space-y-3">
                  <Badge className="bg-indigo-500/10 border-indigo-500/20 text-indigo-400 text-xs px-4 py-1.5 uppercase tracking-wider font-mono">
                    Slide 04 · Cronograma de Lançamento
                  </Badge>
                  <h2 className="text-4xl md:text-6xl font-black text-white">Linha do Tempo: Primeiros 30 Dias</h2>
                  <p className="text-sm md:text-base text-slate-300 max-w-3xl mx-auto">
                    Planejamento tático de implantação desde a validação inicial até a análise dos primeiros resultados de faturamento.
                  </p>
                </div>

                {/* The Timeline Steps layout */}
                <div className="grid gap-6 md:grid-cols-4 mt-6">
                  {roadmapSteps.map((step, idx) => (
                    <div key={idx} className="relative group p-6 rounded-2xl border border-white/5 bg-slate-900/15 hover:border-indigo-500/30 transition-all duration-300 flex flex-col justify-between shadow-lg">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-bold text-indigo-400 uppercase tracking-wider">{step.week}</span>
                          <Calendar className="h-4.5 w-4.5 text-slate-600 group-hover:text-indigo-400 transition-colors" />
                        </div>
                        
                        <div className="space-y-2">
                          <h4 className="font-black text-base text-white">{step.title}</h4>
                          <p className="text-xs text-slate-400 leading-normal font-medium">{step.subtitle}</p>
                        </div>

                        <div className="h-px bg-white/5" />

                        <ul className="space-y-2">
                          {step.details.map((d, i) => (
                            <li key={i} className="text-xs md:text-sm text-slate-200 flex items-start gap-1.5 leading-relaxed">
                              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0 mt-1.5" />
                              <span>{d}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
  );
}
