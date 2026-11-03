// Carga inicial dos clientes da Geração Digital (03/11/2026). Postgres real em memória (PGlite) com
// as duas migrations de produção; o script roda inteiro, transação e trava incluídas. Nenhum dado
// real: nomes, CNPJs e telefones abaixo são inventados.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { ListaRecusada, importarClientes } from "../scripts/gdImportarClientes.js";

const MIGRATIONS = [
  "supabase/migrations/20261102120000_create_gd_estados_clientes.sql",
  "supabase/migrations/20261103120000_gd_clientes_aprovador_drive_escopo.sql",
].map((f) => readFileSync(resolve(f), "utf8"));

const DIVERGENCIAS = `
  SELECT count(*)::int AS n FROM gd_clientes g
   WHERE g.estado_atual IS DISTINCT FROM (
     SELECT e.estado_para FROM gd_cliente_eventos e
      WHERE e.cliente_id = g.id ORDER BY e.ocorrido_em DESC, e.seq DESC LIMIT 1)`;

let db;
const silencioso = () => {};
// PGlite tem uma conexão só; o "client" da transação é ela mesma.
const pool = () => {
  const client = { query: (sql, params) => db.query(sql, params), release() {} };
  return { query: client.query, connect: async () => client };
};
const importar = (lista, opcoes = {}) => importarClientes(pool(), lista, { ator: "importacao:teste", log: silencioso, ...opcoes });
const contar = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].n);
const totais = async () => ({
  clientes: await contar(`SELECT count(*)::int n FROM gd_clientes`),
  eventos: await contar(`SELECT count(*)::int n FROM gd_cliente_eventos`),
});

let seq = 0;
// Cada teste usa nomes próprios: eventos são append-only, não dá para limpar entre testes.
const nome = (base) => `${base} ${++seq}`;

