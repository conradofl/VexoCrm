// "Gera o contrato do cliente X no valor de Y" com a IA fora do ar: a contingência por texto cai na ferramenta de contrato
// (gerar_contrato_gomes). O texto analisado era `typeof userText !== "undefined" ? userText : (typeof promptUsuario ...)`,
// copiado entre a função de texto e a de voz (cada uma só tem uma das duas variáveis); agora cada uma usa a sua.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/evolution.js", async (original) => ({
  ...(await original()),
  sendTextMessageViaEvolution: vi.fn(async () => ({ key: { id: "msg" } })),
}));

import { processarMensagemHeloisa, processarVozHeloisa } from "../domains/goclaw/heloisaEngine.js";

const pool = () => ({ query: vi.fn(async () => ({ rows: [] })) });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Wandinha: contrato pela contingência, com a IA fora do ar", () => {
  it("[texto] a frase vira gerar_contrato_gomes com o cliente e o valor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ia fora"); }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await processarMensagemHeloisa({ phone: "5534997817660", texto: "gera o contrato do cliente Acme Ltda no valor de 5000", pool: pool() });
    const tool = res.toolResults?.find((t) => t.name === "gerar_contrato_gomes");
    expect(tool).toBeDefined();
    expect(tool.resultado).toMatchObject({ clienteNome: "Acme Ltda" });
  });

  it("[voz] a mesma frase dita por voz também vira gerar_contrato_gomes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ia fora"); }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = pool();
    p.query.mockImplementation(async (sql) => (String(sql).includes("heloisa_config") ? { rows: [{ valor: { ativo: true } }] } : { rows: [] }));
    const res = await processarVozHeloisa({ text: "gera o contrato do cliente Acme Ltda no valor de 5000", pool: p, goclawDir: "/tmp/inexistente" });
    const nomes = (res.executedTools || []).map((t) => t.name || t.tool || t.ferramenta || t);
    expect(JSON.stringify(nomes)).toContain("gerar_contrato_gomes");
  });
});
