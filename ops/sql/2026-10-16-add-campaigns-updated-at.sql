-- Migration: Adicionar updated_at em campaigns e colunas de mídia em lead_messages
ALTER TABLE public.campaigns 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.lead_messages 
ADD COLUMN IF NOT EXISTS media_url TEXT;

ALTER TABLE public.lead_messages 
ADD COLUMN IF NOT EXISTS content_type TEXT;
