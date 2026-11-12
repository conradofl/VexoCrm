// backend/src/audioLibrary/service.js
//
// Regras e SQL da Biblioteca de Áudios, num lugar só. Rotas, worker de
// follow-up e (Fase 3) o agente de atendimento chamam estas funções — nenhum
// deles escreve SQL próprio contra audio_library.
//
// Isolamento por empresa: TODA consulta daqui leva client_id no WHERE. Quem
// chama passa o tenant que já foi autorizado (rota) ou o tenant dono do job
// (worker). Não existe função que devolva áudio só pelo id para uso em envio.
//
// `db` é qualquer coisa com .query(sql, params) — o pool do pg em produção,
// o pglite nos testes.

import crypto from "crypto";
import { probeAudioBuffer } from "./audioProbe.js";
import { saveFollowupMediaBuffer, getFollowupMediaBuffer } from "../services/storage.js";

export const AUDIO_LIBRARY_MAX_BYTES = 5 * 1024 * 1024;
export const AUDIO_LIBRARY_MAX_SECONDS = 180;
export const AUDIO_LIBRARY_NAME_MAX = 80;
export const AUDIO_LIBRARY_WHEN_TO_USE_MAX = 140;

const SELECT_COLUMNS = `id, client_id, name, when_to_use, storage_key, mime_type, size_bytes,
  duration_seconds, created_by_uid, created_at, updated_at, archived_at`;

function ruleError(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Formato que sai para a tela. storage_key NUNCA sai: a tela ouve pela rota /file. */
export function toPublicAudio(row, extra = {}) {
  return {
    id: row.id,
    name: row.name,
    whenToUse: row.when_to_use,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    durationSeconds: Number(row.duration_seconds),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    ...extra,
  };
}

// Nome do arquivo vira nome do áudio quando a pessoa não digita um: tira a
// extensão e o que não é texto de gente.
export function nameFromFilename(filename) {
  const base = String(filename || "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (base || "Áudio sem nome").slice(0, AUDIO_LIBRARY_NAME_MAX);
}

export function validateName(raw) {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!name) throw ruleError("INVALID_NAME", "Dê um nome para o áudio.");
  if (name.length > AUDIO_LIBRARY_NAME_MAX) {
    throw ruleError("INVALID_NAME", `O nome pode ter até ${AUDIO_LIBRARY_NAME_MAX} caracteres.`);
  }
  return name;
}

// "Quando usar" entra no prompt do agente (Fase 3) — por isso o teto curto e
// sem quebra de linha: é uma frase, não um parágrafo.
export function validateWhenToUse(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw ruleError("INVALID_WHEN_TO_USE", "Texto de \"quando usar\" inválido.");
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length > AUDIO_LIBRARY_WHEN_TO_USE_MAX) {
    throw ruleError(
      "WHEN_TO_USE_TOO_LONG",
      `"Quando usar" pode ter até ${AUDIO_LIBRARY_WHEN_TO_USE_MAX} caracteres (este tem ${text.length}).`
    );
  }
  return text;
}

/**
 * Valida os bytes (tipo, tamanho, duração) ANTES de tocar no storage ou no banco.
 * @returns {{ mimeType: string, extension: string, durationSeconds: number }}
 */
export function validateAudioBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw ruleError("EMPTY_BUFFER", "Arquivo vazio ou não enviado.");
  }
  if (buffer.length > AUDIO_LIBRARY_MAX_BYTES) {
    const mb = (buffer.length / (1024 * 1024)).toFixed(1);
    throw ruleError("FILE_TOO_LARGE", `O áudio tem ${mb} MB. O limite é 5 MB.`);
  }
  const probe = probeAudioBuffer(buffer);
  if (probe.durationSeconds > AUDIO_LIBRARY_MAX_SECONDS) {
    const total = Math.round(probe.durationSeconds);
    const min = Math.floor(total / 60);
    const seg = String(total % 60).padStart(2, "0");
    throw ruleError("AUDIO_TOO_LONG", `O áudio tem ${min}:${seg}. O limite é 3 minutos.`);
  }
  return probe;
}

export async function createAudio(db, { clientId, buffer, name, whenToUse = null, createdByUid = null }) {
  if (!clientId) throw ruleError("MISSING_TENANT_ID", "Empresa não informada.");
  const probe = validateAudioBuffer(buffer);
  const finalName = validateName(name);
  const finalWhenToUse = validateWhenToUse(whenToUse);

  const id = crypto.randomUUID();
  // Nome do objeto no storage é o id + a extensão que os BYTES deram. O nome
  // digitado pelo usuário nunca vira caminho de arquivo.
  const saved = await saveFollowupMediaBuffer({
    clientId,
    buffer,
    declaredFilename: `biblioteca-${id}.${probe.extension}`,
    declaredMimeType: "",
  });

  const { rows } = await db.query(
    `INSERT INTO public.audio_library
       (id, client_id, name, when_to_use, storage_key, mime_type, size_bytes, duration_seconds, created_by_uid)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${SELECT_COLUMNS}`,
    [id, clientId, finalName, finalWhenToUse, saved.storageKey, probe.mimeType, buffer.length, probe.durationSeconds, createdByUid]
  );
  return rows[0];
}

