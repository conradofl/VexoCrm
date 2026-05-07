import { describe, expect, it } from "vitest";
import { parseLeadQualificacaoBoolean } from "../leadQualificacaoBoolean.js";

describe("parseLeadQualificacaoBoolean", () => {
  it("matches conversation-memory-latest Edge semantics", () => {
    expect(parseLeadQualificacaoBoolean(true)).toBe(true);
    expect(parseLeadQualificacaoBoolean(false)).toBe(false);
    expect(parseLeadQualificacaoBoolean("true")).toBe(true);
    expect(parseLeadQualificacaoBoolean("=true")).toBe(true);
    expect(parseLeadQualificacaoBoolean("TRUE")).toBe(true);
    expect(parseLeadQualificacaoBoolean(null)).toBe(false);
    expect(parseLeadQualificacaoBoolean("")).toBe(false);
  });
});
