-- Migration: 20260911200000_add_lead_messages_media_path.sql
-- Adiciona a coluna media_path à public.lead_messages para guardar a chave do objeto no Cloudflare R2

ALTER TABLE public.lead_messages
  ADD COLUMN IF NOT EXISTS media_path TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_messages_client_media_path
  ON public.lead_messages (client_id, media_path)
  WHERE media_path IS NOT NULL;

COMMENT ON COLUMN public.lead_messages.media_path IS 'Caminho/chave relativa do arquivo no Cloudflare R2 (ex: media/tenant/year/month/waId.ext)';
