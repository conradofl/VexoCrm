// backend/src/test/chipQuotaSchemaMatrix.test.js
//
// MATRIZ código × schema. Em 05/10/2026 o d657449 passou em 2005 testes e derrubou a produção: todo teste rodava DEPOIS
// de converter evolution_instance_daily_usage.instance_id para TEXT; em produção o código novo subiu com a coluna ainda
// em UUID (a migration não rodou) e o leitor estourou `uuid = text`. Aqui cada leitor e cada escritor REAL roda contra
// os três estados do schema — uuid, uuid com a FK de junho e text — SEM converter antes, e com a conversão (DDL)
// bloqueada, que é o que a produção pode fazer.
//
// Regra (DIRETRIZES-IA.md, seção 12): código que depende de migration tem que funcionar nos DOIS estados do schema.
// Postgres REAL (pglite), com a SQL do produto (importada, não copiada).

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getChipDailyUsage,
  releaseChipDailyQuota,
  reserveChipDailyQuota,
  resetChipQuotaStateForTest,
} from "../services/chipQuota.js";
import { buildEvolutionInstancesSql, getLeadClientEvolutionInstances } from "../services/evolution.js";
import { EVOLUTION_USAGE_REPORT_SQL } from "../domains/insights/routes.js";
import { buildChipQuotaSql } from "../services/dashboardCalculations.js";
import { createChipQuotaGate } from "../services/campaignQuotaGate.js";
import { createPgliteDb } from "./helpers/pgliteDb.js";

const SLOW = 60_000;
const T = "tenant-a";
const CHIP = "aaaaaaaa-0000-4000-8000-00000000000a";
const CHIP_B = "bbbbbbbb-0000-4000-8000-00000000000b";

const BASE = `
  CREATE TABLE lead_client_evolution_instances (
    id uuid PRIMARY KEY, client_id text, name text, dispatch_webhook_url text, dispatch_webhook_token text,
    inbound_bearer_token text, owner_uid text, active boolean DEFAULT true, is_default boolean DEFAULT false,
    chip_state text DEFAULT 'cold', connection_state text, daily_limit_override int, webhook_enabled boolean DEFAULT false,
    created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), updated_at_email text, updated_by_email text);
  CREATE TABLE lead_client_n8n_settings (client_id text PRIMARY KEY, send_window_timezone text);
`;
// os três estados em que a tabela existe em bancos reais
const ESTADOS = {
  uuid: `CREATE TABLE public.evolution_instance_daily_usage (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), instance_id UUID NOT NULL, date DATE NOT NULL DEFAULT CURRENT_DATE, sent_count INTEGER NOT NULL DEFAULT 0, UNIQUE(instance_id, date))`,
  fk: `CREATE TABLE public.evolution_instance_daily_usage (instance_id UUID NOT NULL REFERENCES public.lead_client_evolution_instances(id) ON DELETE CASCADE, date DATE NOT NULL, sent_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (instance_id, date))`,
  text: `CREATE TABLE public.evolution_instance_daily_usage (instance_id TEXT NOT NULL, date DATE NOT NULL, sent_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (instance_id, date))`,
};

