import { describe, it, expect, vi } from "vitest";
import {
  WHATSAPP_GROUP_PREFIX,
  SLACK_CHANNEL_PREFIX,
  WHATSAPP_GROUP_MAX_LENGTH,
  SLACK_CHANNEL_MAX_LENGTH,
  normalizeCompanyName,
  generateSlackSlug,
  buildOnboardingNames,
  sanitizeWhatsAppGroupSubject,
} from "../services/onboardingNaming.js";

describe("Onboarding Naming Standards — WhatsApp e Slack", () => {
  describe("4 Casos de Teste Obrigatórios (Prefixo 100% Intacto)", () => {
    it("1. Empresa com nome longo: gera grupo e canal com prefixo intacto e limite respeitado", () => {
      // Nome com 130 caracteres
      const longName =
        "Empresa de Tecnologia e Solucoes Avancadas em Inteligencia Artificial e Automacao Comercial do Brasil e Exterior Sociedade Anonima";

      const warnSpy = vi.fn();
      const mockLogger = { warn: warnSpy, error: vi.fn(), log: vi.fn() };

      const names = buildOnboardingNames(longName, { logger: mockLogger });

      // WhatsApp: Prefixo intacto, comprimento <= 100, cortou no nome da empresa com log
      expect(names.whatsappGroupName.startsWith(WHATSAPP_GROUP_PREFIX)).toBe(true);
      expect(names.whatsappGroupName.length).toBeLessThanOrEqual(WHATSAPP_GROUP_MAX_LENGTH);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("ultrapassou 100 caracteres")
      );

      // Slack: Prefixo intacto, comprimento <= 80, cortou no slug com log
      expect(names.slackChannelName.startsWith(SLACK_CHANNEL_PREFIX)).toBe(true);
      expect(names.slackChannelName.length).toBeLessThanOrEqual(SLACK_CHANNEL_MAX_LENGTH);
      expect(names.slackChannelName).not.toMatch(/-$/); // Sem hífen pendurado no final
    });

    it("2. Empresa com acento: gera grupo em maiúsculas e canal sem acentos com espaços virando hífen", () => {
      const nameWithAccents = "Máquina de Vendas: Café Eiro";

      const names = buildOnboardingNames(nameWithAccents);

      // WhatsApp: MÁQUINA DE VENDAS: {EMPRESA EM MAIÚSCULAS}
      expect(names.whatsappGroupName).toBe("MÁQUINA DE VENDAS: CAFÉ EIRO");
      expect(names.whatsappGroupName.startsWith(WHATSAPP_GROUP_PREFIX)).toBe(true);

      // Slack: 02-cli-{slug} (minúsculas, sem acento, espaços virando hífen)
      expect(names.slackChannelName).toBe("02-cli-cafe-eiro");
      expect(names.slackChannelName.startsWith(SLACK_CHANNEL_PREFIX)).toBe(true);
      expect(names.slug).toBe("cafe-eiro");

      // Caso com outros acentos complexos
      const oticas = buildOnboardingNames("Óticas & Soluções Estéticas");
      expect(oticas.whatsappGroupName).toBe("MÁQUINA DE VENDAS: ÓTICAS & SOLUÇÕES ESTÉTICAS");
      expect(oticas.slackChannelName).toBe("02-cli-oticas-solucoes-esteticas");
    });

    it("3. Empresa com caractere especial: sanitiza pontuação para hífen único no Slack e preserva no WhatsApp", () => {
      const specialName = "Cafeeiro @#$ *Tech* & Co! (Matriz)";

      const names = buildOnboardingNames(specialName);

      // WhatsApp preserva os caracteres especiais em maiúsculas com o prefixo
      expect(names.whatsappGroupName).toBe("MÁQUINA DE VENDAS: CAFEEIRO @#$ *TECH* & CO! (MATRIZ)");
      expect(names.whatsappGroupName.startsWith(WHATSAPP_GROUP_PREFIX)).toBe(true);

      // Slack: caracteres especiais convertidos em hífens limpos, sem hífens duplicados ou nas pontas
      expect(names.slackChannelName).toBe("02-cli-cafeeiro-tech-co-matriz");
      expect(names.slackChannelName.startsWith(SLACK_CHANNEL_PREFIX)).toBe(true);
      expect(names.slug).toBe("cafeeiro-tech-co-matriz");
    });

    it("4. Empresa com nome de uma letra: gera grupo e canal com prefixo intacto", () => {
      // Teste com 'X'
      const namesX = buildOnboardingNames("X");
      expect(namesX.whatsappGroupName).toBe("MÁQUINA DE VENDAS: X");
      expect(namesX.slackChannelName).toBe("02-cli-x");
      expect(namesX.slug).toBe("x");
      expect(namesX.whatsappGroupName.startsWith(WHATSAPP_GROUP_PREFIX)).toBe(true);
      expect(namesX.slackChannelName.startsWith(SLACK_CHANNEL_PREFIX)).toBe(true);

      // Teste com 'A'
      const namesA = buildOnboardingNames("a");
      expect(namesA.whatsappGroupName).toBe("MÁQUINA DE VENDAS: A");
      expect(namesA.slackChannelName).toBe("02-cli-a");
      expect(namesA.slug).toBe("a");
    });
  });

  describe("Remoção do Limite Antigo de 25 Caracteres (Regra 2)", () => {
    it("grupos com mais de 25 caracteres (ex.: 66 chars provados pelo dono) não são truncados", () => {
      // Grupo de 66 caracteres exatamente
      const subject66 = "MÁQUINA DE VENDAS: EMPRESA MODELO DE EXPEDICAO E LOGISTICA BRASIL!";
      expect(subject66.length).toBe(66);

      const sanitized = sanitizeWhatsAppGroupSubject(subject66);

      // NUNCA mais corta em 25 caracteres
      expect(sanitized.length).toBe(66);
      expect(sanitized).toBe(subject66);
    });

    it("quando ultrapassa o teto real de 100 caracteres, corta o nome da empresa e NUNCA o prefixo", () => {
      const warnSpy = vi.fn();
      const mockLogger = { warn: warnSpy };

      // Assunto com mais de 100 caracteres começando com o prefixo
      const subjectLong =
        "MÁQUINA DE VENDAS: EMPRESA COM NOME GIGANTESCO QUE VAI ULTRAPASSAR O LIMITE DE CEM CARACTERES DO PROTOCOLO DO WHATSAPP DEFINITIVAMENTE";

      const sanitized = sanitizeWhatsAppGroupSubject(subjectLong, { logger: mockLogger });

      expect(sanitized.startsWith(WHATSAPP_GROUP_PREFIX)).toBe(true);
      expect(sanitized.length).toBeLessThanOrEqual(WHATSAPP_GROUP_MAX_LENGTH);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("cortado de")
      );
    });
  });

  describe("Robustez com Casos de Borda e Entradas Nulas", () => {
    it("trata null, undefined e strings vazias usando fallback seguro com prefixo intacto", () => {
      for (const emptyVal of [null, undefined, "", "   "]) {
        const names = buildOnboardingNames(emptyVal);
        expect(names.whatsappGroupName).toBe("MÁQUINA DE VENDAS: CLIENTE");
        expect(names.slackChannelName).toBe("02-cli-cliente");
        expect(names.slug).toBe("cliente");
      }
    });

    it("remove prefixo legado GD & ou GD - se a entrada já vier pré-rotulada", () => {
      const namesGD = buildOnboardingNames("GD & Conrado Tech");
      expect(namesGD.whatsappGroupName).toBe("MÁQUINA DE VENDAS: CONRADO TECH");
      expect(namesGD.slackChannelName).toBe("02-cli-conrado-tech");
    });

    it("higienização avulsa de assunto nulo retorna padrão com prefixo", () => {
      expect(sanitizeWhatsAppGroupSubject(null)).toBe("MÁQUINA DE VENDAS: CLIENTE");
      expect(sanitizeWhatsAppGroupSubject("")).toBe("MÁQUINA DE VENDAS: CLIENTE");
    });
  });

  describe("Inspeção de Migração e Relatório de Não-Conformidade (Regra 5)", () => {
    it("avalia canais do Slack identificando padrão oficial e prefixos legados", async () => {
      const { evaluateSlackChannelName } = await import("../scripts/listNonStandardOnboardingChannels.js");

      const ok = evaluateSlackChannelName("02-cli-cafe-eiro", "cafe-eiro");
      expect(ok.isStandard).toBe(true);
      expect(ok.reason).toBeNull();

      const legacy = evaluateSlackChannelName("gd-cafe-eiro", "cafe-eiro");
      expect(legacy.isStandard).toBe(false);
      expect(legacy.reason).toContain("prefixo antigo legatório \"gd-\"");

      const noPrefix = evaluateSlackChannelName("cliente-cafe-eiro", "cafe-eiro");
      expect(noPrefix.isStandard).toBe(false);
      expect(noPrefix.reason).toContain("Não possui o prefixo obrigatório");
    });

    it("avalia assuntos do WhatsApp identificando padrão oficial, truncamento antigo e prefixos legados", async () => {
      const { evaluateWhatsAppGroupName } = await import("../scripts/listNonStandardOnboardingChannels.js");

      const ok = evaluateWhatsAppGroupName("MÁQUINA DE VENDAS: CAFÉ EIRO", "Café Eiro");
      expect(ok.isStandard).toBe(true);
      expect(ok.reason).toBeNull();

      const legacy = evaluateWhatsAppGroupName("GD & Café Eiro", "Café Eiro");
      expect(legacy.isStandard).toBe(false);
      expect(legacy.reason).toContain("prefixo antigo \"GD &\"");

      // Truncado pelo substring(0, 25) antigo
      const truncated = evaluateWhatsAppGroupName("MÁQUINA DE VENDAS: CAF", "Café Eiro Especialistas");
      expect(truncated.isStandard).toBe(false);
      expect(truncated.reason).toContain("truncamento antigo de 25 caracteres");
    });

    it("inspeciona briefings e mapeamentos via SELECT sem nenhuma escrita", async () => {
      const { inspectOnboardingChannels } = await import("../scripts/listNonStandardOnboardingChannels.js");

      const mockBriefings = [
        {
          id: "briefing-1",
          prospect_name: "Café Eiro",
          whatsapp_number: "5534999999999",
          briefing_data: {
            whatsappGroupName: "GD & Café Eiro",
            slackChannelName: "gd-cafe-eiro",
          },
          status: "concluido",
          created_at: new Date().toISOString(),
        },
        {
          id: "briefing-2",
          prospect_name: "Nous",
          whatsapp_number: "5534988888888",
          briefing_data: {
            whatsappGroupName: "MÁQUINA DE VENDAS: NOUS",
            slackChannelName: "02-cli-nous",
          },
          status: "concluido",
          created_at: new Date().toISOString(),
        },
      ];

      const mockMaps = [
        {
          id: 1,
          client_name: "Nous",
          whatsapp_jid: "5534988888888-group@g.us",
          slack_channel_id: "C12345",
          instance_name: "gd-oficial",
          status: "active",
          created_at: new Date().toISOString(),
        },
      ];

      const mockPool = {
        query: vi.fn().mockImplementation(async (sql) => {
          // Garante que só SELECT é executado
          expect(sql.trim().toUpperCase().startsWith("SELECT")).toBe(true);
          if (sql.includes("public.slack_channel_map")) {
            return { rows: mockMaps };
          }
          if (sql.includes("public.geracao_digital_briefings")) {
            return { rows: mockBriefings };
          }
          return { rows: [] };
        }),
      };

      const report = await inspectOnboardingChannels(mockPool);

      expect(report.summary.totalBriefings).toBe(2);
      expect(report.summary.nonStandardBriefingsCount).toBe(1);
      expect(report.summary.nonStandardBriefings[0].id).toBe("briefing-1");
      expect(report.summary.nonStandardBriefings[0].isNonStandard).toBe(true);
      expect(report.briefings[1].isNonStandard).toBe(false);
    });
  });
});

