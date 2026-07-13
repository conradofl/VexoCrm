ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS package_vexo_id UUID REFERENCES public.gd_packages(id);
