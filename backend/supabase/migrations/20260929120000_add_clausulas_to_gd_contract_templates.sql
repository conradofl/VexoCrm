-- Adiciona suporte a blocos de cláusulas estruturadas nos modelos de contratos
-- e vínculo direto do contrato gerado ao modelo base utilizado (template_id).
ALTER TABLE public.gd_contract_templates 
ADD COLUMN IF NOT EXISTS clausulas JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.gd_contracts 
ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.gd_contract_templates(id);

CREATE INDEX IF NOT EXISTS idx_gd_contracts_template ON public.gd_contracts (template_id);
