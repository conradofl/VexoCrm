-- Add vexo_selecionados column to public.gd_presentations
ALTER TABLE public.gd_presentations
ADD COLUMN IF NOT EXISTS vexo_selecionados JSONB DEFAULT '[]'::jsonb;
