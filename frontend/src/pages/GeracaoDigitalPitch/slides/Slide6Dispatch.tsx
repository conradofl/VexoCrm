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

  // WhatsApp Group State
  const [createWhatsappGroup, setCreateWhatsappGroup] = useState(false);
  const [whatsappGroupName, setWhatsappGroupName] = useState("");
  const [whatsappGroupMembers, setWhatsappGroupMembers] = useState("");

  useEffect(() => {
    // Generate default slug for channel
    const slug = (theme.prospectName || "cliente")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 21);
    setSlackChannelName(`cli-${slug}`);
    
    // Default WhatsApp Group Name
    const firstName = (theme.prospectName || "Cliente").split(" ")[0];
    setWhatsappGroupName(`GD & ${firstName}`);
  }, [theme.prospectName]);

  const [isLoadingSlack, setIsLoadingSlack] = useState(true);
  const [slackError, setSlackError] = useState<string | null>("");

  useEffect(() => {
    async function fetchSlackUsers() {
      try {
        setIsLoadingSlack(true);
        const token = (await user?.getIdToken()) || "";
        const response = await fetch(`${API_BASE_URL}/api/geracao-digital/slack-users`, {
          headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success && data.users) {
          setSlackUsers(data.users);
          setSlackError(null);
        } else if (data.error) {
          setSlackError(data.error);
        }
      } catch (err) {
        console.error("Erro ao buscar usuários do slack:", err);
        setSlackError("Erro de conexão ao buscar usuários");
      } finally {
        setIsLoadingSlack(false);
      }
    }
    fetchSlackUsers();
  }, [user]);

  const fieldsWithValues = briefingFields.filter(f => f.value && String(f.value).trim() !== "");

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
                <div className="grid md:grid-cols-2 gap-6 h-full">
                    {/* Left Side: Summary */}
                    <Card className="border-slate-200 bg-white shadow-lg shadow-slate-200/50 rounded-3xl overflow-hidden flex flex-col max-h-[600px]">
                      <div className="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center sticky top-0 z-10">
                        <div>
                          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            Resumo do Briefing Qualificado
                          </h3>
                          <p className="text-xs text-slate-500 mt-1">Revise os dados antes de disparar o Handoff.</p>
                        </div>
                        <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200 font-mono text-xs px-3 py-1 shadow-sm">
                          {fieldsWithValues.length} Campos Preenchidos
                        </Badge>
                      </div>
                      <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/50">
                        {briefingFields.map((field) => (
                          <div key={field.id} className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm">
                            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{field.label}</div>
                            {field.id === "publico_alvo" ? (
                              <div className="space-y-2">
                                {(field.subfields?.filter(sf => sf.value) || []).length > 0 ? (field.subfields?.filter(sf => sf.value) || []).map(sf => (
                                  <div key={sf.id} className="text-sm">
                                    <span className="font-semibold text-slate-700">{sf.label}:</span> <span className="text-slate-600">{sf.value}</span>
                                  </div>
                                )) : <Badge className="bg-rose-100 text-rose-600 text-[10px] font-bold py-0.5 px-2 border-none">Vazio</Badge>}
                              </div>
                            ) : (
                              <p className="text-sm text-slate-700 leading-normal break-all font-sans">
                                {field.value ? field.value : <span className="text-slate-400 italic">Não fornecido</span>}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </Card>

                  {/* Right Side: Dispatch Options */}
                  <Card className="border-slate-200 bg-white shadow-lg shadow-slate-200/50 rounded-3xl p-6 flex flex-col justify-between max-h-[600px] overflow-y-auto">
                    {!dispatchSuccess ? (
                      <div className="space-y-5 flex-1 flex flex-col justify-between">
                        <div className="space-y-5">
                          <div className="text-center space-y-1.5">
                            <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Canais de Envio & Handoff</h4>
                            <p className="text-xs text-slate-500">Selecione para onde deseja enviar o briefing qualificado.</p>
                          </div>
                          
                          <div className="space-y-5">
                            {/* Section 1: Prospect */}
                            <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50 space-y-4 shadow-sm">
                              <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                                <h4 className="text-xs font-bold text-indigo-600 uppercase tracking-wider">Para o Cliente (Prospect)</h4>
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                <label className="flex items-start gap-3 cursor-pointer group">
                                  <input
                                    type="checkbox"
                                    checked={sendToProspectWhatsapp}
                                    onChange={(e) => setSendToProspectWhatsapp(e.target.checked)}
                                    className="mt-1 rounded border-slate-300 bg-white text-indigo-600 focus:ring-indigo-500 h-4 w-4 shadow-sm"
                                  />
                                  <div className="text-left flex-1">
                                    <span className="text-sm font-bold text-slate-700 block group-hover:text-indigo-600 transition-colors">WhatsApp</span>
                                    {sendToProspectWhatsapp && (
                                      <Input
                                        value={theme.whatsappNumber}
                                        onChange={(e) => {
                                          const updated = { ...theme, whatsappNumber: e.target.value };
                                          setTheme(updated);
                                          localStorage.setItem("vexo_gd_theme", JSON.stringify(updated));
                                        }}
                                        placeholder="Ex: (11) 98888-7777"
                                        className="h-10 text-sm border-slate-300 bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 text-slate-900 mt-2 shadow-sm"
                                      />
                                    )}
                                  </div>
                                </label>

                                <label className="flex items-start gap-3 cursor-pointer group">
                                  <input
                                    type="checkbox"
                                    checked={sendToProspectEmail}
                                    onChange={(e) => setSendToProspectEmail(e.target.checked)}
                                    className="mt-1 rounded border-slate-300 bg-white text-indigo-600 focus:ring-indigo-500 h-4 w-4 shadow-sm"
                                  />
                                  <div className="text-left flex-1">
                                    <span className="text-sm font-bold text-slate-700 block group-hover:text-indigo-600 transition-colors">E-mail</span>
                                    {sendToProspectEmail && (
                                      <Input
                                        type="email"
                                        value={prospectEmail}
                                        onChange={(e) => setProspectEmail(e.target.value)}
                                        placeholder="Ex: cliente@empresa.com"
                                        className="h-10 text-sm border-slate-300 bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 text-slate-900 mt-2 shadow-sm"
                                      />
                                    )}
                                  </div>
                                </label>
                              </div>
                            </div>

                            {/* Section 2: Handoff Interno */}
                            <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50 space-y-4 shadow-sm">
                              <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                                <h4 className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Handoff Interno (Setores Responsáveis)</h4>
                              </div>
                              <label className="flex items-center gap-3 cursor-pointer group">
                                <input
                                  type="checkbox"
                                  checked={sendToSectors}
                                  onChange={(e) => setSendToSectors(e.target.checked)}
                                  className="rounded border-slate-300 bg-white text-emerald-600 focus:ring-emerald-500 h-4 w-4 shadow-sm"
                                />
                                <div className="text-left">
                                  <span className="text-sm font-bold text-slate-700 block group-hover:text-emerald-600 transition-colors">Disparar Tarefas Automáticas e Dossiê (Tráfego, Design, etc)</span>
                                </div>
                              </label>

                              {sendToSectors && (
                                <div className="grid grid-cols-2 gap-4 pt-2 animate-fade-in-up">
                                  <div className="space-y-2">
                                    <Label className="text-[10px] text-slate-500 uppercase font-mono flex items-center justify-between">
                                      <span>WhatsApp (Grupo Setores)</span>
                                      <button type="button" onClick={() => setSectorsWhatsapp([...sectorsWhatsapp, ""])} className="text-emerald-600 hover:text-emerald-700 transition-colors bg-emerald-100 rounded w-5 h-5 flex items-center justify-center font-bold">
                                        +
                                      </button>
                                    </Label>
                                    {sectorsWhatsapp.map((val, idx) => (
                                      <div key={idx} className="flex gap-2">
                                        <Input
                                          value={val}
                                          onChange={(e) => {
                                            const newArr = [...sectorsWhatsapp];
                                            newArr[idx] = e.target.value;
                                            setSectorsWhatsapp(newArr);
                                          }}
                                          placeholder="Ex: (11) 99999-0000"
                                          className="h-10 text-sm border-slate-300 bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 text-slate-900 shadow-sm"
                                        />
                                        {sectorsWhatsapp.length > 1 && (
                                          <button type="button" onClick={() => setSectorsWhatsapp(sectorsWhatsapp.filter((_, i) => i !== idx))} className="h-10 w-10 shrink-0 flex items-center justify-center rounded-xl bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200 transition-colors shadow-sm">
                                            -
                                          </button>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                  <div className="space-y-2">
                                    <Label className="text-[10px] text-slate-500 uppercase font-mono flex items-center justify-between">
                                      <span>E-mail (Setores)</span>
                                      <button type="button" onClick={() => setSectorsEmail([...sectorsEmail, ""])} className="text-emerald-600 hover:text-emerald-700 transition-colors bg-emerald-100 rounded w-5 h-5 flex items-center justify-center font-bold">
                                        +
                                      </button>
                                    </Label>
                                    {sectorsEmail.map((val, idx) => (
                                      <div key={idx} className="flex gap-2">
                                        <Input
                                          type="email"
                                          value={val}
                                          onChange={(e) => {
                                            const newArr = [...sectorsEmail];
                                            newArr[idx] = e.target.value;
                                            setSectorsEmail(newArr);
                                          }}
                                          placeholder="Ex: operacoes@geracaodigital.com.br"
                                          className="h-10 text-sm border-slate-300 bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 text-slate-900 shadow-sm"
                                        />
                                        {sectorsEmail.length > 1 && (
                                          <button type="button" onClick={() => setSectorsEmail(sectorsEmail.filter((_, i) => i !== idx))} className="h-10 w-10 shrink-0 flex items-center justify-center rounded-xl bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200 transition-colors shadow-sm">
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

                        {/* Configuração de Grupos no WhatsApp */}
                        <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50 space-y-4 mt-5 shadow-sm">
                          <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                            <h4 className="text-xs font-bold text-[#25D366] uppercase tracking-wider">Criação de Grupo no WhatsApp</h4>
                          </div>
                          <label className="flex items-center gap-3 cursor-pointer group">
                            <input
                              type="checkbox"
                              checked={createWhatsappGroup}
                              onChange={(e) => setCreateWhatsappGroup(e.target.checked)}
                              className="rounded border-slate-300 bg-white text-[#25D366] focus:ring-[#25D366] h-4 w-4 shadow-sm"
                            />
                            <div className="text-left">
                              <span className="text-sm font-bold text-slate-700 block group-hover:text-[#25D366] transition-colors">Criar Grupo Automaticamente e Convidar Membros</span>
                            </div>
                          </label>

                          {createWhatsappGroup && (
                            <div className="grid md:grid-cols-2 gap-5 pt-3 animate-fade-in-up">
                              <div className="space-y-1.5">
                                <Label className="text-[10px] text-slate-500 uppercase font-mono">Nome do Grupo</Label>
                                <Input
                                  value={whatsappGroupName}
                                  onChange={(e) => setWhatsappGroupName(e.target.value)}
                                  placeholder="Ex: GD & Nome do Cliente"
                                  className="h-10 text-sm border-slate-300 bg-white focus:border-[#25D366] focus:ring-4 focus:ring-[#25D366]/10 text-slate-900 shadow-sm"
                                />
                                <p className="text-[10px] text-slate-500 mt-1.5 leading-tight">O cliente e você serão adicionados automaticamente.</p>
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-[10px] text-slate-500 uppercase font-mono whitespace-nowrap">Outros Resp. (WhatsApp)</Label>
                                <Input
                                  value={whatsappGroupMembers}
                                  onChange={(e) => setWhatsappGroupMembers(e.target.value)}
                                  placeholder="Ex: 11999999999, 11888888888"
                                  className="h-10 text-sm border-slate-300 bg-white focus:border-[#25D366] focus:ring-4 focus:ring-[#25D366]/10 text-slate-900 shadow-sm"
                                />
                                <p className="text-[10px] text-slate-500 mt-1.5 leading-tight">Separe os números adicionais por vírgula.</p>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Configuração do Slack */}
                        <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50 space-y-4 mt-5 shadow-sm">
                          <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                            <h4 className="text-xs font-bold text-blue-600 uppercase tracking-wider">Configuração do Workspace (Slack)</h4>
                          </div>
                          
                          <div className="space-y-4 pt-1">
                            {/* Nome do canal principal */}
                            <div className="space-y-1.5">
                              <Label className="text-[10px] text-slate-500 uppercase font-mono">Canal Principal</Label>
                              <div className="flex items-center bg-white border border-slate-300 rounded-xl overflow-hidden focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/10 shadow-sm transition-all">
                                <span className="pl-3 pr-2 text-slate-400"><Hash className="w-4 h-4" /></span>
                                <Input
                                  value={slackChannelName}
                                  onChange={(e) => setSlackChannelName(e.target.value)}
                                  className="h-10 text-sm border-none bg-transparent text-slate-900 px-1 shadow-none focus-visible:ring-0"
                                />
                              </div>
                            </div>

                            {/* Canais Adicionais */}
                            <div className="space-y-1.5">
                              <Label className="text-[10px] text-slate-500 uppercase font-mono">Canais Adicionais a Criar</Label>
                              <div className="flex gap-2">
                                <div className="flex-1 flex items-center bg-white border border-slate-300 rounded-xl overflow-hidden focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/10 shadow-sm transition-all">
                                  <span className="pl-3 pr-2 text-slate-400"><Hash className="w-4 h-4" /></span>
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
                                    className="h-10 text-sm border-none bg-transparent text-slate-900 px-1 shadow-none focus-visible:ring-0"
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
                                  className="h-10 px-4 bg-blue-100 text-blue-700 hover:bg-blue-200 text-sm font-bold rounded-xl shadow-sm"
                                >
                                  Adicionar
                                </Button>
                              </div>
                              {slackExtraChannels.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-3">
                                  {slackExtraChannels.map((ch, idx) => (
                                    <Badge key={idx} className="bg-slate-200 text-slate-700 text-[11px] font-mono border-slate-300 py-1 px-2.5 flex items-center gap-1.5 shadow-sm">
                                      #{ch}
                                      <button type="button" onClick={() => setSlackExtraChannels(slackExtraChannels.filter((_, i) => i !== idx))} className="text-rose-500 hover:text-rose-700 ml-1">×</button>
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Membros Responsáveis */}
                            <div className="space-y-2 pt-2">
                              <Label className="text-[10px] text-slate-500 uppercase font-mono block">Responsáveis (Membros do Slack)</Label>
                              {isLoadingSlack ? (
                                <div className="text-[11px] text-slate-500 italic px-2 py-2">Buscando usuários do Slack...</div>
                              ) : slackError ? (
                                <div className="text-[11px] text-rose-500 font-medium px-2 py-2">⚠️ {slackError}</div>
                              ) : slackUsers.length > 0 ? (
                                <div className="max-h-32 overflow-y-auto bg-white rounded-xl border border-slate-200 p-3 grid grid-cols-2 gap-2 custom-scrollbar shadow-sm">
                                  {slackUsers.map((u) => {
                                    const isSelected = slackMembers.includes(u.id);
                                    return (
                                      <label key={u.id} className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-blue-50 border border-blue-200' : 'hover:bg-slate-50 border border-transparent'}`}>
                                        <input
                                          type="checkbox"
                                          checked={isSelected}
                                          onChange={(e) => {
                                            if (e.target.checked) setSlackMembers([...slackMembers, u.id]);
                                            else setSlackMembers(slackMembers.filter(id => id !== u.id));
                                          }}
                                          className="rounded border-slate-300 bg-white text-blue-600 focus:ring-blue-500 h-4 w-4 shadow-sm"
                                        />
                                        <div className="flex items-center gap-2 overflow-hidden">
                                          {u.image && <img src={u.image} alt={u.name} className="w-6 h-6 rounded-full" />}
                                          <span className="text-[11px] text-slate-700 truncate font-semibold">{u.name}</span>
                                        </div>
                                      </label>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="text-[11px] text-slate-500 italic px-2 py-2">Nenhum usuário encontrado no workspace.</div>
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
                                createWhatsappGroup,
                                whatsappGroupName,
                                whatsappGroupMembers,
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
                              if (responseData.slackStatus === "failed") {
                                throw new Error(responseData.slackError || "Falha ao criar os canais no Slack. Verifique os tokens do bot.");
                              }
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
                              setSlackExtraChannels([]);
                              setNewExtraChannel("");
                              setSlackMembers([]);
                              setCreateWhatsappGroup(false);
                              setWhatsappGroupMembers("");
                              // whatsappGroupName is set automatically by prospectName effect
                              
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
                          className="w-full bg-emerald-600 hover:bg-emerald-700 font-black text-sm text-white h-12 shadow-lg shadow-emerald-600/20 mt-6 flex items-center justify-center gap-2 rounded-xl"
                        >
                          {isDispatching ? (
                            <>
                              <RefreshCw className="h-5 w-5 animate-spin text-white" />
                              Disparando Briefing...
                            </>
                          ) : (
                            <>
                              <Zap className="h-5 w-5 text-white" />
                              Enviar Briefing & Disparar Handoff
                            </>
                          )}
                        </Button>
                      </div>
                    ) : (
                      <div className="text-center space-y-5 animate-fade-in-up py-8 flex-1 flex flex-col justify-center items-center">
                        <div className="h-16 w-16 rounded-full bg-emerald-100 border border-emerald-200 flex items-center justify-center text-emerald-600 animate-bounce shadow-sm">
                          <CheckCircle2 className="h-8 w-8" />
                        </div>
                        <div className="space-y-1.5">
                          <h4 className="text-xl font-black text-slate-800">Dossiê Enviado com Sucesso!</h4>
                          <p className="text-xs text-slate-500">As informações foram consolidadas e enviadas para os canais ativos.</p>
                        </div>

                        <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-[11px] font-mono text-slate-600 text-left space-y-2 w-full max-w-sm shadow-sm">
                          <p><span className="text-indigo-600 font-bold">CLIENTE:</span> {theme.prospectName}</p>
                          {sendToProspectWhatsapp && <p><span className="text-emerald-600 font-bold">WHATSAPP:</span> {theme.whatsappNumber} ({dispatchResult?.evolutionStatus === 'sent' ? 'Enviado' : 'Não configurado/Falha'})</p>}
                          {sendToProspectEmail && <p><span className="text-blue-600 font-bold">E-MAIL:</span> {prospectEmail} ({dispatchResult?.emailStatus === 'sent' ? 'Enviado' : 'Não configurado/Falha'})</p>}
                          {sendToSectors && (
                            <>
                              <p><span className="text-purple-600 font-bold">WHATSAPP SETORES:</span> {sectorsWhatsapp} ({dispatchResult?.sectorsStatus?.includes('wpp:sent') ? 'Enviado' : 'Não configurado/Falha'})</p>
                              <p><span className="text-pink-600 font-bold">E-MAIL SETORES:</span> {sectorsEmail} ({dispatchResult?.sectorsStatus?.includes('email:sent') ? 'Enviado' : 'Não configurado/Falha'})</p>
                            </>
                          )}
                          {(createWhatsappGroup || slackChannelName) && (
                            <div className="pt-2 mt-2 border-t border-slate-200">
                              <p className="font-bold text-slate-500 mb-1">COMUNICAÇÃO:</p>
                              {createWhatsappGroup && <p className="text-emerald-600"><span className="font-bold">GRUPO WPP:</span> {whatsappGroupName} ({dispatchResult?.whatsappGroupStatus === 'created' ? 'Criado' : 'Não configurado/Falha'})</p>}
                              {slackChannelName && <p className="text-blue-600"><span className="font-bold">SLACK CHANNELS:</span> #{slackChannelName} ({dispatchResult?.slackStatus === 'success' ? 'Criados' : 'Não configurado/Falha'})</p>}
                            </div>
                          )}
                        </div>

                        <div className="flex gap-3 w-full max-w-sm pt-4">
                          <Button
                            variant="outline"
                            onClick={() => setDispatchSuccess(false)}
                            className="flex-1 border-slate-200 hover:bg-slate-50 text-slate-600 text-sm font-bold h-11 rounded-xl shadow-sm"
                          >
                            Voltar
                          </Button>
                          <Button
                            onClick={() => {
                              setIsPresenting(false);
                              setDispatchSuccess(false);
                            }}
                            className="flex-1 bg-slate-800 hover:bg-slate-900 text-white text-sm font-bold h-11 rounded-xl shadow-sm"
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
