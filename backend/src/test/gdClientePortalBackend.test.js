// Testes do Portal do Cliente da GD: emissão de tokens e endpoint público de acompanhamento.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { GD_DONO, registerGdClientesRoutes } from "../domains/gdClientes/routes.js";
import { gerarPortalToken, hashPortalToken } from "../domains/gdClientes/portalTokens.js";

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
const MIGRATION_DOCUMENTOS = readFileSync(
  resolve("supabase/migrations/20261105190000_gd_clientes_quatro_documentos.sql"),
  "utf8"
);
const MIGRATION_WHATSAPP = readFileSync(
  resolve("supabase/migrations/20261107100000_gd_clientes_whatsapp_groups.sql"),
  "utf8"
);
const MIGRATION_CALENDAR = readFileSync(
  resolve("supabase/migrations/20261108100000_gd_clientes_google_calendar_email.sql"),
  "utf8"
);
const MIGRATION_BRIEFING = readFileSync(
  resolve("supabase/migrations/20261108110000_gd_clientes_briefing_scheduling.sql"),
  "utf8"
);

const PERFIS = {
  superadmin: { uid: "uid-fundador", role: "superadmin", isAdmin: true, clientIds: [] },
  admin: { uid: "uid-admin", role: "internal", isAdmin: true, clientIds: [] },
  equipeGd: {
    uid: "uid-gd",
    email: "equipe@gd.com",
    role: "internal",
    isAdmin: false,
    clientId: GD_DONO,
    clientIds: [GD_DONO],
    permissions: ["geracao_digital.proposals"],
    internalPages: ["propostas-gd"],
  },
  cliente: {
    uid: "uid-cliente",
    role: "client",
    isAdmin: false,
    clientId: GD_DONO,
    clientIds: [GD_DONO],
  },
  outroTenant: {
    uid: "uid-outro",
    role: "internal",
    isAdmin: false,
    clientId: "outro-tenant",
    clientIds: ["outro-tenant"],
  },
};

let db;
let server;
let base;

function poolDe(pg) {
  const client = { query: (sql, params) => pg.query(sql, params), release() {} };
  return {
    query: (sql, params) => pg.query(sql, params),
    connect: async () => client,
  };
}

