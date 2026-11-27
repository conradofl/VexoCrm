// Separar a base em lotes para campanha, sem planilha manual.
//
// Antes: exportar o Banco em Excel, tirar fixo e número sem WhatsApp à mão, partir em planilhas do tamanho do teste,
// importar de novo e lembrar de cabeça quem já tinha recebido. Aqui o servidor faz isso:
//
//   - prévia: quantos leads a empresa tem, quantos são celular, fixo ou inválido, quantos já foram conferidos no
//     WhatsApp (e com que resultado), quantos já receberam campanha, quantos já estão em outro lote separado e quantos
//     estão disponíveis para o próximo lote;
//   - separar: cria N planilhas de até T leads cada, só com disponíveis. Cada planilha é uma importação normal
//     (lead_imports + lead_import_items, pelo mesmo serviço da importação em lotes), marcada em
//     import_params.loteSeparado. Quem entra num lote não entra no próximo;
//   - conferir WhatsApp: DESLIGADO em 27/11/2026. Perguntar ao WhatsApp, em massa, quais números existem derrubou três
//     chips. A rota responde 410 com a explicação; o que já tinha sido conferido continua valendo (whatsapp_number_validations).
//
// Disponível = sem opt-out, número de celular (ou fixo com WhatsApp confirmado), nunca recebeu campanha desta empresa,
// fora de lote separado anterior e sem "não existe" conhecido. Exigir WhatsApp confirmado é opcional (padrão: não).
// Nada aqui apaga lead.

import { ImportError, appendLeadImportBatch, closeLeadImport, openLeadImport, IMPORT_BATCH_SIZE } from "./leadImportBatches.js";

export const LOTE_TAMANHO_MAX = 500;
export const LOTE_QUANTIDADE_MAX = 50;
export const CONFERENCIA_VALIDADE_DIAS = 30;
const ACTOR_AGENTE = "agente-campanha";

// Dígitos do telefone do lead (as duas colunas convivem: telefone e phone). Mesma expressão em todo SQL daqui.
const DIGITOS_LEAD = `regexp_replace(coalesce(nullif(l.telefone, ''), l.phone, ''), '\\D', '', 'g')`;

// Chave de comparação: sem o 55 do Brasil quando ele está lá. 5534999990000 e 34999990000 são o mesmo número.
function chaveSql(expr) {
  return `(CASE WHEN ${expr} ~ '^55' AND length(${expr}) IN (12, 13) THEN substr(${expr}, 3) ELSE ${expr} END)`;
}

/** celular | fixo | invalido, pelo formato brasileiro (DDD + 9 dígitos começando com 9 = celular; DDD + 8 começando com 2 a 5 = fixo). */
export function classificarTelefone(raw) {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (!d || d.startsWith("5500") || d.length >= 14) return "invalido";
  const local = d.startsWith("55") && (d.length === 12 || d.length === 13) ? d.slice(2) : d;
  if (local.length === 11 && local[2] === "9") return "celular";
  // 8 dígitos começando com 6 a 9 é celular no formato antigo (sem o 9 na frente), comum em número tirado do WhatsApp.
  if (local.length === 10 && "6789".includes(local[2])) return "celular";
  if (local.length === 10 && "2345".includes(local[2])) return "fixo";
  return "invalido";
}

function classeSql(expr) {
  const local = chaveSql(expr);
  return `(CASE
    WHEN ${expr} = '' OR ${expr} ~ '^5500' OR length(${expr}) >= 14 THEN 'invalido'
    WHEN length(${local}) = 11 AND substr(${local}, 3, 1) = '9' THEN 'celular'
    WHEN length(${local}) = 10 AND substr(${local}, 3, 1) IN ('6','7','8','9') THEN 'celular'
    WHEN length(${local}) = 10 AND substr(${local}, 3, 1) IN ('2','3','4','5') THEN 'fixo'
    ELSE 'invalido' END)`;
}

/**
 * Uma linha por lead da empresa, com tudo que decide se ele pode entrar num lote. MATERIALIZED de propósito: o
 * Postgres achata CTE e reavalia os EXISTS por linha de fora (ver reference_postgres_cte_achatamento).
 */
