import { describe, it, expect } from "vitest";
import {
  resolveSegmentGroup,
  buildPitch,
  estimatePhotographyLoss,
  estimateConsultingLoss,
  estimateUniformLoss,
  BENCHMARKS,
} from "@/lib/presentation/pitchContent";

const CASOS = [
  { seg: "Fotografia", grupo: "fotografia", empresa: "Marise Romano" },
  { seg: "Fotógrafa Marise Romano", grupo: "fotografia", empresa: "Marise Romano" },
  { seg: "Consultoria e Mentoria", grupo: "consultoria", empresa: "Instituto Siqueira" },
  { seg: "Instituto Siqueira", grupo: "consultoria", empresa: "Instituto Siqueira" },
  { seg: "Confecção de Uniformes", grupo: "uniformes", empresa: "ML Sports" },
];

describe("roteamento dos novos segmentos", () => {
  it("cada nome cai no grupo certo", () => {
    CASOS.forEach(({ seg, grupo }) => {
      expect(resolveSegmentGroup(seg).id).toBe(grupo);
    });
  });

  it("não rouba os segmentos antigos", () => {
    expect(resolveSegmentGroup("Óticas").id).toBe("otica");
    expect(resolveSegmentGroup("Clínicas de Saúde").id).toBe("saude_estetica");
    expect(resolveSegmentGroup("Suplementos Alimentares").id).toBe("suplementos");
    expect(resolveSegmentGroup("Entretenimento Local").id).toBe("entretenimento_local");
  });
});

describe("estrutura SPIN dos três roteiros", () => {
  CASOS.slice(0, 3).forEach(({ seg, empresa }) => {
    it(`${seg}: 7 slides na ordem certa e com o nome da empresa`, () => {
      const { slides } = buildPitch({ companyName: empresa, segmentId: seg });
      expect(slides).toHaveLength(7);
      expect(slides.map((s) => s.kind)).toEqual([
        "impact", "pain", "implication", "solution", "partnership", "vision", "close",
      ]);
      [1, 5, 6, 7].forEach((id) => {
        const s = slides.find((x) => x.id === id)!;
        expect(`${s.title} ${s.subtitle || ""} ${s.body || ""}`).toContain(empresa);
      });
      const pain = slides.find((s) => s.kind === "pain")!;
      expect(pain.compare?.before.img).toMatch(/^https:\/\/images\.unsplash\.com\//);
      expect(pain.compare?.after.img).toMatch(/^https:\/\/images\.unsplash\.com\//);
    });
  });
});

describe("ROI coerente com o benchmark / dado do cliente", () => {
  it("fotografia soma reativação da base + lead novo", () => {
    const b = BENCHMARKS.fotografia;
    const { reativacaoMensal, leadMensal, mensal, anual } = estimatePhotographyLoss();
    expect(reativacaoMensal).toBe(b.baseParada * b.taxaReativacaoMes * b.taxaFechaReativacao * b.ticketEnsaio);
    expect(leadMensal).toBe(b.leadsNovosMes * b.taxaResgateLead * b.ticketEnsaio);
    expect(mensal).toBe(reativacaoMensal + leadMensal);
    expect(anual).toBe(mensal * 12);
  });

  it("consultoria usa o número dado pela cliente: 3 × 12.000 = 36.000/mês", () => {
    const { mensal, anual } = estimateConsultingLoss();
    expect(mensal).toBe(36000);
    expect(anual).toBe(432000);
  });

  it("uniformes usa a capacidade ociosa recuperável", () => {
    const b = BENCHMARKS.uniformes;
    const { mensal, anual } = estimateUniformLoss();
    expect(mensal).toBe(b.pedidosOciososRecuperaveisMes * b.ticketPedido);
    expect(anual).toBe(mensal * 12);
  });
});

describe("regras de estilo do Conrado", () => {
  const gruposNovos = ["Fotografia", "Consultoria e Mentoria", "Confecção de Uniformes"];

  it("respeita o veto ao jargão", () => {
    gruposNovos.forEach((seg) => {
      const texto = JSON.stringify(buildPitch({ companyName: "X", segmentId: seg }).slides).toLowerCase();
      ["sdr", "tráfego pago", "trafego pago", "n8n", "typebot", "evolution api", "funil", "leads"].forEach(
        (proibido) => expect(texto, `${seg} contém "${proibido}"`).not.toContain(proibido)
      );
    });
  });

  it("sem hífen usado como separador de frase", () => {
    gruposNovos.forEach((seg) => {
      const slides = buildPitch({ companyName: "X", segmentId: seg }).slides;
      const textos = slides.flatMap((s) =>
        [s.title, s.subtitle, s.body, s.punch, ...(s.steps || [])].filter(Boolean) as string[]
      );
      textos.forEach((t) => expect(t, `${seg}: "${t}"`).not.toMatch(/\s[—–-]\s/));
    });
  });
});
