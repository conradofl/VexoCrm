import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executarGerarContratoGomes,
  processarComandoHeloisa,
  HELOISA_TOOLS,
} from "../domains/goclaw/heloisaEngine.js";
import { processGdDisjuntorContratoCheckJob } from "../followup/worker.js";
import * as followupQueueModule from "../followup/queue.js";
import * as evolutionModule from "../services/evolution.js";

describe("Gomes (Cartório & Contratos) - Formalização, Assinatura WhatsApp e Disjuntor de 4 Dias", () => {
  let mockQueue;
  let whatsappDispatches;

  beforeEach(() => {
    vi.clearAllMocks();
    whatsappDispatches = [];

    mockQueue = {
      add: vi.fn().mockResolvedValue({ id: "job-disjuntor-123" }),
    };
    vi.spyOn(followupQueueModule, "getFollowupQueue").mockReturnValue(mockQueue);

    vi.spyOn(evolutionModule, "sendTextMessageViaEvolution").mockImplementation(
      async ({ number, text }) => {
        whatsappDispatches.push({ number, text });
        return { success: true };
      }
    );
  });

  describe("1. Persistência em public.gd_contracts e public.gd_clientes", () => {
    it("insere contrato formal em gd_contracts e atualiza gd_clientes para 'em_contrato' com contract_id", async () => {
      const executedSqls = [];
      const executedParams = [];

      const mockCliente = {
        id: "cli-odonto-uuid",
        nome: "Odonto Prime",
        empresa: "Odonto Prime Ltda",
        valor: 3500,
        escopo: "Gestão de Tráfego Pago & IA",
        grupo_interno_jid: "120363001@g.us",
        aprovador_nome: "Dra. Juliana",
        telefone: "5534991114444",
        estado: "onboarding",
      };

      const mockContract = {
        id: "contract-odonto-uuid-777",
        tenant_id: "00000000-0000-0000-0000-000000000000",
        status: "aguardando_assinatura",
        owner_company: "geracao-digital",
        dados: {
          cliente_nome: "Odonto Prime",
          valor: 3500,
          escopo: "Gestão de Tráfego Pago & IA",
          vencimento: 10,
          vigencia: "12 meses",
          responsavel: "Dra. Juliana",
        },
      };

      const mockPool = {
        query: vi.fn().mockImplementation(async (sql, params) => {
          executedSqls.push(sql);
          executedParams.push(params);

          // 1. Busca cliente existente
          if (sql.includes("SELECT") && sql.includes("public.gd_clientes")) {
            return { rows: [mockCliente] };
          }
          // 2. Busca tenant da GD
          if (sql.includes("SELECT") && sql.includes("public.tenants")) {
            return { rows: [{ id: "tenant-gd-uuid-999" }] };
          }
          // 3. Inserção em gd_contracts
          if (sql.includes("INSERT INTO public.gd_contracts")) {
            return { rows: [mockContract] };
          }
          // 4. Update em gd_clientes
          if (sql.includes("UPDATE public.gd_clientes")) {
            return { rowCount: 1 };
          }
          return { rows: [] };
        }),
      };

      const res = await executarGerarContratoGomes(
        {
          cliente_nome: "Odonto Prime",
          valor: 3500,
          escopo: "Gestão de Tráfego Pago & IA",
          aprovador_nome: "Dra. Juliana",
        },
        mockPool,
        "vexo-adm-vexo-atende",
        { nome: "Conrado Finzi", telefone: "5534997817660", papel: "Diretor" }
      );

      expect(res.sucesso).toBe(true);
      expect(res.clienteId).toBe("cli-odonto-uuid");
      expect(res.contractId).toBe("contract-odonto-uuid-777");

      // Verifica inserção em gd_contracts
      const insertContractSql = executedSqls.find((s) => s.includes("INSERT INTO public.gd_contracts"));
      expect(insertContractSql).toBeDefined();
      expect(insertContractSql).toContain("status");
      expect(insertContractSql).toContain("owner_company");

      // Verifica atualização em gd_clientes
      const updateClienteSql = executedSqls.find((s) => s.includes("UPDATE public.gd_clientes"));
      expect(updateClienteSql).toBeDefined();
      expect(updateClienteSql).toContain("estado = 'em_contrato'");
      expect(updateClienteSql).toMatch(/contract_id\s*=\s*\$1|contrato_id\s*=\s*\$1/);
      expect(updateClienteSql).toContain("contrato_assinado = false");
    });

    it("realiza pré-cadastro básico em gd_clientes se o cliente ainda não existir no CRM", async () => {
      const executedSqls = [];
      let insertClienteCalled = false;

      const mockContract = {
        id: "contract-novo-cli-555",
        status: "aguardando_assinatura",
        owner_company: "geracao-digital",
      };

      const mockPool = {
        query: vi.fn().mockImplementation(async (sql, params) => {
          executedSqls.push(sql);

          // Busca cliente: não encontra
          if (sql.includes("SELECT") && sql.includes("public.gd_clientes")) {
            return { rows: [] };
          }
          if (sql.includes("SELECT") && sql.includes("public.tenants")) {
            return { rows: [{ id: "tenant-gd-uuid-999" }] };
          }
          if (sql.includes("INSERT INTO public.gd_contracts")) {
            return { rows: [mockContract] };
          }
          if (sql.includes("INSERT INTO public.gd_clientes")) {
            insertClienteCalled = true;
            return {
              rows: [
                {
                  id: "cli-novo-gerado-uuid",
                  nome: "Barbearia Vintage",
                  valor: 2500,
                  estado: "em_contrato",
                  contract_id: mockContract.id,
                  contrato_assinado: false,
                },
              ],
            };
          }
          return { rows: [] };
        }),
      };

      const res = await executarGerarContratoGomes(
        {
          cliente_nome: "Barbearia Vintage",
          valor: 2500,
          escopo: "Social Media & Tráfego Local",
        },
        mockPool
      );

      expect(res.sucesso).toBe(true);
      expect(insertClienteCalled).toBe(true);
      const insertClienteSql = executedSqls.find((s) => s.includes("INSERT INTO public.gd_clientes"));
      expect(insertClienteSql).toContain("nome");
      expect(insertClienteSql).toContain("valor");
      expect(insertClienteSql).toMatch(/contract_id|contrato_id/);
    });
  });

  describe("2. Geração do Link Oficial de Assinatura e Notificação do Caio", () => {
    it("notifica Caio no WhatsApp como 1º signatário contendo o link oficial de assinatura do Vexo OS", async () => {
      const mockContractId = "contract-1234-abcd";
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql) => {
          if (sql.includes("SELECT") && sql.includes("public.gd_clientes")) {
            return {
              rows: [
                {
                  id: "cli-carvalho-1",
                  nome: "Carvalho Pinturas",
                  valor: 4000,
                  escopo: "Gestão Completa de Tráfego",
                },
              ],
            };
          }
          if (sql.includes("INSERT INTO public.gd_contracts")) {
            return { rows: [{ id: mockContractId }] };
          }
          return { rows: [] };
        }),
      };

      const res = await executarGerarContratoGomes(
        {
          cliente_nome: "Carvalho Pinturas",
          valor: 4000,
        },
        mockPool
      );

      expect(res.sucesso).toBe(true);
      expect(res.notificadoCaio).toBe(true);

      const expectedLink = `https://crm.vexoia.com/crm/gd/contratos/${mockContractId}`;
      expect(res.linkAssinatura).toBe(expectedLink);
      expect(res.contratoTexto).toContain(expectedLink);

      // Verifica mensagem privada para o Caio
      const caioPhone = process.env.CAIO_PHONE || "5534997719779";
      const zapCaio = whatsappDispatches.find((w) => w.number === caioPhone);
      expect(zapCaio).toBeDefined();
      expect(zapCaio.text).toContain("Gomes");
      expect(zapCaio.text).toContain("Carvalho Pinturas");
      expect(zapCaio.text).toContain(expectedLink);
      expect(zapCaio.text).toMatch(/1[ºo]\s+signat[aá]rio/i);
    });
  });

  describe("3. Envio ao Grupo PASTA do WhatsApp e Supressão Total de Slack", () => {
    it("publica a minuta no grupo PASTA se grupo_interno_jid existir e não chama nenhum endpoint de Slack", async () => {
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql) => {
          if (sql.includes("SELECT") && sql.includes("public.gd_clientes")) {
            return {
              rows: [
                {
                  id: "cli-pasta-1",
                  nome: "Restaurante Sabor Mineiro",
                  valor: 3000,
                  grupo_interno_jid: "120363009999@g.us",
                },
              ],
            };
          }
          if (sql.includes("INSERT INTO public.gd_contracts")) {
            return { rows: [{ id: "contract-rest-999" }] };
          }
          return { rows: [] };
        }),
      };

      const res = await executarGerarContratoGomes(
        {
          cliente_nome: "Restaurante Sabor Mineiro",
          valor: 3000,
        },
        mockPool
      );

      expect(res.sucesso).toBe(true);
      expect(res.enviadoGrupoPasta).toBe(true);

      const zapGrupo = whatsappDispatches.find((w) => w.number === "120363009999@g.us");
      expect(zapGrupo).toBeDefined();
      expect(zapGrupo.text).toContain("PROPOSTA & MINUTA CONTRATUAL");
      expect(zapGrupo.text).toContain("Restaurante Sabor Mineiro");
      expect(zapGrupo.text).toContain("https://crm.vexoia.com/crm/gd/contratos/contract-rest-999");
    });

    it("informa na resposta quando o grupo PASTA ainda não foi configurado sem quebrar a execução", async () => {
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql) => {
          if (sql.includes("SELECT") && sql.includes("public.gd_clientes")) {
            return {
              rows: [
                {
                  id: "cli-sem-grupo",
                  nome: "Clínica Vida Nova",
                  valor: 3200,
                  grupo_interno_jid: null,
                },
              ],
            };
          }
          if (sql.includes("INSERT INTO public.gd_contracts")) {
            return { rows: [{ id: "contract-vida-111" }] };
          }
          return { rows: [] };
        }),
      };

      const res = await executarGerarContratoGomes(
        { cliente_nome: "Clínica Vida Nova", valor: 3200 },
        mockPool
      );

      expect(res.sucesso).toBe(true);
      expect(res.enviadoGrupoPasta).toBe(false);
      expect(res.mensagem).toMatch(/grupo\s+PASTA.*n[aã]o\s+configurado/i);
    });
  });

  describe("4. Disjuntor de 4 Dias (BullMQ Queue e Worker)", () => {
    it("enfileira o job 'gd-disjuntor-contrato-check' com delay de 4 dias (345.600.000 ms) ao gerar o contrato", async () => {
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql) => {
          if (sql.includes("SELECT") && sql.includes("public.gd_clientes")) {
            return {
              rows: [{ id: "cli-disjuntor-check", nome: "Cafeeiro Cafés", valor: 5000 }],
            };
          }
          if (sql.includes("INSERT INTO public.gd_contracts")) {
            return { rows: [{ id: "contract-cafeeiro-444" }] };
          }
          return { rows: [] };
        }),
      };

      await executarGerarContratoGomes(
        { cliente_nome: "Cafeeiro Cafés", valor: 5000 },
        mockPool
      );

      const disjuntorCall = mockQueue.add.mock.calls.find(
        (c) => c[0] === "gd-disjuntor-contrato-check"
      );

      expect(disjuntorCall).toBeDefined();
      expect(disjuntorCall[1].clienteId).toBe("cli-disjuntor-check");
      expect(disjuntorCall[1].clienteNome).toBe("Cafeeiro Cafés");
      expect(disjuntorCall[1].valor).toBe(5000);
      expect(disjuntorCall[2].delay).toBe(4 * 24 * 3600 * 1000);
    });

    it("processGdDisjuntorContratoCheckJob alerta Caio se o contrato ainda estiver pendente após 4 dias", async () => {
      const mockPool = {
        query: vi.fn().mockResolvedValue({
          rows: [
            {
              id: "cli-pendente-4d",
              nome: "Escola Aprender Mais",
              status_pagamento: "pendente",
              contrato_assinado: false,
              valor: 3800,
            },
          ],
        }),
      };

      const job = {
        data: {
          clienteId: "cli-pendente-4d",
          clienteNome: "Escola Aprender Mais",
          valor: 3800,
        },
      };

      const res = await processGdDisjuntorContratoCheckJob(job, mockPool);

      expect(res.regularizado).toBe(false);
      expect(res.alertaDisjuntorEnviado).toBe(true);
      expect(res.mensagemCaio).toContain("Disjuntor de 4 Dias");
      expect(res.mensagemCaio).toContain("Escola Aprender Mais");
      expect(res.mensagemCaio).toContain("pausar o projeto");
    });
  });

  describe("5. Reconhecimento por Linguagem Natural e Áudio na Heloísa", () => {
    it("HELOISA_TOOLS documenta gerar_contrato_gomes com parâmetros formais de cartório", () => {
      const tool = HELOISA_TOOLS.find((t) => t.function?.name === "gerar_contrato_gomes");
      expect(tool).toBeDefined();
      expect(tool.function.description).toContain("Gomes");
      expect(tool.function.parameters.properties.cliente_nome).toBeDefined();
      expect(tool.function.parameters.properties.valor).toBeDefined();
      expect(tool.function.parameters.properties.escopo).toBeDefined();
      expect(tool.function.parameters.required).toContain("cliente_nome");
    });

    it("processarComandoHeloisa reconhece comandos de contrato para o Gomes", async () => {
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql) => {
          if (sql.includes("SELECT") && sql.includes("heloisa_agendas")) {
            return {
              rows: [
                {
                  id: "agenda-conrado",
                  nome: "Conrado Finzi",
                  telefone: "5534997817660",
                  email: "conradofl@gmail.com",
                  papel: "Diretor Executivo",
                  ativo: true,
                  notificar_whatsapp: true,
                },
              ],
            };
          }
          if (sql.includes("SELECT") && sql.includes("public.gd_clientes")) {
            return {
              rows: [{ id: "cli-odonto-id", nome: "Odonto Prime", valor: 3500 }],
            };
          }
          if (sql.includes("INSERT INTO public.gd_contracts")) {
            return { rows: [{ id: "contract-odonto-natural" }] };
          }
          return { rows: [] };
        }),
      };

      const resultado = await processarComandoHeloisa({
        telefoneRemetente: "5534997817660",
        promptUsuario: "Gomes, gera o contrato do cliente Odonto Prime no valor de 3500 reais",
        pool: mockPool,
        instanceName: "vexo-adm-vexo-atende",
      });

      expect(resultado.autorizado).toBe(true);
      expect(resultado.toolResults).toBeDefined();
      const gomesCall = resultado.toolResults.find((tr) => tr.name === "gerar_contrato_gomes");
      expect(gomesCall).toBeDefined();
      expect(gomesCall.resultado.sucesso).toBe(true);
      expect(gomesCall.resultado.clienteNome).toBe("Odonto Prime");
    });
  });
});
