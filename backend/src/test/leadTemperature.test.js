// backend/src/test/leadTemperature.test.js
//
// Prova, não teste verde — os defeitos apontados nas revisões do
// message-effectiveness, cada um com um cenário real que falha sem a
// correção:
//   1. telefone sem DDI (lead importado) vs telefone com DDI (run da
//      Evolution) — sem canonicalizar, nunca casam.
//   2. lead_temperature NULL + temperature='hot' — ler só a primeira
//      coluna erra a classificação de quem veio de planilha.
//   3. dois leads com o mesmo telefone — sem dedup, duplica o run que
//      respondeu; quente+morno+frio+semClassificacao tem que fechar com
//      repliedCount sempre, em qualquer entrada.
//   4. `temperature='warm'` é o DEFAULT da coluna (lead-client-tables.js) e
//      o que o importador grava quando a planilha não traz nada
//      (leads/routes.js) — não é sinal de "morno". Não existe como
//      distinguir um 'warm' escolhido de um 'warm' default, então nenhum
//      dos dois pode contar. Só MORNO vindo de lead_temperature conta.
//   5. valor fora da whitelist (QUENTE/MORNO/FRIO/hot/cold), nas duas
//      colunas, tem que virar "sem classificação" — nunca sumir da soma.
//
// Nota de honestidade: não há Postgres alcançável neste ambiente (o
// DATABASE_URL aponta pro servidor antigo, fora do ar) nem um engine local
// que rode a EXISTS correlacionada que a query usa (testado com pg-mem —
// não suporta subquery correlacionada). A prova aqui é sobre o ALGORITMO,
// em JavaScript que espelha fielmente a SQL — mesmo padrão já usado por
// toCanonicalPhone/SQL_CANONICAL_PHONE em canonicalPhone.js. Um teste
// estrutural separado (campaignMessageEffectiveness.test.js) confirma que a
// query de verdade é CONSTRUÍDA com essas mesmas peças, com whitelist
// fechada — não UPPER(NULLIF(...)) solto.

import { describe, expect, it } from "vitest";
import { toCanonicalPhone } from "../services/canonicalPhone.js";
import { resolveLeadTemperatureBucket, aggregateRepliedTemperatures } from "../services/leadTemperature.js";

describe("canonicalização de telefone — defeito 1", () => {
  it("[TESTE OBRIGATÓRIO] telefone sem DDI (lead importado) e com DDI (run da Evolution) canonicalizam pro mesmo valor", () => {
    // Lead gravado pela importação sem o 55 — comum em planilha de cliente.
    const leadTelefone = "34987654321"; // 11 dígitos, sem DDI
    // Telefone que a Evolution manda no run — com DDI.
    const runPhone = "5534987654321"; // 13 dígitos, com DDI

    expect(toCanonicalPhone(leadTelefone)).toBe(toCanonicalPhone(runPhone));

    // Prova que NÃO é regexp_replace cru disfarçado: sem canonicalizar, as
    // duas strings continuariam diferentes (tamanhos diferentes).
    expect(leadTelefone).not.toBe(runPhone);
  });

  it("também casa quando o lead tem DDI mas falta o 9º dígito", () => {
    const leadTelefone = "553487654321"; // 12 dígitos, DDI sem o 9
    const runPhone = "5534987654321"; // 13 dígitos, DDI com o 9
    expect(toCanonicalPhone(leadTelefone)).toBe(toCanonicalPhone(runPhone));
  });
});

describe("resolveLeadTemperatureBucket — defeitos 2, 4 e 5", () => {
  it("[TESTE OBRIGATÓRIO] lead_temperature NULL + temperature='hot' conta como QUENTE (defeito 2)", () => {
    expect(resolveLeadTemperatureBucket(null, "hot")).toBe("QUENTE");
  });

  it("[TESTE OBRIGATÓRIO] lead_temperature='MORNO' conta como MORNO — é escrita por escolha, nunca por default", () => {
    expect(resolveLeadTemperatureBucket("MORNO", null)).toBe("MORNO");
  });

  it("[TESTE OBRIGATÓRIO] lead_temperature NULL + temperature='warm' NÃO conta como morno — 'warm' é o default da coluna, não classificação (defeito 4)", () => {
    expect(resolveLeadTemperatureBucket(null, "warm")).toBeNull();
    // e não é só esse par: 'warm' nunca vira MORNO, com ou sem lead_temperature vazio
    expect(resolveLeadTemperatureBucket("", "warm")).toBeNull();
  });

  it("[TESTE OBRIGATÓRIO] valor sujo fora da whitelist (ex.: 'tepid') não vira classificação nenhuma (defeito 5)", () => {
    expect(resolveLeadTemperatureBucket(null, "tepid")).toBeNull();
    expect(resolveLeadTemperatureBucket("NOVO", null)).toBeNull();
  });

  it("cold conta como frio", () => {
    expect(resolveLeadTemperatureBucket(null, "cold")).toBe("FRIO");
  });

  it("lead_temperature (robô) tem prioridade sobre temperature (importação) quando as duas existem", () => {
    expect(resolveLeadTemperatureBucket("FRIO", "hot")).toBe("FRIO");
  });

  it("sem nenhuma das duas colunas preenchidas, não inventa classificação", () => {
    expect(resolveLeadTemperatureBucket(null, null)).toBeNull();
    expect(resolveLeadTemperatureBucket("", "")).toBeNull();
  });
});

