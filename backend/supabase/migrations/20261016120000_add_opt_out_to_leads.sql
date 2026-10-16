-- Migration: Add opt_out and metadata columns to public.leads
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS opt_out BOOLEAN DEFAULT FALSE;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_leads_opt_out ON public.leads (client_id, opt_out) WHERE opt_out IS TRUE;
