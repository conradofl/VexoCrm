// backend/src/test/importAuditReplyWindow.test.js
//
// Relatório & Auditoria de planilha (GET /api/campaigns/reports/import-audit): o cruzamento é por TELEFONE
// CANÔNICO dos dois lados (item × envio × resposta), a janela de 14 dias é de CADA envio (não do último) e o
// JID é normalizado antes de comparar. Aqui: a forma da SQL (defesa contra regressão) e a rota. O comportamento
// da SQL contra Postgres REAL (pglite) — formatos de telefone, JID, janela, tenant, repetidos, CRM — roda fora do
// repositório e está descrito no relatório da mudança; estes testes travam que a SQL continue com a forma que ele provou.

import { describe, expect, it, vi } from "vitest";
import { registerCampaignsRoutes, buildImportAuditSql, buildLegacyDispatchCampaignsSql } from "../domains/campaigns/routes.js";
import { SQL_CANONICAL_PHONE, SQL_CANONICAL_PHONE_JID } from "../services/canonicalPhone.js";

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(s) {
      this.statusCode = s;
      return this;
    },
    json(b) {
      this.body = b;
      this.statusCode = this.statusCode || 200;
      return this;
    },
  };
}

function getRouteHandler(deps, path, method = "get") {
  const routes = {};
  const fakeApp = {
    get: (p, ...handlers) => {
      routes[`get ${p}`] = handlers[handlers.length - 1];
    },
    post: (p, ...handlers) => {
      routes[`post ${p}`] = handlers[handlers.length - 1];
    },
    put: (p, ...handlers) => {
      routes[`put ${p}`] = handlers[handlers.length - 1];
    },
    patch: (p, ...handlers) => {
      routes[`patch ${p}`] = handlers[handlers.length - 1];
    },
    delete: (p, ...handlers) => {
      routes[`delete ${p}`] = handlers[handlers.length - 1];
    },
    use: () => {},
  };
  registerCampaignsRoutes(fakeApp, deps);
  const handler = routes[`${method} ${path}`];
  expect(handler, `rota ${method.toUpperCase()} ${path} não encontrada`).toBeDefined();
  return handler;
}

function makeDeps({ rows = [], queryFn, clientId = "tenant-1" } = {}) {
  const query = queryFn || vi.fn(async () => ({ rows }));
  return {
    ensureDb: () => true,
    requireAppViewAccess: () => (req, res, next) => next(),
    requireCampaignDispatchAccess: (req, res, next) => next(),
    requireFirebaseAuth: (req, res, next) => next(),
    requireInternalPageAccess: () => (req, res, next) => next(),
    resolveAuthorizedClientId: () => clientId,
    normalizeString: (s) => String(s || "").trim(),
    sendError: vi.fn((res, status, code, message) => {
      res.statusCode = status;
      res.body = { error: { code, message } };
    }),
    pgDatabasePool: { query },
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "import-1",
                  client_id: clientId,
                  source_name: "Planilha Leads",
                  created_at: "2026-09-01T00:00:00Z",
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    },
  };
}


describe("SQL_CANONICAL_PHONE_JID", () => {
  it("[TESTE OBRIGATÓRIO] tira o sufixo de JID de telefone ANTES de canonicalizar; '@lid' não é telefone", () => {
    const sql = SQL_CANONICAL_PHONE_JID("x.phone");

    expect(sql).toContain("regexp_replace(x.phone, '@(s\\.whatsapp\\.net|c\\.us)$', '')");
    expect(sql).toContain(SQL_CANONICAL_PHONE("regexp_replace(x.phone, '@(s\\.whatsapp\\.net|c\\.us)$', '')")); // a mesma canonicalização de sempre
    expect(sql).not.toMatch(/lid/); // '@lid' continua com o '@' e nunca vira telefone
  });
});

