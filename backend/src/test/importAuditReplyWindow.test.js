// backend/src/test/importAuditReplyWindow.test.js
//
// Testes para a métrica has_replied em GET /api/campaigns/reports/import-audit:
// 1. Invariante do disparo: quem nunca recebeu mensagem (sent_at IS NULL) NUNCA conta como respondido.
// 2. Janela temporal: resposta só conta se posterior ao disparo e dentro do limite de 14 dias.
// 3. Canonicalização: casamento via SQL_CANONICAL_PHONE nos dois lados (lm.phone e lii.telefone).

import { describe, expect, it, vi } from "vitest";
import { registerCampaignsRoutes, buildImportAuditSql } from "../domains/campaigns/routes.js";
import { toCanonicalPhone, SQL_CANONICAL_PHONE } from "../services/canonicalPhone.js";

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

/**
 * Modelo comportamental da expressão SQL has_replied.
 * Espelha fielmente a lógica SQL do CASE/EXISTS para testes lógicos e determinísticos.
 */
function evaluateSqlReplyLogic({ last_sent_at, telefone, messages = [], clientId = "tenant-1" }) {
  // Regra de ouro: se nunca foi disparado, NUNCA é true
  if (!last_sent_at) return false;

  const sentTimestamp = new Date(last_sent_at).getTime();
  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
  const maxWindowTimestamp = sentTimestamp + fourteenDaysMs;

  const leadCanonical = toCanonicalPhone(telefone);

  return messages.some((lm) => {
    // lm.client_id = $1
    if (lm.client_id && lm.client_id !== clientId) return false;

    // (lm.direction = 'inbound' OR lm.engagement_signal = 'reply')
    const isReplySignal = lm.direction === "inbound" || lm.engagement_signal === "reply";
    if (!isReplySignal) return false;

    // (lm.phone = lii.telefone OR SQL_CANONICAL_PHONE(lm.phone) = SQL_CANONICAL_PHONE(lii.telefone))
    const rawMatches = lm.phone === telefone;
    const msgCanonical = toCanonicalPhone(lm.phone);
    const canonicalMatches = Boolean(leadCanonical && msgCanonical && leadCanonical === msgCanonical);
    if (!rawMatches && !canonicalMatches) return false;

    // COALESCE(lm.message_timestamp, lm.delivered_at, lm.created_at)
    const msgDate = lm.message_timestamp || lm.delivered_at || lm.created_at;
    if (!msgDate) return false;
    const msgTimestamp = new Date(msgDate).getTime();

    // > last_sent_at AND <= last_sent_at + interval '14 days'
    return msgTimestamp > sentTimestamp && msgTimestamp <= maxWindowTimestamp;
  });
}

