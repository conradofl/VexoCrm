import { useState, useEffect } from "react";
import {
  X,
  Plus,
  Pencil,
  Loader2,
  Paperclip,
  Trash2,
  FileText,
  Image as ImageIcon,
  Music,
  Video,
  AlertTriangle,
  Calendar,
  Clock,
  Zap,
  Repeat,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCreateFupTemplate,
  useUpdateFupTemplate,
  useUploadFollowupMedia,
  type FupTemplate,
  type AnchorFieldOption,
} from "@/hooks/useFollowupAdmin";
import { isTimeOutsideSendWindow } from "@/lib/followup/describeStep";

type WhenMode = "evento" | "datas_fixas" | "recorrente";

interface StepDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  editingStep: FupTemplate | null;
  campaignId: string;
  stepCount: number;
  anchorFields: AnchorFieldOption[];
  selectedCrmClient: any;
  onSuccess: (res: {
    timingChanged?: boolean;
    pendingJobsCount?: number;
    template: FupTemplate;
  }) => void;
}

export default function StepDrawer({
  isOpen,
  onClose,
  editingStep,
  campaignId,
  stepCount,
  anchorFields,
  selectedCrmClient,
  onSuccess,
}: StepDrawerProps) {
  const createStep = useCreateFupTemplate();
  const updateStep = useUpdateFupTemplate();
  const uploadMedia = useUploadFollowupMedia();

  // Estados do formulário
  const [stepName, setStepName] = useState("");
  const [stepMessage, setStepMessage] = useState("");
  const [whenMode, setWhenMode] = useState<WhenMode>("evento");

  // Modo Evento
  const [eventTrigger, setEventTrigger] = useState<
    "on_schedule" | "after_enrollment" | "before_meeting" | "after_meeting" | "no_reply"
  >("after_enrollment");
  const [stepValue, setStepValue] = useState<number>(1);
  const [stepUnit, setStepUnit] = useState<"minutes" | "hours" | "days">("days");

  // Modo Datas Fixas
  const [stepScheduledDate, setStepScheduledDate] = useState<string>("");

  // Modo Recorrente (Âncora)
  const [stepAnchorField, setStepAnchorField] = useState<string>("data_nascimento");
  const [anchorDirection, setAnchorDirection] = useState<"before_anchor" | "after_anchor">("before_anchor");
  const [anchorValue, setAnchorValue] = useState<number>(0);
  const [anchorUnit, setAnchorUnit] = useState<"minutes" | "hours" | "days">("days");

  // Comuns
  const [stepScheduledTime, setStepScheduledTime] = useState<string>("");
  const [stepMedia, setStepMedia] = useState<{
    media_path: string;
    media_type: "image" | "audio" | "document" | "video";
    media_mime: string;
    media_filename: string;
    size_bytes?: number;
  } | null>(null);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);

  // Inicializa ou limpa os campos ao abrir/trocar editingStep
  useEffect(() => {
    if (!isOpen) return;

    if (editingStep) {
      setStepName(editingStep.name || "");
      setStepMessage(editingStep.message || "");
      setStepScheduledTime(editingStep.scheduled_time || "");
      setStepScheduledDate(editingStep.scheduled_date || "");

      if (editingStep.trigger_type === "fixed_date") {
        setWhenMode("datas_fixas");
      } else if (
        editingStep.trigger_type === "before_anchor" ||
        editingStep.trigger_type === "after_anchor"
      ) {
        setWhenMode("recorrente");
        setAnchorDirection(editingStep.trigger_type);
        setStepAnchorField(editingStep.anchor_field || "data_nascimento");
        setAnchorValue(editingStep.trigger_value ?? 0);
        setAnchorUnit(editingStep.trigger_unit || "days");
      } else {
        setWhenMode("evento");
        setEventTrigger(
          editingStep.trigger_type as
            | "on_schedule"
            | "after_enrollment"
            | "before_meeting"
            | "after_meeting"
            | "no_reply"
        );
        setStepValue(editingStep.trigger_value ?? 1);
        setStepUnit(editingStep.trigger_unit || "days");
      }

      if (editingStep.media_path) {
        setStepMedia({
          media_path: editingStep.media_path,
          media_type: editingStep.media_type || "document",
          media_mime: editingStep.media_mime || "application/octet-stream",
          media_filename: editingStep.media_filename || "arquivo",
          size_bytes: 0,
        });
      } else {
        setStepMedia(null);
      }
    } else {
      // Criação limpa
      setStepName("");
      setStepMessage("");
      setWhenMode("evento");
      setEventTrigger("after_enrollment");
      setStepValue(1);
      setStepUnit("days");
      setStepScheduledDate("");
      setStepAnchorField("data_nascimento");
      setAnchorDirection("before_anchor");
      setAnchorValue(0);
      setAnchorUnit("days");
      setStepScheduledTime("");
      setStepMedia(null);
    }
  }, [isOpen, editingStep]);

  // Tecla ESC fecha o drawer
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const windowStart = selectedCrmClient?.n8n_settings?.send_window_start || "08:00";
  const windowEnd = selectedCrmClient?.n8n_settings?.send_window_end || "18:00";
  const isOutsideWindow = isTimeOutsideSendWindow(stepScheduledTime, windowStart, windowEnd);

  // Verificação de data no passado para modo "datas fixas"
  const todayStr = new Date().toISOString().slice(0, 10);
  const isDateInPast =
    whenMode === "datas_fixas" &&
    Boolean(stepScheduledDate) &&
    stepScheduledDate < todayStr;

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selectedCrmClient?.id) return;

    setIsUploadingMedia(true);
    try {
      const result = await uploadMedia.mutateAsync({
        file,
        clientId: selectedCrmClient.id,
      });
      setStepMedia({
        media_path: result.media_path,
        media_type: result.media_type,
        media_mime: result.media_mime,
        media_filename: result.media_filename,
        size_bytes: result.size_bytes,
      });
      toast.success("Arquivo anexado.");
    } catch {
      toast.error("Falha ao enviar o arquivo.");
    } finally {
      setIsUploadingMedia(false);
    }
  }

  async function handleSave() {
    if (!stepMessage.trim()) {
      toast.error("Escreva a mensagem do passo.");
      return;
    }

    let finalTriggerType: FupTemplate["trigger_type"] = "after_enrollment";
    let finalTriggerValue = 0;
    let finalTriggerUnit: "minutes" | "hours" | "days" = "days";
    let finalTriggerDirection: "before" | "after" | null = null;
    let finalAnchorField: string | null = null;
    let finalScheduledDate: string | null = null;

    if (whenMode === "evento") {
      finalTriggerType = eventTrigger;
      finalTriggerValue = eventTrigger === "on_schedule" ? 0 : Number(stepValue) || 0;
      finalTriggerUnit = stepUnit;
      finalTriggerDirection =
        eventTrigger === "before_meeting"
          ? "before"
          : eventTrigger === "after_meeting"
          ? "after"
          : null;
    } else if (whenMode === "datas_fixas") {
      if (!stepScheduledDate) {
        toast.error("Selecione a data marcada para o envio.");
        return;
      }
      finalTriggerType = "fixed_date";
      finalScheduledDate = stepScheduledDate;
      finalTriggerValue = 0;
      finalTriggerUnit = "days";
      finalTriggerDirection = null;
    } else if (whenMode === "recorrente") {
      finalTriggerType = anchorDirection;
      finalTriggerValue = Number(anchorValue) || 0;
      finalTriggerUnit = anchorUnit;
      finalTriggerDirection = anchorDirection === "before_anchor" ? "before" : "after";
      finalAnchorField = stepAnchorField || "data_nascimento";
    }

    const payload = {
      name:
        stepName.trim() ||
        (editingStep
          ? editingStep.name
          : `Passo ${stepCount + 1}`),
      message: stepMessage.trim(),
      trigger_type: finalTriggerType,
      trigger_value: finalTriggerValue,
      trigger_unit: finalTriggerUnit,
      trigger_direction: finalTriggerDirection,
      scheduled_time: stepScheduledTime || null,
      scheduled_date: finalScheduledDate,
      anchor_field: finalAnchorField,
      media_path: stepMedia?.media_path || null,
      media_type: stepMedia?.media_type || null,
      media_mime: stepMedia?.media_mime || null,
      media_filename: stepMedia?.media_filename || null,
    };

    try {
      if (editingStep) {
        const res = await updateStep.mutateAsync({
          id: editingStep.id,
          ...payload,
        });

        if ((res?.pendingJobsCount || 0) > 0) {
          toast.info(
            `Alteração salva. Vale para os ${res.pendingJobsCount} envio(s) ainda não realizado(s).`
          );
        } else {
          toast.success("Passo atualizado.");
        }

        onSuccess({
          timingChanged: res?.timingChanged,
          pendingJobsCount: res?.pendingJobsCount,
          template: res?.template || { ...editingStep, ...payload },
        });
        onClose();
      } else {
        const res = await createStep.mutateAsync({
          campaign_id: campaignId,
          ...payload,
          is_active: true,
          order_index: stepCount,
        });

        toast.success("Passo adicionado.");
        onSuccess({
          timingChanged: res?.timingChanged,
          pendingJobsCount: res?.pendingJobsCount,
          template: res?.template,
        });
        onClose();
      }
    } catch {
      toast.error(editingStep ? "Falha ao atualizar o passo." : "Falha ao adicionar o passo.");
    }
  }

  const isSaving = createStep.isPending || updateStep.isPending;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop transparente / blur que fecha ao clicar */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Painel lateral deslizante */}
      <div className="relative w-full max-w-xl bg-background border-l border-border shadow-2xl z-10 flex flex-col h-full animate-in slide-in-from-right duration-250 ease-out">
        {/* Header do Drawer */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/80 bg-muted/20 shrink-0">
          <div className="flex items-center gap-2.5">
            {editingStep ? (
              <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                <Pencil className="h-5 w-5" />
              </div>
            ) : (
              <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                <Plus className="h-5 w-5" />
              </div>
            )}
            <div>
              <h3 className="text-base font-bold text-foreground">
                {editingStep ? `Editar ${editingStep.name || "Passo"}` : "Novo Passo na Cadência"}
              </h3>
              <p className="text-xs text-muted-foreground">
                {editingStep
                  ? "As alterações valerão para todos os envios futuros e pendentes deste passo."
                  : "Defina a mensagem e o momento exato em que ela deve ser disparada."}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 text-muted-foreground hover:text-foreground rounded-full"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Corpo com scroll */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Nome do passo */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-foreground/80">Identificação do Passo (opcional)</Label>
            <Input
              value={stepName}
              onChange={(e) => setStepName(e.target.value)}
              placeholder={`Ex: Passo ${stepCount + 1} — Lembrete 2 dias antes`}
              className="text-sm"
            />
          </div>

          {/* Mensagem */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-foreground">Mensagem do WhatsApp *</Label>
              <span className="text-[11px] text-muted-foreground">
                Use <code className="text-indigo-600 dark:text-indigo-400 font-bold">{"{{nome}}"}</code> para personalizar
              </span>
            </div>
            <Textarea
              value={stepMessage}
              onChange={(e) => setStepMessage(e.target.value)}
              placeholder="Oi {{nome}}, tudo bem? Passando para lembrar da nossa conversa marcada!"
              rows={4}
              className="text-sm leading-relaxed resize-y"
            />
          </div>

          {/* Quando Enviar: 3 Modos Conceituais */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold uppercase tracking-wider text-foreground/90">
                Quando disparar este passo
              </Label>
              <span className="text-[11px] text-muted-foreground">Escolha o modo de agendamento</span>
            </div>

            {/* Seletor das 3 Abas */}
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-muted/60 dark:bg-muted/30 rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setWhenMode("evento")}
                className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-md text-xs font-semibold transition-all ${
                  whenMode === "evento"
                    ? "bg-background text-foreground shadow-sm border border-border/80"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Zap className="h-3.5 w-3.5 text-indigo-500" />
                <span>Evento</span>
              </button>

              <button
                type="button"
                onClick={() => setWhenMode("datas_fixas")}
                className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-md text-xs font-semibold transition-all ${
                  whenMode === "datas_fixas"
                    ? "bg-background text-foreground shadow-sm border border-border/80"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Calendar className="h-3.5 w-3.5 text-emerald-500" />
                <span>Data Fixa</span>
              </button>

              <button
                type="button"
                onClick={() => setWhenMode("recorrente")}
                className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-md text-xs font-semibold transition-all ${
                  whenMode === "recorrente"
                    ? "bg-background text-foreground shadow-sm border border-border/80"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Repeat className="h-3.5 w-3.5 text-purple-500" />
                <span>Recorrente</span>
              </button>
            </div>

            {/* Conteúdo da Aba 1: Relativo a um Evento */}
            {whenMode === "evento" && (
              <div className="p-4 rounded-lg bg-card border border-border space-y-3 animate-in fade-in duration-150">
                <p className="text-xs text-muted-foreground">
                  Dispara em relação à inscrição do lead ou à data-alvo informada (reunião/visita).
                </p>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Tipo de evento</Label>
                  <Select
                    value={eventTrigger}
                    onValueChange={(v) =>
                      setEventTrigger(
                        v as "on_schedule" | "after_enrollment" | "before_meeting" | "after_meeting" | "no_reply"
                      )
                    }
                  >
                    <SelectTrigger className="text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="on_schedule">{"Na hora da inscrição (imediato)"}</SelectItem>
                      <SelectItem value="after_enrollment">{"X depois da inscrição (incondicional)"}</SelectItem>
                      <SelectItem value="no_reply">{"X depois da inscrição, se não responder"}</SelectItem>
                      <SelectItem value="before_meeting">{"X antes da data-alvo (exige data)"}</SelectItem>
                      <SelectItem value="after_meeting">{"X depois da data-alvo (exige data)"}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {eventTrigger !== "on_schedule" && (
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">Tempo de espera</Label>
                      <Input
                        type="number"
                        min={0}
                        value={stepValue}
                        onChange={(e) => setStepValue(Number(e.target.value))}
                        className="text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">Unidade</Label>
                      <Select
                        value={stepUnit}
                        onValueChange={(v) => setStepUnit(v as "minutes" | "hours" | "days")}
                      >
                        <SelectTrigger className="text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="minutes">minutos</SelectItem>
                          <SelectItem value="hours">horas</SelectItem>
                          <SelectItem value="days">dias</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Conteúdo da Aba 2: Datas Fixas */}
            {whenMode === "datas_fixas" && (
              <div className="p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20 space-y-3 animate-in fade-in duration-150">
                <div>
                  <h4 className="text-xs font-bold text-emerald-800 dark:text-emerald-300">
                    Campanha de Data Marcada
                  </h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    O passo dispara nessa data para todo lead inscrito na cadência. Ideal para promoções, eventos presenciais ou virada de mês.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-foreground">Data do envio (calendário) *</Label>
                  <Input
                    type="date"
                    value={stepScheduledDate}
                    onChange={(e) => setStepScheduledDate(e.target.value)}
                    className="text-sm"
                  />
                </div>

                {isDateInPast && (
                  <div className="flex items-start gap-2 p-2.5 rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-300/80 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>
                      <strong>Atenção: esta data já passou.</strong> Novos leads inscritos nesta cadência ignorarão este passo automaticamente (motivo <em>past_date</em>).
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Conteúdo da Aba 3: Recorrente (Âncora de dados do lead) */}
            {whenMode === "recorrente" && (
              <div className="p-4 rounded-lg bg-purple-500/5 border border-purple-500/20 space-y-3 animate-in fade-in duration-150">
                <div>
                  <h4 className="text-xs font-bold text-purple-900 dark:text-purple-300">
                    Gatilho Recorrente por Data do Lead
                  </h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Calcula a data a partir de um campo específico cadastrado no lead (como aniversário).
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Campo de data do lead</Label>
                  <Select value={stepAnchorField} onValueChange={setStepAnchorField}>
                    <SelectTrigger className="text-xs">
                      <SelectValue />
                    </SelectTrigger>
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

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Direção</Label>
                  <Select
                    value={anchorDirection}
                    onValueChange={(v) => setAnchorDirection(v as "before_anchor" | "after_anchor")}
                  >
                    <SelectTrigger className="text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="before_anchor">{"X antes de uma data do lead"}</SelectItem>
                      <SelectItem value="after_anchor">{"X depois de uma data do lead"}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Quantidade</Label>
                    <Input
                      type="number"
                      min={0}
                      value={anchorValue}
                      onChange={(e) => setAnchorValue(Number(e.target.value))}
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Unidade</Label>
                    <Select
                      value={anchorUnit}
                      onValueChange={(v) => setAnchorUnit(v as "minutes" | "hours" | "days")}
                    >
                      <SelectTrigger className="text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="days">dias</SelectItem>
                        <SelectItem value="hours">horas</SelectItem>
                        <SelectItem value="minutes">minutos</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Horário Fixo do Disparo */}
          <div className="space-y-2 p-3 rounded-lg border border-border/70 bg-muted/20">
            <Label className="text-xs font-semibold flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-indigo-500" />
              Enviar às (opcional)
            </Label>
            <div className="flex items-center gap-3">
              <Input
                type="time"
                value={stepScheduledTime}
                onChange={(e) => setStepScheduledTime(e.target.value)}
                className="w-32 text-xs"
              />
              <span className="text-[11px] text-muted-foreground">
                Vazio = horário flexível da janela. Preenchido = fixa o horário do disparo.
              </span>
            </div>
            {isOutsideWindow && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                Fora da janela de envio ({windowStart}–{windowEnd}). Será remanejado para a próxima abertura.
              </p>
            )}
          </div>

          {/* Anexo de Mídia */}
          <div className="space-y-2 p-3 rounded-lg border border-border/70 bg-muted/20">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <Paperclip className="h-3.5 w-3.5 text-indigo-500" />
                Anexo de Mídia (Opcional)
              </Label>
              <span className="text-[10px] text-muted-foreground">PDF, Imagem, Áudio ou Vídeo</span>
            </div>

            {stepMedia ? (
              <div className="flex items-center justify-between p-2 rounded-md bg-background border border-border">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600">
                    {stepMedia.media_type === "image" && <ImageIcon className="h-4 w-4" />}
                    {stepMedia.media_type === "document" && <FileText className="h-4 w-4" />}
                    {stepMedia.media_type === "audio" && <Music className="h-4 w-4" />}
                    {stepMedia.media_type === "video" && <Video className="h-4 w-4" />}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-foreground">{stepMedia.media_filename}</p>
                    <p className="text-[10px] text-muted-foreground uppercase">
                      {stepMedia.media_type}{" "}
                      {stepMedia.size_bytes ? `· ${(stepMedia.size_bytes / (1024 * 1024)).toFixed(1)} MB` : ""}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setStepMedia(null)}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  title="Remover anexo"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <div>
                <label className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-md border border-dashed border-border/80 hover:border-indigo-500 bg-background hover:bg-muted/30 cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <Paperclip className="h-3.5 w-3.5" />
                  <span>{isUploadingMedia ? "Enviando arquivo..." : "Selecionar arquivo do computador"}</span>
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png,.webp,.mp3,.ogg,.wav,.mp4"
                    onChange={handleFileUpload}
                    disabled={isUploadingMedia}
                  />
                </label>
              </div>
            )}

            {stepMedia && (
              <p className="text-[11px] text-indigo-600 dark:text-indigo-400 font-medium">
                ℹ️ A mensagem escrita acima será enviada como legenda deste arquivo no WhatsApp.
              </p>
            )}
          </div>
        </div>

        {/* Rodapé com Ações */}
        <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-border bg-muted/10 shrink-0">
          <Button variant="outline" onClick={onClose} disabled={isSaving} className="text-xs">
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !stepMessage.trim()}
            className="text-xs gap-1.5"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : editingStep ? (
              <Pencil className="h-3.5 w-3.5" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            {editingStep ? "Salvar alterações" : "Adicionar passo"}
          </Button>
        </div>
      </div>
    </div>
  );
}
