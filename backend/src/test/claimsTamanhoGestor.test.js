// Cadastrar usuário como Gestor falhava sempre (19/11/2026, usuária Pamela, VP Litoral Norte):
//   "Este conjunto de permissões é grande demais para o perfil de autenticação."
//
// O Firebase recusa claims acima de 1000 bytes e a rota corta em 950. Só o preset Gestor já dava
// 1262: a lista de 35 telas internas sozinha ocupa ~530. Para usuário interno a tela de acessos
// sempre manda as telas padrão do preset, e os dois leitores do login (extractManagedAccessClaims
// aqui e buildAccessProfile no frontend) já devolvem as telas do preset quando a lista falta.
// Então a lista igual à do preset não vai para o login; qualquer outra vai inteira.

import { describe, expect, it } from "vitest";
import {
  buildManagedClaims,
  buildPresetDefaults,
  extractManagedAccessClaims,
  listAccessPresetKeys,
  mergeManagedClaims,
} from "../access/claims.js";
import { buildPresetDefaults as buildPresetDefaultsTela, normalizeInternalPages as normalizeInternalPagesTela } from "../../../frontend/src/lib/access.ts";

const LIMITE_DA_ROTA = 950;
const INTERNOS = listAccessPresetKeys().filter((preset) => buildPresetDefaults(preset).role === "internal");

function claimsDoPreset(preset, extra = {}) {
  return buildManagedClaims({
    role: "internal",
    accessPreset: preset,
    clientIds: ["via-permuta-3"],
    companyName: "VP Litoral Norte",
    allowedModules: ["esteira_tecnica"],
    ...extra,
  });
}

const ordenado = (lista) => [...lista].sort();

describe("claims do usuário interno cabem no login do Firebase", () => {
  it("há presets internos para conferir (gestor entre eles)", () => {
    expect(INTERNOS).toContain("gestor");
  });

  it.each(INTERNOS)("preset %s com as telas padrão fica abaixo do limite da rota", (preset) => {
    const gravado = mergeManagedClaims({ must_change_password: true }, claimsDoPreset(preset));
    expect(JSON.stringify(gravado).length).toBeLessThanOrEqual(LIMITE_DA_ROTA);
  });

  it.each(INTERNOS)("preset %s: o acesso lido do login compacto é o mesmo do login completo", (preset) => {
    const completo = claimsDoPreset(preset);
    const compacto = mergeManagedClaims({}, completo);
    const identidade = { uid: "u-teste", email: "pessoa@exemplo.com" };

    expect(extractManagedAccessClaims(compacto, identidade)).toEqual(extractManagedAccessClaims(completo, identidade));
  });

  it("tela fora do padrão do preset continua gravada", () => {
    const padrao = buildPresetDefaults("gestor").internalPages;
    const reduzida = padrao.slice(0, 3);
    const gravado = mergeManagedClaims({}, claimsDoPreset("gestor", { internalPages: reduzida }));

    expect(ordenado(gravado.internalPages)).toEqual(ordenado(reduzida));
    expect(ordenado(extractManagedAccessClaims(gravado, { uid: "u" }).internalPages)).toEqual(ordenado(reduzida));
  });

  it("telas antigas gravadas no login são trocadas pelas do perfil novo, não herdadas", () => {
    const antigo = { internalPages: ["dashboard"], role: "internal", accessPreset: "operador" };
    const gravado = mergeManagedClaims(antigo, claimsDoPreset("gestor"));

    expect(gravado).not.toHaveProperty("internalPages");
    expect(ordenado(extractManagedAccessClaims(gravado, { uid: "u" }).internalPages)).toEqual(
      ordenado(buildPresetDefaults("gestor").internalPages)
    );
  });

  it("usuário cliente não muda: views e telas seguem como antes", () => {
    const cliente = buildManagedClaims({ role: "client", accessPreset: "client_manager", clientIds: ["tinge-brasil"] });
    expect(mergeManagedClaims({}, cliente)).toEqual(cliente);
  });

  it.each(INTERNOS)("preset %s: a tela (frontend) devolve as mesmas telas padrão quando a lista falta", (preset) => {
    expect(ordenado(normalizeInternalPagesTela(undefined, false, preset))).toEqual(ordenado(buildPresetDefaults(preset).internalPages));
    expect(ordenado(buildPresetDefaultsTela(preset).internalPages)).toEqual(ordenado(buildPresetDefaults(preset).internalPages));
  });
});