describe("GET /api/campaigns/reports/import-audit — has_replied (Recorte de 14 dias e Canonicalização)", () => {
  describe("1. Testes Estruturais da Query SQL (Defesa contra Regressão)", () => {
    it("[TESTE OBRIGATÓRIO] a query SQL aplica a janela de 14 dias vinculada ao max(sent_at)", () => {
      const sql = buildImportAuditSql();
      expect(sql).toContain("interval '14 days'");
      expect(sql).toMatch(/>\s*\(\s*SELECT max\(sent_at\)\s*FROM public\.campaign_dispatch_runs\s*WHERE lead_id = lii\.id\s*\)/);
      expect(sql).toMatch(/<=\s*\(\s*SELECT max\(sent_at\)\s*FROM public\.campaign_dispatch_runs\s*WHERE lead_id = lii\.id\s*\)\s*\+\s*interval '14 days'/);
    });

    it("[TESTE OBRIGATÓRIO] a query SQL zera has_replied se max(sent_at) IS NULL", () => {
      const sql = buildImportAuditSql();
      expect(sql).toMatch(/CASE\s*WHEN\s*\(\s*SELECT max\(sent_at\)\s*FROM public\.campaign_dispatch_runs\s*WHERE lead_id = lii\.id\s*\)\s*IS NULL THEN false/i);
    });

    it("[TESTE OBRIGATÓRIO] a query SQL usa SQL_CANONICAL_PHONE nos dois lados do cruzamento de telefone", () => {
      const sql = buildImportAuditSql();
      // Deve conter lm.phone = lii.telefone OR canonical(lm.phone) = canonical(lii.telefone)
      expect(sql).toContain("lm.phone = lii.telefone");
      expect(sql).toContain(SQL_CANONICAL_PHONE("lm.phone"));
      expect(sql).toContain(SQL_CANONICAL_PHONE("lii.telefone"));
    });

    it("[TESTE OBRIGATÓRIO] a query SQL filtra por tenant (lm.client_id = $1) e direção inbound/reply", () => {
      const sql = buildImportAuditSql();
      expect(sql).toContain("lm.client_id = $1");
      expect(sql).toContain("(lm.direction = 'inbound' OR lm.engagement_signal = 'reply')");
    });
  });

  describe("2. Testes Comportamentais das Regras de Negócio", () => {
    const DISPATCH_DATE = "2026-09-10T12:00:00.000Z";

    it("[TESTE OBRIGATÓRIO] Lead com mensagem inbound antiga (antes do disparo) NÃO conta como respondido (has_replied === false)", () => {
      const leadPhone = "5534991093607";
      // Mensagem inbound recebida 5 dias ANTES do disparo
      const messages = [
        {
          phone: "5534991093607",
          direction: "inbound",
          engagement_signal: null,
          created_at: "2026-09-05T10:00:00.000Z",
          client_id: "tenant-1",
        },
      ];

      const hasReplied = evaluateSqlReplyLogic({
        last_sent_at: DISPATCH_DATE,
        telefone: leadPhone,
        messages,
      });

      expect(hasReplied).toBe(false);
    });

    it("[TESTE OBRIGATÓRIO] Lead nunca disparado (last_sent_at === null) NUNCA conta como respondido, mesmo com mensagens inbound históricas", () => {
      const leadPhone = "5534991093607";
      // Contato com várias mensagens inbound no histórico, mas a planilha nunca foi disparada
      const messages = [
        {
          phone: "5534991093607",
          direction: "inbound",
          created_at: "2026-09-01T12:00:00.000Z",
          client_id: "tenant-1",
        },
        {
          phone: "5534991093607",
          direction: "inbound",
          created_at: "2026-09-15T12:00:00.000Z",
          client_id: "tenant-1",
        },
      ];

      const hasReplied = evaluateSqlReplyLogic({
        last_sent_at: null,
        telefone: leadPhone,
        messages,
      });

      expect(hasReplied).toBe(false);
    });

    it("[TESTE OBRIGATÓRIO] Lead com resposta 20 dias após o disparo (fora da janela de 14 dias) NÃO conta como respondido", () => {
      const leadPhone = "5534991093607";
      // Resposta no dia 30/09 (20 dias após o disparo do dia 10/09)
      const messages = [
        {
          phone: "5534991093607",
          direction: "inbound",
          engagement_signal: "reply",
          created_at: "2026-09-30T12:00:00.000Z",
          client_id: "tenant-1",
        },
      ];

      const hasReplied = evaluateSqlReplyLogic({
        last_sent_at: DISPATCH_DATE,
        telefone: leadPhone,
        messages,
      });

      expect(hasReplied).toBe(false);
    });

    it("[TESTE OBRIGATÓRIO] Lead com resposta no 3º dia após o disparo e telefone sem DDI casando via SQL_CANONICAL_PHONE é marcado com has_replied === true", () => {
      // Na planilha: telefone sem DDI 55 e com DDD 34: "34991093607"
      const planilhaTelefone = "34991093607";
      // No WhatsApp/lead_messages: telefone completo vindo da Evolution com 55: "5534991093607"
      // Resposta 3 dias após o disparo (13/09, dentro da janela <= 14 dias)
      const messages = [
        {
          phone: "5534991093607",
          direction: "inbound",
          engagement_signal: "reply",
          created_at: "2026-09-13T15:30:00.000Z",
          client_id: "tenant-1",
        },
      ];

      const hasReplied = evaluateSqlReplyLogic({
        last_sent_at: DISPATCH_DATE,
        telefone: planilhaTelefone,
        messages,
      });

      expect(hasReplied).toBe(true);
    });
  });

  describe("3. Integração com a Rota Express do Endpoint", () => {
    it("chama a query exata com buildImportAuditSql() e repassa has_replied na resposta", async () => {
      let executedSql = "";
      const queryFn = vi.fn(async (sql) => {
        executedSql = sql;
        return {
          rows: [
            {
              lead_import_item_id: "item-1",
              import_id: "import-1",
              telefone: "34991093607",
              row_number: 1,
              imported: true,
              skip_reason: null,
              dispatch_count: 1,
              last_sent_at: "2026-09-10T12:00:00.000Z",
              last_attempt_at: "2026-09-10T12:00:00.000Z",
              last_status: "sent",
              last_error_message: null,
              has_replied: true,
            },
            {
              lead_import_item_id: "item-2",
              import_id: "import-1",
              telefone: "34999990000",
              row_number: 2,
              imported: true,
              skip_reason: null,
              dispatch_count: 0,
              last_sent_at: null,
              last_attempt_at: null,
              last_status: null,
              last_error_message: null,
              has_replied: false,
            },
          ],
        };
      });

      const deps = makeDeps({ queryFn });
      const handler = getRouteHandler(deps, "/api/campaigns/reports/import-audit");
      const res = fakeRes();

      await handler({ query: { clientId: "tenant-1", importId: "import-1" } }, res);

      expect(res.statusCode).toBe(200);
      expect(executedSql).toContain("interval '14 days'");
      expect(executedSql).toContain(SQL_CANONICAL_PHONE("lm.phone"));
      expect(executedSql).toContain(SQL_CANONICAL_PHONE("lii.telefone"));
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0].has_replied).toBe(true);
      expect(res.body.items[1].has_replied).toBe(false);
    });
  });
});
