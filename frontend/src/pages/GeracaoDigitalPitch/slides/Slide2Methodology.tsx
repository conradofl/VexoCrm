import { Badge } from "@/components/ui/badge";

// Extraído de src/pages/GeracaoDigitalPitch.tsx (Onda 4 Run F5) — Slide 2 (metodologia), movimento puro. Conteúdo estático, sem props.
export function Slide2Methodology() {
  return (
              <div className="max-w-6xl w-full space-y-12 animate-fade-in-up">
                <div className="text-center space-y-4">
                  <Badge className="bg-indigo-50 border-indigo-200 text-indigo-700 text-sm px-5 py-2 uppercase tracking-widest font-mono shadow-sm">
                    Slide 02 · Como Trabalhamos
                  </Badge>
                  <h2 className="text-4xl md:text-6xl font-black text-slate-900">Engrenagem de Tração & Escala</h2>
                  <p className="text-base md:text-lg text-slate-600 max-w-2xl mx-auto">
                    Nossa metodologia consiste em integrar perfeitamente criativos envolventes com inteligência de tráfego pago local e de conversão rápida.
                  </p>
                </div>

                <div className="grid gap-6 md:grid-cols-4 mt-8">
                  {/* Step 1 */}
                  <div className="p-8 rounded-3xl border border-slate-200 bg-white shadow-lg shadow-slate-200/50 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group space-y-5">
                    <div className="h-12 w-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center font-black text-indigo-600 text-lg">
                      01
                    </div>
                    <div className="space-y-2">
                      <h3 className="font-bold text-slate-900 text-lg group-hover:text-indigo-600 transition-colors">Planejamento & Briefing</h3>
                      <p className="text-sm text-slate-600 leading-relaxed">Captura estruturada de logins, metas, paleta de cores e perfil de cliente ideal para mapear o posicionamento.</p>
                    </div>
                  </div>
                  {/* Step 2 */}
                  <div className="p-8 rounded-3xl border border-slate-200 bg-white shadow-lg shadow-slate-200/50 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group space-y-5">
                    <div className="h-12 w-12 rounded-2xl bg-cyan-50 border border-cyan-100 flex items-center justify-center font-black text-cyan-600 text-lg">
                      02
                    </div>
                    <div className="space-y-2">
                      <h3 className="font-bold text-slate-900 text-lg group-hover:text-cyan-600 transition-colors">Produção Criativa</h3>
                      <p className="text-sm text-slate-600 leading-relaxed">Roteirização de vídeos curtos magnéticos (Reels/TikTok) e design estético refinado de criativos para anúncios.</p>
                    </div>
                  </div>
                  {/* Step 3 */}
                  <div className="p-8 rounded-3xl border border-slate-200 bg-white shadow-lg shadow-slate-200/50 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group space-y-5">
                    <div className="h-12 w-12 rounded-2xl bg-purple-50 border border-purple-100 flex items-center justify-center font-black text-purple-600 text-lg">
                      03
                    </div>
                    <div className="space-y-2">
                      <h3 className="font-bold text-slate-900 text-lg group-hover:text-purple-600 transition-colors">Mídia & Tráfego Pago</h3>
                      <p className="text-sm text-slate-600 leading-relaxed">Configuração profissional de pixel, UTMs e campanhas de anúncios focadas em menor CPL e alta intenção comercial.</p>
                    </div>
                  </div>
                  {/* Step 4 */}
                  <div className="p-8 rounded-3xl border border-slate-200 bg-white shadow-lg shadow-slate-200/50 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group space-y-5">
                    <div className="h-12 w-12 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center font-black text-emerald-600 text-lg">
                      04
                    </div>
                    <div className="space-y-2">
                      <h3 className="font-bold text-slate-900 text-lg group-hover:text-emerald-600 transition-colors">Inteligência de Vendas</h3>
                      <p className="text-sm text-slate-600 leading-relaxed">Relatório de ROI unificado direto no Vexo CRM, com auditoria de CAC e otimização diária de orçamentos.</p>
                    </div>
                  </div>
                </div>
              </div>
  );
}
