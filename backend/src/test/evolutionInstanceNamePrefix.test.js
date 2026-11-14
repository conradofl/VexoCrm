// Nome da instância Evolution montado com o prefixo da empresa (buildEvolutionManagedInstanceName).
// Em 12/11/2026 o log de produção mostrou a instância "container-led-container-led": chip com o nome igual ao da empresa
// recebia o prefixo de novo, porque a guarda só reconhecia "<empresa>-...".
import { describe, expect, it } from "vitest";
import { buildEvolutionManagedInstanceName } from "../services/evolution.js";

describe("buildEvolutionManagedInstanceName", () => {
  it("[OBRIGATÓRIO] nome igual ao da empresa não ganha o prefixo duas vezes", () => {
    expect(buildEvolutionManagedInstanceName("container-led", "container-led")).toBe("container-led");
    expect(buildEvolutionManagedInstanceName("container-led", "Container LED")).toBe("container-led");
  });

  it("nome que já começa com a empresa fica como está; nome sem prefixo ganha o prefixo uma vez", () => {
    expect(buildEvolutionManagedInstanceName("container-led", "container-led-atendimento")).toBe("container-led-atendimento");
    expect(buildEvolutionManagedInstanceName("container-led", "Chip de Disparo - Atendimento")).toBe("container-led-chip-de-disparo-atendimento");
  });

  it("empresa que é só o começo de outra palavra não conta como prefixo", () => {
    expect(buildEvolutionManagedInstanceName("container", "containerled")).toBe("container-containerled");
  });
});