function baseSql({ leadIdsIdx = null } = {}) {
  // Origem do lote (24/11/2026): com leadIdsIdx, só os leads daquele grupo (tag, planilha ou filtro da tela) contam.
  // "Já recebeu" e "já está em outro lote" continuam olhando a empresa inteira.
  const grupo = leadIdsIdx ? `AND l.id::text = ANY($${leadIdsIdx}::text[])` : "";
  return `
    WITH leads_empresa AS MATERIALIZED (
      SELECT l.id, nullif(trim(l.nome), '') AS nome, ${DIGITOS_LEAD} AS d, coalesce(l.opt_out, false) AS opt_out, l.created_at
        FROM public.leads l
       WHERE l.client_id = $1 ${grupo}
    ),
    recebeu AS MATERIALIZED (
      SELECT DISTINCT r.lead_id, ${chaveSql("regexp_replace(coalesce(r.phone, ''), '\\D', '', 'g')")} AS chave
        FROM public.campaign_dispatch_runs r
       WHERE r.client_id = $1 AND r.status IN ('sent', 'claimed')
    ),
    separado AS MATERIALIZED (
      SELECT DISTINCT ${chaveSql("regexp_replace(coalesce(i.telefone, ''), '\\D', '', 'g')")} AS chave
        FROM public.lead_import_items i
        JOIN public.lead_imports im ON im.id = i.import_id
       WHERE im.client_id = $1 AND i.imported
         AND (im.import_params ? 'loteSeparado' OR im.uploaded_by_email = '${ACTOR_AGENTE}')
    ),
    base AS (
      SELECT le.*, ${chaveSql("le.d")} AS chave, ${classeSql("le.d")} AS classe,
             v.exists_whatsapp AS tem_whatsapp
        FROM leads_empresa le
        LEFT JOIN public.whatsapp_number_validations v
          ON v.phone = le.d AND v.validated_at >= now() - interval '${CONFERENCIA_VALIDADE_DIAS} days'
    ),
    -- LEFT JOIN em conjuntos distintos (hash join), não EXISTS por linha: com 80 mil leads o EXISTS levava 52 s.
    recebeu_lead AS MATERIALIZED (SELECT DISTINCT lead_id FROM recebeu WHERE lead_id IS NOT NULL),
    recebeu_chave AS MATERIALIZED (SELECT DISTINCT chave FROM recebeu WHERE chave <> ''),
    marcada AS (
      SELECT b.*,
             (rl.lead_id IS NOT NULL OR rc.chave IS NOT NULL) AS ja_recebeu,
             (s.chave IS NOT NULL) AS ja_separado
        FROM base b
        LEFT JOIN recebeu_lead rl ON rl.lead_id = b.id
        LEFT JOIN recebeu_chave rc ON rc.chave = b.chave AND b.chave <> ''
        LEFT JOIN separado s ON s.chave = b.chave AND b.chave <> ''
    )`;
}

function disponivelSql(exigirWhatsapp) {
  return `NOT opt_out AND NOT ja_recebeu AND NOT ja_separado AND classe <> 'invalido'
          AND tem_whatsapp IS DISTINCT FROM false
          AND (classe = 'celular' OR tem_whatsapp IS TRUE)
          ${exigirWhatsapp ? "AND tem_whatsapp IS TRUE" : ""}`;
}

/**
 * Leads que nunca vão entrar num lote e só poluem a base: WhatsApp conferido e inexistente, fixo sem WhatsApp
 * confirmado, ou número inválido. Opt-out fica sempre (o registro é o que impede contatar de novo). É o critério
 * "inutilizaveis" da exclusão em massa (services/leadMassDelete.js): a prévia da tela e a exclusão contam igual.
 */
export function inutilizaveisSql() {
  return `${baseSql()}
     SELECT l.id, l.nome, l.telefone, l.phone, l.tags, l.stage, l.temperature, l.created_at, l.dados->'import_ids' AS import_ids,
            CASE WHEN m.tem_whatsapp IS FALSE THEN 'sem_whatsapp' WHEN m.classe = 'fixo' THEN 'fixo' ELSE 'invalido' END AS motivo
       FROM marcada m
       JOIN public.leads l ON l.id = m.id
      WHERE NOT m.opt_out
        AND (m.tem_whatsapp IS FALSE
             OR (m.classe = 'fixo' AND m.tem_whatsapp IS NULL)
             OR (m.classe = 'invalido' AND m.tem_whatsapp IS NOT TRUE))`;
}

