// frontend/src/lib/followup/describeStep.ts
// Módulo compartilhado para descrição e prévia de passos de cadência de follow-up.
// Usado unificadamente pelo CadenceEditor e pelo ApplyFollowupModal.

export type TriggerType =
  | "on_schedule"
  | "after_enrollment"
  | "before_meeting"
  | "after_meeting"
  | "no_reply"
  | "before_anchor"
  | "after_anchor";

export interface AnchorFieldInfo {
  key: string;
  label: string;
  source?: string;
  recurring?: boolean;
  description?: string;
}

export interface StepLike {
  id?: string;
  name?: string;
  message?: string;
  trigger_type?: TriggerType | string;
  trigger_value?: number;
  trigger_unit?: "minutes" | "hours" | "days" | string;
  trigger_direction?: "before" | "after" | null;
  scheduled_time?: string | null;
  anchor_field?: string | null;
  order_index?: number;
  is_active?: boolean;
}

export function unitLabel(unit: string, value = 2): string {
  if (unit === "minutes") return value === 1 ? "minuto" : "min";
  if (unit === "hours") return value === 1 ? "hora" : "horas";
  return value === 1 ? "dia" : "dias";
}

export function formatDuration(value: number, unit: string): string {
  const u = unitLabel(unit, value);
  return `${value} ${u}`;
}

export function getAnchorPhrase(
  field?: string | null,
  anchorFields?: AnchorFieldInfo[]
): string {
  if (!field || field === "data_nascimento") {
    return "do aniversário";
  }
  if (field === "meeting_datetime") {
    return "da reunião";
  }
  const match = anchorFields?.find((f) => f.key === field);
  if (match) {
    const l = match.label.toLowerCase();
    if (l.includes("aniversário")) return "do aniversário";
    if (l.includes("reunião")) return "da reunião";
    return `de ${l}`;
  }
  return `de ${field}`;
}

export function getAnchorDisplayLabel(
  field?: string | null,
  anchorFields?: AnchorFieldInfo[]
): string {
  if (!field || field === "data_nascimento") return "Aniversário";
  if (field === "meeting_datetime") return "Data da reunião";
  const match = anchorFields?.find((f) => f.key === field);
  return match?.label || field;
}

export function describeStep(
  step: StepLike,
  anchorFields?: AnchorFieldInfo[]
): string {
  const trigger = step.trigger_type;
  const val = Number(step.trigger_value) || 0;
  const unit = step.trigger_unit || "days";
  const timeSuffix = step.scheduled_time ? `, às ${step.scheduled_time}` : "";

  let base = "";

  switch (trigger) {
    case "on_schedule":
      if (step.scheduled_time) {
        base = "no dia da inscrição";
      } else {
        base = "na hora da inscrição (imediato)";
      }
      break;

    case "after_enrollment":
      base = `${formatDuration(val, unit)} depois da inscrição`;
      break;

    case "no_reply":
      base = `${formatDuration(val, unit)} depois da inscrição (se não responder)`;
      break;

    case "before_meeting":
      base = `${formatDuration(val, unit)} antes da data-alvo`;
      break;

    case "after_meeting":
      base = `${formatDuration(val, unit)} depois da data-alvo`;
      break;

    case "before_anchor":
      base = `${formatDuration(val, unit)} antes ${getAnchorPhrase(step.anchor_field, anchorFields)}`;
      break;

    case "after_anchor":
      base = `${formatDuration(val, unit)} depois ${getAnchorPhrase(step.anchor_field, anchorFields)}`;
      break;

    default:
      base = "Passo";
      break;
  }

  return `${base}${timeSuffix}`;
}

export function requiresTargetDate(step: StepLike): boolean {
  return step.trigger_type === "before_meeting" || step.trigger_type === "after_meeting";
}

export function isAnchorTrigger(step: StepLike): boolean {
  return step.trigger_type === "before_anchor" || step.trigger_type === "after_anchor";
}

export function isTimeOutsideSendWindow(
  timeStr: string | null | undefined,
  start = "08:00",
  end = "18:00"
): boolean {
  if (!timeStr) return false;
  // Comparação padrão "HH:mm" (24 horas)
  return timeStr < start || timeStr > end;
}

export interface StepPreviewResult {
  type: "valid" | "warning_no_date" | "warning_past";
  badge: string;
  message: string;
}

export function toMs(value: number, unit: string) {
  if (unit === "minutes") return value * 60 * 1000;
  if (unit === "hours") return value * 60 * 60 * 1000;
  return value * 24 * 60 * 60 * 1000;
}

