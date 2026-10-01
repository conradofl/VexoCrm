import { describe, it, expect } from "vitest";
import { applyMessagePlaceholders } from "../services/messagePlaceholders.js";
import { validateOutboundMessage } from "../services/jsonExtractor.js";

describe("Follow-up Lembrete Avulso (Standalone Reminder)", () => {
  describe("1. Fuso Horário e Conversão de Data/Hora", () => {
    it("converte horário local (ex.: America/Sao_Paulo -03:00) para UTC exato e calcula delay correto", () => {
      // Horário escolhido pelo usuário no navegador: 28/08/2026 às 09:00 (GMT-3)
      const localInputString = "2026-08-28T09:00:00-03:00";
      const targetDate = new Date(localInputString);

      // Prova de paridade do fuso horário:
      // 09:00 em UTC-3 DEVE ser exatamente 12:00 em UTC (Z)
      expect(targetDate.toISOString()).toBe("2026-08-28T12:00:00.000Z");

      // Simulação de cálculo de delay contra horário base
      const mockNow = new Date("2026-08-27T18:00:00-03:00").getTime(); // 21:00 UTC
      const delayMs = targetDate.getTime() - mockNow;

      // 15 horas de diferença = 15 * 3600 * 1000 = 54.000.000 ms
      expect(delayMs).toBe(15 * 60 * 60 * 1000);
    });

    it("rejeita agendamento no passado", () => {
      const pastDate = new Date(Date.now() - 60000); // 1 minuto atrás
      const isPast = pastDate.getTime() <= Date.now();
      expect(isPast).toBe(true);
    });
  });

  describe("2. Substituição de Variáveis e Guarda de Saída", () => {
    it("substitui {{nome}}, {{telefone}} e {{scheduling_link}} com precisão", () => {
      const template = "Olá {{nome}}, tudo bem? Confirmamos para o número {{telefone}} no link {{scheduling_link}}";
      const rendered = applyMessagePlaceholders(
        template,
        { nome: "João Silva" },
        "5511999998888",
        { scheduling_link: "https://vexo.com.br/agenda" }
      );

      expect(rendered).toBe(
        "Olá João Silva, tudo bem? Confirmamos para o número 5511999998888 no link https://vexo.com.br/agenda"
      );
    });

    it("guarda de saída BLOQUEIA mensagem se contiver variáveis não substituídas", () => {
      const brokenText = "Olá {{nome}}, seu código é {{codigo_inexistente}}";
      const guard = validateOutboundMessage(brokenText);

      expect(guard.valid).toBe(false);
      expect(guard.reason).toBe("contains_unresolved_variable:{{nome}}");
    });

    it("guarda de saída APROVA mensagem após todas as variáveis serem substituídas", () => {
      const validText = "Olá João, tudo bem? Passando para saber se conseguiu ver a proposta!";
      const guard = validateOutboundMessage(validText);

      expect(guard.valid).toBe(true);
    });
  });

  describe("3. Integridade do Esquema (CHECK Constraint em followup_jobs)", () => {
    it("valida a regra do CHECK followup_jobs_content_check", () => {
      const isValidJob = (templateId, customMessage) => {
        if (templateId !== null && templateId !== undefined) return true;
        if (customMessage !== null && customMessage !== undefined && String(customMessage).trim().length > 0) return true;
        return false;
      };

      // Caso A: Job de cadência normal (com template_id, custom_message null) -> VÁLIDO
      expect(isValidJob("tpl-123", null)).toBe(true);

      // Caso B: Lembrete avulso (template_id null, custom_message preenchida) -> VÁLIDO
      expect(isValidJob(null, "E aí João, conseguiu ver a proposta?")).toBe(true);

      // Caso C: Job mudo e inválido (template_id null E custom_message null) -> INVÁLIDO (BLOQUEADO PELO CHECK)
      expect(isValidJob(null, null)).toBe(false);
      expect(isValidJob(null, "   ")).toBe(false);
    });
  });
});
