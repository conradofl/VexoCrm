-- agent_inbound_claims ganha o estado 'enviando' (revisão do #269, 17/11/2026).
--
-- 'enviando' é gravado ANTES do fetch do envio pela Evolution. Concessão parada nesse estado (SIGTERM no meio do envio,
-- ou exceção/tempo limite no fetch: o lead pode ter recebido) nunca é reenviada sozinha; a varredura a fecha como
-- 'descartada' com motivo 'envio_sem_confirmacao' e a conversa vai para "Esperam você".
--
-- Antes desta migration, o código grava o mesmo significado sem o estado novo: status 'processando', motivo 'enviando'
-- e lease_until num futuro distante (ninguém toma). Os dois formatos são lidos pela varredura.

ALTER TABLE public.agent_inbound_claims DROP CONSTRAINT IF EXISTS agent_inbound_claims_status_check;
ALTER TABLE public.agent_inbound_claims
  ADD CONSTRAINT agent_inbound_claims_status_check
  CHECK (status IN ('processando', 'enviando', 'respondida', 'descartada', 'falhou'));
