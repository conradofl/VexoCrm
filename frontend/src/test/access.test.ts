import { describe, expect, it } from "vitest";
import {
  buildPresetDefaults,
  getDefaultPresetForRole,
  normalizeAccessPreset,
  normalizeAccessScope,
  normalizePermissions,
} from "@/lib/access";

describe("access model helpers", () => {
  it("returns the expected preset per role", () => {
    expect(getDefaultPresetForRole("internal")).toBe("operador");
    expect(getDefaultPresetForRole("client")).toBe("client_operator");
    expect(getDefaultPresetForRole("pending")).toBe("pending");
  });

  it("normalizes presets without crossing role boundaries", () => {
    expect(normalizeAccessPreset("gestor", "internal")).toBe("gestor");
    expect(normalizeAccessPreset("admin_vexo", "client")).toBe("client_operator");
  });

  it("forces client and pending scope rules", () => {
    expect(normalizeAccessScope("all_clients", "client")).toBe("assigned_clients");
    expect(normalizeAccessScope("assigned_clients", "pending")).toBe("no_client_access");
  });

  it("falls back to preset permissions when none are provided", () => {
    expect(normalizePermissions(undefined, "client", "client_viewer")).toEqual(
      buildPresetDefaults("client_viewer").permissions
    );
  });
});
