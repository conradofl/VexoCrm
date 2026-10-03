// src/test/viewModeLib.test.ts
//
// A regra pura do modo de exibição (lib/viewMode.ts): o que fica lembrado, sob qual chave, o que vale em tela
// estreita e o que acontece com valor corrompido ou storage bloqueado.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  NARROW_BREAKPOINT_PX,
  effectiveViewMode,
  isNarrowWidth,
  readViewMode,
  viewModeStorageKey,
  writeViewMode,
} from "../lib/viewMode";

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("modo de exibição", () => {
  it("[TESTE OBRIGATÓRIO] sem escolha nenhuma, o padrão é cartão (nunca começa em lista)", () => {
    expect(readViewMode("campanhas")).toBe("card");
  });

  it("[TESTE OBRIGATÓRIO] a escolha é lembrada por aba, sob chaves diferentes", () => {
    writeViewMode("campanhas", "list");
    writeViewMode("contratos", "card");

    expect(readViewMode("campanhas")).toBe("list");
    expect(readViewMode("contratos")).toBe("card");
    expect(viewModeStorageKey("campanhas")).not.toBe(viewModeStorageKey("contratos"));
    expect(readViewMode("propostas")).toBe("card"); // quem não escolheu não herda
  });

  it("valor corrompido ou desconhecido cai no padrão, sem quebrar", () => {
    window.localStorage.setItem(viewModeStorageKey("campanhas"), "{não é json");
    expect(readViewMode("campanhas")).toBe("card");
    window.localStorage.setItem(viewModeStorageKey("campanhas"), JSON.stringify("tabela"));
    expect(readViewMode("campanhas")).toBe("card");
  });

  it("a escolha antiga (de antes do alternador único) vale enquanto não houver a nova — e a nova vence", () => {
    const legacy = { key: "gd_contratos_view", map: (raw: string) => (raw === "list" ? ("list" as const) : raw === "grid" ? ("card" as const) : null) };
    window.localStorage.setItem("gd_contratos_view", JSON.stringify("list"));

    expect(readViewMode("contratos", legacy)).toBe("list");
    writeViewMode("contratos", "card");
    expect(readViewMode("contratos", legacy)).toBe("card");
  });

  it("storage bloqueado: lê o padrão e gravar não explode", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });

    expect(readViewMode("campanhas")).toBe("card");
    expect(() => writeViewMode("campanhas", "list")).not.toThrow();
  });
});

describe("tela estreita", () => {
  it("[TESTE OBRIGATÓRIO] em tela estreita o modo é sempre cartão, seja qual for a preferência; em tela larga vale a preferência", () => {
    expect(effectiveViewMode("list", true)).toBe("card");
    expect(effectiveViewMode("card", true)).toBe("card");
    expect(effectiveViewMode("list", false)).toBe("list");
    expect(effectiveViewMode("card", false)).toBe("card");
  });

  it("o ponto de corte é o do app (768px): 767 é estreita, 768 já comporta a lista", () => {
    expect(NARROW_BREAKPOINT_PX).toBe(768);
    expect(isNarrowWidth(375)).toBe(true);
    expect(isNarrowWidth(767)).toBe(true);
    expect(isNarrowWidth(768)).toBe(false);
    expect(isNarrowWidth(1280)).toBe(false);
  });
});
