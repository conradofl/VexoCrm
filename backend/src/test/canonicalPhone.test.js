// backend/src/test/canonicalPhone.test.js
//
// Prova, não teste verde — o EXISTS que calcula "respondeu" (a base de
// repliedCount E replyRate, o número mais citado do relatório de
// mensagens) comparava telefone cru: lead_messages.phone vem do webhook da
// Evolution (sempre com DDI 55), campaign_dispatch_runs.phone vem do
// telefone do lead no disparo (pode não trazer DDI). Mesmo defeito nº1 já
// corrigido na coluna de temperatura, esquecido na de resposta.

import { describe, expect, it } from "vitest";
import { toCanonicalPhone, phoneMatches } from "../services/canonicalPhone.js";
import { buildMessageEffectivenessSql } from "../domains/campaigns/routes.js";

describe("phoneMatches — telefone cru OR canônico", () => {
  it("[TESTE OBRIGATÓRIO] run com telefone sem DDI e mensagem inbound com DDI conta como a mesma pessoa", () => {
    const runPhone = "34987654321"; // campaign_dispatch_runs.phone, sem DDI
    const messagePhone = "5534987654321"; // lead_messages.phone, do webhook da Evolution, com DDI

    // A comparação crua (o que a query fazia antes da correção) é falsa —
    // é exatamente por isso que repliedCount subcontava. Se este assert
    // falhasse (ou seja, se as duas strings fossem iguais cruas), o teste
    // de baixo não estaria provando nada.
    expect(runPhone === messagePhone).toBe(false);

    // Com a correção (crua OR canônica), casam.
    expect(phoneMatches(runPhone, messagePhone)).toBe(true);
    expect(toCanonicalPhone(runPhone)).toBe(toCanonicalPhone(messagePhone));
  });

  it("telefone já no mesmo formato continua batendo pela comparação crua (não regride o caso comum)", () => {
    expect(phoneMatches("5534987654321", "5534987654321")).toBe(true);
  });

  it("telefones de pessoas diferentes não casam", () => {
    expect(phoneMatches("34987654321", "34987654322")).toBe(false);
  });

  it("[TESTE OBRIGATÓRIO] run com telefone vazio não conta como respondido, mesmo existindo mensagem com telefone vazio", () => {
    // campaign_dispatch_runs grava phone || '' — run sem telefone vira
    // string vazia, não null. '' === '' é true em JS (e '' = '' também é
    // true em SQL) — sem a guarda, dois vazios "respondem" um ao outro.
    expect(phoneMatches("", "")).toBe(false);
  });

  it("null nunca casa com null — espelha NULL = NULL do SQL, que nunca é verdadeiro", () => {
    expect(phoneMatches(null, null)).toBe(false);
    expect(phoneMatches(null, "5534987654321")).toBe(false);
    expect(phoneMatches("5534987654321", null)).toBe(false);
  });
});

describe("buildMessageEffectivenessSql — o EXISTS de 'respondeu' também canonicaliza (não só a temperatura)", () => {
  it("[TESTE OBRIGATÓRIO] o EXISTS usa telefone cru OR canônico dos dois lados, não igualdade crua sozinha", () => {
    const sql = buildMessageEffectivenessSql(true);
    const existsBlock = sql.slice(sql.indexOf("EXISTS ("), sql.indexOf("AS replied"));

    // a comparação crua continua (caso comum, usa índice)...
    expect(existsBlock).toContain("lm.phone = r.phone");
    // ...mas em OR com a canonicalizada dos dois lados — não só uma comparação crua sozinha
    expect(existsBlock).toMatch(/lm\.phone = r\.phone OR .*=.*\)/s);
    expect(existsBlock).toContain("length(regexp_replace(lm.phone");
    expect(existsBlock).toContain("length(regexp_replace(r.phone");
  });

  it("[TESTE OBRIGATÓRIO] runs exclui telefone vazio antes de calcular 'respondeu' — '' = '' não pode contar", () => {
    const sql = buildMessageEffectivenessSql(true);
    const runsBlock = sql.slice(sql.indexOf("WITH runs AS"), sql.indexOf("lead_by_phone AS ("));
    expect(runsBlock).toContain("r.phone <> ''");
  });
});
