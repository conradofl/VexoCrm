-- Importação de planilha em lotes: estado e progresso da importação.
-- status: 'incomplete' (aberta, faltam linhas) | 'completed'. As importações que já existem são 'completed' (DEFAULT),
-- então nada do histórico muda. expected_rows/received_offset dão o progresso e o ponto de retomada; import_params guarda o
-- DDD padrão e o mapeamento automático (decididos na abertura); import_stats acumula os totais da tela; fingerprint confere
-- que a retomada usa o MESMO arquivo. Idempotente e espelhado em runtime (ensureLeadImportBatchColumns) — o código também
-- funciona com o schema antigo nos LEITORES (DIRETRIZES-IA.md §12).
ALTER TABLE public.lead_imports
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS expected_rows INTEGER,
  ADD COLUMN IF NOT EXISTS received_offset INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS import_params JSONB,
  ADD COLUMN IF NOT EXISTS import_stats JSONB,
  ADD COLUMN IF NOT EXISTS fingerprint TEXT;