describe("buildImportAuditSql — forma da consulta", () => {
  const sql = buildImportAuditSql();

  it("[TESTE OBRIGATÓRIO] cruza por telefone canônico (com JID) nos TRÊS lados: item da planilha, envio e resposta", () => {
    expect(sql).toContain(SQL_CANONICAL_PHONE_JID("lii.telefone"));
    expect(sql).toContain(SQL_CANONICAL_PHONE_JID("r.phone"));
    expect(sql).toContain(SQL_CANONICAL_PHONE_JID("lm.phone"));
    expect(sql).toMatch(/END\s*=\s*t\.cp/); // a resposta casa com o telefone canônico do ENVIO
  });

  it("[TESTE OBRIGATÓRIO] NÃO cruza mais por identificador: nada de runs.lead_id = item.id como forma de achar o envio", () => {
    expect(sql).not.toMatch(/WHERE\s+lead_id\s*=\s*lii\.id/);
    expect(sql).not.toMatch(/lead_id\s*=\s*lii\.id/);
    // o identificador só serve para dizer "desta planilha" (tagged), nunca para achar o envio (runs)
    expect(sql).toMatch(/runs\.lead_import_item_id IN \(SELECT id::text FROM items\)/);
  });

  it("[TESTE OBRIGATÓRIO] a janela de 14 dias é de CADA envio: ancora em t.sent_at, nunca em max(sent_at)", () => {
    expect(sql).toContain("interval '14 days'");
    expect(sql).toMatch(/> t\.sent_at/);
    expect(sql).toMatch(/<= t\.sent_at \+ interval '14 days'/);
    expect(sql).not.toMatch(/max\(sent_at\)\s*\n?\s*FROM public\.campaign_dispatch_runs\s*WHERE lead_id/);
    expect(sql).not.toMatch(/\+ interval '14 days'\s*\)\s*\n?\s*\)/); // sem o modelo antigo "(SELECT max(sent_at)...) + 14d"
  });

  it("[TESTE OBRIGATÓRIO] só envio efetivamente 'sent' (com sent_at) pode gerar retorno", () => {
    expect(sql).toContain("WHERE t.status = 'sent' AND t.sent_at IS NOT NULL");
  });

  it("[TESTE OBRIGATÓRIO] todo cruzamento filtra pelo tenant: itens, campanhas, envios e mensagens", () => {
    expect(sql).toContain("lii.client_id = $1");
    expect(sql).toContain("c.client_id = $1");
    expect(sql).toContain("r.client_id = $1");
    expect(sql).toContain("lm.client_id = $1");
    expect(sql).toContain("(lm.direction = 'inbound' OR lm.engagement_signal = 'reply')");
  });

  it("telefone vazio nunca casa com telefone vazio: envio sem telefone e item sem telefone são ignorados", () => {
    expect(sql).toContain("COALESCE(btrim(r.phone), '') <> ''");
    expect(sql).toContain("COALESCE(btrim(lii.telefone), '') <> ''");
    expect(sql).toMatch(/WHEN lii\.imported AND/);
  });

  it("[TESTE OBRIGATÓRIO] 'desta planilha' nunca vira NULL (NULL IN (...) deixaria o envio de CRM sem categoria e o item cairia em pendente)", () => {
    expect(sql).toMatch(/COALESCE\(\s*\(\s*runs\.lead_import_item_id IN/);
    expect(sql).toMatch(/\),\s*false\s*\) AS from_this_import/);
  });

  it("[TESTE OBRIGATÓRIO] o estado da linha: sem telefone válido primeiro, depois desta planilha, outra campanha, falhou, e só então pendente", () => {
    const ordem = ["'sem_telefone_valido'", "'enviado_por_esta_planilha'", "'enviado_por_outra_campanha'", "'falhou'", "'pendente'"].map((s) => sql.indexOf(`THEN ${s}`) >= 0 ? sql.indexOf(`THEN ${s}`) : sql.indexOf(`ELSE ${s}`));
    expect(ordem.every((i) => i >= 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
  });

  it("repetidos: cada linha diz de qual linha repete (duplicate_of_row), sem tratar a repetida como falha", () => {
    expect(sql).toContain("AS duplicate_of_row");
    expect(sql).toContain("min(row_number) AS first_row_number");
  });

  it("uma planilha de outro tenant ou de outro cliente nunca entra: os itens são filtrados por tenant E pela importação", () => {
    expect(sql).toContain("lii.import_id::text = $2::text");
  });
});

