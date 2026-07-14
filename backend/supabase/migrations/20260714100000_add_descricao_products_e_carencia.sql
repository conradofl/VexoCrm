-- 1. Descrição nos módulos avulsos GD (simetria com vexo_products). Opcional.
ALTER TABLE public.gd_products ADD COLUMN IF NOT EXISTS descricao TEXT;

-- 2. Carência do primeiro vencimento da mensalidade (em dias). Opcional;
--    não altera valores — só a data do primeiro vencimento.
ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS carencia_dias INTEGER;
