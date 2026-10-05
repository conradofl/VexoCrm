// backend/src/test/chipUsageTypeConvergence.test.js
//
// evolution_instance_daily_usage.instance_id: UM tipo (TEXT), qualquer que seja o formato em que a tabela já
// existe. Havia dois criadores (evolution.js como UUID, chipQuota.js como TEXT) e leitores que assumiam cada um
// dos tipos: um dos dois sempre quebrava (`uuid = text` / `text = uuid`).
//
// Provado em Postgres REAL (pglite) com a SQL do produto (importada, não copiada), partindo dos TRÊS estados
// possíveis: tabela criada como UUID (o DDL antigo do evolution.js), como TEXT (o do chipQuota.js) e inexistente.
// Limites do pglite (helpers/pgliteDb.js): não prova que roda em produção; todas as consultas rodam sem adaptação.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  CONVERGE_USAGE_INSTANCE_ID_SQL,
  CREATE_USAGE_TABLE_SQL,
  ensureEvolutionInstanceDailyUsageTable,
  getChipDailyUsage,
  releaseChipDailyQuota,
  reserveChipDailyQuota,
  resetChipQuotaStateForTest,
} from "../services/chipQuota.js";
import { buildEvolutionInstancesSql, getLeadClientEvolutionInstances } from "../services/evolution.js";
import { EVOLUTION_USAGE_REPORT_SQL } from "../domains/insights/routes.js";
import { buildChipQuotaSql } from "../services/dashboardCalculations.js";
import { createPgliteDb } from "./helpers/pgliteDb.js";

const SLOW = 60_000;
const T = "tenant-a";
const CHIP = "aaaaaaaa-0000-4000-8000-00000000000a";
const CHIP_B = "bbbbbbbb-0000-4000-8000-00000000000b";

// o DDL ANTIGO do evolution.js (UUID) e o do chipQuota.js (TEXT), como existiram em bancos reais
const LEGACY_UUID = `CREATE TABLE public.evolution_instance_daily_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), instance_id UUID NOT NULL, date DATE NOT NULL DEFAULT CURRENT_DATE,
  sent_count INTEGER NOT NULL DEFAULT 0, UNIQUE(instance_id, date))`;
const LEGACY_TEXT = `CREATE TABLE public.evolution_instance_daily_usage (
  instance_id TEXT NOT NULL, date DATE NOT NULL, sent_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (instance_id, date))`;

const BASE = `
  CREATE TABLE lead_client_evolution_instances (
    id uuid PRIMARY KEY, client_id text, name text, dispatch_webhook_url text, dispatch_webhook_token text,
    inbound_bearer_token text, owner_uid text, active boolean DEFAULT true, is_default boolean DEFAULT false,
    chip_state text DEFAULT 'cold', connection_state text, daily_limit_override int, webhook_enabled boolean DEFAULT false,
    created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), updated_by_email text);
  CREATE TABLE lead_client_n8n_settings (client_id text PRIMARY KEY, send_window_timezone text);
`;

const openDbs = [];
async function mundo(estadoInicial) {
  const db = await createPgliteDb("SET TimeZone = 'UTC';\n" + BASE); // CURRENT_DATE = dia UTC, como um banco típico de produção
  openDbs.push(db);
  await db.exec("SET TimeZone = 'UTC'");
  if (estadoInicial === "uuid") await db.exec(LEGACY_UUID);
  if (estadoInicial === "text") await db.exec(LEGACY_TEXT);
  await db.query("INSERT INTO lead_client_evolution_instances (id, client_id, name, chip_state) VALUES ($1,$2,'Chip A','warm'), ($3,$2,'Chip B','cold')", [CHIP, T, CHIP_B]);
  return db;
}
afterAll(async () => {
  for (const db of openDbs) await db.close();
});
beforeEach(() => resetChipQuotaStateForTest());

const tipo = async (db) => (await db.query("SELECT data_type FROM information_schema.columns WHERE table_name='evolution_instance_daily_usage' AND column_name='instance_id'")).rows[0]?.data_type;
const hojeSP = async (db) => (await db.query("SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS d")).rows[0].d;

