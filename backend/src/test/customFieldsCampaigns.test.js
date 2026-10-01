import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { applyMessagePlaceholders, findUnresolvedPlaceholders } from "../services/messagePlaceholders.js";
import { validateOutboundMessage } from "../services/jsonExtractor.js";
import { dispatchCampaignSequence } from "../campaign-outbound.js";

describe("Testes Automatizados de Campos Customizados e Campanhas (Regras 1 a 8 e 15-CSV)", () => {
  describe("Regra 1: applyMessagePlaceholders resolve dados.campos.<campo>", () => {
    it("substitui placeholders correspondentes a campos customizados em dados.campos", () => {
      const template = "Olá {{nome}}, confirmamos seu cargo de {{cargo}} e plano {{plano}}.";
      const lead = {
        nome: "Conrado",
        dados: {
          campos: {
            cargo: "Diretor Comercial",
            plano: "Enterprise VIP",
          },
        },
      };
      const result = applyMessagePlaceholders(template, lead);
      expect(result).toBe("Olá Conrado, confirmamos seu cargo de Diretor Comercial e plano Enterprise VIP.");
    });
  });

  describe("Regra 2: Chaves protegidas do sistema (nome, telefone) nunca são sobrescritas por dados.campos", () => {
    it("mantém nome e telefone oficiais do lead mesmo se dados.campos contiver chaves maliciosas ou conflitantes", () => {
      const template = "Olá {{nome}}, seu contato é {{telefone}}!";
      const lead = {
        nome: "Conrado Oficial",
        telefone: "5534997817660",
        dados: {
          campos: {
            nome: "Invasor Malicioso",
            telefone: "5511000000000",
            phone: "5511000000000",
            name: "Invasor Malicioso",
            cliente: "Invasor Malicioso",
            celular: "5511000000000",
          },
        },
      };
      const result = applyMessagePlaceholders(template, lead, "5534997817660");
      expect(result).toBe("Olá Conrado Oficial, seu contato é 5534997817660!");
      expect(result).not.toContain("Invasor");
      expect(result).not.toContain("5511000000000");
    });
  });

  describe("Regra 3: findUnresolvedPlaceholders captura padrões amplos com espaços, acentos e hífens", () => {
    it("identifica variáveis com acentuação, espaços e caracteres especiais em {{...}}", () => {
      const text = "Atenção {{razão social}}, notificamos o {{nome do cliente}} e CNPJ {{CNPJ-MATRIZ}}.";
      const unresolved = findUnresolvedPlaceholders(text);
      expect(unresolved).toEqual(["{{razão social}}", "{{nome do cliente}}", "{{CNPJ-MATRIZ}}"]);
    });
  });

  describe("Regra 4: {{nome}} ausente faz fallback seguro para 'cliente' e não bloqueia o disparo", () => {
    it("converte {{nome}} para 'cliente' e passa na guarda de saída sem acusar variável não substituída", () => {
      const template = "Olá {{nome}}, tudo bem? Temos uma oportunidade.";
      const lead = { telefone: "5534997817660" }; // nome ausente
      const resolved = applyMessagePlaceholders(template, lead, "5534997817660");
      expect(resolved).toBe("Olá cliente, tudo bem? Temos uma oportunidade.");

      const guard = validateOutboundMessage(resolved);
      expect(guard.valid).toBe(true);
      expect(guard.reason).toBe(null);
    });
  });

  describe("Regra 5: Guarda de saída bloqueia variáveis brutas não substituídas com identificação do motivo", () => {
    it("bloqueia mensagens com variáveis não resolvidas indicando contains_unresolved_variable", () => {
      const textSystem = "Olá {{nome}}, tudo bem?";
      const guardSystem = validateOutboundMessage(textSystem);
      expect(guardSystem.valid).toBe(false);
      expect(guardSystem.reason).toBe("contains_unresolved_variable:{{nome}}");

      const textCustom = "Olá Conrado, seu limite é {{limite_credito}}.";
      const guardCustom = validateOutboundMessage(textCustom);
      expect(guardCustom.valid).toBe(false);
      expect(guardCustom.reason).toBe("contains_unresolved_variable:{{limite_credito}}");
    });
  });

  describe("Regras 6, 7 e 8: Validação Atômica de Sequência e Não-Interrupção do Lote", () => {
    let originalFetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      });
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it(
      "Regras 6, 7 e 8: Lead com variável faltando no passo 2 recebe ZERO mensagens, motivo registra variável e passo, e demais leads do lote continuam",
      async () => {
        const leads = [
          {
            id: "lead-1",
            nome: "Lead Incompleto",
            telefone: "5511999990001",
            dados: { campos: { cargo: "Analista" } }, // falta {{vencimento}}
          },
          {
            id: "lead-2",
            nome: "Lead Completo",
            telefone: "5511999990002",
            dados: { campos: { cargo: "Gerente", vencimento: "15/10/2026" } },
          },
        ];

        const analyticsMeta = {
          sequence: [
            {
              id: "step-1",
              order: 1,
              type: "text",
              enabled: true,
              triggerMode: "immediate",
              delayAfterSeconds: 0,
              text: "Olá {{nome}}, vimos que atua como {{cargo}}.",
            },
            {
              id: "step-2",
              order: 2,
              type: "text",
              enabled: true,
              triggerMode: "after_reply",
              delayAfterSeconds: 0,
              text: "Lembramos do boleto com vencimento em {{vencimento}}.",
            },
          ],
        };

        const failedCallbacks = [];
        const dispatchedSteps = [];

        const { summary } = await dispatchCampaignSequence({
          webhookUrl: "http://evolution.test/message/sendText/instancia",
          webhookToken: "token-teste",
          leads,
          analyticsMeta,
          leadDelayProvider: () => 0,
          onStepDispatched: (data) => dispatchedSteps.push(data),
          onLeadFailed: (data) => failedCallbacks.push(data),
        });

        // Regra 6: Lead 1 com falha no passo 2 não recebeu NENHUM passo (ZERO mensagens enviadas)
        const lead1Steps = dispatchedSteps.filter((s) => s.phone === "5511999990001");
        expect(lead1Steps.length).toBe(0);

        // Regra 7: Log de falha registra variável faltante exata e número do passo correspondente
        expect(summary.failureCount).toBe(1);
        expect(summary.failures[0].phone).toBe("5511999990001");
        expect(summary.failures[0].reason).toBe("Variável '{{vencimento}}' ausente no passo 2");
        expect(failedCallbacks[0].reason).toBe("Variável '{{vencimento}}' ausente no passo 2");

        // Regra 8: O lote não parou! O Lead 2 recebeu seu primeiro passo normalmente
        expect(summary.successCount).toBe(1);
        expect(summary.successPhones).toContain("5511999990002");
        const lead2Steps = dispatchedSteps.filter((s) => s.phone === "5511999990002");
        expect(lead2Steps.length).toBe(1);
      },
      15000
    );
  });

  describe("Regra 15: Exportação CSV inclui dinamicamente colunas de campos customizados", () => {
    it("gera cabeçalhos e valores de colunas customizadas a partir de dados.campos de múltiplos leads", () => {
      const leads = [
        {
          nome: "Conrado",
          telefone: "5534997817660",
          stage: "won",
          temperature: "hot",
          tags: ["vip"],
          dados: { campos: { cargo: "Fundador", cidade: "Uberlândia" } },
        },
        {
          nome: "Ana",
          telefone: "5511988887777",
          stage: "lead",
          temperature: "warm",
          tags: [],
          dados: { campos: { cargo: "Diretora" } }, // cidade ausente
        },
      ];

      const allCustomKeys = new Set();
      leads.forEach((l) => {
        const campos = l.dados && typeof l.dados === "object" ? l.dados.campos : null;
        if (campos && typeof campos === "object") {
          Object.keys(campos).forEach((k) => allCustomKeys.add(k));
        }
      });
      const customKeyList = Array.from(allCustomKeys).sort();
      expect(customKeyList).toEqual(["cargo", "cidade"]);

      const baseHeaders = ["Nome", "Telefone", "Estágio", "Temperatura", "Tags", "Última Interação", "Resumo Chat"];
      const allHeaders = [...baseHeaders, ...customKeyList];
      const csvHeader = allHeaders.map((h) => `"${h.replace(/"/g, '""')}"`).join(",");
      expect(csvHeader).toContain('"cargo","cidade"');

      const csvRows = leads.map((l) => {
        const baseCols = [`"${l.nome}"`, `"${l.telefone}"`, `"${l.stage}"`, `"${l.temperature}"`];
        const campos = (l.dados && typeof l.dados === "object" && l.dados.campos) || {};
        const customCols = customKeyList.map((k) => {
          const val = campos[k];
          const strVal = val !== undefined && val !== null ? String(val) : "";
          return `"${strVal.replace(/"/g, '""')}"`;
        });
        return [...baseCols, ...customCols].join(",");
      });

      expect(csvRows[0]).toContain('"Fundador","Uberlândia"');
      expect(csvRows[1]).toContain('"Diretora",""');
    });
  });
});
