// Fluxo "Enviar após resposta do lead" NO CAMINHO REAL — runCampaignDispatch de
// domains/campaigns/routes.js (fila de campaign_dispatches, acionada pelo scheduler
// e pelo botao). O outro runCampaignDispatch, de campaign/dispatch.js, nao executa.
//
// Ate aqui este caminho mandava TODOS os passos de uma vez, inclusive os
// after_reply, e nunca gravava progresso pendente — por isso o passo 2 nunca
// esperava a resposta e continueCampaignLeadFromReply jamais era alcancado.
//
// O plano de passos vem de getCampaignStepPlan e o progresso de
// markCampaignLeadWaitingReply: as MESMAS funcoes do outro caminho, para nao existir
// uma segunda implementacao da regra.

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { getCampaignStepPlan } from "../campaign-outbound.js";

const source = (readFileSync(resolve("src/domains/campaigns/routes.js"), "utf8") + "\n" + readFileSync(resolve("src/campaign/dispatchEngine.js"), "utf8")) /* motor do lote mora em campaign/dispatchEngine.js desde o PR 8 */;

const PASSO_1 = { id: "s1", type: "text", order: 1, text: "Ola {{nome}}", enabled: true, triggerMode: "immediate" };
const PASSO_2 = { id: "s2", type: "text", order: 2, text: "Vamos agendar?", enabled: true, triggerMode: "after_reply" };

// Espelha a decisao do caminho real: usaFluxoDeResposta + quais passos entram no envio.
function planoDoDisparo(steps, dispatchOptions = { waitForReply: false }) {
  const plan = getCampaignStepPlan({ sequence: steps, dispatchOptions });
  const usaFluxoDeResposta = plan.shouldUseReplyFlow && plan.immediateSteps.length > 0;
  return {
    usaFluxoDeResposta,
    passosDoEnvio: usaFluxoDeResposta ? plan.immediateSteps : plan.enabledSteps,
    primeiroPassoAposResposta: usaFluxoDeResposta ? (plan.replySteps[0]?.index ?? null) : null,
    totalSteps: plan.enabledSteps.length,
  };
}

describe("disparo pela fila: passo imediato + passo after_reply", () => {
  const plano = planoDoDisparo([PASSO_1, PASSO_2]);

  it("liga o fluxo de resposta mesmo com a flag false (derivada da sequencia)", () => {
    expect(plano.usaFluxoDeResposta).toBe(true);
  });

  it("envia SO o passo imediato — o passo 2 nao sai na rajada inicial", () => {
    expect(plano.passosDoEnvio.map((s) => s.id)).toEqual(["s1"]);
    expect(plano.passosDoEnvio.map((s) => s.id)).not.toContain("s2");
  });

  it("aponta o passo 2 como proximo, para a chegada da resposta", () => {
    expect(plano.primeiroPassoAposResposta).toBe(1);
    expect(plano.totalSteps).toBe(2);
  });
});

describe("o que nao pode mudar", () => {
  it("campanha so com passos imediatos continua enviando tudo de uma vez", () => {
    const plano = planoDoDisparo([PASSO_1, { ...PASSO_2, triggerMode: "immediate", id: "s2b" }]);
    expect(plano.usaFluxoDeResposta).toBe(false);
    expect(plano.passosDoEnvio).toHaveLength(2);
  });

  it("passo after_reply desabilitado nao segura o envio", () => {
    const plano = planoDoDisparo([PASSO_1, { ...PASSO_2, enabled: false }]);
    expect(plano.usaFluxoDeResposta).toBe(false);
    expect(plano.passosDoEnvio.map((s) => s.id)).toEqual(["s1"]);
  });

  it("sequencia SO com after_reply nao entra em espera (nao ha o que enviar antes)", () => {
    const plano = planoDoDisparo([PASSO_2]);
    expect(plano.usaFluxoDeResposta).toBe(false);
  });
});

describe("o caminho real usa as funcoes compartilhadas, sem reimplementar", () => {
  it("importa getCampaignStepPlan e markCampaignLeadWaitingReply", () => {
    expect(source).toContain("getCampaignStepPlan,");
    expect(source).toContain('import { markCampaignLeadWaitingReply } from "../../campaign/dispatch.js";');
  });

  it("calcula o plano e restringe os passos do envio", () => {
    expect(source).toContain("const stepPlan = getCampaignStepPlan({ ...campaignMeta, sequence: steps });");
    expect(source).toContain("const usaFluxoDeResposta = stepPlan.shouldUseReplyFlow && stepPlan.immediateSteps.length > 0;");
    expect(source).toContain("sequence: passosDoEnvio,");
  });

  it("grava o progresso pendente no envio bem-sucedido", () => {
    const bloco = source.slice(source.indexOf("onLeadDispatched: async ({ lead, phone, sentAt, lastStep, lastStepIndex })"));
    const trecho = bloco.slice(0, 1600);
    expect(trecho).toContain("markCampaignLeadWaitingReply");
    expect(trecho).toContain('status: "aguardando_usuario"');
    expect(trecho).toContain("nextStepIndex: primeiroPassoAposResposta");
  });

  it("nao existe uma segunda implementacao da separacao de passos neste arquivo", () => {
    // Reimplementar o filtro aqui e o erro que se quer evitar.
    const filtrosLocais = source.match(/filter\(\([^)]*\)\s*=>\s*[^)]*triggerMode\s*!==\s*"after_reply"\)/g) || [];
    expect(filtrosLocais).toHaveLength(0);
  });
});
