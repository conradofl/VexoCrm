-- Migration: 20261009210000_enhance_events_table.sql
-- Marco 5: Módulo de Eventos & Réguas Temporais

CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  location TEXT NULL,
  description TEXT NULL,
  tickets_sold INT DEFAULT 0,
  esteiras_status JSONB DEFAULT '{"esteira1":"aguardando_disparo","esteira2":"processando_prompts","esteira5":"aguardando_data"}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS tickets_sold INT DEFAULT 0;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS esteiras_status JSONB DEFAULT '{"esteira1":"aguardando_disparo","esteira2":"processando_prompts","esteira5":"aguardando_data"}'::jsonb;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_events_client_date ON public.events(client_id, date);
