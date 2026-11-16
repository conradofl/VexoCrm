// Página "trafego" e permissão "trafego.view" no frontend. A lista tipada de access.ts já
// descartou chave nova uma vez: chave que não está em INTERNAL_PAGE_ORDER some do perfil de
// quem a tem concedida, e a rota fica barrada para todo mundo que não é admin.
import { describe, expect, it } from "vitest";
import {
  ACCESS_PERMISSION_DEFINITIONS,
  INTERNAL_PAGE_ORDER,
  isInternalPageAllowed,
  normalizeInternalPages,
} from "@/lib/access";
import { INTERNAL_PAGE_HIERARCHY } from "@/lib/INTERNAL_PAGE_HIERARCHY";
import { TRAFEGO_ITEMS, TRAFFIC_PILOT_CLIENT_IDS } from "@/lib/appSidebar/constants";

describe("página Tráfego nas listas de acesso", () => {
  it("a página concedida sobrevive à normalização do perfil", () => {
    expect(INTERNAL_PAGE_ORDER).toContain("trafego");
    const pages = normalizeInternalPages(["dashboard", "trafego", "pagina-que-nao-existe"]);
    expect(pages).toEqual(["dashboard", "trafego"]);
    expect(isInternalPageAllowed(pages, "trafego")).toBe(true);
    expect(isInternalPageAllowed(["dashboard"], "trafego")).toBe(false);
  });

  it("a permissão tem rótulo e a página aparece na árvore de concessão", () => {
    expect(ACCESS_PERMISSION_DEFINITIONS["trafego.view"].label).toBe("Gestor de Tráfego");
    const keys = INTERNAL_PAGE_HIERARCHY.flatMap((group) => group.children.map((child) => child.key));
    expect(keys).toContain("trafego");
  });

  it("o item do menu aponta para a rota e só aparece no piloto", () => {
    expect(TRAFEGO_ITEMS).toEqual([expect.objectContaining({ key: "trafego", url: "/crm/trafego", page: "trafego" })]);
    expect(TRAFFIC_PILOT_CLIENT_IDS).toEqual(["geracao-digital"]);
  });
});
