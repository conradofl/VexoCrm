// Rotas internas dos clientes da Geração Digital (03/11/2026). Postgres real em memória (PGlite)
// com a migration de produção, rotas HTTP reais. Só a autenticação do Firebase é trocada: o
// perfil vem do cabeçalho x-teste-perfil. O guarda requireGdClientesAccess é o do produto.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { GD_DONO, registerGdClientesRoutes } from "../domains/gdClientes/routes.js";

const MIGRATION = readFileSync(
  resolve("supabase/migrations/20261102120000_create_gd_estados_clientes.sql"),
  "utf8"
);
const MIGRATION_CAMPOS = readFileSync(
  resolve("supabase/migrations/20261103120000_gd_clientes_aprovador_drive_escopo.sql"),
  "utf8"
);
const MIGRATION_TRILHA = readFileSync(
  resolve("supabase/migrations/20261103180000_gd_estados_acao_rotulo_portal.sql"),
  "utf8"
);

const PERFIS = {
  superadmin: { uid: "uid-fundador", role: "superadmin", isAdmin: true, clientIds: [] },
  admin: { uid: "uid-admin", role: "internal", isAdmin: true, clientIds: [] },
  equipeGd: { uid: "uid-gd", role: "internal", isAdmin: false, clientId: GD_DONO, clientIds: [GD_DONO], permissions: ["geracao_digital.proposals"], internalPages: ["propostas-gd"] },
  internoOutroTenant: { uid: "uid-outro", role: "internal", isAdmin: false, clientId: "tinge-brasil", clientIds: ["tinge-brasil"], permissions: ["geracao_digital.proposals"], internalPages: ["propostas-gd"] },
  gdSemPermissao: { uid: "uid-gd-sem", role: "internal", isAdmin: false, clientId: GD_DONO, clientIds: [GD_DONO], permissions: [], internalPages: ["planilhas"] },
  cliente: { uid: "uid-cliente", role: "client", isAdmin: false, clientId: GD_DONO, clientIds: [GD_DONO], permissions: ["geracao_digital.proposals"] },
  pendente: { uid: "uid-pendente", role: "pending" },
  semUid: { role: "superadmin", isAdmin: true },
};

let db;
let server;
let base;
// Gancho para simular corrida: roda logo depois da barreira 1 (SELECT em gd_estados).
let aposBarreira1 = null;

function poolDe(pg) {
  // PGlite tem uma conexão só; o "client" da transação é ela mesma.
  const query = async (sql, params) => {
    const r = await pg.query(sql, params);
    if (aposBarreira1 && /SELECT 1 FROM public\.gd_estados WHERE codigo = \$1 AND ativo/.test(sql)) {
      const f = aposBarreira1;
      aposBarreira1 = null;
      await f(pg);
    }
    return r;
  };
  const client = { query, release() {} };
  return { query, connect: async () => client };
}

async function chamar(metodo, caminho, { perfil = "equipeGd", body } = {}) {
  const res = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { "Content-Type": "application/json", "x-teste-perfil": perfil },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

const contar = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].n);

async function novoCliente(nome, estado = "PROPOSTA_ENVIADA", extra = {}) {
  const r = await chamar("POST", "/api/gd/clientes", { body: { nome, estado, ...extra } });
  expect(r.status).toBe(201);
  return r.json.cliente;
}

