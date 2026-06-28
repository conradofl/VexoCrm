import { describe, expect, it } from "vitest";
import {
  normalizeSegmentationCatalog,
  normalizeFilters,
  isFilterShape,
  leadMatchesSegmentation,
  operatorsForType,
} from "../segmentation.js";

describe("Unified Segmentation Module", () => {
  // ── Catálogo: compat v1 (kpis) → v2 (fields + featuredKpis) ──
  it("catalogo v1 kpis vira fields+featuredKpis", () => {
    const cat = normalizeSegmentationCatalog({
      version: 1,
      kpis: [
        { id: "consumo", label: "Conta de luz", field: "faixa_consumo", type: "money", enabled: true },
        { id: "cidade", label: "Cidade", field: "cidade", type: "category", enabled: true },
        { id: "off", label: "Off", field: "prazo", type: "category", enabled: false },
      ],
    });
    expect(cat.version).toBe(2);
    expect(cat.fields.length).toBe(3);
    expect(cat.featuredKpis).toEqual(["faixa_consumo", "cidade"]); // só enabled
  });

  it("catalogo v2 respeita featuredKpis e cap 6", () => {
    const fields = Array.from({ length: 10 }, (_, i) => ({ field: `f${i}`, label: `F${i}`, type: "category" }));
    const cat = normalizeSegmentationCatalog({ version: 2, fields, featuredKpis: fields.map((f) => f.field) });
    expect(cat.fields.length).toBe(10);       // catálogo sem cap
    expect(cat.featuredKpis.length).toBe(6);  // destaque cap 6
  });

  it("catalogo descarta campo duplicado/vazio", () => {
    const cat = normalizeSegmentationCatalog({ fields: [
      { field: "cidade", type: "category" },
      { field: "Cidade", type: "category" }, // dup após normalização
      { field: "", type: "category" },
    ]});
    expect(cat.fields.length).toBe(1);
  });

  // ── isFilterShape ──
  it("isFilterShape distingue novo de legado", () => {
    expect(isFilterShape({ filters: [] })).toBe(true);
    expect(isFilterShape({ gender: "feminino" })).toBe(false);
    expect(isFilterShape(null)).toBe(false);
  });

  // ── normalizeFilters ──
  it("normalizeFilters limpa vazios e valida campo do catalogo", () => {
    const catalog = { fields: [{ field: "cidade", type: "category" }, { field: "valor", type: "money" }] };
    const f = normalizeFilters({ filters: [
      { field: "cidade", operator: "contains", value: "uber" },
      { field: "valor", operator: "gt", value: 50000 },
      { field: "cidade", operator: "equals", value: "" },        // vazio → drop
      { field: "inexistente", operator: "equals", value: "x" },  // fora catálogo → drop
    ]}, catalog);
    expect(f.length).toBe(2);
    expect(f[0]).toEqual({ field: "cidade", operator: "contains", value: "uber" });
  });

  // ── Matcher ──
  const catFields = [
    { field: "perfil_musical", type: "category" },
    { field: "faixa_consumo", type: "money" },
    { field: "cidade", type: "category" },
  ];
  const lead = { normalized_data: { perfil_musical: "Pagode", faixa_consumo: "R$ 80.000", cidade: "Uberlândia" } };

  it("matcher sem filtros casa tudo", () => {
    expect(leadMatchesSegmentation(lead, catFields, [])).toBe(true);
  });

  it("matcher equals categoria (acento-insensível)", () => {
    expect(leadMatchesSegmentation(lead, catFields, [{ field: "perfil_musical", operator: "equals", value: "pagode" }])).toBe(true);
    expect(leadMatchesSegmentation(lead, catFields, [{ field: "perfil_musical", operator: "equals", value: "sertanejo" }])).toBe(false);
  });

  it("matcher contains", () => {
    expect(leadMatchesSegmentation(lead, catFields, [{ field: "cidade", operator: "contains", value: "uber" }])).toBe(true);
  });

  it("matcher gt/lt money", () => {
    expect(leadMatchesSegmentation(lead, catFields, [{ field: "faixa_consumo", operator: "gt", value: 50000 }])).toBe(true);
    expect(leadMatchesSegmentation(lead, catFields, [{ field: "faixa_consumo", operator: "lt", value: 50000 }])).toBe(false);
  });

  it("matcher AND entre filtros", () => {
    expect(leadMatchesSegmentation(lead, catFields, [
      { field: "perfil_musical", operator: "equals", value: "pagode" },
      { field: "faixa_consumo", operator: "gt", value: 100000 }, // falha
    ])).toBe(false);
  });

  it("matcher campo ausente no lead falha em filtro restritivo", () => {
    expect(leadMatchesSegmentation({ normalized_data: {} }, catFields, [{ field: "cidade", operator: "contains", value: "uber" }])).toBe(false);
  });

  it("operatorsForType", () => {
    expect(operatorsForType("money")).toEqual(["gt", "lt", "equals"]);
    expect(operatorsForType("category")).toEqual(["equals", "contains"]);
    expect(operatorsForType("date")).toEqual(["gt", "lt"]);
  });
});
