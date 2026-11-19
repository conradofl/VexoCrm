// LID -> telefone real, pelo próprio webhook (19/11/2026).
//
// O WhatsApp passou a identificar parte dos contatos por LID ("185621455499360@lid"), que não é telefone. A Baileys 7
// (Evolution 2.3.7) manda junto o telefone real em key.remoteJidAlt (ou senderPn). O webhook ignorava esse campo:
// - LID de 15 dígitos virava null no sanitizePhone e a mensagem era descartada como "missing_phone";
// - LID de 14 dígitos era gravado como se fosse telefone, e a busca de Conversas pelo número não achava a conversa.
// O mapa public.whatsapp_lid_map (lid, phone) só era preenchido pelo sincronizar (services/evolution.js, rememberLid).

const JID_TELEFONE = /^(\d{10,15})@(s\.whatsapp\.net|c\.us)$/i;

/**
 * Se o identificador da conversa é um LID e o corpo do webhook traz o telefone real, devolve { lid, phone }.
 * phone sai só com dígitos, sem canonizar (quem canoniza é o sanitizePhone do webhook). Senão, null.
 */
export function telefoneRealDoLid(body, identificador) {
  const lid = String(identificador || "").trim();
  if (!lid.toLowerCase().endsWith("@lid")) return null;
  const key = body?.data?.key || body?.key || {};
  const candidatos = [key.remoteJidAlt, key.senderPn, body?.data?.senderPn, body?.senderPn, body?.data?.remoteJidAlt];
  for (const c of candidatos) {
    const m = JID_TELEFONE.exec(String(c || "").trim());
    if (m) return { lid, phone: m[1] };
  }
  return null;
}

/** Grava (ou atualiza) o par LID -> telefone. Nunca derruba o webhook: erro só vira log. */
export async function registrarLidDoWebhook(pool, { lid, phone }) {
  if (!pool || !lid || !phone) return false;
  try {
    await pool.query(
      `INSERT INTO public.whatsapp_lid_map (lid, phone, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (lid) DO UPDATE SET phone = EXCLUDED.phone, updated_at = now()`,
      [lid, phone]
    );
    return true;
  } catch (err) {
    console.warn("[lid-map] falha ao gravar LID do webhook:", err?.code || err?.message || err);
    return false;
  }
}
