import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
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

const mockPool = {
  query: async (sql, params = []) => {
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
});
