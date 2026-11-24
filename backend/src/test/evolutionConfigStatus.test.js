// /health -> evolutionConfig: só sim/não e contagens, nunca valor de variável nem URL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  INSTANCIAS_PADRAO_DO_CODIGO,
  SQL_INSTANCIAS_PADRAO,
  computeEvolutionConfigStatus,
  evolutionEnvStatus,
} from "../services/evolutionConfigStatus.js";

describe("evolutionEnvStatus", () => {
  it("diz só se a variável está definida, sem o valor", () => {
    const out = evolutionEnvStatus({ EVOLUTION_API_URL: "https://segredo.exemplo", EVOLUTION_API_KEY: "  ", GD_EVOLUTION_TOKEN: "abc" });
    expect(out.EVOLUTION_API_URL).toBe(true);
    expect(out.EVOLUTION_API_KEY).toBe(false);
    expect(out.GD_EVOLUTION_TOKEN).toBe(true);
    expect(out.GD_EVOLUTION_URL).toBe(false);
    expect(JSON.stringify(out)).not.toContain("segredo");
    expect(JSON.stringify(out)).not.toContain("abc");
  });
});

describe("computeEvolutionConfigStatus (Postgres de verdade)", () => {
  let db;
  beforeAll(async () => {
    db = new PGlite();
    await db.query(`
      CREATE TABLE public.lead_client_evolution_instances (
        id serial PRIMARY KEY,
        client_id text NOT NULL,
        name text NOT NULL,
        dispatch_webhook_url text NOT NULL,
        dispatch_webhook_token text,
        active boolean NOT NULL DEFAULT true,
        connection_state text NOT NULL DEFAULT 'unknown'
      )
    `);
    await db.query(`
      INSERT INTO public.lead_client_evolution_instances (client_id, name, dispatch_webhook_url, dispatch_webhook_token, active, connection_state) VALUES
        ('vexo-adm', 'Vexo atende', 'https://evo.exemplo/message/sendText/vexo-adm-vexo-atende', 'tok-secreto', true, 'open'),
        ('geracao-digital', 'geracao-digital-comercial-hostery', 'https://evo.exemplo/message/sendText/outra/', NULL, true, 'close'),
        ('geracao-digital', 'velho', 'https://evo.exemplo/message/sendText/gd-oficial', NULL, false, 'close')
    `);
  });
  afterAll(async () => {
    await db?.close();
  });

  it("conta por nome ou pelo fim da URL, sem vazar URL nem token", async () => {
    const out = await computeEvolutionConfigStatus(db, {});
    expect(out.instanciasPadrao.medido).toBe(true);
    expect(out.instanciasPadrao["vexo-adm-vexo-atende"]).toEqual({ cadastradas: 1, ativas: 1, conectadas: 1 });
    expect(out.instanciasPadrao["geracao-digital-comercial-hostery"]).toEqual({ cadastradas: 1, ativas: 1, conectadas: 0 });
    expect(out.instanciasPadrao["gd-oficial"]).toEqual({ cadastradas: 1, ativas: 0, conectadas: 0 });
    expect(out.instanciasPadrao.Teste).toEqual({ cadastradas: 0, ativas: 0, conectadas: 0 });
    expect(Object.keys(out.instanciasPadrao).filter((k) => k !== "medido").sort()).toEqual([...INSTANCIAS_PADRAO_DO_CODIGO].sort());
    const texto = JSON.stringify(out);
    expect(texto).not.toContain("evo.exemplo");
    expect(texto).not.toContain("tok-secreto");
  });

  it("consulta que falha vira medido false, sem derrubar", async () => {
    const out = await computeEvolutionConfigStatus({ query: async () => { throw new Error("sem banco"); } }, {});
    expect(out.instanciasPadrao).toEqual({ medido: false });
  });

  it("sem pool não consulta", async () => {
    const out = await computeEvolutionConfigStatus(null, {});
    expect(out.instanciasPadrao).toEqual({ medido: false });
    expect(SQL_INSTANCIAS_PADRAO).toContain("lead_client_evolution_instances");
  });
});
