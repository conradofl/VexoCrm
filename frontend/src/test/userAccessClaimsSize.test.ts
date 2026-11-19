// Cadastrar ou alterar usuário para Gestor era bloqueado pela própria tela (19/11/2026):
// "Este conjunto de permissões é grande demais para o perfil de autenticação."
// A tela estimava 1262 bytes para o preset Gestor (limite 950) porque contava a lista de telas internas
// inteira, que o servidor não grava quando é a do preset, e a matriz granular, que usuário interno não envia.
import { describe, expect, it } from "vitest";
import { buildPresetDefaults, internalPagesForStorage, type InternalPage } from "@/lib/access";
import { estimateClaimsPayloadSize } from "@/pages/UserAccessManagement";

function draftDoPreset(preset: string, extra: Record<string, unknown> = {}) {
  const defaults = buildPresetDefaults(preset);
  return {
    email: "pessoa@exemplo.com",
    password: "",
    displayName: "Pessoa",
    role: defaults.role,
    accessPreset: preset,
    scopeMode: defaults.scopeMode,
    approvalLevel: defaults.approvalLevel,
    companyName: "VP Litoral Norte",
    clientIds: ["via-permuta-3"],
    allowedViews: [...defaults.allowedViews],
    internalPages: [...defaults.internalPages],
    allowedModules: [],
    permissions: [...defaults.permissions],
    sendPasswordReset: false,
    disabled: false,
    ...extra,
  } as Parameters<typeof estimateClaimsPayloadSize>[0];
}

// Acesso efetivo de um gestor já cadastrado: a tela de edição põe isto em granularPermissions.
const MATRIZ_GRANDE = Array.from({ length: 60 }, (_, i) => `permissao.granular.numero_${i}`);

describe("a tela de acessos estima o tamanho do login igual ao servidor", () => {
  it("Gestor novo, com as telas do preset, fica abaixo de 950", () => {
    expect(estimateClaimsPayloadSize(draftDoPreset("gestor"))).toBeLessThanOrEqual(950);
  });

  it("Gestor existente: a matriz granular não entra na conta (usuário interno não a envia)", () => {
    expect(estimateClaimsPayloadSize(draftDoPreset("gestor", { granularPermissions: MATRIZ_GRANDE }))).toBeLessThanOrEqual(950);
  });

  it("cliente: a matriz granular continua contando, porque é ela que vai para o servidor", () => {
    const semMatriz = estimateClaimsPayloadSize(draftDoPreset("client_manager"));
    const comMatriz = estimateClaimsPayloadSize(draftDoPreset("client_manager", { granularPermissions: MATRIZ_GRANDE }));
    expect(comMatriz).toBeGreaterThan(semMatriz + 500);
  });

  it("telas fora do padrão do preset entram na conta e no login", () => {
    const padrao = buildPresetDefaults("gestor").internalPages;
    expect(internalPagesForStorage("gestor", padrao)).toBeUndefined();
    expect(internalPagesForStorage("gestor", padrao.slice(0, 3))).toEqual(padrao.slice(0, 3));

    const reduzida = estimateClaimsPayloadSize(draftDoPreset("gestor", { internalPages: padrao.slice(0, 3) as InternalPage[] }));
    const padraoTamanho = estimateClaimsPayloadSize(draftDoPreset("gestor"));
    expect(reduzida).toBeGreaterThan(padraoTamanho);
  });
});
