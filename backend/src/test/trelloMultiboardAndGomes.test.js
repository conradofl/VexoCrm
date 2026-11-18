import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveTrelloBoard,
  ensureHeloisaList,
  cloneBoardBaseForNewClient,
  createTrelloCard,
} from "../services/trelloService.js";
import {
  executarAbrirCardTrello,
  executarGerarContratoGomes,
  executarOnboardingCliente,
  HELOISA_TOOLS,
} from "../domains/goclaw/heloisaEngine.js";
import {
  processGdDisjuntorContratoCheckJob,
} from "../followup/worker.js";
import * as followupQueueModule from "../followup/queue.js";

describe("Roteamento Multiquadro do Trello, Coluna Heloísa, Gomes e Disjuntor", () => {
  let mockQueue;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQueue = {
      add: vi.fn().mockResolvedValue({ id: "job-trello-multiboard" }),
    };
    vi.spyOn(followupQueueModule, "getFollowupQueue").mockReturnValue(mockQueue);
  });

  describe("1. Roteamento Multiquadro do Trello & Coluna Heloísa (trelloService)", () => {
    it("resolveTrelloBoard extrai shortLink de URLs do Trello ou usa o ID fornecido diretamente", async () => {
      // Caso 1: URL completa do quadro Geração Digital de Conrado
      const board1 = await resolveTrelloBoard({
        boardIdOrUrl: "https://trello.com/b/oLurW041/geracao-digital",
      });
      expect(board1).toBe("oLurW041");

      // Caso 2: ShortLink puro
      const board2 = await resolveTrelloBoard({
        boardIdOrUrl: "oLurW041",
      });
      expect(board2).toBe("oLurW041");
    });

    it("resolveTrelloBoard busca quadros da workspace socialmediagdigital pelo nome do cliente", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
        if (String(url).includes("/organizations/socialmediagdigital/boards")) {
          return {
            ok: true,
            json: async () => [
              { id: "board_cafeeiro_123", name: "Cafeeiro Cafés Especiais", shortLink: "cAf331r0" },
              { id: "board_carvalho_456", name: "Carvalho Pinturas", shortLink: "cArv4lh0" },
              { id: "board_gd_789", name: "Geração Digital", shortLink: "oLurW041" },
            ],
          };
        }
        return { ok: true, json: async () => ({}) };
      });

      const boardCafeeiro = await resolveTrelloBoard({
        clientName: "Cafeeiro",
      });
      expect(boardCafeeiro).toBe("board_cafeeiro_123");

      const boardCarvalho = await resolveTrelloBoard({
        clientName: "Carvalho Pinturas",
      });
      expect(boardCarvalho).toBe("board_carvalho_456");

      fetchSpy.mockRestore();
    });

    it("ensureHeloisaList encontra lista existente ou cria automaticamente a coluna 'Heloísa'", async () => {
      let postListCalled = false;
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
        const u = String(url);
        if (u.includes("/boards/board_sem_heloisa/lists") && opts?.method === "POST") {
          postListCalled = true;
          return {
            ok: true,
            json: async () => ({ id: "list_heloisa_nova", name: "Heloísa" }),
          };
        }
        if (u.includes("/boards/board_sem_heloisa/lists")) {
          return {
            ok: true,
            json: async () => [
              { id: "list_prod", name: "Em Produção" },
              { id: "list_aprov", name: "Aguardando Aprovação" },
            ],
          };
        }
        return { ok: true, json: async () => [] };
      });

      const res = await ensureHeloisaList({ boardId: "board_sem_heloisa" });

      expect(res.name).toBe("Heloísa");
      expect(res.id).toBe("list_heloisa_nova");
      expect(postListCalled).toBe(true);

      fetchSpy.mockRestore();
    });

    it("cloneBoardBaseForNewClient clona o Board Base (TEMPLATE) para uma nova empresa na workspace", async () => {
      let clonePostCalled = false;
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
        const u = String(url);
        if (u.includes("/organizations/socialmediagdigital/boards")) {
          return {
            ok: true,
            json: async () => [
              { id: "template_board_base_id", name: "Board Base (TEMPLATE)" },
            ],
          };
        }
        if (u.includes("https://api.trello.com/1/boards") && opts?.method === "POST") {
          clonePostCalled = true;
          return {
            ok: true,
            json: async () => ({
              id: "new_board_novo_cliente",
              name: "Restaurante Sabor Real",
              shortUrl: "https://trello.com/b/s4b0r123/restaurante-sabor-real",
              url: "https://trello.com/b/s4b0r123/restaurante-sabor-real",
            }),
          };
        }
        if (u.includes("/lists")) {
          return {
            ok: true,
            json: async () => [{ id: "list_heloisa_id", name: "Heloísa" }],
          };
        }
        return { ok: true, json: async () => ({}) };
      });

      const newBoard = await cloneBoardBaseForNewClient({
        clientName: "Restaurante Sabor Real",
      });

      expect(clonePostCalled).toBe(true);
      expect(newBoard.id).toBe("new_board_novo_cliente");
      expect(newBoard.name).toBe("Restaurante Sabor Real");

      fetchSpy.mockRestore();
    });
  });

  describe("2. Caso Real do Conrado: Criar card no quadro oLurW041 na coluna Aguardando Aprovação", () => {
    it("mapeia lista 'aprovação' para 'Aguardando Aprovação' no quadro oLurW041 e atribui ao Santana", async () => {
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql) => {
          if (sql.includes("gd_colaboradores")) {
            return {
              rows: [
                {
                  id: "colab-santana",
                  nome: "Santana",
                  funcao: "Diretor de arte",
                  telefone: "5516982447360",
                  trello_username: "felipesantanamoraes",
                  ativo: true,
                },
              ],
            };
          }
          if (sql.includes("gd_trello_card_monitors")) {
            return { rows: [{ id: "mon-conrado-1" }] };
          }
          return { rows: [] };
        }),
      };

      let cardCreatedPayload = null;
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
        const u = String(url);
        if (u.includes("/boards/oLurW041/lists")) {
          return {
            ok: true,
            json: async () => [
              { id: "list_backlog", name: "Backlog & Briefings" },
              { id: "list_prod", name: "Em Produção / Design" },
              { id: "list_aprov_gd", name: "Aguardando Aprovação" },
              { id: "list_concluido", name: "Entregue & Concluído" },
            ],
          };
        }
        if (u.includes("/boards/oLurW041/members")) {
          return {
            ok: true,
            json: async () => [
              { id: "mem_santana_id", username: "felipesantanamoraes", fullName: "Felipe Santana" },
            ],
          };
        }
        if (u.includes("/cards") && opts?.method === "POST") {
          cardCreatedPayload = JSON.parse(opts.body);
          return {
            ok: true,
            json: async () => ({
              id: "card_teste_conrado",
              name: cardCreatedPayload.name,
              due: cardCreatedPayload.due,
              idList: cardCreatedPayload.idList,
              idMembers: cardCreatedPayload.idMembers,
              shortUrl: "https://trello.com/c/oLurW041test",
            }),
          };
        }
        return { ok: true, json: async () => ({}) };
      });

      // Execução da tool pelo diretor Conrado
      const res = await executarAbrirCardTrello(
        {
          titulo: "teste",
          descricao: "Card de teste no quadro da GD",
          responsavel: "Santana",
          prazo: "20/11 às 18h",
          lista_destino: "aprovação",
          empresa: "https://trello.com/b/oLurW041/geracao-digital",
          tipo_demanda: "arte",
        },
        mockPool,
        "vexo-adm-vexo-atende",
        { nome: "Conrado Finzi", papel: "Diretor TI & Produto", telefone: "5534997817660" }
      );

      expect(res.sucesso).toBe(true);
      expect(res.cardId).toBe("card_teste_conrado");
      expect(res.colaborador).toBe("Santana");
      expect(cardCreatedPayload.name).toBe("teste");
      // Deve ter selecionado a lista Aguardando Aprovação
      expect(cardCreatedPayload.idList).toBe("list_aprov_gd");
      expect(cardCreatedPayload.idMembers).toContain("mem_santana_id");
      expect(cardCreatedPayload.due).toContain("2026-11-20");

      fetchSpy.mockRestore();
    });
  });

  describe("3. Gomes (Cartório & Contratos) - Sem Slack, Notificando Caio no WhatsApp", () => {
    it("gera minuta de contrato, publica no grupo PASTA do WhatsApp e notifica Caio no privado", async () => {
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql) => {
          if (sql.includes("gd_clientes")) {
            return {
              rows: [
                {
                  id: "cli-almeida-uuid",
                  nome: "Almeida Advocacia",
                  empresa: "Almeida & Associados",
                  valor: 3500,
                  escopo: "Gestão de Tráfego e Social Media",
                  grupo_interno_jid: "120363001@g.us",
                  aprovador_nome: "Dr. Roberto Almeida",
                  telefone: "5534991112222",
                },
              ],
            };
          }
          return { rows: [] };
        }),
      };

      const res = await executarGerarContratoGomes(
        {
          cliente_nome: "Almeida Advocacia",
          valor: 3500,
          escopo: "Gestão de Tráfego e Social Media",
        },
        mockPool,
        "heloisa",
        { nome: "Conrado Finzi", telefone: "5534997817660" }
      );

      expect(res.sucesso).toBe(true);
      expect(res.enviadoGrupoPasta).toBe(true);
      expect(res.notificadoCaio).toBe(true);
      expect(res.contratoTexto).toContain("PROPOSTA & MINUTA CONTRATUAL");
      expect(res.contratoTexto).toContain("Almeida Advocacia");
      expect(res.contratoTexto).toContain("R$ 3.500");
    });
  });

  describe("4. Disjuntor de 4 Dias do Caio (BullMQ Worker)", () => {
    it("alerta Caio no WhatsApp se após 4 dias úteis o contrato/pagamento ainda estiver pendente", async () => {
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql) => {
          if (sql.includes("gd_clientes")) {
            return {
              rows: [
                {
                  id: "cli-inadimplente-uuid",
                  nome: "Ótica Visão Prime",
                  status_pagamento: "pendente",
                  contrato_assinado: false,
                  valor: 2800,
                },
              ],
            };
          }
          return { rows: [] };
        }),
      };

      const job = {
        data: {
          clienteId: "cli-inadimplente-uuid",
          clienteNome: "Ótica Visão Prime",
          valor: 2800,
        },
      };

      const result = await processGdDisjuntorContratoCheckJob(job, mockPool);

      expect(result.regularizado).toBe(false);
      expect(result.alertaDisjuntorEnviado).toBe(true);
      expect(result.mensagemCaio).toContain("Disjuntor de 4 Dias");
      expect(result.mensagemCaio).toContain("Ótica Visão Prime");
    });

    it("cancela alerta se o cliente já tiver pago ou assinado o contrato", async () => {
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql) => {
          if (sql.includes("gd_clientes")) {
            return {
              rows: [
                {
                  id: "cli-pago-uuid",
                  nome: "Clínica Odonto Prime",
                  status_pagamento: "pago",
                  contrato_assinado: true,
                },
              ],
            };
          }
          return { rows: [] };
        }),
      };

      const job = {
        data: {
          clienteId: "cli-pago-uuid",
          clienteNome: "Clínica Odonto Prime",
        },
      };

      const result = await processGdDisjuntorContratoCheckJob(job, mockPool);

      expect(result.regularizado).toBe(true);
      expect(result.alertaDisjuntorEnviado).toBe(false);
    });

    it("executarOnboardingCliente enfileira job gd-disjuntor-contrato-check com delay de 4 dias", async () => {
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql) => {
          if (sql.includes("gd_clientes")) {
            return {
              rows: [
                {
                  id: "cli-onboarding-disjuntor-uuid",
                  nome: "Supermercado Bom Preço",
                  telefone: "5534991113333",
                  valor: 4500,
                },
              ],
            };
          }
          if (sql.includes("gd_colaboradores")) {
            return { rows: [] };
          }
          return { rows: [] };
        }),
      };

      await executarOnboardingCliente(
        { cliente_nome: "Supermercado Bom Preço" },
        mockPool,
        "heloisa",
        { nome: "Conrado Finzi" }
      );

      const disjuntorCall = mockQueue.add.mock.calls.find(
        (c) => c[0] === "gd-disjuntor-contrato-check"
      );

      expect(disjuntorCall).toBeDefined();
      expect(disjuntorCall[1].clienteId).toBe("cli-onboarding-disjuntor-uuid");
      expect(disjuntorCall[1].clienteNome).toBe("Supermercado Bom Preço");
      expect(disjuntorCall[1].valor).toBe(4500);
      expect(disjuntorCall[2].delay).toBe(4 * 24 * 3600 * 1000);
    });
  });
});
