import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useFupJourneys, useUpsertFupJourney, FupJourney } from "@/hooks/useFollowupAdmin";
import { Loader2, Bot, Mail, MessageSquare, Settings2, Handshake, CalendarCheck, UserX, CheckCircle2, Ghost, FileText, XCircle, ArrowRightLeft, CreditCard, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

interface FollowUpJourneysProps {
  companyId: string;
}

const PREDEFINED_TRIGGERS = [
  { id: "lead_captured", title: "Novo Lead (Boas-vindas)", desc: "Enviado logo após o lead cair no sistema.", icon: Handshake, color: "text-blue-500" },
  { id: "appointment_confirmed", title: "Agendamento (Lembrete)", desc: "Lembrete antes da reunião.", icon: CalendarCheck, color: "text-indigo-500" },
  { id: "proposal_sent", title: "Proposta Enviada (Follow-up)", desc: "Follow-up após envio da proposta sem resposta.", icon: FileText, color: "text-amber-500" },
  { id: "no_show", title: "No-Show (Remarcação)", desc: "O lead não compareceu. Tentar reagendar.", icon: UserX, color: "text-red-500" },
  { id: "deal_won", title: "Negócio Ganho (Pós-venda)", desc: "Pedir avaliação (NPS) ou feedback pós-compra.", icon: CheckCircle2, color: "text-emerald-500" },
  { id: "sdr_handoff", title: "Passagem de Bastão (SDR -> Closer)", desc: "Apresenta o executivo que assumirá o atendimento.", icon: ArrowRightLeft, color: "text-teal-500" },
  { id: "payment_pending", title: "Pagamento Pendente", desc: "Aviso amigável de boleto ou fatura próxima ao vencimento.", icon: CreditCard, color: "text-orange-500" },
  { id: "inactive_client", title: "Cliente Inativo (Reengajamento)", desc: "Lead estagnado no pipeline há muito tempo.", icon: Ghost, color: "text-slate-500" },
  { id: "break_up", title: "Despedida (Break-up)", desc: "Última tentativa antes do descarte (Psicologia reversa).", icon: XCircle, color: "text-rose-500" },
  { id: "lost_lead_recycling", title: "Reciclagem de Lead Perdido", desc: "Retomar contato meses após um negócio perdido.", icon: RotateCcw, color: "text-fuchsia-500" }
];

export function FollowUpJourneys({ companyId }: FollowUpJourneysProps) {
  const { data: journeys = [], isLoading } = useFupJourneys(companyId);
  const upsert = useUpsertFupJourney();
  const [expandedTrigger, setExpandedTrigger] = useState<string | null>(null);

  const handleToggle = (triggerId: string, currentVal: boolean) => {
    if (companyId === "all" || !companyId) return toast.error("Selecione uma empresa primeiro.");
    const existing = journeys.find(j => j.trigger_event === triggerId);
    
    upsert.mutate(
      {
        company_id: companyId,
        trigger_event: triggerId,
        is_active: !currentVal,
        channel: existing?.channel || "whatsapp",
        delay_value: existing?.delay_value || 0,
        delay_unit: existing?.delay_unit || "minutes",
        ai_prompt: existing?.ai_prompt || ""
      },
      {
        onSuccess: () => toast.success(`Jornada ${!currentVal ? "ativada" : "desativada"}!`),
        onError: (err: any) => toast.error(err.message)
      }
    );
  };

  const handleUpdate = (triggerId: string, updates: Partial<FupJourney>) => {
    if (companyId === "all" || !companyId) return;
    const existing = journeys.find(j => j.trigger_event === triggerId);
    
    upsert.mutate(
      {
        company_id: companyId,
        trigger_event: triggerId,
        is_active: existing?.is_active ?? false,
        channel: existing?.channel || "whatsapp",
        delay_value: existing?.delay_value || 0,
        delay_unit: existing?.delay_unit || "minutes",
        ai_prompt: existing?.ai_prompt || "",
        ...updates
      },
      {
        onSuccess: () => toast.success("Configuração salva com sucesso!"),
        onError: (err: any) => toast.error(err.message)
      }
    );
  };

  if (isLoading) {
    return <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>;
  }

  if (companyId === "all" || !companyId) {
    return (
      <div className="p-8 text-center text-slate-500">
        Selecione uma empresa no filtro superior para configurar as jornadas.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-bold tracking-tight">Jornadas Baseadas em Eventos</h2>
        <p className="text-sm text-slate-500">
          Configure gatilhos automatizados para o envio de mensagens usando a IA.
        </p>
      </div>

      <Card className="divide-y divide-slate-100 dark:divide-white/5 border-slate-200 dark:border-white/10">
        {PREDEFINED_TRIGGERS.map((trigger) => {
          const journey = journeys.find(j => j.trigger_event === trigger.id);
          const isActive = journey?.is_active ?? false;
          const isExpanded = expandedTrigger === trigger.id;
          const Icon = trigger.icon;

          return (
            <div key={trigger.id} className={`transition-colors ${isActive ? 'bg-primary/[0.02]' : ''}`}>
              <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                
                {/* Info (Left) */}
                <div className="flex items-center gap-4 flex-1">
                  <div className={`p-2 rounded-lg bg-white shadow-sm border border-slate-100 dark:bg-slate-900 dark:border-white/10 ${trigger.color}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm">{trigger.title}</h3>
                      {isActive && <Badge variant="secondary" className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800">Ativa</Badge>}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{trigger.desc}</p>
                  </div>
                </div>

                {/* Actions (Right) */}
                <div className="flex items-center gap-4">
                  <Switch
                    checked={isActive}
                    onCheckedChange={(val) => handleToggle(trigger.id, !val)}
                  />
                  <Button 
                    variant={isExpanded ? "secondary" : "outline"} 
                    size="sm" 
                    className="h-8 gap-2 text-xs"
                    onClick={() => setExpandedTrigger(isExpanded ? null : trigger.id)}
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                    Configurar
                  </Button>
                </div>
              </div>

              {/* Expanded Settings Panel */}
              {isExpanded && (
                <div className="px-4 pb-5 pt-2 border-t border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-slate-900/20">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
                    {/* Canal */}
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Canal de Envio</label>
                      <Select
                        value={journey?.channel || "whatsapp"}
                        onValueChange={(val) => handleUpdate(trigger.id, { channel: val as any })}
                      >
                        <SelectTrigger className="bg-white dark:bg-slate-900 h-9 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="whatsapp">
                            <div className="flex items-center gap-2"><MessageSquare className="w-3.5 h-3.5 text-emerald-500"/> WhatsApp</div>
                          </SelectItem>
                          <SelectItem value="email">
                            <div className="flex items-center gap-2"><Mail className="w-3.5 h-3.5 text-blue-500"/> E-mail (Resend)</div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Delay */}
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Atraso após o evento (Delay)</label>
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          className="w-24 h-9 bg-white dark:bg-slate-900 text-xs"
                          value={journey?.delay_value ?? 0}
                          onChange={(e) => handleUpdate(trigger.id, { delay_value: Number(e.target.value) })}
                        />
                        <Select
                          value={journey?.delay_unit || "minutes"}
                          onValueChange={(val) => handleUpdate(trigger.id, { delay_unit: val as any })}
                        >
                          <SelectTrigger className="w-32 h-9 bg-white dark:bg-slate-900 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="minutes">Minutos</SelectItem>
                            <SelectItem value="hours">Horas</SelectItem>
                            <SelectItem value="days">Dias</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  {/* Prompt */}
                  <div className="space-y-2 pt-6">
                    <label className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                      <Bot className="w-4 h-4 text-purple-500" />
                      Diretriz da IA (Contexto e tom de voz)
                    </label>
                    <Textarea
                      placeholder="Ex: Escreva uma mensagem curta e empática..."
                      className="min-h-[80px] resize-y bg-white dark:bg-slate-900 text-xs"
                      defaultValue={journey?.ai_prompt || ""}
                      onBlur={(e) => {
                        if (e.target.value !== journey?.ai_prompt) {
                          handleUpdate(trigger.id, { ai_prompt: e.target.value });
                        }
                      }}
                    />
                    <p className="text-[10px] text-slate-400">
                      A IA usará esta instrução somada aos dados do lead (Nome, Fase, Histórico) para gerar o conteúdo. Salvo automaticamente ao sair do campo.
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </Card>
    </div>
  );
}
