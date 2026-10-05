import { describe, expect, it } from "vitest";
import { buildN8nSettingsPayload, normalizeSendWindowTimezone } from "../services/n8nSettings.js";

const AUTH = { uid: "u", email: "e@x" };
const salvar = (input, existing = null) => buildN8nSettingsPayload({ client_id: "t", ...input }, AUTH, existing).send_window_timezone;

describe("fuso da janela de envio é validado ao SALVAR (a coluna não guarda mais lixo)", () => {
  it("fuso válido é mantido (camelCase e snake_case)", () => {
    expect(salvar({ sendWindowTimezone: "America/Manaus" })).toBe("America/Manaus");
    expect(salvar({ send_window_timezone: "Europe/Lisbon" })).toBe("Europe/Lisbon");
    expect(salvar({ sendWindowTimezone: "  America/Recife  " })).toBe("America/Recife");
  });

  it("[TESTE OBRIGATÓRIO] fuso inválido, vazio ou que não é texto vira America/Sao_Paulo — nunca é gravado como veio", () => {
    expect(salvar({ sendWindowTimezone: "Marte/Olympus" })).toBe("America/Sao_Paulo");
    expect(salvar({ sendWindowTimezone: "" })).toBe("America/Sao_Paulo");
    expect(salvar({ sendWindowTimezone: "   " })).toBe("America/Sao_Paulo");
    expect(salvar({ sendWindowTimezone: 42 })).toBe("America/Sao_Paulo");
    expect(salvar({ sendWindowTimezone: null })).toBe("America/Sao_Paulo");
    expect(salvar({ sendWindowTimezone: "'; DROP TABLE x; --" })).toBe("America/Sao_Paulo");
  });

  it("não reenviado: o fuso já gravado é mantido se válido e SANEADO se for lixo antigo", () => {
    expect(salvar({}, { send_window_timezone: "America/Manaus" })).toBe("America/Manaus");
    expect(salvar({}, { send_window_timezone: "Marte/Olympus" })).toBe("America/Sao_Paulo");
    expect(salvar({}, { send_window_timezone: null })).toBe("America/Sao_Paulo");
    // sem o registro atual e sem o campo no pedido, a coluna é OMITIDA do upsert (comportamento já existente: não toca no que o
    // cliente não mandou) — então nada é gravado, e portanto nenhum lixo
    expect(salvar({}, null)).toBeUndefined();
    expect(salvar({ sendWindowTimezone: "Marte/Olympus" }, null)).toBe("America/Sao_Paulo");
  });

  it("a validação é a mesma de resolveSendWindowConfig (uma regra só)", () => {
    expect(normalizeSendWindowTimezone("America/Sao_Paulo")).toBe("America/Sao_Paulo");
    expect(normalizeSendWindowTimezone("nao-existe")).toBe("America/Sao_Paulo");
    expect(normalizeSendWindowTimezone(undefined)).toBe("America/Sao_Paulo");
  });
});
