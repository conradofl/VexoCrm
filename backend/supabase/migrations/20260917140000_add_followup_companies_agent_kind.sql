-- "Um agente por chip, com função declarada" — Commit 3.
--
-- agent_kind diz PRA QUE SERVE o chip: atendimento (responde quem procurou a
-- empresa) ou campanha (chip de disparo, não faz atendimento espontâneo).
-- Não confundir com inbound_role, que já existe — aquele diz o que o agente
-- FAZ dentro do atendimento (atender ou qualificar); agent_kind diz SE ele
-- atende ou só dispara.
--
-- Default 'atendimento' preserva o comportamento de toda linha existente:
-- nenhum agente muda de comportamento neste deploy. Mesmo padrão já usado em
-- inbound_role (20260805040000).

ALTER TABLE public.followup_companies
  ADD COLUMN IF NOT EXISTS agent_kind TEXT NOT NULL DEFAULT 'atendimento';

ALTER TABLE public.followup_companies
  DROP CONSTRAINT IF EXISTS followup_companies_agent_kind_check;

ALTER TABLE public.followup_companies
  ADD CONSTRAINT followup_companies_agent_kind_check
  CHECK (agent_kind IN ('atendimento', 'campanha'));
