// Opt-out: uma leitura só para as duas fontes que existem hoje.
//
// Fonte A, a flag do lead: leads.opt_out, leads.metadata.opt_out e leads.dados.opt_out (PATCH manual em leads/routes.js).
// Fonte B, a tabela lead_optouts: escrita quando o lead responde "sair/parar/cancelar/stop" ao follow-up
// (followup/routes.js, webhook de resposta). As duas fontes NÃO se conversam: quem digita "parar" entra em B e não vira A.
// Dívida nomeada (fora deste PR): gravar a flag A quando o lead entra em B.
//
// Telefone comparado por dígitos: lead_optouts guarda o telefone como veio do webhook, o lead pode estar formatado.
// Tabela ou coluna ausente (schema antigo) = fonte vazia. Qualquer outro erro SOBE: o chamador decide (a fila trata como
// bloqueado nesta rodada, nunca como liberado).

const SCHEMA_ERRORS = new Set(["42P01", "42703"]);

const SQL_TABELA = `
  SELECT EXISTS (
    SELECT 1 FROM public.lead_optouts o
     WHERE o.client_id = $1 AND regexp_replace(o.phone, '\\D', '', 'g') = $2
  ) AS hit`;

const SQL_FLAG = `
  SELECT EXISTS (
    SELECT 1 FROM public.leads l
     WHERE l.client_id = $1
       AND regexp_replace(l.telefone, '\\D', '', 'g') = $2
       AND (l.opt_out IS TRUE OR l.metadata->>'opt_out' = 'true' OR l.dados->>'opt_out' = 'true')
  ) AS hit`;

async function lerFonte(pool, sql, params) {
  try {
    const { rows } = await pool.query(sql, params);
    return rows?.[0]?.hit === true;
  } catch (err) {
    if (SCHEMA_ERRORS.has(err?.code)) return false;
    throw err;
  }
}

export async function isPhoneOptedOut(pool, { clientId, phone }) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!pool || !clientId || !digits) return false;
  if (await lerFonte(pool, SQL_TABELA, [clientId, digits])) return true;
  return lerFonte(pool, SQL_FLAG, [clientId, digits]);
}
