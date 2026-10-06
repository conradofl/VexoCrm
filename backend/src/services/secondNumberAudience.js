// Segunda tentativa por OUTRO número da mesma empresa: "tentar o número adicional de quem não respondeu".
//
// A unidade é a EMPRESA (o lead), não a linha telefônica. O público é: quem RECEBEU uma campanha, NÃO respondeu e tem um telefone adicional que ainda
// não recebeu essa campanha; passado o prazo que o dono escolhe. O disparo vai só para o adicional. Por padrão nunca nos dois números de uma vez.
//
// Resposta, no nível do lead e por QUALQUER número dele: o telefone principal, qualquer um de dados.telefones_extras e — quando o adicional já é outro lead
// (dados.telefones_extras[].ja_existe_como_lead) — os números daquele lead também. É cruzamento na consulta do público; o roteamento de entrada não muda
// (a mensagem de um número adicional chega com lead_id nulo: por isso o cruzamento é por TELEFONE, nunca por lead_id).
//
// "Respondeu" é a definição ÚNICA do sistema (services/messageEffectiveness.js: REPLY_MESSAGE_FILTER_SQL e MESSAGE_TIMESTAMP_SQL, telefone canônico nos dois lados,
// com a variante JID). A janela é a única diferença declarada: o relatório de efetividade olha 14 dias depois do envio; aqui a resposta conta em QUALQUER
// momento depois do envio até agora (quem responde no dia 9 e recebe a segunda tentativa no dia 10 foi importunado). `replyWindowDays` existe para provar a
// paridade com o relatório na mesma janela.
//
// Resposta de LID (@lid) não tem telefone recuperável (limitação da Evolution API, irreversível): não dá para ligá-la a envio nenhum. "Não respondeu" aqui
// quer dizer "não achamos resposta", não "ignorou você": a prévia mostra quantas respostas do período não puderam ser ligadas.
//
// Só campanhas que gravaram campaign_dispatch_runs aparecem: o caminho legado (executeCampaignDispatch) não grava esse registro.

import { SQL_CANONICAL_PHONE_JID } from "./canonicalPhone.js";
import { MESSAGE_TIMESTAMP_SQL, REPLY_MESSAGE_FILTER_SQL } from "./messageEffectiveness.js";
import { Params, buildScope } from "./leadListQuery.js";

const CJ = SQL_CANONICAL_PHONE_JID;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SECOND_NUMBER_MIN_WAIT_DAYS = 1;
export const SECOND_NUMBER_MAX_WAIT_DAYS = 90;
export const SECOND_NUMBER_DEFAULT_WAIT_DAYS = 7;
export const SECOND_NUMBER_MAX_ITEMS = 100_000;

/** Ordem do funil: cada lead que recebeu a campanha cai no PRIMEIRO balde que o descreve; a soma dos baldes é o total que recebeu. */
export const SECOND_NUMBER_BUCKETS = ["sem_adicional", "respondeu_mesmo_numero", "respondeu_outro_numero", "dentro_do_prazo", "elegivel"];

const extrasOf = (dadosExpr) =>
  `(CASE WHEN jsonb_typeof(${dadosExpr}->'telefones_extras') = 'array' THEN ${dadosExpr}->'telefones_extras' ELSE '[]'::jsonb END)`;

export class SecondNumberInputError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** As campanhas que já enviaram (campaign_dispatch_runs status 'sent') — as únicas que o cruzamento enxerga. */
export async function listSecondNumberCampaigns(pool, { clientId }) {
  const { rows } = await pool.query(
    `SELECT c.id::text AS id, c.name, count(*) FILTER (WHERE r.status = 'sent')::int AS sent_count, max(r.sent_at) FILTER (WHERE r.status = 'sent') AS last_sent_at
       FROM public.campaigns c
       JOIN public.campaign_dispatch_runs r ON r.campaign_id = c.id AND r.client_id = $1
      WHERE c.client_id = $1
      GROUP BY c.id, c.name
     HAVING count(*) FILTER (WHERE r.status = 'sent') > 0
      ORDER BY max(r.sent_at) FILTER (WHERE r.status = 'sent') DESC NULLS LAST
      LIMIT 100`,
    [clientId]
  );
  return rows.map((r) => ({ id: r.id, name: r.name, sentCount: r.sent_count, lastSentAt: r.last_sent_at ? new Date(r.last_sent_at).toISOString() : null }));
}

/**
 * O público da segunda tentativa + os números da prévia. `now` e `replyWindowDays` são para teste (agora fixo; janela do relatório de efetividade).
 */
