// backend/src/pgSupabaseCompat.js
// Minimal PostgreSQL-backed client compatible with supabase-js patterns used in server.js.
// Errors are returned as { data, error } objects (never thrown from the query chain).

import pg from "pg";

const { Pool } = pg;

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

function parseBooleanish(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function shouldRejectUnauthorized() {
  const normalized = String(process.env.PG_SSL_REJECT_UNAUTHORIZED ?? "").trim().toLowerCase();
  if (!normalized) return true;
  return !(normalized === "0" || normalized === "false" || normalized === "no");
}

function parseSslConfigFromConnectionString(connectionString) {
  try {
    const url = new URL(connectionString);
    const sslmode = (url.searchParams.get("sslmode") || "").trim().toLowerCase();

    if (!sslmode || sslmode === "disable") {
      return false;
    }

    if (sslmode === "require" || sslmode === "prefer" || sslmode === "allow") {
      return {
        rejectUnauthorized: shouldRejectUnauthorized(),
      };
    }
  } catch {
    // Fall back to env/default handling below.
  }

  if (parseBooleanish(process.env.PG_FORCE_SSL)) {
    return {
      rejectUnauthorized: shouldRejectUnauthorized(),
    };
  }

  return false;
}

/**
 * @param {string} connectionString
 * @returns {import("pg").Pool}
 */
export function createDatabasePool(connectionString) {
  const ssl = parseSslConfigFromConnectionString(connectionString);
  return new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 60_000),
    maxUses: Number(process.env.PG_MAX_USES || 7500),
    keepAlive: true,
    keepAliveInitialDelayMillis: Number(process.env.PG_KEEPALIVE_INITIAL_DELAY_MS || 10_000),
    // Rede de segurança contra queries travadas em lock: o `pg` aplica estes
    // dois timeouts a TODA conexão criada pelo pool (são repassados como
    // parâmetros de conexão), logo cobrem todas as queries — diretas e via
    // o wrapper supabase-compat. statement_timeout corta a query no servidor
    // (Postgres aborta e devolve erro); query_timeout corta no cliente como
    // reforço. Sem isto, uma query em lock pendura o disparo em "running"
    // para sempre, sem exceção (mesma classe do bug da Fatia 3a).
    statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || 30_000),
    query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS || 30_000),
    ssl,
    application_name: process.env.PG_APPLICATION_NAME || "vexoapi",
  });
}

/**
 * @param {import("pg").Pool} pool
 * @returns {{ from: (table: string) => PgQueryBuilder }}
 */
export function createPgSupabaseClient(pool) {
  return {
    from(table) {
      return new PgQueryBuilder(pool, table);
    },
    async query(sql, params = []) {
      try {
        const result = await pool.query(sql, params);
        return { rows: result.rows, error: null };
      } catch (err) {
        return { rows: [], error: mapPgError(err) };
      }
    },
  };
}

function assertIdent(name, label) {
  const s = String(name || "").trim();
  if (!IDENT_RE.test(s)) {
    throw new Error(`Invalid ${label}: ${String(name)}`);
  }
  return s;
}

function quoteIdent(name) {
  return `"${assertIdent(name, "identifier")}"`;
}

function mapPgError(err) {
  if (!err || typeof err !== "object") {
    return { message: String(err), code: "UNKNOWN" };
  }
  return {
    message: err.message || "Database error",
    code: err.code || "UNKNOWN",
    details: err.detail || undefined,
    hint: err.hint || undefined,
  };
}

function splitSelectColumns(sel) {
  const raw = String(sel || "").trim();
  if (raw === "*") return "*";
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  for (const p of parts) {
    assertIdent(p, "select column");
  }
  return parts.map(quoteIdent).join(", ");
}

function parseConflictTarget(onConflict) {
  const s = String(onConflict || "").trim();
  if (!s) throw new Error("upsert requires onConflict");
  return s.split(",").map((c) => assertIdent(c.trim(), "conflict column"));
}

