-- Migration: Adicionar suporte a mídia em templates e jobs de follow-up
-- Data: 2026-09-14

ALTER TABLE public.followup_templates ADD COLUMN IF NOT EXISTS media_path TEXT NULL;
ALTER TABLE public.followup_templates ADD COLUMN IF NOT EXISTS media_type TEXT NULL;
ALTER TABLE public.followup_templates ADD COLUMN IF NOT EXISTS media_mime TEXT NULL;
ALTER TABLE public.followup_templates ADD COLUMN IF NOT EXISTS media_filename TEXT NULL;

ALTER TABLE public.followup_jobs ADD COLUMN IF NOT EXISTS media_path TEXT NULL;
ALTER TABLE public.followup_jobs ADD COLUMN IF NOT EXISTS media_type TEXT NULL;
ALTER TABLE public.followup_jobs ADD COLUMN IF NOT EXISTS media_mime TEXT NULL;
ALTER TABLE public.followup_jobs ADD COLUMN IF NOT EXISTS media_filename TEXT NULL;
