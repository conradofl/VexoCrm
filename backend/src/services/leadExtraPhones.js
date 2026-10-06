// Telefones adicionais do lead (dados.telefones_extras) que coincidem com OUTRO lead da empresa. Arquivo à parte de propósito: aqui só se grava `dados`
// (nunca `stage`), e o guarda leadStageWriteGuard.test.js exige que todo arquivo que escreve em leads e monta payload com stage passe por leadUpsert.js.

/**
 * Telefone adicional que JÁ É outro lead da empresa: não funde (fusão de lead é decisão de pessoa), só registra a coincidência em
 * dados.telefones_extras[].ja_existe_como_lead (id do outro lead). Roda DEPOIS do upsert do lote, quando todos os leads (os que já existiam, os de
 * lotes anteriores e os deste lote) têm id; o próprio lead é excluído. Devolve quantas coincidências registrou.
 */
export async function markExtraPhoneCollisions(pool, clientId, leads) {
  const comExtras = leads.filter((l) => Array.isArray(l.dados?.telefones_extras) && l.dados.telefones_extras.length > 0);
  if (comExtras.length === 0) return 0;
  const key = (p) => String(p ?? "").replace(/^\+/, "").replace(/\D/g, "");
  const phones = new Set();
  for (const l of comExtras) {
    phones.add(key(l.telefone));
    for (const e of l.dados.telefones_extras) phones.add(key(e.telefone));
  }
  const variants = [...phones].flatMap((p) => [p, `+${p}`]);
  const { rows } = await pool.query(
    `SELECT id::text AS id, telefone, phone FROM public.leads WHERE client_id = $1 AND (telefone = ANY($2::text[]) OR phone = ANY($2::text[]))`,
    [clientId, variants]
  );
  const idByPhone = new Map();
  for (const r of rows) {
    if (r.telefone) idByPhone.set(key(r.telefone), r.id);
    if (r.phone) idByPhone.set(key(r.phone), r.id);
  }
  let registered = 0;
  for (const l of comExtras) {
    const ownId = idByPhone.get(key(l.telefone));
    if (!ownId) continue;
    const phonesArr = [];
    const othersArr = [];
    for (const e of l.dados.telefones_extras) {
      const other = idByPhone.get(key(e.telefone));
      if (other && other !== ownId) {
        phonesArr.push(key(e.telefone));
        othersArr.push(other);
      }
    }
    if (phonesArr.length === 0) continue;
    await pool.query(
      `UPDATE public.leads l
          SET dados = jsonb_set(l.dados, '{telefones_extras}', (
            SELECT jsonb_agg(CASE WHEN c.other IS NOT NULL THEN t.e || jsonb_build_object('ja_existe_como_lead', c.other) ELSE t.e END ORDER BY t.ord)
              FROM jsonb_array_elements(l.dados->'telefones_extras') WITH ORDINALITY AS t(e, ord)
              LEFT JOIN unnest($2::text[], $3::text[]) AS c(phone, other) ON c.phone = t.e->>'telefone'
          ))
        WHERE l.id::text = $1 AND jsonb_typeof(l.dados->'telefones_extras') = 'array'`,
      [ownId, phonesArr, othersArr]
    );
    registered += phonesArr.length;
  }
  return registered;
}

