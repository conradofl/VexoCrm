// Horário de cada lote do "Enviar em lotes", respeitando a janela de envio e um máximo por dia.
//
// Antes: lote i = início + i × intervalo, direto no relógio. Com 5 por hora durante 20 horas, os lotes da noite caíam
// fora da janela; o agendador empurrava todos para a abertura seguinte (08:00) e eles saíam um atrás do outro, um
// amontoado no mesmo chip (risco anotado em 17/11/2026 na Nous). Aqui o próprio plano já pula a noite e o fim de
// semana fora da janela, e para de pôr lote num dia quando o máximo diário de leads é atingido.

import { getNextSendWindowOpening, getPartsInTimezone, isWithinSendWindow, resolveSendWindowConfig } from "@/lib/sendWindow";

export interface BatchPlanInput {
  start: Date;
  count: number;
  intervalHours: number;
  /** Leads por lote (para converter o máximo diário de leads em lotes por dia). */
  size: number;
  /** Máximo de leads por dia. Vazio = sem máximo. */
  maxPerDay?: number | null;
  /** Configuração da janela da empresa (n8n_settings.send_window). Ausente = janela padrão. */
  sendWindow?: unknown;
}

function chaveDoDia(date: Date, timezone: string) {
  const p = getPartsInTimezone(date, timezone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Lotes por dia que cabem no máximo diário de leads (pelo menos 1), ou null sem máximo. */
export function lotesPorDia(size: number, maxPerDay?: number | null): number | null {
  const max = Number(maxPerDay);
  if (!Number.isFinite(max) || max <= 0) return null;
  return Math.max(1, Math.floor(max / Math.max(1, size)));
}

export function planBatchTimes(input: BatchPlanInput): Date[] {
  const janela = resolveSendWindowConfig(input.sendWindow ?? {});
  // Sem janela ligada, "dia seguinte" ainda precisa de um horário: usa a abertura padrão em todos os dias.
  const janelaParaDia = janela.enabled ? janela : { ...janela, enabled: true, days: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] };
  const intervaloMs = Math.max(0, Number(input.intervalHours) || 0) * 60 * 60 * 1000;
  const limiteDia = lotesPorDia(input.size, input.maxPerDay);
  const porDia = new Map<string, number>();
  const horarios: Date[] = [];
  let proximo = new Date(input.start.getTime());

  for (let i = 0; i < Math.max(0, input.count); i += 1) {
    let t = proximo;
    for (let guarda = 0; guarda < 400; guarda += 1) {
      if (janela.enabled && !isWithinSendWindow(t, janela)) {
        t = getNextSendWindowOpening(t, janela);
        continue;
      }
      if (limiteDia !== null && (porDia.get(chaveDoDia(t, janela.timezone)) || 0) >= limiteDia) {
        t = getNextSendWindowOpening(t, janelaParaDia);
        continue;
      }
      break;
    }
    const dia = chaveDoDia(t, janela.timezone);
    porDia.set(dia, (porDia.get(dia) || 0) + 1);
    horarios.push(t);
    proximo = new Date(t.getTime() + intervaloMs);
  }
  return horarios;
}

/** "seg 09:00" no fuso da janela. */
export function formatBatchTime(date: Date, sendWindow?: unknown): string {
  const { timezone } = resolveSendWindowConfig(sendWindow ?? {});
  return new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    .format(date)
    .replace(".", "");
}

/** Quantos dias diferentes o plano ocupa. */
export function diasDoPlano(horarios: Date[], sendWindow?: unknown): number {
  const { timezone } = resolveSendWindowConfig(sendWindow ?? {});
  return new Set(horarios.map((h) => chaveDoDia(h, timezone))).size;
}
