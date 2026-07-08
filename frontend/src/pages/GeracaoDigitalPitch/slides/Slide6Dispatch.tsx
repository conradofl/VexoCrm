import React, { useState, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { RefreshCw, Zap, CheckCircle2, Mail, MessageSquare, Building2, Phone, LayoutDashboard, Users, Briefcase, Share2, Loader2, Plus, Minus, Hash } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { API_BASE_URL } from "@/lib/api";
import { DEFAULT_BRIEFING_FIELDS } from "@/lib/geracaoDigital/defaults";
import { playChime } from "@/lib/geracaoDigital/helpers";
import type { User } from "@/lib/firebase";
import type { BriefingField, CustomTheme } from "@/lib/geracaoDigital/types";

// Extraído de src/pages/GeracaoDigitalPitch.tsx (Onda 4 Run F5) — Slide 6 (revisão e disparo do handoff), movimento puro.
interface Slide6DispatchProps {
  theme: CustomTheme;
  setTheme: Dispatch<SetStateAction<CustomTheme>>;
  briefingFields: BriefingField[];
  setBriefingFields?: (fields: any[]) => void;
  sendToProspectWhatsapp: boolean;
  setSendToProspectWhatsapp: Dispatch<SetStateAction<boolean>>;
  sendToProspectEmail: boolean;
  setSendToProspectEmail: Dispatch<SetStateAction<boolean>>;
  sendToSectors: boolean;
  setSendToSectors: Dispatch<SetStateAction<boolean>>;
  prospectEmail: string;
  setProspectEmail: Dispatch<SetStateAction<string>>;
  sectorsWhatsapp: string[];
  setSectorsWhatsapp: (val: string[]) => void;
  sectorsEmail: string[];
  setSectorsEmail: (val: string[]) => void;
  isDispatching: boolean;
  setIsDispatching: Dispatch<SetStateAction<boolean>>;
  dispatchSuccess: boolean;
  setDispatchSuccess: Dispatch<SetStateAction<boolean>>;
  dispatchResult: any;
  setDispatchResult: (val: any) => void;
  setIsPresenting: (val: boolean) => void;
  user: User | null;
}

export function Slide6Dispatch({
  theme,
  setTheme,
  briefingFields,
  setBriefingFields,
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

  const [slackUsers, setSlackUsers] = useState<any[]>([]);
  const [slackChannelName, setSlackChannelName] = useState("");
  const [slackExtraChannels, setSlackExtraChannels] = useState<string[]>([]);
  const [newExtraChannel, setNewExtraChannel] = useState("");
  const [slackMembers, setSlackMembers] = useState<string[]>([]);

  useEffect(() => {
    // Generate default slug for channel
    const slug = (theme.prospectName || "cliente")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 21);
    setSlackChannelName(`cli-${slug}`);
  }, [theme.prospectName]);

  useEffect(() => {
    async function fetchSlackUsers() {
      try {
        const token = (await user?.getIdToken()) || "";
        const response = await fetch(`${API_BASE_URL}/api/geracao-digital/slack-users`, {
          headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success && data.users) {
          setSlackUsers(data.users);
        }
      } catch (err) {
        console.error("Erro ao buscar usuários do slack:", err);
      }
    }
    fetchSlackUsers();
  }, [user]);

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
                          
                          <div className="space-y-4">
                            {/* Section 1: Prospect */}
                            <div className="p-4 rounded-xl border border-white/10 bg-slate-950/40 space-y-3">
                              <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                                <h4 className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Para o Cliente (Prospect)</h4>
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                <label className="flex items-start gap-2.5 cursor-pointer group">
                                  <input
                                    type="checkbox"
                                    checked={sendToProspectWhatsapp}
                                    onChange={(e) => setSendToProspectWhatsapp(e.target.checked)}
                                    className="mt-0.5 rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500/50 h-4 w-4"
                                  />
                                  <div className="text-left flex-1">
                                    <span className="text-xs font-bold text-slate-200 block group-hover:text-indigo-300 transition-colors">WhatsApp</span>
                                    {sendToProspectWhatsapp && (
                                      <Input
                                        value={theme.whatsappNumber}
                                        onChange={(e) => {
                                          const updated = { ...theme, whatsappNumber: e.target.value };
                                          setTheme(updated);
                                          localStorage.setItem("vexo_gd_theme", JSON.stringify(updated));
                                        }}
                                        placeholder="Ex: (11) 98888-7777"
                                        className="h-8 text-[11px] border-white/10 bg-slate-900 focus:border-indigo-500/50 text-white mt-1.5"
                                      />
                                    )}
                                  </div>
                                </label>

                                <label className="flex items-start gap-2.5 cursor-pointer group">
                                  <input
                                    type="checkbox"
                                    checked={sendToProspectEmail}
                                    onChange={(e) => setSendToProspectEmail(e.target.checked)}
                                    className="mt-0.5 rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500/50 h-4 w-4"
                                  />
                                  <div className="text-left flex-1">
                                    <span className="text-xs font-bold text-slate-200 block group-hover:text-indigo-300 transition-colors">E-mail</span>
                                    {sendToProspectEmail && (
                                      <Input
                                        type="email"
                                        value={prospectEmail}
                                        onChange={(e) => setProspectEmail(e.target.value)}
                                        placeholder="Ex: cliente@empresa.com"
                                        className="h-8 text-[11px] border-white/10 bg-slate-900 focus:border-indigo-500/50 text-white mt-1.5"
                                      />
                                    )}
                                  </div>
                                </label>
                              </div>
                            </div>

                            {/* Section 2: Handoff Interno */}
                            <div className="p-4 rounded-xl border border-white/10 bg-slate-950/40 space-y-3">
                              <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                                <h4 className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Handoff Interno (Setores Responsáveis)</h4>
                              </div>
                              <label className="flex items-center gap-2.5 cursor-pointer group">
                                <input
                                  type="checkbox"
                                  checked={sendToSectors}
                                  onChange={(e) => setSendToSectors(e.target.checked)}
                                  className="rounded border-slate-700 bg-slate-950 text-emerald-600 focus:ring-emerald-500/50 h-4 w-4"
                                />
                                <div className="text-left">
                                  <span className="text-xs font-bold text-slate-200 block group-hover:text-emerald-300 transition-colors">Disparar Tarefas Automáticas e Dossiê (Tráfego, Design, etc)</span>
                                </div>
                              </label>

                              {sendToSectors && (
                                <div className="grid grid-cols-2 gap-4 pt-1 animate-fade-in-up">
                                  <div className="space-y-2">
                                    <Label className="text-[9px] text-slate-400 uppercase font-mono flex items-center justify-between">
                                      <span>WhatsApp (Grupo Setores)</span>
                                      <button type="button" onClick={() => setSectorsWhatsapp([...sectorsWhatsapp, ""])} className="text-emerald-400 hover:text-emerald-300 transition-colors bg-emerald-500/10 rounded w-4 h-4 flex items-center justify-center font-bold">
                                        +
                                      </button>
                                    </Label>
                                    {sectorsWhatsapp.map((val, idx) => (
                                      <div key={idx} className="flex gap-1">
                                        <Input
                                          value={val}
                                          onChange={(e) => {
                                            const newArr = [...sectorsWhatsapp];
                                            newArr[idx] = e.target.value;
                                            setSectorsWhatsapp(newArr);
                                          }}
                                          placeholder="Ex: (11) 99999-0000"
                                          className="h-8 text-[11px] border-white/10 bg-slate-900 focus:border-emerald-500/50 text-white"
                                        />
                                        {sectorsWhatsapp.length > 1 && (
                                          <button type="button" onClick={() => setSectorsWhatsapp(sectorsWhatsapp.filter((_, i) => i !== idx))} className="h-8 w-8 shrink-0 flex items-center justify-center rounded bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-white/5 transition-colors">
                                            -
                                          </button>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                  <div className="space-y-2">
                                    <Label className="text-[9px] text-slate-400 uppercase font-mono flex items-center justify-between">
                                      <span>E-mail (Setores)</span>
                                      <button type="button" onClick={() => setSectorsEmail([...sectorsEmail, ""])} className="text-emerald-400 hover:text-emerald-300 transition-colors bg-emerald-500/10 rounded w-4 h-4 flex items-center justify-center font-bold">
                                        +
                                      </button>
                                    </Label>
                                    {sectorsEmail.map((val, idx) => (
                                      <div key={idx} className="flex gap-1">
                                        <Input
                                          type="email"
                                          value={val}
                                          onChange={(e) => {
                                            const newArr = [...sectorsEmail];
                                            newArr[idx] = e.target.value;
                                            setSectorsEmail(newArr);
                                          }}
                                          placeholder="Ex: operacoes@geracaodigital.com.br"
                                          className="h-8 text-[11px] border-white/10 bg-slate-900 focus:border-emerald-500/50 text-white"
                                        />
                                        {sectorsEmail.length > 1 && (
                                          <button type="button" onClick={() => setSectorsEmail(sectorsEmail.filter((_, i) => i !== idx))} className="h-8 w-8 shrink-0 flex items-center justify-center rounded bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-white/5 transition-colors">
                                            -
                                          </button>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Configuração do Slack */}
                        <div className="p-4 rounded-xl border border-white/10 bg-slate-950/40 space-y-3 mt-4">
                          <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                            <h4 className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Configuração do Workspace (Slack)</h4>
                          </div>
                          
                          <div className="space-y-3 pt-1">
                            {/* Nome do canal principal */}
                            <div className="space-y-1">
                              <Label className="text-[9px] text-slate-400 uppercase font-mono">Canal Principal</Label>
                              <div className="flex items-center bg-slate-900 border border-white/10 rounded-md overflow-hidden focus-within:border-blue-500/50">
                                <span className="pl-2 pr-1 text-slate-500"><Hash className="w-3 h-3" /></span>
                                <Input
                                  value={slackChannelName}
                                  onChange={(e) => setSlackChannelName(e.target.value)}
                                  className="h-8 text-[11px] border-none bg-transparent text-white px-1 shadow-none focus-visible:ring-0"
                                />
                              </div>
                            </div>

                            {/* Canais Adicionais */}
                            <div className="space-y-1">
                              <Label className="text-[9px] text-slate-400 uppercase font-mono">Canais Adicionais a Criar</Label>
                              <div className="flex gap-2">
                                <div className="flex-1 flex items-center bg-slate-900 border border-white/10 rounded-md overflow-hidden focus-within:border-blue-500/50">
                                  <span className="pl-2 pr-1 text-slate-500"><Hash className="w-3 h-3" /></span>
                                  <Input
                                    value={newExtraChannel}
                                    onChange={(e) => setNewExtraChannel(e.target.value)}
                                    placeholder="Ex: cli-nome-design"
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        if (newExtraChannel.trim()) {
                                          setSlackExtraChannels([...slackExtraChannels, newExtraChannel.trim()]);
                                          setNewExtraChannel("");
                                        }
                                      }
                                    }}
                                    className="h-8 text-[11px] border-none bg-transparent text-white px-1 shadow-none focus-visible:ring-0"
                                  />
                                </div>
                                <Button 
                                  type="button" 
                                  onClick={() => {
                                    if (newExtraChannel.trim()) {
                                      setSlackExtraChannels([...slackExtraChannels, newExtraChannel.trim()]);
                                      setNewExtraChannel("");
                                    }
                                  }}
                                  className="h-8 px-3 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 text-xs font-bold"
                                >
                                  Adicionar
                                </Button>
                              </div>
                              {slackExtraChannels.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {slackExtraChannels.map((ch, idx) => (
                                    <Badge key={idx} className="bg-slate-800 text-slate-300 text-[9px] font-mono border-white/10 py-0.5 flex items-center gap-1">
                                      #{ch}
                                      <button type="button" onClick={() => setSlackExtraChannels(slackExtraChannels.filter((_, i) => i !== idx))} className="text-rose-400 hover:text-rose-300 ml-1">×</button>
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Membros Responsáveis */}
                            <div className="space-y-2 pt-1">
                              <Label className="text-[9px] text-slate-400 uppercase font-mono block">Responsáveis (Membros do Slack)</Label>
                              {slackUsers.length > 0 ? (
                                <div className="max-h-24 overflow-y-auto bg-slate-900/50 rounded-md border border-white/5 p-2 grid grid-cols-2 gap-1.5 custom-scrollbar">
                                  {slackUsers.map((u) => {
                                    const isSelected = slackMembers.includes(u.id);
                                    return (
                                      <label key={u.id} className={`flex items-center gap-2 p-1.5 rounded cursor-pointer transition-colors ${isSelected ? 'bg-blue-500/10 border border-blue-500/20' : 'hover:bg-white/5 border border-transparent'}`}>
                                        <input
                                          type="checkbox"
                                          checked={isSelected}
                                          onChange={(e) => {
                                            if (e.target.checked) setSlackMembers([...slackMembers, u.id]);
                                            else setSlackMembers(slackMembers.filter(id => id !== u.id));
                                          }}
                                          className="rounded border-slate-700 bg-slate-950 text-blue-600 focus:ring-blue-500/50 h-3 w-3"
                                        />
                                        <div className="flex items-center gap-1.5 overflow-hidden">
                                          {u.image && <img src={u.image} alt={u.name} className="w-4 h-4 rounded-full" />}
                                          <span className="text-[10px] text-slate-300 truncate font-semibold">{u.name}</span>
                                        </div>
                                      </label>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="text-[10px] text-slate-500 italic px-2">Buscando usuários do Slack...</div>
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
                                sectorsWhatsapp: sectorsWhatsapp.filter(Boolean).join(", "),
                                sectorsEmail: sectorsEmail.filter(Boolean).join(", "),
                                slackChannelName,
                                slackExtraChannels,
                                slackMembers
                              };

                              const token = (await user?.getIdToken()) || "";
                              const response = await fetch(`${API_BASE_URL}/api/geracao-digital/briefing`, {
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
                                  description: `Cópia do briefing enviada para a agência em ${theme.agencyName}.`,
                                });
                              }
                              if (sendToSectors) {
                                toast({
                                  title: "Handoff Operacional Ativado!",
                                  description: `Os setores de tráfego, design e contratos foram notificados com sucesso no Vexo OS (WhatsApp: ${sectorsWhatsapp} | E-mail: ${sectorsEmail}).`,
                                });
                              }
                              
                              if (setBriefingFields) {
                                setBriefingFields(DEFAULT_BRIEFING_FIELDS);
                              }
                              setTheme(prev => ({
                                ...prev,
                                prospectName: "",
                                whatsappNumber: "",
                                agencyName: ""
                              }));
                              setProspectEmail("");
                              setSlackChannelName("");
                              setSlackExtraChannels([]);
                              setSlackMembers([]);
                              
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
