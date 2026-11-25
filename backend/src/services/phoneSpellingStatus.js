// Medição antes do PR 3 parte 2 do untangle (25/11/2026): buscas de lead por telefone com igualdade exata
// (`.eq("telefone", phone)`, 9 pontos) só acham a linha gravada na mesma grafia de quem procura. Trocar por "todas as
// grafias" acha mais, e nos UPDATE mexe em mais linhas. Antes de trocar, o /health diz, por empresa:
//   - foraDoCanonico: linhas cujo telefone gravado não é o canônico (o que a busca exata perde hoje);
//   - comNaoDigito: linhas com máscara/sufixo no telefone (nem a lista de grafias cruas acha);
//   - numerosComVariasGrafias: números (canônicos) gravados em mais de uma grafia (o que a busca ampla passa a juntar).
// Só contagens; nenhum telefone sai daqui. Calculado em segundo plano UMA vez por processo (varredura das tabelas) e
// guardado: o /health devolve { medido: false, emAndamento: true } até terminar. Falha = { medido: false, erro }.
import { SQL_CANONICAL_PHONE } from "./canonicalPhone.js";

// Tabela -> coluna do telefone. runs e lead_messages entraram na 2ª medição (25/11): é onde o gerador antigo de
// grafias (buildPhoneLookupVariants, 24 pontos) procura, e o telefone pode estar com "+", como JID ou sem DDD.
export const PHONE_SPELLING_TABLES = [
  { tabela: "leads", coluna: "telefone" },
  { tabela: "lead_import_items", coluna: "telefone" },
  { tabela: "campaign_dispatch_runs", coluna: "phone" },
  { tabela: "lead_messages", coluna: "phone" },
];
const STATEMENT_TIMEOUT_MS = 60_000;

export function sqlPhoneSpellingByClient(table, col = "telefone") {
  return `
    WITH x AS (
      SELECT client_id, ${col} AS raw, ${SQL_CANONICAL_PHONE(col)} AS canon
        FROM public.${table}
       WHERE ${col} IS NOT NULL AND ${col} <> ''
    ),
    por_cliente AS (
      SELECT client_id,
             count(*)::int AS linhas,
             count(*) FILTER (WHERE raw <> canon)::int AS fora_do_canonico,
             count(*) FILTER (WHERE raw ~ '\\D')::int AS com_nao_digito,
             count(*) FILTER (WHERE raw LIKE '+%')::int AS com_mais,
             count(*) FILTER (WHERE raw ~* '@(s\\.whatsapp\\.net|c\\.us)$')::int AS com_jid,
             count(*) FILTER (WHERE raw ~* '@(lid|g\\.us)')::int AS lid_ou_grupo,
             count(*) FILTER (WHERE raw ~ '^[0-9]{8,9}$')::int AS sem_ddd
        FROM x GROUP BY client_id
    ),
    varias AS (
      SELECT client_id, count(*)::int AS numeros_com_varias_grafias
        FROM (SELECT client_id, canon FROM x GROUP BY client_id, canon HAVING count(DISTINCT raw) > 1) g
       GROUP BY client_id
    )
    SELECT p.client_id, p.linhas, p.fora_do_canonico, p.com_nao_digito, p.com_mais, p.com_jid, p.lid_ou_grupo, p.sem_ddd,
           COALESCE(v.numeros_com_varias_grafias, 0)::int AS numeros_com_varias_grafias
      FROM por_cliente p LEFT JOIN varias v ON v.client_id IS NOT DISTINCT FROM p.client_id
     ORDER BY p.client_id
  `;
}

async function rodarComLimite(pool, sql) {
  if (typeof pool.connect === "function") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
      const r = await client.query(sql);
      await client.query("COMMIT");
      return r.rows;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  return (await pool.query(sql)).rows;
}

export async function measurePhoneSpellings(pool) {
  const out = { medido: true, medidoEm: new Date().toISOString(), tabelas: {} };
  for (const { tabela, coluna } of PHONE_SPELLING_TABLES) {
    try {
      const rows = await rodarComLimite(pool, sqlPhoneSpellingByClient(tabela, coluna));
      const total = { linhas: 0, foraDoCanonico: 0, comNaoDigito: 0, comMais: 0, comJid: 0, lidOuGrupo: 0, semDdd: 0, numerosComVariasGrafias: 0 };
      const porEmpresa = {};
      for (const r of rows) {
        total.linhas += r.linhas;
        total.foraDoCanonico += r.fora_do_canonico;
        total.comNaoDigito += r.com_nao_digito;
        total.numerosComVariasGrafias += r.numeros_com_varias_grafias;
        total.comMais += r.com_mais;
        total.comJid += r.com_jid;
        total.lidOuGrupo += r.lid_ou_grupo;
        total.semDdd += r.sem_ddd;
        if (r.fora_do_canonico > 0 || r.com_nao_digito > 0 || r.numeros_com_varias_grafias > 0 || r.sem_ddd > 0) {
          porEmpresa[r.client_id ?? "(sem client_id)"] = {
            linhas: r.linhas,
            foraDoCanonico: r.fora_do_canonico,
            comNaoDigito: r.com_nao_digito,
            numerosComVariasGrafias: r.numeros_com_varias_grafias,
            comMais: r.com_mais,
            comJid: r.com_jid,
            lidOuGrupo: r.lid_ou_grupo,
            semDdd: r.sem_ddd,
          };
        }
      }
      out.tabelas[tabela] = { medido: true, empresas: rows.length, total, porEmpresa };
    } catch (err) {
      out.tabelas[tabela] = { medido: false, erro: String(err?.code || err?.message || err).slice(0, 120) };
    }
  }
  return out;
}

// Cache por processo: a primeira leitura do /health dispara a medição em segundo plano.
let resultado = null;
let emAndamento = null;

export function getPhoneSpellingStatus(pool) {
  if (resultado) return resultado;
  if (!pool) return { medido: false, motivo: "sem banco" };
  if (!emAndamento) {
    emAndamento = measurePhoneSpellings(pool)
      .then((r) => { resultado = r; })
      .catch((err) => { resultado = { medido: false, erro: String(err?.message || err).slice(0, 120) }; });
  }
  return { medido: false, emAndamento: true };
}

export function _resetPhoneSpellingStatusForTesting() {
  resultado = null;
  emAndamento = null;
}
