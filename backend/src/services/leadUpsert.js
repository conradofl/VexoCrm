// Upsert de lead por (client_id, telefone) SEM depender de índice único.
//
// Por que existe: o código usava `INSERT ... ON CONFLICT (client_id, telefone)` ou
// `supabase.from("leads").upsert(..., { onConflict: "client_id,telefone" })`,
// que exige um índice único nessas colunas. Esse índice já sumiu duas vezes
// (a tabela public.leads foi recriada por outro caminho), e quando ele falta o
// Postgres responde "there is no unique or exclusion constraint matching the
// ON CONFLICT specification" — derrubando em silêncio a importação de CSV,
// a gravação de nomes na aba Conversas e os webhooks de entrada.
//
// Estratégia unificada:
// 1. Deduplicação em memória por telefone normalizado (dentro do próprio lote/arquivo).
// 2. Busca do lead existente por (client_id, telefone/phone) sem depender de constraint.
//    - Se já existe: atualiza campos, preservando nome bom anterior se o novo for vazio/placeholder,
//      e mescla tags e dados JSON.
//    - Se não existe: insere novo lead.
// Funciona 100% com ou sem o índice.

/**
 * Valida se uma string é um nome humano real (e não telefone, placeholder ou vazio).
 * @param {unknown} n
 * @returns {boolean}
 */
export function isRealName(n) {
  const s = String(n || "").trim();
  if (!s) return false;
  const low = s.toLowerCase();
  if (
    low === "você" ||
    low === "voce" ||
    low === "lead social" ||
    low === "não informado" ||
    low === "nao informado" ||
    low === "desconhecido"
  ) {
    return false;
  }
  // Se for apenas dígitos/formatação telefônica, não é nome real
  return !/^\+?\d[\d\s\-()]*$/.test(s);
}

/**
 * Normaliza número de telefone (remove '+' e caracteres não numéricos).
 * @param {unknown} phone
 * @returns {string}
 */
export function normalizeLeadPhoneKey(phone) {
  return String(phone || "").trim().replace(/^\+/, "").replace(/\D/g, "");
}

/**
 * Upsert individual de lead por (client_id, telefone) sem depender de constraint única.
 *
 * @param {import("pg").Pool} pool
 * @param {string} clientId
 * @param {string} telefone  telefone normalizado
 * @param {Record<string, unknown>} fields  colunas a gravar (exceto client_id/telefone)
 * @param {Object} [options]
 * @param {boolean} [options.preserveExistingName=true]  preserva nome bom já salvo se novo for vazio/placeholder
 * @returns {Promise<"updated"|"inserted">}
 */