function prepareRowValues(row) {
  const out = { ...row };
  for (const k of Object.keys(out)) {
    assertIdent(k, "column");
    // pg driver doesn't auto-cast JS objects/arrays to jsonb — serialize them
    if (out[k] !== null && typeof out[k] === "object") {
      out[k] = JSON.stringify(out[k]);
    }
  }
  return out;
}

class PgQueryBuilder {
  constructor(pool, table) {
    this.pool = pool;
    this.table = assertIdent(table, "table");
    /** @type {"select"|"insert"|"update"|"delete"|"upsert"|null} */
    this.mode = null;
    this.selectColumns = "*";
    /** @type {Record<string, unknown>} */
    this.selectOptions = {};
    this.filters = [];
    this.orders = [];
    this.limitVal = null;
    this.offsetVal = null;
    /** @type {Record<string, unknown>|Record<string, unknown>[]|null} */
    this.insertRows = null;
    /** @type {Record<string, unknown>|null} */
    this.patch = null;
    /** @type {{ onConflict: string, ignoreDuplicates?: boolean }|null} */
    this.upsertOptions = null;
    /** @type {Record<string, unknown>|null} */
    this.upsertRows = null;
    /** @type {"none"|"one"|"maybeOne"} */
    this.resultShape = "none";
    this.deleteCountExact = false;
    /** @type {string|null} RETURNING columns after insert/update/upsert */
    this.returningColumns = null;
  }

  select(columns, options) {
    if (this.mode === "insert" || this.mode === "update" || this.mode === "upsert") {
      this.returningColumns = columns ?? "*";
      return this;
    }
    this.mode = "select";
    this.selectColumns = columns;
    this.selectOptions = options && typeof options === "object" ? options : {};
    return this;
  }

  insert(rows) {
    this.mode = "insert";
    this.insertRows = rows;
    return this;
  }

  update(patch) {
    this.mode = "update";
    this.patch = patch && typeof patch === "object" ? { ...patch } : {};
    return this;
  }

  upsert(rows, options) {
    this.mode = "upsert";
    this.upsertRows = rows;
    this.upsertOptions = options && typeof options === "object" ? options : null;
    return this;
  }

  delete(opts) {
    this.mode = "delete";
    this.deleteCountExact = !!(opts && opts.count === "exact");
    return this;
  }

  eq(column, value) {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  neq(column, value) {
    this.filters.push({ type: "neq", column, value });
    return this;
  }

  in(column, values) {
    this.filters.push({ type: "in", column, values: Array.isArray(values) ? values : [] });
    return this;
  }

  is(column, value) {
    this.filters.push({ type: "is", column, value });
    return this;
  }

  not(column, op, value) {
    this.filters.push({ type: "not", column, op, value });
    return this;
  }

  or(expression) {
    this.filters.push({ type: "or", expression });
    return this;
  }

  gte(column, value) {
    this.filters.push({ type: "gte", column, value });
    return this;
  }

  lte(column, value) {
    this.filters.push({ type: "lte", column, value });
    return this;
  }

  order(column, opts = {}) {
    this.orders.push({
      column,
      ascending: opts.ascending !== false,
      nullsFirst: opts.nullsFirst,
    });
    return this;
  }

  limit(n) {
    this.limitVal = n;
    return this;
  }

  range(from, to) {
    const start = Number(from);
    const end = Number(to);
    if (Number.isFinite(start) && start >= 0) {
      this.offsetVal = Math.floor(start);
    }
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      this.limitVal = Math.floor(end - start + 1);
    }
    return this;
  }

  single() {
    this.resultShape = "one";
    return this;
  }

  maybeSingle() {
    this.resultShape = "maybeOne";
    return this;
  }

  then(onFulfilled, onRejected) {
    return this.execute().then(onFulfilled, onRejected);
  }

  catch(onRejected) {
    return this.execute().catch(onRejected);
  }

  async execute() {
    try {
      return await this.run();
    } catch (err) {
      return { data: null, error: mapPgError(err), count: null };
    }
  }