export async function querySecondNumberAudience(pool, { scope, campaignId, waitDays = SECOND_NUMBER_DEFAULT_WAIT_DAYS, replyWindowDays = null, now = null }) {
  if (!UUID_RE.test(String(campaignId || ""))) throw new SecondNumberInputError("INVALID_CAMPAIGN_ID", "campaignId inválido");
  const days = Number(waitDays);
  if (!Number.isInteger(days) || days < SECOND_NUMBER_MIN_WAIT_DAYS || days > SECOND_NUMBER_MAX_WAIT_DAYS) {
    throw new SecondNumberInputError("INVALID_WAIT_DAYS", `O prazo tem que ser um número inteiro de ${SECOND_NUMBER_MIN_WAIT_DAYS} a ${SECOND_NUMBER_MAX_WAIT_DAYS} dias.`);
  }

  const p = new Params();
  const scopeSql = buildScope(p, scope); // $1 = client_id
  const camp = p.add(String(campaignId));
  const waitP = p.add(days);
  const nowP = p.add(now ? new Date(now).toISOString() : null);
  const windowSql = replyWindowDays ? `AND rp.ts <= rc.first_sent + make_interval(days => ${p.add(Number(replyWindowDays))}::int)` : "";

  const sql = `
    WITH scoped AS MATERIALIZED (
      SELECT s.id, s.nome, s.telefone, s.phone, s.dados FROM public.leads s WHERE ${scopeSql}
    ),
    numbers AS MATERIALIZED (
      SELECT sc.id AS lead_id, COALESCE(NULLIF(sc.telefone, ''), sc.phone) AS raw, 'principal' AS kind, 0 AS ord, NULL::text AS coluna FROM scoped sc
      UNION ALL
      SELECT sc.id, x.e->>'telefone', 'extra', x.ord::int, x.e->>'coluna'
        FROM scoped sc
       CROSS JOIN LATERAL jsonb_array_elements(${extrasOf("sc.dados")}) WITH ORDINALITY AS x(e, ord)
       WHERE COALESCE(x.e->>'telefone', '') <> ''
    ),
    numbers_cp AS MATERIALIZED (
      SELECT n.lead_id, n.raw, n.kind, n.ord, n.coluna, ${CJ("n.raw")} AS cp FROM numbers n WHERE COALESCE(n.raw, '') <> ''
    ),
    linked AS MATERIALIZED (
      SELECT sc.id AS lead_id, x.e->>'ja_existe_como_lead' AS other_id
        FROM scoped sc
       CROSS JOIN LATERAL jsonb_array_elements(${extrasOf("sc.dados")}) AS x(e)
       WHERE COALESCE(x.e->>'ja_existe_como_lead', '') <> ''
    ),
    other_numbers AS MATERIALIZED (
      SELECT li.lead_id, ${CJ("v.raw")} AS cp
        FROM linked li
        JOIN public.leads o ON o.id::text = li.other_id AND o.client_id = $1
       CROSS JOIN LATERAL (
         SELECT COALESCE(NULLIF(o.telefone, ''), o.phone) AS raw
         UNION ALL
         SELECT y.e->>'telefone' FROM jsonb_array_elements(${extrasOf("o.dados")}) AS y(e)
       ) v
       WHERE COALESCE(v.raw, '') <> ''
    ),
    group_numbers AS MATERIALIZED (
      SELECT lead_id, cp FROM numbers_cp
      UNION
      SELECT lead_id, cp FROM other_numbers
    ),
    runs AS MATERIALIZED (
      SELECT ${CJ("r.phone")} AS cp, min(r.sent_at) AS first_sent, max(r.sent_at) AS last_sent
        FROM public.campaign_dispatch_runs r
       WHERE r.client_id = $1 AND r.campaign_id = ${camp}::uuid AND r.status = 'sent' AND r.sent_at IS NOT NULL AND COALESCE(btrim(r.phone), '') <> ''
       GROUP BY 1
    ),
    received AS MATERIALIZED (
      SELECT n.lead_id, min(ru.first_sent) AS first_sent, max(ru.last_sent) AS last_sent, array_agg(DISTINCT n.cp) AS received_cps
        FROM numbers_cp n
        JOIN runs ru ON ru.cp = n.cp
       GROUP BY n.lead_id
    ),
    replies AS MATERIALIZED (
      SELECT ${CJ("lm.phone")} AS cp, ${MESSAGE_TIMESTAMP_SQL} AS ts
        FROM public.lead_messages lm
       WHERE lm.client_id = $1 AND ${REPLY_MESSAGE_FILTER_SQL}
         AND COALESCE(lm.phone, '') <> '' AND lm.phone NOT LIKE '%@lid'
         AND ${MESSAGE_TIMESTAMP_SQL} > (SELECT min(first_sent) FROM runs)
    ),
    -- o adicional a tentar: o primeiro (pela ordem da planilha) que ainda NÃO recebeu esta campanha. Agregado, não LATERAL: o LATERAL varria
    -- numbers_cp inteiro por lead (24 mil x 44 mil, 100 s medidos em 25 mil).
    targets AS MATERIALIZED (
      SELECT DISTINCT ON (n.lead_id) n.lead_id, n.raw, n.coluna
        FROM numbers_cp n
        JOIN received rc ON rc.lead_id = n.lead_id
       WHERE n.kind = 'extra' AND NOT (n.cp = ANY(rc.received_cps))
       ORDER BY n.lead_id, n.ord
    ),
    reply_info AS MATERIALIZED (
      SELECT rc.lead_id, bool_or(rp.cp = ANY(rc.received_cps)) AS mesmo_numero
        FROM received rc
        JOIN group_numbers gn ON gn.lead_id = rc.lead_id
        JOIN replies rp ON rp.cp = gn.cp AND rp.ts > rc.first_sent ${windowSql}
       GROUP BY rc.lead_id
    )
    SELECT rc.lead_id::text AS lead_id, sc.nome, COALESCE(NULLIF(sc.telefone, ''), sc.phone) AS principal, tgt.raw AS alvo, tgt.coluna AS alvo_coluna,
           (SELECT min(first_sent) FROM runs) AS periodo_desde,
           CASE
             WHEN tgt.raw IS NULL THEN 'sem_adicional'
             WHEN ri.lead_id IS NOT NULL AND ri.mesmo_numero THEN 'respondeu_mesmo_numero'
             WHEN ri.lead_id IS NOT NULL THEN 'respondeu_outro_numero'
             WHEN rc.last_sent + make_interval(days => ${waitP}::int) > COALESCE(${nowP}::timestamptz, now()) THEN 'dentro_do_prazo'
             ELSE 'elegivel'
           END AS bucket
      FROM received rc
      JOIN scoped sc ON sc.id = rc.lead_id
      LEFT JOIN targets tgt ON tgt.lead_id = rc.lead_id
      LEFT JOIN reply_info ri ON ri.lead_id = rc.lead_id
     ORDER BY rc.last_sent ASC, rc.lead_id`;
  const { rows } = await pool.query(sql, p.values);

  const counts = { received: rows.length, semAdicional: 0, respondeuMesmoNumero: 0, respondeuOutroNumero: 0, dentroDoPrazo: 0, elegiveis: 0 };
  const keyOf = { sem_adicional: "semAdicional", respondeu_mesmo_numero: "respondeuMesmoNumero", respondeu_outro_numero: "respondeuOutroNumero", dentro_do_prazo: "dentroDoPrazo", elegivel: "elegiveis" };
  const items = [];
  for (const r of rows) {
    counts[keyOf[r.bucket]] += 1;
    if (r.bucket === "elegivel" && items.length < SECOND_NUMBER_MAX_ITEMS) {
      items.push({ leadId: r.lead_id, nome: r.nome || "", principal: r.principal, alvo: r.alvo, alvoColuna: r.alvo_coluna || null });
    }
  }
  const periodoDesde = rows[0]?.periodo_desde ? new Date(rows[0].periodo_desde).toISOString() : null;

  // Respostas de LID do período: não têm telefone recuperável, então não podem ser ligadas a envio nenhum.
  let lidNaoLigadas = 0;
  if (periodoDesde) {
    const { rows: lid } = await pool.query(
      `SELECT count(*)::int AS n FROM public.lead_messages lm
        WHERE lm.client_id = $1 AND ${REPLY_MESSAGE_FILTER_SQL} AND lm.phone LIKE '%@lid' AND ${MESSAGE_TIMESTAMP_SQL} > $2::timestamptz`,
      [scope.clientId, periodoDesde]
    );
    lidNaoLigadas = lid[0].n;
  }

  // Campanhas do caminho LEGADO (não gravam campaign_dispatch_runs): não aparecem neste cruzamento. Número real do tenant; null se não deu para medir.
  let campanhasCaminhoAntigo = null;
  try {
    const { rows: legacy } = await pool.query(
      `SELECT count(*)::int AS n FROM public.campaigns c
        WHERE c.client_id = $1
          AND ((c.analytics_meta -> 'dispatch' ->> 'triggerSource') IS NOT NULL OR c.last_triggered_at IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM public.campaign_dispatches d WHERE d.campaign_id = c.id)`,
      [scope.clientId]
    );
    campanhasCaminhoAntigo = legacy[0].n;
  } catch {
    campanhasCaminhoAntigo = null;
  }

  return { counts: { ...counts, lidNaoLigadas, campanhasCaminhoAntigo, periodoDesde, waitDays: days }, items };
}
