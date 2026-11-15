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
import { despacharVigia, gerarRelatorioVigia, normalizarNumerosWhatsApp } from "../../scripts/vigia-gd.mjs";
import { pgDatabasePool } from "../../services/database.js";
import { processarVozHeloisa } from "./heloisaEngine.js";

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
  pool = pgDatabasePool,
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

  // ─── Usuários Autorizados da Heloísa ────────────────────────────────────────

  // GET /api/goclaw/heloisa/usuarios: Lista todos os números autorizados
  app.get("/api/goclaw/heloisa/usuarios", requireAuth, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, client_id, nome, telefone, papel, ativo, created_at, updated_at
         FROM public.heloisa_usuarios_autorizados
         ORDER BY created_at ASC`
      );
      return res.json({ ok: true, data: rows });
    } catch (err) {
      console.error("[goclaw-routes] Erro ao listar usuários da Heloísa:", err);
      // Fallback gracioso se a migration ainda não foi executada no ambiente
      if (err.code === "42P01" || err.message?.includes("does not exist")) {
        const fallback = [
          {
            id: "fallback-conrado",
            client_id: "geracao-digital",
            nome: "Conrado Finzi",
            telefone: "5534997817660",
            papel: "Diretor Executivo / Sócio",
            ativo: true,
          },
          {
            id: "fallback-caio",
            client_id: "geracao-digital",
            nome: "Caio Almeida",
            telefone: "5534997719779",
            papel: "Diretor Comercial / Sócio",
            ativo: true,
          },
        ];
        return res.json({ ok: true, data: fallback });
      }
      return res.status(500).json({
        error: "Falha ao listar usuários autorizados da Heloísa.",
        details: err.message,
      });
    }
  });

  // POST /api/goclaw/heloisa/usuarios: Cadastra novo usuário autorizado
  app.post("/api/goclaw/heloisa/usuarios", requireAuth, async (req, res) => {
    try {
      const {
        nome,
        telefone,
        papel = "Diretor",
        client_id = "geracao-digital",
        ativo = true,
      } = req.body || {};

      if (!nome || typeof nome !== "string" || !nome.trim()) {
        return res.status(422).json({ error: "O nome do usuário/diretor é obrigatório." });
      }

      if (!telefone) {
        return res.status(422).json({ error: "O telefone de WhatsApp é obrigatório." });
      }

      const numerosValidos = normalizarNumerosWhatsApp(telefone);
      if (numerosValidos.length === 0) {
        return res.status(422).json({
          error: "Telefone de WhatsApp inválido. Formato esperado com DDD (ex: 34997817660).",
        });
      }

      const telCanonico = numerosValidos[0];

      const { rows } = await pool.query(
        `INSERT INTO public.heloisa_usuarios_autorizados (
           client_id, nome, telefone, papel, ativo
         ) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (telefone) DO UPDATE SET
           client_id = EXCLUDED.client_id,
           nome = EXCLUDED.nome,
           papel = EXCLUDED.papel,
           ativo = EXCLUDED.ativo,
           updated_at = now()
         RETURNING id, client_id, nome, telefone, papel, ativo, created_at, updated_at`,
        [client_id?.trim() || "geracao-digital", nome.trim(), telCanonico, papel?.trim() || "Diretor", ativo !== false]
      );

      return res.status(201).json({
        ok: true,
        message: "Usuário autorizado da Heloísa cadastrado com sucesso.",
        data: rows[0],
      });
    } catch (err) {
      console.error("[goclaw-routes] Erro ao cadastrar usuário da Heloísa:", err);
      return res.status(500).json({
        error: "Falha ao cadastrar usuário autorizado da Heloísa.",
        details: err.message,
      });
    }
  });

  // PATCH /api/goclaw/heloisa/usuarios/:id: Atualiza status ativo ou dados
  app.patch("/api/goclaw/heloisa/usuarios/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { nome, telefone, papel, client_id, ativo } = req.body || {};

      const updates = [];
      const values = [];
      let idx = 1;

      if (nome !== undefined) {
        if (!nome || typeof nome !== "string" || !nome.trim()) {
          return res.status(422).json({ error: "O nome não pode ser vazio." });
        }
        updates.push(`nome = $${idx++}`);
        values.push(nome.trim());
      }

      if (papel !== undefined) {
        updates.push(`papel = $${idx++}`);
        values.push(String(papel).trim());
      }

      if (client_id !== undefined) {
        updates.push(`client_id = $${idx++}`);
        values.push(String(client_id).trim());
      }

      if (ativo !== undefined) {
        updates.push(`ativo = $${idx++}`);
        values.push(ativo === true || ativo === "true");
      }

      if (telefone !== undefined) {
        const numerosValidos = normalizarNumerosWhatsApp(telefone);
        if (numerosValidos.length === 0) {
          return res.status(422).json({
            error: "Telefone de WhatsApp inválido. Formato esperado com DDD (ex: 34997817660).",
          });
        }
        updates.push(`telefone = $${idx++}`);
        values.push(numerosValidos[0]);
      }

      if (updates.length === 0) {
        return res.status(422).json({ error: "Nenhum campo fornecido para atualização." });
      }

      updates.push(`updated_at = now()`);
      values.push(id);

      const queryText = `
        UPDATE public.heloisa_usuarios_autorizados
        SET ${updates.join(", ")}
        WHERE id = $${idx}
        RETURNING id, client_id, nome, telefone, papel, ativo, created_at, updated_at
      `;

      const { rows } = await pool.query(queryText, values);

      if (rows.length === 0) {
        return res.status(404).json({ error: "Usuário autorizado não encontrado." });
      }

      return res.json({
        ok: true,
        message: "Usuário autorizado atualizado com sucesso.",
        data: rows[0],
      });
    } catch (err) {
      console.error("[goclaw-routes] Erro ao atualizar usuário da Heloísa:", err);
      return res.status(500).json({
        error: "Falha ao atualizar usuário autorizado da Heloísa.",
        details: err.message,
      });
    }
  });

  // DELETE /api/goclaw/heloisa/usuarios/:id: Remove número autorizado
  app.delete("/api/goclaw/heloisa/usuarios/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { rows } = await pool.query(
        `DELETE FROM public.heloisa_usuarios_autorizados
         WHERE id = $1
         RETURNING id, nome, telefone`,
        [id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: "Usuário autorizado não encontrado." });
      }

      return res.json({
        ok: true,
        message: `Usuário "${rows[0].nome}" removido com sucesso.`,
        data: rows[0],
      });
    } catch (err) {
      console.error("[goclaw-routes] Erro ao remover usuário da Heloísa:", err);
      return res.status(500).json({
        error: "Falha ao remover usuário autorizado da Heloísa.",
        details: err.message,
      });
    }
  });

  // ─── Heloísa Voice Chat (Widget de Voz Two-Way do Vexo OS) ────────────────
  app.post("/api/goclaw/heloisa/voice-chat", requireAuth, async (req, res) => {
    try {
      const {
        audioBase64,
        audioMimetype = "audio/webm",
        text,
        currentPage = "Dashboard",
        clientId = "geracao-digital",
      } = req.body || {};

      if (!text && !audioBase64) {
        return res.status(400).json({
          error: "Nenhum áudio ou texto fornecido para a Heloísa.",
        });
      }

      const userName = req.user?.name || req.user?.displayName || req.user?.email || "Diretor";
      const userRole = req.user?.role || "Diretor Executivo";

      const resultado = await processarVozHeloisa({
        text,
        audioBase64,
        audioMimetype,
        currentPage,
        clientId,
        userName,
        userRole,
        pool,
        goclawDir,
      });

      return res.json(resultado);
    } catch (err) {
      console.error("[goclaw-routes] Erro no endpoint voice-chat da Heloísa:", err);
      return res.status(500).json({
        error: "Falha ao processar solicitação de voz com a Heloísa.",
        details: err.message,
      });
    }
  });
}
