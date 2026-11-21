// Conferência dos runs 'claimed' que um reinício deixou sem desfecho (21/11/2026).
//
// O boot (orphanRecovery.js) pausa os lotes que estavam enviando e devolve os que têm run 'claimed'. DEPOIS de o
// servidor subir (server.js, sem atrasar o /health), esta conferência espera 10 s, para o eco de um envio em voo
// chegar, e decide cada run 'claimed' desses lotes:
//   1. há SAÍDA em lead_messages para o telefone, na mesma empresa, criada depois do claimed_at -> 'sent', com o
//      sent_at dela (sem reenvio). Critério preferido: a linha da campanha (meta.dispatchId do lote, depois o
//      campaign_id); senão telefone + empresa (pode ser uma mensagem manual: o resultado é o mesmo, conservador). O
//      critério fica gravado no run como nota interna;
//   2. não há saída e o run NÃO tem a marca de envio iniciado (runSendMarker.js): a chamada à Evolution não
//      aconteceu. O run é apagado e o lead volta a pendente; a retomada do lote envia uma vez;
//   3. não há saída e o run TEM a marca: dúvida. Fica 'skipped' com o texto de sempre. Melhor um lead sem receber
//      que um lead recebendo duas vezes;
//   4. erro na conferência: todos os 'claimed' pendentes desses lotes ficam 'skipped'. Nunca derruba o processo.
// Lote pausado pelo boot continua pausado: a conferência só fecha 'done' quando o alvo completou. Ela NÃO retoma
// lote; retomar é clique do cliente.

import { toCanonicalPhone } from "../services/canonicalPhone.js";
import { RUN_BOOT_SKIP_TEXT, RUN_SEND_MARKER, runConferenceNote } from "../services/runSendMarker.js";

export const CONFERENCIA_ESPERA_MS = 10_000;
export const BOOT_PAUSE_MESSAGE_PREFIX = "Pausado — servidor reiniciou durante o envio";

const esperarPadrao = (ms) => new Promise((r) => setTimeout(r, ms));

const SQL_SAIDA = `
  SELECT COALESCE(message_timestamp, created_at) AS quando,
         CASE
           WHEN meta->>'dispatchId' = $5 THEN 'dispatch'
           WHEN campaign_id::text = $6 THEN 'campanha'
           ELSE 'telefone'
         END AS criterio
    FROM public.lead_messages
   WHERE client_id = $1
     AND direction = 'outbound'
     AND (phone = $2 OR regexp_replace(phone, '\\D', '', 'g') = $3)
     AND created_at >= $4::timestamptz
   ORDER BY CASE
              WHEN meta->>'dispatchId' = $5 THEN 0
              WHEN campaign_id::text = $6 THEN 1
              ELSE 2
            END, created_at ASC
   LIMIT 1`;

async function decidirRun(pool, run) {
  const canonico = toCanonicalPhone(run.phone) || String(run.phone || "");
  const digitos = String(run.phone || "").replace(/\D/g, "");
  const desde = run.claimed_at || run.created_at;
  const { rows } = await pool.query(SQL_SAIDA, [
    run.client_id, canonico, digitos, new Date(desde).toISOString(), String(run.dispatch_id), String(run.campaign_id),
  ]);
  const saida = rows[0];
  if (saida) {
    await pool.query(
      `UPDATE public.campaign_dispatch_runs SET status = 'sent', sent_at = $2, error_message = $3
        WHERE id = $1 AND status = 'claimed'`,
      [run.id, new Date(saida.quando).toISOString(), runConferenceNote(saida.criterio)]
    );
    return { desfecho: "sent", criterio: saida.criterio };
  }
  if (run.error_message === RUN_SEND_MARKER) {
    await pool.query(
      `UPDATE public.campaign_dispatch_runs SET status = 'skipped', error_message = $2 WHERE id = $1 AND status = 'claimed'`,
      [run.id, RUN_BOOT_SKIP_TEXT]
    );
    return { desfecho: "skipped" };
  }
  await pool.query(`DELETE FROM public.campaign_dispatch_runs WHERE id = $1 AND status = 'claimed'`, [run.id]);
  return { desfecho: "pendente" };
}

