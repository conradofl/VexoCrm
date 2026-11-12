// backend/src/audioLibrary/agentAudio.js
//
// Fase 3 da Biblioteca de Áudios: o agente de ATENDIMENTO manda, na conversa,
// um áudio gravado pela empresa.
//
// Como a IA escolhe: por um campo "audio" no JSON da resposta, com um código
// curto (A1, A2...). Não é marcador dentro do texto — a guarda de saída
// (validateOutboundMessage) recusa resposta que começa com colchete, e um
// marcador ali apagaria a resposta inteira.
//
// Contenções de prompt (o limite real é a cota de tokens por minuto do
// provedor de IA):
//   - o catálogo leva só código, nome e "quando usar" (até 140 caracteres).
//     Nenhum outro texto do áudio vai ao modelo;
//   - no máximo AGENT_AUDIO_MAX_ITEMS áudios por agente. A rota de ligação já
//     recusa o que passa disso; se ainda assim o catálogo bater o máximo
//     (linha escrita por fora), ele SAI do prompt inteiro neste turno, em vez
//     de ser cortado pela metade ou de estourar a cota;
//   - o modelo nunca vê id de banco: o código é resolvido aqui.
//
// Outras regras fechadas: um áudio por turno; o texto vai antes do áudio;
// áudio da biblioteca vence a voz sintética; não conta na cota do chip (cota
// é da campanha); só agente com agent_kind = 'atendimento'.

import { sendMediaMessageViaEvolution } from "../services/evolution.js";
import { AGENT_AUDIO_MAX_ITEMS, isUuid, loadAudioForSend } from "./service.js";

export { AGENT_AUDIO_MAX_ITEMS };
export const AGENT_AUDIO_BLOCK_MAX_CHARS = 3200;
export const AGENT_AUDIO_SEND_TIMEOUT_MS = 20_000;
// Mesmo áudio não volta para o mesmo lead dentro desta janela.
export const AGENT_AUDIO_REPEAT_WINDOW_DAYS = 30;

const EMPTY_CATALOG = Object.freeze({ entries: [], block: "", reason: "sem_audios" });

function isSchemaAusente(err) {
  return err?.code === "42703" || err?.code === "42P01";
}

function phoneTail(phone) {
  return String(phone || "").replace(/\D/g, "").slice(-8);
}

/** Aceita só o código do catálogo (A1..A99). Qualquer outra coisa vira null. */
export function normalizeAudioChoice(value) {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^A[1-9]\d?$/.test(code) ? code : null;
}

export function buildAgentAudioBlock(entries) {
  if (!entries.length) return "";
  const linhas = entries.map((e) => `${e.code} — "${e.name}": ${e.whenToUse}`);
  return `

ÁUDIOS GRAVADOS PELA EMPRESA (você pode enviar no máximo UM por resposta):
${linhas.join("\n")}

COMO ENVIAR UM ÁUDIO:
• Inclua no JSON o campo "audio" com o código do áudio (ex.: "audio": "A1"). Sem áudio nesta resposta: "audio": null.
• Só envie quando a situação descrita depois dos dois-pontos bater com o que o lead acabou de dizer. Na dúvida, não envie.
• Nunca envie o mesmo áudio duas vezes na mesma conversa.
• O texto em "mensagem" continua obrigatório e é enviado ANTES do áudio: escreva uma frase curta que faça sentido sozinha. Não cite o código, não escreva "[áudio]" e não descreva o áudio em "mensagem".`;
}

/**
 * Catálogo de áudios que ESTE agente pode enviar, com o bloco de prompt
 * pronto. Tudo filtrado por tenant; agente de campanha ou arquivado não tem
 * catálogo. Erro de "tabela não existe" (schema antigo) é catálogo vazio.
 */
export async function loadAgentAudioCatalog(db, { clientId, companyId }) {
  if (!db || !clientId || !isUuid(companyId)) return EMPTY_CATALOG;

  let rows;
  try {
    ({ rows } = await db.query(
      `SELECT al.id, al.name, al.when_to_use
         FROM public.audio_library_agents ala
         JOIN public.audio_library al       ON al.id = ala.audio_id
         JOIN public.followup_companies fco ON fco.id = ala.company_id
        WHERE ala.company_id = $1
          AND ala.client_id = $2
          AND al.client_id = $2
          AND fco.tenant_id = $2
          AND fco.agent_kind = 'atendimento'
          AND fco.archived_at IS NULL
          AND al.archived_at IS NULL
          AND al.when_to_use IS NOT NULL
        ORDER BY al.created_at, al.id
        LIMIT ${AGENT_AUDIO_MAX_ITEMS + 1}`,
      [companyId, clientId]
    ));
  } catch (err) {
    if (isSchemaAusente(err)) return EMPTY_CATALOG;
    throw err;
  }

  if (!rows.length) return EMPTY_CATALOG;

  const entries = rows.map((row, i) => ({
    code: `A${i + 1}`,
    id: row.id,
    name: row.name,
    whenToUse: row.when_to_use,
  }));
  const block = buildAgentAudioBlock(entries);

  if (rows.length > AGENT_AUDIO_MAX_ITEMS || block.length > AGENT_AUDIO_BLOCK_MAX_CHARS) {
    console.warn("[audio-library] catálogo do agente bateu o máximo — fora do prompt neste turno", {
      clientId,
      companyId,
      audios: rows.length,
      caracteres: block.length,
    });
    return { entries: [], block: "", reason: "catalogo_acima_do_maximo" };
  }

  return { entries, block, reason: null };
}

