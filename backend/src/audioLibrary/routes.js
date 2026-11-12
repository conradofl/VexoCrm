// backend/src/audioLibrary/routes.js
//
// Biblioteca de Áudios: áudios gravados pelo próprio cliente, reutilizáveis.
// Mesmo desenho de rag/routes.js — corpo binário cru (express.raw + limite
// próprio da rota), gate em duas partes (usuário no router, tenant em cada
// rota) e, nas rotas por :id, o tenant vem da LINHA do banco e é conferido
// contra o escopo de quem pediu, nunca do payload.

import express from "express";
import { requireFirebaseAuth } from "../access/middlewares.js";
import { pgDatabasePool } from "../services/database.js";
import { resolveAuthorizedClientId } from "../services/tenant.js";
import { evaluateAudioLibraryUser, evaluateAudioLibraryAccess } from "./access.js";
import {
  AUDIO_LIBRARY_MAX_BYTES,
  AUDIO_LIBRARY_MAX_SECONDS,
  AUDIO_LIBRARY_NAME_MAX,
  AUDIO_LIBRARY_WHEN_TO_USE_MAX,
  AGENT_AUDIO_MAX_ITEMS,
  AUDIO_USAGE_WINDOW_DAYS,
  archiveAudio,
  countAudioSends,
  createAudio,
  listAttendanceAgents,
  setAudioAgents,
  findAudioTenant,
  getAudioForTenant,
  listAudios,
  nameFromFilename,
  readAudioFile,
  toPublicAudio,
  updateAudio,
} from "./service.js";

// Erros de regra (o usuário consegue corrigir) viram 400/409 com a mensagem
// pronta; o resto é 500.
const RULE_ERROR_STATUS = {
  EMPTY_BUFFER: 400,
  FILE_TOO_LARGE: 400,
  INVALID_AUDIO_TYPE: 400,
  AUDIO_DURATION_UNKNOWN: 400,
  AUDIO_TOO_LONG: 400,
  INVALID_NAME: 400,
  INVALID_WHEN_TO_USE: 400,
  WHEN_TO_USE_TOO_LONG: 400,
  NOTHING_TO_UPDATE: 400,
  WHEN_TO_USE_REQUIRED: 400,
  INVALID_AGENTS: 400,
  AGENT_NOT_AVAILABLE: 400,
  AGENT_AUDIO_LIMIT: 409,
  AUDIO_IN_USE: 409,
};

function sendErr(res, status, code, message, extra = {}) {
  console.error(`[audioLibrary/routes][${code}]`, message);
  return res.status(status).json({ success: false, error: { code, message, ...extra } });
}

function sendRuleOrServerErr(res, err, fallbackCode, fallbackMessage) {
  const status = RULE_ERROR_STATUS[err?.code];
  if (status) {
    const extra = err.code === "AUDIO_IN_USE" ? { steps: err.steps || [] } : {};
    return sendErr(res, status, err.code, err.message, extra);
  }
  return sendErr(res, 500, err?.code || fallbackCode, err?.message || fallbackMessage);
}

function str(v) {
  return typeof v === "string" ? v.trim() || null : null;
}

function decodeHeader(raw) {
  if (raw === undefined || raw === null) return null;
  try {
    return decodeURIComponent(String(raw)).trim() || null;
  } catch {
    return String(raw).trim() || null;
  }
}

function getDb() {
  return pgDatabasePool;
}

function requireAudioLibraryUser(req, res, next) {
  const verdict = evaluateAudioLibraryUser(req.authAccess);
  if (!verdict.allowed) return sendErr(res, verdict.status, verdict.reason, verdict.message);
  return next();
}

async function assertAudioLibraryAccess(req, res, clientId) {
  const verdict = await evaluateAudioLibraryAccess(req.authAccess, clientId);
  if (verdict.allowed) return true;
  sendErr(res, verdict.status, verdict.reason, verdict.message);
  return false;
}

// Rotas por :id: acha o tenant dono da linha, confere contra o escopo de quem
// pediu (403 se não bate) e contra o gate do tenant. Devolve o clientId
// autorizado ou null (resposta já enviada).
async function authorizeById(req, res, pool, id) {
  const ownerClientId = await findAudioTenant(pool, id);
  if (!ownerClientId) {
    sendErr(res, 404, "NOT_FOUND", "Áudio não encontrado.");
    return null;
  }
  const clientId = resolveAuthorizedClientId(req, res, ownerClientId);
  if (!clientId) return null;
  if (!(await assertAudioLibraryAccess(req, res, clientId))) return null;
  return clientId;
}

