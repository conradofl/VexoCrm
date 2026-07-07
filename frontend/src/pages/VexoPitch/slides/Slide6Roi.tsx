import { Badge } from "@/components/ui/badge";

// Extraído de src/pages/VexoPitch.tsx (Onda 4 Run F9) — SLIDE 6: ROI E RESULTADOS, movimento puro.
interface Slide6RoiProps {
  prospectName: string;
  operatorHoursSaved: number;
  extraSales: number;
  additionalRevenue: number;
}

export function Slide6Roi({ prospectName, operatorHoursSaved, extraSales, additionalRevenue }: Slide6RoiProps) {
  return (
              <div className="max-w-5xl w-full space-y-8 animate-fade-in-up">
                <div className="text-center space-y-4">
                  <Badge className="bg-emerald-500/10 border-emerald-500/20 text-emerald-400 text-sm px-4 py-1.5 uppercase tracking-wider font-mono">
                    SLIDE 06 · PROJEÇÃO DE RETORNO DO INVESTIMENTO (R.O.I.)
                  </Badge>
                  <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-white leading-tight">
                    Resultados Esperados para {prospectName}
                  </h1>
                  <p className="text-lg md:text-xl text-slate-300 max-w-4xl mx-auto">
                    Demonstrativo financeiro simulado baseado nas métricas de conversão e ticket médio do seu nicho.
                  </p>
                </div>

                <div className="grid gap-6 md:grid-cols-3 mt-4">
                  {/* ROI Card 1 */}
                  <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 space-y-3 text-center shadow-[0_8px_30px_rgba(0,0,0,0.3)]">
                    <p className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">Tempo Comercial Salvo</p>
                    <p className="text-5xl md:text-6xl font-black text-indigo-400 tracking-tight">{operatorHoursSaved}h</p>
                    <p className="text-sm text-slate-500 leading-relaxed">de trabalho de recepção e triagem manual economizados por mês para sua equipe focar apenas no fechamento presencial.</p>
                  </div>

                  {/* ROI Card 2 */}
                  <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 space-y-3 text-center shadow-[0_8px_30px_rgba(0,0,0,0.3)]">
                    <p className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">Novas Vendas Adicionais</p>
                    <p className="text-5xl md:text-6xl font-black text-orange-400 tracking-tight">+{extraSales}</p>
                    <p className="text-sm text-slate-500 leading-relaxed">fechamentos mensais conquistados devido à qualificação em menos de 60 segundos e follow-ups automáticos persistentes.</p>
                  </div>

                  {/* ROI Card 3 */}
                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/5 p-8 space-y-3 text-center shadow-[0_8px_30px_rgba(16,185,129,0.08)]">
                    <p className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-wider">Faturamento Extra Estimado</p>
                    <p className="text-3xl md:text-4xl font-black text-emerald-400 tracking-tight pt-2">
                      R$ {additionalRevenue.toLocaleString("pt-BR")}
                    </p>
                    <p className="text-sm text-slate-500 leading-relaxed pt-2">de faturamento recorrente extra recuperado de leads que simplesmente sumiriam e esfriariam na base fria.</p>
                  </div>
                </div>

                <div className="rounded-2xl bg-indigo-600 p-5 text-center font-black text-base tracking-tight text-white max-w-lg mx-auto shadow-2xl shadow-indigo-600/30 mt-6">
                  ⚡ Recupere o investimento da plataforma no primeiro mês de uso!
                </div>
              </div>
  );
}
