import { Bell, Bot, Calendar, Check, CheckCircle2, Clock, Layers, RefreshCw, Smartphone, UserCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SegmentScenario } from "@/pages/demoSegments";
import { formatText } from "@/lib/vexoPitch/helpers";
import type { CurrentStepData, Message } from "@/lib/vexoPitch/types";

// Extraído de src/pages/VexoPitch.tsx (Onda 4 Run F9) — SLIDE 5: O SIMULADOR LIVE MULTITURNO, movimento puro.
interface Slide5SimulatorProps {
  segment: SegmentScenario;
  prospectName: string;
  prospectLogo: string | null;
  simStep: number;
  selectedObjection: string;
  selectedQualification: string;
  selectedPeriod: string;
  selectedSlot: string;
  chatHistory: Message[];
  currentStepData: CurrentStepData;
  handleSelectOption: (value: string) => void;
  handleSelectSlot: (slot: string) => void;
  handleResetSimulator: () => void;
}

export function Slide5Simulator({
  segment,
  prospectName,
  prospectLogo,
  simStep,
  selectedObjection,
  selectedQualification,
  selectedPeriod,
  selectedSlot,
  chatHistory,
  currentStepData,
  handleSelectOption,
  handleSelectSlot,
  handleResetSimulator,
}: Slide5SimulatorProps) {
  const fmt = (text?: string) => formatText(text, prospectName, segment.defaultProspectName);

  return (
              <div className="max-w-[1400px] w-full space-y-6 animate-fade-in-up">
                <div className="text-center space-y-1">
                  <Badge className="bg-indigo-500/10 border-indigo-500/20 text-indigo-400 text-xs px-3 py-1 uppercase tracking-wider font-mono">
                    SLIDE 05 · SIMULADOR LIVE VEXO OS
                  </Badge>
                  <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white">
                    Simulação Interativa de Atendimento Automático
                  </h1>
                  <p className="text-sm text-slate-400">
                    Acompanhe como a inteligência artificial qualifica o lead, contorna as dores e move o card no funil de vendas em tempo real.
                  </p>
                </div>

                <div className="grid gap-6 lg:grid-cols-12 items-stretch">

                  {/* Coluna Esquerda (5/12): WhatsApp Simulator */}
                  <div className="lg:col-span-5 flex flex-col justify-between bg-slate-900/60 border border-white/5 rounded-2xl p-4 space-y-4">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-white/5 pb-2">
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 border border-white/10 rounded-full overflow-hidden shrink-0">
                            {prospectLogo ? (
                              <img src={prospectLogo} alt="Prospect Logo" className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-[10px] font-bold text-indigo-400 text-center block leading-7 bg-white/5">{prospectName[0]}</span>
                            )}
                          </div>
                          <div>
                            <p className="text-xs font-bold text-white leading-none">{prospectName}</p>
                            <span className="text-[8px] text-emerald-400 font-mono flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> online
                            </span>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" className="h-7 text-[10px] text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/10 px-2.5 py-0" onClick={handleResetSimulator}>
                          <RefreshCw className="h-3 w-3 mr-1" /> Reiniciar Simulação
                        </Button>
                      </div>

                      {/* Caixa de Mensagens */}
                      <div className="bg-slate-950/70 border border-white/5 rounded-xl p-3.5 h-[280px] overflow-y-auto flex flex-col gap-3">
                        {chatHistory.map((msg, i) => (
                          <div
                            key={i}
                            className={cn(
                              "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs flex flex-col animate-fade-in-up leading-relaxed shadow-md",
                              msg.sender === "bot"
                                ? "bg-slate-800 text-slate-100 self-start border border-white/5"
                                : msg.sender === "lead"
                                ? "bg-indigo-600 text-white self-end"
                                : "bg-white/[0.02] text-slate-400 self-center text-[9px] py-1 border border-transparent font-mono rounded-lg"
                            )}
                          >
                            {msg.sender === "bot" && (
                              <span className="text-[8px] font-mono font-bold text-indigo-400 uppercase tracking-wider mb-1 block">Atendente IA ({prospectName})</span>
                            )}
                            {msg.sender === "lead" && (
                              <span className="text-[8px] font-mono font-bold text-indigo-300 uppercase tracking-wider mb-1 block">Lead: Felipe Melo / Mariana</span>
                            )}
                            <span>{fmt(msg.text)}</span>
                            {msg.sender !== "system" && (
                              <span className="text-[7px] opacity-60 self-end mt-0.5">{msg.time}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Controles de Ação do Lead */}
                    <div className="border-t border-white/5 pt-3.5">
                      {simStep <= 3 && (
                        <div className="space-y-2">
                          <p className="text-[10px] font-bold text-slate-400 font-mono uppercase tracking-wider flex items-center gap-1.5">
                            <Smartphone className="h-3.5 w-3.5 text-indigo-400" />
                            Escolha a resposta do lead (Cliente):
                          </p>
                          <div className="grid grid-cols-1 gap-2">
                            {simStep === 1 && segment.steps.step1.options?.map((opt, i) => (
                              <button
                                key={i}
                                className="w-full rounded-xl border border-white/10 bg-white/5 hover:bg-indigo-600/20 hover:border-indigo-500 text-xs font-bold py-2.5 px-3.5 text-left transition-smooth text-slate-200"
                                onClick={() => handleSelectOption(opt.value)}
                              >
                                {opt.label}
                              </button>
                            ))}
                            {simStep === 2 && selectedObjection && segment.steps.step2[selectedObjection]?.options?.map((opt, i) => (
                              <button
                                key={i}
                                className="w-full rounded-xl border border-white/10 bg-white/5 hover:bg-indigo-600/20 hover:border-indigo-500 text-xs font-bold py-2.5 px-3.5 text-left transition-smooth text-slate-200"
                                onClick={() => handleSelectOption(opt.value)}
                              >
                                {opt.label}
                              </button>
                            ))}
                            {simStep === 3 && selectedQualification && segment.steps.step3[selectedQualification]?.options?.map((opt, i) => (
                              <button
                                key={i}
                                className="w-full rounded-xl border border-white/10 bg-white/5 hover:bg-indigo-600/20 hover:border-indigo-500 text-xs font-bold py-2.5 px-3.5 text-left transition-smooth text-slate-200"
                                onClick={() => handleSelectOption(opt.value)}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Passo 4: Grid interativo de Slots de Horários */}
                      {simStep === 4 && selectedPeriod && (
                        <div className="space-y-2.5">
                          <p className="text-[10px] font-bold text-slate-400 font-mono uppercase tracking-wider flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5 text-emerald-400" />
                            Selecione um horário na Agenda para confirmar:
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            {segment.steps.step4[selectedPeriod]?.slots?.map((slot, i) => (
                              <button
                                key={i}
                                className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 hover:bg-emerald-600 text-white text-xs font-black py-3 px-2 text-center transition-smooth"
                                onClick={() => handleSelectSlot(slot)}
                              >
                                {slot}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Passo 5: Sucesso Completo */}
                      {simStep === 5 && (
                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/15 p-3 flex items-center gap-3">
                          <div className="h-8 w-8 bg-emerald-500/20 rounded-full flex items-center justify-center text-emerald-400 animate-pulse">
                            <Check className="h-4.5 w-4.5" />
                          </div>
                          <div>
                            <p className="text-xs font-black text-emerald-400 leading-none">Agendamento Realizado!</p>
                            <p className="text-[10px] text-slate-400 mt-1">A IA qualificou o lead, bloqueou a agenda e enviou o alerta ao Closer.</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Coluna Direita (7/12): Vexo OS Brain & CRM Dashboard */}
                  <div className="lg:col-span-7 flex flex-col justify-between space-y-4">

                    {/* CRM Kanban Board */}
                    <div className="bg-slate-900/40 border border-white/5 rounded-2xl p-4.5 space-y-2">
                      <p className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        <Layers className="h-3.5 w-3.5 text-indigo-400" />
                        Status do CRM Integrado em Tempo Real
                      </p>

                      <div className="grid grid-cols-4 gap-2.5 h-[100px] bg-slate-950/50 rounded-xl p-2">
                        {/* Coluna Novo */}
                        <div className="rounded-lg bg-white/[0.01] p-1 flex flex-col gap-1 overflow-hidden">
                          <span className="text-[8px] font-bold text-slate-500 uppercase text-center block">Novo</span>
                          {simStep === 1 && (
                            <div className="rounded bg-indigo-500/10 border border-indigo-500/30 p-1.5 animate-pulse text-center">
                              <p className="text-[9px] font-black text-white truncate">{prospectName[0] || "L"}</p>
                              <span className="text-[7px] text-indigo-400 block font-semibold leading-none mt-0.5">Triagem IA</span>
                            </div>
                          )}
                        </div>

                        {/* Coluna Qualificando */}
                        <div className="rounded-lg bg-white/[0.01] p-1 flex flex-col gap-1 overflow-hidden">
                          <span className="text-[8px] font-bold text-slate-500 uppercase text-center block">Qualificando</span>
                          {(simStep === 2 || simStep === 3) && (
                            <div className="rounded bg-amber-500/10 border border-amber-500/30 p-1.5 text-center">
                              <p className="text-[9px] font-black text-white truncate">{prospectName[0] || "L"}</p>
                              <span className="text-[7px] text-amber-500 block font-semibold leading-none mt-0.5">Qualificando</span>
                            </div>
                          )}
                        </div>

                        {/* Coluna Agendado */}
                        <div className="rounded-lg bg-white/[0.01] p-1 flex flex-col gap-1 overflow-hidden">
                          <span className="text-[8px] font-bold text-slate-500 uppercase text-center block">Agendado</span>
                          {simStep >= 4 && (
                            <div className={cn(
                              "rounded bg-emerald-500/20 border border-emerald-500 p-1.5 text-center shadow-lg shadow-emerald-500/10",
                              simStep === 5 ? "animate-bounce" : ""
                            )}>
                              <p className="text-[9px] font-black text-white truncate">{prospectName[0] || "L"}</p>
                              <span className="text-[7px] text-emerald-400 block font-black leading-none mt-0.5">✓ {segment.goalAction.split(" ")[1]}</span>
                            </div>
                          )}
                        </div>

                        {/* Coluna Arquivado */}
                        <div className="rounded-lg bg-white/[0.01] p-1 flex flex-col gap-1 overflow-hidden">
                          <span className="text-[8px] font-bold text-slate-500 uppercase text-center block">Perdidos</span>
                        </div>
                      </div>
                    </div>

                    {/* AI Reasoning Console (Vexo Brain) */}
                    <div className="bg-slate-900/40 border border-white/5 rounded-2xl p-4.5 space-y-3.5 flex-1 flex flex-col justify-between">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Bot className="h-4 w-4 text-indigo-400" />
                            Painel de Inteligência Vexo OS
                          </p>
                          <Badge variant="outline" className="text-[9px] px-2 py-0.5 border-indigo-500/30 text-indigo-400 font-mono bg-indigo-500/5">
                            {currentStepData.title}
                          </Badge>
                        </div>

                        {/* Detalhes do Turno */}
                        <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
                          <div className="rounded-xl border border-indigo-500/10 bg-indigo-950/20 p-4 relative overflow-hidden group">
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-indigo-500/5 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]" />
                            <p className="text-sm text-indigo-300 font-medium leading-relaxed relative z-10">
                              {fmt(currentStepData.reasoning)}
                            </p>
                          </div>
                          <div className="rounded-xl border border-emerald-500/10 bg-emerald-950/20 p-4 relative overflow-hidden group">
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-emerald-500/5 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]" />
                            <p className="text-sm text-emerald-300 font-medium leading-relaxed relative z-10">
                              "{fmt(currentStepData.training)}"
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Explicador de Ações em Background e Handoff do Closer no Passo 5 */}
                      <div className="border-t border-white/5 pt-3.5">
                        {simStep < 5 ? (
                          <div className="flex items-center gap-3 w-full bg-slate-900/60 p-3 rounded-xl border border-white/5">
                            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-orange-500/10">
                              <Bot className="h-4 w-4 text-orange-400" />
                            </div>
                            <span className="text-[11px] font-bold text-slate-200 truncate max-w-md">{fmt(currentStepData.action)}</span>
                          </div>
                        ) : (
                          // Passo 5: Card de Handoff Completo e Relatório de Qualificação para Closer
                          <div className="rounded-xl border border-indigo-500/40 bg-indigo-950/30 p-4 shadow-xl space-y-3 relative overflow-hidden animate-pulse">
                            <div className="absolute top-0 right-0 p-3 text-indigo-400">
                              <Bell className="h-5 w-5 animate-bounce" />
                            </div>

                            <div className="flex items-center gap-2">
                              <UserCheck className="h-4.5 w-4.5 text-indigo-400" />
                              <span className="text-xs font-black text-indigo-300 uppercase font-mono tracking-wider">
                                Card de Qualificação Comercial Criado (Handoff)
                              </span>
                            </div>

                            {segment.steps.step5[selectedSlot]?.handoff && (
                              <div className="grid gap-2 grid-cols-2 text-xs">
                                <div className="space-y-0.5">
                                  <span className="text-[9px] text-slate-500 uppercase font-mono block">Nome do Lead</span>
                                  <p className="font-bold text-white truncate">{fmt(segment.steps.step5[selectedSlot].handoff.lead)}</p>
                                </div>
                                <div className="space-y-0.5">
                                  <p className="text-[10px] text-slate-400 uppercase tracking-widest font-mono font-bold mb-1">Responsável</p>
                                  <p className="text-white font-medium">{fmt(segment.steps.step5[selectedSlot].handoff.closer)}</p>
                                </div>
                                <div className="col-span-2 space-y-0.5 border-t border-white/5 pt-1.5">
                                  <span className="text-[9px] text-slate-500 uppercase font-mono block">Dados da Triagem da IA</span>
                                  <p className="text-slate-300 leading-relaxed text-[11px]">{fmt(segment.steps.step5[selectedSlot].handoff.meta)}</p>
                                </div>
                                <div className="col-span-2 space-y-0.5 border-t border-white/5 pt-1.5">
                                  <span className="text-[9px] text-slate-500 uppercase font-mono block">Horário Reservado</span>
                                  <p className="text-emerald-400 font-extrabold">{fmt(segment.steps.step5[selectedSlot].handoff.action)}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                    </div>

                  </div>

                </div>
              </div>
  );
}