export function registerAudioLibraryRoutes(app) {
  const router = express.Router();

  // GET /api/audio-library/access?clientId= — a tela pergunta antes de mostrar
  // a aba funcionando. Antes do router.use: quem não pode recebe
  // { allowed: false } com o motivo, saído da MESMA função do gate.
  router.get("/access", requireFirebaseAuth, async (req, res) => {
    const clientId = resolveAuthorizedClientId(req, res, str(req.query.clientId));
    if (!clientId) return;
    const verdict = await evaluateAudioLibraryAccess(req.authAccess, clientId);
    return res.json({
      success: true,
      allowed: verdict.allowed,
      reason: verdict.reason,
      message: verdict.message,
      limits: {
        maxBytes: AUDIO_LIBRARY_MAX_BYTES,
        maxSeconds: AUDIO_LIBRARY_MAX_SECONDS,
        nameMax: AUDIO_LIBRARY_NAME_MAX,
        whenToUseMax: AUDIO_LIBRARY_WHEN_TO_USE_MAX,
        agentMaxAudios: AGENT_AUDIO_MAX_ITEMS,
      },
    });
  });

  router.use(requireFirebaseAuth, requireAudioLibraryUser);

  // GET /api/audio-library?clientId= — áudios ativos da empresa.
  router.get("/", async (req, res) => {
    const clientId = resolveAuthorizedClientId(req, res, str(req.query.clientId));
    if (!clientId) return;
    if (!(await assertAudioLibraryAccess(req, res, clientId))) return;

    const pool = getDb();
    if (!pool) return sendErr(res, 500, "DB_UNAVAILABLE", "Banco de dados indisponível.");
    try {
      const rows = await listAudios(pool, clientId);
      return res.json({
        success: true,
        audios: rows.map((row) =>
          toPublicAudio(row, { followupSteps: row.followup_steps, agentIds: row.agent_ids || [] })
        ),
      });
    } catch (err) {
      return sendErr(res, 500, "AUDIO_LIST_FAILED", err.message || "Falha ao listar os áudios.");
    }
  });

  // GET /api/audio-library/agents?clientId= — agentes de ATENDIMENTO da empresa
  // (os únicos que podem enviar áudio na conversa), com quantos áudios já têm.
  router.get("/agents", async (req, res) => {
    const clientId = resolveAuthorizedClientId(req, res, str(req.query.clientId));
    if (!clientId) return;
    if (!(await assertAudioLibraryAccess(req, res, clientId))) return;
    const pool = getDb();
    if (!pool) return sendErr(res, 500, "DB_UNAVAILABLE", "Banco de dados indisponível.");
    try {
      const rows = await listAttendanceAgents(pool, clientId);
      return res.json({
        success: true,
        agents: rows.map((a) => ({ id: a.id, name: a.name, audioCount: a.audio_count })),
        maxAudiosPerAgent: AGENT_AUDIO_MAX_ITEMS,
      });
    } catch (err) {
      return sendErr(res, 500, "AUDIO_AGENTS_FAILED", err.message || "Falha ao listar os agentes.");
    }
  });

  // GET /api/audio-library/usage?clientId= — envios de cada áudio pelo agente,
  // contados nas mensagens gravadas. Rota à parte: a lista não espera por ela.
  router.get("/usage", async (req, res) => {
    const clientId = resolveAuthorizedClientId(req, res, str(req.query.clientId));
    if (!clientId) return;
    if (!(await assertAudioLibraryAccess(req, res, clientId))) return;
    const pool = getDb();
    if (!pool) return sendErr(res, 500, "DB_UNAVAILABLE", "Banco de dados indisponível.");
    try {
      return res.json({ success: true, windowDays: AUDIO_USAGE_WINDOW_DAYS, sends: await countAudioSends(pool, clientId) });
    } catch (err) {
      return sendErr(res, 500, "AUDIO_USAGE_FAILED", err.message || "Falha ao contar os envios.");
    }
  });

  // POST /api/audio-library?clientId=&name=&whenToUse=
  // Corpo: os bytes do áudio. Header opcional: X-File-Name (urlencoded) — só
  // serve de nome padrão quando `name` não vem; nunca decide o tipo do arquivo.
  // Limite da ROTA (6 MB) > teto do NEGÓCIO (5 MB, conferido no serviço): um
  // arquivo um pouco acima do teto tem que receber a mensagem de verdade, não
  // o 413 genérico do Express.
  router.post("/", express.raw({ type: () => true, limit: "6mb" }), async (req, res) => {
    const clientId = resolveAuthorizedClientId(req, res, str(req.query.clientId));
    if (!clientId) return;
    if (!(await assertAudioLibraryAccess(req, res, clientId))) return;

    const buffer = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buffer || buffer.length === 0) {
      return sendErr(res, 400, "EMPTY_BUFFER", "Arquivo vazio ou não enviado.");
    }

    const pool = getDb();
    if (!pool) return sendErr(res, 500, "DB_UNAVAILABLE", "Banco de dados indisponível.");

    const filename = decodeHeader(req.headers["x-file-name"]) || str(req.query.filename);
    const name = str(req.query.name) || nameFromFilename(filename);
    const whenToUse = str(req.query.whenToUse);

    try {
      const row = await createAudio(pool, {
        clientId,
        buffer,
        name,
        whenToUse,
        createdByUid: req.authUser?.uid || req.authAccess?.uid || null,
      });
      return res.status(201).json({ success: true, audio: toPublicAudio(row, { followupSteps: 0, agentIds: [] }) });
    } catch (err) {
      return sendRuleOrServerErr(res, err, "AUDIO_CREATE_FAILED", "Falha ao salvar o áudio.");
    }
  });

  // PATCH /api/audio-library/:id  { name?, whenToUse? } — renomear e "quando usar".
  router.patch("/:id", async (req, res) => {
    const pool = getDb();
    if (!pool) return sendErr(res, 500, "DB_UNAVAILABLE", "Banco de dados indisponível.");
    try {
      const clientId = await authorizeById(req, res, pool, req.params.id);
      if (!clientId) return;

      const body = req.body && typeof req.body === "object" ? req.body : {};
      const row = await updateAudio(pool, {
        id: req.params.id,
        clientId,
        name: "name" in body ? body.name : undefined,
        whenToUse: "whenToUse" in body ? body.whenToUse : undefined,
      });
      if (!row) return sendErr(res, 404, "NOT_FOUND", "Áudio não encontrado.");
      return res.json({ success: true, audio: toPublicAudio(row) });
    } catch (err) {
      return sendRuleOrServerErr(res, err, "AUDIO_UPDATE_FAILED", "Falha ao alterar o áudio.");
    }
  });

  // PUT /api/audio-library/:id/agents  { companyIds: [] } — quais agentes de
  // atendimento podem enviar este áudio na conversa (substitui a lista).
  router.put("/:id/agents", async (req, res) => {
    const pool = getDb();
    if (!pool) return sendErr(res, 500, "DB_UNAVAILABLE", "Banco de dados indisponível.");
    try {
      const clientId = await authorizeById(req, res, pool, req.params.id);
      if (!clientId) return;
      const agentIds = await setAudioAgents(pool, { id: req.params.id, clientId, companyIds: req.body?.companyIds });
      if (!agentIds) return sendErr(res, 404, "NOT_FOUND", "Áudio não encontrado.");
      return res.json({ success: true, agentIds });
    } catch (err) {
      return sendRuleOrServerErr(res, err, "AUDIO_AGENTS_UPDATE_FAILED", "Falha ao salvar os agentes do áudio.");
    }
  });

  // POST /api/audio-library/:id/archive — apagar = arquivar. 409 se em uso.
  router.post("/:id/archive", async (req, res) => {
    const pool = getDb();
    if (!pool) return sendErr(res, 500, "DB_UNAVAILABLE", "Banco de dados indisponível.");
    try {
      const clientId = await authorizeById(req, res, pool, req.params.id);
      if (!clientId) return;

      const row = await archiveAudio(pool, { id: req.params.id, clientId });
      if (!row) return sendErr(res, 404, "NOT_FOUND", "Áudio não encontrado.");
      return res.json({ success: true, audioId: row.id });
    } catch (err) {
      return sendRuleOrServerErr(res, err, "AUDIO_ARCHIVE_FAILED", "Falha ao arquivar o áudio.");
    }
  });

  // GET /api/audio-library/:id/file — os bytes, para ouvir na tela. Passa pelo
  // mesmo gate das outras rotas: não existe URL pública do arquivo.
  router.get("/:id/file", async (req, res) => {
    const pool = getDb();
    if (!pool) return sendErr(res, 500, "DB_UNAVAILABLE", "Banco de dados indisponível.");
    try {
      const clientId = await authorizeById(req, res, pool, req.params.id);
      if (!clientId) return;

      const audio = await getAudioForTenant(pool, { id: req.params.id, clientId });
      if (!audio) return sendErr(res, 404, "NOT_FOUND", "Áudio não encontrado.");

      const buffer = await readAudioFile(audio);
      res.setHeader("Content-Type", audio.mime_type);
      res.setHeader("Content-Length", String(buffer.length));
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.status(200).send(buffer);
    } catch (err) {
      const status = err?.code === "AUDIO_FILE_NOT_FOUND" ? 404 : 500;
      return sendErr(res, status, err?.code || "AUDIO_FILE_FAILED", err?.message || "Falha ao ler o áudio.");
    }
  });

  app.use("/api/audio-library", router);
}
