/**
 * routes.js - GoClaw Management Domain
 *
 * Expõe endpoints para o Painel de Controle do GoClaw no Vexo OS:
 * - Healthcheck e status do runtime (porta 1337)
 * - Leitura e edição visual de prompts das lanes (Maestro, Onboarding, Síndico, Heloísa)
 * - Gestão de usuários e atualização segura de senhas
 * - Disparo de teste manual do Vigia direto para o WhatsApp dos sócios
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { despacharVigia, gerarRelatorioVigia } from "../../scripts/vigia-gd.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveGoclawDir() {
  const candidates = [
    path.resolve(process.cwd(), "goclaw"),
    path.resolve(__dirname, "../../../goclaw"),
    path.resolve(__dirname, "../../../../goclaw"),
    "/root/.goclaw",
    "/var/www/vexo-crm/goclaw",
  ];

  for (const c of candidates) {
    if (fs.existsSync(c) && fs.existsSync(path.join(c, "goclaw.json"))) {
      return c;
    }
  }

  return candidates[0];
}

const PROMPT_FILE_MAP = {
  maestro: "maestro_coo.md",
  onboarding: "gestor_digital_onboarding.md",
  demandas_cron: "gestor_demandas_auditor.md",
  heloisa: "heloisa_executiva.md",
};

export function registerGoclawRoutes(app, {
  requireAuth = (_req, _res, next) => next(),
  goclawDir = resolveGoclawDir(),
} = {}) {
  // ─── Status & Healthcheck ──────────────────────────────────────────────────
  app.get("/api/goclaw/status", requireAuth, async (_req, res) => {
    const goclawUrl = (process.env.GOCLAW_URL || "http://vexo_goclaw:1337").replace(/\/+$/, "");
    let isOnline = false;
    let latencyMs = null;

    try {
      const start = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      const resp = await fetch(`${goclawUrl}/v1/models`, {
        signal: controller.signal,
        headers: process.env.GOCLAW_GATEWAY_TOKEN ? { Authorization: `Bearer ${process.env.GOCLAW_GATEWAY_TOKEN}` } : {},
      }).catch(() => null);

      clearTimeout(timeoutId);

      if (resp && (resp.ok || resp.status === 401 || resp.status === 403 || resp.status === 200)) {
        isOnline = true;
        latencyMs = Date.now() - start;
      }
    } catch {
      isOnline = false;
    }

    // Leitura das configurações locais
    let config = {};
    let users = [];

    try {
      const configPath = path.join(goclawDir, "goclaw.json");
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      }
    } catch (e) {
      console.warn("[goclaw-routes] Aviso ao ler goclaw.json:", e.message);
    }

    try {
      const usersPath = path.join(goclawDir, "users.json");
      if (fs.existsSync(usersPath)) {
        const rawUsers = JSON.parse(fs.readFileSync(usersPath, "utf-8"));
        users = Object.entries(rawUsers).map(([username, val]) => ({
          username,
          name: val.name || username,
          role: val.role || "colaborador",
        }));
      }
    } catch (e) {
      console.warn("[goclaw-routes] Aviso ao ler users.json:", e.message);
    }

    const lanes = Object.keys(config.lanes || { maestro: {}, onboarding: {}, demandas_cron: {}, heloisa: {} });

    return res.json({
      ok: true,
      runtime: {
        online: isOnline,
        latencyMs,
        url: goclawUrl,
        primaryModel: config.llm?.agent?.models?.[0] || "gemini/gemini-3-flash-preview",
        fallbackModel: config.llm?.agent?.models?.[1] || "groq/openai/gpt-oss-120b",
        lanes,
      },
      users,
    });
  });

  // ─── Obter Prompts das Lanes ───────────────────────────────────────────────
  app.get("/api/goclaw/prompts", requireAuth, async (_req, res) => {
    const prompts = {};
    const promptsDir = path.join(goclawDir, "prompts");

    for (const [laneKey, fileName] of Object.entries(PROMPT_FILE_MAP)) {
      const filePath = path.join(promptsDir, fileName);
      if (fs.existsSync(filePath)) {
        prompts[laneKey] = fs.readFileSync(filePath, "utf-8");
      } else {
        prompts[laneKey] = "";
      }
    }

    return res.json({ ok: true, prompts });
  });

  // ─── Salvar Prompt de uma Lane ─────────────────────────────────────────────
  app.put("/api/goclaw/prompts/:lane", requireAuth, async (req, res) => {
    const { lane } = req.params;
    const { content } = req.body || {};

    const fileName = PROMPT_FILE_MAP[lane];
    if (!fileName) {
      return res.status(400).json({ error: `Lane "${lane}" inválida. Opções: maestro, onboarding, demandas_cron, heloisa.` });
    }

    if (typeof content !== "string" || !content.trim()) {
      return res.status(422).json({ error: "O conteúdo do prompt não pode ser vazio." });
    }

    const promptsDir = path.join(goclawDir, "prompts");
    if (!fs.existsSync(promptsDir)) {
      fs.mkdirSync(promptsDir, { recursive: true });
    }

    const filePath = path.join(promptsDir, fileName);
    fs.writeFileSync(filePath, content, "utf-8");

    return res.json({ ok: true, message: `Prompt da lane "${lane}" salvo com sucesso.` });
  });

  // ─── Disparo de Teste Manual do Vigia (WhatsApp dos Sócios) ───────────────
  app.post("/api/goclaw/test-vigia", requireAuth, async (req, res) => {
    try {
      const { periodo = "checkin" } = req.body || {};

      const resultado = await despacharVigia({
        periodo,
        dryRun: false,
      });

      return res.json({
        ok: true,
        message: "Disparo do Vigia executado com sucesso.",
        resultado,
      });
    } catch (err) {
      console.error("[goclaw-routes] Erro no teste do Vigia:", err);
      return res.status(500).json({
        error: "Falha ao executar disparo de teste do Vigia.",
        details: err.message,
      });
    }
  });
}
