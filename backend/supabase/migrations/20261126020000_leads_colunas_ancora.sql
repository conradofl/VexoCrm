-- Colunas de âncora do follow-up em public.leads (aniversário de casamento, época de férias, data de retorno).
-- Até aqui eram criadas em runtime por lead-client-tables.js (ensureLeadAnchorColumns). DDL de runtime virou migration
-- (untangle, 26/11/2026). Em produção já existem (o código criou): no-op. Só cria; não altera nem apaga dado.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS aniversario_casamento DATE;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS epoca_ferias DATE;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS data_retorno TIMESTAMPTZ;