async function chamar(metodo, caminho, { perfil, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (perfil) headers["x-teste-perfil"] = perfil;
  const res = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

beforeAll(async () => {
  db = await createPgliteDb(`
    SET TimeZone = 'UTC';
    CREATE TABLE public.leads_clients (id text PRIMARY KEY, name text NOT NULL);
    INSERT INTO public.leads_clients VALUES ('geracao-digital', 'Geração Digital'), ('outro-tenant', 'Outro');
  `);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION_CAMPOS);
  await db.exec(MIGRATION_TRILHA);
  await db.exec(MIGRATION_DOCUMENTOS);
  await db.exec(MIGRATION_WHATSAPP);
  await db.exec(MIGRATION_CALENDAR);
  await db.exec(MIGRATION_BRIEFING);

  const app = express();
  app.use(express.json());
  registerGdClientesRoutes(app, {
    getPool: () => poolDe(db),
    requireFirebaseAuth: (req, _res, next) => {
      const perfilKey = req.headers["x-teste-perfil"];
      req.authAccess = perfilKey ? PERFIS[perfilKey] : null;
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

describe("Módulo portalTokens.js", () => {
  it("gerarPortalToken produz token base64url de 32 bytes (~43 chars)", () => {
    const t1 = gerarPortalToken();
    const t2 = gerarPortalToken();
    expect(t1).not.toBe(t2);
    expect(t1.length).toBeGreaterThanOrEqual(42);
    expect(t1).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("hashPortalToken devolve SHA-256 hex minúsculo de 64 caracteres", () => {
    const token = "teste-token-123";
    const h = hashPortalToken(token);
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPortalToken(token)).toBe(h);
  });

  it("hashPortalToken rejeita token vazio ou tipo inválido", () => {
    expect(() => hashPortalToken("")).toThrow(TypeError);
    expect(() => hashPortalToken("   ")).toThrow(TypeError);
    expect(() => hashPortalToken(null)).toThrow(TypeError);
    expect(() => hashPortalToken(123)).toThrow(TypeError);
  });
});

describe("POST /api/gd/clientes/:id/portal-token (Emissão interna)", () => {
  let clienteId;

  beforeEach(async () => {
    const nomeUnico = `Cliente Portal ${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const r = await chamar("POST", "/api/gd/clientes", {
      perfil: "equipeGd",
      body: {
        nome: nomeUnico,
        estado: "PROPOSTA_ENVIADA",
        aprovador_nome: "Maria Aprovadora",
        aprovador_telefone: "5511999998888",
        drive_url: "https://drive.google.com/drive/folders/pasta123",
        escopo: ["meta", "social"],
      },
    });
    expect(r.status).toBe(201);
    clienteId = r.json.cliente.id;
  });

  it("emite token com sucesso (201) e devolve token base64url e url de acompanhamento", async () => {
    const res = await chamar("POST", `/api/gd/clientes/${clienteId}/portal-token`, {
      perfil: "equipeGd",
    });

    expect(res.status).toBe(201);
    expect(res.json.token).toBeDefined();
    expect(res.json.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(res.json.url).toBe(`/acompanhamento/${res.json.token}`);
    expect(res.json.criado_em).toBeDefined();

    // Comprova que no banco foi gravado APENAS o sha256
    const { rows } = await db.query(
      `SELECT * FROM public.gd_cliente_portal_tokens WHERE cliente_id = $1`,
      [clienteId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].token_sha256).toBe(hashPortalToken(res.json.token));
    expect(rows[0].token_sha256).not.toBe(res.json.token);
    expect(rows[0].criado_por).toBe("uid-gd");
    expect(rows[0].revogado_em).toBeNull();
  });

  it("nova emissão revoga o token anterior (unicidade comprovada)", async () => {
    const res1 = await chamar("POST", `/api/gd/clientes/${clienteId}/portal-token`, {
      perfil: "equipeGd",
    });
    expect(res1.status).toBe(201);
    const token1 = res1.json.token;

    const res2 = await chamar("POST", `/api/gd/clientes/${clienteId}/portal-token`, {
      perfil: "equipeGd",
    });
    expect(res2.status).toBe(201);
    const token2 = res2.json.token;
    expect(token2).not.toBe(token1);

    // Confere no banco: token 1 está revogado e token 2 está ativo
    const { rows } = await db.query(
      `SELECT token_sha256, revogado_em, revogado_por
         FROM public.gd_cliente_portal_tokens
        WHERE cliente_id = $1
        ORDER BY criado_em ASC`,
      [clienteId]
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].token_sha256).toBe(hashPortalToken(token1));
    expect(rows[0].revogado_em).not.toBeNull();
    expect(rows[0].revogado_por).toBe("uid-gd");

    expect(rows[1].token_sha256).toBe(hashPortalToken(token2));
    expect(rows[1].revogado_em).toBeNull();

    // Apenas 1 token ativo
    const { rows: ativos } = await db.query(
      `SELECT count(*)::int AS n FROM public.gd_cliente_portal_tokens
        WHERE cliente_id = $1 AND revogado_em IS NULL`,
      [clienteId]
    );
    expect(ativos[0].n).toBe(1);
  });

  it("rejeita emissão para perfis não autorizados (403)", async () => {
    for (const perfil of ["cliente", "outroTenant"]) {
      const res = await chamar("POST", `/api/gd/clientes/${clienteId}/portal-token`, {
        perfil,
      });
      expect(res.status).toBe(403);
    }
  });

  it("retorna 404 para cliente inexistente", async () => {
    const uuidFalso = "11111111-2222-3333-4444-555555555555";
    const res = await chamar("POST", `/api/gd/clientes/${uuidFalso}/portal-token`, {
      perfil: "equipeGd",
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/gd/public/portal/:token (Consulta pública)", () => {
  let clienteId;
  let tokenAtivo;
  let tokenRevogado;

  let clienteNome;

  beforeEach(async () => {
    clienteNome = `Cliente Trilha ${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const r = await chamar("POST", "/api/gd/clientes", {
      perfil: "equipeGd",
      body: {
        nome: clienteNome,
        estado: "PROPOSTA_ENVIADA",
        aprovador_nome: "Sigiloso Silva",
        aprovador_telefone: "5511988887777",
        drive_url: "https://drive.google.com/drive/folders/pasta-publica",
        contrato_url: "https://contratos.vexoia.com/doc-123",
        briefing_url: "https://docs.google.com/document/d/briefing-456",
        ficha_vexo_url: "https://vexoia.com/ficha/789",
        planejamento_url: "https://trello.com/b/planejamento-abc",
        escopo: ["google", "meta"],
      },
    });
    expect(r.status).toBe(201);
    clienteId = r.json.cliente.id;

    // Adiciona evento com motivo interno e notas
    await chamar("POST", `/api/gd/clientes/${clienteId}/eventos`, {
      perfil: "equipeGd",
      body: {
        estado: "PROPOSTA_ACEITA",
        motivo: "Reunião de alinhamento com Caio: cliente aprovou proposta",
      },
    });

    // Emite token 1
    const rToken1 = await chamar("POST", `/api/gd/clientes/${clienteId}/portal-token`, {
      perfil: "equipeGd",
    });
    tokenRevogado = rToken1.json.token;

    // Emite token 2 (revoga token 1)
    const rToken2 = await chamar("POST", `/api/gd/clientes/${clienteId}/portal-token`, {
      perfil: "equipeGd",
    });
    tokenAtivo = rToken2.json.token;
  });

  it("retorna 200 com cliente, estados e eventos para token válido (acesso anônimo)", async () => {
    const res = await chamar("GET", `/api/gd/public/portal/${tokenAtivo}`);
    expect(res.status).toBe(200);

    const { cliente, estados, eventos } = res.json;

    // Cliente
    expect(cliente).toBeDefined();
    expect(cliente.nome).toBe(clienteNome);
    expect(cliente.estado_atual).toBe("PROPOSTA_ACEITA");
    expect(cliente.drive_url).toBe("https://drive.google.com/drive/folders/pasta-publica");
    expect(cliente.contrato_url).toBe("https://contratos.vexoia.com/doc-123");
    expect(cliente.briefing_url).toBe("https://docs.google.com/document/d/briefing-456");
    expect(cliente.ficha_vexo_url).toBe("https://vexoia.com/ficha/789");
    expect(cliente.planejamento_url).toBe("https://trello.com/b/planejamento-abc");
    expect(cliente.escopo).toEqual(["google", "meta"]);
    expect(cliente.estado_desde).toBeDefined();

    // Suporte GD
    expect(res.json.suporte).toBeDefined();
    expect(res.json.suporte.whatsapp).toBe("5534997719779");

    // Estados
    expect(Array.isArray(estados)).toBe(true);
    expect(estados.length).toBeGreaterThanOrEqual(16);
    for (const est of estados) {
      expect(est.codigo).toBeDefined();
      expect(est.ordem).toBeTypeOf("number");
      expect(est.fase).toBeDefined();
      expect(est.rotulo_portal).toBeDefined();
      expect(typeof est.terminal).toBe("boolean");
      expect(typeof est.acao_do_cliente).toBe("boolean");
    }

    // Eventos
    expect(Array.isArray(eventos)).toBe(true);
    expect(eventos).toHaveLength(2);
    expect(eventos[0].estado).toBe("PROPOSTA_ENVIADA");
    expect(eventos[1].estado).toBe("PROPOSTA_ACEITA");
    expect(eventos[0].ocorrido_em).toBeDefined();
    expect(typeof eventos[0].data_estimada).toBe("boolean");
  });

  it("prova de segurança: NENHUM dado confidencial ou interno vaza no payload público", async () => {
    const res = await chamar("GET", `/api/gd/public/portal/${tokenAtivo}`);
    expect(res.status).toBe(200);
    const bodyStr = JSON.stringify(res.json);

    // 1. Dados cadastrais sensíveis
    expect(res.json.cliente.aprovador_telefone).toBeUndefined();
    expect(res.json.cliente.aprovador_nome).toBeUndefined();
    expect(res.json.cliente.cnpj).toBeUndefined();
    expect(res.json.cliente.dono_client_id).toBeUndefined();
    expect(res.json.cliente.cliente_client_id).toBeUndefined();
    expect(res.json.cliente.origem).toBeUndefined();

    // 2. Não vaza o telefone em lugar nenhum do json
    expect(bodyStr).not.toContain("5511988887777");
    expect(bodyStr).not.toContain("Sigiloso Silva");
    expect(bodyStr).not.toContain("geracao-digital");

    // 3. Estados: NÃO possuem rotulo_interno
    for (const est of res.json.estados) {
      expect(est.rotulo_interno).toBeUndefined();
    }
    expect(bodyStr).not.toContain("rotulo_interno");
    // O rótulo interno "Aguardando assinatura Caio" NÃO pode existir no payload
    expect(bodyStr).not.toContain("Aguardando assinatura Caio");

    // 4. Eventos: NÃO possuem ator_id, ator_tipo, motivo, origem ou dados
    for (const ev of res.json.eventos) {
      expect(ev.ator_id).toBeUndefined();
      expect(ev.ator_tipo).toBeUndefined();
      expect(ev.motivo).toBeUndefined();
      expect(ev.origem).toBeUndefined();
      expect(ev.dados).toBeUndefined();
      expect(ev.id).toBeUndefined();
      expect(ev.seq).toBeUndefined();
    }
    expect(bodyStr).not.toContain("Reunião de alinhamento");
    expect(bodyStr).not.toContain("uid-gd");
  });

  it("retorna 404 para token revogado", async () => {
    const res = await chamar("GET", `/api/gd/public/portal/${tokenRevogado}`);
    expect(res.status).toBe(404);
    expect(res.json.error).toBe("Link de acompanhamento inválido ou expirado.");
  });

  it("retorna 404 para token inexistente ou inválido", async () => {
    const res1 = await chamar("GET", "/api/gd/public/portal/token-que-nunca-existiu");
    expect(res1.status).toBe(404);
    expect(res1.json.error).toBe("Link de acompanhamento inválido ou expirado.");

    const res2 = await chamar("GET", "/api/gd/public/portal/%20%20");
    expect(res2.status).toBe(404);
  });

  it("permite atualizar os 4 documentos via PATCH e recusa links que não comecem com https://", async () => {
    // 1. Atualização com links válidos
    const patchRes = await chamar("PATCH", `/api/gd/clientes/${clienteId}`, {
      perfil: "equipeGd",
      body: {
        contrato_url: "https://novos-contratos.com/doc-999",
        briefing_url: "https://novos-briefings.com/b-999",
        ficha_vexo_url: "https://novas-fichas.com/f-999",
        planejamento_url: "https://novo-planejamento.com/p-999",
      },
    });
    expect(patchRes.status).toBe(200);
    expect(patchRes.json.cliente.contrato_url).toBe("https://novos-contratos.com/doc-999");
    expect(patchRes.json.cliente.briefing_url).toBe("https://novos-briefings.com/b-999");
    expect(patchRes.json.cliente.ficha_vexo_url).toBe("https://novas-fichas.com/f-999");
    expect(patchRes.json.cliente.planejamento_url).toBe("https://novo-planejamento.com/p-999");

    // 2. Consulta pública reflete a atualização
    const resPublica = await chamar("GET", `/api/gd/public/portal/${tokenAtivo}`);
    expect(resPublica.status).toBe(200);
    expect(resPublica.json.cliente.contrato_url).toBe("https://novos-contratos.com/doc-999");

    // 3. Rejeita URL que não comece com https://
    const patchInvalido = await chamar("PATCH", `/api/gd/clientes/${clienteId}`, {
      perfil: "equipeGd",
      body: {
        contrato_url: "http://inseguro.com/doc",
      },
    });
    expect(patchInvalido.status).toBe(422);
    expect(patchInvalido.json.error.code).toBe("CONTRATO_URL_INVALIDA");
  });

  it("atualiza ultimo_acesso_em comprovadamente após acesso com token válido", async () => {
    const tokenHash = hashPortalToken(tokenAtivo);

    // Antes do acesso: ultimo_acesso_em é null
    const antes = await db.query(
      `SELECT ultimo_acesso_em FROM public.gd_cliente_portal_tokens WHERE token_sha256 = $1`,
      [tokenHash]
    );
    expect(antes.rows[0].ultimo_acesso_em).toBeNull();

    // Acesso
    const res = await chamar("GET", `/api/gd/public/portal/${tokenAtivo}`);
    expect(res.status).toBe(200);

    // Depois do acesso: ultimo_acesso_em preenchido
    const depois = await db.query(
      `SELECT ultimo_acesso_em FROM public.gd_cliente_portal_tokens WHERE token_sha256 = $1`,
      [tokenHash]
    );
    expect(depois.rows[0].ultimo_acesso_em).not.toBeNull();
    const dataAcesso = new Date(depois.rows[0].ultimo_acesso_em);
    expect(Number.isNaN(dataAcesso.getTime())).toBe(false);
  });
});
