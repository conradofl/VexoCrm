import { afterEach, describe, expect, it } from "vitest";
import { getAdAttribution, readAdAttribution, rememberAdAttribution } from "@/lib/adAttribution";

describe("readAdAttribution", () => {
  it("sem parâmetro de campanha devolve null", () => {
    expect(readAdAttribution("")).toBeNull();
    expect(readAdAttribution("?ref=menu&page=2")).toBeNull();
    expect(readAdAttribution("?utm_source=%20%20")).toBeNull();
  });

  it("copia só as chaves de campanha, com o caminho e a referência", () => {
    expect(
      readAdAttribution("?utm_source=fb&ad_id=123&email=x%40y.com&gclid=Cj0", "/diagnostico", "https://l.facebook.com/")
    ).toEqual({
      utm_source: "fb",
      ad_id: "123",
      gclid: "Cj0",
      landing_path: "/diagnostico",
      referrer: "https://l.facebook.com/",
    });
  });

  it("corta valor gigante", () => {
    const found = readAdAttribution(`?utm_campaign=${"a".repeat(900)}`);
    expect(found?.utm_campaign).toHaveLength(500);
  });
});

describe("rememberAdAttribution / getAdAttribution", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("chegada por anúncio fica guardada e volta depois que a URL perde os parâmetros", () => {
    window.history.replaceState(null, "", "/?utm_source=fb&ad_id=999");
    rememberAdAttribution();
    window.history.replaceState(null, "", "/planos");
    expect(getAdAttribution()).toMatchObject({ utm_source: "fb", ad_id: "999", landing_path: "/" });
  });

  it("sem chegada por anúncio na sessão, nada é inventado", () => {
    rememberAdAttribution();
    expect(getAdAttribution()).toBeNull();
  });

  it("chegada nova com parâmetros vale mais que a guardada", () => {
    window.history.replaceState(null, "", "/?utm_source=fb&ad_id=1");
    rememberAdAttribution();
    window.history.replaceState(null, "", "/?utm_source=google&gclid=Cj0");
    expect(getAdAttribution()).toMatchObject({ utm_source: "google", gclid: "Cj0" });
    expect(getAdAttribution()?.ad_id).toBeUndefined();
  });

  it("valor guardado corrompido não quebra o envio", () => {
    window.sessionStorage.setItem("vexo:ad-attribution", "{nao-e-json");
    expect(getAdAttribution()).toBeNull();
  });
});
