import { type Dispatch, type SetStateAction } from "react";
import { Archive, Clock3, Pause, Play, Plus, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { InfoTip } from "@/components/InfoTip";
import { cn } from "@/lib/utils";
import type { CampaignDispatchOptions } from "@/hooks/useCampanhas";
import type {
  ConsultantSchedule,
  useCreateConsultantSchedule,
  useDeleteConsultantSchedule,
  useUpdateConsultantSchedule,
} from "@/hooks/useConsultantSchedules";
import { darkSelectContentClass, darkSelectItemClass } from "./styles";

interface SchedulingStepProps {
  dispatchOptions: CampaignDispatchOptions;
  setDispatchOptions: Dispatch<SetStateAction<CampaignDispatchOptions>>;
  evolutionInstanceOptions: { id: string; name: string; isDefault?: boolean }[];

  batchingEnabled: boolean;
  setBatchingEnabled: Dispatch<SetStateAction<boolean>>;
  batchSize: string;
  setBatchSize: Dispatch<SetStateAction<string>>;
  batchIntervalHours: string;
  setBatchIntervalHours: Dispatch<SetStateAction<string>>;

  multiAgendaEnabled: boolean;
  setMultiAgendaEnabled: Dispatch<SetStateAction<boolean>>;
  consultants: ConsultantSchedule[];
  updateConsultant: ReturnType<typeof useUpdateConsultantSchedule>;
  deleteConsultant: ReturnType<typeof useDeleteConsultantSchedule>;
  activeClientId: string;
  newConsultantName: string;
  setNewConsultantName: Dispatch<SetStateAction<string>>;
  newConsultantLink: string;
  setNewConsultantLink: Dispatch<SetStateAction<string>>;
  onCreateConsultant: () => void;
  createConsultant: ReturnType<typeof useCreateConsultantSchedule>;

  newTriggerType: "manual" | "scheduled" | "draft";
  setNewTriggerType: Dispatch<SetStateAction<"manual" | "scheduled" | "draft">>;
  newScheduledAt: string;
  setNewScheduledAt: Dispatch<SetStateAction<string>>;

  onSubmit: () => void;
  isSubmitting: boolean;
  editingCampaignId: string | null;
  onCancelEdit: () => void;
}

export function SchedulingStep({
  dispatchOptions,
  setDispatchOptions,
  evolutionInstanceOptions,
  batchingEnabled,
  setBatchingEnabled,
  batchSize,
  setBatchSize,
  batchIntervalHours,
  setBatchIntervalHours,
  multiAgendaEnabled,
  setMultiAgendaEnabled,
  consultants,
  updateConsultant,
  deleteConsultant,
  activeClientId,
  newConsultantName,
  setNewConsultantName,
  newConsultantLink,
  setNewConsultantLink,
  onCreateConsultant,
  createConsultant,
  newTriggerType,
  setNewTriggerType,
  newScheduledAt,
  setNewScheduledAt,
  onSubmit,
  isSubmitting,
  editingCampaignId,
  onCancelEdit,
}: SchedulingStepProps) {
  return (
    <Card className="border-border bg-card shadow-sm text-card-foreground rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500 text-[10px] text-white">3</span>
          Configurações de Disparo
        </CardTitle>
        <CardDescription>Defina a instância do WhatsApp, revezamento de agendas e data de envio</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Instância WhatsApp</p>
            <Select
              value={dispatchOptions.evolutionInstanceId || "company-default"}
              onValueChange={(val) => setDispatchOptions(curr => ({ ...curr, evolutionInstanceId: val === "company-default" ? null : val }))}
            >
              <SelectTrigger className="h-10 rounded-xl text-xs">
                <SelectValue placeholder="Selecione a instância..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="company-default">Padrão da Empresa</SelectItem>
                {evolutionInstanceOptions.map((inst) => (
                  <SelectItem key={inst.id} value={inst.id}>
                    {inst.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground flex items-center gap-1">
              Atraso entre envios (segundos)
              <InfoTip text="Tempo de espera sugerido entre contatos para evitar bans no WhatsApp." />
            </p>
            <Input
              type="number"
              min="1"
              className="h-10 text-xs rounded-xl"
              value={dispatchOptions.leadDelaySeconds}
              onChange={(e) => setDispatchOptions(curr => ({ ...curr, leadDelaySeconds: Math.max(1, Number(e.target.value)) }))}
            />
          </div>
        </div>

        {/* Batch sending (Loteamento) config */}
        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 dark:border-white/5 dark:bg-slate-900/10 space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                <Archive className="h-3.5 w-3.5 text-indigo-500" />
                Enviar em Lotes (Massa)
                <InfoTip text="Suba uma base grande e divida o envio automaticamente em lotes menores espalhados no tempo." />
              </p>
              <p className="text-[10px] text-muted-foreground">Evite bans dividindo os disparos sequencialmente</p>
            </div>
            <Switch checked={batchingEnabled} onCheckedChange={setBatchingEnabled} />
          </div>

          {batchingEnabled && (
            <div className="grid gap-4 sm:grid-cols-2 pt-2 animate-fadeIn">
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-bold text-slate-500">Tamanho do Lote</label>
                <Input
                  type="number"
                  min="1"
                  placeholder="Ex: 100"
                  value={batchSize}
                  onChange={(e) => setBatchSize(e.target.value)}
                  className="h-10 text-xs rounded-xl"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] uppercase font-bold text-slate-500">Frequência de Envio</label>
                <Select
                  value={batchIntervalHours}
                  onValueChange={setBatchIntervalHours}
                >
                  <SelectTrigger className="h-10 text-xs rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={darkSelectContentClass}>
                    <SelectItem value="0.5" className={darkSelectItemClass}>A cada 30 minutos</SelectItem>
                    <SelectItem value="1" className={darkSelectItemClass}>A cada 1 hora</SelectItem>
                    <SelectItem value="2" className={darkSelectItemClass}>A cada 2 horas</SelectItem>
                    <SelectItem value="3" className={darkSelectItemClass}>A cada 3 horas</SelectItem>
                    <SelectItem value="6" className={darkSelectItemClass}>A cada 6 horas</SelectItem>
                    <SelectItem value="12" className={darkSelectItemClass}>A cada 12 horas</SelectItem>
                    <SelectItem value="24" className={darkSelectItemClass}>A cada 24 horas (diário)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        {/* Round-Robin Calendly/Agenda Integration */}
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/20 p-4 dark:border-indigo-950 dark:bg-indigo-950/10 space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                Agendamento Integrado (Multi-Agenda)
                <InfoTip text="Distribua leads entre links individuais dos consultores da equipe de vendas usando revezamento justo (Round-Robin)." />
              </p>
              <p className="text-[10px] text-muted-foreground">Substitui {"{{scheduling_link}}"} na mensagem de cada lead enviado</p>
            </div>
            <Switch checked={multiAgendaEnabled} onCheckedChange={setMultiAgendaEnabled} />
          </div>

          {multiAgendaEnabled && (
            <div className="space-y-4 animate-fadeIn">
              {/* List of consultants */}
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-bold text-slate-500">Equipe de Agendas Cadastradas</label>
                {consultants.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic bg-white/50 dark:bg-black/20 p-3 rounded-xl border border-slate-200/50 dark:border-white/5">Nenhum consultor cadastrado para Rotação. Adicione um abaixo.</p>
                ) : (
                  <div className="grid gap-2 max-h-[220px] overflow-y-auto pr-1">
                    {consultants.map((c) => (
                      <div key={c.id} className="flex items-center justify-between bg-white dark:bg-black/35 p-2.5 rounded-xl border border-slate-200/80 dark:border-white/5 text-xs shadow-sm">
                        <div className="min-w-0 flex-1 pr-2">
                          <p className="font-bold text-slate-800 dark:text-slate-200 truncate">{c.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate font-mono">{c.scheduling_link}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Switch
                            checked={c.active}
                            onCheckedChange={(checked) => {
                              updateConsultant.mutate({ id: c.id, clientId: activeClientId, active: checked });
                            }}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => deleteConsultant.mutate({ id: c.id, clientId: activeClientId })}
                            className="h-8 w-8 p-0 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-lg"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add new consultant form */}
              <div className="border-t border-indigo-100/50 dark:border-white/5 pt-3 space-y-3">
                <p className="text-[10px] uppercase font-bold text-slate-500">Cadastrar Novo Consultor na Base</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    placeholder="Nome do Consultor"
                    value={newConsultantName}
                    onChange={e => setNewConsultantName(e.target.value)}
                    className="h-9 text-xs rounded-xl"
                  />
                  <Input
                    placeholder="Link da Agenda (Ex: https://calendly.com/...)"
                    value={newConsultantLink}
                    onChange={e => setNewConsultantLink(e.target.value)}
                    className="h-9 text-xs font-mono rounded-xl"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={onCreateConsultant}
                  disabled={createConsultant.isPending}
                  className="w-full h-9 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-sm"
                >
                  <Plus className="h-4 w-4 mr-1" /> {createConsultant.isPending ? "Salvando..." : "Salvar na Base"}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Trigger Types */}
        <div className="space-y-3 border-t border-slate-100 dark:border-white/5 pt-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Momento do disparo</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Button
              type="button"
              variant={newTriggerType === "manual" ? "default" : "outline"}
              className={newTriggerType === "manual" ? "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 h-auto py-2" : "h-auto py-2"}
              onClick={() => setNewTriggerType("manual")}
            >
              <Play className="mr-2 h-4 w-4" />
              <div className="text-left">
                <div className="font-semibold">Disparar Agora</div>
                <div className="text-[10px] opacity-80">Execução imediata</div>
              </div>
            </Button>
            <Button
              type="button"
              variant={newTriggerType === "scheduled" ? "default" : "outline"}
              className={newTriggerType === "scheduled" ? "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 h-auto py-2" : "h-auto py-2"}
              onClick={() => setNewTriggerType("scheduled")}
            >
              <Clock3 className="mr-2 h-4 w-4" />
              <div className="text-left">
                <div className="font-semibold">Agendado</div>
                <div className="text-[10px] opacity-80">Data e hora definida</div>
              </div>
            </Button>
            <Button
              type="button"
              variant={newTriggerType === "draft" ? "default" : "outline"}
              className={newTriggerType === "draft" ? "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 h-auto py-2" : "h-auto py-2"}
              onClick={() => setNewTriggerType("draft")}
            >
              <Pause className="mr-2 h-4 w-4" />
              <div className="text-left">
                <div className="font-semibold">Rascunho</div>
                <div className="text-[10px] opacity-80">Salvar em standby</div>
              </div>
            </Button>
          </div>

          {newTriggerType === "scheduled" && (
            <div className="space-y-1.5 animate-fadeIn">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Data e Hora do Agendamento</label>
              <Input
                type="datetime-local"
                value={newScheduledAt}
                onChange={(e) => setNewScheduledAt(e.target.value)}
                className="h-10 text-xs rounded-xl"
              />
            </div>
          )}
        </div>

        <div className="pt-2">
          <Button
            onClick={onSubmit}
            disabled={isSubmitting}
            className="w-full h-11 text-xs font-bold gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow"
          >
            <Zap className="h-4 w-4" />
            {editingCampaignId
              ? "Salvar Alterações de Campanha"
              : (newTriggerType === "manual"
                ? "Salvar e Disparar Lote Agora"
                : (newTriggerType === "scheduled" ? "Salvar e Agendar Disparo" : "Salvar Campanha em Rascunho")
              )
            }
          </Button>
          {editingCampaignId && (
            <Button
              variant="outline"
              onClick={onCancelEdit}
              className="w-full h-11 text-xs font-bold mt-2 rounded-xl"
            >
              Cancelar Edição / Nova Campanha
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
