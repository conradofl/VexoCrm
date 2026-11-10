// Exclusão DEFINITIVA de agente de IA (uma linha de public.followup_companies,
// que também é a "empresa" do módulo de follow-up).
//
// Segura por construção: só apaga agente que não carrega NADA. As tabelas que
// apontam para followup_companies são descobertas no catálogo (pg_constraint),
// não por lista fixa — tabela nova com chave estrangeira entra na conta sem
// ninguém lembrar de vir aqui. Qualquer linha dependente recusa a exclusão,
// inclusive em tabela ON DELETE CASCADE: é justamente nelas que o banco apagaria
// campanha, jornada e documento em silêncio junto com o agente.
//
// Limite conhecido: só enxerga vínculo declarado como chave estrangeira. Uma
// tabela que guarde o id do agente em coluna solta não aparece aqui.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ON_DELETE_LABEL = { a: "no_action", r: "restrict", c: "cascade", n: "set_null", d: "set_default" };

// Chaves estrangeiras que referenciam followup_companies. Os nomes saem do
// catálogo já entre aspas (format %I / quote_ident), por isso podem ser
// interpolados na contagem.
export async function listAgentReferences(client) {
  const { rows } = await client.query(
    `SELECT cls.relname                                  AS table_name,
            format('%I.%I', ns.nspname, cls.relname)     AS qualified_table,
            con.conname                                  AS constraint_name,
            con.confdeltype::text                        AS on_delete,
            array_length(con.conkey, 1)                  AS key_columns,
            (SELECT quote_ident(att.attname)
               FROM pg_attribute att
              WHERE att.attrelid = con.conrelid
                AND att.attnum = con.conkey[1])          AS quoted_column
       FROM pg_constraint con
       JOIN pg_class cls ON cls.oid = con.conrelid
       JOIN pg_namespace ns ON ns.oid = cls.relnamespace
      WHERE con.contype = 'f'
        AND con.confrelid = to_regclass('public.followup_companies')
      ORDER BY cls.relname, con.conname`
  );
  return rows;
}

/**
 * @param {object} args
 * @param {{ connect: Function }} args.pool
 * @param {string} args.id
 * @param {(tenantId: string|null) => boolean} args.canAccessTenant — escopo do usuário autenticado
 * @returns {Promise<
 *   | { status: "not_found" }
 *   | { status: "has_dependents", agent: object, dependents: Array<{table: string, count: number, onDelete: string}> }
 *   | { status: "deleted", agent: object }
 * >}
 */
export async function deleteAgentPermanently({ pool, id, canAccessTenant }) {
  if (typeof canAccessTenant !== "function") {
    throw new Error("deleteAgentPermanently: canAccessTenant é obrigatório");
  }
  // id que não é uuid não existe; responder isso em vez de deixar o banco
  // estourar erro de tipo.
  if (!UUID_RE.test(String(id || ""))) return { status: "not_found" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // FOR UPDATE: uma linha dependente inserida por outra conexão precisa de
    // trava de chave nesta linha, então espera esta transação terminar. Sem
    // isso, daria para contar zero e apagar em cascata o que nasceu no meio.
    const { rows } = await client.query(
      `SELECT id, tenant_id, name, archived_at
         FROM public.followup_companies
        WHERE id = $1
          FOR UPDATE`,
      [id]
    );
    const agent = rows[0];
    // Fora do escopo do usuário: mesma resposta de "não existe" — nunca
    // confirma que o agente existe em outro tenant.
    if (!agent || !canAccessTenant(agent.tenant_id)) {
      await client.query("ROLLBACK");
      return { status: "not_found" };
    }

    const dependents = [];
    for (const ref of await listAgentReferences(client)) {
      if (Number(ref.key_columns) !== 1 || !ref.quoted_column) {
        throw new Error(
          `Chave estrangeira ${ref.constraint_name} em ${ref.table_name} tem formato não suportado; exclusão recusada.`
        );
      }
      const counted = await client.query(
        `SELECT count(*)::int AS total FROM ${ref.qualified_table} WHERE ${ref.quoted_column} = $1`,
        [id]
      );
      const count = counted.rows[0].total;
      if (count > 0) {
        dependents.push({
          table: ref.table_name,
          count,
          onDelete: ON_DELETE_LABEL[ref.on_delete] || ref.on_delete,
        });
      }
    }

    if (dependents.length > 0) {
      await client.query("ROLLBACK");
      return { status: "has_dependents", agent, dependents };
    }

    await client.query(`DELETE FROM public.followup_companies WHERE id = $1`, [id]);
    await client.query("COMMIT");
    return { status: "deleted", agent };
  } catch (err) {
    await client.query("ROLLBACK").catch((rollbackErr) => {
      console.error("[agentPermanentDelete] rollback falhou:", rollbackErr?.message || rollbackErr);
    });
    throw err;
  } finally {
    client.release();
  }
}

// Agentes arquivados, para a tela poder oferecer a exclusão definitiva.
// `tenantIds` é o escopo já resolvido de quem pede: lista de tenants, ou null
// só para quem enxerga todos. Lista vazia devolve nada.
export async function listArchivedAgents({ query, tenantIds }) {
  if (tenantIds !== null && !Array.isArray(tenantIds)) {
    throw new Error("listArchivedAgents: tenantIds deve ser lista ou null");
  }
  const { rows } = await query(
    `SELECT id, name, tenant_id, archived_at
       FROM public.followup_companies
      WHERE archived_at IS NOT NULL
        AND ($1::text[] IS NULL OR tenant_id = ANY($1::text[]))
      ORDER BY archived_at DESC, name ASC`,
    [tenantIds]
  );
  return rows;
}
