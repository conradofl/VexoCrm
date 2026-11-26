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

  // A tabela é sempre public.leads (leadsTableName), criada pelas migrations (20260304000001 e seguintes). Até 26/11/2026
  // este ponto rodava CREATE TABLE/INDEX a cada chamada; saiu no untangle (DDL de runtime). Aqui só confere que existe.
  const status = await checkLeadClientTableStatus(pgClientOrPool, tenantId);
  if (!status.exists) {
    throw new Error("LEAD_CLIENT_TABLE_NOT_CREATED");
  }

  return status;
}

// Colunas na migration 20261126020000. Mantida para quem já chama; não roda DDL.
export async function ensureLeadAnchorColumns(pgClientOrPool) {
  return Boolean(pgClientOrPool);
}

// Colunas e índices nas migrations (20260730000000, 20260909171000, 20261008160000, 20260905130000...). Rodava ALTER TABLE leads
// (lock exclusivo) a cada listagem do Banco de Dados; saiu no untangle. Mantida para quem já chama.
export async function ensureLeadIntelligenceColumns(pgClientOrPool) {
  return Boolean(pgClientOrPool);
}

// Coluna na migration 20260908180000. Mantida para quem já chama; não roda DDL.
export async function ensureLeadsClientsTicketMedioColumn(pgClientOrPool) {
  return Boolean(pgClientOrPool);
}

// Tabela e column_mapping na migration 20261001120000. Mantida para quem já chama; não roda DDL.
export async function ensureLeadCustomFieldsTable(pgClientOrPool) {
  return Boolean(pgClientOrPool);
}

// Colunas nas migrations 20261008170000 e 20261011183000. Mantida para quem já chama; não roda DDL.
export async function ensureLeadReactivationSettingsColumns(pgClientOrPool) {
  return Boolean(pgClientOrPool);
}
