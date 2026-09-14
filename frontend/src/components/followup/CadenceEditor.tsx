import { useState, useEffect } from "react";
import { Plus, Trash2, ArrowUp, ArrowDown, Play, Pause, Loader2, MessageSquarePlus, ListPlus, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useFupCampaigns,
  useCreateFupCampaign,
  useUpdateFupCampaign,
  useDeleteFupCampaign,
  useFupTemplates,
  useCreateFupTemplate,
  useDeleteFupTemplate,
  useReorderFupTemplates,
  useAnchorFields,
  type FupTemplate,
  type AnchorFieldOption,
} from "@/hooks/useFollowupAdmin";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { resolveTenantPlan, hasFeatureUnlocked } from "@/lib/planTier";
import { describeStep as formatStepDescription, isTimeOutsideSendWindow } from "@/lib/followup/describeStep";

// Editor de cadências de follow-up (objetivo: dar onde criar as cadências reutilizáveis
// que o Banco de Dados aplica). Uma cadência = passos (templates), cada passo = mensagem +
// quando enviar (na entrada, X antes/depois da data-alvo, ou X após a entrada sem resposta).

type TriggerType = FupTemplate["trigger_type"];

const TRIGGER_OPTIONS: {
  value: TriggerType;
  label: string;
  shortLabel: string;
  needsValue: boolean;
  requiresMeetingDate?: boolean;
}[] = [
  {
    value: "on_schedule",
    label: "Na hora da inscrição (imediato)",
    shortLabel: "na inscrição",
    needsValue: false,
    requiresMeetingDate: false,
  },
  {
    value: "after_enrollment",
    label: "X depois da inscrição (incondicional)",
    shortLabel: "após inscrição",
    needsValue: true,
    requiresMeetingDate: false,
  },
  {
    value: "no_reply",
    label: "X depois da inscrição, se não responder",
    shortLabel: "após inscrição (se sem resposta)",
    needsValue: true,
    requiresMeetingDate: false,
  },
  {
    value: "before_meeting",
    label: "X antes da data-alvo (exige data)",
    shortLabel: "antes da data-alvo",
    needsValue: true,
    requiresMeetingDate: true,
  },
  {
    value: "after_meeting",
    label: "X depois da data-alvo (exige data)",
    shortLabel: "depois da data-alvo",
    needsValue: true,
    requiresMeetingDate: true,
  },
  {
    value: "before_anchor",
    label: "X antes de uma data do lead",
    shortLabel: "antes de data do lead",
    needsValue: true,
    requiresMeetingDate: false,
  },
  {
    value: "after_anchor",
    label: "X depois de uma data do lead",
    shortLabel: "depois de data do lead",
    needsValue: true,
    requiresMeetingDate: false,
  },
];

function unitLabel(unit: string) {
  if (unit === "minutes") return "min";
  if (unit === "hours") return "h";
  return "dias";
}

function describeStep(step: FupTemplate, anchorFields?: AnchorFieldOption[]) {
  return formatStepDescription(step, anchorFields);
}

