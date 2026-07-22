import { describe, it, expect } from "vitest";
import {
  resolveSegmentGroup,
  buildPitch,
  estimateSupplementLoss,
  BENCHMARKS,
} from "@/lib/presentation/pitchContent";

describe("roteiro de suplementos", () => {
  it("resolve o grupo pelo nome do segmento cadastrado", () => {
    // O segment_id real é UUID, então a resolução é pelo NOME.
    expect(resolveSegmentGroup("Suplementos Alimentares").id).toBe("suplementos");
    expect(resolveSegmentGroup("suplementos").id).toBe("suplementos");
    expect(resolveSegmentGroup("Nutrição Esportiva").id).toBe("suplementos");
    expect(resolveSegmentGroup("Loja de Whey e Creatina").id).toBe("suplementos");
  });

  it("não rouba segmento de outro grupo", () => {
    expect(resolveSegmentGroup("Óticas").id).toBe("otica");
    expect(resolveSegmentGroup("Clínicas de Saúde").id).toBe("saude_estetica");
  });

  it("monta 7 slides na ordem SPIN", () => {
    const { slides } = buildPitch({ companyName: "Nutri Prime", segmentId: "Suplementos Alimentares" });
    expect(slides).toHaveLength(7);
    expect(slides.map((s) => s.kind)).toEqual([
      "impact",
      "pain",
      "implication",
      "solution",
      "partnership",
      "vision",
      "close",
    ]);
  });

  it("usa o nome da empresa nos slides personalizados", () => {
    const { slides } = buildPitch({ companyName: "Nutri Prime", segmentId: "suplementos" });
    // Abertura, parceria, visão e fechamento chamam o cliente pelo nome.
    [1, 5, 6, 7].forEach((id) => {
      const s = slides.find((x) => x.id === id)!;
      expect(`${s.title} ${s.subtitle || ""} ${s.body || ""}`).toContain("Nutri Prime");
    });
  });

  it("cai num fallback legível sem nome de empresa", () => {
    const { slides } = buildPitch({ companyName: "", segmentId: "suplementos" });
    expect(JSON.stringify(slides)).toContain("sua loja");
  });

  it("o ROI soma os dois vazamentos e bate com o benchmark", () => {
    const b = BENCHMARKS.suplementos;
    const { recompraMensal, consultaMensal, mensal, anual } = estimateSupplementLoss();
    expect(recompraMensal).toBe(b.clientesNoCicloMes * b.ticketMedio * b.taxaResgateRecompra);
    expect(consultaMensal).toBe(b.consultasSemFechamentoMes * b.ticketMedio * b.taxaResgateConsulta);
    expect(mensal).toBe(recompraMensal + consultaMensal);
    expect(anual).toBe(mensal * 12);
  });

  it("as imagens do antes/depois estão preenchidas", () => {
    const { slides } = buildPitch({ companyName: "X", segmentId: "suplementos" });
    const pain = slides.find((s) => s.kind === "pain")!;
    expect(pain.compare?.before.img).toMatch(/^https:\/\/images\.unsplash\.com\//);
    expect(pain.compare?.after.img).toMatch(/^https:\/\/images\.unsplash\.com\//);
  });

  it("respeita a regra anti-jargão do arquivo", () => {
    const texto = JSON.stringify(
      buildPitch({ companyName: "X", segmentId: "suplementos" }).slides
    ).toLowerCase();
    ["sdr", "tráfego pago", "trafego pago", "n8n", "typebot", "evolution api", "funil", "leads"].forEach(
      (proibido) => expect(texto).not.toContain(proibido)
    );
  });

  it("sem hífen usado como separador de frase (feedback do Conrado)", () => {
    const slides = buildPitch({ companyName: "X", segmentId: "suplementos" }).slides;
    const textos = slides.flatMap((s) =>
      [s.title, s.subtitle, s.body, s.punch, ...(s.steps || [])].filter(Boolean) as string[]
    );
    textos.forEach((t) => {
      expect(t).not.toMatch(/\s[—–-]\s/);
    });
  });
});