  buildWhere(startIndex) {
    let i = startIndex;
    const parts = [];
    const params = [];
    for (const f of this.filters) {
      if (f.type === "or") {
        const parsed = this.buildOrFilter(f.expression, i);
        parts.push(parsed.sql);
        params.push(...parsed.params);
        i = parsed.nextIndex;
        continue;
      }

      const col = quoteIdent(f.column);
      if (f.type === "eq") {
        if (f.value === null) {
          parts.push(`${col} IS NULL`);
        } else {
          i += 1;
          parts.push(`${col} = $${i}`);
          params.push(f.value);
        }
      } else if (f.type === "neq") {
        i += 1;
        parts.push(`${col} <> $${i}`);
        params.push(f.value);
      } else if (f.type === "in") {
        if (!f.values.length) {
          parts.push("FALSE");
        } else {
          const ph = f.values.map(() => {
            i += 1;
            return `$${i}`;
          });
          f.values.forEach((v) => params.push(v));
          parts.push(`${col} IN (${ph.join(", ")})`);
        }
      } else if (f.type === "is") {
        if (f.value === null) parts.push(`${col} IS NULL`);
        else parts.push(`${col} IS NOT NULL`);
      } else if (f.type === "not" && f.op === "is" && f.value === null) {
        parts.push(`${col} IS NOT NULL`);
      } else if (f.type === "gte") {
        i += 1;
        parts.push(`${col} >= $${i}`);
        params.push(f.value);
      } else if (f.type === "lte") {
        i += 1;
        parts.push(`${col} <= $${i}`);
        params.push(f.value);
      } else {
        throw new Error(`Unsupported filter: ${JSON.stringify(f)}`);
      }
    }
    const sql = parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
    return { sql, params, nextIndex: i };
  }

