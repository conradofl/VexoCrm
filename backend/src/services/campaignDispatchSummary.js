// backend/src/services/campaignDispatchSummary.js
//
// "Uma linha por campanha, lote vira quadrado" — lógica pura de agregação de
// campaign_dispatches por campanha: status agregado (por precedência) e
// estimativa aproximada de término pela cota diária do chip. Sem banco aqui —
// a rota lê as linhas, estas funções só decidem o que elas significam juntas.
// Mantido separado pra poder testar a regra de precedência e a matemática de
// ETA sem precisar montar um Postgres.

import { WEEKDAY_LABELS, WEEKDAYS_ORDER } from "./sendWindow.js";

// Estados finais de um lote — nada mais vai acontecer com ele.
export const FINAL_DISPATCH_STATUSES = ["done", "cancelled"];
// Estados "ainda tem trabalho": aguardando, pausado, ou que falhou e pode
// ser retentado. 'running' fica de fora — tem regra própria (sempre vence).
export const PENDING_DISPATCH_STATUSES = ["draft", "scheduled", "paused", "failed", "interrupted"];

export const AGGREGATE_STATUS_LABELS = {
  enviando: "Enviando",
  concluida: "Concluída",
  cancelada: "Cancelada",
  agendada: "Agendada",
  pausada: "Pausada",
};

/**
 * Uma campanha está "Ativa" (exige decisão hoje) se algum lote ainda não
 * chegou a um estado final. "Encerrada" é o oposto: todo lote é done ou
 * cancelled. Pausada tem lote pendente (o próprio lote pausado) — por isso
 * conta como Ativa, nunca Encerrada.
 */
export function isCampaignActive(dispatchStatuses) {
  return (dispatchStatuses || []).some((s) => !FINAL_DISPATCH_STATUSES.includes(s));
}

/**
 * Status agregado da campanha a partir do status de cada lote, por
 * precedência (primeira regra que bate, vale):
 *   1. algum lote 'running'                          → Enviando
 *   2. todo lote 'done'                               → Concluída
 *   3. algum 'cancelled' e nenhum pendente             → Cancelada
 *   4. algum draft/scheduled/failed/interrupted        → Agendada
 *   5. algum 'paused'                                  → Pausada
 * As cinco regras cobrem toda combinação possível dos 8 status conhecidos
 * (running/draft/scheduled/paused/done/failed/cancelled/interrupted) — não
 * existe estado que caia fora delas.
 */
export function aggregateDispatchStatus(dispatchStatuses) {
  const statuses = Array.isArray(dispatchStatuses) ? dispatchStatuses : [];
  if (statuses.length === 0) return null;

  if (statuses.includes("running")) return "enviando";
  if (statuses.every((s) => s === "done")) return "concluida";

  const hasPending = statuses.some((s) => PENDING_DISPATCH_STATUSES.includes(s));
  if (statuses.includes("cancelled") && !hasPending) return "cancelada";
  if (statuses.some((s) => ["draft", "scheduled", "failed", "interrupted"].includes(s))) return "agendada";
  if (statuses.includes("paused")) return "pausada";

  // Combinação não prevista (não deveria acontecer com os 8 status válidos).
  return "concluida";
}

/**
 * Estimativa aproximada de término, pela cota diária do chip: leads na fila
 * dividido pelo que sobra da cota, em dias — respeitando os dias da semana
 * da janela de envio do tenant. Nunca devolve minuto exato: a hora que sai é
 * sempre o FIM da janela de envio daquele dia (o pior caso, não uma previsão
 * fina). "hoje" quando a cota que resta hoje já dá conta do que falta.
 *
 * @returns {null | { isToday: boolean, weekday: string|null, label: string }}
 */
export function estimateDispatchCompletion({
  pendingLeads,
  dailyLimit,
  sentToday = 0,
  windowDays = ["mon", "tue", "wed", "thu", "fri"],
  windowEnd = "20:00",
  now = new Date(),
}) {
  const pending = Math.max(Number(pendingLeads) || 0, 0);
  if (pending === 0) return null;

  const limit = Math.max(Number(dailyLimit) || 0, 0);
  if (limit <= 0) {
    return { isToday: false, weekday: null, label: "sem cota disponível hoje — confira o chip" };
  }

  const used = Math.max(Number(sentToday) || 0, 0);
  const days = Array.isArray(windowDays) && windowDays.length > 0 ? windowDays : ["mon", "tue", "wed", "thu", "fri"];
  const endHour = String(windowEnd || "20:00").split(":")[0].padStart(2, "0");

  let remaining = pending;
  const cursor = new Date(now.getTime());
  let isFirstDay = true;

  // Teto de 60 dias: além disso a resposta certa é "revise a cota", não uma data.
  for (let guard = 0; guard < 60; guard++) {
    const weekday = WEEKDAYS_ORDER[cursor.getDay()];
    const capacityToday = isFirstDay ? Math.max(limit - used, 0) : limit;
    const inWindow = days.includes(weekday);

    if (inWindow && capacityToday > 0) {
      if (remaining <= capacityToday) {
        return {
          isToday: isFirstDay,
          weekday,
          label: `${isFirstDay ? "hoje" : WEEKDAY_LABELS[weekday].toLowerCase()}, por volta das ${endHour}h`,
        };
      }
      remaining -= capacityToday;
    }

    isFirstDay = false;
    cursor.setDate(cursor.getDate() + 1);
  }

  return { isToday: false, weekday: null, label: "mais de 60 dias — confira a cota do chip" };
}