/** Números da base, para a tela mostrar antes de separar. */
export async function previaSeparacao(pool, { clientId, leadIds = null }) {
  const grupo = Array.isArray(leadIds);
  const { rows } = await pool.query(
    `${baseSql({ leadIdsIdx: grupo ? 2 : null })}
     SELECT count(*)::int AS total,
            count(*) FILTER (WHERE classe = 'celular')::int AS celular,
            count(*) FILTER (WHERE classe = 'fixo')::int AS fixo,
            count(*) FILTER (WHERE classe = 'invalido')::int AS invalido,
            count(*) FILTER (WHERE tem_whatsapp IS TRUE)::int AS whatsapp_confirmado,
            count(*) FILTER (WHERE tem_whatsapp IS FALSE)::int AS sem_whatsapp,
            count(*) FILTER (WHERE tem_whatsapp IS NULL AND classe <> 'invalido')::int AS nao_conferido,
            count(*) FILTER (WHERE opt_out)::int AS opt_out,
            count(*) FILTER (WHERE ja_recebeu)::int AS ja_recebeu,
            count(*) FILTER (WHERE ja_separado)::int AS ja_separado,
            count(*) FILTER (WHERE NOT opt_out AND tem_whatsapp IS FALSE)::int AS inutil_sem_whatsapp,
            count(*) FILTER (WHERE NOT opt_out AND classe = 'fixo' AND tem_whatsapp IS NULL)::int AS inutil_fixo_nao_conferido,
            count(*) FILTER (WHERE NOT opt_out AND classe = 'invalido' AND tem_whatsapp IS NOT TRUE)::int AS inutil_invalido,
            count(*) FILTER (WHERE ${disponivelSql(true)})::int AS disponivel_confirmado,
            count(*) FILTER (WHERE ${disponivelSql(false)})::int AS disponivel_sem_conferir
       FROM marcada`,
    grupo ? [clientId, leadIds.map(String)] : [clientId]
  );
  return rows[0];
}

function validarPedido({ tamanho, quantidade }) {
  const t = Number(tamanho);
  const q = Number(quantidade);
  if (!Number.isInteger(t) || t < 1 || t > LOTE_TAMANHO_MAX) {
    throw new ImportError(400, "INVALID_BATCH_SIZE", `Tamanho do lote deve ser um inteiro entre 1 e ${LOTE_TAMANHO_MAX}.`);
  }
  if (!Number.isInteger(q) || q < 1 || q > LOTE_QUANTIDADE_MAX) {
    throw new ImportError(400, "INVALID_BATCH_COUNT", `Quantidade de lotes deve ser um inteiro entre 1 e ${LOTE_QUANTIDADE_MAX}.`);
  }
  return { tamanho: t, quantidade: q };
}

// Uma separação por empresa de cada vez: duas ao mesmo tempo pegariam os mesmos leads (o backend é um processo só).
const separandoAgora = new Set();

/**
 * Cria até `quantidade` planilhas de até `tamanho` leads disponíveis. A última pode sair menor; não cria planilha vazia.
 * Devolve as planilhas criadas e quantos disponíveis sobraram.
 */
