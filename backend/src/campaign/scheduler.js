// Campaign dispatch scheduler (movido de server.js -- grupo D do mapa Onda 3, Run E).
// Movimento puro: corpos identicos aos de server.js na revisao 0ae005a (apos runs A-D).
// campaignSchedulerRunning e estado privado do modulo (era boolean copiado por valor no
// routeDeps bag -- dep estatica inutil; zero consumidores em src/domains/ e src/webhooks/,
// confirmado por grep antes da remocao do bag).

import { executeCampaignDispatch } from "./dispatch.js";
import { isMissingSchemaError } from "../services/analytics.js";
import { supabase } from "../services/database.js";
import { computeNextRecurrenceDate } from "../services/campaignRecurrence.js";

export const DEFAULT_CAMPAIGN_RUNNER_INTERVAL_MS = 60 * 1000;
export const CAMPAIGN_SCHEDULER_MAX_BATCH = 25;

export function getCampaignRunnerIntervalMs() {
  const raw = Number.parseInt(String(process.env.CAMPAIGN_RUNNER_INTERVAL_MS || ""), 10);
  if (Number.isFinite(raw) && raw >= 15_000) return raw;
  return DEFAULT_CAMPAIGN_RUNNER_INTERVAL_MS;
}

export function shouldStartCampaignScheduler() {
  return String(process.env.CAMPAIGN_SCHEDULER_ENABLED || "true").toLowerCase() !== "false";
}

let campaignSchedulerRunning = false;

export async function runDueCampaignDispatches({ limit = 10, triggerSource = "scheduler" } = {}) {
  if (!supabase) {
    return { success: false, processed: 0, sent: 0, failed: 0, items: [], reason: "DATABASE_NOT_CONFIGURED" };
  }

  const now = new Date().toISOString();
  const campaignSelect =
    "id, name, client_id, import_id, limit_per_run, webhook_url, webhook_token, status, scheduled_for, last_triggered_at, archived_at, created_by_uid, created_by_email, analytics_meta, is_recurring, recurrence_pattern, recurrence_day_of_month, recurrence_day_of_week, recurrence_time, next_run_at";
  const fallbackCampaignSelect =
    "id, name, client_id, import_id, limit_per_run, webhook_url, webhook_token, status, scheduled_for, last_triggered_at, archived_at, created_by_uid, created_by_email";

  let { data: campaigns, error } = await supabase
    .from("campaigns")
    .select(campaignSelect)
    .in("status", ["active", "scheduled"])
    .is("archived_at", null)
    .is("last_triggered_at", null)
    .not("scheduled_for", "is", null)
    .lte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .limit(limit);

  if (error && isMissingSchemaError(error)) {
    const fallback = await supabase
      .from("campaigns")
      .select(fallbackCampaignSelect)
      .in("status", ["active", "scheduled"])
      .is("archived_at", null)
      .is("last_triggered_at", null)
      .not("scheduled_for", "is", null)
      .lte("scheduled_for", now)
      .order("scheduled_for", { ascending: true })
      .limit(limit);
    campaigns = fallback.data;
    error = fallback.error;
  }

  if (error) {
    throw error;
  }

  const items = [];
  for (const campaign of campaigns || []) {
    try {
      const result = await executeCampaignDispatch(campaign, { triggerSource });
      items.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        status: "sent",
        total: result.total,
      });

      if (campaign.is_recurring) {
        try {
          const nextRun = computeNextRecurrenceDate({
            pattern: campaign.recurrence_pattern,
            dayOfMonth: campaign.recurrence_day_of_month,
            dayOfWeek: campaign.recurrence_day_of_week,
            timeStr: campaign.recurrence_time,
            fromDate: new Date(),
            forceNextCycle: true,
          });
          const nextRunIso = nextRun.toISOString();

          await supabase
            .from("campaigns")
            .update({
              scheduled_for: nextRunIso,
              next_run_at: nextRunIso,
              last_triggered_at: null,
              status: "active",
            })
            .eq("id", campaign.id);
        } catch (recErr) {
          console.error("failed to reschedule recurring campaign:", campaign.id, recErr);
        }
      }
    } catch (error) {
      items.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      console.error("scheduled campaign dispatch error:", campaign.id, error);
    }
  }

  return {
    success: true,
    processed: items.length,
    sent: items.filter((item) => item.status === "sent").length,
    failed: items.filter((item) => item.status === "failed").length,
    items,
  };
}

export async function tickCampaignScheduler() {
  if (campaignSchedulerRunning) return;
  campaignSchedulerRunning = true;
  try {
    const result = await runDueCampaignDispatches({ triggerSource: "scheduler" });
    if (result.processed > 0) {
      console.log("[campaign-scheduler] processed due campaigns", result);
    }
  } catch (error) {
    console.error("[campaign-scheduler] failed to process due campaigns:", error);
    const msg = String(error?.message || error || "");
    if (/timeout|terminated|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
      console.warn(
        "[campaign-scheduler] DB connectivity hint: from Docker, DATABASE_URL must reach Postgres (firewall, correct host/IP; avoid 127.0.0.1 for DB on the host unless using host network). Increase PG_CONNECTION_TIMEOUT_MS if the link is slow."
      );
    }
  } finally {
    campaignSchedulerRunning = false;
  }
}

let initialTimeout = null;
let intervalTimer = null;

export function stopCampaignScheduler() {
  if (initialTimeout) {
    clearTimeout(initialTimeout);
    initialTimeout = null;
  }
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
  console.log("[campaign-scheduler] scheduler parado.");
}

export function startCampaignScheduler() {
  console.log("[campaign-scheduler] disabled: scheduler legado de campanhas desarmado em favor da fila campaign_dispatches");
}