/** Lista para a tela: só os ativos do tenant, com quantos passos de follow-up usam cada um. */
export async function listAudios(db, clientId) {
  const { rows } = await db.query(
    `SELECT ${SELECT_COLUMNS},
            (SELECT count(*)::int
               FROM public.followup_templates ft
               JOIN public.followup_campaigns fc ON fc.id = ft.campaign_id
              WHERE ft.audio_library_id = al.id AND fc.status <> 'archived') AS followup_steps
       FROM public.audio_library al
      WHERE al.client_id = $1 AND al.archived_at IS NULL
      ORDER BY al.created_at DESC`,
    [clientId]
  );
  return rows;
}

/**
 * Só para a ROTA descobrir de que tenant é a linha e então autorizar (mesmo
 * desenho de rag/routes.js). Não usar para enviar nem para servir arquivo.
 */
export async function findAudioTenant(db, id) {
  if (!isUuid(id)) return null;
  const { rows } = await db.query(`SELECT client_id FROM public.audio_library WHERE id = $1`, [id]);
  return rows[0]?.client_id || null;
}

export async function getAudioForTenant(db, { id, clientId, includeArchived = false }) {
  if (!isUuid(id) || !clientId) return null;
  const { rows } = await db.query(
    `SELECT ${SELECT_COLUMNS}
       FROM public.audio_library
      WHERE id = $1 AND client_id = $2 ${includeArchived ? "" : "AND archived_at IS NULL"}`,
    [id, clientId]
  );
  return rows[0] || null;
}

export async function updateAudio(db, { id, clientId, name, whenToUse }) {
  const sets = [];
  const params = [id, clientId];
  if (name !== undefined) {
    params.push(validateName(name));
    sets.push(`name = $${params.length}`);
  }
  if (whenToUse !== undefined) {
    params.push(validateWhenToUse(whenToUse));
    sets.push(`when_to_use = $${params.length}`);
  }
  if (!sets.length) throw ruleError("NOTHING_TO_UPDATE", "Nada para alterar.");

  const { rows } = await db.query(
    `UPDATE public.audio_library
        SET ${sets.join(", ")}, updated_at = now()
      WHERE id = $1 AND client_id = $2 AND archived_at IS NULL
      RETURNING ${SELECT_COLUMNS}`,
    params
  );
  return rows[0] || null;
}

/** Passos de follow-up (de cadência não arquivada) que apontam para o áudio. */
export async function findFollowupStepsUsingAudio(db, { id, clientId }) {
  const { rows } = await db.query(
    `SELECT ft.id AS step_id, ft.name AS step_name, fc.id AS campaign_id, fc.name AS campaign_name
       FROM public.followup_templates ft
       JOIN public.followup_campaigns fc ON fc.id = ft.campaign_id
       JOIN public.audio_library al ON al.id = ft.audio_library_id
      WHERE ft.audio_library_id = $1 AND al.client_id = $2 AND fc.status <> 'archived'
      ORDER BY fc.name, ft.order_index`,
    [id, clientId]
  );
  return rows;
}

/**
 * Apagar = arquivar. Áudio em uso por passo de follow-up NÃO arquiva: a outra
 * opção seria o passo continuar mandando um áudio que a pessoa "apagou", ou
 * sumir da cadência em silêncio. O erro lista onde ele está em uso.
 */
export async function archiveAudio(db, { id, clientId }) {
  const audio = await getAudioForTenant(db, { id, clientId });
  if (!audio) return null;

  const steps = await findFollowupStepsUsingAudio(db, { id, clientId });
  if (steps.length > 0) {
    const onde = steps
      .slice(0, 3)
      .map((s) => `"${s.step_name}" (${s.campaign_name})`)
      .join(", ");
    const resto = steps.length > 3 ? ` e mais ${steps.length - 3}` : "";
    throw ruleError(
      "AUDIO_IN_USE",
      `Este áudio está em uso no follow-up: ${onde}${resto}. Troque o áudio desses passos antes de arquivar.`,
      { steps }
    );
  }

  const { rows } = await db.query(
    `UPDATE public.audio_library
        SET archived_at = now(), updated_at = now()
      WHERE id = $1 AND client_id = $2 AND archived_at IS NULL
      RETURNING ${SELECT_COLUMNS}`,
    [id, clientId]
  );
  return rows[0] || null;
}

/**
 * Bytes do áudio para ouvir na tela ou para enviar. Recusa quando a chave do
 * storage não é do tenant pedido: é a segunda cerca, caso uma linha seja
 * gravada um dia com storage_key de outra empresa.
 */
