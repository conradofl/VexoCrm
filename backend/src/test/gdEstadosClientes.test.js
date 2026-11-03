// Tabela de estados do cliente da Geração Digital (02/11/2026). A migration roda num Postgres de
// verdade em memória (PGlite); só leads_clients é criada aqui, como dependência da FK.
// O ponto central: gd_cliente_eventos é a verdade e gd_clientes.estado_* é atalho que não pode
// divergir dela, nem por evento retroativo nem por escrita direta.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "fs";
import { resolve } from "path";

const MIGRATION = readFileSync(
  resolve("supabase/migrations/20261102120000_create_gd_estados_clientes.sql"),
  "utf8"
);

let db;
let clienteId;

const DIVERGENCIAS = `
  SELECT count(*)::int AS n FROM gd_clientes g
   WHERE g.estado_atual IS DISTINCT FROM (
     SELECT e.estado_para FROM gd_cliente_eventos e
      WHERE e.cliente_id = g.id ORDER BY e.ocorrido_em DESC, e.seq DESC LIMIT 1)
      OR g.ultimo_evento_id IS DISTINCT FROM (
     SELECT e.id FROM gd_cliente_eventos e
      WHERE e.cliente_id = g.id ORDER BY e.ocorrido_em DESC, e.seq DESC LIMIT 1)`;

function registrar(estado, ocorridoEm, { estimada = false, origem = "fluxo", ator = "humano" } = {}) {
  return db.query(`SELECT (gd_registrar_evento($1, $2, $3, $4, $5, $6, $7)).id`, [
    clienteId, estado, ocorridoEm, estimada, origem, ator, "teste",
  ]);
}

