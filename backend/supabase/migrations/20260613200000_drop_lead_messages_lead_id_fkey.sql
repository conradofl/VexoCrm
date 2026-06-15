-- Remove a FK podre `lead_messages_lead_id_fkey`.
--
-- A FK apontava para uma tabela de leads de UM único cliente (leads_infinie, hoje morto).
-- O modelo é multi-tenant: UMA tabela de leads por cliente (leads_infinie,
-- leads_umuarama_matcon, ...), então uma FK fixa para uma tabela específica é inválida —
-- impede preencher lead_id de leads de qualquer outro tenant.
--
-- DECISÃO (Caminho 1): remover a constraint, MANTER a coluna lead_id (preenchida pela
-- captura de inbound, sem FK). Idempotente (IF EXISTS) e seguro de re-rodar.
-- NÃO edita a migration original 20260420000009 (reprodutibilidade) — esta é corretiva.

ALTER TABLE public.lead_messages DROP CONSTRAINT IF EXISTS lead_messages_lead_id_fkey;
