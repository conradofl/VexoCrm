// Chips padrão num lugar só (services/defaultInstances.js). Movimento puro: os mesmos valores de antes em cada ponto.
import { execSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  INSTANCIA_PADRAO_VEXO_ADM, INSTANCIA_PADRAO_GD_COMERCIAL, INSTANCIA_TESTE_GD, INSTANCIA_GD_SEM_ENV, INSTANCIA_JURIDICO_SEM_ENV,
  INSTANCIAS_PADRAO_DO_CODIGO, instanciaGdDoEnv,
} from "../services/defaultInstances.js";
import { INSTANCIAS_PADRAO_DO_CODIGO as viaStatus } from "../services/evolutionConfigStatus.js";

const original = process.env.GD_EVOLUTION_INSTANCE;
afterEach(() => {
  if (original === undefined) delete process.env.GD_EVOLUTION_INSTANCE;
  else process.env.GD_EVOLUTION_INSTANCE = original;
});

describe("chips padrão num lugar só", () => {
  it("os valores são os mesmos que estavam escritos no código", () => {
    expect([INSTANCIA_PADRAO_VEXO_ADM, INSTANCIA_PADRAO_GD_COMERCIAL, INSTANCIA_TESTE_GD, INSTANCIA_GD_SEM_ENV, INSTANCIA_JURIDICO_SEM_ENV])
      .toEqual(["vexo-adm-vexo-atende", "geracao-digital-comercial-hostery", "geracao-digital-teste-vexo", "gd-oficial", "Teste"]);
    expect(viaStatus).toBe(INSTANCIAS_PADRAO_DO_CODIGO); // o /health mede a mesma lista
  });

  it("instanciaGdDoEnv: a variável de ambiente vence; sem ela, o fallback do fluxo", () => {
    process.env.GD_EVOLUTION_INSTANCE = "chip-env";
    expect(instanciaGdDoEnv(INSTANCIA_GD_SEM_ENV)).toBe("chip-env");
    delete process.env.GD_EVOLUTION_INSTANCE;
    expect(instanciaGdDoEnv(INSTANCIA_GD_SEM_ENV)).toBe("gd-oficial");
    expect(instanciaGdDoEnv(INSTANCIA_JURIDICO_SEM_ENV)).toBe("Teste");
  });

  it("nenhum outro arquivo do backend escreve esses nomes como string em código (fora de comentário e de SQL de dados)", () => {
    const achados = execSync(
      `git grep -nE '"(vexo-adm-vexo-atende|geracao-digital-comercial-hostery|geracao-digital-teste-vexo)"|GD_EVOLUTION_INSTANCE \\|\\| "' -- 'src/*.js' ':!src/test/*' ':!src/services/defaultInstances.js' || true`,
      { encoding: "utf8" }
    ).split("\n").filter((l) => l && !/:\s*(\/\/|\*)/.test(l));
    expect(achados).toEqual([]);
  });
});
