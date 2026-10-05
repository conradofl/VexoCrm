// backend/src/test/dispatchCallContract.test.js
//
// CONTRATO DAS CHAMADAS DE dispatchCampaignSequence em domains/campaigns/routes.js.
//
// Em 28/08/2026 o commit a44a1b6 ("fix(sync-outbound): sync incremental com timestamp, throttle…") removeu a linha
// `chipProvider,` da chamada da fila, ao lado da linha que o commit reescrevia. A cota de chip deixou de existir no
// disparo e ninguém viu por cinco semanas: o teste e2e do mesmo commit passava COM e SEM a linha. Este teste fixa as
// chaves obrigatórias de cada chamada para que remover um argumento — mesmo num commit "de outro assunto" — quebre o CI.
//
// Não prova o COMPORTAMENTO de cada chave (isso é dos testes de cota/claim/falha); prova que elas continuam sendo passadas.
// Mudar uma chamada de propósito exige mudar a lista aqui, no mesmo commit, à vista de quem revisa.

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(resolve("src/domains/campaigns/routes.js"), "utf8");

/** Chaves de primeiro nível do objeto passado a cada `dispatchCampaignSequence({ ... })`, na ordem em que aparecem. */
export function topLevelKeysOfDispatchCalls(source) {
  const chamadas = [];
  const re = /\bdispatchCampaignSequence\(\{/g;
  let m;
  while ((m = re.exec(source))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < source.length && depth > 0) {
      const c = source[i];
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      i += 1;
    }
    const bloco = source.slice(re.lastIndex, i - 1);
    const chaves = new Set();
    let nivel = 0;
    for (const linha of bloco.split("\n")) {
      if (nivel === 0) {
        const k = linha.match(/^\s*([A-Za-z_$][\w$]*)\s*(?:[,:(]|$)/);
        if (k && !["const", "let", "if", "return", "await", "async"].includes(k[1])) chaves.add(k[1]);
      }
      nivel += (linha.match(/[{(\[]/g) || []).length - (linha.match(/[})\]]/g) || []).length;
    }
    chamadas.push(chaves);
  }
  return chamadas;
}

const chamadas = topLevelKeysOfDispatchCalls(SRC);
const fila = chamadas.find((c) => c.has("onLeadClaim"));
const demais = chamadas.filter((c) => c !== fila);

describe("contrato das chamadas de dispatchCampaignSequence", () => {
  it("existem exatamente 3 chamadores (envio manual, envio direto e a fila); um quarto exige decisão consciente", () => {
    expect(chamadas).toHaveLength(3);
    expect(fila).toBeDefined();
    expect(demais).toHaveLength(2);
  });

  it("[TESTE OBRIGATÓRIO] a chamada da FILA passa todas as chaves obrigatórias", () => {
    const obrigatorias = [
      "webhookUrl", // por onde o disparo envia
      "webhookToken",
      "leads",
      "analyticsMeta",
      "context",
      "onLeadClaim", // claim idempotente antes do envio (sem ele, reenvio)
      "onLeadClaimRollback", // devolve o lead à fila quando o chip cai
      "onLeadFailed", // fecha o lead como failed/invalid_number
      "onLeadDispatched", // fecha o lead como sent (sem isso nada vira 'sent')
      "onStepDispatched", // grava a mensagem e o chip que enviou
      "quotaGate", // cota diária por mensagem (a que sumiu em 28/08)
      "shouldContinue", // pausa/cancelamento do lote e janela de envio
      "leadDelayProvider", // intervalo entre leads (anti-ban)
    ];
    const faltando = obrigatorias.filter((k) => !fila.has(k));
    expect(faltando, `a chamada da fila perdeu: ${faltando.join(", ")}`).toEqual([]);
  });

  it("[TESTE OBRIGATÓRIO] o envio manual e o envio direto passam o portão de cota e o essencial", () => {
    for (const [i, chaves] of demais.entries()) {
      for (const k of ["webhookUrl", "webhookToken", "leads", "analyticsMeta", "context", "quotaGate"]) {
        expect(chaves.has(k), `chamada ${i === 0 ? "manual" : "direta"} sem '${k}'`).toBe(true);
      }
    }
  });

  it("o leitor de chaves enxerga uma remoção (o defeito que este teste existe para pegar)", () => {
    const sem = SRC.replace(/\n\s+quotaGate,\n(\s+leads: validLeads,)/, "\n$1");
    expect(sem).not.toBe(SRC); // a linha foi de fato removida

    const filaSem = topLevelKeysOfDispatchCalls(sem).find((c) => c.has("onLeadClaim"));

    expect(filaSem.has("quotaGate")).toBe(false);
    expect(fila.has("quotaGate")).toBe(true);
  });

  it("chaves que o laço de envio realmente lê: toda chave passada existe na assinatura de dispatchCampaignSequence", () => {
    const outbound = readFileSync(resolve("src/campaign-outbound.js"), "utf8");
    const assinatura = outbound.slice(outbound.indexOf("export async function dispatchCampaignSequence({"), outbound.indexOf("}) {", outbound.indexOf("export async function dispatchCampaignSequence({")));
    for (const chaves of chamadas) {
      for (const k of chaves) expect(assinatura, `'${k}' é passado mas o laço não o declara (seria ignorado em silêncio)`).toMatch(new RegExp(`\\b${k}\\b`));
    }
  });
});
