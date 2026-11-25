// Trava por chip no banco (PR 10d do untangle, 25/11/2026): segunda camada da trava em memória (chipDispatchLock.js).
//
// A memória não sobrevive a boot nem enxerga outro contêiner. Aqui o lote reserva o(s) chip(s) em
// public.campaign_chip_leases (migration 20261125150000) antes de sair e solta no fim.
//
// Regras:
//  - chip_key = id do chip, ou "*" para lote sem chip definido (conflita com qualquer lote da mesma empresa).
//  - Reserva que venceu o prazo, ou cujo lote dono já terminou (done/failed/cancelled), é solta antes de reservar.
//  - O mesmo lote reservando de novo (boot que retoma lote órfão) assume a própria reserva antiga.
//  - Corrida entre dois pedidos: cada um grava e depois confere; quem vê conflito solta o que gravou. No pior caso os dois
//    soltam e tentam no próximo ciclo; nunca os dois ficam.
//  - Tabela ausente (código no ar antes da migration rodar): vale só a memória, como antes (avisa uma vez).
//  - Qualquer outro erro: NA DÚVIDA, NÃO ENVIA. O chip conta como ocupado e o lote tenta de novo depois.
import { randomUUID } from "node:crypto";

export const CHIP_LEASE_TTL_HOURS = 24;
export const ALL_CHIPS_KEY = "*";
const FINAL_STATUSES = ["done", "failed", "cancelled"];
const HOLDER = `proc-${randomUUID().slice(0, 8)}`;

let avisouTabelaAusente = false;

function isMissingTable(err) {
  return String(err?.code || "") === "42P01" || /campaign_chip_leases.*does not exist|relation .*campaign_chip_leases/i.test(String(err?.message || ""));
}

function chipKeysOf(chips) {
  const lista = Array.isArray(chips) ? [...new Set(chips.map((c) => String(c ?? "").trim()).filter(Boolean))] : [];
  return lista.length > 0 ? lista : [ALL_CHIPS_KEY];
}

function conflita(meusChips, outroChip) {
  if (meusChips.includes(ALL_CHIPS_KEY) || outroChip === ALL_CHIPS_KEY) return true;
  return meusChips.includes(outroChip);
}

/**
 * @returns {Promise<{ ok: true, store: "banco" | "ausente" } | { ok: false, bloqueadoPor: { dispatchId, nome }, erro?: true }>}
 */
export async function acquireChipLease(pool, { dispatchId, clientId, chips, nome }) {
  if (!pool?.query) return { ok: true, store: "ausente" };
  const id = String(dispatchId);
  const cliente = String(clientId ?? "");
  const chaves = chipKeysOf(chips);
  try {
    // 1. solta o que já não vale: prazo vencido, lote dono em status final, ou reserva antiga deste mesmo lote.
    await pool.query(
      `UPDATE public.campaign_chip_leases l
          SET released_at = now()
        WHERE l.client_id = $1
          AND l.released_at IS NULL
          AND (
            l.expires_at < now()
            OR l.dispatch_id = $2::uuid
            OR EXISTS (SELECT 1 FROM public.campaign_dispatches d WHERE d.id = l.dispatch_id AND d.status = ANY($3::text[]))
          )`,
      [cliente, id, FINAL_STATUSES]
    );

    // 2. grava as reservas (uma por chip). Chave já ocupada não entra; a conferência abaixo decide.
    await pool.query(
      `INSERT INTO public.campaign_chip_leases (client_id, chip_key, dispatch_id, dispatch_name, holder, expires_at)
       SELECT $1, k, $2::uuid, $3, $4, now() + make_interval(hours => $5::int)
         FROM unnest($6::text[]) AS k
       ON CONFLICT DO NOTHING`,
      [cliente, id, nome || null, HOLDER, CHIP_LEASE_TTL_HOURS, chaves]
    );

    // 3. confere: alguma reserva ativa de OUTRO lote conflita com os meus chips?
    const { rows } = await pool.query(
      `SELECT dispatch_id, dispatch_name, chip_key
         FROM public.campaign_chip_leases
        WHERE client_id = $1
          AND released_at IS NULL
          AND dispatch_id <> $2::uuid
        ORDER BY acquired_at`,
      [cliente, id]
    );
    const bloqueio = (rows || []).find((r) => conflita(chaves, String(r.chip_key)));
    if (bloqueio) {
      await releaseChipLease(pool, id);
      return { ok: false, bloqueadoPor: { dispatchId: String(bloqueio.dispatch_id), nome: bloqueio.dispatch_name || String(bloqueio.dispatch_id) } };
    }
    return { ok: true, store: "banco" };
  } catch (err) {
    if (isMissingTable(err)) {
      if (!avisouTabelaAusente) {
        avisouTabelaAusente = true;
        console.warn("[chip-lease] tabela campaign_chip_leases ausente (migration 20261125150000 ainda não rodou): vale só a trava em memória.");
      }
      return { ok: true, store: "ausente" };
    }
    console.error("[chip-lease] falha ao reservar o chip no banco; lote fica para o próximo ciclo:", err?.message || err);
    await releaseChipLease(pool, id);
    return { ok: false, erro: true, bloqueadoPor: { dispatchId: null, nome: "conferência da trava do chip indisponível" } };
  }
}

/** Solta as reservas ativas do lote. Nunca lança. */
export async function releaseChipLease(pool, dispatchId) {
  if (!pool?.query) return;
  try {
    await pool.query(
      `UPDATE public.campaign_chip_leases SET released_at = now() WHERE dispatch_id = $1::uuid AND released_at IS NULL`,
      [String(dispatchId)]
    );
  } catch (err) {
    if (!isMissingTable(err)) console.warn("[chip-lease] falha ao soltar a reserva do chip (vence pelo prazo):", err?.message || err);
  }
}

export function _resetChipLeaseWarningsForTesting() {
  avisouTabelaAusente = false;
}
