// backend/src/test/agentEnableGuardRoute.test.js
//
// Trava "agente de atendimento não liga sem prompt", nas rotas POST e PATCH de
// /api/followup/companies. A regra (checkAgentEnableGuard) e a busca do prompt
// da empresa (fetchDynamicPrompt) rodam de verdade; só o banco é dublê.
import { describe, expect, it, vi, beforeEach } from "vitest";

const supabaseMock = { from: vi.fn() };
vi.mock("../followup/db.js", () => ({
  query: vi.fn(),
  getSupabase: () => supabaseMock,
}));

vi.mock("../services/evolution.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getLeadClientEvolutionInstances: async () => [] };
});

const { registerFollowupRoutes } = await import("../followup/routes.js");

function getRouteHandler(routePath, method) {
  let followupRouter = null;
  const fakeApp = {
    use: (path, router) => {
      if (path === "/api/followup") followupRouter = router;
    },
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
  const noop = (req, res, next) => next?.();
  registerFollowupRoutes(fakeApp, noop, () => noop, noop);
  const layer = followupRouter.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  expect(layer, `rota ${method.toUpperCase()} ${routePath} não encontrada`).toBeDefined();
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(s) { this.statusCode = s; return this; },
    json(b) { this.body = b; return this; },
  };
}

const adminAccess = { role: "internal", isAdmin: true, scopeMode: "all_clients", clientIds: [] };
const PROMPT_BOM = "Você é a assistente da loja. Atenda com calma e descubra o que o cliente procura.";
const PROMPT_EMPRESA = "Prompt padrão da empresa, longo o bastante para valer como instrução.";

function soAsColunas(linha, colunas) {
  if (!colunas || colunas.trim() === "*") return { ...linha };
  const nomes = colunas.split(",").map((c) => c.trim()).filter(Boolean);
  return Object.fromEntries(nomes.filter((n) => n in linha).map((n) => [n, linha[n]]));
}

// Banco: followup_companies devolve `existente` e grava o que vier;
// chatbot_prompts devolve o prompt padrão da empresa, se houver.
function montarBanco({ existente = null, promptEmpresa = null } = {}) {
  const gravado = { insert: null, update: null };
  const consultas = { chatbot_prompts: 0 };
  supabaseMock.from.mockImplementation((table) => {
    if (table === "chatbot_prompts") {
      consultas.chatbot_prompts += 1;
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: promptEmpresa ? { content: promptEmpresa } : null, error: null }),
      };
      return chain;
    }
    if (table === "followup_companies") {
      return {
        // Devolve só as colunas pedidas, como o banco: se a rota deixar de ler
        // inbound_enabled ou instructions_consolidated_at, o teste percebe.
        select: (colunas) => ({
          eq: () => ({
            maybeSingle: async () => ({ data: existente && soAsColunas(existente, colunas), error: null }),
          }),
        }),
        insert: (payload) => {
          gravado.insert = payload;
          return { select: () => ({ maybeSingle: async () => ({ data: { id: "novo", ...payload }, error: null }) }) };
        },
        update: (payload) => {
          gravado.update = payload;
          return {
            eq: () => ({
              select: () => ({ maybeSingle: async () => ({ data: { ...existente, ...payload }, error: null }) }),
            }),
          };
        },
      };
    }
    return {};
  });
  return { gravado, consultas };
}

function agenteGravado(extra = {}) {
  return {
    id: "agente-1",
    name: "Agente",
    tenant_id: "tenant-a",
    inbound_enabled: false,
    agent_kind: "atendimento",
    inbound_prompt: null,
    instructions_consolidated_at: null,
    ...extra,
  };
}

async function criar(body) {
  const res = fakeRes();
  await getRouteHandler("/companies", "post")(
    { body: { name: "Agente novo", tenant_id: "tenant-a", ...body }, authAccess: adminAccess },
    res
  );
  return res;
}

async function alterar(body) {
  const res = fakeRes();
  await getRouteHandler("/companies/:id", "patch")(
    { params: { id: "agente-1" }, body, authAccess: adminAccess },
    res
  );
  return res;
}

// Toda recusa nomeia a saída. Em "ligar" e "apagar_prompt" é mudar a Função
// para Disparo; em "mudar_para_atendimento" a saída é continuar como está.
const TRECHO_DA_SAIDA = {
  ligar: "mude a Função para Disparo",
  apagar_prompt: "mude a Função para Disparo",
  mudar_para_atendimento: "antes de mudar a Função para Atendimento",
};

function esperarTrava(res, motivo) {
  expect(res.statusCode).toBe(422);
  expect(res.body.error.code).toBe("AGENT_WITHOUT_PROMPT");
  expect(res.body.error.motivo).toBe(motivo);
  expect(res.body.error.saida).toEqual({ agent_kind: "campanha" });
  expect(res.body.error.message).toContain(TRECHO_DA_SAIDA[motivo]);
}

