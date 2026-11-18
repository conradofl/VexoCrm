import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createTrelloCard,
  getTrelloCardStatus,
  isCardInApprovalOrDone,
  parsePrazoTrello,
  calculateTrelloMarcoDelays,
} from "../services/trelloService.js";
import {
  executarAbrirCardTrello,
  executarOnboardingCliente,
} from "../domains/goclaw/heloisaEngine.js";
import {
  processTrelloCardFollowupCheckJob,
} from "../followup/worker.js";
import * as followupQueueModule from "../followup/queue.js";

describe("Tool abrir_card_trello e Régua de Cobrança Condicional (Trello)", () => {
  let mockQueue;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQueue = {
      add: vi.fn().mockResolvedValue({ id: "job-trello-123" }),
    };
    vi.spyOn(followupQueueModule, "getFollowupQueue").mockReturnValue(mockQueue);
  });

  describe("Serviço Trello (trelloService)", () => {
    it("parsePrazoTrello converte linguagem natural para formato ISO no fuso de Brasília (-03:00)", () => {
      // Fixa data de referência: quarta-feira, 18/11/2026 10:00:00 -03:00
      const refDate = new Date("2026-11-18T10:00:00-03:00");

      const isoSexta = parsePrazoTrello("sexta às 18h", refDate);
      expect(isoSexta).toContain("2026-11-20T18:00:00");
      expect(isoSexta).toContain("-03:00");

      const isoData = parsePrazoTrello("21/11 às 17h", refDate);
      expect(isoData).toContain("2026-11-21T17:00:00");
      expect(isoData).toContain("-03:00");

      const isoAmanha = parsePrazoTrello("amanhã às 15:30", refDate);
      expect(isoAmanha).toContain("2026-11-19T15:30:00");
    });

    it("isCardInApprovalOrDone identifica corretamente status de aprovação ou conclusão", () => {
      // Lista de aprovação
      expect(isCardInApprovalOrDone({ listName: "Aguardando Aprovação do Cliente", dueComplete: false })).toBe(true);
      expect(isCardInApprovalOrDone({ listName: "Para Aprovar", dueComplete: false })).toBe(true);
      expect(isCardInApprovalOrDone({ listName: "Aprovado", dueComplete: false })).toBe(true);
      // Lista de conclusão ou flag dueComplete
      expect(isCardInApprovalOrDone({ listName: "Entregue & Concluído", dueComplete: false })).toBe(true);
      expect(isCardInApprovalOrDone({ listName: "Em Produção / Design", dueComplete: true })).toBe(true);

      // Em produção / backlog sem aprovação
      expect(isCardInApprovalOrDone({ listName: "Em Produção / Design", dueComplete: false })).toBe(false);
      expect(isCardInApprovalOrDone({ listName: "Backlog & Briefings", dueComplete: false })).toBe(false);
    });

    it("calculateTrelloMarcoDelays calcula marcos D-2, D-1 e D-0 corretamente", () => {
      const now = new Date("2026-11-18T10:00:00-03:00");
      // Prazo para 21/11 às 18:00 (3 dias depois)
      const dueDate = new Date("2026-11-21T18:00:00-03:00");

      const marcos = calculateTrelloMarcoDelays(dueDate, now);
      const nomes = marcos.map((m) => m.marco);

      expect(nomes).toContain("D-2");
      expect(nomes).toContain("D-1");
      expect(nomes).toContain("D-0");
    });

    it("createTrelloCard cria o card no Trello com payload correto e converte data para UTC", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
        const u = String(url);
        if (u.includes("/lists")) {
          return {
            ok: true,
            json: async () => [
              { id: "list_prod", name: "Em Produção / Design" },
              { id: "list_backlog", name: "Backlog & Briefings" },
            ],
          };
        }
        if (u.includes("/members")) {
          return {
            ok: true,
            json: async () => [
              { id: "mem_santana", username: "felipesantanamoraes", fullName: "Felipe Santana" },
            ],
          };
        }
        if (u.includes("/cards") && opts?.method === "POST") {
          const body = JSON.parse(opts.body);
          return {
            ok: true,
            json: async () => ({
              id: "card_123",
              name: body.name,
              desc: body.desc,
              due: body.due,
              idList: body.idList,
              idMembers: body.idMembers,
              shortUrl: "https://trello.com/c/abc12345",
            }),
          };
        }
        return { ok: true, json: async () => ({}) };
      });

      const res = await createTrelloCard({
        name: "Carrossel Dr. Roberto",
        desc: "Briefing do post no Drive",
        listName: "Em Produção / Design",
        dueDate: "2026-11-20T18:00:00-03:00",
        memberUsername: "felipesantanamoraes",
        apiKey: "fake_key",
        token: "fake_token",
        boardId: "fake_board",
      });

      expect(res.id).toBe("card_123");
      expect(res.shortUrl).toBe("https://trello.com/c/abc12345");
      expect(res.due).toBe(new Date("2026-11-20T18:00:00-03:00").toISOString());

      fetchSpy.mockRestore();
    });
  });

  describe("Tool da Heloísa: executarAbrirCardTrello", () => {
    it("localiza colaborador em gd_colaboradores, cria card e dispara WhatsApp imediato", async () => {
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql, params) => {
          const s = String(sql).toLowerCase();
          if (s.includes("from public.gd_colaboradores")) {
            return {
              rows: [
                {
                  id: "colab-santana-uuid",
                  nome: "Santana",
                  funcao: "Diretor de arte",
                  telefone: "5516982447360",
                  trello_username: "felipesantanamoraes",
                  recebe_cobranca_whatsapp: true,
                  ativo: true,
                },
              ],
            };
          }
          if (s.includes("insert into public.gd_trello_card_monitors")) {
            return {
              rows: [
                {
                  id: "mon-uuid-1",
                  trello_card_id: params[0],
                  colaborador_nome: params[3],
                },
              ],
            };
          }
          return { rows: [] };
        }),
      };

      // Mock fetch do Trello
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
        const u = String(url);
        if (u.includes("/lists")) {
          return {
            ok: true,
            json: async () => [{ id: "list_prod", name: "Em Produção / Design" }],
          };
        }
        if (u.includes("/members")) {
          return {
            ok: true,
            json: async () => [{ id: "mem_santana", username: "felipesantanamoraes" }],
          };
        }
        if (u.includes("/cards")) {
          return {
            ok: true,
            json: async () => ({
              id: "card_santana_999",
              shortUrl: "https://trello.com/c/santana999",
              name: "Post Dra. Ana",
              due: new Date("2026-11-20T18:00:00-03:00").toISOString(),
            }),
          };
        }
        return { ok: true, json: async () => ({}) };
      });

      const res = await executarAbrirCardTrello(
        {
          titulo: "Post Dra. Ana",
          descricao: "Artes do feed e stories",
          responsavel: "Santana",
          prazo: "sexta às 18h",
          lista_destino: "Em Produção / Design",
        },
        mockPool,
        "vexo-adm-vexo-atende",
        { nome: "Conrado Finzi", papel: "Diretor", telefone: "5534997817660" }
      );

      expect(res.sucesso).toBe(true);
      expect(res.cardId).toBe("card_santana_999");
      expect(res.cardUrl).toBe("https://trello.com/c/santana999");
      expect(res.colaborador).toBe("Santana");
      expect(res.notificacaoWhatsappEnviada).toBe(true);

      // Verifica inserção na tabela de monitoramento
      const insertCalls = mockPool.query.mock.calls.filter((c) =>
        String(c[0]).toLowerCase().includes("insert into public.gd_trello_card_monitors")
      );
      expect(insertCalls.length).toBe(1);
      expect(insertCalls[0][1][0]).toBe("card_santana_999"); // trello_card_id
      expect(insertCalls[0][1][1]).toBe("https://trello.com/c/santana999"); // trello_card_url
      expect(insertCalls[0][1][2]).toBe("Post Dra. Ana"); // titulo
      expect(insertCalls[0][1][4]).toBe("Santana"); // colaborador_nome
      expect(insertCalls[0][1][5]).toBe("5516982447360"); // colaborador_telefone

      // Verifica agendamento dos jobs na fila BullMQ
      expect(mockQueue.add).toHaveBeenCalled();
      const firstQueueCall = mockQueue.add.mock.calls[0];
      expect(firstQueueCall[0]).toBe("trello-card-followup-check");
      expect(firstQueueCall[1].cardId).toBe("card_santana_999");
      expect(firstQueueCall[1].colaboradorNome).toBe("Santana");

      fetchSpy.mockRestore();
    });

    it("permite criação automática do card no Trello ao concluir onboarding com criar_card_trello=true", async () => {
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql) => {
          const s = String(sql).toLowerCase();
          if (s.includes("from public.gd_clientes")) {
            return {
              rows: [{ id: "cli-123", nome: "Cliente Teste Trello", empresa: "Empresa Teste", telefone: "5534999991111" }],
            };
          }
          if (s.includes("from public.gd_colaboradores")) {
            return {
              rows: [{ nome: "Gabriel", funcao: "Gestor de operações", telefone: "5534996916397", trello_username: "gabriel", ativo: true }],
            };
          }
          return { rows: [] };
        }),
      };

      const res = await executarOnboardingCliente(
        { cliente_nome: "Cliente Teste Trello", criar_card_trello: true },
        mockPool,
        "heloisa",
        { nome: "Conrado Finzi", telefone: "5534997817660" }
      );

      expect(res.sucesso).toBe(true);
      expect(res.trello_card).toBeDefined();
      expect(res.trello_card.sucesso).toBe(true);
      expect(res.trello_card.colaborador).toBe("Gabriel");
    });
  });

  describe("Worker de Cobrança Condicional: processTrelloCardFollowupCheckJob", () => {
    it("SUPRIME cobrança se o card estiver em lista de aprovação ou concluído (REGRA DE OURO)", async () => {
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql) => {
          const s = String(sql).toLowerCase();
          if (s.includes("from public.gd_trello_card_monitors")) {
            return {
              rows: [
                {
                  id: "mon-1",
                  trello_card_id: "card_aprov_1",
                  titulo: "Identidade Visual Vexo",
                  colaborador_nome: "Santana",
                  colaborador_telefone: "5516982447360",
                  due_date: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
                  cobranca_d2_enviada: false,
                },
              ],
            };
          }
          return { rows: [] };
        }),
      };

      // Trello API retorna que o card já está na lista "Aguardando Aprovação do Cliente"
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        return {
          ok: true,
          json: async () => ({
            id: "card_aprov_1",
            name: "Identidade Visual Vexo",
            dueComplete: false,
            idList: "list_aprov",
            list: { name: "Aguardando Aprovação do Cliente" },
          }),
        };
      });

      const job = {
        data: {
          cardId: "card_aprov_1",
          marco: "D-2",
        },
      };

      const result = await processTrelloCardFollowupCheckJob(job, mockPool);

      expect(result.cobrancaDispensada).toBe(true);
      expect(result.cobrancaEnviada).toBe(false);

      fetchSpy.mockRestore();
    });

    it("DISPARA cobrança se o card ainda estiver em produção/backlog em D-2, D-1 ou D-0", async () => {
      let updateExecuted = false;
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql) => {
          const s = String(sql).toLowerCase();
          if (s.includes("from public.gd_trello_card_monitors")) {
            return {
              rows: [
                {
                  id: "mon-2",
                  trello_card_id: "card_prod_1",
                  titulo: "Vídeo Reel Institucional",
                  colaborador_nome: "Éflen",
                  colaborador_telefone: "5534991531361",
                  due_date: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
                  cobranca_d1_enviada: false,
                },
              ],
            };
          }
          if (s.includes("update public.gd_trello_card_monitors")) {
            updateExecuted = true;
            return { rows: [] };
          }
          return { rows: [] };
        }),
      };

      // Trello API retorna card ainda em lista de produção
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        return {
          ok: true,
          json: async () => ({
            id: "card_prod_1",
            name: "Vídeo Reel Institucional",
            dueComplete: false,
            idList: "list_prod",
            list: { name: "Em Produção / Design" },
          }),
        };
      });

      const job = {
        data: {
          cardId: "card_prod_1",
          marco: "D-1",
        },
      };

      const result = await processTrelloCardFollowupCheckJob(job, mockPool);

      expect(result.cobrancaDispensada).toBe(false);
      expect(result.cobrancaEnviada).toBe(true);
      expect(result.marco).toBe("D-1");
      expect(result.mensagem).toContain("Se precisar de apoio ou estiver travado, avise aqui!");
      expect(updateExecuted).toBe(true);

      fetchSpy.mockRestore();
    });

    it("localiza o monitor pelo monitorId UUID no banco de dados para D-0", async () => {
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql) => {
          if (sql.includes("gd_trello_card_monitors")) {
            return {
              rows: [
                {
                  id: "mon-uuid-custom",
                  trello_card_id: "card_uuid_1",
                  titulo: "Campanha Black Friday",
                  colaborador_nome: "Humberto",
                  colaborador_telefone: "5534992223651",
                  due_date: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
                  cobranca_d0_enviada: false,
                },
              ],
            };
          }
          return { rows: [] };
        }),
      };

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
        ok: true,
        json: async () => ({
          id: "card_uuid_1",
          name: "Campanha Black Friday",
          dueComplete: false,
          idList: "list_prod",
          list: { name: "Em Produção / Design" },
        }),
      }));

      const job = {
        data: {
          cardId: "card_uuid_1",
          monitorId: "mon-uuid-custom",
          marco: "D-0",
        },
      };

      const result = await processTrelloCardFollowupCheckJob(job, mockPool);

      expect(result.cobrancaEnviada).toBe(true);
      expect(result.marco).toBe("D-0");
      expect(result.colaborador).toBe("Humberto");
      expect(result.mensagem).toContain("hoje é o dia de entrega da demanda *Campanha Black Friday*");

      fetchSpy.mockRestore();
    });
  });
});