export async function separarLotes(pool, { clientId, tamanho, quantidade, nomeBase, exigirWhatsapp = false, actor = {}, leadIds = null, origem = null }) {
  const grupo = Array.isArray(leadIds);
  const pedido = validarPedido({ tamanho, quantidade });
  const nome = String(nomeBase ?? "").trim().slice(0, 120) || "Lote";
  if (separandoAgora.has(clientId)) {
    throw new ImportError(409, "BATCH_SEPARATION_RUNNING", "Já existe uma separação em andamento para esta empresa. Aguarde terminar.");
  }
  separandoAgora.add(clientId);
  try {
    const { rows: escolhidos } = await pool.query(
      `${baseSql({ leadIdsIdx: grupo ? 3 : null })}
       SELECT nome, d AS telefone FROM marcada
        WHERE ${disponivelSql(exigirWhatsapp !== false)}
        ORDER BY created_at, d
        LIMIT $2`,
      grupo ? [clientId, pedido.tamanho * pedido.quantidade, leadIds.map(String)] : [clientId, pedido.tamanho * pedido.quantidade]
    );
    const { rows: numeracao } = await pool.query(
      `SELECT count(*)::int AS n FROM public.lead_imports WHERE client_id = $1 AND import_params ? 'loteSeparado'`,
      [clientId]
    );
    const criadoEm = new Date().toISOString();
    const planilhas = [];
    for (let i = 0; i < pedido.quantidade; i += 1) {
      const fatia = escolhidos.slice(i * pedido.tamanho, (i + 1) * pedido.tamanho);
      if (fatia.length === 0) break;
      const numero = Number(numeracao[0]?.n || 0) + i + 1;
      const sourceName = `${nome} · Lote ${String(numero).padStart(2, "0")} · ${fatia.length} leads`;
      const aberta = await openLeadImport(pool, {
        clientId,
        sourceName,
        sourceType: "lote_separado",
        totalRows: fatia.length,
        uploadedByUid: actor.uid || null,
        uploadedByEmail: actor.email || null,
        importParams: {
          loteSeparado: {
            numero,
            tamanhoPedido: pedido.tamanho,
            exigirWhatsapp: exigirWhatsapp !== false,
            criadoEm,
            ...(origem ? { origem } : {}),
          },
        },
      });
      const importId = aberta.item.id;
      for (let start = 0; start < fatia.length; start += IMPORT_BATCH_SIZE) {
        await appendLeadImportBatch(pool, {
          importId,
          clientId,
          startIndex: start,
          rows: fatia.slice(start, start + IMPORT_BATCH_SIZE).map((r) => ({ nome: r.nome || "", telefone: r.telefone })),
        });
      }
      const fechada = await closeLeadImport(pool, { importId, clientId });
      planilhas.push({
        id: importId,
        nome: sourceName,
        numero,
        leads: Number(fechada?.item?.imported_rows ?? fatia.length),
      });
    }
    const sobra = await previaSeparacao(pool, { clientId, leadIds: grupo ? leadIds : null });
    return {
      planilhas,
      separados: planilhas.reduce((s, p) => s + p.leads, 0),
      disponiveisRestantes: exigirWhatsapp !== false ? sobra.disponivel_confirmado : sobra.disponivel_sem_conferir,
      naoConferidos: sobra.nao_conferido,
    };
  } finally {
    separandoAgora.delete(clientId);
  }
}

// ── Conferência de WhatsApp: desligada (27/11/2026) ──────────────────────────────────────────────────────────────────
// O estado em memória continua só para a tela antiga não quebrar: sempre "não rodando".

const conferencias = new Map();

function publico(estado) {
  if (!estado) return { rodando: false };
  const { controle: _c, promessa: _p, ...resto } = estado;
  return { ...resto };
}

export function statusConferencia(clientId) {
  return publico(conferencias.get(clientId));
}

export function pararConferencia(clientId) {
  const estado = conferencias.get(clientId);
  if (estado?.rodando) {
    estado.controle.abort();
    estado.rodando = false;
    estado.motivoFim = "parada_pelo_usuario";
    estado.terminouEm = new Date().toISOString();
  }
  return publico(estado);
}

export const CONFERENCIA_DESLIGADA_MSG =
  "A conferência de WhatsApp foi desligada: perguntar ao WhatsApp, em massa, se os números existem derrubou chips. " +
  "Agora o lote faz uma limpeza sem consulta (formato, DDD, sem fixo, sem número inventado) e pausa sozinho se a lista " +
  "se mostrar ruim durante o envio.";

/** Desligada em 27/11/2026 (antibloqueio). Mantida para a rota responder 410 com a explicação. */
export async function iniciarConferencia() {
  throw new ImportError(410, "CONFERENCIA_DESLIGADA", CONFERENCIA_DESLIGADA_MSG);
}

/** Só para teste: espera a conferência da empresa terminar e limpa o estado. */
export async function __aguardarConferenciaParaTeste(clientId) {
  await conferencias.get(clientId)?.promessa;
}
export function __limparConferenciasParaTeste() {
  for (const e of conferencias.values()) e.controle?.abort();
  conferencias.clear();
  separandoAgora.clear();
}