async function clienteExistente(campos, estado = "ATIVO") {
  const colunas = Object.keys(campos);
  const { rows } = await db.query(
    `INSERT INTO gd_clientes (dono_client_id, origem, ${colunas.join(", ")})
     VALUES ('geracao-digital', 'fluxo', ${colunas.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
    Object.values(campos)
  );
  if (estado) await db.query(`SELECT gd_registrar_evento($1, $2, now(), false, 'fluxo', 'humano', 'uid-x')`, [rows[0].id, estado]);
  return rows[0].id;
}

beforeAll(async () => {
  db = await createPgliteDb(`
    SET TimeZone = 'UTC';
    CREATE TABLE public.leads_clients (id text PRIMARY KEY, name text NOT NULL);
    INSERT INTO public.leads_clients VALUES ('geracao-digital', 'Geração Digital'), ('tinge-brasil', 'Tinge');
  `);
  for (const m of MIGRATIONS) await db.exec(m);
});

afterAll(async () => {
  await db.close();
});

describe("carga nova", () => {
  it("ensaio faz tudo e não deixa nada no banco", async () => {
    const antes = await totais();
    const r = await importar([{ nome: nome("Ensaio") }, { nome: nome("Ensaio") }]);
    expect(r).toMatchObject({ aplicado: false, criados: 2, eventos: 2 });
    expect(await totais()).toEqual(antes);
  });

  it("aplicar: cliente com origem importacao_inicial, campos normalizados e um evento ATIVO estimado com T único", async () => {
    const a = nome("Cafeeiro");
    const b = nome("Sítio");
    const r = await importar([
      {
        nome: a, cnpj: "10.203.040/0001-50", aprovador_nome: "Fulana", aprovador_telefone: "(34) 99999-0001",
        drive_url: "https://drive.google.com/drive/folders/pasta1", escopo: ["google", "social"],
        escopo_original: "Google + Social",
      },
      { nome: b, aprovador_telefone: "34 3222-0002", escopo: ["vexo"], escopo_original: "Vexo disparo (dezembro)" },
    ], { aplicar: true });
    expect(r).toMatchObject({ aplicado: true, criados: 2, eventos: 2, ja_existiam: 0 });

    const { rows: clientes } = await db.query(
      `SELECT nome, cnpj, origem, aprovador_telefone, drive_url, escopo, escopo_original, cnpj_a_confirmar, estado_atual, estado_data_estimada
         FROM gd_clientes WHERE nome = ANY($1) ORDER BY nome`,
      [[a, b]]
    );
    expect(clientes[0]).toEqual({
      nome: a, cnpj: "10203040000150", origem: "importacao_inicial", aprovador_telefone: "5534999990001",
      drive_url: "https://drive.google.com/drive/folders/pasta1", escopo: ["google", "social"],
      escopo_original: "Google + Social", cnpj_a_confirmar: false, estado_atual: "ATIVO", estado_data_estimada: true,
    });
    expect(clientes[1]).toMatchObject({ cnpj: null, aprovador_telefone: "553432220002", escopo_original: "Vexo disparo (dezembro)" });

    const { rows: eventos } = await db.query(
      `SELECT e.estado_para, e.ocorrido_em, e.data_estimada, e.origem, e.ator_tipo, e.ator_id
         FROM gd_cliente_eventos e JOIN gd_clientes c ON c.id = e.cliente_id WHERE c.nome = ANY($1)`,
      [[a, b]]
    );
    expect(eventos).toHaveLength(2);
    for (const e of eventos) {
      expect(e).toMatchObject({ estado_para: "ATIVO", data_estimada: true, origem: "importacao_inicial", ator_tipo: "importacao", ator_id: "importacao:teste" });
    }
    expect(new Date(eventos[0].ocorrido_em).toISOString()).toBe(new Date(eventos[1].ocorrido_em).toISOString());
    expect(new Date(eventos[0].ocorrido_em).toISOString()).toBe(r.ocorrido_em);
  });

  it("CNPJ a confirmar entra marcado", async () => {
    const n = nome("Vantage");
    await importar([{ nome: n, cnpj: "50607080000190", cnpj_a_confirmar: true }], { aplicar: true });
    const { rows } = await db.query(`SELECT cnpj_a_confirmar FROM gd_clientes WHERE nome = $1`, [n]);
    expect(rows[0].cnpj_a_confirmar).toBe(true);
  });
});

describe("idempotência", () => {
  it("rodar duas vezes com a mesma lista não cria cliente nem evento", async () => {
    const lista = [
      { nome: nome("Repete"), cnpj: "11222333000181", aprovador_telefone: "34999990003" },
      { nome: nome("Repete sem CNPJ"), escopo: ["meta"] },
    ];
    await importar(lista, { aplicar: true });
    const depoisDaPrimeira = await totais();
    const r = await importar(lista, { aplicar: true });
    expect(r).toMatchObject({ criados: 0, ja_existiam: 2, eventos: 0, campos_preenchidos: 0, avisos: [] });
    expect(await totais()).toEqual(depoisDaPrimeira);
  });

  it("nome com acento, caixa e espaços diferentes é o mesmo cliente", async () => {
    const base = nome("Café");
    await clienteExistente({ nome: `${base} Eiro` });
    const antes = await totais();
    const r = await importar([{ nome: `  ${base.toUpperCase().replace("É", "E")}   eiro ` }], { aplicar: true });
    expect(r).toMatchObject({ criados: 0, ja_existiam: 1, eventos: 0 });
    expect(await totais()).toEqual(antes);
  });

  it("existente: preenche só o vazio, nunca sobrescreve, e avisa o que manteve", async () => {
    const n = nome("Preenche");
    const id = await clienteExistente({ nome: n, drive_url: "https://drive.google.com/drive/folders/do-banco" });
    const r = await importar([{
      nome: n, drive_url: "https://drive.google.com/drive/folders/da-lista", aprovador_nome: "Beltrano", escopo: ["eventos"],
    }], { aplicar: true });
    expect(r.campos_preenchidos).toBe(2);
    expect(r.avisos).toEqual([`${n}: mantido o valor do banco em drive_url (a lista traz outro).`]);
    const { rows } = await db.query(`SELECT drive_url, aprovador_nome, escopo FROM gd_clientes WHERE id = $1`, [id]);
    expect(rows[0]).toEqual({ drive_url: "https://drive.google.com/drive/folders/do-banco", aprovador_nome: "Beltrano", escopo: ["eventos"] });
  });

  it("existente em outro estado: não ganha evento, só aviso", async () => {
    const n = nome("Pausado");
    const id = await clienteExistente({ nome: n }, "PAUSADO");
    const r = await importar([{ nome: n }], { aplicar: true });
    expect(r).toMatchObject({ eventos: 0, avisos: [`${n}: está em PAUSADO; não mexi no estado.`] });
    const { rows } = await db.query(`SELECT estado_atual FROM gd_clientes WHERE id = $1`, [id]);
    expect(rows[0].estado_atual).toBe("PAUSADO");
  });

  it("pendência de CNPJ desligada na tela não volta na segunda rodada", async () => {
    const n = nome("Confirmada");
    const lista = [{ nome: n, cnpj: "33444555000172", cnpj_a_confirmar: true }];
    await importar(lista, { aplicar: true });
    await db.query(`UPDATE gd_clientes SET cnpj_a_confirmar = false WHERE nome = $1`, [n]);
    // Segunda rodada com a lista corrigida trazendo um campo a mais: preenche o escopo e só ele.
    const r = await importar([{ ...lista[0], escopo: ["google"] }], { aplicar: true });
    expect(r.campos_preenchidos).toBe(1);
    const { rows } = await db.query(`SELECT cnpj_a_confirmar, escopo FROM gd_clientes WHERE nome = $1`, [n]);
    expect(rows[0]).toEqual({ cnpj_a_confirmar: false, escopo: ["google"] });
  });

  it("existente sem CNPJ recebe o CNPJ da lista junto com a pendência", async () => {
    const n = nome("Recebe CNPJ");
    const id = await clienteExistente({ nome: n });
    await importar([{ nome: n, cnpj: "66777888000190", cnpj_a_confirmar: true }], { aplicar: true });
    const { rows } = await db.query(`SELECT cnpj, cnpj_a_confirmar FROM gd_clientes WHERE id = $1`, [id]);
    expect(rows[0]).toEqual({ cnpj: "66777888000190", cnpj_a_confirmar: true });
  });
});

describe("conflitos abortam sem gravar, mesmo com --aplicar", () => {
  it("mesmo nome com outro CNPJ", async () => {
    const n = nome("Conflito");
    await clienteExistente({ nome: n, cnpj: "99888777000166" });
    const antes = await totais();
    const novo = nome("Inocente");
    await expect(importar([{ nome: novo }, { nome: n, cnpj: "99888777000247" }], { aplicar: true })).rejects.toThrow(ListaRecusada);
    expect(await totais()).toEqual(antes);
    expect(await contar(`SELECT count(*)::int n FROM gd_clientes WHERE nome = $1`, [novo])).toBe(0);
  });

  it("CNPJ de um cliente e nome de outro", async () => {
    const a = nome("Dono do CNPJ");
    const b = nome("Dono do nome");
    await clienteExistente({ nome: a, cnpj: "12121212000112" });
    await clienteExistente({ nome: b });
    const antes = await totais();
    await expect(importar([{ nome: b, cnpj: "12121212000112" }], { aplicar: true })).rejects.toThrow(/Conflito com o banco/);
    expect(await totais()).toEqual(antes);
  });
});

describe("lista inválida é recusada inteira", () => {
  it.each([
    ["drive com /u/0/", { drive_url: "https://drive.google.com/drive/u/0/folders/x" }, /drive_url/],
    ["telefone 5500", { aprovador_telefone: "5500999991234" }, /aprovador_telefone/],
    ["telefone curto", { aprovador_telefone: "99991234" }, /aprovador_telefone/],
    ["escopo fora da lista", { escopo: ["google", "tiktok"] }, /escopo/],
    ["CPF no campo cnpj", { cnpj: "12345678901" }, /cnpj/],
    ["pendência sem CNPJ", { cnpj_a_confirmar: true }, /cnpj_a_confirmar sem cnpj/],
    ["campo desconhecido", { telefone: "34999990000" }, /campo desconhecido telefone/],
  ])("%s", async (_caso, extra, problema) => {
    const antes = await totais();
    const err = await importar([{ nome: nome("Boa") }, { nome: nome("Ruim"), ...extra }], { aplicar: true }).catch((e) => e);
    expect(err).toBeInstanceOf(ListaRecusada);
    expect(err.problemas.join("\n")).toMatch(problema);
    expect(await totais()).toEqual(antes);
  });

  it("mensagem de telefone inválido não mostra o número", async () => {
    const err = await importar([{ nome: nome("Sigilo"), aprovador_telefone: "5500912345678" }]).catch((e) => e);
    expect(err.problemas.join("\n")).not.toContain("912345678");
  });

  it("nome repetido dentro da lista, inclusive só por acento", async () => {
    const err = await importar([{ nome: "Nous Gestão X" }, { nome: "nous gestao x" }]).catch((e) => e);
    expect(err.problemas.join("\n")).toMatch(/repete o nome da linha 1/);
  });

  it("--esperado diferente do tamanho da lista", async () => {
    await expect(importar([{ nome: nome("Só um") }], { esperado: 22 })).rejects.toThrow(/tem 1 clientes; o esperado era 22/);
  });

  it("sem ator", async () => {
    await expect(importarClientes(pool(), [{ nome: nome("Sem ator") }], { log: silencioso })).rejects.toThrow(/--ator/);
  });
});

describe("depois de tudo", () => {
  it("nenhum drive_url com /u/0/, todo telefone com 55, atalho igual à linha do tempo", async () => {
    expect(await contar(`SELECT count(*)::int n FROM gd_clientes WHERE drive_url LIKE '%/u/0/%'`)).toBe(0);
    expect(await contar(`SELECT count(*)::int n FROM gd_clientes WHERE aprovador_telefone IS NOT NULL AND aprovador_telefone NOT LIKE '55%'`)).toBe(0);
    expect(await contar(`SELECT count(*)::int n FROM gd_clientes WHERE aprovador_telefone IS NOT NULL`)).toBeGreaterThan(0);
    expect(await contar(DIVERGENCIAS)).toBe(0);
  });
});
