import { Bell, CheckCircle2, Clock, Sparkles, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SegmentScenario } from "@/pages/demoSegments";

// Extraído de src/pages/VexoPitch.tsx (Onda 4 Run F9) — SLIDE 4: INTELIGÊNCIA COMERCIAL & ROTEAMENTO, movimento puro.
interface Slide4IntelligenceProps {
  segment: SegmentScenario;
}

export function Slide4Intelligence({ segment }: Slide4IntelligenceProps) {
  return (
              <div className="max-w-5xl w-full space-y-8 animate-fade-in-up">
                <div className="text-center space-y-4">
                  <Badge className="bg-emerald-500/10 border-emerald-500/20 text-emerald-400 text-sm px-4 py-1.5 uppercase tracking-wider font-mono">
                    {segment.slide4.badge}
                  </Badge>
                  <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-white leading-tight">
                    {segment.slide4.title}
                  </h1>
                  <p className="text-lg md:text-xl text-slate-300 max-w-4xl mx-auto">
                    {segment.slide4.subtitle}
                  </p>
                </div>

                <div className="grid gap-6 md:grid-cols-3 mt-4">
                  {segment.slide4.cards.map((card, i) => (
                    <div key={i} className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 space-y-4 hover:border-emerald-500/30 transition-all duration-300 relative overflow-hidden group shadow-2xl">
                      <div className="absolute top-0 right-0 h-32 w-32 bg-emerald-500/5 rounded-full blur-2xl" />
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                        {card.icon === 'users' && <Users className="h-7 w-7" />}
                        {card.icon === 'bell' && <Bell className="h-7 w-7" />}
                        {card.icon === 'sparkles' && <Sparkles className="h-7 w-7" />}
                        {card.icon === 'check' && <CheckCircle2 className="h-7 w-7" />}
                        {card.icon === 'clock' && <Clock className="h-7 w-7" />}
                      </div>
                      <h3 className="text-xl font-bold text-emerald-400">{card.title}</h3>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        {card.desc}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
  );
}
