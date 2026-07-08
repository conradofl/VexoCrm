import { CheckCircle2, Flame, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SegmentScenario } from "@/pages/demoSegments";

// Extraído de src/pages/VexoPitch.tsx (Onda 4 Run F9) — SLIDE 2: A SOLUÇÃO, movimento puro.
interface Slide2SolutionProps {
  segment: SegmentScenario;
}

export function Slide2Solution({ segment }: Slide2SolutionProps) {
  return (
              <div className="max-w-5xl w-full space-y-8 animate-fade-in-up">
                <div className="text-center space-y-4">
                  <Badge className="bg-indigo-500/10 border-indigo-500/20 text-indigo-400 text-sm px-4 py-1.5 uppercase tracking-wider font-mono">
                    {segment.slide2.badge}
                  </Badge>
                  <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-white leading-tight">
                    {segment.slide2.title}
                  </h1>
                  <p className="text-lg md:text-xl text-slate-300 max-w-4xl mx-auto">
                    {segment.slide2.subtitle}
                  </p>
                </div>

                <div className="grid gap-6 md:grid-cols-2 mt-4">
                  {/* Máquina de Vendas */}
                  <div className="rounded-2xl border border-indigo-500/30 bg-indigo-950/10 p-8 space-y-5 relative overflow-hidden group shadow-[inset_0_0_30px_rgba(99,102,241,0.15)]">
                    <div className="absolute -right-16 -top-16 h-36 w-36 bg-indigo-500/10 rounded-full blur-2xl" />
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400">
                      <TrendingUp className="h-7 w-7" />
                    </div>
                    <h3 className="text-2xl font-black text-indigo-400">{segment.slide2.motor1Title}</h3>
                    <ul className="space-y-3.5 text-sm text-slate-300">
                      {segment.slide2.motor1Features.map((f, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <CheckCircle2 className="h-5 w-5 shrink-0 text-indigo-400 mt-0.5" />
                          <span><strong>{f.title}</strong>: {f.desc}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Máquina de Disparos */}
                  <div className="rounded-2xl border border-orange-500/30 bg-orange-950/10 p-8 space-y-5 relative overflow-hidden group shadow-[inset_0_0_30px_rgba(249,115,22,0.15)]">
                    <div className="absolute -right-16 -top-16 h-36 w-36 bg-orange-500/10 rounded-full blur-2xl" />
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500/20 text-orange-400">
                      <Flame className="h-7 w-7" />
                    </div>
                    <h3 className="text-2xl font-black text-orange-400">{segment.slide2.motor2Title}</h3>
                    <ul className="space-y-3.5 text-sm text-slate-300">
                      {segment.slide2.motor2Features.map((f, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <CheckCircle2 className="h-5 w-5 shrink-0 text-orange-400 mt-0.5" />
                          <span><strong>{f.title}</strong>: {f.desc}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
  );
}