export async function upsertLeadByPhone(pool, clientId, telefone, fields = {}, options = {}) {
  if (!pool) return "inserted";

  const cleanPhone = normalizeLeadPhoneKey(telefone);
  if (!cleanPhone) return "inserted";

  const preserveExistingName = options.preserveExistingName !== false;

  // Sanitização de campos: 'origem' não é coluna de public.leads (as colunas são lead_source e lead_origin)
  const sanitizedFields = { ...fields };
  if (sanitizedFields.origem !== undefined) {
    if (!sanitizedFields.lead_source) sanitizedFields.lead_source = sanitizedFields.origem;
    if (!sanitizedFields.lead_origin) sanitizedFields.lead_origin = sanitizedFields.origem;
    delete sanitizedFields.origem;
  }
  if (sanitizedFields.assignedTo !== undefined) {
    if (!sanitizedFields.assigned_to) sanitizedFields.assigned_to = sanitizedFields.assignedTo;
    delete sanitizedFields.assignedTo;
  }

  // 1. Busca se o lead já existe por telefone ou phone
  const existingRes = await pool.query(
    `SELECT id, nome, tags, dados, stage, stage_source, lost_reason
     FROM public.leads
     WHERE client_id = $1 AND (telefone = $2 OR phone = $2 OR telefone = $3 OR phone = $3)
     LIMIT 1`,
    [clientId, cleanPhone, `+${cleanPhone}`]
  ).catch((err) => {
    console.warn("[leadUpsert] falha ao buscar lead existente:", err?.message || err);
    return { rows: [] };
  });

  const existing = existingRes.rows[0];

  if (existing) {
    // ── UPDATE ─────────────────────────────────────────────────────────────
    const updates = { ...sanitizedFields };

    // Regra de Ouro (Bloco 3): nunca sobrescrever assigned_to de lead existente via upsert de mensagem.
    // Preserva os 2.126 leads históricos sem backfill e preserva qualquer atribuição prévia.
    delete updates.assigned_to;
    delete updates.assignedTo;

    // Regra de Ouro (Bloco 1): se o lead já possui stage_source = 'manual',
    // processos automáticos nunca podem sobrescrever stage, stage_source ou lost_reason.
    if (existing.stage_source === "manual" && updates.stage_source !== "manual") {
      delete updates.stage;
      delete updates.stage_source;
      delete updates.lost_reason;
    }

    // Regra de ouro: não sobrescrever nome bom existente se o novo nome for vazio/placeholder
    if (preserveExistingName && isRealName(existing.nome)) {
      if (!isRealName(updates.nome)) {
        delete updates.nome; // Mantém o nome existente
      }
    }

    // Mesclagem de tags
    if (Array.isArray(updates.tags) && updates.tags.length > 0) {
      const prevTags = Array.isArray(existing.tags)
        ? existing.tags
        : typeof existing.tags === "string"
        ? existing.tags.split(",").map((t) => t.trim()).filter(Boolean)
        : [];
      updates.tags = Array.from(new Set([...prevTags, ...updates.tags]));
    }

    // Mesclagem de dados JSON
    if (updates.dados && typeof updates.dados === "object") {
      const prevDados = typeof existing.dados === "object" && existing.dados ? existing.dados : {};
      updates.dados = { ...prevDados, ...updates.dados };
    }

    const cols = Object.keys(updates).filter(
      (k) => updates[k] !== undefined && k !== "client_id" && k !== "id"
    );

    if (cols.length > 0) {
      const setSql = cols.map((c, i) => `"${c}" = $${i + 2}`).join(", ");
      const values = cols.map((c) => updates[c]);
      await pool.query(
        `UPDATE public.leads SET ${setSql}, updated_at = now() WHERE id = $1`,
        [existing.id, ...values]
      );
    } else {
      await pool.query(
        `UPDATE public.leads SET updated_at = now() WHERE id = $1`,
        [existing.id]
      );
    }

    return "updated";
  }

  // ── INSERT ───────────────────────────────────────────────────────────────
  const insertPayload = {
    client_id: clientId,
    telefone: cleanPhone,
    phone: cleanPhone,
    ...sanitizedFields,
  };
  if (insertPayload.stage && !insertPayload.stage_source) {
    insertPayload.stage_source = "auto";
  }

  const cols = Object.keys(insertPayload).filter((k) => insertPayload[k] !== undefined);
  const insertCols = cols.map((c) => `"${c}"`).join(", ");
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const values = cols.map((c) => insertPayload[c]);

  await pool.query(
    `INSERT INTO public.leads (${insertCols}) VALUES (${placeholders})`,
    values
  );

  return "inserted";
}

/**
 * Upsert em lote de leads por (client_id, telefone) sem depender de constraint única.
 *
 * Alta performance:
 * - Deduplica em memória por telefone dentro do próprio lote.
 * - Localiza todos os leads existentes em 1 única query `telefone = ANY(...)`.
 * - Insere novos em lote (multi-row INSERT) e atualiza existentes de forma segura.
 *
 * @param {import("pg").Pool} pool
 * @param {string} clientId
 * @param {Array<Record<string, unknown>>} leads
 * @param {Object} [options]
 * @param {boolean} [options.preserveExistingName=true]
 * @returns {Promise<{ insertedCount: number, updatedCount: number, totalCount: number }>}
 */
