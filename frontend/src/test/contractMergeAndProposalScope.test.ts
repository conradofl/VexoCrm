import { describe, expect, it } from "vitest";
import { buildContractInitialData } from "@/lib/geracaoDigital/contractFromProposal";
import { buildContractDados } from "@/lib/geracaoDigital/contractMerge";
import { resolveTermNomeExibicao } from "@/lib/geracaoDigital/formasPagamento";

describe("Leva A - Contratos GD: deduplicação e texto editável", () => {
  describe("A1: buildContractDados e texto_final", () => {
    it("preserva texto_final se foi preenchido", () => {
      const dados = buildContractDados({
        razao_social: "Empresa XPTO",
        texto_final: "Texto customizado pelo usuário no preview",
      });
      expect(dados.texto_final).toBe("Texto customizado pelo usuário no preview");
    });

    it("omite texto_final quando não editado (para seguir o template)", () => {
      const dados = buildContractDados({
        razao_social: "Empresa XPTO",
      });
      expect(dados.texto_final).toBeUndefined();
    });

    it("omite texto_final quando é string vazia ou apenas espaços", () => {
      const dados = buildContractDados({
        razao_social: "Empresa XPTO",
        texto_final: "   ",
      });
      expect(dados.texto_final).toBeUndefined();
    });
  });

  describe("A2: contractFromProposal - deduplicação de escopo", () => {
    it("remove linhas repetidas de valor zero (ex: Módulo Cafeeiro)", () => {
      const proposal = {
        prospect_name: "Cafeeiro",
        itens: [
          { descricao: "Pacote: Cafeeiro · Anual (Recorrência)", valor: 4800 },
          { descricao: "Branding", valor: 0 },
          { descricao: "Módulo: 🟣 Plano Avançado Vexo OS", valor: 0 },
          { descricao: "Módulo: 🟣 Plano Avançado Vexo OS", valor: 0 },
          { descricao: "Módulo: 🟣 Plano Avançado Vexo OS", valor: 0 },
          { descricao: "Módulo: 🟣 Plano Avançado Vexo OS", valor: 0 },
          { descricao: "Módulo: 🟣 Plano Avançado Vexo OS", valor: 0 },
        ],
      };

      const result = buildContractInitialData(proposal);
      const lines = result.produtos.split("\n");
      const avancadoLines = lines.filter((l) => l.includes("Plano Avançado Vexo OS"));

      expect(avancadoLines).toHaveLength(1);
      expect(lines).toContain("- Módulo: 🟣 Plano Avançado Vexo OS");
      expect(lines).toContain("- Branding");
    });
  });

  describe("A3: resolveTermNomeExibicao na proposta pública", () => {
    it("recalcula a partir de config.num_parcelas para termos parcelados", () => {
      const term = {
        id: "cartao_parcelado",
        nome: "Parcelado no Cartão em até 3x em 2x",
        tipo: "parcelado_cartao",
        config: { num_parcelas: 2 },
      };
      expect(resolveTermNomeExibicao(term)).toBe("Parcelado no Cartão em 2x");
    });

    it("limpa 'em até Nx em Mx' mesmo se config não tiver num_parcelas", () => {
      const term = {
        id: "cartao_parcelado",
        nome: "Parcelado no Cartão em até 3x em 4x",
      };
      expect(resolveTermNomeExibicao(term)).toBe("Parcelado no Cartão em 4x");
    });

    it("limpa 'em até' simples para termos antigos", () => {
      const term = {
        id: "cartao_parcelado_periodo",
        nome: "Parcelado no Cartão em até 6x",
      };
      expect(resolveTermNomeExibicao(term)).toBe("Parcelado no Cartão em 6x");
    });

    it("não altera termos não parcelados (como Pix)", () => {
      const term = {
        id: "pix_avista",
        nome: "Pix à vista",
      };
      expect(resolveTermNomeExibicao(term)).toBe("Pix à vista");
    });
  });
});
