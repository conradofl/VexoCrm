// backend/src/services/sdrRotationState.js
//
// Volta do rodízio de SDR — precisa sobreviver a reinício do servidor, senão
// volta sempre pro primeiro e o primeiro recebe tudo. Cursor gravado numa
// tabela pequena com incremento atômico, mesmo padrão de
// evolution_instance_daily_usage (services/chipQuota.js): nada de contador
// em memória.

let _sdrRotationStateSchemaEnsured = false;

export function resetSdrRotationStateForTest() {
  _sdrRotationStateSchemaEnsured = false;
}

export async function ensureSdrRotationStateTable(pool) {
  if (!pool) return false;
  if (_sdrRotationStateSchemaEnsured) return true;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.sdr_rotation_state (
      client_id  TEXT        PRIMARY KEY,
      cursor     INTEGER     NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  _sdrRotationStateSchemaEnsured = true;
  return true;
}

/**
 * Avança a volta do tenant e devolve o novo cursor. Primeira chamada do
 * tenant grava cursor=0 (sem incrementar — é o primeiro giro); chamadas
 * seguintes incrementam. `cursor % candidates.length` no chamador decide
 * qual número da lista é a vez.
 */
export async function advanceSdrRotationCursor(pool, clientId) {
  await ensureSdrRotationStateTable(pool);
  const { rows } = await pool.query(
    `
      INSERT INTO public.sdr_rotation_state (client_id, cursor, updated_at)
      VALUES ($1::text, 0, now())
      ON CONFLICT (client_id)
      DO UPDATE SET cursor = public.sdr_rotation_state.cursor + 1, updated_at = now()
      RETURNING cursor
    `,
    [String(clientId)]
  );
  return rows[0]?.cursor ?? 0;
}
