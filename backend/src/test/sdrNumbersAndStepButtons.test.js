// Dois defeitos que chegaram no cliente.
//
// 4. UM numero de SDR por tenant. O dono precisa mandar a qualificacao para
//    varios, e vale para os dois agentes.
// 5. O passo com botao de link saiu como sendText: `endpointMode: 'text'`. Nao
//    era disparo congelado nem falta de montagem na continuacao — buttons era
//    DESCARTADO na normalizacao do passo, antes de qualquer envio.

import { describe, expect, it } from "vitest";
import {
  resolveSdrTarget,
  resolveTenantSdrNumbers,
  isValidSdrNumber,
  SDR_MOTIVOS,
} from "../services/sdrTarget.js";
import { normalizeCampaignAnalyticsMeta } from "../campaign-outbound.js";
import {
  shouldEngageInbound,
  INBOUND_SCOPE_ALL,
  INBOUND_SCOPE_LEADS_ONLY,
} from "../services/inboundEngagementPolicy.js";

describe("lista de numeros de SDR", () => {
  it("valida formato: so digitos, 10 a 15", async () => {
    expect(isValidSdrNumber("5534984085015")).toBe(true);
    expect(isValidSdrNumber("(55) 34 98408-5015")).toBe(true); // normaliza antes
    expect(isValidSdrNumber("123")).toBe(false);
    expect(isValidSdrNumber("")).toBe(false);
    expect(isValidSdrNumber("abcdefghijkl")).toBe(false);
  });

  it("resolve varios numeros do tenant", async () => {
    const alvo = await resolveSdrTarget({
      inboundConfig: null,
      tenantSettings: { sdr_whatsapp_numbers: ["5534984085015", "5511999998888"] },
    });
    expect(alvo.numbers).toEqual(["5534984085015", "5511999998888"]);
    expect(alvo.reason).toBe(SDR_MOTIVOS.OK);
  });

  it("MIGRACAO SEM PERDA: tenant com o campo antigo continua recebendo", async () => {
    // Linha ainda nao migrada: a lista esta vazia e o numero unico existe.
    const alvo = await resolveSdrTarget({
      inboundConfig: null,
      tenantSettings: { sdr_whatsapp_numbers: [], sdr_whatsapp_number: "5534984085015" },
    });
    expect(alvo.numbers).toEqual(["5534984085015"]);
  });

  it("descarta invalido e repetido da lista", async () => {
    const numeros = resolveTenantSdrNumbers({
      sdr_whatsapp_numbers: ["5534984085015", "123", "", "5534984085015", "(55) 11 99999-8888"],
    });
    expect(numeros).toEqual(["5534984085015", "5511999998888"]);
  });

  it("lista vazia devolve motivo claro, nao silencio", async () => {
    const alvo = await resolveSdrTarget({ inboundConfig: null, tenantSettings: { sdr_whatsapp_numbers: [] } });
    expect(alvo.numbers).toEqual([]);
    expect(alvo.reason).toBe(SDR_MOTIVOS.SEM_NUMERO);
  });

  it("transferencia desligada continua vencendo a lista do tenant", async () => {
    const alvo = await resolveSdrTarget({
      inboundConfig: { sdrTransferEnabled: false },
      tenantSettings: { sdr_whatsapp_numbers: ["5534984085015", "5511999998888"] },
    });
    expect(alvo.numbers).toEqual([]);
    expect(alvo.reason).toBe(SDR_MOTIVOS.TRANSFERENCIA_DESLIGADA);
  });
});

// Simula o laco de envio do webhook: cada numero tem o proprio try/catch.
async function enviarParaTodos(numeros, enviar) {
  const falhas = [];
  let enviados = 0;
  for (const numero of numeros) {
    try {
      await enviar(numero);
      enviados += 1;
    } catch (err) {
      falhas.push({ numero, erro: err.message });
    }
  }
  return { enviados, falhas };
}

describe("entrega do briefing para varios numeros", () => {
  it("dois numeros: os dois recebem", async () => {
    const recebidos = [];
    const r = await enviarParaTodos(["5534984085015", "5511999998888"], async (n) => {
      recebidos.push(n);
    });
    expect(recebidos).toHaveLength(2);
    expect(r.enviados).toBe(2);
    expect(r.falhas).toHaveLength(0);
  });

  it("um falha: o outro recebe e a falha e registrada", async () => {
    const recebidos = [];
    const r = await enviarParaTodos(["5534984085015", "5511999998888"], async (n) => {
      if (n === "5534984085015") throw new Error("HTTP 500");
      recebidos.push(n);
    });
    expect(recebidos).toEqual(["5511999998888"]);
    expect(r.enviados).toBe(1);
    expect(r.falhas).toHaveLength(1);
    expect(r.falhas[0].erro).toBe("HTTP 500");
  });
});

