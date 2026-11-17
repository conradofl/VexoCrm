// Portão de idade da mensagem do lead.
//
// Por quê (17/11/2026, leitura de produção): quatro instâncias recebiam da Evolution com horas de atraso (Tinge Brasil
// 44 h, Advocacia Almeida 28 h, Container LED 4,7 h de mediana). O caminho normal nunca comparava a hora REAL da
// mensagem com agora: lote entregue 6 h depois era respondido como novo ("Olá, tudo bem?" seis horas depois) e o passo
// de campanha saía fora de hora. Regra: mensagem do lead com mais de 30 min de idade real não recebe resposta
// automática (nem do agente, nem passo de campanha). Ela fica em "Esperam você" com o motivo, para a equipe.
// Timestamp ausente ou ilegível: passa (não dá para saber a idade).

export const IDADE_MAXIMA_RESPOSTA_MS = 30 * 60 * 1000;

export const MOTIVOS_BARRADO = {
  mensagem_atrasada: "mensagem chegou atrasada",
  envio_sem_confirmacao: "envio do robô sem confirmação",
};

/** Hora da mensagem em ms. Aceita Date, ISO e número (a Evolution manda SEGUNDOS; abaixo de 1e12 é segundo). */
export function horaDaMensagemMs(messageTimestamp) {
  if (messageTimestamp === null || messageTimestamp === undefined || messageTimestamp === "") return null;
  if (messageTimestamp instanceof Date) return Number.isFinite(messageTimestamp.getTime()) ? messageTimestamp.getTime() : null;
  const bruto = String(messageTimestamp).trim();
  if (/^\d+(\.\d+)?$/.test(bruto)) {
    const n = Number(bruto);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  }
  const t = Date.parse(bruto);
  return Number.isFinite(t) ? t : null;
}

/** Idade real em ms (agora menos a hora da mensagem), ou null se o timestamp não for legível. */
export function idadeRealMs(messageTimestamp, agora = Date.now()) {
  const t = horaDaMensagemMs(messageTimestamp);
  return t === null ? null : agora - t;
}

/** { idadeMin } quando a mensagem passou do teto; null quando está dentro ou sem hora. */
export function mensagemAtrasada(messageTimestamp, agora = Date.now(), tetoMs = IDADE_MAXIMA_RESPOSTA_MS) {
  const idade = idadeRealMs(messageTimestamp, agora);
  if (idade === null || idade <= tetoMs) return null;
  return { idadeMin: Math.round(idade / 60000) };
}

/**
 * Marca a mensagem do lead como "o robô não respondeu, por este motivo" (lead_messages.meta.agente_barrado). É o que faz
 * a conversa aparecer em "Esperam você" com o motivo, mesmo em chip com robô, SEM pausar o agente (a próxima mensagem do
 * lead segue normal). Sem coluna nova: funciona com o runner de migration travado. Nunca lança.
 */
export async function marcarMensagemBarrada(pool, { clientId, waMessageId, motivo }) {
  if (!pool || !clientId || !waMessageId || !motivo) return false;
  try {
    const { rowCount } = await pool.query(
      `UPDATE public.lead_messages
          SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('agente_barrado', $3::text, 'agente_barrado_em', now())
        WHERE client_id = $1 AND wa_message_id = $2 AND direction = 'inbound'`,
      [clientId, String(waMessageId), String(motivo)]
    );
    return rowCount > 0;
  } catch (err) {
    console.warn("[agente] falha ao marcar mensagem barrada", { clientId, motivo, erro: err?.message || err });
    return false;
  }
}
