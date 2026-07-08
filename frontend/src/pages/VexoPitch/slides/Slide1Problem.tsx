import { AlertTriangle, Flame } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SegmentScenario } from "@/pages/demoSegments";

// Extraído de src/pages/VexoPitch.tsx (Onda 4 Run F9) — SLIDE 1: O PROBLEMA, movimento puro.
interface Slide1ProblemProps {
  segment: SegmentScenario;
}

export function Slide1Problem({ segment }: Slide1ProblemProps) {
  return (
              <div className="max-w-5xl w-full space-y-8 animate-fade-in-up">
                <div className="text-center space-y-4">
                  <Badge className="bg-red-500/10 border-red-500/20 text-red-400 text-sm px-4 py-1.5 uppercase tracking-wider font-mono">
                    {segment.slide1.badge}
                  </Badge>
                  <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-white leading-tight">
                    {segment.slide1.title}
                  </h1>
                  <p className="text-lg md:text-xl text-slate-300 max-w-4xl mx-auto">
                    {segment.slide1.subtitle}
                  </p>
                </div>

                <div className="grid gap-6 md:grid-cols-2 mt-4">
                  {/* Card Dor 1 */}
                  <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 space-y-4 relative overflow-hidden group hover:border-red-500/30 transition-all duration-300 shadow-2xl">
                    <div className="absolute top-0 right-0 h-32 w-32 bg-red-500/5 rounded-full blur-2xl" />
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10 text-red-400">
                      <AlertTriangle className="h-7 w-7" />
                    </div>
                    <h3 className="text-xl font-bold text-red-400">{segment.slide1.dor1Title}</h3>
                    <p className="text-base text-slate-300 leading-relaxed">
                      ⚠️ <strong>Dor específica:</strong> {segment.painPoint}
                    </p>
                    <p className="text-sm text-slate-400 leading-relaxed">
                      {segment.slide1.dor1Desc}
                    </p>
                  </div>

                  {/* Card Dor 2 */}
                  <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 space-y-4 relative overflow-hidden group hover:border-red-500/30 transition-all duration-300 shadow-2xl">
                    <div className="absolute top-0 right-0 h-32 w-32 bg-red-500/5 rounded-full blur-2xl" />
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10 text-red-400">
                      <Flame className="h-7 w-7" />
                    </div>
                    <h3 className="text-xl font-bold text-red-400">{segment.slide1.dor2Title}</h3>
                    <p className="text-base text-slate-300 leading-relaxed">
                      {segment.slide1.dor2Desc}
                    </p>
                  </div>
                </div>
              </div>
  );
}