export default function CadenceEditor({ companyId }: { companyId: string }) {
  const validCompany = companyId && companyId !== "all" ? companyId : "";
  const { data: cadences = [], isLoading } = useFupCampaigns(validCompany || undefined);
  const [selectedId, setSelectedId] = useState<string>("");
  const [newCadenceName, setNewCadenceName] = useState("");

  // Auto-seleciona a primeira cadência ao carregar para o editor abrir pronto para uso
  useEffect(() => {
    if (cadences.length > 0 && (!selectedId || !cadences.some((c) => c.id === selectedId))) {
      setSelectedId(cadences[0].id);
    }
  }, [cadences, selectedId]);

  const crmClient = useOptionalCrmClient();
  const selectedCrmClient = crmClient?.selectedClient;
  const isUnlimitedCadences = hasFeatureUnlocked(selectedCrmClient, "unlimited_cadences");
  const isEssencialLimitReached = !isUnlimitedCadences && cadences.length >= 2;

  const createCadence = useCreateFupCampaign();
  const updateCadence = useUpdateFupCampaign();
  const deleteCadence = useDeleteFupCampaign();

  const selected = cadences.find((c) => c.id === selectedId) || null;
  const { data: steps = [] } = useFupTemplates(selectedId || undefined);
  const orderedSteps = [...steps].sort((a, b) => a.order_index - b.order_index);

  const createStep = useCreateFupTemplate();
  const deleteStep = useDeleteFupTemplate();
  const reorderSteps = useReorderFupTemplates();

  const { data: anchorFields = [] } = useAnchorFields();

  // Form de novo passo
  const [stepName, setStepName] = useState("");
  const [stepMessage, setStepMessage] = useState("");
  const [stepTrigger, setStepTrigger] = useState<TriggerType>("after_enrollment");
  const [stepValue, setStepValue] = useState<number>(1);
  const [stepUnit, setStepUnit] = useState<"minutes" | "hours" | "days">("days");
  const [stepScheduledTime, setStepScheduledTime] = useState<string>("");
  const [stepAnchorField, setStepAnchorField] = useState<string>("data_nascimento");
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const windowStart = selectedCrmClient?.n8n_settings?.send_window_start || "08:00";
  const windowEnd = selectedCrmClient?.n8n_settings?.send_window_end || "18:00";
  const isOutsideWindow = isTimeOutsideSendWindow(stepScheduledTime, windowStart, windowEnd);

  const triggerOpt = TRIGGER_OPTIONS.find((o) => o.value === stepTrigger)!;

  if (!validCompany) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Selecione uma empresa (WhatsApp) no topo para gerenciar as cadências.
        </CardContent>
      </Card>
    );
  }

  async function handleCreateCadence() {
    const name = newCadenceName.trim();
    if (!name) return;

    if (isEssencialLimitReached) {
      toast.error("Limite do Plano Essencial atingido (máx. 2 cadências).", {
        description: "Faça o upgrade para o Plano Avançado para criar cadências ilimitadas!",
      });
      return;
    }

    try {
      const created = await createCadence.mutateAsync({ company_id: validCompany, name });
      setNewCadenceName("");
      setSelectedId(created.id);
      toast.success("Cadência criada. Adicione os passos e ative.");
    } catch {
      toast.error("Falha ao criar a cadência.");
    }
  }

  async function toggleActive() {
    if (!selected) return;
    const next = selected.status === "active" ? "paused" : "active";
    try {
      await updateCadence.mutateAsync({ id: selected.id, company_id: validCompany, status: next });
      toast.success(next === "active" ? "Cadência ativada." : "Cadência pausada.");
    } catch {
      toast.error("Falha ao atualizar a cadência.");
    }
  }

  async function removeCadence() {
    if (!selected) return;
    if (!["draft", "archived"].includes(selected.status)) {
      toast.error("Só dá para excluir cadência em rascunho ou arquivada. Pause e arquive antes.");
      return;
    }
    try {
      await deleteCadence.mutateAsync({ id: selected.id, company_id: validCompany });
      setSelectedId("");
      toast.success("Cadência excluída.");
    } catch {
      toast.error("Falha ao excluir.");
    }
  }

  async function addStep() {
    if (!selected) return;
    if (!stepMessage.trim()) {
      toast.error("Escreva a mensagem do passo.");
      return;
    }
    const isAnchor = stepTrigger === "before_anchor" || stepTrigger === "after_anchor";
    try {
      await createStep.mutateAsync({
        campaign_id: selected.id,
        name: stepName.trim() || `Passo ${orderedSteps.length + 1}`,
        message: stepMessage.trim(),
        trigger_type: stepTrigger,
        trigger_value: triggerOpt.needsValue ? Number(stepValue) || 0 : 0,
        trigger_unit: stepUnit,
        trigger_direction:
          stepTrigger === "before_meeting" || stepTrigger === "before_anchor"
            ? "before"
            : stepTrigger === "after_meeting" || stepTrigger === "after_anchor"
            ? "after"
            : null,
        scheduled_time: stepScheduledTime || null,
        anchor_field: isAnchor ? (stepAnchorField || "data_nascimento") : null,
        is_active: true,
        order_index: orderedSteps.length,
      });
      setStepName("");
      setStepMessage("");
      setStepScheduledTime("");
      toast.success("Passo adicionado.");
    } catch {
      toast.error("Falha ao adicionar o passo.");
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= orderedSteps.length || !selected) return;
    const reordered = [...orderedSteps];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    try {
      await reorderSteps.mutateAsync({
        campaign_id: selected.id,
        items: reordered.map((s, i) => ({ id: s.id, order_index: i })),
      });
    } catch {
      toast.error("Falha ao reordenar.");
    }
  }

  async function handleDrop(targetIndex: number) {
    if (draggedIndex === null || draggedIndex === targetIndex || !selected) return;
    const reordered = [...orderedSteps];
    const [removed] = reordered.splice(draggedIndex, 1);
    reordered.splice(targetIndex, 0, removed);
    setDraggedIndex(null);
    try {
      await reorderSteps.mutateAsync({
        campaign_id: selected.id,
        items: reordered.map((s, i) => ({ id: s.id, order_index: i })),
      });
    } catch {
      toast.error("Falha ao reordenar.");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      {/* Lista de cadências */}
      <Card className="h-fit">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground">Suas Cadências</span>
            {!isUnlimitedCadences && (
              <Badge variant="outline" className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 border-amber-500/30">
                Plano Essencial: {cadences.length}/2
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Input
              placeholder={isEssencialLimitReached ? "Limite de 2 cadências atingido" : "Nome da nova cadência"}
              value={newCadenceName}
              onChange={(e) => setNewCadenceName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateCadence()}
              disabled={isEssencialLimitReached}
            />
            <Button size="icon" onClick={handleCreateCadence} disabled={createCadence.isPending || !newCadenceName.trim() || isEssencialLimitReached}>
              <ListPlus className="h-4 w-4" />
            </Button>
          </div>

          {isLoading ? (
            <p className="text-xs text-muted-foreground">Carregando…</p>
          ) : cadences.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma cadência ainda. Crie a primeira acima.</p>
          ) : (
            <div className="space-y-1">
              {cadences.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left rounded-lg border p-3 transition-colors ${
                    c.id === selectedId ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20" : "border-border hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold truncate">{c.name}</span>
                    <Badge variant={c.status === "active" ? "default" : "outline"} className="text-[10px]">
                      {c.status === "active" ? "ativa" : c.status}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{c.totalLeads} leads · {c.messagesSent} envios</p>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Editor da cadência selecionada */}
      {!selected ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Selecione ou crie uma cadência para montar os passos.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold">{selected.name}</h3>
                <p className="text-xs text-muted-foreground">
                  {orderedSteps.length} passo(s) · status: {selected.status}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={toggleActive} disabled={updateCadence.isPending}>
                  {selected.status === "active" ? <Pause className="h-4 w-4 mr-1" /> : <Play className="h-4 w-4 mr-1" />}
                  {selected.status === "active" ? "Pausar" : "Ativar"}
                </Button>
                <Button variant="ghost" size="icon" onClick={removeCadence} disabled={deleteCadence.isPending}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Passos existentes em linha do tempo vertical */}
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Linha do tempo da cadência</p>
                <span className="text-xs text-muted-foreground">
                  {orderedSteps.length} passo(s) configurado(s)
                </span>
              </div>

              {orderedSteps.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhum passo adicionado. Monte o primeiro no formulário abaixo.
                </p>
              ) : (
                <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-border">
                  {orderedSteps.map((step, index) => {
                    const isAnchor =
                      step.trigger_type === "before_anchor" || step.trigger_type === "after_anchor";
                    const isInactive = step.is_active === false;

                    return (
                      <div
                        key={step.id}
                        draggable
                        onDragStart={() => setDraggedIndex(index)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => handleDrop(index)}
                        className={`relative rounded-lg border transition-all ${
                          isInactive
                            ? "opacity-60 bg-muted/20 border-dashed border-border"
                            : isAnchor
                            ? "bg-card border-purple-500/30 hover:border-purple-500/50 shadow-sm"
                            : "bg-card border-border hover:border-border/80 shadow-sm"
                        }`}
                      >
                        {/* Timeline marker / nó */}
                        <div
                          className={`absolute -left-6 top-3.5 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full text-[10px] font-bold ring-4 ring-background ${
                            isInactive
                              ? "bg-muted-foreground text-background"
                              : isAnchor
                              ? "bg-purple-600 text-white"
                              : "bg-indigo-600 text-white"
                          }`}
                        >
                          {index + 1}
                        </div>

                        <div className="p-3.5 space-y-2">
                          {/* Header do passo com o quando em destaque à esquerda */}
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-bold text-foreground">
                                {step.name || `Passo ${index + 1}`}
                              </span>
                              <Badge
                                variant="outline"
                                className={`text-[10px] font-semibold ${
                                  isAnchor
                                    ? "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30"
                                    : "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30"
                                }`}
                              >
                                {describeStep(step, anchorFields)}
                              </Badge>
                              {isAnchor && (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20"
                                >
                                  ⚡ Automático
                                </Badge>
                              )}
                              {step.scheduled_time && (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] text-muted-foreground"
                                >
                                  🕒 {step.scheduled_time}
                                </Badge>
                              )}
                              {isInactive && (
                                <Badge variant="outline" className="text-[9px] text-muted-foreground">
                                  Inativo
                                </Badge>
                              )}
                            </div>

                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
                                title="Arraste para reordenar"
                              >
                                <GripVertical className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => move(index, -1)}
                                disabled={index === 0}
                                title="Mover para cima"
                              >
                                <ArrowUp className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => move(index, 1)}
                                disabled={index === orderedSteps.length - 1}
                                title="Mover para baixo"
                              >
                                <ArrowDown className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() =>
                                  deleteStep
                                    .mutateAsync({ id: step.id, campaign_id: selected.id })
                                    .catch(() => toast.error("Falha ao excluir passo."))
                                }
                                title="Excluir passo"
                              >
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </div>
                          </div>

                          {/* Mensagem no corpo do cartão */}
                          <div className="text-xs text-foreground/90 whitespace-pre-wrap break-words bg-muted/20 p-2.5 rounded-md">
                            {step.message}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Novo passo */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-semibold flex items-center gap-2">
                <MessageSquarePlus className="h-4 w-4" /> Adicionar passo (lembrete)
              </p>
              <div className="space-y-1.5">
                <Label className="text-xs">Nome (opcional)</Label>
                <Input value={stepName} onChange={(e) => setStepName(e.target.value)} placeholder="Ex: Lembrete 3 dias antes" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Mensagem</Label>
                <Textarea
                  value={stepMessage}
                  onChange={(e) => setStepMessage(e.target.value)}
                  placeholder="Use {{nome}} para personalizar. Ex: Oi {{nome}}, passando para lembrar da nossa reunião!"
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Quando enviar</Label>
                  <Select value={stepTrigger} onValueChange={(v) => setStepTrigger(v as TriggerType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TRIGGER_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {triggerOpt.needsValue && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Quanto</Label>
                      <Input type="number" min={0} value={stepValue} onChange={(e) => setStepValue(Number(e.target.value))} className="w-24" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Unidade</Label>
                      <Select value={stepUnit} onValueChange={(v) => setStepUnit(v as "minutes" | "hours" | "days")}>
                        <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="minutes">minutos</SelectItem>
                          <SelectItem value="hours">horas</SelectItem>
                          <SelectItem value="days">dias</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
              </div>

              {/* Seletor de âncora se for gatilho de âncora */}
              {(stepTrigger === "before_anchor" || stepTrigger === "after_anchor") && (
                <div className="space-y-1.5 p-3 rounded-md bg-purple-500/5 border border-purple-500/20">
                  <Label className="text-xs font-semibold text-purple-900 dark:text-purple-200">Qual data do lead</Label>
                  <Select value={stepAnchorField} onValueChange={setStepAnchorField}>
                    <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {anchorFields.length > 0 ? (
                        anchorFields.map((f) => (
                          <SelectItem key={f.key} value={f.key}>
                            {f.label}
                          </SelectItem>
                        ))
                      ) : (
                        <>
                          <SelectItem value="data_nascimento">Aniversário do lead</SelectItem>
                          <SelectItem value="meeting_datetime">Data da reunião</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    buscada automaticamente no cadastro do lead
                  </p>
                </div>
              )}

              {/* Hora fixa (opcional para qualquer passo) */}
              <div className="space-y-1.5">
                <Label className="text-xs">Enviar às (opcional)</Label>
                <div className="flex items-center gap-3">
                  <Input
                    type="time"
                    value={stepScheduledTime}
                    onChange={(e) => setStepScheduledTime(e.target.value)}
                    className="w-32"
                  />
                  <span className="text-[11px] text-muted-foreground">
                    Vazio = horário flexível pelo cálculo. Preenchido = fixa o horário do disparo.
                  </span>
                </div>
                {isOutsideWindow && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                    Fora da janela ({windowStart}–{windowEnd}). Será enviado na próxima abertura.
                  </p>
                )}
              </div>

              <p className="text-[11px] text-muted-foreground">
                Dica: passos que exigem data-alvo dependem de informar a data da reunião/evento ao aplicar a cadência. Para lembretes pós-cadastro (ex: 2h ou 2 dias após a entrada), use "X depois da inscrição".
              </p>
              <Button onClick={addStep} disabled={createStep.isPending || !stepMessage.trim()} className="w-full sm:w-auto">
                {createStep.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                Adicionar passo
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
