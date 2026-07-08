import type { Dispatch, SetStateAction } from "react";
import { RefreshCw, Zap, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { playChime } from "@/lib/geracaoDigital/helpers";
import type { User } from "@/lib/firebase";
import type { BriefingField, CustomTheme } from "@/lib/geracaoDigital/types";

// Extraído de src/pages/GeracaoDigitalPitch.tsx (Onda 4 Run F5) — Slide 6 (revisão e disparo do handoff), movimento puro.
interface Slide6DispatchProps {
  theme: CustomTheme;
  setTheme: Dispatch<SetStateAction<CustomTheme>>;
  briefingFields: BriefingField[];
  sendToProspectWhatsapp: boolean;
  setSendToProspectWhatsapp: Dispatch<SetStateAction<boolean>>;
  sendToProspectEmail: boolean;
  setSendToProspectEmail: Dispatch<SetStateAction<boolean>>;
  sendToSectors: boolean;
  setSendToSectors: Dispatch<SetStateAction<boolean>>;
  prospectEmail: string;
  setProspectEmail: Dispatch<SetStateAction<string>>;
  sectorsWhatsapp: string;
  setSectorsWhatsapp: Dispatch<SetStateAction<string>>;
  sectorsEmail: string;
  setSectorsEmail: Dispatch<SetStateAction<string>>;
  isDispatching: boolean;
  setIsDispatching: Dispatch<SetStateAction<boolean>>;
  dispatchSuccess: boolean;
  setDispatchSuccess: Dispatch<SetStateAction<boolean>>;
  dispatchResult: any;
  setDispatchResult: Dispatch<SetStateAction<any>>;
  setIsPresenting: Dispatch<SetStateAction<boolean>>;
  user: User | null;
}

export function Slide6Dispatch({
  theme,
  setTheme,
  briefingFields,
  sendToProspectWhatsapp,
  setSendToProspectWhatsapp,
  sendToProspectEmail,
  setSendToProspectEmail,
  sendToSectors,
  setSendToSectors,
  prospectEmail,
  setProspectEmail,
  sectorsWhatsapp,
  setSectorsWhatsapp,
  sectorsEmail,
  setSectorsEmail,
  isDispatching,
  setIsDispatching,
  dispatchSuccess,
  setDispatchSuccess,
  dispatchResult,
  setDispatchResult,
  setIsPresenting,
  user,
}: Slide6DispatchProps) {
  return (
              <div className="max-w-5xl w-full space-y-6 animate-fade-in-up">
                <div className="text-center space-y-3">
                  <Badge className="bg-indigo-500/10 border-indigo-500/20 text-indigo-400 text-xs px-4 py-1.5 uppercase tracking-wider font-mono">
                    Slide 06 · Revisão Geral e Handoff Técnico
                  </Badge>
                  <h2 className="text-4xl md:text-5xl font-black text-white leading-tight">
                    Revisão Geral e Envio de Dados
                  </h2>
                  <p className="text-xs md:text-sm text-slate-400 max-w-xl mx-auto">
                    Confirme as informações coletadas no briefing e dispare o dossiê para o prospect e para os setores técnicos responsáveis.
                  </p>
                </div>

                <div className="grid gap-6 md:grid-cols-2 mt-4 items-stretch">
                  {/* Left Side: Briefing Summary list */}
                  <Card className="border-white/5 bg-slate-900/20 backdrop-blur-md p-6 flex flex-col justify-between max-h-[460px]">
                    <div className="space-y-3 overflow-y-auto pr-1">
                      <span className="font-bold text-slate-400 uppercase text-[9px] font-mono tracking-wider block">Resumo do Briefing Coletado</span>
                      
                      <div className="space-y-2">
                        {briefingFields.map((f) => (
                          <div key={f.id} className="p-2.5 rounded-lg bg-slate-950/40 border border-white/5 space-y-1">
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] font-bold text-indigo-300 uppercase font-mono tracking-wider">{f.label}</span>
                              {f.value ? (
                                <Badge className="bg-emerald-500/15 text-emerald-400 text-[8px] font-bold py-0 px-1 border-none">Preenchido</Badge>
                              ) : (
                                <Badge className="bg-rose-500/15 text-rose-400 text-[8px] font-bold py-0 px-1 border-none">Vazio</Badge>
                              )}
                            </div>
                            <p className="text-xs text-slate-300 leading-normal break-all font-sans">
                              {f.value ? f.value : <span className="text-slate-500 italic">Não fornecido</span>}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </Card>

                  {/* Right Side: Dispatch Options */}
                  <Card className="border-white/5 bg-slate-900/20 backdrop-blur-md p-6 flex flex-col justify-between">
                    {!dispatchSuccess ? (
                      <div className="space-y-4 flex-1 flex flex-col justify-between">
                        <div className="space-y-4">
                          <div className="text-center space-y-1">
                            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Canais de Envio & Handoff</h4>
                            <p className="text-[10px] text-slate-500">Selecione para onde deseja enviar o briefing qualificado.</p>
                          </div>
                          
                          <div className="space-y-3">
                            {/* Option 1: WhatsApp Prospect */}
                            <div className="p-3 rounded-xl border border-white/5 bg-slate-950/30 space-y-2">
                              <label className="flex items-center gap-2.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={sendToProspectWhatsapp}
                                  onChange={(e) => setSendToProspectWhatsapp(e.target.checked)}
                                  className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500/50 h-4 w-4"
                                />
                                <div className="text-left">
                                  <span className="text-xs font-bold text-slate-200 block">Enviar para o Prospect via WhatsApp</span>
                                  <span className="text-[9px] text-slate-500">Dossiê e cronograma no WhatsApp do cliente</span>
                                </div>
                              </label>
                              {sendToProspectWhatsapp && (
                                <div className="pl-6 pt-1 animate-fade-in-up">
                                  <Label className="text-[9px] text-slate-400 uppercase font-mono">WhatsApp do Prospect</Label>
                                    <Input
                                      value={theme.whatsappNumber}
                                      onChange={(e) => {
                                        const updated = { ...theme, whatsappNumber: e.target.value };
                                        setTheme(updated);
                                        localStorage.setItem("vexo_gd_theme", JSON.stringify(updated));
                                      }}
                                      placeholder="Ex: (11) 98888-7777"
                                      style={{ WebkitTextFillColor: 'white' }}
                                      className="h-8 text-xs border-white/5 bg-slate-950 focus:border-indigo-500/50 text-white mt-1 autofill:[box-shadow:inset_0_0_0px_1000px_#020617]"
                                    />
                                </div>
                              )}
                            </div>

                            {/* Option 2: Email Prospect */}
                            <div className="p-3 rounded-xl border border-white/5 bg-slate-950/30 space-y-2">
                              <label className="flex items-center gap-2.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={sendToProspectEmail}
                                  onChange={(e) => setSendToProspectEmail(e.target.checked)}
                                  className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500/50 h-4 w-4"
                                />
                                <div className="text-left">
                                  <span className="text-xs font-bold text-slate-200 block">Enviar para o Prospect via E-mail</span>
                                  <span className="text-[9px] text-slate-500">Relatório e cronograma em PDF</span>
                                </div>
                              </label>
                              {sendToProspectEmail && (
                                <div className="pl-6 pt-1 animate-fade-in-up">
                                  <Label className="text-[9px] text-slate-400 uppercase font-mono">E-mail do Prospect</Label>
                                    <Input
                                      type="email"
                                      value={prospectEmail}
                                      onChange={(e) => setProspectEmail(e.target.value)}
                                      placeholder="Ex: cliente@empresa.com.br"
                                      style={{ WebkitTextFillColor: 'white' }}
                                      className="h-8 text-xs border-white/5 bg-slate-950 focus:border-indigo-500/50 text-white mt-1 autofill:[box-shadow:inset_0_0_0px_1000px_#020617]"
                                    />
                                </div>
                              )}
                            </div>

                            {/* Option 3: Sectors */}
                            <div className="p-3 rounded-xl border border-white/5 bg-slate-950/30 space-y-2">
                              <label className="flex items-center gap-2.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={sendToSectors}
                                  onChange={(e) => setSendToSectors(e.target.checked)}
                                  className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500/50 h-4 w-4"
                                />
                                <div className="text-left">
                                  <span className="text-xs font-bold text-slate-200 block">Enviar para os Setores da Geração Digital</span>
                                  <span className="text-[9px] text-slate-500">Dispara tarefas automáticas para Tráfego, Design e Contratos</span>
                                </div>
                              </label>
                              {sendToSectors && (
                                <div className="pl-6 pt-1 space-y-2 animate-fade-in-up">
                                  <div className="space-y-1">
                                    <Label className="text-[9px] text-slate-400 uppercase font-mono">WhatsApp dos Setores (Handoff)</Label>
                                    <Input
                                      value={sectorsWhatsapp}
                                      onChange={(e) => setSectorsWhatsapp(e.target.value)}
                                      placeholder="Ex: (11) 99999-0000"
                                      style={{ WebkitTextFillColor: 'white' }}
                                      className="h-8 text-xs border-white/5 bg-slate-950 focus:border-indigo-500/50 text-white mt-1 autofill:[box-shadow:inset_0_0_0px_1000px_#020617]"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-[9px] text-slate-400 uppercase font-mono">E-mail dos Setores (Handoff)</Label>
                                    <Input
                                      type="email"
                                      value={sectorsEmail}
                                      onChange={(e) => setSectorsEmail(e.target.value)}
                                      placeholder="Ex: operacoes@geracaodigital.com.br"
                                      style={{ WebkitTextFillColor: 'white' }}
                                      className="h-8 text-xs border-white/5 bg-slate-950 focus:border-indigo-500/50 text-white mt-1 autofill:[box-shadow:inset_0_0_0px_1000px_#020617]"
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        <Button
                          disabled={isDispatching}
                          onClick={async () => {
                            try {
                              setIsDispatching(true);
                              
                              const payload = {
                                prospectName: theme.prospectName,
                                whatsappNumber: theme.whatsappNumber,
                                agencyName: theme.agencyName,
                                themePreset: theme.themePreset,
                                briefingData: briefingFields.reduce((acc, f) => ({ ...acc, [f.id]: f.value }), {}),
                                sendToProspectWhatsapp,
                                sendToProspectEmail,
                                prospectEmail,
                                sendToSectors,
                                sectorsWhatsapp,
                                sectorsEmail
                              };

                              const token = (await user?.getIdToken()) || "";
                              const response = await fetch("/api/geracao-digital/briefing", {
                                method: "POST",
                                headers: {
                                  "Content-Type": "application/json",
                                  "Authorization": `Bearer ${token}`
                                },
                                body: JSON.stringify(payload)
                              });

                              if (!response.ok) {
                                throw new Error("Erro ao salvar e disparar o briefing.");
                              }

                              const responseData = await response.json();
                              setDispatchResult(responseData);
                              setDispatchSuccess(true);
                              
                              if (sendToProspectWhatsapp) {
                                toast({
                                  title: "WhatsApp Disparado!",
                                  description: `Dossiê técnico enviado para ${theme.prospectName} (${theme.whatsappNumber}).`,
                                });
                              }
                              if (sendToProspectEmail) {
                                toast({
                                  title: "E-mail Enviado!",
                                  description: `Cópia do briefing enviada para o e-mail: ${prospectEmail}.`,
                                });
                              }
                              if (sendToSectors) {
                                toast({
                                  title: "Handoff Operacional Ativado!",
                                  description: `Os setores de tráfego, design e contratos foram notificados com sucesso no Vexo OS (WhatsApp: ${sectorsWhatsapp} | E-mail: ${sectorsEmail}).`,
                                });
                              }
                              playChime();
                            } catch (error: any) {
                              toast({
                                title: "Erro no Disparo",
                                description: error.message || "Ocorreu um erro ao disparar o briefing.",
                                variant: "destructive"
                              });
                            } finally {
                              setIsDispatching(false);
                            }
                          }}
                          className="w-full bg-emerald-600 hover:bg-emerald-500 font-extrabold text-xs text-white h-10 shadow-lg shadow-emerald-600/10 mt-4 flex items-center justify-center gap-2"
                        >
                          {isDispatching ? (
                            <>
                              <RefreshCw className="h-4 w-4 animate-spin text-white" />
                              Disparando Briefing...
                            </>
                          ) : (
                            <>
                              <Zap className="h-4 w-4 text-white" />
                              Enviar Briefing & Disparar Handoff
                            </>
                          )}
                        </Button>
                      </div>
                    ) : (
                      <div className="text-center space-y-4 animate-fade-in-up py-6 flex-1 flex flex-col justify-center items-center">
                        <div className="h-14 w-14 rounded-full bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400 animate-bounce">
                          <CheckCircle2 className="h-7 w-7" />
                        </div>
                        <div className="space-y-1">
                          <h4 className="text-base font-black text-white">Dossiê Enviado com Sucesso!</h4>
                          <p className="text-[10px] text-slate-500">As informações foram consolidadas e enviadas para os canais ativos.</p>
                        </div>

                        <div className="p-3.5 bg-slate-950/70 border border-white/5 rounded-xl text-[9.5px] font-mono text-slate-400 text-left space-y-1.5 w-full max-w-sm">
                          <p><span className="text-indigo-400 font-bold">CLIENTE:</span> {theme.prospectName}</p>
                          {sendToProspectWhatsapp && <p><span className="text-emerald-400 font-bold">WHATSAPP:</span> {theme.whatsappNumber} ({dispatchResult?.evolutionStatus === 'sent' ? 'Enviado' : 'Não configurado/Falha'})</p>}
                          {sendToProspectEmail && <p><span className="text-blue-400 font-bold">E-MAIL:</span> {prospectEmail} ({dispatchResult?.emailStatus === 'sent' ? 'Enviado' : 'Não configurado/Falha'})</p>}
                          {sendToSectors && (
                            <>
                              <p><span className="text-purple-400 font-bold">WHATSAPP SETORES:</span> {sectorsWhatsapp} ({dispatchResult?.sectorsStatus?.includes('wpp:sent') ? 'Enviado' : 'Não configurado/Falha'})</p>
                              <p><span className="text-pink-400 font-bold">E-MAIL SETORES:</span> {sectorsEmail} ({dispatchResult?.sectorsStatus?.includes('email:sent') ? 'Enviado' : 'Não configurado/Falha'})</p>
                              <p><span className="text-indigo-400 font-bold">SETORES INTERNOS:</span> Tráfego, Design, Contratos (Handoff Ativo)</p>
                            </>
                          )}
                          <p><span className="text-slate-500 font-bold">STATUS:</span> ONBOARDING_COMPLETED_SUCCESS</p>
                        </div>

                        <div className="flex gap-2 w-full max-w-sm pt-2">
                          <Button
                            variant="outline"
                            onClick={() => setDispatchSuccess(false)}
                            className="flex-1 border-white/10 hover:bg-white/5 text-slate-300 text-xs font-bold h-9"
                          >
                            Voltar
                          </Button>
                          <Button
                            onClick={() => {
                              setIsPresenting(false);
                              setDispatchSuccess(false);
                            }}
                            className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold h-9"
                          >
                            Concluir Apresentação
                          </Button>
                        </div>
                      </div>
                    )}
                  </Card>
                </div>
              </div>
  );
}
