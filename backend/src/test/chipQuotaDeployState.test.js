// backend/src/test/chipQuotaDeployState.test.js
//
// O ESTADO EXATO DO DEPLOY de 05/10/2026: código novo, pool de PRODUÇÃO (`db === pgDatabasePool`, que é o que dispara o
// ensureLeadClientEvolutionInstancesTable dentro do leitor), tabela evolution_instance_daily_usage em UUID COM a FK de
// junho, e a migration que converteria NÃO rodou. O teste anterior passava um pool próprio — o que pula esse caminho — e
// chamava o ensure à mão antes de ler. Aqui nada é preparado: o leitor real sobe sozinho contra o schema antigo.
//
// Dois cenários do que a produção pode fazer com a conversão (DDL): ela é aceita (o leitor se cura sozinho) ou é recusada
// (permissão/lock) — em ambos o leitor tem que funcionar. Postgres REAL (pglite).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const T = "tenant-a";
const CHIP = "aaaaaaaa-0000-4000-8000-00000000000a";

// o pgDatabasePool deste arquivo é um Postgres em memória; `__ddlBloqueado` simula "a conversão é recusada"
vi.mock("../services/database.js", async (importOriginal) => {
  const actual = await importOriginal();
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  await db.exec("SET TimeZone = 'UTC'");
  globalThis.__deployDb = db;
  globalThis.__ddlBloqueado = false;
  const pool = {
    query: async (sql, params) => {
      if (globalThis.__ddlBloqueado && /^\s*(CREATE|ALTER|DO|DROP)\b/i.test(String(sql))) throw new Error("permission denied (DDL bloqueado no teste)");
      return db.query(sql, params);
    },
  };
  return { ...actual, pgDatabasePool: pool };
});

const SCHEMA_DE_PRODUCAO = `
  CREATE TABLE public.lead_client_evolution_instances (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL, name text NOT NULL DEFAULT 'Evolution',
    dispatch_webhook_url text NOT NULL DEFAULT 'https://evo.test/message/sendText/x', dispatch_webhook_token text, inbound_bearer_token text,
    owner_uid text, active boolean NOT NULL DEFAULT true, is_default boolean NOT NULL DEFAULT false, chip_state text DEFAULT 'cold',
    connection_state text, daily_limit_override int, webhook_enabled boolean DEFAULT false, created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(), updated_by_email text);
  CREATE TABLE public.lead_client_n8n_settings (client_id text PRIMARY KEY, send_window_timezone text);
  -- como o routes.js criava em junho: UUID com FK. A migration NÃO rodou.
  CREATE TABLE public.evolution_instance_daily_usage (
    instance_id UUID NOT NULL REFERENCES public.lead_client_evolution_instances(id) ON DELETE CASCADE,
    date DATE NOT NULL, sent_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (instance_id, date));
`;

async function bancoNoEstadoDeProducao() {
  const db = globalThis.__deployDb;
  // o Postgres em memória é um só por arquivo: cada teste recomeça do schema de produção
  await db.exec("DROP TABLE IF EXISTS public.evolution_instance_daily_usage; DROP TABLE IF EXISTS public.lead_client_n8n_settings; DROP TABLE IF EXISTS public.lead_client_evolution_instances CASCADE;");
  await db.exec(SCHEMA_DE_PRODUCAO);
  await db.query("INSERT INTO public.lead_client_evolution_instances (id, client_id, name, chip_state) VALUES ($1,$2,'Chip A','warm')", [CHIP, T]);
  const hoje = (await db.query("SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS d")).rows[0].d;
  await db.query("INSERT INTO public.evolution_instance_daily_usage (instance_id, date, sent_count) VALUES ($1, $2::date, 6)", [CHIP, hoje]);
  return db;
}
const tipo = async (db) => (await db.query("SELECT data_type FROM information_schema.columns WHERE table_name='evolution_instance_daily_usage' AND column_name='instance_id'")).rows[0]?.data_type;

beforeEach(() => {
  vi.resetModules(); // memoizações por processo (ensure) começam limpas, como num boot
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("[TESTE OBRIGATÓRIO] leitor real com o pool de produção, tabela UUID com FK e SEM migration (o cenário do deploy)", () => {
  it("conversão RECUSADA (DDL bloqueado): o leitor carrega as instâncias e 'enviados hoje' sai certo — a coluna segue UUID", async () => {
    const { getLeadClientEvolutionInstances, getLeadClientEvolutionInstancesMap } = await import("../services/evolution.js");
    const db = await bancoNoEstadoDeProducao();
    globalThis.__ddlBloqueado = true;

    const instancias = await getLeadClientEvolutionInstances(T); // SEM pool: db === pgDatabasePool, caminho de produção
    const mapa = await getLeadClientEvolutionInstancesMap([T]);

    expect(Number(instancias[0].sent_count_today)).toBe(6);
    expect(Number(mapa[T][0].sent_count_today)).toBe(6);
    expect(await tipo(db)).toBe("uuid"); // não dependeu da conversão
  }, 60_000);

  it("conversão ACEITA: o leitor se cura sozinho (derruba a FK, converte) e lê o mesmo número", async () => {
    const { getLeadClientEvolutionInstances } = await import("../services/evolution.js");
    const db = await bancoNoEstadoDeProducao();
    globalThis.__ddlBloqueado = false;

    const instancias = await getLeadClientEvolutionInstances(T);

    expect(Number(instancias[0].sent_count_today)).toBe(6);
    expect(await tipo(db)).toBe("text");
    expect((await db.query("SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'public.evolution_instance_daily_usage'::regclass AND contype = 'f'")).rows[0].n).toBe(0);
  }, 60_000);

  it("a reserva de cota (escritor real, pool de produção) funciona nos dois cenários", async () => {
    for (const bloqueado of [true, false]) {
      vi.resetModules();
      const quota = await import("../services/chipQuota.js");
      const db = globalThis.__deployDb;
      await bancoNoEstadoDeProducao();
      globalThis.__ddlBloqueado = bloqueado;

      const dia = (await db.query("SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS d")).rows[0].d;
      expect(await quota.reserveChipDailyQuota(CHIP, dia, null, 2), `bloqueado=${bloqueado}`).toBe(8); // 6 já existentes + 2
      expect(await quota.getChipDailyUsage(CHIP, dia)).toBe(8);
    }
  }, 60_000);
});
