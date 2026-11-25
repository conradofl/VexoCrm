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

// A busca de Conversas só usa o mapa LID -> telefone se a coluna existir (information_schema). Sem a coluna, a
// consulta inteira quebraria ("column lb.phone does not exist") e nenhuma busca funcionaria. "Tem" fica guardado
// para sempre; "não tem" é conferido de novo depois de 10 min.
const CONFERIR_DE_NOVO_MS = 10 * 60 * 1000;
const cacheTelefoneNoMapa = new WeakMap();

export async function mapaDeLidTemTelefone(pool, agora = Date.now()) {
  if (!pool || typeof pool !== "object") return false;
  const guardado = cacheTelefoneNoMapa.get(pool);
  if (guardado && (guardado.tem || agora - guardado.em < CONFERIR_DE_NOVO_MS)) return guardado.tem;
  let tem = false;
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'whatsapp_lid_map' AND column_name = 'phone' LIMIT 1`
    );
    tem = Array.isArray(rows) && rows.length > 0;
  } catch {
    tem = false;
  }
  cacheTelefoneNoMapa.set(pool, { tem, em: agora });
  return tem;
}

// Conversa partida pelo LID (25/11/2026, vexo-adm, chip "Vexo campanha"): a mensagem do aparelho chegou com
// remoteJid "36305392136404@lid" e SEM telefone real no payload. O sanitizePhone tirou o "@lid" e o LID de 14 dígitos
// virou "telefone" (a tela mostrou +36, Hungria); LID de 15 dígitos virava null e a mensagem era jogada fora como
// "missing_phone". A resposta da cliente, que veio com o telefone real, caiu em outra conversa.
// Regra: LID nunca vira telefone. Telefone real do payload > telefone já conhecido no mapa > o próprio JID "NNN@lid"
// (mesma grafia que o sincronizar usa). Quando o telefone real aparece, as mensagens gravadas pelo LID se juntam a ele.

/** "NNN@lid" (minúsculo, só dígitos antes do @) se o identificador da conversa é um LID; senão null. */
export function lidDoIdentificador(identificador) {
  const m = /^(\d{6,20})@lid$/i.exec(String(identificador || "").trim());
  return m ? `${m[1]}@lid` : null;
}

/** Telefone real já conhecido para o LID (whatsapp_lid_map), só dígitos; null se não houver. Nunca derruba. */
export async function telefoneDoLidConhecido(pool, lid) {
  if (!pool || !lid) return null;
  const digitos = String(lid).split("@")[0];
  try {
    const { rows } = await pool.query(
      `SELECT phone FROM public.whatsapp_lid_map
       WHERE lid = ANY($1::text[]) AND phone IS NOT NULL AND phone <> ''
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1`,
      [[lid, digitos]]
    );
    const tel = String(rows?.[0]?.phone || "").split("@")[0].replace(/\D/g, "");
    return tel || null;
  } catch (err) {
    console.warn("[lid-map] falha ao consultar LID:", err?.code || err?.message || err);
    return null;
  }
}

/**
 * Leva para o telefone real as mensagens que o webhook gravou pelo LID por não saber o telefone (meta.lidSemTelefone).
 * Só essas: conversa antiga partida (gravada antes deste conserto) não é tocada aqui.
 */
export async function juntarMensagensDoLid(pool, { clientId, lid, phone }) {
  if (!pool || !clientId || !lid || !phone) return 0;
  try {
    const r = await pool.query(
      `UPDATE public.lead_messages
          SET phone = $3,
              meta = (COALESCE(meta, '{}'::jsonb) - 'lidSemTelefone') || jsonb_build_object('lid', $2::text)
        WHERE client_id = $1 AND phone = $2 AND meta->>'lidSemTelefone' = 'true'`,
      [clientId, lid, phone]
    );
    const n = Number(r?.rowCount || 0);
    if (n > 0) console.log("[lid-map] mensagens gravadas pelo LID juntadas ao telefone real", { clientId, mensagens: n });
    return n;
  } catch (err) {
    console.warn("[lid-map] falha ao juntar mensagens do LID:", err?.code || err?.message || err);
    return 0;
  }
}