beforeAll(async () => {
  db = await createPgliteDb(`
    SET TimeZone = 'UTC';
    CREATE TABLE public.leads_clients (id text PRIMARY KEY, name text NOT NULL);
    INSERT INTO public.leads_clients VALUES ('geracao-digital', 'Geração Digital'), ('tinge-brasil', 'Tinge');
  `);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION_CAMPOS);
  await db.exec(MIGRATION_TRILHA);

  const app = express();
  app.use(express.json());
  registerGdClientesRoutes(app, {
    getPool: () => poolDe(db),
    requireFirebaseAuth: (req, _res, next) => {
      req.authAccess = PERFIS[req.headers["x-teste-perfil"]];
      next();
    },
  });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("guarda: três perfis, igual para leitura e escrita", () => {
  it.each(["superadmin", "admin", "equipeGd"])("%s lê e escreve", async (perfil) => {
    expect((await chamar("GET", "/api/gd/clientes", { perfil })).status).toBe(200);
    const r = await chamar("POST", "/api/gd/clientes", { perfil, body: { nome: `Guarda ${perfil}`, estado: "ATIVO" } });
    expect(r.status).toBe(201);
  });

  it.each(["internoOutroTenant", "gdSemPermissao", "cliente", "pendente"])("%s recebe 403 na leitura e na escrita", async (perfil) => {
    const antes = await contar(`SELECT count(*)::int n FROM gd_clientes`);
    expect((await chamar("GET", "/api/gd/clientes", { perfil })).status).toBe(403);
    expect((await chamar("GET", "/api/gd/estados", { perfil })).status).toBe(403);
    expect((await chamar("POST", "/api/gd/clientes", { perfil, body: { nome: `Barrado ${perfil}`, estado: "ATIVO" } })).status).toBe(403);
    expect(await contar(`SELECT count(*)::int n FROM gd_clientes`)).toBe(antes);
  });
});

describe("dono fixo", () => {
  it("client_id no corpo não muda o dono", async () => {
    const r = await chamar("POST", "/api/gd/clientes", {
      body: { nome: "Dono forçado", estado: "ATIVO", client_id: "tinge-brasil", dono_client_id: "tinge-brasil" },
    });
    expect(r.status).toBe(201);
    const { rows } = await db.query(`SELECT dono_client_id FROM gd_clientes WHERE id = $1`, [r.json.cliente.id]);
    expect(rows[0].dono_client_id).toBe(GD_DONO);
  });

  it("cliente de outro dono responde 404 igual a id inexistente, em leitura, edição e evento", async () => {
    const { rows } = await db.query(
      `INSERT INTO gd_clientes (dono_client_id, nome, origem) VALUES ('tinge-brasil', 'De outro dono', 'fluxo') RETURNING id`
    );
    const alheio = rows[0].id;
    const inexistente = "00000000-0000-4000-8000-000000000000";
    for (const id of [alheio, inexistente, "nao-e-uuid"]) {
      const leitura = await chamar("GET", `/api/gd/clientes/${id}`);
      const edicao = await chamar("PATCH", `/api/gd/clientes/${id}`, { body: { nome: "Invadido" } });
      const evento = await chamar("POST", `/api/gd/clientes/${id}/eventos`, { body: { estado: "ATIVO" } });
      for (const r of [leitura, edicao, evento]) {
        expect(r.status).toBe(404);
        expect(r.json.error.code).toBe("CLIENTE_NAO_ENCONTRADO");
      }
    }
    const lista = await chamar("GET", "/api/gd/clientes");
    expect(lista.json.clientes.map((c) => c.id)).not.toContain(alheio);
    expect(await contar(`SELECT count(*)::int n FROM gd_cliente_eventos WHERE cliente_id = $1`, [alheio])).toBe(0);
  });
});

describe("criar cliente", () => {
  it("cria com o primeiro evento na mesma transação, ator = uid de quem chamou", async () => {
    const c = await novoCliente("Nasce no funil", "PROPOSTA_ENVIADA", { cnpj: "12.345.678/0001-90", ator_id: "forjado", ator_tipo: "goclaw" });
    expect(c).toMatchObject({ estado_atual: "PROPOSTA_ENVIADA", origem: "fluxo", cnpj: "12345678000190", aproximado: false });
    const { rows } = await db.query(`SELECT ator_tipo, ator_id, origem FROM gd_cliente_eventos WHERE cliente_id = $1`, [c.id]);
    expect(rows).toEqual([{ ator_tipo: "humano", ator_id: "uid-gd", origem: "fluxo" }]);
  });

  it("estado inexistente: 422 com a lista de válidos, e nem cliente nem evento ficam", async () => {
    const antes = await contar(`SELECT count(*)::int n FROM gd_clientes`);
    const r = await chamar("POST", "/api/gd/clientes", { body: { nome: "Estado inventado", estado: "INVENTADO" } });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("ESTADO_INVALIDO");
    expect(r.json.error.details.validos).toContain("ATIVO");
    expect(await contar(`SELECT count(*)::int n FROM gd_clientes`)).toBe(antes);
  });

  it("nome repetido para o mesmo dono: 409", async () => {
    await novoCliente("Repetido");
    const r = await chamar("POST", "/api/gd/clientes", { body: { nome: "Repetido", estado: "ATIVO" } });
    expect(r.status).toBe(409);
  });

  it("sem uid: 401 e nada gravado", async () => {
    const r = await chamar("POST", "/api/gd/clientes", { perfil: "semUid", body: { nome: "Anônimo", estado: "ATIVO" } });
    expect(r.status).toBe(401);
    expect(await contar(`SELECT count(*)::int n FROM gd_clientes WHERE nome = 'Anônimo'`)).toBe(0);
  });
});

describe("mover de estado", () => {
  it("fluxo normal grava evento humano e devolve o atalho novo", async () => {
    const c = await novoCliente("Move normal");
    const r = await chamar("POST", `/api/gd/clientes/${c.id}/eventos`, {
      body: { estado: "PROPOSTA_ACEITA", estado_esperado: "PROPOSTA_ENVIADA", ator_id: "forjado" },
    });
    expect(r.status).toBe(201);
    expect(r.json.cliente.estado_atual).toBe("PROPOSTA_ACEITA");
    const { rows } = await db.query(`SELECT ator_id FROM gd_cliente_eventos WHERE id = $1`, [r.json.evento.id]);
    expect(rows[0].ator_id).toBe("uid-gd");
  });

  it("estado inexistente e estado inativo: 422 e nenhum evento", async () => {
    const c = await novoCliente("Estado ruim");
    await db.query(`INSERT INTO gd_estados (codigo, ordem, fase, rotulo_interno, rotulo_portal, ativo) VALUES ('DESATIVADO', 999, 'entrada', 'x', 'x', false)`);
    for (const estado of ["INVENTADO", "DESATIVADO"]) {
      const r = await chamar("POST", `/api/gd/clientes/${c.id}/eventos`, { body: { estado } });
      expect(r.status).toBe(422);
      expect(r.json.error.code).toBe("ESTADO_INVALIDO");
    }
    expect(await contar(`SELECT count(*)::int n FROM gd_cliente_eventos WHERE cliente_id = $1`, [c.id])).toBe(1);
  });

  it("barreira 2: estado apagado entre a checagem e o INSERT vira 422 com a lista, não 500", async () => {
    const c = await novoCliente("Corrida de estado");
    await db.query(`INSERT INTO gd_estados (codigo, ordem, fase, rotulo_interno, rotulo_portal) VALUES ('EFEMERO', 998, 'entrada', 'x', 'x')`);
    aposBarreira1 = (pg) => pg.query(`DELETE FROM gd_estados WHERE codigo = 'EFEMERO'`);
    const r = await chamar("POST", `/api/gd/clientes/${c.id}/eventos`, { body: { estado: "EFEMERO" } });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("ESTADO_INVALIDO");
    expect(r.json.error.details.validos).toContain("ATIVO");
    expect(await contar(`SELECT count(*)::int n FROM gd_cliente_eventos WHERE cliente_id = $1`, [c.id])).toBe(1);
    // O ROLLBACK da rota desfaz também o DELETE simulado (mesma conexão no PGlite).
    await db.query(`DELETE FROM gd_estados WHERE codigo = 'EFEMERO'`);
  });

  it("estado_esperado diferente do atual: 409 ESTADO_MUDOU sem gravar", async () => {
    const c = await novoCliente("Concorrência");
    await chamar("POST", `/api/gd/clientes/${c.id}/eventos`, { body: { estado: "PROPOSTA_ACEITA" } });
    const r = await chamar("POST", `/api/gd/clientes/${c.id}/eventos`, {
      body: { estado: "CONTRATO_EM_REVISAO", estado_esperado: "PROPOSTA_ENVIADA" },
    });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("ESTADO_MUDOU");
    expect(r.json.error.details.estado_atual).toBe("PROPOSTA_ACEITA");
    expect(await contar(`SELECT count(*)::int n FROM gd_cliente_eventos WHERE cliente_id = $1`, [c.id])).toBe(2);
  });

  it("mesmo estado no fluxo: 409 ESTADO_IGUAL", async () => {
    const c = await novoCliente("Mesmo estado");
    const r = await chamar("POST", `/api/gd/clientes/${c.id}/eventos`, { body: { estado: "PROPOSTA_ENVIADA" } });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("ESTADO_IGUAL");
  });

  it("correção sem motivo: 422; data futura: 422", async () => {
    const c = await novoCliente("Correções");
    const semMotivo = await chamar("POST", `/api/gd/clientes/${c.id}/eventos`, { body: { estado: "ATIVO", ocorrido_em: "2026-09-01T12:00:00Z" } });
    expect(semMotivo.json.error.code).toBe("MOTIVO_OBRIGATORIO");
    const futuro = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const r = await chamar("POST", `/api/gd/clientes/${c.id}/eventos`, { body: { estado: "ATIVO", ocorrido_em: futuro, motivo: "x" } });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("OCORRIDO_EM_FUTURO");
  });

  it("correção retroativa entra na linha do tempo sem virar estado atual; LAG dá o anterior", async () => {
    const c = await novoCliente("Retroativo");
    await chamar("POST", `/api/gd/clientes/${c.id}/eventos`, { body: { estado: "PROPOSTA_ACEITA" } });
    const r = await chamar("POST", `/api/gd/clientes/${c.id}/eventos`, {
      body: { estado: "PAUSADO", ocorrido_em: "2026-01-10T12:00:00Z", motivo: "ficou parado em janeiro", data_estimada: true },
    });
    expect(r.status).toBe(201);
    expect(r.json.cliente.estado_atual).toBe("PROPOSTA_ACEITA");

    const det = await chamar("GET", `/api/gd/clientes/${c.id}`);
    expect(det.json.eventos.map((e) => [e.estado, e.estado_anterior, e.origem])).toEqual([
      ["PAUSADO", null, "correcao"],
      ["PROPOSTA_ENVIADA", "PAUSADO", "fluxo"],
      ["PROPOSTA_ACEITA", "PROPOSTA_ENVIADA", "fluxo"],
    ]);
    expect(det.json.eventos[0].data_estimada).toBe(true);
  });
});

describe("editar nome e cnpj", () => {
  it("PATCH altera nome e cnpj; estado e linha do tempo ficam iguais", async () => {
    const c = await novoCliente("Antes do patch");
    const r = await chamar("PATCH", `/api/gd/clientes/${c.id}`, { body: { nome: "Depois do patch", cnpj: "98765432000110" } });
    expect(r.status).toBe(200);
    expect(r.json.cliente).toMatchObject({ nome: "Depois do patch", cnpj: "98765432000110", estado_atual: "PROPOSTA_ENVIADA" });
  });

  it("PATCH com estado_atual: 422 na rota, e nada muda", async () => {
    const c = await novoCliente("Patch de estado");
    const r = await chamar("PATCH", `/api/gd/clientes/${c.id}`, { body: { nome: "x", estado_atual: "ENCERRADO" } });
    expect(r.status).toBe(422);
    expect(r.json.error).toMatchObject({ code: "CAMPO_NAO_EDITAVEL", details: { campos: ["estado_atual"] } });
    const { rows } = await db.query(`SELECT nome, estado_atual FROM gd_clientes WHERE id = $1`, [c.id]);
    expect(rows[0]).toEqual({ nome: "Patch de estado", estado_atual: "PROPOSTA_ENVIADA" });
  });

  it("o banco recusa estado_atual mesmo que a lista branca da rota afrouxe", async () => {
    // Mesmo UPDATE que o PATCH monta, com a coluna que a rota nunca deixaria passar.
    const c = await novoCliente("Banco como segunda trava");
    await expect(
      db.query(`UPDATE public.gd_clientes SET nome = $1, estado_atual = $2 WHERE id = $3 AND dono_client_id = $4`, ["y", "ENCERRADO", c.id, GD_DONO])
    ).rejects.toThrow(/só muda por gd_registrar_evento/);
  });
});

describe("dados de cadastro (aprovador, drive, escopo)", () => {
  const DRIVE = "https://drive.google.com/drive/folders/abc123";

  it("PATCH grava os seis campos normalizados e o GET devolve todos", async () => {
    const c = await novoCliente("Cadastro completo");
    const r = await chamar("PATCH", `/api/gd/clientes/${c.id}`, {
      body: {
        cnpj: "43.210.987/0001-55", cnpj_a_confirmar: true, aprovador_nome: " Maria ",
        aprovador_telefone: "(34) 99999-1234", drive_url: DRIVE,
        escopo: ["google", "vexo", "google"], escopo_original: "Google + Vexo disparo (dezembro)",
      },
    });
    expect(r.status).toBe(200);
    const { json } = await chamar("GET", `/api/gd/clientes/${c.id}`);
    expect(json.cliente).toMatchObject({
      cnpj: "43210987000155", cnpj_a_confirmar: true, aprovador_nome: "Maria",
      aprovador_telefone: "5534999991234", drive_url: DRIVE,
      escopo: ["google", "vexo"], escopo_original: "Google + Vexo disparo (dezembro)",
      estado_atual: "PROPOSTA_ENVIADA",
    });
  });

  it("POST aceita os mesmos campos e telefone com 55 fica como veio", async () => {
    const c = await novoCliente("Cadastro no POST", "ATIVO", { aprovador_telefone: "+55 34 3222-1100", escopo: ["social"] });
    expect(c).toMatchObject({ aprovador_telefone: "553432221100", escopo: ["social"], cnpj_a_confirmar: false });
  });

  it.each([
    ["aprovador_telefone", "5500999991234", "TELEFONE_INVALIDO"],
    ["aprovador_telefone", "(00) 99999-1234", "TELEFONE_INVALIDO"],
    ["aprovador_telefone", "9999-1234", "TELEFONE_INVALIDO"],
    ["drive_url", "https://drive.google.com/drive/u/0/folders/abc", "DRIVE_URL_INVALIDA"],
    ["drive_url", "http://drive.google.com/drive/folders/abc", "DRIVE_URL_INVALIDA"],
    ["escopo", ["google", "instagram"], "ESCOPO_INVALIDO"],
    ["escopo", "google", "ESCOPO_INVALIDO"],
    ["cnpj_a_confirmar", "sim", "CNPJ_A_CONFIRMAR_INVALIDO"],
  ])("PATCH %s = %j: 422 %s e nada muda", async (campo, valor, code) => {
    const c = await novoCliente(`Recusa ${campo} ${JSON.stringify(valor)}`);
    const r = await chamar("PATCH", `/api/gd/clientes/${c.id}`, { body: { [campo]: valor } });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe(code);
    const { rows } = await db.query(`SELECT aprovador_telefone, drive_url, escopo, cnpj_a_confirmar FROM gd_clientes WHERE id = $1`, [c.id]);
    expect(rows[0]).toEqual({ aprovador_telefone: null, drive_url: null, escopo: null, cnpj_a_confirmar: false });
  });

  it("cnpj_a_confirmar sem cnpj: o banco recusa e a rota responde 422, não 500", async () => {
    const c = await novoCliente("Pendência sem CNPJ");
    const r = await chamar("PATCH", `/api/gd/clientes/${c.id}`, { body: { cnpj_a_confirmar: true } });
    expect(r.status).toBe(422);
    expect(r.json.error).toMatchObject({ code: "CAMPO_INVALIDO", details: { regra: "gd_clientes_cnpj_a_confirmar" } });
  });

  it("a pendência do CNPJ se desliga pelo PATCH", async () => {
    const c = await novoCliente("Pendência desligável", "ATIVO", { cnpj: "50607080000190", cnpj_a_confirmar: true });
    const r = await chamar("PATCH", `/api/gd/clientes/${c.id}`, { body: { cnpj_a_confirmar: false } });
    expect(r.json.cliente.cnpj_a_confirmar).toBe(false);
  });

  it("o banco recusa /u/0/, telefone sem 55 e escopo fora da lista mesmo sem passar pela rota", async () => {
    const c = await novoCliente("Travas do banco");
    for (const [sql, regra] of [
      [`UPDATE gd_clientes SET drive_url = 'https://drive.google.com/drive/u/0/folders/x' WHERE id = $1`, "gd_clientes_drive_url"],
      [`UPDATE gd_clientes SET aprovador_telefone = '34999991234' WHERE id = $1`, "gd_clientes_telefone_55"],
      [`UPDATE gd_clientes SET aprovador_telefone = '5500999991234' WHERE id = $1`, "gd_clientes_telefone_55"],
      [`UPDATE gd_clientes SET escopo = '["tiktok"]' WHERE id = $1`, "gd_clientes_escopo"],
      [`UPDATE gd_clientes SET escopo = '{"google":true}' WHERE id = $1`, "gd_clientes_escopo"],
    ]) {
      await expect(db.query(sql, [c.id])).rejects.toThrow(new RegExp(regra));
    }
  });
});

describe("leitura", () => {
  it("prazo calculado só em horas corridas; úteis e fim do dia ficam pendentes; ATIVO sem prazo", async () => {
    const corrida = await novoCliente("Prazo corrido", "PROPOSTA_ENVIADA");
    const util = await novoCliente("Prazo útil", "PROPOSTA_ACEITA");
    const fimDia = await novoCliente("Prazo fim do dia", "ASSINADO");
    const ativo = await novoCliente("Sem prazo", "ATIVO");
    const atrasado = await novoCliente("Atrasado", "GRUPOS_CRIADOS", { ocorrido_em: "2026-01-01T00:00:00Z", motivo: "entrou antes" });

    const { json } = await chamar("GET", "/api/gd/clientes");
    const por = Object.fromEntries(json.clientes.map((c) => [c.id, c.prazo]));
    expect(por[corrida.id]).toMatchObject({ regra: "horas_corridas", horas: 168, calculo: "ok", atrasado: false });
    expect(new Date(por[corrida.id].vence_em).getTime() - new Date(corrida.estado_desde).getTime()).toBe(168 * 3600 * 1000);
    expect(por[util.id]).toMatchObject({ regra: "horas_uteis", horas: 4, vence_em: null, calculo: "pendente" });
    expect(por[fimDia.id]).toMatchObject({ regra: "fim_do_dia_util", horas: null, vence_em: null, calculo: "pendente" });
    expect(por[ativo.id]).toMatchObject({ regra: "sem_prazo", vence_em: null, atrasado: false });
    expect(por[atrasado.id]).toMatchObject({ regra: "horas_corridas", atrasado: true });
  });

  it("filtro por estado e GET /api/gd/estados só com ativos", async () => {
    await novoCliente("Filtrado", "ROTEIRO");
    const { json } = await chamar("GET", "/api/gd/clientes?estado=ROTEIRO");
    expect(json.clientes.length).toBeGreaterThan(0);
    expect(json.clientes.every((c) => c.estado_atual === "ROTEIRO")).toBe(true);
    const estados = await chamar("GET", "/api/gd/estados");
    expect(estados.json.estados.map((e) => e.codigo)).not.toContain("DESATIVADO");
    expect(estados.json.estados).toHaveLength(18);
  });

  it("GET /api/gd/estados manda rotulo_portal e acao_do_cliente, sem coluna fora da lista", async () => {
    const { status, json } = await chamar("GET", "/api/gd/estados");
    expect(status).toBe(200);
    const assinatura = json.estados.find((e) => e.codigo === "AGUARDANDO_ASSINATURA_CLIENTE");
    expect(assinatura.rotulo_portal).toBe("Aguardando sua assinatura");
    expect(assinatura.acao_do_cliente).toBe(true);
    expect(json.estados.filter((e) => e.acao_do_cliente).map((e) => e.codigo)).toEqual([
      "AGUARDANDO_ASSINATURA_CLIENTE", "BRIEFING_APROVACAO_CLIENTE", "PLANEJAMENTO_APROVACAO",
    ]);
    expect(Object.keys(assinatura)).not.toContain("ativo");
    expect(Object.keys(assinatura)).not.toContain("updated_at");
  });

  it("GET /api/gd/estados segue de pé sem a coluna acao_do_cliente (migration que não rodou)", async () => {
    await db.exec(`ALTER TABLE gd_estados DROP COLUMN acao_do_cliente`);
    try {
      const { status, json } = await chamar("GET", "/api/gd/estados");
      expect(status).toBe(200);
      expect(json.estados).toHaveLength(18);
      expect(json.estados.some((e) => "acao_do_cliente" in e)).toBe(false);
    } finally {
      await db.exec(MIGRATION_TRILHA);
    }
  });
});