/** Código devolvido pelo modelo -> áudio do catálogo carregado NESTE turno, ou null. */
export function resolveAudioChoice(catalog, rawChoice) {
  const code = normalizeAudioChoice(rawChoice);
  if (!code || !catalog?.entries?.length) return null;
  const entry = catalog.entries.find((e) => e.code === code);
  return entry ? { id: entry.id, name: entry.name, code: entry.code } : null;
}

async function isAudioStillLinked(db, { audioId, companyId, clientId }) {
  const { rows } = await db.query(
    `SELECT 1
       FROM public.audio_library_agents ala
       JOIN public.followup_companies fco ON fco.id = ala.company_id
      WHERE ala.audio_id = $1 AND ala.company_id = $2 AND ala.client_id = $3
        AND fco.tenant_id = $3 AND fco.agent_kind = 'atendimento' AND fco.archived_at IS NULL
      LIMIT 1`,
    [audioId, companyId, clientId]
  );
  return rows.length > 0;
}

// O histórico de envio É a tabela de mensagens (meta.audioLibraryId): não há
// contador à parte para ficar fora de sincronia.
async function wasAudioSentToPhone(db, { clientId, phone, audioId }) {
  const tail = phoneTail(phone);
  if (!tail) return false;
  const { rows } = await db.query(
    `SELECT 1
       FROM public.lead_messages
      WHERE client_id = $1
        AND created_at > now() - make_interval(days => $4::int)
        AND meta->>'audioLibraryId' = $2
        AND right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 8) = $3
      LIMIT 1`,
    [clientId, audioId, tail, AGENT_AUDIO_REPEAT_WINDOW_DAYS]
  );
  return rows.length > 0;
}

/**
 * Envia o áudio escolhido pelo agente, DEPOIS do texto já entregue. Nunca
 * lança: devolve { sent, reason }. Um envio só, sem nova tentativa — se a
 * Evolution demorar ou falhar, o lead fica com o texto (que já faz sentido
 * sozinho) e o motivo vai para o log.
 *
 * Confere de novo, na hora do envio, tudo que o catálogo conferiu: áudio do
 * tenant, ativo, com arquivo, ainda ligado a este agente de atendimento.
 */
export async function sendAgentLibraryAudio({
  db,
  clientId,
  companyId,
  phone,
  instanceName,
  apiKey,
  baseUrl,
  audioRef,
  appendLeadMessage,
  model = null,
}) {
  const logCtx = { clientId, companyId, audioId: audioRef?.id || null };
  try {
    if (!db || !audioRef?.id || !isUuid(companyId)) return { sent: false, reason: "pedido_invalido" };

    if (!(await isAudioStillLinked(db, { audioId: audioRef.id, companyId, clientId }))) {
      console.warn("[audio-library] áudio não enviado: não está ligado a este agente de atendimento", logCtx);
      return { sent: false, reason: "audio_nao_ligado_ao_agente" };
    }

    const loaded = await loadAudioForSend(db, { audioId: audioRef.id, clientId });
    if (!loaded.ok) {
      console.warn("[audio-library] áudio não enviado:", loaded.reason, logCtx);
      return { sent: false, reason: loaded.reason };
    }

    if (await wasAudioSentToPhone(db, { clientId, phone, audioId: audioRef.id })) {
      console.info("[audio-library] áudio não enviado: este lead já recebeu este áudio", logCtx);
      return { sent: false, reason: "ja_enviado_a_este_lead" };
    }

    let result;
    try {
      result = await sendMediaMessageViaEvolution({
        instanceName,
        number: phone,
        mediaType: "audio",
        base64: loaded.buffer.toString("base64"),
        mimetype: loaded.audio.mime_type,
        webhookToken: apiKey,
        baseUrl,
        timeoutMs: AGENT_AUDIO_SEND_TIMEOUT_MS,
      });
    } catch (err) {
      console.error("[audio-library] falha ao enviar áudio do agente (sem nova tentativa):", err?.message || err, logCtx);
      return { sent: false, reason: "falha_no_envio" };
    }

    // Mensagem própria, separada do texto: é dela que sai o histórico e a
    // contagem de envios do áudio.
    try {
      await appendLeadMessage({
        clientId,
        phone,
        senderType: "bot",
        direction: "outbound",
        messageText: `[áudio: ${loaded.audio.name}]`,
        meta: {
          source: "hardcoded-chat-webhook",
          model,
          isLibraryAudio: true,
          audioLibraryId: loaded.audio.id,
          audioName: loaded.audio.name,
          companyId,
        },
        instanceName,
        waMessageId: result?.waMessageId || null,
        messageTimestamp: new Date().toISOString(),
        contentType: "audio",
      });
    } catch (err) {
      console.error("[audio-library] áudio ENVIADO, mas a mensagem não foi gravada:", err?.message || err, logCtx);
      return { sent: true, reason: "enviado_sem_registro", waMessageId: result?.waMessageId || null };
    }

    return { sent: true, reason: null, waMessageId: result?.waMessageId || null };
  } catch (err) {
    console.error("[audio-library] erro ao preparar áudio do agente:", err?.message || err, logCtx);
    return { sent: false, reason: "erro_interno" };
  }
}