describe("aggregateRepliedTemperatures — defeito 3 (dedup) e a invariante", () => {
  it("[TESTE OBRIGATÓRIO] dois leads com o mesmo telefone contam UMA vez — usa o mais recente", () => {
    const leads = [
      { telefone: "5534910000001", lead_temperature: "FRIO", temperature: null, updated_at: "2026-09-01T00:00:00Z" },
      { telefone: "5534910000001", lead_temperature: "MORNO", temperature: null, updated_at: "2026-09-10T00:00:00Z" }, // mais recente
    ];
    const repliedPhones = ["5534910000001"];

    const result = aggregateRepliedTemperatures(repliedPhones, leads);

    expect(result).toEqual({ quente: 0, morno: 1, frio: 0, semClassificacao: 0 });
    // se não deduplicasse, contaria os dois: frio 1 + morno 1 (soma 2, mas
    // só existe 1 run que respondeu) — é exatamente o "estoura a soma" da
    // revisão.
  });

  it("[TESTE OBRIGATÓRIO] telefone com `phone` preenchido e `telefone` vazio não fica invisível no cruzamento", () => {
    const leads = [
      { telefone: null, phone: "5534910000009", lead_temperature: "QUENTE", temperature: null, updated_at: "2026-09-01T00:00:00Z" },
    ];
    const result = aggregateRepliedTemperatures(["5534910000009"], leads);
    expect(result).toEqual({ quente: 1, morno: 0, frio: 0, semClassificacao: 0 });
  });

  it("[TESTE OBRIGATÓRIO — invariante] quente+morno+frio+semClassificacao == repliedCount, com telefone duplicado, warm-default e valor sujo misturados", () => {
    const leads = [
      // duplicado — só a segunda linha (mais recente) deve contar
      { telefone: "5534910000001", lead_temperature: "FRIO", temperature: null, updated_at: "2026-09-01T00:00:00Z" },
      { telefone: "34910000001", lead_temperature: "MORNO", temperature: null, updated_at: "2026-09-10T00:00:00Z" }, // sem DDI, mesmo telefone
      // lead importado, só `temperature` preenchido
      { telefone: "34910000002", lead_temperature: null, temperature: "hot", updated_at: "2026-09-05T00:00:00Z" },
      // lead nunca tocado pelo robô — temperature='warm' é o DEFAULT, não conta
      { telefone: "34910000003", lead_temperature: null, temperature: "warm", updated_at: "2026-09-05T00:00:00Z" },
      // valor sujo fora da whitelist
      { telefone: "34910000005", lead_temperature: null, temperature: "tepid", updated_at: "2026-09-05T00:00:00Z" },
    ];
    // 6 runs que responderam
    const repliedPhones = [
      "5534910000001",
      "5534910000001", // mesma pessoa, segunda resposta — conta como 2 runs
      "5534910000002",
      "5534910000003", // warm-default → sem classificação
      "5534910000004", // não existe em `leads` → sem classificação
      "5534910000005", // valor sujo → sem classificação
    ];

    const result = aggregateRepliedTemperatures(repliedPhones, leads);
    const repliedCount = repliedPhones.length;

    expect(result.quente + result.morno + result.frio + result.semClassificacao).toBe(repliedCount);
    expect(result).toEqual({ quente: 1, morno: 2, frio: 0, semClassificacao: 3 });
  });

  it("lista vazia de respondentes: soma zero, sem quebrar", () => {
    const result = aggregateRepliedTemperatures([], []);
    expect(result.quente + result.morno + result.frio + result.semClassificacao).toBe(0);
  });
});