describe("a coluna converge para TEXT a partir de qualquer estado", () => {
  for (const inicio of ["uuid", "text", "nenhum"]) {
    it(`[TESTE OBRIGATÓRIO] começando de '${inicio}': vira TEXT, preserva as linhas e reserva/lê/devolve funcionam`, async () => {
      const db = await mundo(inicio);
      const dia = await hojeSP(db);
      if (inicio !== "nenhum") {
        await db.query("INSERT INTO evolution_instance_daily_usage (instance_id, date, sent_count) VALUES ($1,$2,7)", [CHIP, dia]);
        await db.query("INSERT INTO evolution_instance_daily_usage (instance_id, date, sent_count) VALUES ($1,'2026-01-01',3)", [CHIP_B]);
      }

      await ensureEvolutionInstanceDailyUsageTable(db);

      expect(await tipo(db)).toBe("text");
      if (inicio !== "nenhum") {
        const linhas = (await db.query("SELECT instance_id, to_char(date,'YYYY-MM-DD') AS d, sent_count FROM evolution_instance_daily_usage ORDER BY d")).rows;
        expect(linhas).toEqual([
          { instance_id: CHIP_B, d: "2026-01-01", sent_count: 3 },
          { instance_id: CHIP, d: dia, sent_count: 7 },
        ]);
      }
      const base = inicio === "nenhum" ? 0 : 7;
      expect(await reserveChipDailyQuota(CHIP, dia, db)).toBe(base + 1); // ON CONFLICT funciona na PK ou na UNIQUE
      expect(await reserveChipDailyQuota(CHIP, dia, db, 3)).toBe(base + 4); // reserva N de uma vez
      await releaseChipDailyQuota(CHIP, dia, db, 2);
      expect(await getChipDailyUsage(CHIP, dia, db)).toBe(base + 2);
      await releaseChipDailyQuota(CHIP, dia, db, 999); // nunca negativo
      expect(await getChipDailyUsage(CHIP, dia, db)).toBe(0);
    }, SLOW);

    it(`começando de '${inicio}': todos os LEITORES funcionam (tela de chips, relatório, dashboard)`, async () => {
      const db = await mundo(inicio);
      const dia = await hojeSP(db);
      await ensureEvolutionInstanceDailyUsageTable(db);
      await reserveChipDailyQuota(CHIP, dia, db, 4);

      // "enviados hoje" na tela de chips — a função REAL do produto, com o pool do pglite
      const instancias = await getLeadClientEvolutionInstances(T, db);
      expect(Object.fromEntries(instancias.map((i) => [i.name, Number(i.sent_count_today)]))).toEqual({ "Chip A": 4, "Chip B": 0 });
      // mapa por tenants (mesma consulta, escopo "many")
      const mapa = (await db.query(buildEvolutionInstancesSql("many"), [[T]])).rows;
      expect(mapa.find((i) => i.name === "Chip A").sent_count_today).toBe(4);
      // relatório de uso por chip
      const relatorio = (await db.query(EVOLUTION_USAGE_REPORT_SQL, [T, 14])).rows;
      expect(relatorio).toEqual([{ dia, chip_id: CHIP, chip_label: "Chip A", enviados: 4 }]);
      // cota de hoje do dashboard
      const cota = (await db.query(buildChipQuotaSql(), [T, dia])).rows;
      expect(Object.fromEntries(cota.map((c) => [c.instance_name, c.sent_today]))).toEqual({ "Chip A": 4, "Chip B": 0 });
    }, SLOW);
  }

  it("a migration leva o que existe para TEXT, nos dois formatos, e rodar de novo não muda nada", async () => {
    const sql = readFileSync(resolve("supabase/migrations/20261004130000_converge_evolution_instance_daily_usage_instance_id.sql"), "utf8");
    for (const inicio of ["uuid", "text", "nenhum"]) {
      const db = await mundo(inicio);
      if (inicio === "uuid") await db.query("INSERT INTO evolution_instance_daily_usage (instance_id, date, sent_count) VALUES ($1,'2026-01-01',9)", [CHIP]);

      await db.exec(sql);
      await db.exec(sql);

      expect(await tipo(db), inicio).toBe("text");
      if (inicio === "uuid") {
        expect((await db.query("SELECT instance_id, sent_count FROM evolution_instance_daily_usage")).rows).toEqual([{ instance_id: CHIP, sent_count: 9 }]);
      }
    }
  }, SLOW);

  it("o bloco da migration é o MESMO do código (não diverge), e a sentinela do migrate.js reconhece 'já é TEXT'", () => {
    const sql = readFileSync(resolve("supabase/migrations/20261004130000_converge_evolution_instance_daily_usage_instance_id.sql"), "utf8");
    const migrate = readFileSync(resolve("src/migrate.js"), "utf8");

    expect(sql).toContain(CONVERGE_USAGE_INSTANCE_ID_SQL);
    expect(migrate).toMatch(/"20261004130000_converge_evolution_instance_daily_usage_instance_id\.sql":[^]*?data_type='text'/);
  });

  it("o DDL do criador único já nasce TEXT (não depende da convergência para ficar certo)", () => {
    expect(CREATE_USAGE_TABLE_SQL).toMatch(/instance_id TEXT NOT NULL/);
    expect(CREATE_USAGE_TABLE_SQL).not.toMatch(/UUID/i);
  });

  it("há UM criador só: evolution.js não cria mais a tabela, delega ao chipQuota.js", () => {
    const evolution = readFileSync(resolve("src/services/evolution.js"), "utf8");
    const quota = readFileSync(resolve("src/services/chipQuota.js"), "utf8");

    expect(evolution).not.toMatch(/CREATE TABLE IF NOT EXISTS public\.evolution_instance_daily_usage/);
    expect(evolution).toMatch(/ensureEvolutionInstanceDailyUsageTable\(db\)/);
    expect(quota).toMatch(/CREATE TABLE IF NOT EXISTS public\.evolution_instance_daily_usage/);
    // a conversão não engole erro (antes: .catch(() => {}) deixou a tabela em UUID em alguns bancos)
    expect(quota).not.toMatch(/ALTER COLUMN instance_id TYPE TEXT\s*`\)\.catch/);
  });
});

describe("'enviados hoje' é o dia do TENANT, o mesmo em que a cota é gravada", () => {
  const dia = async (db, fuso) => (await db.query("SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS d", [fuso])).rows[0].d;

  // Escolhe um fuso cujo "hoje" NÃO seja o dia `proibido` (o do CURRENT_DATE do banco, ou o do padrão de São Paulo).
  // Entre +14h e -11h sempre existe um que serve, em qualquer hora do dia.
  async function fusoQueNaoE(db, proibido) {
    for (const candidato of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
      const d = await dia(db, candidato);
      if (d !== proibido) return { fuso: candidato, dia: d };
    }
    throw new Error("nenhum fuso candidato serve");
  }

  async function lerHoje(db, fuso) {
    await db.query("INSERT INTO lead_client_n8n_settings (client_id, send_window_timezone) VALUES ($1,$2) ON CONFLICT (client_id) DO UPDATE SET send_window_timezone = EXCLUDED.send_window_timezone", [T, fuso]);
    return Number((await getLeadClientEvolutionInstances(T, db)).find((i) => i.name === "Chip A").sent_count_today);
  }

  // semeia linhas distintas nos dias vizinhos (para que ler o dia errado dê outro número) e devolve o que há no dia pedido
  async function semear(db) {
    await ensureEvolutionInstanceDailyUsageTable(db);
    const base = await dia(db, "America/Sao_Paulo");
    const hoje = (await db.query("SELECT to_char($1::date + g, 'YYYY-MM-DD') AS d, g FROM generate_series(-2, 2) g ORDER BY g", [base])).rows;
    for (const { d, g } of hoje) await reserveChipDailyQuota(CHIP, d, db, 10 + (g + 3) * 7); // 17, 24, 31, 38, 45: todos distintos
    const contagem = async (d) => Number((await db.query("SELECT sent_count FROM evolution_instance_daily_usage WHERE instance_id=$1 AND date=$2::date", [CHIP, d])).rows[0]?.sent_count ?? 0);
    return contagem;
  }

  it("[TESTE OBRIGATÓRIO] lê a linha do dia do fuso do tenant, não a do CURRENT_DATE do banco", async () => {
    const db = await mundo("nenhum");
    const contagem = await semear(db);
    const utc = await dia(db, "UTC");
    const { fuso, dia: diaDoFuso } = await fusoQueNaoE(db, utc);

    const lido = await lerHoje(db, fuso);

    expect(lido).toBe(await contagem(diaDoFuso));
    expect(lido).not.toBe(await contagem(utc)); // o CURRENT_DATE do banco leria outra linha
  }, SLOW);

  it("[TESTE OBRIGATÓRIO] usa o fuso configurado do tenant, não o padrão de Brasília", async () => {
    const db = await mundo("nenhum");
    const contagem = await semear(db);
    const sp = await dia(db, "America/Sao_Paulo");
    const { fuso, dia: diaDoFuso } = await fusoQueNaoE(db, sp);

    expect(await lerHoje(db, fuso)).toBe(await contagem(diaDoFuso));
    expect(await contagem(diaDoFuso)).not.toBe(await contagem(sp));
  }, SLOW);

  it("sem configuração de fuso o padrão é America/Sao_Paulo", async () => {
    const db = await mundo("nenhum");
    const contagem = await semear(db);
    const sp = await dia(db, "America/Sao_Paulo");

    const instancias = await getLeadClientEvolutionInstances(T, db);

    expect(Number(instancias.find((i) => i.name === "Chip A").sent_count_today)).toBe(await contagem(sp));
  }, SLOW);

  it("fuso inválido nas configurações cai no padrão em vez de derrubar a consulta", async () => {
    const db = await mundo("nenhum");
    const contagem = await semear(db);
    const sp = await dia(db, "America/Sao_Paulo");

    expect(await lerHoje(db, "Marte/Olympus")).toBe(await contagem(sp));
  }, SLOW);
});
