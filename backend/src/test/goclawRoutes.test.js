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
});
