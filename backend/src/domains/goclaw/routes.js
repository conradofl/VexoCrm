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
import {
  processarVozHeloisa,
  ensureHeloisaTables,
  isHeloisaActive,
  invalidateHeloisaActiveCache,
} from "./heloisaEngine.js";

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
  heloisa: "heloisa_executiva.md",
  gomes: "gomes_cartorio.md",
  tropeco: "tropeco_operacoes.md",
  maozinha: "maozinha_agendador.md",
  morticia: "morticia_cobradora.md",
  wandinha: "wandinha_sindica.md",
  maestro: "maestro_coo.md",
  onboarding: "gestor_digital_onboarding.md",
  demandas_cron: "gestor_demandas_auditor.md",
};

export function registerGoclawRoutes(app, {
  requireAuth = (_req, _res, next) => next(),
  goclawDir = resolveGoclawDir(),
  pool = pgDatabasePool,
} = {}) {
  // Inicializa e garante tabelas da Heloísa (usuarios, config, agendas, execucoes)
  ensureHeloisaTables(pool).catch((e) => {
    console.warn("[goclaw-routes] Aviso ao inicializar tabelas da Heloísa:", e.message);
  });
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
      return res.status(400).json({ error: `Lane "${lane}" inválida. Opções: ${Object.keys(PROMPT_FILE_MAP).join(", ")}.` });
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
  app.post(["/api/goclaw/heloisa/voice-chat", "/api/goclaw/heloisa/voice"], requireAuth, async (req, res) => {
    try {
      const {
        audioBase64,
        audioMimetype = "audio/webm",
        text,
        currentPage = "Dashboard",
        clientId = "geracao-digital",
        history = [],
      } = req.body || {};

      if (!text && !audioBase64) {
        return res.status(400).json({
          error: "Nenhum áudio ou texto fornecido para a Heloísa.",
        });
      }

      // Resolve nome do usuário com preferência para Conrado ou nome real, NUNCA "Diretor"
      let rawName =
        req.body?.userName ||
        req.user?.name ||
        req.user?.displayName ||
        (req.user?.email ? req.user.email.split("@")[0] : null) ||
        "Conrado";

      let cleanName = String(rawName).trim();
      if (/^diretor$/i.test(cleanName) || cleanName.includes("@") || !cleanName) {
        cleanName = "Conrado";
      }
      const userName = cleanName.split(" ")[0] || "Conrado";
      const userRole = req.user?.role || "Diretor Executivo";

      const resultado = await processarVozHeloisa({
        text,
        audioBase64,
        audioMimetype,
        currentPage,
        clientId,
        userName,
        userRole,
        history,
        pool,
        goclawDir,
      });

      return res.json(resultado);
    } catch (err) {
      console.error("[goclaw-routes] Erro no endpoint voice-chat da Heloísa:", err);
      return res.status(500).json({
        error: err?.message || "Erro interno ao processar voz com a Heloísa.",
      });
    }
  });

  // ─── Configurações Gerais & Kill-Switch da Heloísa ──────────────────────────

  // GET /api/goclaw/heloisa/config: Retorna status ativo (liga/desliga) e configs
  app.get("/api/goclaw/heloisa/config", requireAuth, async (_req, res) => {
    try {
      const ativa = await isHeloisaActive(pool);
      let notificarWhatsApp = true;
      try {
        const { rows } = await pool.query(
          "SELECT valor FROM public.heloisa_config WHERE chave = 'notificar_whatsapp' LIMIT 1"
        );
        if (rows.length > 0 && typeof rows[0].valor === "object" && rows[0].valor.notificar !== undefined) {
          notificarWhatsApp = rows[0].valor.notificar !== false;
        }
      } catch {}

      return res.json({
        ok: true,
        config: {
          ativo: ativa,
          notificar_whatsapp: notificarWhatsApp,
        },
      });
    } catch (err) {
      console.error("[goclaw-routes] Erro ao obter config da Heloísa:", err);
      return res.status(500).json({ error: "Falha ao obter configuração da Heloísa." });
    }
  });

  // PATCH /api/goclaw/heloisa/config: Atualiza status ativo ou configs
  app.patch("/api/goclaw/heloisa/config", requireAuth, async (req, res) => {
    try {
      const { ativo, notificar_whatsapp } = req.body || {};

      if (ativo !== undefined && pool && typeof pool.query === "function") {
        await pool.query(
          `INSERT INTO public.heloisa_config (chave, valor, updated_at)
           VALUES ('status_ativo', $1, NOW())
           ON CONFLICT (chave) DO UPDATE SET valor = $1, updated_at = NOW()`,
          [JSON.stringify({ ativo: Boolean(ativo) })]
        );
        invalidateHeloisaActiveCache();
      }

      if (notificar_whatsapp !== undefined && pool && typeof pool.query === "function") {
        await pool.query(
          `INSERT INTO public.heloisa_config (chave, valor, updated_at)
           VALUES ('notificar_whatsapp', $1, NOW())
           ON CONFLICT (chave) DO UPDATE SET valor = $1, updated_at = NOW()`,
          [JSON.stringify({ notificar: Boolean(notificar_whatsapp) })]
        );
      }

      const statusAtivo = await isHeloisaActive(pool);
      return res.json({
        ok: true,
        message: statusAtivo
          ? "Heloísa ATIVADA com sucesso (online no WhatsApp e Web)!"
          : "Heloísa PAUSADA/DESLIGADA com sucesso pelo administrador.",
        config: {
          ativo: statusAtivo,
          notificar_whatsapp: notificar_whatsapp !== undefined ? Boolean(notificar_whatsapp) : true,
        },
      });
    } catch (err) {
      console.error("[goclaw-routes] Erro ao atualizar config da Heloísa:", err);
      return res.status(500).json({ error: "Falha ao atualizar configuração da Heloísa." });
    }
  });

  // ─── Histórico & Auditoria de Execuções da Heloísa ──────────────────────────

  // GET /api/goclaw/heloisa/execucoes: Lista tarefas e comandos executados
  app.get("/api/goclaw/heloisa/execucoes", requireAuth, async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const offset = (page - 1) * limit;

      const { status, canal, busca } = req.query;

      const whereClauses = [];
      const queryParams = [];
      let paramIndex = 1;

      if (status && status !== "todos") {
        whereClauses.push(`status = $${paramIndex++}`);
        queryParams.push(status);
      }

      if (canal && canal !== "todos") {
        whereClauses.push(`canal = $${paramIndex++}`);
        queryParams.push(canal);
      }

      if (busca && typeof busca === "string" && busca.trim()) {
        const termo = `%${busca.trim()}%`;
        whereClauses.push(
          `(texto_entrada ILIKE $${paramIndex} OR resposta_saida ILIKE $${paramIndex} OR solicitante_nome ILIKE $${paramIndex} OR ferramenta_executada ILIKE $${paramIndex})`
        );
        queryParams.push(termo);
        paramIndex++;
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

      let rows = [];
      let total = 0;

      if (pool && typeof pool.query === "function") {
        try {
          const countRes = await pool.query(
            `SELECT COUNT(*)::int as total FROM public.heloisa_execucoes ${whereSql}`,
            queryParams
          );
          total = countRes.rows[0]?.total || 0;

          const dataRes = await pool.query(
            `SELECT id, canal, solicitante_nome, solicitante_telefone, solicitante_papel,
                    client_id, texto_entrada, tipo_entrada, ferramenta_executada,
                    parametros, resultado, resposta_saida, status, erro_detalhes,
                    tempo_execucao_ms, created_at
             FROM public.heloisa_execucoes
             ${whereSql}
             ORDER BY created_at DESC
             LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
            [...queryParams, limit, offset]
          );
          rows = dataRes.rows || [];
        } catch (e) {
          console.error("[goclaw-routes] Erro ao consultar heloisa_execucoes:", e);
        }
      }

      // Estatísticas gerais para os cards do painel
      let stats = { total: 0, sucesso: 0, erro: 0, hoje: 0, whatsapp: 0, voice_web: 0 };
      if (pool && typeof pool.query === "function") {
        try {
          const statsRes = await pool.query(`
            SELECT
              COUNT(*)::int as total,
              COUNT(*) FILTER (WHERE status = 'sucesso')::int as sucesso,
              COUNT(*) FILTER (WHERE status = 'erro')::int as erro,
              COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int as hoje,
              COUNT(*) FILTER (WHERE canal = 'whatsapp')::int as whatsapp,
              COUNT(*) FILTER (WHERE canal = 'voice_web')::int as voice_web
            FROM public.heloisa_execucoes
          `);
          if (statsRes.rows.length > 0) {
            stats = statsRes.rows[0];
          }
        } catch (eStats) {
          console.error("[goclaw-routes] Erro ao consultar estatísticas de heloisa_execucoes:", eStats);
        }
      }

      return res.json({
        ok: true,
        data: rows,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit) || 1,
        },
        stats,
      });
    } catch (err) {
      console.error("[goclaw-routes] Erro ao listar execuções da Heloísa:", err);
      return res.status(500).json({ error: "Falha ao carregar histórico de execuções." });
    }
  });

  // DELETE /api/goclaw/heloisa/execucoes/:id: Remove registro individual
  app.delete("/api/goclaw/heloisa/execucoes/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      if (pool && typeof pool.query === "function") {
        await pool.query("DELETE FROM public.heloisa_execucoes WHERE id = $1", [id]);
      }
      return res.json({ ok: true, message: "Registro removido com sucesso." });
    } catch (err) {
      console.error("[goclaw-routes] Erro ao excluir execução:", err);
      return res.status(500).json({ error: "Falha ao excluir registro." });
    }
  });

  // POST /api/goclaw/heloisa/execucoes/limpar: Limpa histórico
  app.post("/api/goclaw/heloisa/execucoes/limpar", requireAuth, async (_req, res) => {
    try {
      if (pool && typeof pool.query === "function") {
        await pool.query("DELETE FROM public.heloisa_execucoes");
      }
      return res.json({ ok: true, message: "Histórico de execuções limpo com sucesso." });
    } catch (err) {
      console.error("[goclaw-routes] Erro ao limpar histórico:", err);
      return res.status(500).json({ error: "Falha ao limpar histórico." });
    }
  });

  // ─── Agendas e E-mails (Google Meet & Convites Automáticos) ─────────────────

  // GET /api/goclaw/heloisa/agendas: Lista todas as agendas configuradas
  app.get("/api/goclaw/heloisa/agendas", requireAuth, async (_req, res) => {
    try {
      let rows = [];
      if (pool && typeof pool.query === "function") {
        try {
          const resQuery = await pool.query(
            `SELECT id, nome, email, telefone, papel, ativo, notificar_whatsapp, created_at, updated_at
             FROM public.heloisa_agendas
             ORDER BY created_at ASC`
          );
          rows = resQuery.rows || [];
        } catch (e) {
          console.warn("[goclaw-routes] Aviso ao consultar heloisa_agendas:", e.message);
        }
      }

      if (rows.length === 0) {
        rows = [
          {
            id: "default-conrado",
            nome: "Conrado Finzi",
            email: "conradofl@gmail.com",
            telefone: "5534997817660",
            papel: "Sócio Diretor Executivo",
            ativo: true,
            notificar_whatsapp: true,
          },
          {
            id: "default-caio",
            nome: "Caio Almeida",
            email: "caioalmeidmrk@gmail.com",
            telefone: "5534997719779",
            papel: "Sócio Diretor Comercial",
            ativo: true,
            notificar_whatsapp: true,
          },
          {
            id: "default-gd",
            nome: "Geração Digital",
            email: "mrkgeracaodigital@gmail.com",
            telefone: null,
            papel: "Agência Oficial",
            ativo: true,
            notificar_whatsapp: false,
          },
        ];
      } else {
        // Remove resquício antigo 'conradofinzi@gmail.com' e deduplica por telefone garantindo unicidade
        rows = rows.filter((r) => r.email !== "conradofinzi@gmail.com");
        const telefonesVistos = new Set();
        rows = rows.filter((r) => {
          const telNorm = String(r.telefone || "").replace(/\D/g, "");
          if (telNorm && telefonesVistos.has(telNorm)) return false;
          if (telNorm) telefonesVistos.add(telNorm);
          return true;
        });
      }

      return res.json({ ok: true, data: rows });
    } catch (err) {
      console.error("[goclaw-routes] Erro ao listar agendas da Heloísa:", err);
      return res.status(500).json({ error: "Falha ao listar agendas." });
    }
  });

  // POST /api/goclaw/heloisa/agendas: Cadastra nova agenda/e-mail
  app.post("/api/goclaw/heloisa/agendas", requireAuth, async (req, res) => {
    try {
      const {
        nome,
        email,
        telefone = null,
        papel = "Participante",
        ativo = true,
        notificar_whatsapp = true,
      } = req.body || {};

      if (!nome || typeof nome !== "string" || !nome.trim()) {
        return res.status(422).json({ error: "O nome do participante ou agenda é obrigatório." });
      }

      if (!email || typeof email !== "string" || !email.includes("@")) {
        return res.status(422).json({ error: "E-mail de agenda válido é obrigatório." });
      }

      const emailLimpo = email.trim().toLowerCase();
      let telFormatado = null;
      if (telefone) {
        const val = normalizarNumerosWhatsApp(telefone);
        if (val.length > 0) telFormatado = val[0];
      }

      if (pool && typeof pool.query === "function") {
        const { rows } = await pool.query(
          `INSERT INTO public.heloisa_agendas (nome, email, telefone, papel, ativo, notificar_whatsapp, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
           ON CONFLICT (email) DO UPDATE SET
             nome = EXCLUDED.nome,
             telefone = COALESCE(EXCLUDED.telefone, heloisa_agendas.telefone),
             papel = EXCLUDED.papel,
             ativo = EXCLUDED.ativo,
             notificar_whatsapp = EXCLUDED.notificar_whatsapp,
             updated_at = NOW()
           RETURNING *`,
          [nome.trim(), emailLimpo, telFormatado, papel, Boolean(ativo), Boolean(notificar_whatsapp)]
        );

        return res.json({
          ok: true,
          message: `Agenda de ${nome} (${emailLimpo}) cadastrada com sucesso!`,
          data: rows[0],
        });
      }

      return res.json({ ok: true, message: "Agenda salva com sucesso (modo simulado)." });
    } catch (err) {
      console.error("[goclaw-routes] Erro ao cadastrar agenda:", err);
      return res.status(500).json({ error: "Falha ao cadastrar agenda.", details: err.message });
    }
  });

  // PATCH /api/goclaw/heloisa/agendas/:id: Atualiza status ou dados da agenda
  app.patch("/api/goclaw/heloisa/agendas/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { nome, email, telefone, papel, ativo, notificar_whatsapp } = req.body || {};

      const updates = [];
      const values = [];
      let idx = 1;

      if (nome !== undefined) { updates.push(`nome = $${idx++}`); values.push(nome); }
      if (email !== undefined) { updates.push(`email = $${idx++}`); values.push(email.trim().toLowerCase()); }
      if (telefone !== undefined) {
        let tVal = null;
        if (telefone) {
          const valids = normalizarNumerosWhatsApp(telefone);
          tVal = valids[0] || null;
        }
        updates.push(`telefone = $${idx++}`);
        values.push(tVal);
      }
      if (papel !== undefined) { updates.push(`papel = $${idx++}`); values.push(papel); }
      if (ativo !== undefined) { updates.push(`ativo = $${idx++}`); values.push(Boolean(ativo)); }
      if (notificar_whatsapp !== undefined) { updates.push(`notificar_whatsapp = $${idx++}`); values.push(Boolean(notificar_whatsapp)); }

      if (updates.length === 0) {
        return res.status(400).json({ error: "Nenhum dado informado para atualização." });
      }

      updates.push(`updated_at = NOW()`);
      values.push(id);

      if (pool && typeof pool.query === "function") {
        const { rows } = await pool.query(
          `UPDATE public.heloisa_agendas SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`,
          values
        );
        return res.json({ ok: true, data: rows[0] });
      }

      return res.json({ ok: true, message: "Agenda atualizada." });
    } catch (err) {
      console.error("[goclaw-routes] Erro ao atualizar agenda:", err);
      return res.status(500).json({ error: "Falha ao atualizar agenda.", details: err.message });
    }
  });

  // DELETE /api/goclaw/heloisa/agendas/:id: Remove agenda
  app.delete("/api/goclaw/heloisa/agendas/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      if (pool && typeof pool.query === "function") {
        await pool.query("DELETE FROM public.heloisa_agendas WHERE id = $1", [id]);
      }
      return res.json({ ok: true, message: "Agenda removida com sucesso." });
    } catch (err) {
      console.error("[goclaw-routes] Erro ao excluir agenda:", err);
      return res.status(500).json({ error: "Falha ao excluir agenda.", details: err.message });
    }
  });
}
