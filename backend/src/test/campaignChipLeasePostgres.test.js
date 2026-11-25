// PR 10d do untangle: trava por chip no banco (campaign/chipLeaseStore.js + migration 20261125150000).
// Postgres real (pglite) com a migration de verdade. Cada caso diz o que a trava em memória não cobria.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { acquireChipLease, releaseChipLease, _resetChipLeaseWarningsForTesting } from "../campaign/chipLeaseStore.js";

const MIGRATION = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations", "20261125150000_campaign_chip_leases.sql");
const T = "tenant-chip";
const L1 = "11111111-1111-4111-8111-111111111111";
const L2 = "22222222-2222-4222-8222-222222222222";
const L3 = "33333333-3333-4333-8333-333333333333";

let db;
let pool;
beforeEach(async () => {
  db = await createPgliteDb(`
    CREATE TABLE public.campaign_dispatches (id uuid PRIMARY KEY, client_id text NOT NULL, name text, status text NOT NULL DEFAULT 'scheduled');
  `);
  await db.exec(await readFile(MIGRATION, "utf8"));
  for (const id of [L1, L2, L3]) await db.query("INSERT INTO campaign_dispatches (id, client_id, name, status) VALUES ($1, $2, $3, 'running')", [id, T, `Lote ${id[0]}`]);
  pool = { query: (sql, params) => db.query(sql, params) };
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.close();
});

const ativas = async () => (await db.query("SELECT dispatch_id, chip_key FROM campaign_chip_leases WHERE released_at IS NULL ORDER BY chip_key")).rows;