describe("buildLegacyDispatchCampaignsSql — caminho legado", () => {
  const sql = buildLegacyDispatchCampaignsSql();

  it("[TESTE OBRIGATÓRIO] campanha disparada pelo legado = tem rastro de disparo e NENHUM campaign_dispatches", () => {
    expect(sql).toContain("(c.analytics_meta -> 'dispatch' ->> 'triggerSource') IS NOT NULL");
    expect(sql).toContain("c.last_triggered_at IS NOT NULL");
    expect(sql).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM public\.campaign_dispatches d WHERE d\.campaign_id = c\.id\s*\)/);
  });

  it("só campanhas deste tenant e que têm ESTA planilha como origem (import_id ou importIds)", () => {
    expect(sql).toContain("c.client_id = $1");
    expect(sql).toContain("c.import_id::text = $2::text");
    expect(sql).toContain("@> to_jsonb($2::text)");
  });
});

describe("GET /api/campaigns/reports/import-audit — a rota", () => {
  const ITEM = { lead_import_item_id: "item-1", import_id: "import-1", telefone: "34991093607", row_number: 1, imported: true, skip_reason: null, delivery_state: "enviado_por_esta_planilha", sent_count: 1, sent_by_import_count: 1, sent_by_other_count: 0, last_status: "sent", has_replied: true, duplicate_of_row: null };

  function setup(rows, legacyRows = []) {
    const calls = [];
    const queryFn = vi.fn(async (sql, params) => {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes("ADD COLUMN IF NOT EXISTS lead_import_item_id")) return { rows: [] };
      if (String(sql).includes("NOT EXISTS (") && String(sql).includes("campaign_dispatches")) return { rows: legacyRows };
      return { rows };
    });
    return { calls, handler: getRouteHandler(makeDeps({ queryFn }), "/api/campaigns/reports/import-audit") };
  }

  it("[TESTE OBRIGATÓRIO] roda a consulta nova com [tenant, planilha], garante a coluna do envio antes e devolve as campanhas legadas", async () => {
    const { calls, handler } = setup([ITEM], [{ id: "camp-1", name: "Black Friday", status: "sent", last_triggered_at: "2026-10-02T10:00:00Z" }]);
    const res = fakeRes();

    await handler({ query: { clientId: "tenant-1", importId: "import-1" } }, res);

    expect(res.statusCode).toBe(200);
    expect(calls[0].sql).toContain("ADD COLUMN IF NOT EXISTS lead_import_item_id");
    const auditCall = calls.find((c) => c.sql.includes("WITH items AS"));
    expect(auditCall.params).toEqual(["tenant-1", "import-1"]);
    expect(calls.find((c) => c.sql.includes("campaign_dispatches")).params).toEqual(["tenant-1", "import-1"]);
    expect(res.body.items[0].has_replied).toBe(true);
    expect(res.body.items[0].delivery_state).toBe("enviado_por_esta_planilha");
    expect(res.body.legacy_dispatch_campaigns).toEqual([{ id: "camp-1", name: "Black Friday", status: "sent", last_triggered_at: "2026-10-02T10:00:00Z" }]);
  });

  it("sem campanha legada, a lista vem vazia (a tela não mostra aviso)", async () => {
    const { handler } = setup([ITEM], []);
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1", importId: "import-1" } }, res);
    expect(res.body.legacy_dispatch_campaigns).toEqual([]);
  });

  it("[TESTE OBRIGATÓRIO] pede à importação os três totais que a tela rotula (linhas do arquivo, contatos válidos, descartadas)", async () => {
    let selecionado = "";
    const queryFn = vi.fn(async (sql) => (String(sql).includes("ADD COLUMN") ? { rows: [] } : { rows: [ITEM] }));
    const deps = makeDeps({ queryFn });
    deps.supabase = {
      from: () => ({
        select: (cols) => {
          selecionado = cols;
          return { eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "import-1", client_id: "tenant-1", source_name: "P", created_at: "2026-09-01T00:00:00Z", total_rows: 32, imported_rows: 30, skipped_rows: 2 }, error: null }) }) }) };
        },
      }),
    };
    const handler = getRouteHandler(deps, "/api/campaigns/reports/import-audit");
    const res = fakeRes();

    await handler({ query: { clientId: "tenant-1", importId: "import-1" } }, res);

    expect(selecionado).toContain("total_rows");
    expect(selecionado).toContain("imported_rows");
    expect(selecionado).toContain("skipped_rows");
    expect(res.body.import).toMatchObject({ total_rows: 32, imported_rows: 30, skipped_rows: 2 });
  });
});
