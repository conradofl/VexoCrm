import { Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { roadmapSteps } from "@/lib/geracaoDigital/constants";

// Extraído de src/pages/GeracaoDigitalPitch.tsx (Onda 4 Run F5) — Slide 4 (cronograma), movimento puro. roadmapSteps é constante, sem props.
export function Slide4Timeline() {
  return (
              <div className="max-w-6xl w-full space-y-10 animate-fade-in-up">
                <div className="text-center space-y-4">
                  <Badge className="bg-indigo-50 border-indigo-200 text-indigo-700 text-sm px-5 py-2 uppercase tracking-widest font-mono shadow-sm">
                    Slide 04 · Cronograma de Lançamento
                  </Badge>
                  <h2 className="text-4xl md:text-6xl font-black text-slate-900">Linha do Tempo: Primeiros 30 Dias</h2>
                  <p className="text-base md:text-lg text-slate-600 max-w-3xl mx-auto">
                    Planejamento tático de implantação desde a validação inicial até a análise dos primeiros resultados de faturamento.
                  </p>
                </div>

                {/* The Timeline Steps layout */}
                <div className="grid gap-6 md:grid-cols-4 mt-8">
                  {roadmapSteps.map((step, idx) => (
                    <div key={idx} className="relative group p-8 rounded-3xl border border-slate-200 bg-white hover:border-indigo-300 transition-all duration-300 flex flex-col justify-between shadow-lg shadow-slate-200/50 hover:shadow-xl hover:-translate-y-1">
                      <div className="space-y-5">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-bold text-indigo-600 uppercase tracking-wider">{step.week}</span>
                          <Calendar className="h-5 w-5 text-slate-400 group-hover:text-indigo-500 transition-colors" />
                        </div>
                        
                        <div className="space-y-2">
                          <h4 className="font-black text-lg text-slate-900">{step.title}</h4>
                          <p className="text-sm text-slate-500 leading-normal font-medium">{step.subtitle}</p>
                        </div>

                        <div className="h-px bg-slate-100" />

                        <ul className="space-y-3 pt-2">
                          {step.details.map((d, i) => (
                            <li key={i} className="text-sm text-slate-700 flex items-start gap-2.5 leading-relaxed">
                              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0 mt-2" />
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