describe("botoes do passo sobrevivem a normalizacao", () => {
  const passoComBotao = {
    id: "s2",
    type: "text",
    order: 2,
    text: "Acesse o link",
    triggerMode: "after_reply",
    enabled: true,
    buttons: [{ type: "url", displayText: "Link de Acesso", url: "https://vexoia.com/x" }],
  };

  it("buttons NAO e descartado — era este o defeito", async () => {
    const meta = normalizeCampaignAnalyticsMeta({ sequence: [passoComBotao] });
    const passo = meta.sequence[0];
    expect(Array.isArray(passo.buttons)).toBe(true);
    expect(passo.buttons).toHaveLength(1);
    expect(passo.buttons[0].url).toBe("https://vexoia.com/x");
    expect(passo.buttons[0].type).toBe("url");
  });

  it("vale para o passo after_reply, que e o da continuacao apos resposta", async () => {
    // A continuacao reusa dispatchCampaignSequence, que normaliza a sequencia
    // do mesmo jeito: preservar aqui conserta os dois caminhos de uma vez.
    const meta = normalizeCampaignAnalyticsMeta({ sequence: [passoComBotao] });
    expect(meta.sequence[0].triggerMode).toBe("after_reply");
    expect(meta.sequence[0].buttons[0].displayText).toBe("Link de Acesso");
  });

  it("aceita o shape antigo (label/href) sem reescrever", async () => {
    const meta = normalizeCampaignAnalyticsMeta({
      sequence: [{ ...passoComBotao, buttons: [{ label: "Abrir", href: "https://x.com" }] }],
    });
    const btn = meta.sequence[0].buttons[0];
    expect(btn.type).toBe("url");
    expect(btn.url).toBe("https://x.com");
    expect(btn.displayText).toBe("Abrir");
  });

  it("passo sem botao continua com lista vazia", async () => {
    const meta = normalizeCampaignAnalyticsMeta({
      sequence: [{ id: "s1", type: "text", order: 1, text: "oi", enabled: true }],
    });
    expect(meta.sequence[0].buttons).toEqual([]);
  });
});

describe("o loop do alerta de SDR nao pode voltar", () => {
  it("alerta NUNCA vai para o telefone da propria conversa", async () => {
    // Foi assim que o loop voltou: com o destino virando lista, um dos numeros
    // era o da conversa, o alerta chegava de volta como inbound e disparava
    // outro alerta.
    const alvo = await resolveSdrTarget({
      inboundConfig: null,
      tenantSettings: { sdr_whatsapp_numbers: ["5534984085015", "5534997817660"] },
      excludeNumbers: ["5534997817660"],
    });
    expect(alvo.numbers).toEqual(["5534984085015"]);
    expect(alvo.excluded).toEqual(["5534997817660"]);
  });

  it("todos os destinos excluidos: motivo proprio, nao 'sem numero'", async () => {
    const alvo = await resolveSdrTarget({
      inboundConfig: null,
      tenantSettings: { sdr_whatsapp_numbers: ["5534997817660"] },
      excludeNumbers: ["5534997817660"],
    });
    expect(alvo.numbers).toEqual([]);
    expect(alvo.reason).toBe(SDR_MOTIVOS.TODOS_EXCLUIDOS);
    expect(alvo.reason).not.toBe(SDR_MOTIVOS.SEM_NUMERO);
  });

  it("inbound vindo do numero do SDR nao vira conversa de lead", async () => {
    const decisao = shouldEngageInbound({
      scope: INBOUND_SCOPE_LEADS_ONLY,
      isKnownLead: true,
      hasCampaignMatch: true,
      isSdrNumber: true,
    });
    expect(decisao.engage).toBe(false);
    expect(decisao.reason).toBe("numero_e_do_sdr");
  });

  it("a trava do SDR vale INCLUSIVE no escopo 'all'", async () => {
    // "all" e sobre quem o cliente quer atender; nao autoriza o bot a conversar
    // com a propria notificacao.
    const decisao = shouldEngageInbound({
      scope: INBOUND_SCOPE_ALL,
      isKnownLead: false,
      hasCampaignMatch: false,
      isSdrNumber: true,
    });
    expect(decisao.engage).toBe(false);
  });
});