const openDbs = [];
afterAll(async () => {
  for (const db of openDbs) await db.close();
});
beforeEach(() => {
  resetChipQuotaStateForTest();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

/** Pool com o schema NO ESTADO pedido e, se `ddlBloqueado`, recusando qualquer DDL (conversão impossível). */
async function mundo(estado, { ddlBloqueado = false } = {}) {
  const db = await createPgliteDb("SET TimeZone = 'UTC';\n" + BASE);
  openDbs.push(db);
  await db.exec(ESTADOS[estado]);
  await db.query("INSERT INTO lead_client_evolution_instances (id, client_id, name, chip_state) VALUES ($1,$2,'Chip A','warm'), ($3,$2,'Chip B','cold')", [CHIP, T, CHIP_B]);
  const pool = {
    query: async (sql, params) => {
      if (ddlBloqueado && /^\s*(CREATE|ALTER|DO|DROP)\b/i.test(String(sql))) throw new Error("permission denied for table evolution_instance_daily_usage (DDL bloqueado no teste)");
      return db.query(sql, params);
    },
  };
  return { db, pool };
}
const tipo = async (db) => (await db.query("SELECT data_type FROM information_schema.columns WHERE table_name='evolution_instance_daily_usage' AND column_name='instance_id'")).rows[0]?.data_type;
const hojeSP = async (db) => (await db.query("SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS d")).rows[0].d;
// semeia uma linha de uso SEM passar por nenhum código do produto (nem ensure): `$1` sem cast serve para uuid e text
const semear = (db, chip, dia, n) => db.query("INSERT INTO public.evolution_instance_daily_usage (instance_id, date, sent_count) VALUES ($1, $2::date, $3::int)", [chip, dia, n]);

const TIPO_ORIGINAL = { uuid: "uuid", fk: "uuid", text: "text" };

describe("[TESTE OBRIGATÓRIO] LEITORES reais contra cada estado do schema, sem converter antes", () => {
  for (const estado of Object.keys(ESTADOS)) {
    it(`[${estado}] tela de chips (função real), mapa por tenants, relatório de uso e cota do dashboard leem o mesmo número`, async () => {
      const { db, pool } = await mundo(estado);
      const dia = await hojeSP(db);
      await semear(db, CHIP, dia, 4);
      expect(await tipo(db)).toBe(TIPO_ORIGINAL[estado]); // nada converteu a coluna

      const instancias = await getLeadClientEvolutionInstances(T, pool);
      expect(Object.fromEntries(instancias.map((i) => [i.name, Number(i.sent_count_today)]))).toEqual({ "Chip A": 4, "Chip B": 0 });
      const mapa = (await pool.query(buildEvolutionInstancesSql("many"), [[T]])).rows;
      expect(Number(mapa.find((i) => i.name === "Chip A").sent_count_today)).toBe(4);
      const relatorio = (await pool.query(EVOLUTION_USAGE_REPORT_SQL, [T, 14])).rows;
      expect(relatorio).toEqual([{ dia, chip_id: CHIP, chip_label: "Chip A", enviados: 4 }]);
      const cota = (await pool.query(buildChipQuotaSql(), [T, dia])).rows;
      expect(Object.fromEntries(cota.map((c) => [c.instance_name, c.sent_today]))).toEqual({ "Chip A": 4, "Chip B": 0 });
      expect(await tipo(db)).toBe(TIPO_ORIGINAL[estado]); // e continua sem converter
    }, SLOW);
  }
});

describe("[TESTE OBRIGATÓRIO] ESCRITORES reais (reserva, leitura, devolução) contra cada estado do schema", () => {
  for (const estado of Object.keys(ESTADOS)) {
    it(`[${estado}] com a conversão BLOQUEADA (DDL recusado): reserva, lê e devolve na coluna como ela está`, async () => {
      const { db, pool } = await mundo(estado, { ddlBloqueado: true });
      const dia = await hojeSP(db);

      expect(await reserveChipDailyQuota(CHIP, dia, pool)).toBe(1);
      expect(await reserveChipDailyQuota(CHIP, dia, pool, 3)).toBe(4); // ON CONFLICT na PK / UNIQUE do estado
      expect(await getChipDailyUsage(CHIP, dia, pool)).toBe(4);
      await releaseChipDailyQuota(CHIP, dia, pool, 2);
      expect(await getChipDailyUsage(CHIP, dia, pool)).toBe(2);
      await releaseChipDailyQuota(CHIP, dia, pool, 999); // nunca negativo
      expect(await getChipDailyUsage(CHIP, dia, pool)).toBe(0);
      expect(await getChipDailyUsage(CHIP_B, dia, pool)).toBe(0); // o outro chip não foi tocado
      expect(await tipo(db)).toBe(TIPO_ORIGINAL[estado]); // a coluna NÃO foi convertida: o código não dependeu disso
    }, SLOW);

    it(`[${estado}] com a conversão LIBERADA: o mesmo caminho funciona e a coluna termina em text`, async () => {
      const { db, pool } = await mundo(estado);
      const dia = await hojeSP(db);

      expect(await reserveChipDailyQuota(CHIP, dia, pool, 2)).toBe(2);
      expect(await getChipDailyUsage(CHIP, dia, pool)).toBe(2);
      await releaseChipDailyQuota(CHIP, dia, pool, 1);
      expect(await getChipDailyUsage(CHIP, dia, pool)).toBe(1);
      expect(await tipo(db)).toBe("text");
    }, SLOW);

    it(`[${estado}] o portão de cota do disparo funciona com a conversão bloqueada (reserva, esgota e devolve)`, async () => {
      const { db, pool } = await mundo(estado, { ddlBloqueado: true });
      const gate = createChipQuotaGate({ chip: { id: CHIP, name: "Chip A", chip_state: "cold", daily_limit_override: 3 }, pool, clock: () => new Date("2026-10-05T15:00:00Z") });

      const r = await gate.reserve(2);
      expect(r.status).toBe("reserved");
      expect((await gate.reserve(2)).status).toBe("exhausted"); // 2 + 2 > 3
      await r.release(2);
      expect((await gate.reserve(3)).status).toBe("reserved");
      expect(gate.unavailableMessages).toBe(0); // não caiu em "cota indisponível": a cota FUNCIONOU no schema antigo
      expect(await tipo(db)).toBe(TIPO_ORIGINAL[estado]);
    }, SLOW);
  }

  it("a falha da conversão é registrada e NÃO se repete a cada chamada (backoff), mas não impede a cota", async () => {
    const { pool } = await mundo("fk", { ddlBloqueado: true });
    const dia = "2026-10-05";
    const spy = vi.spyOn(pool, "query");

    await reserveChipDailyQuota(CHIP, dia, pool);
    await reserveChipDailyQuota(CHIP, dia, pool);
    await reserveChipDailyQuota(CHIP, dia, pool);

    const tentativasDeDdl = spy.mock.calls.filter((c) => /^\s*CREATE/i.test(String(c[0]))).length;
    expect(tentativasDeDdl).toBe(1); // uma tentativa; as outras duas reservas não insistiram
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("não foi possível garantir/converter a tabela de uso diário"), expect.anything());
  }, SLOW);
});

describe("o cast dos DOIS lados é necessário: as formas erradas quebram em um dos estados (prova de que a matriz mede algo)", () => {
  const formas = {
    "u.instance_id = i.id::text (só um lado)": { sql: (s) => s.replace("u.instance_id::text = i.id::text", "u.instance_id = i.id::text"), quebraEm: ["uuid", "fk"] },
    "u.instance_id = i.id (sem cast)": { sql: (s) => s.replace("u.instance_id::text = i.id::text", "u.instance_id = i.id"), quebraEm: ["text"] },
    "u.instance_id::text = i.id (outro lado)": { sql: (s) => s.replace("u.instance_id::text = i.id::text", "u.instance_id::text = i.id"), quebraEm: ["uuid", "fk", "text"] },
  };
  for (const [nome, { sql, quebraEm }] of Object.entries(formas)) {
    for (const estado of Object.keys(ESTADOS)) {
      it(`${nome} em '${estado}': ${quebraEm.includes(estado) ? "ESTOURA" : "passa"}`, async () => {
        const { pool } = await mundo(estado);
        const consulta = sql(buildEvolutionInstancesSql("one"));
        expect(consulta).not.toBe(buildEvolutionInstancesSql("one")); // a forma foi de fato trocada

        const rodar = pool.query(consulta, [T]);

        if (quebraEm.includes(estado)) await expect(rodar).rejects.toThrow(/operator does not exist/);
        else await expect(rodar).resolves.toBeDefined();
      }, SLOW);
    }
  }

  it("o INSERT com $1::text estoura em coluna uuid (por isso o produto usa $1 sem cast)", async () => {
    const { pool } = await mundo("fk");

    await expect(pool.query("INSERT INTO public.evolution_instance_daily_usage (instance_id, date, sent_count) VALUES ($1::text, $2::date, 1)", [CHIP, "2026-10-05"])).rejects.toThrow(/is of type uuid but expression is of type text/);
    await expect(pool.query("INSERT INTO public.evolution_instance_daily_usage (instance_id, date, sent_count) VALUES ($1, $2::date, 1)", [CHIP, "2026-10-05"])).resolves.toBeDefined();
  }, SLOW);

});
