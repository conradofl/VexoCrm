-- Lista de telefones alvo persistida na campanha (preenchida no dispatch).
-- O backend usa em findCampaignReplyMatches, reply-webhook e listagens; sem esta coluna o Postgres devolve 42703.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS phones JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.campaigns.phones IS 'Array JSON de telefones (strings), ex.: ["5511999999999"].';