describe("[OBRIGATÓRIO] trava por chip no banco", () => {
  it("a migration roda duas vezes sem erro (idempotente) e só cria", async () => {
    await db.exec(await readFile(MIGRATION, "utf8"));
    const sql = await readFile(MIGRATION, "utf8");
    expect(sql).not.toMatch(/\b(DELETE|DROP|TRUNCATE|UPDATE)\b/i);
  });

  it("mesmo chip: o segundo lote é recusado e diz quem bloqueia", async () => {
    expect(await acquireChipLease(pool, { dispatchId: L1, clientId: T, chips: ["chip-a"], nome: "Lote 1" })).toMatchObject({ ok: true, store: "banco" });
    const r = await acquireChipLease(pool, { dispatchId: L2, clientId: T, chips: ["chip-a"], nome: "Lote 2" });
    expect(r).toMatchObject({ ok: false, bloqueadoPor: { dispatchId: L1, nome: "Lote 1" } });
    expect(await ativas()).toEqual([{ dispatch_id: L1, chip_key: "chip-a" }]);
  });

  it("chips diferentes convivem; lote sem chip (empresa inteira) conflita com qualquer um", async () => {
    expect((await acquireChipLease(pool, { dispatchId: L1, clientId: T, chips: ["chip-a"] })).ok).toBe(true);
    expect((await acquireChipLease(pool, { dispatchId: L2, clientId: T, chips: ["chip-b"] })).ok).toBe(true);
    expect((await acquireChipLease(pool, { dispatchId: L3, clientId: T, chips: null })).ok).toBe(false);
  });

  it("lote da empresa inteira segurando: lote de chip específico é recusado", async () => {
    expect((await acquireChipLease(pool, { dispatchId: L1, clientId: T, chips: [] })).ok).toBe(true);
    expect((await acquireChipLease(pool, { dispatchId: L2, clientId: T, chips: ["chip-a"] })).ok).toBe(false);
  });

  it("rodízio: conflita se QUALQUER chip do lote estiver em uso, e não fica com reserva parcial", async () => {
    expect((await acquireChipLease(pool, { dispatchId: L1, clientId: T, chips: ["chip-b"] })).ok).toBe(true);
    expect((await acquireChipLease(pool, { dispatchId: L2, clientId: T, chips: ["chip-a", "chip-b"] })).ok).toBe(false);
    expect(await ativas()).toEqual([{ dispatch_id: L1, chip_key: "chip-b" }]);
  });

  it("empresas diferentes nunca dividem chip", async () => {
    expect((await acquireChipLease(pool, { dispatchId: L1, clientId: T, chips: ["chip-a"] })).ok).toBe(true);
    expect((await acquireChipLease(pool, { dispatchId: L2, clientId: "outra", chips: ["chip-a"] })).ok).toBe(true);
  });

  it("soltar libera para o próximo", async () => {
    await acquireChipLease(pool, { dispatchId: L1, clientId: T, chips: ["chip-a"] });
    await releaseChipLease(pool, L1);
    expect((await acquireChipLease(pool, { dispatchId: L2, clientId: T, chips: ["chip-a"] })).ok).toBe(true);
  });

  it("sobrevive a boot: a reserva está no banco, não na memória (outro 'processo' vê)", async () => {
    await acquireChipLease(pool, { dispatchId: L1, clientId: T, chips: ["chip-a"] });
    const outroProcesso = { query: (sql, params) => db.query(sql, params) };
    expect((await acquireChipLease(outroProcesso, { dispatchId: L2, clientId: T, chips: ["chip-a"] })).ok).toBe(false);
  });

  it("o mesmo lote retomado depois de um boot assume a própria reserva antiga", async () => {
    await acquireChipLease(pool, { dispatchId: L1, clientId: T, chips: ["chip-a"] });
    expect((await acquireChipLease(pool, { dispatchId: L1, clientId: T, chips: ["chip-a"] })).ok).toBe(true);
    expect(await ativas()).toEqual([{ dispatch_id: L1, chip_key: "chip-a" }]);
  });

  it("reserva de processo morto: vence pelo prazo, ou solta quando o lote dono terminou", async () => {
    await acquireChipLease(pool, { dispatchId: L1, clientId: T, chips: ["chip-a"] });
    await db.query("UPDATE campaign_chip_leases SET expires_at = now() - interval '1 minute' WHERE dispatch_id = $1", [L1]);
    expect((await acquireChipLease(pool, { dispatchId: L2, clientId: T, chips: ["chip-a"] })).ok).toBe(true);

    await db.query("UPDATE campaign_dispatches SET status = 'done' WHERE id = $1", [L2]);
    expect((await acquireChipLease(pool, { dispatchId: L3, clientId: T, chips: ["chip-a"] })).ok).toBe(true);
  });

  it("lote pausado NÃO perde a reserva para outro (só status final solta)", async () => {
    await acquireChipLease(pool, { dispatchId: L1, clientId: T, chips: ["chip-a"] });
    await db.query("UPDATE campaign_dispatches SET status = 'paused' WHERE id = $1", [L1]);
    expect((await acquireChipLease(pool, { dispatchId: L2, clientId: T, chips: ["chip-a"] })).ok).toBe(false);
  });

  it("corrida: dois pedidos concorrentes pelo mesmo chip, no máximo um fica", async () => {
    const [a, b] = await Promise.all([
      acquireChipLease(pool, { dispatchId: L1, clientId: T, chips: ["chip-a"] }),
      acquireChipLease(pool, { dispatchId: L2, clientId: T, chips: null }),
    ]);
    expect([a.ok, b.ok].filter(Boolean).length).toBeLessThanOrEqual(1);
    const donos = new Set((await ativas()).map((r) => r.dispatch_id));
    expect(donos.size).toBeLessThanOrEqual(1);
  });

  it("antes da migration (tabela ausente): vale só a memória, sem quebrar", async () => {
    _resetChipLeaseWarningsForTesting();
    const semTabela = await createPgliteDb("CREATE TABLE public.campaign_dispatches (id uuid PRIMARY KEY, status text);");
    try {
      const p = { query: (sql, params) => semTabela.query(sql, params) };
      expect(await acquireChipLease(p, { dispatchId: L1, clientId: T, chips: ["chip-a"] })).toEqual({ ok: true, store: "ausente" });
      await expect(releaseChipLease(p, L1)).resolves.toBeUndefined();
    } finally {
      await semTabela.close();
    }
  });

  it("erro de banco que não é tabela ausente: na dúvida, não envia (chip ocupado)", async () => {
    const quebrado = { query: async () => { throw Object.assign(new Error("connection terminated unexpectedly"), { code: "57P01" }); } };
    expect(await acquireChipLease(quebrado, { dispatchId: L1, clientId: T, chips: ["chip-a"] })).toMatchObject({ ok: false, erro: true });
  });
});
