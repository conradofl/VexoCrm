import { CheckCircle2, Zap, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CustomTheme } from "@/lib/geracaoDigital/types";

// Extraído de src/pages/GeracaoDigitalPitch.tsx (Onda 4 Run F5) — modal de sucesso do handoff (Slide 5), movimento puro.
interface BriefingSuccessModalProps {
  theme: CustomTheme;
  onGoToClosing: () => void;
}

export function BriefingSuccessModal({ theme, onGoToClosing }: BriefingSuccessModalProps) {
  return (
                  <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
                    <Card className="max-w-lg w-full border-emerald-500/20 bg-slate-900 text-white relative overflow-hidden animate-fade-in-up">
                      <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-emerald-500 to-teal-400" />
                      <CardHeader className="text-center pt-8">
                        <div className="h-12 w-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto text-emerald-400 mb-2">
                          <CheckCircle2 className="h-6 w-6" />
                        </div>
                        <CardTitle className="text-lg font-black text-white">Dossiê Comercial Qualificado!</CardTitle>
                        <CardDescription className="text-xs text-slate-400">O robô processou as informações e ativou os setores operacionais.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4 text-xs">
                        
                        <div className="p-4 bg-slate-950/50 rounded-xl border border-white/5 space-y-3">
                          <span className="font-bold text-slate-400 uppercase text-[9px] font-mono tracking-wider block">Fluxo de Handoff Disparado</span>
                          
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-slate-300">Setor Comercial (Caio / Priscila)</span>
                              <Badge className="bg-emerald-500/15 text-emerald-400 border-none text-[8px] font-bold">Briefing Preenchido</Badge>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-slate-300">Setor Técnico Tráfego (Humberto / Arthur)</span>
                              <Badge className="bg-emerald-500/15 text-emerald-400 border-none text-[8px] font-bold">Logins Coletados</Badge>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-slate-300">Direção Criativa (Jheyson / Santana)</span>
                              <Badge className="bg-emerald-500/15 text-emerald-400 border-none text-[8px] font-bold">Logomarca & Perfis</Badge>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-slate-300">Onboarding Cliente ({theme.prospectName})</span>
                              <Badge className="bg-blue-500/15 text-blue-400 border-none text-[8px] font-bold">Roadmap & Termos Enviados</Badge>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-xl border border-indigo-500/20 bg-indigo-950/10 p-3 flex gap-2">
                          <Zap className="h-4 w-4 text-indigo-400 shrink-0" />
                          <p className="text-[10px] text-indigo-200 leading-normal">
                            Notificações de push enviadas com sucesso no painel administrativo Vexo CRM para as contas operacionais ativas.
                          </p>
                        </div>

                        <div className="flex justify-end pt-2">
                          <Button
                            onClick={onGoToClosing}
                            className="bg-indigo-600 hover:bg-indigo-500 font-extrabold text-white text-xs h-9 px-6 gap-2"
                          >
                            Ir para Fechamento
                            <ArrowRight className="h-4 w-4 ml-1.5" />
                          </Button>
                        </div>

                      </CardContent>
                    </Card>
                  </div>
  );
}
