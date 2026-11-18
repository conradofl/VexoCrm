import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";

// Mock de node-edge-tts para testes rápidos e isolados
vi.mock("node-edge-tts", () => {
  return {
    EdgeTTS: vi.fn().mockImplementation(function (options) {
      this.options = options;
      this.ttsPromise = vi.fn().mockResolvedValue(undefined);
    }),
  };
});

import { registerGoclawRoutes } from "../domains/goclaw/routes.js";

let server;
let base;
let tempGoclawDir;

let mockUsuarios = [
  {
    id: "u-1",
    client_id: "geracao-digital",
    nome: "Conrado Finzi",
    telefone: "5534997817660",
    papel: "Diretor Executivo / Sócio",
    ativo: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "u-2",
    client_id: "geracao-digital",
    nome: "Caio Almeida",
    telefone: "5534997719779",
    papel: "Diretor Comercial / Sócio",
    ativo: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

let mockConfig = { status_ativo: { ativo: true }, notificar_whatsapp: { notificar: true } };
let mockAgendas = [
  {
    id: "ag-1",
    nome: "Conrado Finzi",
    email: "conradofinzi@gmail.com",
    telefone: "5534997817660",
    papel: "Sócio Diretor Executivo",
    ativo: true,
    notificar_whatsapp: true,
  },
  {
    id: "ag-2",
    nome: "Caio Almeida",
    email: "caioalmeidamrk@gmail.com",
    telefone: "5534997719779",
    papel: "Sócio Diretor Comercial",
    ativo: true,
    notificar_whatsapp: true,
  },
];
let mockExecucoes = [
  {
    id: "ex-1",
    canal: "whatsapp",
    solicitante_nome: "Conrado Finzi",
    solicitante_telefone: "5534997817660",
    solicitante_papel: "Diretor Executivo",
    texto_entrada: "Agenda reunião com o Caio amanhã às 15h",
    ferramenta_executada: "agendar_compromisso",
    status: "sucesso",
    created_at: new Date().toISOString(),
  },
];

const mockPool = {
  query: async (sql, params = []) => {
    if (sql.includes("heloisa_config")) {
      if (sql.includes("SELECT") && sql.includes("chave = 'status_ativo'")) {
        return { rows: [{ valor: mockConfig.status_ativo }] };
      }
      if (sql.includes("SELECT") && sql.includes("chave = 'notificar_whatsapp'")) {
        return { rows: [{ valor: mockConfig.notificar_whatsapp }] };
      }
      if (sql.includes("INSERT INTO public.heloisa_config")) {
        const chave = params[0] === "status_ativo" ? "status_ativo" : "notificar_whatsapp";
        try {
          mockConfig[chave] = typeof params[0] === "string" && params[0].startsWith("{") ? JSON.parse(params[0]) : params[0];
        } catch {
          mockConfig[chave] = params[0];
        }
        return { rows: [] };
      }
      return { rows: [] };
    }
    if (sql.includes("heloisa_agendas")) {
      if (sql.includes("SELECT")) {
        return { rows: [...mockAgendas] };
      }
      if (sql.includes("INSERT INTO public.heloisa_agendas")) {
        const [nome, email, telefone, papel, ativo, notificar_whatsapp] = params;
        const novo = {
          id: `ag-${Date.now()}`,
          nome,
          email,
          telefone,
          papel,
          ativo,
          notificar_whatsapp,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        mockAgendas.push(novo);
        return { rows: [novo] };
      }
      if (sql.includes("UPDATE public.heloisa_agendas")) {
        const id = params[params.length - 1];
        const ag = mockAgendas.find((a) => a.id === id);
        if (ag && params[0] !== undefined) {
          if (sql.includes("ativo =")) ag.ativo = params[0];
          if (sql.includes("nome =")) ag.nome = params[0];
        }
        return { rows: ag ? [ag] : [] };
      }
      if (sql.includes("DELETE FROM public.heloisa_agendas")) {
        const id = params[0];
        const idx = mockAgendas.findIndex((a) => a.id === id);
        if (idx !== -1) mockAgendas.splice(idx, 1);
        return { rows: [] };
      }
    }
    if (sql.includes("heloisa_execucoes")) {
      if (sql.includes("COUNT(*)::int as total FROM public.heloisa_execucoes")) {
        return { rows: [{ total: mockExecucoes.length }] };
      }
      if (sql.includes("COUNT(*) FILTER")) {
        return {
          rows: [
            {
              total: mockExecucoes.length,
              sucesso: mockExecucoes.filter((e) => e.status === "sucesso").length,
              erro: mockExecucoes.filter((e) => e.status === "erro").length,
              hoje: mockExecucoes.length,
              whatsapp: mockExecucoes.filter((e) => e.canal === "whatsapp").length,
              voice_web: mockExecucoes.filter((e) => e.canal === "voice_web").length,
            },
          ],
        };
      }
      if (sql.includes("SELECT") && sql.includes("FROM public.heloisa_execucoes")) {
        return { rows: [...mockExecucoes] };
      }
      if (sql.includes("INSERT INTO public.heloisa_execucoes")) {
        const novo = {
          id: `ex-${Date.now()}`,
          canal: params[0],
          solicitante_nome: params[1],
          texto_entrada: params[5],
          status: params[11],
          created_at: new Date().toISOString(),
        };
        mockExecucoes.push(novo);
        return { rows: [novo] };
      }
      if (sql.includes("DELETE FROM public.heloisa_execucoes WHERE id = $1")) {
        const id = params[0];
        const idx = mockExecucoes.findIndex((e) => e.id === id);
        if (idx !== -1) mockExecucoes.splice(idx, 1);
        return { rows: [] };
      }
      if (sql.includes("DELETE FROM public.heloisa_execucoes")) {
        mockExecucoes = [];
        return { rows: [] };
      }
    }
    if (sql.includes("SELECT") && sql.includes("heloisa_usuarios_autorizados")) {
      return { rows: [...mockUsuarios] };
    }
    if (sql.includes("INSERT INTO public.heloisa_usuarios_autorizados")) {
      const [client_id, nome, telefone, papel, ativo] = params;
      const novo = {
        id: `u-${Date.now()}`,
        client_id,
        nome,
        telefone,
        papel,
        ativo,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      mockUsuarios.push(novo);
      return { rows: [novo] };
    }
    if (sql.includes("UPDATE public.heloisa_usuarios_autorizados")) {
      const id = params[params.length - 1];
      const user = mockUsuarios.find((u) => u.id === id);
      if (!user) return { rows: [] };
      if (params.length === 2 && sql.includes("ativo =")) {
        user.ativo = params[0];
      }
      return { rows: [user] };
    }
    if (sql.includes("DELETE FROM public.heloisa_usuarios_autorizados")) {
      const id = params[0];
      const idx = mockUsuarios.findIndex((u) => u.id === id);
      if (idx === -1) return { rows: [] };
      const removed = mockUsuarios.splice(idx, 1)[0];
      return { rows: [removed] };
    }
    if (sql.includes("gd_clientes")) {
      return {
        rows: [
          {
            id: "c-1",
            nome: "Restaurante Sabor",
            empresa: "Restaurante Sabor Ltda",
            estado: "onboarding",
            prazo_vence_em: "2026-11-10T12:00:00Z",
          },
        ],
      };
    }
    if (sql.includes("gd_colaboradores")) {
      return {
        rows: [
          {
            id: "col-1",
            nome: "Carlos Santana",
            funcao: "Designer",
            telefone: "5534999999999",
            recebe_cobranca_whatsapp: true,
            ativo: true,
          },
        ],
      };
    }
    if (sql.includes("events")) {
      if (sql.includes("INSERT")) {
        const [titulo, data, local] = params;
        return { rows: [{ id: "ev-novo", name: titulo, date: data, location: local }] };
      }
      return {
        rows: [
          {
            id: "ev-1",
            name: "Reunião de Alinhamento",
            date: "2026-11-15T14:00:00Z",
            location: "Google Meet",
          },
        ],
      };
    }
    if (sql.includes("lead_reminders")) {
      if (sql.includes("INSERT")) {
        const [lead_name, title, notes, remind_at] = params;
        return { rows: [{ id: "rem-novo", title, remind_at }] };
      }
      return {
        rows: [
          {
            id: "rem-1",
            title: "Ligar para cliente",
            remind_at: "2026-11-15T10:00:00Z",
            lead_name: "Restaurante Sabor",
          },
        ],
      };
    }
    return { rows: [] };
  },
};

beforeAll(async () => {
  tempGoclawDir = fs.mkdtempSync(path.join(os.tmpdir(), "goclaw-test-"));
  fs.writeFileSync(
    path.join(tempGoclawDir, "goclaw.json"),
    JSON.stringify({
      llm: {
        agent: { models: ["gemini/gemini-3-flash-preview", "groq/openai/gpt-oss-120b"] },
      },
      lanes: {
        maestro: { name: "Maestro" },
        onboarding: { name: "Onboarding" },
        demandas_cron: { name: "Demandas" },
        heloisa: { name: "Heloisa" },
      },
    })
  );

  fs.writeFileSync(
    path.join(tempGoclawDir, "users.json"),
    JSON.stringify({
      conrado: { name: "Conrado Finzi", role: "owner" },
      caio: { name: "Caio Almeida", role: "owner" },
    })
  );

  const promptsDir = path.join(tempGoclawDir, "prompts");
  fs.mkdirSync(promptsDir);
  fs.writeFileSync(path.join(promptsDir, "heloisa_executiva.md"), "# HELOISA TEST PROMPT");

  const app = express();
  app.use(express.json());

  registerGoclawRoutes(app, {
    requireAuth: (_req, _res, next) => next(),
    goclawDir: tempGoclawDir,
    pool: mockPool,
  });

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (tempGoclawDir && fs.existsSync(tempGoclawDir)) {
    fs.rmSync(tempGoclawDir, { recursive: true, force: true });
  }
});

describe("Rotas de Gestão do GoClaw (goclaw/routes.js)", () => {
  it("GET /api/goclaw/status devolve status do runtime, modelos e usuários", async () => {
    const res = await fetch(`${base}/api/goclaw/status`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.runtime.primaryModel).toBe("gemini/gemini-3-flash-preview");
    expect(json.runtime.fallbackModel).toBe("groq/openai/gpt-oss-120b");
    expect(json.runtime.lanes).toContain("heloisa");
    expect(json.users.length).toBe(2);
    expect(json.users[0].username).toBe("conrado");
  });

  it("GET /api/goclaw/prompts carrega os prompts das lanes", async () => {
    const res = await fetch(`${base}/api/goclaw/prompts`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.prompts.heloisa).toBe("# HELOISA TEST PROMPT");
  });

  it("PUT /api/goclaw/prompts/:lane atualiza o prompt no disco", async () => {
    const updateRes = await fetch(`${base}/api/goclaw/prompts/heloisa`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "# NOVO PROMPT DA HELOISA ATUALIZADO" }),
    });
    expect(updateRes.status).toBe(200);

    const getRes = await fetch(`${base}/api/goclaw/prompts`);
    const getJson = await getRes.json();
    expect(getJson.prompts.heloisa).toBe("# NOVO PROMPT DA HELOISA ATUALIZADO");
  });

  it("PUT /api/goclaw/prompts/:lane rejeita lane desconhecida", async () => {
    const res = await fetch(`${base}/api/goclaw/prompts/lane_inexistente`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "teste" }),
    });
    expect(res.status).toBe(400);
  });

  describe("Endpoints de Usuários Autorizados da Heloísa (/api/goclaw/heloisa/usuarios)", () => {
    it("GET /api/goclaw/heloisa/usuarios lista usuários cadastrados", async () => {
      const res = await fetch(`${base}/api/goclaw/heloisa/usuarios`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data.length).toBeGreaterThanOrEqual(2);
      expect(json.data.some((u) => u.nome === "Conrado Finzi")).toBe(true);
    });

    it("POST /api/goclaw/heloisa/usuarios valida e cadastra novo número", async () => {
      // Rejeita telefone inválido
      const resInvalido = await fetch(`${base}/api/goclaw/heloisa/usuarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: "Novo Diretor", telefone: "invalido" }),
      });
      expect(resInvalido.status).toBe(422);

      // Cadastra com sucesso número canônico
      const resValido = await fetch(`${base}/api/goclaw/heloisa/usuarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: "Gabriel",
          telefone: "(34) 99691-6397",
          papel: "Gestor de Operações",
        }),
      });
      expect(resValido.status).toBe(201);
      const json = await resValido.json();
      expect(json.ok).toBe(true);
      expect(json.data.nome).toBe("Gabriel");
      expect(json.data.telefone).toBe("5534996916397");
      expect(json.data.ativo).toBe(true);
    });

    it("PATCH /api/goclaw/heloisa/usuarios/:id atualiza dados ou status", async () => {
      const res = await fetch(`${base}/api/goclaw/heloisa/usuarios/u-1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo: false }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.ativo).toBe(false);
    });

    it("DELETE /api/goclaw/heloisa/usuarios/:id remove o usuário", async () => {
      const res = await fetch(`${base}/api/goclaw/heloisa/usuarios/u-2`, {
        method: "DELETE",
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.nome).toBe("Caio Almeida");
    });
  });

  describe("Endpoint de Voz da Heloísa (/api/goclaw/heloisa/voice-chat)", () => {
    let originalFetch;
    const oldGroqKey = process.env.GROQ_API_KEY;
    const oldGeminiKey = process.env.GEMINI_API_KEY;
    const oldOpenAiKey = process.env.OPENAI_API_KEY;

    beforeAll(() => {
      originalFetch = globalThis.fetch;
      process.env.GROQ_API_KEY = "mock-groq-key";
      process.env.GEMINI_API_KEY = "mock-gemini-key";
      process.env.OPENAI_API_KEY = "mock-openai-key";
    });

    afterAll(() => {
      globalThis.fetch = originalFetch;
      process.env.GROQ_API_KEY = oldGroqKey;
      process.env.GEMINI_API_KEY = oldGeminiKey;
      process.env.OPENAI_API_KEY = oldOpenAiKey;
    });

    it("rejeita requisição vazia sem texto e sem áudio com 400", async () => {
      const res = await originalFetch(`${base}/api/goclaw/heloisa/voice-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Nenhum áudio ou texto fornecido para a Heloísa.");
    });

    it("processa mensagem de texto e retorna estrutura padronizada de voz", async () => {
      const spyFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
        const urlStr = String(url);
        if (urlStr.includes("evolution") || urlStr.includes("message/sendText") || urlStr.includes("/group/")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ key: { id: "mock-wa-test-id" }, success: true }),
            json: async () => ({ key: { id: "mock-wa-test-id" }, success: true }),
          };
        }
        if (urlStr.includes("audio/speech")) {
          return {
            ok: true,
            arrayBuffer: async () => Buffer.from("mock-audio-mp3-bytes"),
          };
        }
        if (urlStr.includes("generativelanguage") || urlStr.includes("groq") || urlStr.includes("1337") || urlStr.includes("openai")) {
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "A operação está estável com todos os colaboradores ativos e clientes em acompanhamento.",
                  },
                },
              ],
            }),
          };
        }
        return originalFetch(url, opts);
      });

      const res = await originalFetch(`${base}/api/goclaw/heloisa/voice-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Heloísa, como está a operação da agência hoje?",
          currentPage: "/crm/dashboard",
          clientId: "geracao-digital",
        }),
      });

      spyFetch.mockRestore();

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.userText).toBe("Heloísa, como está a operação da agência hoje?");
      expect(json.responseText).toContain("A operação está estável");
      expect(json.audioMimetype).toBe("audio/mp3");
      expect(Array.isArray(json.executedTools)).toBe(true);
    });

    it("executa tool quando a IA solicita (ex: cadastrar_cliente ou agendar_compromisso)", async () => {
      const spyFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
        const urlStr = String(url);
        if (urlStr.includes("evolution") || urlStr.includes("message/sendText") || urlStr.includes("/group/")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ key: { id: "mock-wa-test-id" }, success: true }),
            json: async () => ({ key: { id: "mock-wa-test-id" }, success: true }),
          };
        }
        if (urlStr.includes("audio/speech")) {
          return {
            ok: true,
            arrayBuffer: async () => Buffer.from("mock-audio-mp3-bytes"),
          };
        }
        if (urlStr.includes("generativelanguage") || urlStr.includes("groq") || urlStr.includes("1337") || urlStr.includes("openai")) {
          const bodyStr = opts?.body ? String(opts.body) : "";
          if (bodyStr.includes('"role":"tool"')) {
            return {
              ok: true,
              json: async () => ({
                choices: [
                  {
                    message: {
                      role: "assistant",
                      content: "Compromisso de alinhamento agendado com sucesso para amanhã às 14 horas.",
                    },
                  },
                ],
              }),
            };
          }
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    role: "assistant",
                    tool_calls: [
                      {
                        id: "call_123",
                        function: {
                          name: "agendar_compromisso",
                          arguments: JSON.stringify({
                            titulo: "Alinhamento com Santana",
                            data_hora: "2026-11-15T14:00:00Z",
                            local_ou_link: "Google Meet",
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          };
        }
        return originalFetch(url, opts);
      });

      const res = await originalFetch(`${base}/api/goclaw/heloisa/voice-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Heloísa, marque um alinhamento com o Santana para amanhã às 14h.",
          currentPage: "/crm/calendario",
        }),
      });

      spyFetch.mockRestore();

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.executedTools.length).toBe(1);
      expect(json.executedTools[0].name).toBe("agendar_compromisso");
      expect(json.executedTools[0].resultado.sucesso).toBe(true);
      expect(json.responseText).toContain("agendado com sucesso");
    });

    it("processa áudio base64 chamando STT", async () => {
      const spyFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
        const urlStr = String(url);
        if (urlStr.includes("evolution") || urlStr.includes("message/sendText") || urlStr.includes("/group/")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ key: { id: "mock-wa-test-id" }, success: true }),
            json: async () => ({ key: { id: "mock-wa-test-id" }, success: true }),
          };
        }
        if (urlStr.includes("audio/transcriptions")) {
          return {
            ok: true,
            json: async () => ({ text: "Áudio falado pelo diretor Conrado" }),
          };
        }
        if (urlStr.includes("audio/speech")) {
          return {
            ok: true,
            arrayBuffer: async () => Buffer.from("mock-audio-mp3-bytes"),
          };
        }
        if (urlStr.includes("generativelanguage") || urlStr.includes("groq") || urlStr.includes("1337") || urlStr.includes("openai")) {
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "Olá Conrado, ouvi sua mensagem perfeitamente.",
                  },
                },
              ],
            }),
          };
        }
        return originalFetch(url, opts);
      });

      const res = await originalFetch(`${base}/api/goclaw/heloisa/voice-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioBase64: Buffer.from("audio-mock-bytes").toString("base64"),
          audioMimetype: "audio/webm",
          currentPage: "/crm/banco-de-dados",
        }),
      });

      spyFetch.mockRestore();

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.userText).toBe("Áudio falado pelo diretor Conrado");
      expect(json.responseText).toContain("ouvi sua mensagem");
      expect(json.audioMimetype).toBe("audio/mp3");
    });

    it("injeta histórico de conversa e executa a ferramenta global auditar_geral_vexo", async () => {
      let capturedBody = null;
      const spyFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
        const urlStr = String(url);
        if (urlStr.includes("evolution") || urlStr.includes("message/sendText") || urlStr.includes("/group/")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ key: { id: "mock-wa-test-id" }, success: true }),
            json: async () => ({ key: { id: "mock-wa-test-id" }, success: true }),
          };
        }
        if (urlStr.includes("audio/speech")) {
          return {
            ok: true,
            arrayBuffer: async () => Buffer.from("mock-audio-mp3-bytes"),
          };
        }
        if (urlStr.includes("generativelanguage") || urlStr.includes("groq") || urlStr.includes("1337") || urlStr.includes("openai")) {
          const bodyStr = opts?.body ? String(opts.body) : "";
          capturedBody = bodyStr;
          if (bodyStr.includes('"role":"tool"')) {
            return {
              ok: true,
              json: async () => ({
                choices: [
                  {
                    message: {
                      role: "assistant",
                      content: "Auditoria concluída com sucesso para o Vexo OS.",
                    },
                  },
                ],
              }),
            };
          }
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    role: "assistant",
                    tool_calls: [
                      {
                        id: "call_audit_1",
                        function: {
                          name: "auditar_geral_vexo",
                          arguments: JSON.stringify({ tenant_id: "nous-gestao" }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          };
        }
        return originalFetch(url, opts);
      });

      const res = await originalFetch(`${base}/api/goclaw/heloisa/voice-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Heloísa, como estão os leads da Nous Gestão?",
          currentPage: "/crm/dashboard",
          history: [
            { sender: "user", text: "Oi Heloísa" },
            { sender: "heloisa", text: "Olá! Como posso te ajudar?" },
          ],
        }),
      });

      spyFetch.mockRestore();

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.executedTools.length).toBe(1);
      expect(json.executedTools[0].name).toBe("auditar_geral_vexo");
      expect(capturedBody).toContain("Oi Heloísa");
    });

    it("executa a ferramenta enviar_mensagem_whatsapp para enviar WhatsApp ao Conrado", async () => {
      let whatsappDisparado = false;
      const spyFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
        const urlStr = String(url);
        if (urlStr.includes("message/sendText") || urlStr.includes("evolution") || urlStr.includes("/group/")) {
          whatsappDisparado = true;
          return {
            ok: true,
            text: async () => JSON.stringify({ key: { id: "wa_msg_mock_123" } }),
          };
        }
        if (urlStr.includes("audio/speech")) {
          return {
            ok: true,
            arrayBuffer: async () => Buffer.from("mock-audio-mp3-bytes"),
          };
        }
        if (urlStr.includes("generativelanguage") || urlStr.includes("groq") || urlStr.includes("1337") || urlStr.includes("openai")) {
          const bodyStr = opts?.body ? String(opts.body) : "";
          if (bodyStr.includes('"role":"tool"')) {
            return {
              ok: true,
              json: async () => ({
                choices: [
                  {
                    message: {
                      role: "assistant",
                      content: "Mensagem de follow-up enviada com sucesso no WhatsApp do Conrado Finzi.",
                    },
                  },
                ],
              }),
            };
          }
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    role: "assistant",
                    tool_calls: [
                      {
                        id: "call_send_wa_1",
                        function: {
                          name: "enviar_mensagem_whatsapp",
                          arguments: JSON.stringify({
                            destinatario: "Conrado",
                            mensagem: "Olá Conrado, segue o resumo do follow-up.",
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          };
        }
        return originalFetch(url, opts);
      });

      const res = await originalFetch(`${base}/api/goclaw/heloisa/voice-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Heloísa, envie uma mensagem de follow-up para o Conrado no WhatsApp",
          currentPage: "/crm/dashboard",
        }),
      });

      spyFetch.mockRestore();

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.executedTools.length).toBe(1);
      expect(json.executedTools[0].name).toBe("enviar_mensagem_whatsapp");
      expect(json.executedTools[0].resultado.sucesso).toBe(true);
      expect(json.executedTools[0].resultado.destinatario).toBe("Conrado Finzi");
      expect(whatsappDisparado || json.executedTools[0].resultado.mock).toBeTruthy();
    });
  });

  describe("Configuração Liga/Desliga da Heloísa (/api/goclaw/heloisa/config)", () => {
    it("GET /api/goclaw/heloisa/config retorna status ativo", async () => {
      const res = await fetch(`${base}/api/goclaw/heloisa/config`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.config).toBeDefined();
      expect(typeof json.config.ativo).toBe("boolean");
    });

    it("PATCH /api/goclaw/heloisa/config atualiza status ativo e notificação", async () => {
      const res = await fetch(`${base}/api/goclaw/heloisa/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo: false, notificar_whatsapp: true }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.config).toBeDefined();
    });
  });

  describe("Painel de Histórico e Tarefas da Heloísa (/api/goclaw/heloisa/execucoes)", () => {
    it("GET /api/goclaw/heloisa/execucoes retorna lista paginada e contadores", async () => {
      const res = await fetch(`${base}/api/goclaw/heloisa/execucoes?limit=10`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.pagination).toBeDefined();
      expect(json.stats).toBeDefined();
    });

    it("DELETE /api/goclaw/heloisa/execucoes/:id remove execução individual", async () => {
      const res = await fetch(`${base}/api/goclaw/heloisa/execucoes/ex-1`, {
        method: "DELETE",
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    it("POST /api/goclaw/heloisa/execucoes/limpar esvazia o histórico", async () => {
      const res = await fetch(`${base}/api/goclaw/heloisa/execucoes/limpar`, {
        method: "POST",
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });
  });

  describe("Gestão de Agendas e E-mails (/api/goclaw/heloisa/agendas)", () => {
    it("GET /api/goclaw/heloisa/agendas lista as agendas cadastradas", async () => {
      const res = await fetch(`${base}/api/goclaw/heloisa/agendas`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
    });

    it("POST /api/goclaw/heloisa/agendas valida e cadastra novo e-mail", async () => {
      const resInvalido = await fetch(`${base}/api/goclaw/heloisa/agendas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: "Teste", email: "email-invalido" }),
      });
      expect(resInvalido.status).toBe(422);

      const resValido = await fetch(`${base}/api/goclaw/heloisa/agendas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: "Santana Designer",
          email: "santana@gd.com",
          telefone: "34999999999",
          papel: "Designer Criativo",
          ativo: true,
          notificar_whatsapp: true,
        }),
      });
      expect(resValido.status).toBe(200);
      const json = await resValido.json();
      expect(json.ok).toBe(true);
    });

    it("PATCH /api/goclaw/heloisa/agendas/:id atualiza dados da agenda", async () => {
      const res = await fetch(`${base}/api/goclaw/heloisa/agendas/ag-1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo: false }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    it("DELETE /api/goclaw/heloisa/agendas/:id remove a agenda", async () => {
      const res = await fetch(`${base}/api/goclaw/heloisa/agendas/ag-2`, {
        method: "DELETE",
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });
  });
});
