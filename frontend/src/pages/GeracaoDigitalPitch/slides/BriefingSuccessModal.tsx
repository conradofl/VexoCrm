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
                  <div className="fixed inset-0 z-50 bg-slate-100/80 backdrop-blur-md flex items-center justify-center p-4">
                    <Card className="max-w-lg w-full border-slate-200 bg-white text-slate-900 relative overflow-hidden shadow-2xl animate-fade-in-up">
                      <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-emerald-500 to-teal-400" />
                      <CardHeader className="text-center pt-8">
                        <div className="h-16 w-16 rounded-full bg-emerald-100 border border-emerald-200 flex items-center justify-center mx-auto text-emerald-600 mb-2 shadow-sm">
                          <CheckCircle2 className="h-8 w-8" />
                        </div>
                        <CardTitle className="text-xl font-black text-slate-800">Dossiê Comercial Qualificado!</CardTitle>
                        <CardDescription className="text-sm text-slate-500">O robô processou as informações e ativou os setores operacionais.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-5 text-sm">
                        
                        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-4 shadow-sm">
                          <span className="font-bold text-slate-500 uppercase text-[10px] font-mono tracking-wider block">Fluxo de Handoff Disparado</span>
                          
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-slate-700 font-medium">Setor Comercial (Caio / Priscila)</span>
                              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px] font-bold px-2 py-0.5">Briefing Preenchido</Badge>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-slate-700 font-medium">Setor Técnico Tráfego (Humberto / Arthur)</span>
                              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px] font-bold px-2 py-0.5">Logins Coletados</Badge>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-slate-700 font-medium">Direção Criativa (Jheyson / Santana)</span>
                              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px] font-bold px-2 py-0.5">Logomarca & Perfis</Badge>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-slate-700 font-medium">Onboarding Cliente ({theme.prospectName})</span>
                              <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-[10px] font-bold px-2 py-0.5">Roadmap & Termos Enviados</Badge>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 flex gap-3 shadow-sm">
                          <Zap className="h-5 w-5 text-indigo-600 shrink-0" />
                          <p className="text-xs text-indigo-900 font-medium leading-relaxed">
                            Notificações de push enviadas com sucesso no painel administrativo Vexo CRM para as contas operacionais ativas.
                          </p>
                        </div>

                        <div className="flex justify-end pt-3">
                          <Button
                            onClick={onGoToClosing}
                            className="bg-indigo-600 hover:bg-indigo-700 font-bold text-white text-sm h-11 px-8 gap-2 rounded-xl shadow-sm"
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
