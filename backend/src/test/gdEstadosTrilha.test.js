// Migration da trilha do cliente GD (03/11/2026): acao_do_cliente e rótulos do portal. Postgres
// real em memória (PGlite) com as migrations de produção, na ordem.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createPgliteDb } from "./helpers/pgliteDb.js";

const ler = (nome) => readFileSync(resolve(`supabase/migrations/${nome}`), "utf8");
const MIGRATION_ESTADOS = ler("20261102120000_create_gd_estados_clientes.sql");
const MIGRATION_CAMPOS = ler("20261103120000_gd_clientes_aprovador_drive_escopo.sql");
const MIGRATION_TRILHA = ler("20261103180000_gd_estados_acao_rotulo_portal.sql");

const ROTULOS = {
  PROPOSTA_ENVIADA: "Proposta enviada",
  PROPOSTA_ACEITA: "Proposta aceita",
  CONTRATO_EM_REVISAO: "Contrato em preparação",
  AGUARDANDO_ASSINATURA_CAIO: "Aguardando nossa assinatura",
  AGUARDANDO_ASSINATURA_CLIENTE: "Aguardando sua assinatura",
  ASSINADO: "Contrato assinado",
  GRUPOS_CRIADOS: "Equipe montada",
  BRIEFING_AGENDADO: "Briefing agendado",
  BRIEFING_REALIZADO: "Briefing em elaboração",
  BRIEFING_APROVACAO_INTERNA: "Briefing em revisão",
  BRIEFING_APROVACAO_CLIENTE: "Briefing para sua aprovação",
  IDENTIDADE_VISUAL: "Identidade visual",
  ROTEIRO: "Roteiro em produção",
  PLANEJAMENTO_APROVACAO: "Planejamento para sua aprovação",
  ESTRATEGIA_APROVADA: "Estratégia aprovada",
  ATIVO: "Tudo rodando",
  PAUSADO: "Atendimento pausado",
  ENCERRADO: "Atendimento encerrado",
};

let db;

beforeEach(async () => {
  db = await createPgliteDb(`
    CREATE TABLE public.leads_clients (id text PRIMARY KEY, name text NOT NULL);
    INSERT INTO public.leads_clients VALUES ('geracao-digital', 'Geração Digital');
  `);
  await db.exec(MIGRATION_ESTADOS);
  await db.exec(MIGRATION_CAMPOS);
});

afterEach(async () => {
  await db?.close();
});

const estados = async () =>
  (await db.query(`SELECT codigo, rotulo_portal, acao_do_cliente, updated_at FROM gd_estados ORDER BY ordem`)).rows;

describe("migration da trilha", () => {
  it("marca acao_do_cliente em exatamente três etapas", async () => {
    await db.exec(MIGRATION_TRILHA);
    const marcadas = (await estados()).filter((e) => e.acao_do_cliente).map((e) => e.codigo);
    expect(marcadas).toEqual(["AGUARDANDO_ASSINATURA_CLIENTE", "BRIEFING_APROVACAO_CLIENTE", "PLANEJAMENTO_APROVACAO"]);
  });

  it("grava os 18 rótulos do portal, casando por código, sem rótulo repetido", async () => {
    await db.exec(MIGRATION_TRILHA);
    const linhas = await estados();
    expect(Object.fromEntries(linhas.map((e) => [e.codigo, e.rotulo_portal]))).toEqual(ROTULOS);
    expect(new Set(linhas.map((e) => e.rotulo_portal)).size).toBe(linhas.length);
  });

  it("nenhum rótulo do portal cita quem revisa dentro da agência", async () => {
    await db.exec(MIGRATION_TRILHA);
    for (const e of await estados()) expect(e.rotulo_portal).not.toMatch(/caio|conrado|jur[ií]dico/i);
  });

  it("desfaz acao_do_cliente marcado à mão fora das três", async () => {
    await db.exec(MIGRATION_TRILHA);
    await db.exec(`UPDATE gd_estados SET acao_do_cliente = true WHERE codigo = 'ROTEIRO'`);
    await db.exec(MIGRATION_TRILHA);
    const roteiro = (await estados()).find((e) => e.codigo === "ROTEIRO");
    expect(roteiro.acao_do_cliente).toBe(false);
  });

  it("rodar de novo não mexe em linha nenhuma", async () => {
    await db.exec(MIGRATION_TRILHA);
    const antes = await estados();
    await db.exec(MIGRATION_TRILHA);
    expect(await estados()).toEqual(antes);
  });

  it("código faltando para tudo com o nome dele, sem alterar nada", async () => {
    await db.exec(`DELETE FROM gd_estados WHERE codigo = 'ROTEIRO'`);
    const sql = `SELECT codigo, rotulo_portal, updated_at FROM gd_estados ORDER BY ordem`;
    const antes = (await db.query(sql)).rows;
    // migrate.js roda cada arquivo dentro de BEGIN/COMMIT; o teste faz o mesmo.
    await db.exec("BEGIN");
    await expect(db.exec(MIGRATION_TRILHA)).rejects.toThrow(/sem os códigos: ROTEIRO/);
    await db.exec("ROLLBACK");
    const colunas = await db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'gd_estados' AND column_name = 'acao_do_cliente'`
    );
    expect(colunas.rows).toHaveLength(0);
    expect((await db.query(sql)).rows).toEqual(antes);
  });
});
