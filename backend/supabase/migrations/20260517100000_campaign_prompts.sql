-- Prompts nomeados de campanha por empresa
-- Permite ter múltiplos prompts de campanha e selecionar qual usar em cada campanha

CREATE TABLE IF NOT EXISTS public.campaign_prompts (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     TEXT        NOT NULL,
  name          TEXT        NOT NULL,
  content       TEXT        NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_email TEXT,
  UNIQUE (client_id, name)
);

CREATE INDEX IF NOT EXISTS campaign_prompts_client_id_idx ON public.campaign_prompts (client_id);

-- Referência do prompt selecionado em cada campanha
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS campaign_prompt_id UUID REFERENCES public.campaign_prompts(id) ON DELETE SET NULL;