export async function upsertLeadsBatchByPhone(pool, clientId, leads = [], options = {}) {
  if (!pool || !Array.isArray(leads) || leads.length === 0) {
    return { insertedCount: 0, updatedCount: 0, totalCount: 0 };
  }

  const preserveExistingName = options.preserveExistingName !== false;

  // 1. Deduplicação em memória por telefone dentro do próprio arquivo/lote
  const dedupMap = new Map();

  for (const rawLead of leads) {
    const rawPhone = rawLead.telefone || rawLead.phone || rawLead.celular || rawLead.whatsapp || rawLead.numero || "";
    let cleanPhone = normalizeLeadPhoneKey(rawPhone);
    if (!cleanPhone && rawLead.generatedPhone) {
      cleanPhone = normalizeLeadPhoneKey(rawLead.generatedPhone);
    }
    if (!cleanPhone) continue;

    if (!dedupMap.has(cleanPhone)) {
      dedupMap.set(cleanPhone, {
        ...rawLead,
        telefone: cleanPhone,
        phone: cleanPhone,
        tags: Array.isArray(rawLead.tags) ? [...rawLead.tags] : [],
        dados: typeof rawLead.dados === "object" && rawLead.dados ? { ...rawLead.dados } : {},
      });
    } else {
      // Mescla com registro anterior do mesmo lote
      const prev = dedupMap.get(cleanPhone);
      const combinedTags = Array.from(new Set([
        ...(Array.isArray(prev.tags) ? prev.tags : []),
        ...(Array.isArray(rawLead.tags) ? rawLead.tags : []),
      ]));
      const combinedDados = {
        ...(typeof prev.dados === "object" && prev.dados ? prev.dados : {}),
        ...(typeof rawLead.dados === "object" && rawLead.dados ? rawLead.dados : {}),
      };

      // Preserva o melhor nome disponível
      let chosenName = rawLead.nome || prev.nome;
      if (isRealName(prev.nome) && !isRealName(rawLead.nome)) {
        chosenName = prev.nome;
      } else if (isRealName(rawLead.nome)) {
        chosenName = rawLead.nome;
      }

      dedupMap.set(cleanPhone, {
        ...prev,
        ...rawLead,
        nome: chosenName,
        telefone: cleanPhone,
        phone: cleanPhone,
        tags: combinedTags,
        dados: combinedDados,
      });
    }
  }

  const uniqueLeads = Array.from(dedupMap.values());
  if (uniqueLeads.length === 0) {
    return { insertedCount: 0, updatedCount: 0, totalCount: 0 };
  }

  let totalInserted = 0;
  let totalUpdated = 0;

  // 2. Processa em blocos de até 500 para não estourar limite de parâmetros SQL
  const CHUNK_SIZE = 500;

  for (let i = 0; i < uniqueLeads.length; i += CHUNK_SIZE) {
    const chunk = uniqueLeads.slice(i, i + CHUNK_SIZE);
    const chunkPhones = chunk.map((l) => l.telefone);

    // Busca existentes no banco de uma vez só
    const existingQuery = await pool.query(
      `SELECT id, telefone, phone, nome, tags, dados, stage, stage_source, lost_reason
       FROM public.leads
       WHERE client_id = $1 AND (telefone = ANY($2::text[]) OR phone = ANY($2::text[]))`,
      [clientId, chunkPhones]
    );

    const existingByPhone = new Map();
    for (const row of existingQuery.rows) {
      if (row.telefone) existingByPhone.set(normalizeLeadPhoneKey(row.telefone), row);
      if (row.phone) existingByPhone.set(normalizeLeadPhoneKey(row.phone), row);
    }

    const toInsert = [];
    const toUpdate = [];

    for (const lead of chunk) {
      const existing = existingByPhone.get(lead.telefone);
      if (existing) {
        toUpdate.push({ lead, existing });
      } else {
        toInsert.push(lead);
      }
    }

    // ── INSERT EM LOTE (Novos) ──────────────────────────────────────────────
    if (toInsert.length > 0) {
      // Lista padrão de colunas suportadas
      const standardCols = ["client_id", "telefone", "phone", "nome", "stage", "stage_source", "lost_reason", "temperature", "tags", "dados", "created_at", "updated_at"];
      const valueRows = [];
      const queryParams = [];

      for (const item of toInsert) {
        const offset = queryParams.length;
        const rowPlaceholders = [];

        queryParams.push(clientId);
        rowPlaceholders.push(`$${offset + 1}`);

        queryParams.push(item.telefone);
        rowPlaceholders.push(`$${offset + 2}`);

        queryParams.push(item.phone || item.telefone);
        rowPlaceholders.push(`$${offset + 3}`);

        queryParams.push(item.nome || item.telefone);
        rowPlaceholders.push(`$${offset + 4}`);

        queryParams.push(item.stage || "cold");
        rowPlaceholders.push(`$${offset + 5}`);

        queryParams.push(item.stage_source || (item.stage ? "auto" : null));
        rowPlaceholders.push(`$${offset + 6}`);

        queryParams.push(item.lost_reason || null);
        rowPlaceholders.push(`$${offset + 7}`);

        queryParams.push(item.temperature || "warm");
        rowPlaceholders.push(`$${offset + 8}`);

        queryParams.push(Array.isArray(item.tags) ? item.tags : []);
        rowPlaceholders.push(`$${offset + 9}`);

        queryParams.push(typeof item.dados === "object" && item.dados ? JSON.stringify(item.dados) : "{}");
        rowPlaceholders.push(`$${offset + 10}`);

        queryParams.push(item.created_at || new Date().toISOString());
        rowPlaceholders.push(`$${offset + 11}`);

        queryParams.push(new Date().toISOString());
        rowPlaceholders.push(`$${offset + 12}`);

        valueRows.push(`(${rowPlaceholders.join(", ")})`);
      }

      await pool.query(
        `INSERT INTO public.leads (${standardCols.map((c) => `"${c}"`).join(", ")})
         VALUES ${valueRows.join(", ")}`,
        queryParams
      );

      totalInserted += toInsert.length;
    }

    // ── UPDATE (Existentes) ─────────────────────────────────────────────────
    for (const { lead, existing } of toUpdate) {
      let finalName = lead.nome;
      if (preserveExistingName && isRealName(existing.nome) && !isRealName(lead.nome)) {
        finalName = existing.nome;
      }

      const mergedTags = Array.from(new Set([
        ...(Array.isArray(existing.tags)
          ? existing.tags
          : typeof existing.tags === "string"
          ? existing.tags.split(",").map((t) => t.trim()).filter(Boolean)
          : []),
        ...(Array.isArray(lead.tags) ? lead.tags : []),
      ]));

      const mergedDados = {
        ...(typeof existing.dados === "object" && existing.dados ? existing.dados : {}),
        ...(typeof lead.dados === "object" && lead.dados ? lead.dados : {}),
      };

      const isManualProtected = existing.stage_source === "manual" && lead.stage_source !== "manual";
      const finalStage = isManualProtected ? existing.stage : (lead.stage !== undefined ? (lead.stage || null) : existing.stage);
      const finalStageSource = isManualProtected ? existing.stage_source : (lead.stage_source !== undefined ? (lead.stage_source || null) : existing.stage_source);
      const finalLostReason = isManualProtected ? existing.lost_reason : (lead.lost_reason !== undefined ? (lead.lost_reason || null) : existing.lost_reason);

      await pool.query(
        `UPDATE public.leads
         SET nome = $1,
             stage = COALESCE($2, stage),
             stage_source = COALESCE($3, stage_source),
             lost_reason = $4,
             temperature = COALESCE($5, temperature),
             tags = $6,
             dados = $7,
             updated_at = now()
         WHERE id = $8`,
        [
          finalName || existing.nome || lead.telefone,
          finalStage,
          finalStageSource,
          finalLostReason,
          lead.temperature || null,
          mergedTags,
          JSON.stringify(mergedDados),
          existing.id,
        ]
      );

      totalUpdated += 1;
    }
  }

  return {
    insertedCount: totalInserted,
    updatedCount: totalUpdated,
    totalCount: totalInserted + totalUpdated,
  };
}
