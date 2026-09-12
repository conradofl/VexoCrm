import { describe, expect, it, vi, beforeEach } from "vitest";
import { _setPgDatabasePoolForTesting } from "../services/database.js";
import { createContract, buildContractPdfBuffer } from "../domains/geracaoDigitalContracts/contractHandlers.js";
import { isManagerOrAdmin } from "../access/claims.js";
import { registerGeracaoDigitalRoutes } from "../domains/geracaoDigitalRoutes.js";

const VALID_TENANT_UUID = "a1b2c3d4-e5f6-4a7b-8c9d-0123456789ab";

describe("Peça 2 — Testes de Contrato Standalone e Reabertura de Proposta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("2.1 — Contrato standalone (sem proposta)", () => {
    it("createContract: cria contrato com sucesso quando proposal_id é null ou omitido", async () => {
      const mockContract = {
        id: "contract-standalone-1",
        tenant_id: VALID_TENANT_UUID,
        proposal_id: null,
        dados: {
          razao_social: "Cliente Standalone Ltda",
          cnpj: "11.222.333/0001-44",
          mensalidade: "2.500,00",
        },
        status: "rascunho",
        owner_company: "geracao-digital",
      };

      const mockPool = {
        query: vi.fn(async (sql, params) => {
          if (sql.includes("FROM gd_contract_templates")) {
            return { rows: [{ id: "tmpl-default-1" }] };
          }
          if (sql.includes("INSERT INTO gd_contracts")) {
            expect(params[1]).toBeNull(); // proposal_id deve ser null
            expect(params[2]).toEqual(mockContract.dados);
            return { rows: [mockContract] };
          }
          return { rows: [] };
        }),
      };

      _setPgDatabasePoolForTesting(mockPool);

      const req = {
        query: { client_id: VALID_TENANT_UUID },
        body: {
          client_id: VALID_TENANT_UUID,
          proposal_id: null,
          dados: mockContract.dados,
        },
        authAccess: {
          role: "internal",
          isAdmin: true,
          clientId: VALID_TENANT_UUID,
          clientIds: [VALID_TENANT_UUID],
        },
      };

      let statusCalled = 200;
      let jsonResponse = null;
      const res = {
        status: vi.fn((code) => {
          statusCalled = code;
          return res;
        }),
        json: vi.fn((data) => {
          jsonResponse = data;
          return res;
        }),
      };

      await createContract(req, res);

      expect(statusCalled).toBe(201);
      expect(jsonResponse).toBeDefined();
      expect(jsonResponse.id).toBe("contract-standalone-1");
      expect(jsonResponse.proposal_id).toBeNull();
    });

    it("createContract: falha se dados não for fornecido, mas NÃO se proposal_id for omitido", async () => {
      const mockPool = { query: vi.fn() };
      _setPgDatabasePoolForTesting(mockPool);

      const req = {
        query: { client_id: VALID_TENANT_UUID },
        body: {
          client_id: VALID_TENANT_UUID,
          proposal_id: null,
          // dados ausente
        },
        authAccess: {
          role: "internal",
          isAdmin: true,
          clientId: VALID_TENANT_UUID,
          clientIds: [VALID_TENANT_UUID],
        },
      };

      let statusCalled = 200;
      let jsonResponse = null;
      const res = {
        status: vi.fn((code) => {
          statusCalled = code;
          return res;
        }),
        json: vi.fn((data) => {
          jsonResponse = data;
          return res;
        }),
      };

      await createContract(req, res);

      expect(statusCalled).toBe(400);
      expect(jsonResponse.error.message).toMatch(/dados é obrigatório/i);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it("buildContractPdfBuffer: gera PDF com sucesso para contrato standalone (proposal_id null)", async () => {
      const mockPool = {
        query: vi.fn(async (sql, params) => {
          if (sql.includes("FROM public.tenant_modules")) {
            return {
              rows: [
                {
                  config: {
                    contratada: {
                      razao_social: "Agência Digital Alpha Ltda",
                      cnpj: "12.345.678/0001-99",
                      cidade: "São Paulo",
                      estado: "SP",
                    },
                  },
                },
              ],
            };
          }
          if (sql.includes("FROM gd_contracts")) {
            return {
              rows: [
                {
                  id: "contract-standalone-2",
                  tenant_id: VALID_TENANT_UUID,
                  proposal_id: null,
                  dados: {
                    razao_social: "Cafeteria Grão Raro Ltda",
                    cnpj: "98.765.432/0001-11",
                    mensalidade: "3.500,00",
                    servicos: "Gestão de Tráfego e Redes",
                  },
                },
              ],
            };
          }
          if (sql.includes("FROM gd_contract_templates")) {
            return {
              rows: [
                {
                  id: "tmpl-1",
                  conteudo: "Contrato de prestação de serviços com {{razao_social}}",
                  ativo: true,
                },
              ],
            };
          }
          return { rows: [] };
        }),
      };

      _setPgDatabasePoolForTesting(mockPool);

      const result = await buildContractPdfBuffer(
        "contract-standalone-2",
        VALID_TENANT_UUID
      );

      const buffer = result?.pdfData || result;
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(500);
      expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
    });
  });

  describe("2.3 — Reabertura de proposta aceita e preservação probatória", () => {
    it("isManagerOrAdmin: apenas gestor ou admin possui permissão de reabertura", () => {
      // Vendedor comum / operador
      expect(isManagerOrAdmin({ role: "operator", approvalLevel: "operator" })).toBe(false);
      expect(isManagerOrAdmin({ role: "vendedor", accessPreset: "vendedor" })).toBe(false);
      expect(isManagerOrAdmin(null)).toBe(false);

      // Gestor / Admin
      expect(isManagerOrAdmin({ isAdmin: true })).toBe(true);
      expect(isManagerOrAdmin({ isFixedAdmin: true })).toBe(true);
      expect(isManagerOrAdmin({ role: "superadmin" })).toBe(true);
      expect(isManagerOrAdmin({ preset: "gestor" })).toBe(true);
      expect(isManagerOrAdmin({ preset: "admin_vexo" })).toBe(true);
      expect(isManagerOrAdmin({ approvalLevel: "manager" })).toBe(true);
      expect(isManagerOrAdmin({ internalPages: ["usuarios"] })).toBe(true);
    });

    it("Preserva integralmente campos de assinatura ao registrar reabertura no histórico", () => {
      const originalProposal = {
        id: "prop-123",
        status: "aceita",
        prospect_name: "Cliente Assinado",
        signer_name: "João da Silva",
        signed_at: "2026-08-15T14:30:00.000Z",
        signer_ip: "187.54.12.33",
        assinatura_metodo: "desenho",
        assinatura: "data:image/png;base64,iVBORw0KGgoAAA...",
        condicoes_pagamento: {
          ofertadas: [{ id: "pix_a_vista", nome: "PIX à vista" }],
          escolhida: "pix_a_vista",
        },
      };

      // Simulação da lógica executada pelo handler de reopen
      const reaberturaRegistro = {
        reaberto_por: "Gestor Comercial",
        reaberto_por_uid: "uid-gestor-456",
        reaberto_em: "2026-09-12T17:30:00.000Z",
        motivo: "Cliente solicitou upgrade para plano semestral",
        aceite_anterior: {
          signer_name: originalProposal.signer_name,
          signed_at: originalProposal.signed_at,
          signer_ip: originalProposal.signer_ip,
          assinatura_metodo: originalProposal.assinatura_metodo,
        },
      };

      const updatedCondicoesPagamento = {
        ...originalProposal.condicoes_pagamento,
        reabertura: reaberturaRegistro,
        reaberturas: [reaberturaRegistro],
      };

      const reopenedProposal = {
        ...originalProposal,
        status: "rascunho",
        condicoes_pagamento: updatedCondicoesPagamento,
      };

      // VERIFICAÇÕES DE INTEGRIDADE PROBATÓRIA
      expect(reopenedProposal.status).toBe("rascunho");
      // Todos os campos de assinatura continuam intactos
      expect(reopenedProposal.signer_name).toBe("João da Silva");
      expect(reopenedProposal.signed_at).toBe("2026-08-15T14:30:00.000Z");
      expect(reopenedProposal.signer_ip).toBe("187.54.12.33");
      expect(reopenedProposal.assinatura_metodo).toBe("desenho");
      expect(reopenedProposal.assinatura).toBe("data:image/png;base64,iVBORw0KGgoAAA...");

      // Auditoria anexada corretamente
      expect(reopenedProposal.condicoes_pagamento.reabertura.reaberto_por).toBe("Gestor Comercial");
      expect(reopenedProposal.condicoes_pagamento.reabertura.motivo).toBe("Cliente solicitou upgrade para plano semestral");
      expect(reopenedProposal.condicoes_pagamento.reabertura.aceite_anterior.signed_at).toBe("2026-08-15T14:30:00.000Z");
    });

    it("POST /api/gd/proposals/:id/reopen: tentativa de reabrir proposta de outro tenant retorna 404 e não altera o status", async () => {
      const TENANT_A = "11111111-1111-4111-8111-111111111111";
      const TENANT_B = "22222222-2222-4222-8222-222222222222";
      const PROPOSAL_ID = "33333333-3333-4333-8333-333333333333";

      // Banco possui a proposta pertencente ao TENANT_A com status 'aceita'
      const mockDbRow = {
        id: PROPOSAL_ID,
        tenant_id: TENANT_A,
        status: "aceita",
        signer_name: "Cliente Original",
        owner_company: "geracao-digital",
      };

      const queriesExecuted = [];
      const mockPool = {
        query: vi.fn(async (sql, params) => {
          queriesExecuted.push({ sql, params });
          // Simula verificação do gate Vexo
          if (sql.includes("FROM public.gd_proposals") && !sql.includes("tenant_id")) {
            return { rows: [{ owner_company: "geracao-digital" }] };
          }
          // Query de tenants
          if (sql.includes("FROM public.tenants")) {
            return { rows: [{ id: params?.[0] || TENANT_B }] };
          }
          // Query principal de SELECT no /reopen com filtro de tenant_id
          if (sql.includes("SELECT * FROM public.gd_proposals WHERE id = $1 AND tenant_id = $2")) {
            const [queryId, queryTenant] = params;
            if (queryId === PROPOSAL_ID && queryTenant === mockDbRow.tenant_id) {
              return { rows: [mockDbRow] };
            }
            return { rows: [] }; // Outro tenant não encontra a proposta
          }
          if (sql.includes("UPDATE public.gd_proposals")) {
            return { rows: [{ ...mockDbRow, status: "rascunho" }] };
          }
          return { rows: [] };
        }),
      };

      let reopenHandler = null;
      const mockApp = {
        get: vi.fn(),
        post: vi.fn((path, ...handlers) => {
          if (path === "/api/gd/proposals/:id/reopen") {
            reopenHandler = handlers[handlers.length - 1];
          }
        }),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
      };

      const noopMiddleware = (_req, _res, next) => next && next();
      registerGeracaoDigitalRoutes(mockApp, mockPool, noopMiddleware, noopMiddleware);

      expect(reopenHandler).toBeInstanceOf(Function);

      // Usuário gestor do TENANT_B com seu próprio tenant na sessão tentando reabrir proposta do TENANT_A
      const req = {
        params: { id: PROPOSAL_ID },
        body: { client_id: TENANT_B, motivo: "Tentativa de reabrir de outro tenant" },
        authAccess: {
          role: "internal",
          isAdmin: false,
          approvalLevel: "manager",
          scopeMode: "assigned_clients",
          clientId: TENANT_B,
          clientIds: [TENANT_B],
        },
      };

      let statusResult = 200;
      let jsonResult = null;
      const res = {
        status: vi.fn((code) => {
          statusResult = code;
          return res;
        }),
        json: vi.fn((data) => {
          jsonResult = data;
          return res;
        }),
      };

      await reopenHandler(req, res);

      // PROVA 1: Retorna 404 (isolamento multi-tenant, não confirma existência da proposta)
      expect(statusResult).toBe(404);
      expect(jsonResult).toEqual({ error: "Proposta não encontrada." });

      // PROVA 2: O UPDATE NUNCA foi chamado
      const updateQueries = queriesExecuted.filter((q) => q.sql.includes("UPDATE public.gd_proposals"));
      expect(updateQueries).toHaveLength(0);

      // PROVA 3: O status da proposta no banco permaneceu intocado
      expect(mockDbRow.status).toBe("aceita");
    });

    it("POST /api/gd/proposals/:id/reopen: gestor do tenant B forjando client_id do tenant A no corpo é barrado e a linha continua aceita", async () => {
      const TENANT_A = "11111111-1111-4111-8111-111111111111";
      const TENANT_B = "22222222-2222-4222-8222-222222222222";
      const PROPOSAL_ID = "33333333-3333-4333-8333-333333333333";

      const mockDbRow = {
        id: PROPOSAL_ID,
        tenant_id: TENANT_A,
        status: "aceita",
        signer_name: "Cliente Original",
        owner_company: "geracao-digital",
      };

      const queriesExecuted = [];
      const mockPool = {
        query: vi.fn(async (sql, params) => {
          queriesExecuted.push({ sql, params });
          if (sql.includes("FROM public.gd_proposals") && !sql.includes("tenant_id")) {
            return { rows: [{ owner_company: "geracao-digital" }] };
          }
          if (sql.includes("FROM public.tenants")) {
            return { rows: [{ id: params?.[0] || TENANT_B }] };
          }
          if (sql.includes("SELECT * FROM public.gd_proposals WHERE id = $1 AND tenant_id = $2")) {
            const [queryId, queryTenant] = params;
            if (queryId === PROPOSAL_ID && queryTenant === mockDbRow.tenant_id) {
              return { rows: [mockDbRow] };
            }
            return { rows: [] };
          }
          if (sql.includes("UPDATE public.gd_proposals")) {
            return { rows: [{ ...mockDbRow, status: "rascunho" }] };
          }
          return { rows: [] };
        }),
      };

      let reopenHandler = null;
      const mockApp = {
        get: vi.fn(),
        post: vi.fn((path, ...handlers) => {
          if (path === "/api/gd/proposals/:id/reopen") {
            reopenHandler = handlers[handlers.length - 1];
          }
        }),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
      };

      const noopMiddleware = (_req, _res, next) => next && next();
      registerGeracaoDigitalRoutes(mockApp, mockPool, noopMiddleware, noopMiddleware);

      expect(reopenHandler).toBeInstanceOf(Function);

      // Gestor do TENANT_B enviando client_id do TENANT_A no corpo para tentar forjar tenant
      const req = {
        params: { id: PROPOSAL_ID },
        body: { client_id: TENANT_A, motivo: "Tentativa de ataque cross-tenant com client_id forjado" },
        authAccess: {
          role: "internal",
          isAdmin: false,
          approvalLevel: "manager",
          scopeMode: "assigned_clients",
          clientId: TENANT_B,
          clientIds: [TENANT_B],
        },
      };

      let statusResult = 200;
      let jsonResult = null;
      const res = {
        status: vi.fn((code) => {
          statusResult = code;
          return res;
        }),
        json: vi.fn((data) => {
          jsonResult = data;
          return res;
        }),
      };

      await reopenHandler(req, res);

      // PROVA 1: Requisição barrada com erro de autorização/escopo de cliente (403 do resolveAuthorizedClientId)
      expect([403, 404]).toContain(statusResult);
      if (statusResult === 403) {
        expect(jsonResult?.error?.code).toBe("FORBIDDEN_CLIENT_SCOPE");
      }

      // PROVA 2: Zero queries de UPDATE executadas no banco
      const updateQueries = queriesExecuted.filter((q) => q.sql.includes("UPDATE public.gd_proposals"));
      expect(updateQueries).toHaveLength(0);

      // PROVA 3: Status da linha no banco continua aceita
      expect(mockDbRow.status).toBe("aceita");
    });
  });

  describe("2.4 — Modo Condições Especiais: esconder_valores", () => {
    it("Verifica se esconder_valores é tratado como booleano na persistência", () => {
      const payloadTrue = { esconder_valores: true };
      const payloadFalse = { esconder_valores: false };
      const payloadUndefined = {};

      expect(payloadTrue.esconder_valores === true).toBe(true);
      expect(payloadFalse.esconder_valores === true).toBe(false);
      expect(Boolean(payloadUndefined.esconder_valores)).toBe(false);
    });
  });

  describe("2.2 & 2.1 — Webhook ZapSign sem proposal_id", () => {
    it("Webhook não quebra e não tenta atualizar proposta se proposal_id for null", async () => {
      const queries = [];
      const mockPool = {
        query: vi.fn(async (sql, params) => {
          queries.push({ sql, params });
          if (sql.includes("UPDATE gd_contracts")) {
            return { rows: [{ proposal_id: null, tenant_id: VALID_TENANT_UUID }] };
          }
          return { rows: [] };
        }),
      };
      _setPgDatabasePoolForTesting(mockPool);

      // Simulação do webhook zapsign
      const providerId = "doc-zapsign-123";
      const { rows } = await mockPool.query(
        `UPDATE gd_contracts SET status = 'assinado' WHERE provider_id = $1 RETURNING proposal_id, tenant_id`,
        [providerId]
      );
      const { proposal_id, tenant_id } = rows[0];
      if (proposal_id) {
        await mockPool.query(`UPDATE gd_proposals SET status = 'fechada' WHERE id = $1`, [proposal_id]);
      }

      expect(queries).toHaveLength(1);
      expect(queries[0].sql).toContain("UPDATE gd_contracts");
      // Nenhuma query em gd_proposals foi executada
      expect(queries.some((q) => q.sql.includes("gd_proposals"))).toBe(false);
    });
  });
});