describe("POST /api/followup/companies — trava de agente sem prompt", () => {
  beforeEach(() => supabaseMock.from.mockReset());

  it("recusa criar agente de atendimento já ligado sem prompt, e não grava nada", async () => {
    const { gravado } = montarBanco();
    const res = await criar({ inbound_enabled: true });
    esperarTrava(res, "ligar");
    expect(gravado.insert).toBeNull();
  });

  it("recusa prompt curto demais (mínimo de 20 caracteres)", async () => {
    const { gravado } = montarBanco();
    const res = await criar({ inbound_enabled: true, inbound_prompt: "Seja gentil." });
    esperarTrava(res, "ligar");
    expect(gravado.insert).toBeNull();
  });

  it("cria ligado quando o agente tem prompt próprio", async () => {
    const { gravado } = montarBanco();
    const res = await criar({ inbound_enabled: true, inbound_prompt: PROMPT_BOM });
    expect(res.statusCode).toBe(201);
    expect(gravado.insert.inbound_enabled).toBe(true);
  });

  it("cria ligado sem prompt próprio quando a empresa tem prompt padrão (é o que o motor usa)", async () => {
    const { gravado } = montarBanco({ promptEmpresa: PROMPT_EMPRESA });
    const res = await criar({ inbound_enabled: true });
    expect(res.statusCode).toBe(201);
    expect(gravado.insert.inbound_enabled).toBe(true);
  });

  it("cria agente de Disparo ligado sem prompt (a saída)", async () => {
    const { gravado } = montarBanco();
    const res = await criar({ inbound_enabled: true, agent_kind: "campanha" });
    expect(res.statusCode).toBe(201);
    expect(gravado.insert.agent_kind).toBe("campanha");
  });

  it("cria agente de atendimento desligado sem prompt", async () => {
    const { gravado } = montarBanco();
    const res = await criar({ inbound_enabled: false });
    expect(res.statusCode).toBe(201);
    expect(gravado.insert.inbound_enabled).toBe(false);
  });
});

describe("PATCH /api/followup/companies/:id — trava de agente sem prompt", () => {
  beforeEach(() => supabaseMock.from.mockReset());

  it("recusa ligar (botão que grava direto) agente de atendimento sem prompt", async () => {
    const { gravado } = montarBanco({ existente: agenteGravado() });
    const res = await alterar({ inbound_enabled: true });
    esperarTrava(res, "ligar");
    expect(gravado.update).toBeNull();
  });

  it("recusa apagar o prompt de um agente ligado", async () => {
    const { gravado } = montarBanco({ existente: agenteGravado({ inbound_enabled: true, inbound_prompt: PROMPT_BOM }) });
    const res = await alterar({ inbound_prompt: "" });
    esperarTrava(res, "apagar_prompt");
    expect(gravado.update).toBeNull();
  });

  it("deixa apagar o prompt próprio quando a empresa tem prompt padrão e o agente não é consolidado", async () => {
    const { gravado } = montarBanco({
      existente: agenteGravado({ inbound_enabled: true, inbound_prompt: PROMPT_BOM }),
      promptEmpresa: PROMPT_EMPRESA,
    });
    const res = await alterar({ inbound_prompt: "" });
    expect(res.statusCode).toBe(200);
    expect(gravado.update.inbound_prompt).toBeNull();
  });

  it("agente consolidado não se apoia no prompt da empresa: apagar o próprio é recusado", async () => {
    const { gravado } = montarBanco({
      existente: agenteGravado({
        inbound_enabled: true,
        inbound_prompt: PROMPT_BOM,
        instructions_consolidated_at: "2026-10-01T00:00:00.000Z",
      }),
      promptEmpresa: PROMPT_EMPRESA,
    });
    const res = await alterar({ inbound_prompt: "" });
    esperarTrava(res, "apagar_prompt");
    expect(gravado.update).toBeNull();
  });

  it("recusa trocar a Função de Disparo para Atendimento num agente ligado sem prompt", async () => {
    const { gravado } = montarBanco({ existente: agenteGravado({ inbound_enabled: true, agent_kind: "campanha" }) });
    const res = await alterar({ agent_kind: "atendimento" });
    esperarTrava(res, "mudar_para_atendimento");
    expect(gravado.update).toBeNull();
  });

  it("deixa ligar agente de Disparo sem prompt (a saída)", async () => {
    const { gravado } = montarBanco({ existente: agenteGravado({ agent_kind: "campanha" }) });
    const res = await alterar({ inbound_enabled: true });
    expect(res.statusCode).toBe(200);
    expect(gravado.update.inbound_enabled).toBe(true);
  });

  it("deixa desligar agente sem prompt", async () => {
    const { gravado } = montarBanco({ existente: agenteGravado({ inbound_enabled: true }) });
    const res = await alterar({ inbound_enabled: false });
    expect(res.statusCode).toBe(200);
    expect(gravado.update.inbound_enabled).toBe(false);
  });

  it("não barra renomear um agente que já estava ligado sem prompt (nem consulta a empresa)", async () => {
    const { gravado, consultas } = montarBanco({ existente: agenteGravado({ inbound_enabled: true }) });
    const res = await alterar({ name: "Agente renomeado" });
    expect(res.statusCode).toBe(200);
    expect(gravado.update.name).toBe("Agente renomeado");
    expect(consultas.chatbot_prompts).toBe(0);
  });
});
