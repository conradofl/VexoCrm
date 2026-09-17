-- "Um agente, um dono para cada texto" — Commit 2: o agente vira dono.
--
-- instructions_consolidated_at marca o momento em que um agente parou de
-- receber instrução de fora (template do tenant, prompt padrão do tenant) e
-- passou a valer só pelo que está gravado nele mesmo (inbound_prompt,
-- inbound_spin_fields). NULL = comportamento de hoje, intocado: o agente
-- continua herdando template e prompt padrão exatamente como sempre herdou.
-- Timestamp, não boolean — é auditoria de quando a consolidação aconteceu,
-- não só um interruptor.
--
-- Nenhuma linha existente muda de comportamento nesta migration: todas
-- nascem/permanecem NULL. Consolidar é ação explícita, por agente, feita na
-- tela — nunca em lote, nunca automática.

ALTER TABLE public.followup_companies
  ADD COLUMN IF NOT EXISTS instructions_consolidated_at TIMESTAMPTZ NULL;
