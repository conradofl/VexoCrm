// backend/src/test/measureAgentChipSelector.test.js
import { describe, it, expect } from "vitest";
import { checkInstanceMatch } from "../scripts/measureAgentChipSelector.js";

describe("measureAgentChipSelector helper logic", () => {
  const chips = [
    {
      id: "uuid-chip-1",
      name: "4343-ATENDIMENTO",
      dispatch_webhook_url: "https://evo.vexo.io/message/sendText/bia-spazio-4343",
      active: true,
    },
    {
      id: "uuid-chip-2",
      name: "2222 - eleição",
      dispatch_webhook_url: "https://evo.vexo.io/message/sendText/bia-spazio-2222",
      active: true,
    },
    {
      id: "uuid-chip-3",
      name: "Chip Sem Webhook",
      dispatch_webhook_url: null,
      active: true,
    },
  ];

  it("casar por UUID exato", () => {
    const match = checkInstanceMatch("uuid-chip-1", chips);
    expect(match).not.toBeNull();
    expect(match.name).toBe("4343-ATENDIMENTO");
  });

  it("casar por nome exato", () => {
    const match = checkInstanceMatch("4343-ATENDIMENTO", chips);
    expect(match).not.toBeNull();
    expect(match.id).toBe("uuid-chip-1");
  });

  it("casar por slug técnico derivado da URL de webhook", () => {
    const match = checkInstanceMatch("bia-spazio-4343", chips);
    expect(match).not.toBeNull();
    expect(match.name).toBe("4343-ATENDIMENTO");
  });

  it("detectar vínculo órfão quando instância não existe em chips", () => {
    const match = checkInstanceMatch("instancia-antiga-deletada", chips);
    expect(match).toBeNull();
  });

  it("ignorar nulo ou vazio", () => {
    expect(checkInstanceMatch(null, chips)).toBeNull();
    expect(checkInstanceMatch("", chips)).toBeNull();
  });
});
