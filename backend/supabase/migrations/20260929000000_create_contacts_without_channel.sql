-- Contato extraído de export do Instagram sem telefone recuperável no texto.
-- Não é lead — nunca vai para public.leads, nunca entra em seletor de
-- campanha/cadência nem em contagem de leads. É trabalho manual: alguém
-- pede o WhatsApp pelo próprio Instagram, e só quando a pessoa responder
-- com o número é que vira lead de verdade, por outro caminho.
CREATE TABLE IF NOT EXISTS public.contacts_without_channel (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          TEXT        NOT NULL,
  nome               TEXT        NOT NULL,
  perfil             TEXT        NOT NULL,
  resumo             TEXT,
  origem             TEXT        NOT NULL DEFAULT 'Instagram Direct',
  asked_whatsapp_at  TIMESTAMPTZ,
  became_lead_at     TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Único por client_id + perfil: reimportar a mesma exportação atualiza em
-- vez de duplicar, mesmo padrão de dedup por telefone dos leads.
ALTER TABLE public.contacts_without_channel
  DROP CONSTRAINT IF EXISTS contacts_without_channel_client_perfil_key;
ALTER TABLE public.contacts_without_channel
  ADD CONSTRAINT contacts_without_channel_client_perfil_key UNIQUE (client_id, perfil);

CREATE INDEX IF NOT EXISTS contacts_without_channel_client_idx
  ON public.contacts_without_channel (client_id);
