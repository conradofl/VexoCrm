import { useState, useEffect } from "react";
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Play,
  Pause,
  GripVertical,
  Copy,
  Paperclip,
  RotateCcw,
  Clock,
  Pencil,
  MessageSquare,
  ListPlus,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useFupCampaigns,
  useCreateFupCampaign,
  useUpdateFupCampaign,
  useDeleteFupCampaign,
  useCloneFupCampaign,
  useFupTemplates,
  useDeleteFupTemplate,
  useReorderFupTemplates,
  useReschedulePendingJobs,
  useAnchorFields,
  type FupTemplate,
  type AnchorFieldOption,
} from "@/hooks/useFollowupAdmin";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { resolveTenantPlan, hasFeatureUnlocked } from "@/lib/planTier";
import { describeStep as formatStepDescription } from "@/lib/followup/describeStep";
import StepDrawer from "./StepDrawer";

// Editor de cadências de follow-up: Trilha vertical com cards e drawer lateral de criação/edição.

function describeStep(step: FupTemplate, anchorFields?: AnchorFieldOption[]) {
  return formatStepDescription(step, anchorFields);
}

function renderMessageWithHighlight(text: string) {
  if (!text) return null;
  const parts = text.split(/(\{\{[^}]+\}\})/g);
  return parts.map((part, i) => {
    if (/^\{\{.*\}\}$/.test(part)) {
      return (
        <span
          key={i}
          className="font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 px-1 py-0.5 rounded text-[11px]"
        >
          {part}
        </span>
      );
    }
    return part;
  });
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
  const cloneCadence = useCloneFupCampaign();

  const selected = cadences.find((c) => c.id === selectedId) || null;
  const { data: steps = [] } = useFupTemplates(selectedId || undefined);
  const orderedSteps = [...steps].sort((a, b) => a.order_index - b.order_index);

  const deleteStep = useDeleteFupTemplate();
  const reorderSteps = useReorderFupTemplates();
  const reschedulePendingJobs = useReschedulePendingJobs();

  const { data: anchorFields = [] } = useAnchorFields();

  // Drawer de passo (criar ou editar)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingStep, setEditingStep] = useState<FupTemplate | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [reschedulePrompt, setReschedulePrompt] = useState<{
    templateId: string;
    stepName: string;
    pendingCount: number;
  } | null>(null);

  // Fecha o drawer e limpa a edição ao trocar de cadência
  useEffect(() => {
    setIsDrawerOpen(false);
    setEditingStep(null);
  }, [selectedId]);

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

  async function handleCloneCadence() {
    if (!selected) return;
    try {
      const res = await cloneCadence.mutateAsync({ campaignId: selected.id });
      toast.success("Cadência duplicada com sucesso como rascunho!");
      if (res?.campaign?.id) {
        setSelectedId(res.campaign.id);
      }
    } catch (err: any) {
      toast.error(err?.message || "Falha ao duplicar cadência.");
    }
  }

  async function handleReschedulePending(templateId: string) {
    try {
      const res = await reschedulePendingJobs.mutateAsync({ templateId });
      toast.success(`${res.rescheduledCount} envio(s) pendente(s) reagendado(s) com sucesso.`);
      setReschedulePrompt(null);
    } catch (err: any) {
      toast.error(err?.message || "Falha ao reagendar envios pendentes.");
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCloneCadence}
                  disabled={cloneCadence.isPending}
                  title="Duplicar cadência com todos os passos"
                >
                  <Copy className="h-4 w-4 mr-1" />
                  {cloneCadence.isPending ? "Duplicando..." : "Duplicar"}
                </Button>
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

          {/* Trilha vertical de passos */}
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Linha do tempo da cadência</p>
                  <p className="text-xs text-muted-foreground">
                    Sequência de disparos automáticos via WhatsApp
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {orderedSteps.length} passo(s)
                  </span>
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditingStep(null);
                      setIsDrawerOpen(true);
                    }}
                    className="h-7 text-xs gap-1"
                  >
                    <Plus className="h-3.5 w-3.5" /> Adicionar passo
                  </Button>
                </div>
              </div>

              {orderedSteps.length === 0 ? (
                <div className="text-center py-6 border border-dashed rounded-lg space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Nenhum passo configurado nesta cadência.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingStep(null);
                      setIsDrawerOpen(true);
                    }}
                    className="text-xs gap-1"
                  >
                    <Plus className="h-3.5 w-3.5" /> Criar o primeiro passo
                  </Button>
                </div>
              ) : (
                <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-border/70">
                  {orderedSteps.map((step, index) => {
                    const isAnchor =
                      step.trigger_type === "before_anchor" || step.trigger_type === "after_anchor";
                    const isFixedDate = step.trigger_type === "fixed_date";
                    const isInactive = step.is_active === false;

                    return (
                      <div
                        key={step.id}
                        draggable
                        onDragStart={() => setDraggedIndex(index)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => handleDrop(index)}
                        className={`relative rounded-lg border transition-all ${
                          editingStep?.id === step.id
                            ? "ring-2 ring-indigo-500 border-indigo-500 bg-indigo-50/20 dark:bg-indigo-950/20 shadow-md"
                            : isInactive
                            ? "opacity-60 bg-muted/20 border-dashed border-border"
                            : isAnchor
                            ? "bg-card border-purple-500/30 hover:border-purple-500/50 shadow-sm"
                            : isFixedDate
                            ? "bg-card border-emerald-500/30 hover:border-emerald-500/50 shadow-sm"
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
                              : isFixedDate
                              ? "bg-emerald-600 text-white"
                              : "bg-indigo-600 text-white"
                          }`}
                        >
                          {index + 1}
                        </div>

                        <div className="p-3.5 space-y-2">
                          {/* Header do card: QUANDO e COMO */}
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-bold text-foreground">
                                {step.name || `Passo ${index + 1}`}
                              </span>

                              {/* QUANDO */}
                              <Badge
                                variant="outline"
                                className={`text-[10px] font-semibold ${
                                  isAnchor
                                    ? "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30"
                                    : isFixedDate
                                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                                    : "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30"
                                }`}
                              >
                                {describeStep(step, anchorFields)}
                              </Badge>

                              {/* COMO (WhatsApp + Horário ou Dentro da Janela) */}
                              <div className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/40 px-2 py-0.5 rounded border border-border/60">
                                <MessageSquare className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                                <span>
                                  {step.scheduled_time ? `às ${step.scheduled_time}` : "dentro da janela"}
                                </span>
                              </div>

                              {/* ANEXO */}
                              {step.media_path && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] bg-indigo-50/50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800 gap-1"
                                >
                                  <Paperclip className="h-3 w-3" />
                                  <span>com anexo</span>
                                </Badge>
                              )}

                              {isInactive && (
                                <Badge variant="outline" className="text-[9px] text-muted-foreground">
                                  Inativo
                                </Badge>
                              )}
                            </div>

                            {/* Ações do passo */}
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-indigo-600"
                                onClick={() => {
                                  setEditingStep(step);
                                  setIsDrawerOpen(true);
                                }}
                                title="Editar passo"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-indigo-600"
                                onClick={() => handleReschedulePending(step.id)}
                                disabled={reschedulePendingJobs.isPending}
                                title="Reagendar mensagens pendentes deste passo com o prazo atual"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
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
                          <div className="text-xs text-foreground/90 whitespace-pre-wrap break-words bg-muted/20 p-2.5 rounded-md leading-relaxed">
                            {renderMessageWithHighlight(step.message)}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Card "+" para adicionar novo passo na trilha */}
                  <div
                    onClick={() => {
                      setEditingStep(null);
                      setIsDrawerOpen(true);
                    }}
                    className="relative group flex items-center justify-center gap-2 p-3.5 rounded-lg border-2 border-dashed border-border hover:border-indigo-500 hover:bg-indigo-50/10 dark:hover:bg-indigo-950/10 cursor-pointer transition-all text-muted-foreground hover:text-indigo-600"
                  >
                    <div className="absolute -left-6 top-1/2 flex h-5 w-5 -translate-y-1/2 -translate-x-1/2 items-center justify-center rounded-full text-[10px] font-bold ring-4 ring-background bg-muted text-muted-foreground group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                      +
                    </div>
                    <Plus className="h-4 w-4" />
                    <span className="text-xs font-semibold">Adicionar novo passo</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Drawer lateral para criar / editar passos */}
          <StepDrawer
            isOpen={isDrawerOpen}
            onClose={() => {
              setIsDrawerOpen(false);
              setEditingStep(null);
            }}
            editingStep={editingStep}
            campaignId={selected.id}
            stepCount={orderedSteps.length}
            anchorFields={anchorFields}
            selectedCrmClient={selectedCrmClient}
            onSuccess={(res) => {
              if (res.timingChanged && (res.pendingJobsCount || 0) > 0) {
                setReschedulePrompt({
                  templateId: res.template.id,
                  stepName: res.template.name,
                  pendingCount: res.pendingJobsCount,
                });
              }
            }}
          />
        </div>
      )}

      {/* Modal para confirmação de reagendamento de envios pendentes */}
      {reschedulePrompt && (
        <Dialog open={true} onOpenChange={() => setReschedulePrompt(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold flex items-center gap-2">
                <Clock className="h-4 w-4 text-indigo-600" /> Reagendar envios pendentes?
              </DialogTitle>
              <DialogDescription className="text-xs">
                O prazo do passo <strong>"{reschedulePrompt.stepName}"</strong> foi alterado.
                Existem <strong>{reschedulePrompt.pendingCount}</strong> mensagem(ns) já agendada(s) para este passo na fila.
              </DialogDescription>
            </DialogHeader>
            <p className="text-xs text-muted-foreground">
              Deseja recalcular e mover os envios pendentes para o novo horário agora?
            </p>
            <DialogFooter className="gap-2 sm:gap-0 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReschedulePrompt(null)}
                className="text-xs"
              >
                Manter horários atuais
              </Button>
              <Button
                size="sm"
                onClick={() => handleReschedulePending(reschedulePrompt.templateId)}
                disabled={reschedulePendingJobs.isPending}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs gap-1.5"
              >
                {reschedulePendingJobs.isPending ? "Reagendando..." : "Reagendar agora"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
