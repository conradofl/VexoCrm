-- Add valor_vp columns to gd_packages, gd_products, vexo_products and gd_proposals
ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS valor_vp NUMERIC;
ALTER TABLE public.gd_products ADD COLUMN IF NOT EXISTS valor_vp NUMERIC;
ALTER TABLE public.vexo_products ADD COLUMN IF NOT EXISTS valor_vp NUMERIC;
ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS valor_vp NUMERIC;