export async function readAudioFile(audio) {
  const prefixo = `followup-media/${encodeURIComponent(String(audio.client_id).trim())}/`;
  if (!String(audio.storage_key || "").startsWith(prefixo)) {
    throw ruleError("AUDIO_STORAGE_MISMATCH", "Arquivo do áudio não pertence a esta empresa.");
  }
  const file = await getFollowupMediaBuffer(audio.storage_key);
  if (!file?.buffer?.length) {
    throw ruleError("AUDIO_FILE_NOT_FOUND", "O arquivo deste áudio não foi encontrado no armazenamento.");
  }
  return file.buffer;
}

/**
 * Áudio pronto para ENVIO pelo WhatsApp, para um tenant específico. Devolve
 * { ok: false, reason } em vez de lançar: quem envia decide o que fazer com
 * cada motivo (o worker falha o job com o texto; o agente só não manda).
 */
export async function loadAudioForSend(db, { audioId, clientId }) {
  if (!isUuid(audioId) || !clientId) return { ok: false, reason: "audio_invalido" };
  const audio = await getAudioForTenant(db, { id: audioId, clientId, includeArchived: true });
  if (!audio) return { ok: false, reason: "audio_nao_encontrado_nesta_empresa" };
  if (audio.archived_at) return { ok: false, reason: "audio_arquivado" };
  try {
    const buffer = await readAudioFile(audio);
    return { ok: true, audio, buffer };
  } catch (err) {
    return { ok: false, reason: err.code === "AUDIO_STORAGE_MISMATCH" ? "arquivo_de_outra_empresa" : "arquivo_ausente_no_storage" };
  }
}

/**
 * Validação do passo de follow-up que aponta para a biblioteca: o áudio tem
 * que existir, estar ativo e ser do MESMO tenant da cadência. O tenant vem do
 * banco (cadência -> agente), nunca do payload.
 */
export async function assertAudioUsableByCampaign(db, { audioId, campaignId }) {
  if (!isUuid(audioId)) throw ruleError("INVALID_AUDIO", "Áudio da biblioteca inválido.");
  const { rows } = await db.query(
    `SELECT fco.tenant_id
       FROM public.followup_campaigns fc
       JOIN public.followup_companies fco ON fco.id = fc.company_id
      WHERE fc.id = $1`,
    [campaignId]
  );
  const tenantId = rows[0]?.tenant_id || null;
  if (!tenantId) throw ruleError("INVALID_AUDIO", "Cadência sem empresa definida: não dá para usar áudio da biblioteca.");

  const audio = await getAudioForTenant(db, { id: audioId, clientId: tenantId });
  if (!audio) {
    throw ruleError("AUDIO_NOT_AVAILABLE", "Este áudio não existe na biblioteca desta empresa ou foi arquivado.");
  }
  return audio;
}

// ─── Ponte com o follow-up ───────────────────────────────────────────────────
//
// O follow-up já existia antes da biblioteca e tem que continuar funcionando
// se este código subir com o schema antigo (migration que falha não derruba o
// boot: o servidor sobe mesmo assim). Por isso a coluna audio_library_id NUNCA
// entra nas consultas principais do follow-up: é lida à parte, e só o erro de
// "coluna/tabela não existe" é tratado como "sem biblioteca". Qualquer outro
// erro sobe — engolir tudo faria o passo sair sem o áudio, em silêncio.

function isSchemaAusente(err) {
  return err?.code === "42703" || err?.code === "42P01";
}

/** { [templateId]: { audioLibraryId, name, durationSeconds, archived } } dos passos de uma cadência. */
export async function mapLibraryAudioByTemplate(db, campaignId) {
  try {
    const { rows } = await db.query(
      `SELECT ft.id AS template_id, al.id AS audio_id, al.name, al.duration_seconds, al.archived_at
         FROM public.followup_templates ft
         JOIN public.audio_library al ON al.id = ft.audio_library_id
        WHERE ft.campaign_id = $1`,
      [campaignId]
    );
    const map = {};
    for (const row of rows) {
      map[row.template_id] = {
        audioLibraryId: row.audio_id,
        name: row.name,
        durationSeconds: Number(row.duration_seconds),
        archived: Boolean(row.archived_at),
      };
    }
    return map;
  } catch (err) {
    if (isSchemaAusente(err)) return {};
    throw err;
  }
}

/** Id do áudio da biblioteca apontado por um passo, ou null. */
export async function getTemplateLibraryAudioId(db, templateId) {
  if (!templateId) return null;
  try {
    const { rows } = await db.query(
      `SELECT audio_library_id FROM public.followup_templates WHERE id = $1`,
      [templateId]
    );
    return rows[0]?.audio_library_id || null;
  } catch (err) {
    if (isSchemaAusente(err)) return null;
    throw err;
  }
}
