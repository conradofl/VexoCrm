import { Bot, Check, CheckCircle2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SegmentScenario } from "@/pages/demoSegments";

// Extraído de src/pages/VexoPitch.tsx (Onda 4 Run F9) — SLIDE 3: FOLLOW-UPS E REENGAJAMENTO, movimento puro.
interface Slide3FollowupsProps {
  segment: SegmentScenario;
}

export function Slide3Followups({ segment }: Slide3FollowupsProps) {
  return (
              <div className="max-w-5xl w-full space-y-8 animate-fade-in-up">
                <div className="text-center space-y-4">
                  <Badge className="bg-orange-500/10 border-orange-500/20 text-orange-400 text-sm px-4 py-1.5 uppercase tracking-wider font-mono">
                    {segment.slide3.badge}
                  </Badge>
                  <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-white leading-tight">
                    {segment.slide3.title}
                  </h1>
                  <p className="text-lg md:text-xl text-slate-300 max-w-4xl mx-auto">
                    {segment.slide3.subtitle}
                  </p>
                </div>

                <div className="grid gap-6 md:grid-cols-3 mt-4">
                  <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 space-y-4 relative overflow-hidden group hover:border-orange-500/30 transition-all duration-300 shadow-2xl">
                    <div className="absolute top-0 right-0 h-32 w-32 bg-orange-500/5 rounded-full blur-2xl" />
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500/10 text-orange-400">
                      <Clock className="h-7 w-7" />
                    </div>
                    <h3 className="text-xl font-bold text-orange-400">{segment.slide3.feature1Title}</h3>
                    <ul className="space-y-2.5 text-xs text-slate-300">
                      {segment.slide3.feature1Items.map((f, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <Check className="h-4 w-4 shrink-0 text-orange-400 mt-0.5" />
                          <span><strong>{f.title}</strong>: {f.desc}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-2xl border border-indigo-500/30 bg-indigo-950/10 p-6 space-y-4 relative overflow-hidden group shadow-[inset_0_0_30px_rgba(99,102,241,0.15)] md:col-span-2">
                    <div className="absolute -right-16 -top-16 h-36 w-36 bg-indigo-500/10 rounded-full blur-2xl" />
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400">
                      <Bot className="h-7 w-7" />
                    </div>
                    <h3 className="text-xl font-bold text-indigo-400">{segment.slide3.feature2Title}</h3>
                    <p className="text-sm text-slate-300 leading-relaxed">
                      {segment.slide3.feature2Desc}
                    </p>
                    <div className="rounded-xl bg-slate-950/50 p-4 border border-white/5 space-y-2">
                      <p className="text-xs text-slate-400 flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        <strong>Detecção em tempo real:</strong>
                      </p>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        {segment.slide3.feature2Highlight}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
  );
}
