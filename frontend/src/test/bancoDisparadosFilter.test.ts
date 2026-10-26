import { describe, expect, it } from "vitest";
import { filterParams, type LeadListFilters } from "../lib/leads/leadListApi";

describe("Filtro de disparos no frontend (leadListApi)", () => {
  it("não inclui parâmetros de disparo quando filters está vazio ou dispatched é 'all'", () => {
    const p1 = filterParams({});
    expect(p1.has("dispatched")).toBe(false);
    expect(p1.has("dispatchedDays")).toBe(false);

    const p2 = filterParams({ dispatched: "all" });
    expect(p2.has("dispatched")).toBe(false);
    expect(p2.has("dispatchedDays")).toBe(false);
  });

  it("monta query param dispatched=never", () => {
    const filters: LeadListFilters = { dispatched: "never" };
    const p = filterParams(filters);
    expect(p.get("dispatched")).toBe("never");
    expect(p.has("dispatchedDays")).toBe(false);
  });

  it("monta query param dispatched=received", () => {
    const filters: LeadListFilters = { dispatched: "received" };
    const p = filterParams(filters);
    expect(p.get("dispatched")).toBe("received");
    expect(p.has("dispatchedDays")).toBe(false);
  });

  it("monta query param dispatched=recent com dispatchedDays", () => {
    const filters: LeadListFilters = { dispatched: "recent", dispatchedDays: 30 };
    const p = filterParams(filters);
    expect(p.get("dispatched")).toBe("recent");
    expect(p.get("dispatchedDays")).toBe("30");
  });

  it("monta query param dispatched=recent com custom days (ex: 15)", () => {
    const filters: LeadListFilters = { dispatched: "recent", dispatchedDays: 15 };
    const p = filterParams(filters);
    expect(p.get("dispatched")).toBe("recent");
    expect(p.get("dispatchedDays")).toBe("15");
  });
});
