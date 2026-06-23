// Teste unitário do módulo de segmentação unificada. Roda: node segmentation.test.mjs
import assert from "node:assert";
import {
  normalizeSegmentationCatalog,
  normalizeFilters,
  isFilterShape,
  leadMatchesSegmentation,
  operatorsForType,
} from "../segmentation.js";

let pass = 0;
function t(name, fn) { fn(); pass += 1; console.log("ok -", name); }

// ── Catálogo: compat v1 (kpis) → v2 (fields + featuredKpis) ──
t("catalogo v1 kpis vira fields+featuredKpis", () => {
  const cat = normalizeSegmentationCatalog({
    version: 1,
    kpis: [
      { id: "consumo", label: "Conta de luz", field: "faixa_consumo", type: "money", enabled: true },
      { id: "cidade", label: "Cidade", field: "cidade", type: "category", enabled: true },
      { id: "off", label: "Off", field: "prazo", type: "category", enabled: false },
    ],
  });
  assert.equal(cat.version, 2);
  assert.equal(cat.fields.length, 3);
  assert.deepEqual(cat.featuredKpis, ["faixa_consumo", "cidade"]); // só enabled
});

t("catalogo v2 respeita featuredKpis e cap 6", () => {
  const fields = Array.from({ length: 10 }, (_, i) => ({ field: `f${i}`, label: `F${i}`, type: "category" }));
  const cat = normalizeSegmentationCatalog({ version: 2, fields, featuredKpis: fields.map((f) => f.field) });
  assert.equal(cat.fields.length, 10);       // catálogo sem cap
  assert.equal(cat.featuredKpis.length, 6);  // destaque cap 6
});

t("catalogo descarta campo duplicado/vazio", () => {
  const cat = normalizeSegmentationCatalog({ fields: [
    { field: "cidade", type: "category" },
    { field: "Cidade", type: "category" }, // dup após normalização
    { field: "", type: "category" },
  ]});
  assert.equal(cat.fields.length, 1);
});

// ── isFilterShape ──
t("isFilterShape distingue novo de legado", () => {
  assert.equal(isFilterShape({ filters: [] }), true);
  assert.equal(isFilterShape({ gender: "feminino" }), false);
  assert.equal(isFilterShape(null), false);
});

// ── normalizeFilters ──
t("normalizeFilters limpa vazios e valida campo do catalogo", () => {
  const catalog = { fields: [{ field: "cidade", type: "category" }, { field: "valor", type: "money" }] };
  const f = normalizeFilters({ filters: [
    { field: "cidade", operator: "contains", value: "uber" },
    { field: "valor", operator: "gt", value: 50000 },
    { field: "cidade", operator: "equals", value: "" },        // vazio → drop
    { field: "inexistente", operator: "equals", value: "x" },  // fora catálogo → drop
  ]}, catalog);
  assert.equal(f.length, 2);
  assert.deepEqual(f[0], { field: "cidade", operator: "contains", value: "uber" });
});

// ── Matcher ──
const catFields = [
  { field: "perfil_musical", type: "category" },
  { field: "faixa_consumo", type: "money" },
  { field: "cidade", type: "category" },
];
const lead = { normalized_data: { perfil_musical: "Pagode", faixa_consumo: "R$ 80.000", cidade: "Uberlândia" } };

t("matcher sem filtros casa tudo", () => {
  assert.equal(leadMatchesSegmentation(lead, catFields, []), true);
});
t("matcher equals categoria (acento-insensível)", () => {
  assert.equal(leadMatchesSegmentation(lead, catFields, [{ field: "perfil_musical", operator: "equals", value: "pagode" }]), true);
  assert.equal(leadMatchesSegmentation(lead, catFields, [{ field: "perfil_musical", operator: "equals", value: "sertanejo" }]), false);
});
t("matcher contains", () => {
  assert.equal(leadMatchesSegmentation(lead, catFields, [{ field: "cidade", operator: "contains", value: "uber" }]), true);
});
t("matcher gt/lt money", () => {
  assert.equal(leadMatchesSegmentation(lead, catFields, [{ field: "faixa_consumo", operator: "gt", value: 50000 }]), true);
  assert.equal(leadMatchesSegmentation(lead, catFields, [{ field: "faixa_consumo", operator: "lt", value: 50000 }]), false);
});
t("matcher AND entre filtros", () => {
  assert.equal(leadMatchesSegmentation(lead, catFields, [
    { field: "perfil_musical", operator: "equals", value: "pagode" },
    { field: "faixa_consumo", operator: "gt", value: 100000 }, // falha
  ]), false);
});
t("matcher campo ausente no lead falha em filtro restritivo", () => {
  assert.equal(leadMatchesSegmentation({ normalized_data: {} }, catFields, [{ field: "cidade", operator: "contains", value: "uber" }]), false);
});

t("operatorsForType", () => {
  assert.deepEqual(operatorsForType("money"), ["gt", "lt", "equals"]);
  assert.deepEqual(operatorsForType("category"), ["equals", "contains"]);
  assert.deepEqual(operatorsForType("date"), ["gt", "lt"]);
});

console.log(`\n${pass} testes passaram.`);