async function fecharLotesCompletos(pool, dispatchIds) {
  // Só lote pausado PELO BOOT (mensagem do boot) e com alvo completo. Lote pausado pelo cliente não muda.
  await pool.query(
    `UPDATE public.campaign_dispatches d
        SET status = 'done', error_message = NULL, finished_at = COALESCE(d.finished_at, now()), updated_at = now(),
            sent_count = (SELECT count(*)::int FROM public.campaign_dispatch_runs r WHERE r.dispatch_id = d.id AND r.status = 'sent')
      WHERE d.id::text = ANY($1::text[])
        AND d.status = 'paused'
        AND d.error_message LIKE $2
        AND COALESCE(d.target_count, 0) > 0
        AND (SELECT count(*) FROM public.campaign_dispatch_runs r
              WHERE r.dispatch_id = d.id AND r.status IN ('sent', 'failed', 'invalid_number', 'skipped')) >= d.target_count`,
    [dispatchIds.map(String), `${BOOT_PAUSE_MESSAGE_PREFIX}%`]
  );
}

/**
 * Confere os runs 'claimed' dos lotes que o boot devolveu. Devolve um resumo; nunca lança.
 */
export async function conferirClaimedDoBoot(pool, { dispatchIds = [], esperaMs = CONFERENCIA_ESPERA_MS, esperar = esperarPadrao } = {}) {
  const resumo = { sent: 0, pendente: 0, skipped: 0, porCriterio: {}, erro: false };
  const ids = (dispatchIds || []).map(String).filter(Boolean);
  if (!pool || ids.length === 0) return resumo;
  try {
    await esperar(esperaMs);
    const { rows: runs } = await pool.query(
      `SELECT id, dispatch_id, campaign_id, client_id, phone, claimed_at, created_at, error_message
         FROM public.campaign_dispatch_runs
        WHERE dispatch_id::text = ANY($1::text[]) AND status = 'claimed'`,
      [ids]
    );
    for (const run of runs) {
      const r = await decidirRun(pool, run);
      resumo[r.desfecho] += 1;
      if (r.criterio) resumo.porCriterio[r.criterio] = (resumo.porCriterio[r.criterio] || 0) + 1;
    }
    await fecharLotesCompletos(pool, ids);
  } catch (err) {
    resumo.erro = true;
    console.error("[boot-conferencia] falhou; os claimed pendentes ficam 'skipped' (na dúvida, não reenvia):", err?.message || err);
    const r = await pool
      .query(
        `UPDATE public.campaign_dispatch_runs SET status = 'skipped', error_message = $2
          WHERE dispatch_id::text = ANY($1::text[]) AND status = 'claimed'`,
        [ids, RUN_BOOT_SKIP_TEXT]
      )
      .catch((e) => {
        console.error("[boot-conferencia] nem o 'skipped' de segurança gravou:", e?.message || e);
        return null;
      });
    resumo.skipped += Number(r?.rowCount || 0);
  }
  console.log("[boot-conferencia] claimed conferidos:", { lotes: ids.length, ...resumo });
  return resumo;
}

/**
 * Dispara a conferência SEM segurar quem chamou (o boot já subiu o servidor). Devolve a promessa, que nunca rejeita.
 */
export function iniciarConferenciaDeClaimed(pool, dispatchIds, opcoes = {}) {
  return Promise.resolve()
    .then(() => conferirClaimedDoBoot(pool, { dispatchIds, ...opcoes }))
    .catch((err) => {
      console.error("[boot-conferencia] erro inesperado:", err?.message || err);
      return { erro: true };
    });
}
