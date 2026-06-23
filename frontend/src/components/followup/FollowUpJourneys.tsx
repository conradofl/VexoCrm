import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useFupJourneys, useUpsertFupJourney, FupJourney } from "@/hooks/useFollowupAdmin";
import { Loader2, Plus, ArrowRight, Bot, Mail, MessageSquare } from "lucide-react";
import { toast } from "sonner";

interface FollowUpJourneysProps {
  companyId: string;
}

const PREDEFINED_TRIGGERS = [
  { id: "lead_captured", title: "Novo Lead Capturado (Boas-vindas)", desc: "Enviado logo após o lead cair no sistema." },
  { id: "appointment_confirmed", title: "Agendamento Confirmado (Lembrete)", desc: "Lembrete antes da reunião." },
  { id: "no_show", title: "No-Show / Falta (Remarcação)", desc: "O lead não compareceu. Tentar reagendar." },
  { id: "deal_won", title: "Negócio Ganho / Compareceu (Pós-venda / Avaliação)", desc: "Lead compareceu ou comprou. Pedir avaliação ou pós-venda." },
  { id: "inactive_client", title: "Cliente Inativo (Reengajamento)", desc: "Lead parado há muito tempo." }
];

export function FollowUpJourneys({ companyId }: FollowUpJourneysProps) {
  const { data: journeys = [], isLoading } = useFupJourneys(companyId);
  const upsert = useUpsertFupJourney();

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

      <div className="grid gap-4">
        {PREDEFINED_TRIGGERS.map((trigger) => {
          const journey = journeys.find(j => j.trigger_event === trigger.id);
          const isActive = journey?.is_active ?? false;

          return (
            <Card key={trigger.id} className={`p-6 border ${isActive ? 'border-primary/50 bg-primary/[0.02]' : 'border-slate-200 dark:border-white/10'} transition-all`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <Switch
                      checked={isActive}
                      onCheckedChange={(val) => handleToggle(trigger.id, !val)}
                    />
                    <h3 className="font-semibold text-base">{trigger.title}</h3>
                  </div>
                  <p className="text-sm text-slate-500 mb-6">{trigger.desc}</p>

                  {isActive && (
                    <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-white/5">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Canal */}
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Canal de Envio</label>
                          <Select
                            value={journey?.channel || "whatsapp"}
                            onValueChange={(val) => handleUpdate(trigger.id, { channel: val as any })}
                          >
                            <SelectTrigger className="bg-white dark:bg-slate-900">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="whatsapp">
                                <div className="flex items-center gap-2"><MessageSquare className="w-4 h-4 text-emerald-500"/> WhatsApp</div>
                              </SelectItem>
                              <SelectItem value="email">
                                <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-blue-500"/> E-mail (Resend)</div>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Delay */}
                        <div className="space-y-2 md:col-span-2">
                          <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Atraso antes do envio (Delay)</label>
                          <div className="flex gap-2">
                            <Input
                              type="number"
                              className="w-24 bg-white dark:bg-slate-900"
                              value={journey?.delay_value ?? 0}
                              onChange={(e) => handleUpdate(trigger.id, { delay_value: Number(e.target.value) })}
                            />
                            <Select
                              value={journey?.delay_unit || "minutes"}
                              onValueChange={(val) => handleUpdate(trigger.id, { delay_unit: val as any })}
                            >
                              <SelectTrigger className="w-32 bg-white dark:bg-slate-900">
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
                      <div className="space-y-2 pt-2">
                        <label className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                          <Bot className="w-4 h-4 text-purple-500" />
                          Diretriz da IA (Prompt para geração)
                        </label>
                        <Textarea
                          placeholder="Ex: Escreva uma mensagem curta e empática perguntando por que o lead faltou à reunião e se deseja reagendar..."
                          className="min-h-[100px] resize-y bg-white dark:bg-slate-900"
                          defaultValue={journey?.ai_prompt || ""}
                          onBlur={(e) => {
                            if (e.target.value !== journey?.ai_prompt) {
                              handleUpdate(trigger.id, { ai_prompt: e.target.value });
                            }
                          }}
                        />
                        <p className="text-[11px] text-slate-400">
                          A IA receberá esta diretriz juntamente com os dados do lead (Nome, Status) para gerar a mensagem final. Salva automaticamente ao sair do campo.
                        </p>
                      </div>

                    </div>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
