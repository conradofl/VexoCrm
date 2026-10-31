// backend/src/test/sendErrorRegistraRecusa.test.js
//
// Caso de 31/10/2026 (vexo-adm): POST /api/campaigns/:id/dispatches devolveu 400
// e o servidor nao gravou nada. O motivo so existia no corpo da resposta, que a
// tela jogava fora. sendError passa a deixar uma linha por recusa 4xx/5xx, sem
// corpo, sem token e com telefone mascarado.

import { describe, expect, it, vi, afterEach } from "vitest";
import { sendError } from "../services/httpInfra.js";

const TELEFONE = "5534999887766";

function fakeRes(req) {
  return {
    req,
    statusCode: 200,
    body: null,
    setHeader: vi.fn(),
    getHeader: vi.fn(),
    status(s) { this.statusCode = s; return this; },
    json(b) { this.body = b; return this; },
  };
}

function reqDoDisparo() {
  return {
    method: "POST",
    baseUrl: "",
    route: { path: "/api/campaigns/:id/dispatches" },
    originalUrl: `/api/campaigns/camp-1/dispatches?clientId=vexo-adm&phone=${TELEFONE}`,
    params: { id: "camp-1" },
    query: { clientId: "vexo-adm", phone: TELEFONE },
    headers: { authorization: "Bearer token-secreto-de-teste", origin: "https://app.vexo.com.br" },
    body: { telefone: TELEFONE, sequence: [{ text: "segredo do corpo" }] },
  };
}

function linhasDeRecusa(spy) {
  return spy.mock.calls.filter(([tag]) => tag === "[http] recusa").map(([, linha]) => linha);
}

afterEach(() => vi.restoreAllMocks());

describe("sendError registra a recusa no log", () => {
  it("[TESTE OBRIGATÓRIO] 400 grava status, code, rota, método, clientId e mensagem", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = fakeRes(reqDoDisparo());

    sendError(res, 400, "INVALID_DISPATCH_TEMPLATE", "O passo 1 precisa ter texto ou imagem antes de disparar.");

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DISPATCH_TEMPLATE");
    const [linha] = linhasDeRecusa(warn);
    expect(linha).toEqual({
      status: 400,
      code: "INVALID_DISPATCH_TEMPLATE",
      metodo: "POST",
      rota: "/api/campaigns/:id/dispatches",
      clientId: "vexo-adm",
      mensagem: "O passo 1 precisa ter texto ou imagem antes de disparar.",
    });
  });

  it("[TESTE OBRIGATÓRIO] telefone na mensagem sai mascarado; corpo, token e query não vão para o log", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = fakeRes(reqDoDisparo());

    sendError(res, 422, "LEAD_INVALIDO", `Lead ${TELEFONE} sem consentimento`, { telefone: TELEFONE });

    const [linha] = linhasDeRecusa(warn);
    expect(linha.mensagem).toBe("Lead *********7766 sem consentimento");
    const tudo = JSON.stringify(warn.mock.calls);
    expect(tudo).not.toContain(TELEFONE);
    expect(tudo).not.toContain("token-secreto-de-teste");
    expect(tudo).not.toContain("segredo do corpo");
  });

  it("sem rota declarada, usa o caminho sem query string", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const req = { ...reqDoDisparo(), route: undefined };

    sendError(fakeRes(req), 401, "UNAUTHORIZED", "Token ausente");

    expect(linhasDeRecusa(warn)[0].rota).toBe("/api/campaigns/camp-1/dispatches");
  });

  it("5xx vai para console.error", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    sendError(fakeRes(reqDoDisparo()), 500, "INTERNAL_ERROR", "Internal server error");

    expect(linhasDeRecusa(error)[0]).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
  });
});
