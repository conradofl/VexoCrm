// O registro da importação (lead_imports + lead_import_items + lead_custom_fields) em Postgres REAL (pglite), para os testes de
// POST /api/leads/import-csv que usam um pool de mentira para os LEADS. Desde que o import-csv registra a importação no mesmo lugar da
// tela de Planilhas, esse SQL passa a existir; aqui ele vai para um banco de verdade e o resto continua no mock do teste.
import { createPgliteDb } from "./pgliteDb.js";

const REGISTRY_SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE lead_imports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL, source_name text NOT NULL, source_type text NOT NULL DEFAULT 'spreadsheet',
    total_rows integer NOT NULL DEFAULT 0, imported_rows integer NOT NULL DEFAULT 0, skipped_rows integer NOT NULL DEFAULT 0,
    uploaded_by_uid text, uploaded_by_email text, created_at timestamptz NOT NULL DEFAULT now(), column_mapping jsonb);
  CREATE TABLE lead_import_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), import_id uuid NOT NULL REFERENCES lead_imports(id) ON DELETE CASCADE, client_id text NOT NULL,
    row_number integer NOT NULL, telefone text, lead_id uuid, imported boolean NOT NULL DEFAULT false, skip_reason text,
    raw_data jsonb NOT NULL DEFAULT '{}'::jsonb, normalized_data jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
  CREATE INDEX idx_lead_import_items_import_id ON lead_import_items (import_id);
  CREATE TABLE lead_custom_fields (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL, key text NOT NULL, label text NOT NULL, type text NOT NULL DEFAULT 'text',
    import_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (client_id, key));
`;

const REGISTRY_SQL = /lead_imports|lead_import_items|lead_custom_fields|^\s*(BEGIN|COMMIT|ROLLBACK)\b|pg_advisory_xact_lock/i;

/** Redireciona o SQL do registro de importação do `mockPool.query` (vi.fn) para o pglite; o resto segue no mock. */
export async function attachImportRegistry(mockPool) {
  const db = await createPgliteDb(REGISTRY_SCHEMA);
  const original = mockPool.query.getMockImplementation();
  mockPool.query.mockImplementation(async (sql, params) => (REGISTRY_SQL.test(String(sql)) ? db.query(sql, params) : original(sql, params)));
  mockPool.registry = db;
  return db;
}