export function formatDate(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function formatDateTime(d: Date): string {
  const date = formatDate(d);
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${date} às ${time}`;
}

export function getStepPreview(
  step: StepLike,
  options?: string | { meetingDatetime?: string; now?: Date; anchorFields?: AnchorFieldInfo[] }
): StepPreviewResult {
  const meetingDatetime = typeof options === "string" ? options : options?.meetingDatetime || "";
  const now = (typeof options === "object" && options?.now) ? options.now : new Date();
  const anchorFields = typeof options === "object" ? options?.anchorFields : undefined;

  const val = Number(step.trigger_value) || 0;
  const unit = step.trigger_unit || "days";
  const deltaMs = toMs(val, unit);

  // 1. Imediato / On Schedule
  if (step.trigger_type === "on_schedule") {
    if (step.scheduled_time) {
      return {
        type: "valid",
        badge: "Agendado",
        message: `Disparo previsto para hoje às ${step.scheduled_time} (na inscrição).`,
      };
    }
    return {
      type: "valid",
      badge: "Imediato",
      message: "Disparo imediato ao aplicar.",
    };
  }

  // 2. Após inscrição
  if (step.trigger_type === "after_enrollment") {
    const target = new Date(now.getTime() + deltaMs);
    const whenStr = step.scheduled_time
      ? `${formatDate(target)} às ${step.scheduled_time}`
      : formatDateTime(target);
    return {
      type: "valid",
      badge: "Agendado",
      message: `Previsto para ${whenStr} (${formatDuration(val, unit)} após inscrição).`,
    };
  }

  // 3. Sem resposta
  if (step.trigger_type === "no_reply") {
    const target = new Date(now.getTime() + deltaMs);
    const whenStr = step.scheduled_time
      ? `${formatDate(target)} às ${step.scheduled_time}`
      : formatDateTime(target);
    return {
      type: "valid",
      badge: "Condicional",
      message: `Previsto para ${whenStr} (cancela se lead responder).`,
    };
  }

  // 4. Âncoras do lead (aniversário, etc.)
  if (step.trigger_type === "before_anchor" || step.trigger_type === "after_anchor") {
    const isBirthday = !step.anchor_field || step.anchor_field === "data_nascimento";
    const anchorName = isBirthday ? "aniversário do lead" : (getAnchorDisplayLabel(step.anchor_field, anchorFields).toLowerCase() + " do lead");
    const direction = step.trigger_type === "before_anchor" ? "antes" : "depois";

    let timingText = "";
    if (val === 0) {
      timingText = isBirthday ? "no aniversário do lead" : `na data (${anchorName})`;
    } else {
      timingText = `${formatDuration(val, unit)} ${direction} do ${anchorName}`;
    }

    const scheduledMsg = step.scheduled_time ? `, às ${step.scheduled_time}` : "";

    return {
      type: "valid",
      badge: "Automático",
      message: `${timingText} (buscada automaticamente no cadastro do lead)${scheduledMsg}.`,
    };
  }

  // 5. Reunião / Data-alvo (before_meeting / after_meeting)
  if (step.trigger_type === "before_meeting" || step.trigger_type === "after_meeting") {
    if (!meetingDatetime) {
      return {
        type: "warning_no_date",
        badge: "Sem data-alvo",
        message: "Exige data-alvo informada. Este passo será ignorado.",
      };
    }

    const meetingTime = new Date(meetingDatetime).getTime();
    if (isNaN(meetingTime)) {
      return {
        type: "warning_no_date",
        badge: "Data inválida",
        message: "Data-alvo inválida.",
      };
    }

    const targetTime =
      step.trigger_type === "before_meeting" ? meetingTime - deltaMs : meetingTime + deltaMs;
    const targetDate = new Date(targetTime);

    if (targetDate.getTime() <= now.getTime()) {
      return {
        type: "warning_past",
        badge: "Horário já passou",
        message: `Cairia em ${formatDateTime(targetDate)}, que já passou. Nenhuma mensagem será agendada.`,
      };
    }

    const whenStr = step.scheduled_time
      ? `${formatDate(targetDate)} às ${step.scheduled_time}`
      : formatDateTime(targetDate);

    return {
      type: "valid",
      badge: "Agendado",
      message: `Previsto para ${whenStr}.`,
    };
  }

  return {
    type: "valid",
    badge: "Agendado",
    message: "",
  };
}