  buildOrFilter(expression, startIndex) {
    let i = startIndex;
    const params = [];
    const parts = String(expression || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const pieces = entry.split(".");
        if (pieces.length < 3) {
          throw new Error(`Unsupported or filter: ${entry}`);
        }
        const [column, op, ...valueParts] = pieces;
        const col = quoteIdent(column);
        const rawValue = valueParts.join(".");
        if (op === "is" && rawValue === "null") {
          return `${col} IS NULL`;
        }
        if (op === "eq") {
          i += 1;
          params.push(rawValue);
          return `${col} = $${i}`;
        }
        throw new Error(`Unsupported or filter: ${entry}`);
      });
    if (!parts.length) {
      throw new Error("or() requires at least one filter");
    }
    return { sql: `(${parts.join(" OR ")})`, params, nextIndex: i };
  }

  buildOrderBy() {
    if (!this.orders.length) return "";
    const chunks = this.orders.map(({ column, ascending, nullsFirst }) => {
      const col = quoteIdent(column);
      const dir = ascending ? "ASC" : "DESC";
      let nulls = "";
      if (nullsFirst === true) nulls = " NULLS FIRST";
      else if (nullsFirst === false) nulls = " NULLS LAST";
      return `${col} ${dir}${nulls}`;
    });
    return ` ORDER BY ${chunks.join(", ")}`;
  }

  buildLimit() {
    if (this.limitVal == null) return "";
    const n = Number(this.limitVal);
    if (!Number.isFinite(n) || n < 0) return "";
    return ` LIMIT ${Math.floor(n)}`;
  }

  buildOffset() {
    if (this.offsetVal == null) return "";
    const n = Number(this.offsetVal);
    if (!Number.isFinite(n) || n < 0) return "";
    return ` OFFSET ${Math.floor(n)}`;
  }

  async run() {
    if (this.mode === "select") {
      return this.runSelect();
    }
    if (this.mode === "insert") {
      return this.runInsert();
    }
    if (this.mode === "update") {
      return this.runUpdate();
    }
    if (this.mode === "delete") {
      return this.runDelete();
    }
    if (this.mode === "upsert") {
      return this.runUpsert();
    }
    throw new Error("No query operation (select/insert/update/delete/upsert)");
  }

  async runSelect() {
    const head = this.selectOptions?.head === true && this.selectOptions?.count === "exact";
    if (head) {
      const { sql: whereSql, params, nextIndex } = this.buildWhere(0);
      const q = `SELECT count(*)::int AS c FROM ${quoteIdent(this.table)}${whereSql}`;
      const r = await this.pool.query(q, params);
      const count = r.rows[0]?.c ?? 0;
      return { data: null, error: null, count };
    }

    const cols = splitSelectColumns(this.selectColumns);
    const { sql: whereSql, params, nextIndex } = this.buildWhere(0);
    const orderSql = this.buildOrderBy();
    const limitSql = this.buildLimit();
    const offsetSql = this.buildOffset();
    const q = `SELECT ${cols} FROM ${quoteIdent(this.table)}${whereSql}${orderSql}${limitSql}${offsetSql}`;
    const r = await this.pool.query(q, params);
    let rows = r.rows;
    let count = null;

    if (this.selectOptions?.count === "exact") {
      const countQuery = `SELECT count(*)::int AS c FROM ${quoteIdent(this.table)}${whereSql}`;
      const countResult = await this.pool.query(countQuery, params);
      count = countResult.rows[0]?.c ?? 0;
    }

    if (this.resultShape === "one") {
      if (rows.length === 0) {
        return {
          data: null,
          error: {
            code: "PGRST116",
            message: "JSON object requested, multiple (or no) rows returned",
          },
          count: null,
        };
      }
      if (rows.length > 1) {
        return {
          data: null,
          error: {
            code: "PGRST116",
            message: "JSON object requested, multiple (or no) rows returned",
          },
          count: null,
        };
      }
      rows = rows[0];
    } else if (this.resultShape === "maybeOne") {
      if (rows.length > 1) {
        return {
          data: null,
          error: {
            code: "PGRST116",
            message: "JSON object requested, multiple (or no) rows returned",
          },
          count: null,
        };
      }
      rows = rows[0] ?? null;
    }

    return { data: rows, error: null, count };
  }

  async runInsert() {
    const rowsIn = Array.isArray(this.insertRows)
      ? this.insertRows
      : this.insertRows
        ? [this.insertRows]
        : [];
    if (!rowsIn.length) {
      return { data: null, error: null, count: null };
    }
    const rows = rowsIn.map((r) => prepareRowValues(r));
    const keySet = new Set();
    for (const row of rows) {
      Object.keys(row).forEach((k) => keySet.add(k));
    }
    const columns = [...keySet];
    if (!columns.length) {
      return { data: null, error: null, count: null };
    }
    for (const row of rows) {
      for (const c of columns) {
        if (!(c in row)) row[c] = null;
      }
    }

    const params = [];
    const placeholders = [];
    let idx = 0;
    for (const row of rows) {
      const ph = columns.map((c) => {
        idx += 1;
        params.push(row[c]);
        return `$${idx}`;
      });
      placeholders.push(`(${ph.join(", ")})`);
    }

    const colList = columns.map(quoteIdent).join(", ");
    let q = `INSERT INTO ${quoteIdent(this.table)} (${colList}) VALUES ${placeholders.join(", ")}`;

    if (this.returningColumns) {
      const ret = this.returningColumns === "*" ? "*" : splitSelectColumns(this.returningColumns);
      q += ` RETURNING ${ret}`;
    }

    const r = await this.pool.query(q, params);
    if (!this.returningColumns) {
      return { data: null, error: null, count: null };
    }
    return this.formatWriteResult(r.rows);
  }

  async runUpdate() {
    const patch = prepareRowValues(this.patch || {});
    const keys = Object.keys(patch);
    if (!keys.length) {
      throw new Error("update() requires at least one column");
    }
    const setParts = [];
    const params = [];
    let idx = 0;
    for (const k of keys) {
      idx += 1;
      setParts.push(`${quoteIdent(k)} = $${idx}`);
      params.push(patch[k]);
    }
    const { sql: whereSql, params: wParams } = this.buildWhere(idx);
    params.push(...wParams);
    let q = `UPDATE ${quoteIdent(this.table)} SET ${setParts.join(", ")}${whereSql}`;

    if (this.returningColumns) {
      const ret = this.returningColumns === "*" ? "*" : splitSelectColumns(this.returningColumns);
      q += ` RETURNING ${ret}`;
    }

    const r = await this.pool.query(q, params);
    if (!this.returningColumns) {
      return { data: null, error: null, count: null };
    }
    return this.formatWriteResult(r.rows);
  }

  formatWriteResult(rows) {
    if (this.resultShape === "one") {
      if (!rows.length) {
        return {
          data: null,
          error: {
            code: "PGRST116",
            message: "JSON object requested, multiple (or no) rows returned",
          },
          count: null,
        };
      }
      if (rows.length > 1) {
        return {
          data: null,
          error: {
            code: "PGRST116",
            message: "JSON object requested, multiple (or no) rows returned",
          },
          count: null,
        };
      }
      return { data: rows[0], error: null, count: null };
    }
    if (this.resultShape === "maybeOne") {
      if (rows.length > 1) {
        return {
          data: null,
          error: {
            code: "PGRST116",
            message: "JSON object requested, multiple (or no) rows returned",
          },
          count: null,
        };
      }
      return { data: rows[0] ?? null, error: null, count: null };
    }
    return { data: rows, error: null, count: null };
  }

  async runDelete() {
    const { sql: whereSql, params } = this.buildWhere(0);
    const q = `DELETE FROM ${quoteIdent(this.table)}${whereSql}`;
    const r = await this.pool.query(q, params);
    if (this.deleteCountExact) {
      return { data: null, error: null, count: r.rowCount ?? 0 };
    }
    return { data: null, error: null, count: null };
  }

  async runUpsert() {
    const opt = this.upsertOptions;
    if (!opt?.onConflict) {
      throw new Error("upsert requires { onConflict: string }");
    }
    const conflictCols = parseConflictTarget(opt.onConflict);
    const rowsIn = Array.isArray(this.upsertRows)
      ? this.upsertRows
      : this.upsertRows
        ? [this.upsertRows]
        : [];
    if (!rowsIn.length) {
      return { data: null, error: null, count: null };
    }
    const rows = rowsIn.map((r) => prepareRowValues(r));
    const keySet = new Set();
    for (const row of rows) {
      Object.keys(row).forEach((k) => keySet.add(k));
    }
    const columns = [...keySet];
    if (!columns.length) {
      return { data: null, error: null, count: null };
    }
    for (const row of rows) {
      for (const c of columns) {
        if (!(c in row)) row[c] = null;
      }
    }

    const conflictQuoted = conflictCols.map(quoteIdent).join(", ");
    const updateCols = columns.filter((c) => !conflictCols.includes(c));
    const setClause =
      updateCols.length > 0
        ? updateCols.map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`).join(", ")
        : conflictCols.map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`).join(", ");

    const params = [];
    const placeholders = [];
    let idx = 0;
    for (const row of rows) {
      const ph = columns.map((c) => {
        idx += 1;
        params.push(row[c]);
        return `$${idx}`;
      });
      placeholders.push(`(${ph.join(", ")})`);
    }

    const colList = columns.map(quoteIdent).join(", ");
    let q = `INSERT INTO ${quoteIdent(this.table)} (${colList}) VALUES ${placeholders.join(
      ", "
    )} ON CONFLICT (${conflictQuoted}) DO UPDATE SET ${setClause}`;

    if (opt.ignoreDuplicates === true) {
      q = `INSERT INTO ${quoteIdent(this.table)} (${colList}) VALUES ${placeholders.join(
        ", "
      )} ON CONFLICT (${conflictQuoted}) DO NOTHING`;
    }

    if (this.returningColumns) {
      const ret = this.returningColumns === "*" ? "*" : splitSelectColumns(this.returningColumns);
      q += ` RETURNING ${ret}`;
    }

    const r = await this.pool.query(q, params);
    if (!this.returningColumns) {
      return { data: null, error: null, count: null };
    }
    return this.formatWriteResult(r.rows);
  }
}
