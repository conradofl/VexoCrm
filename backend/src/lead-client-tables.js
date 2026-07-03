export function normalizeTenantKey(value) {
  const tenantKey = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 50);

  if (!tenantKey || tenantKey.length < 3) return null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tenantKey)) return null;
  return tenantKey;
}

export function leadsTableName(clientId) {
  return "leads";
}

function buildLeadClientIndexName(tableName, suffix) {
  let hash = 0;
  for (const char of tableName) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return `idx_${tableName.slice(0, 34)}_${hash.toString(36)}_${suffix}`;
}

export async function checkLeadClientTableStatus(pgClientOrPool, tenantId) {
  const tableName = leadsTableName(tenantId);

  if (!pgClientOrPool) {
    return {
      tableName,
      exists: false,
      unavailable: true,
    };
  }

  const { rows } = await pgClientOrPool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position
    `,
    [tableName]
  );

  return {
    tableName,
    exists: rows.length > 0,
    columns: rows.map((row) => row.column_name),
  };
}

export async function ensureLeadClientTable(pgClientOrPool, tenantId, schemaType = "generico") {
  if (!pgClientOrPool) {
    throw new Error("POSTGRES_POOL_UNAVAILABLE");
  }

  const tableName = leadsTableName(tenantId);
  const schemaExtraColumns = {
    outlier: `
        interesse TEXT,
        objetivo TEXT,
        prazo TEXT,
        melhor_horario TEXT,
        credito TEXT,
        parcela TEXT,
        lance_entrada_fgts TEXT,`,
    infinie: `
        interesse TEXT,
        objetivo TEXT,
        prazo TEXT,
        melhor_horario TEXT,
        tipo_instalacao TEXT,
        conta_luz_faixa TEXT,`,
    generico: `
        interesse TEXT,
        objetivo TEXT,
        prazo TEXT,
        melhor_horario TEXT,`,
  };
  const extraColumns = schemaExtraColumns[schemaType] ?? schemaExtraColumns.generico;

  await pgClientOrPool.query(`
    CREATE TABLE IF NOT EXISTS public."${tableName}" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
      telefone TEXT NOT NULL,
      nome TEXT,
      tipo_cliente TEXT,
      faixa_consumo TEXT,
      cidade TEXT,
      estado TEXT,
      conta_energia TEXT,
      status TEXT,
      bot_ativo BOOLEAN DEFAULT false,
      historico TEXT,
      data_hora TIMESTAMPTZ,
      qualificacao TEXT,
      lead_temperature TEXT CHECK (lead_temperature IS NULL OR lead_temperature IN ('QUENTE', 'MORNO', 'FRIO')),
      status_conversa TEXT CHECK (status_conversa IS NULL OR status_conversa IN ('aguardando_usuario', 'em_atendimento', 'finalizado')),
      source_campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
      source_campaign_name TEXT,
      lead_source TEXT CHECK (lead_source IS NULL OR lead_source IN ('campanha', 'organico', 'trafego_pago', 'whatsapp_ads', 'indicacao', 'outro')),
      lead_score NUMERIC(8, 2),
      potential_contract_value NUMERIC(14, 2),
      first_contact_at TIMESTAMPTZ,
      qualified_at TIMESTAMPTZ,
      closed_at TIMESTAMPTZ,
      lead_origin TEXT,
      behavior_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      ultima_interacao_bot TIMESTAMPTZ,
      ultima_interacao_usuario TIMESTAMPTZ,
      mensagem TEXT,
      finalizado BOOLEAN DEFAULT false,
      spin_fase TEXT CHECK (spin_fase IS NULL OR spin_fase IN ('situacao', 'problema', 'implicacao', 'necessidade')),
      dados JSONB NOT NULL DEFAULT '{}'::jsonb,
      data_nascimento DATE,
      ultima_visita DATE,
      perfil_musical TEXT,${extraColumns}
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (client_id, telefone)
    )
  `);

  await pgClientOrPool.query(`CREATE INDEX IF NOT EXISTS "${buildLeadClientIndexName(tableName, "cid")}" ON public."${tableName}" (client_id)`);
  await pgClientOrPool.query(`CREATE INDEX IF NOT EXISTS "${buildLeadClientIndexName(tableName, "phone")}" ON public."${tableName}" (telefone)`);
  await pgClientOrPool.query(`CREATE INDEX IF NOT EXISTS "${buildLeadClientIndexName(tableName, "created")}" ON public."${tableName}" (created_at DESC)`);

  const status = await checkLeadClientTableStatus(pgClientOrPool, tenantId);
  if (!status.exists) {
    throw new Error("LEAD_CLIENT_TABLE_NOT_CREATED");
  }

  return status;
}
