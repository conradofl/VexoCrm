import { Badge } from "@/components/ui/badge";

// Extraído de src/pages/GeracaoDigitalPitch.tsx (Onda 4 Run F5) — Slide 2 (metodologia), movimento puro. Conteúdo estático, sem props.
export function Slide2Methodology() {
  return (
              <div className="max-w-5xl w-full space-y-8 animate-fade-in-up">
                <div className="text-center space-y-3">
                  <Badge className="bg-indigo-500/10 border-indigo-500/20 text-indigo-400 text-xs px-4 py-1.5 uppercase tracking-wider font-mono">
                    Slide 02 · Como Trabalhamos
                  </Badge>
                  <h2 className="text-3xl md:text-5xl font-black text-white">Engrenagem de Tração & Escala</h2>
                  <p className="text-xs md:text-sm text-slate-400 max-w-2xl mx-auto">
                    Nossa metodologia consiste em integrar perfeitamente criativos envolventes com inteligência de tráfego pago local e de conversão rápida.
                  </p>
                </div>

                <div className="grid gap-6 md:grid-cols-4 mt-6">
                  {/* Step 1 */}
                  <div className="p-6 rounded-2xl border border-white/5 bg-slate-900/10 backdrop-blur-md hover:border-indigo-500/30 transition-all duration-300 group space-y-4">
                    <div className="h-10 w-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center font-bold text-indigo-400">
                      01
                    </div>
                    <div className="space-y-1.5">
                      <h3 className="font-bold text-white text-sm group-hover:text-indigo-400 transition-colors">Planejamento & Briefing</h3>
                      <p className="text-xs text-slate-400 leading-relaxed">Captura estruturada de logins, metas, paleta de cores e perfil de cliente ideal para mapear o posicionamento.</p>
                    </div>
                  </div>
                  {/* Step 2 */}
                  <div className="p-6 rounded-2xl border border-white/5 bg-slate-900/10 backdrop-blur-md hover:border-cyan-500/30 transition-all duration-300 group space-y-4">
                    <div className="h-10 w-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center font-bold text-cyan-400">
                      02
                    </div>
                    <div className="space-y-1.5">
                      <h3 className="font-bold text-white text-sm group-hover:text-cyan-400 transition-colors">Produção Criativa</h3>
                      <p className="text-xs text-slate-400 leading-relaxed">Roteirização de vídeos curtos magnéticos (Reels/TikTok) e design estético refinado de criativos para anúncios.</p>
                    </div>
                  </div>
                  {/* Step 3 */}
                  <div className="p-6 rounded-2xl border border-white/5 bg-slate-900/10 backdrop-blur-md hover:border-purple-500/30 transition-all duration-300 group space-y-4">
                    <div className="h-10 w-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center font-bold text-purple-400">
                      03
                    </div>
                    <div className="space-y-1.5">
                      <h3 className="font-bold text-white text-sm group-hover:text-purple-400 transition-colors">Mídia & Tráfego Pago</h3>
                      <p className="text-xs text-slate-400 leading-relaxed">Configuração profissional de pixel, UTMs e campanhas de anúncios focadas em menor CPL e alta intenção comercial.</p>
                    </div>
                  </div>
                  {/* Step 4 */}
                  <div className="p-6 rounded-2xl border border-white/5 bg-slate-900/10 backdrop-blur-md hover:border-emerald-500/30 transition-all duration-300 group space-y-4">
                    <div className="h-10 w-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center font-bold text-emerald-400">
                      04
                    </div>
                    <div className="space-y-1.5">
                      <h3 className="font-bold text-white text-sm group-hover:text-emerald-400 transition-colors">Inteligência de Vendas</h3>
                      <p className="text-xs text-slate-400 leading-relaxed">Relatório de ROI unificado direto no Vexo CRM, com auditoria de CAC e otimização diária de orçamentos.</p>
                    </div>
                  </div>
                </div>
              </div>
  );
}