async function atalho() {
  const { rows } = await db.query(
    `SELECT estado_atual, estado_desde, estado_data_estimada FROM gd_clientes WHERE id = $1`,
    [clienteId]
  );
  return rows[0];
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE public.leads_clients (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO public.leads_clients VALUES ('geracao-digital', 'Geração Digital');
  `);
  await db.exec(MIGRATION);
});

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  // Eventos são append-only até para o teste: cada caso usa um cliente novo.
  const { rows } = await db.query(
    `INSERT INTO gd_clientes (dono_client_id, nome, origem)
     VALUES ('geracao-digital', 'Cliente ' || gen_random_uuid(), 'importacao_inicial') RETURNING id`
  );
  clienteId = rows[0].id;
});

describe("migration", () => {
  it("roda de novo sem erro e sem duplicar a configuração", async () => {
    await db.exec(MIGRATION);
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM gd_estados`);
    expect(rows[0].n).toBe(18);
  });

  it("ASSINADO usa fim_do_dia_util sem horas; a regra não aceita horas", async () => {
    const { rows } = await db.query(
      `SELECT prazo_horas, prazo_contagem FROM gd_estados WHERE codigo = 'ASSINADO'`
    );
    expect(rows[0]).toEqual({ prazo_horas: null, prazo_contagem: "fim_do_dia_util" });
    await expect(
      db.query(`INSERT INTO gd_estados (codigo, ordem, fase, rotulo_interno, rotulo_portal, prazo_horas, prazo_contagem)
                VALUES ('X', 1, 'entrada', 'x', 'x', 24, 'fim_do_dia_util')`)
    ).rejects.toThrow(/gd_estados_fim_do_dia_sem_horas/);
  });

  it("gd_cliente_eventos não tem estado_de", async () => {
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_name = 'gd_cliente_eventos' AND column_name = 'estado_de'`
    );
    expect(rows[0].n).toBe(0);
  });

  it("dono é a chave texto de leads_clients: o uuid-zero não passa", async () => {
    await expect(
      db.query(`INSERT INTO gd_clientes (dono_client_id, nome, origem)
                VALUES ('00000000-0000-0000-0000-000000000000', 'Y', 'fluxo')`)
    ).rejects.toThrow(/foreign key/);
  });
});

describe("atalho não diverge dos eventos", () => {
  it("cliente não nasce com estado", async () => {
    await expect(
      db.query(`INSERT INTO gd_clientes (dono_client_id, nome, origem, estado_atual)
                VALUES ('geracao-digital', 'Nasce ativo', 'fluxo', 'ATIVO')`)
    ).rejects.toThrow(/nasce sem estado/);
  });

  it("evento novo atualiza o atalho na mesma chamada", async () => {
    await registrar("ASSINADO", "2026-08-01T12:00:00Z", { estimada: true, origem: "importacao_inicial", ator: "importacao" });
    expect(await atalho()).toMatchObject({ estado_atual: "ASSINADO", estado_data_estimada: true });
    await registrar("ATIVO", "2026-09-01T12:00:00Z");
    expect(await atalho()).toMatchObject({ estado_atual: "ATIVO", estado_data_estimada: false });
  });

  it("evento retroativo entra na linha do tempo mas não vira estado atual", async () => {
    await registrar("ASSINADO", "2026-08-01T12:00:00Z");
    await registrar("ATIVO", "2026-09-01T12:00:00Z");
    await registrar("BRIEFING_AGENDADO", "2026-08-10T12:00:00Z", { origem: "correcao" });

    const a = await atalho();
    expect(a.estado_atual).toBe("ATIVO");
    expect(new Date(a.estado_desde).toISOString()).toBe("2026-09-01T12:00:00.000Z");
    const { rows } = await db.query(
      `SELECT estado_para FROM gd_cliente_eventos WHERE cliente_id = $1 ORDER BY ocorrido_em, seq`,
      [clienteId]
    );
    expect(rows.map((r) => r.estado_para)).toEqual(["ASSINADO", "BRIEFING_AGENDADO", "ATIVO"]);
  });

  it("escrita direta no estado é recusada, campo comum passa", async () => {
    await registrar("ATIVO", "2026-09-01T12:00:00Z");
    await expect(
      db.query(`UPDATE gd_clientes SET estado_atual = 'ENCERRADO' WHERE id = $1`, [clienteId])
    ).rejects.toThrow(/só muda por gd_registrar_evento/);
    await db.query(`UPDATE gd_clientes SET cnpj = '00.000.000/0001-00' WHERE id = $1`, [clienteId]);
    expect((await atalho()).estado_atual).toBe("ATIVO");
  });

  it("a trava não fica aberta depois da função, na mesma transação", async () => {
    await db.exec("BEGIN");
    try {
      await registrar("ATIVO", "2026-09-01T12:00:00Z");
      await expect(
        db.query(`UPDATE gd_clientes SET estado_atual = 'ENCERRADO' WHERE id = $1`, [clienteId])
      ).rejects.toThrow(/só muda por/);
    } finally {
      await db.exec("ROLLBACK");
    }
  });

  it("falha dentro da função não deixa evento sem atalho", async () => {
    const antes = (await db.query(`SELECT count(*)::int AS n FROM gd_cliente_eventos`)).rows[0].n;
    await expect(
      db.query(`SELECT gd_registrar_evento($1, 'INVENTADO', now(), false, 'fluxo', 'humano', 't')`, [clienteId])
    ).rejects.toThrow();
    await expect(
      db.query(`SELECT gd_registrar_evento($1, 'ATIVO', now(), false, 'fluxo', 'robo', 't')`, [clienteId])
    ).rejects.toThrow(/ator_tipo/);
    expect((await db.query(`SELECT count(*)::int AS n FROM gd_cliente_eventos`)).rows[0].n).toBe(antes);
  });

  it("depois de tudo acima, nenhum cliente diverge da própria linha do tempo", async () => {
    await registrar("PROPOSTA_ENVIADA", "2026-07-01T12:00:00Z");
    await registrar("PAUSADO", "2026-10-01T12:00:00Z");
    await registrar("ASSINADO", "2026-07-20T12:00:00Z", { origem: "correcao" });
    const { rows } = await db.query(DIVERGENCIAS);
    expect(rows[0].n).toBe(0);
  });
});

describe("eventos são append-only", () => {
  it.each([
    ["UPDATE", `UPDATE gd_cliente_eventos SET motivo = 'x'`],
    ["DELETE", `DELETE FROM gd_cliente_eventos`],
    ["TRUNCATE", `TRUNCATE gd_cliente_eventos`],
  ])("%s recusado", async (_op, sql) => {
    await registrar("ATIVO", "2026-09-01T12:00:00Z");
    await expect(db.query(sql)).rejects.toThrow(/append-only/);
  });
});

describe("token do portal", () => {
  const token = (c) => c.repeat(64);

  it("só aceita sha256 em hex, nunca o token ou o nome em texto puro", async () => {
    await expect(
      db.query(`INSERT INTO gd_cliente_portal_tokens (cliente_id, token_sha256, criado_por) VALUES ($1, 'tinge-brasil', 'c')`, [clienteId])
    ).rejects.toThrow(/check constraint/);
  });

  it("um ativo por cliente; revogar libera emitir outro", async () => {
    await db.query(`INSERT INTO gd_cliente_portal_tokens (cliente_id, token_sha256, criado_por) VALUES ($1, $2, 'c')`, [clienteId, token("1")]);
    await expect(
      db.query(`INSERT INTO gd_cliente_portal_tokens (cliente_id, token_sha256, criado_por) VALUES ($1, $2, 'c')`, [clienteId, token("2")])
    ).rejects.toThrow(/uq_gd_portal_token_ativo/);
    await db.query(`UPDATE gd_cliente_portal_tokens SET revogado_em = now(), revogado_por = 'c' WHERE cliente_id = $1`, [clienteId]);
    await db.query(`INSERT INTO gd_cliente_portal_tokens (cliente_id, token_sha256, criado_por) VALUES ($1, $2, 'c')`, [clienteId, token("2")]);
  });
});
