CREATE TABLE IF NOT EXISTS public.vexo_sales_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  owner_company text NOT NULL DEFAULT 'vexo',
  internal_module boolean NOT NULL DEFAULT true,
  company_name text NOT NULL,
  contact_name text,
  contact_phone text,
  contact_email text,
  source text,
  segment text,
  estimated_value numeric(12, 2) NOT NULL DEFAULT 0,
  stage text NOT NULL DEFAULT 'Novo lead' CHECK (
    stage IN (
      'Novo lead',
      'Primeiro contato',
      'Qualificação',
      'Diagnóstico',
      'Proposta enviada',
      'Negociação',
      'Fechado ganho',
      'Fechado perdido'
    )
  ),
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'pausado', 'ganho', 'perdido')),
  priority text NOT NULL DEFAULT 'media' CHECK (priority IN ('baixa', 'media', 'alta')),
  assigned_to text,
  expected_close_date date,
  notes text,
  created_by text,
  created_by_uid text
);

CREATE TABLE IF NOT EXISTS public.vexo_sales_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES public.vexo_sales_opportunities(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  interaction_at timestamptz NOT NULL DEFAULT now(),
  type text NOT NULL CHECK (type IN ('ligacao', 'whatsapp', 'reuniao', 'email', 'observacao')),
  description text NOT NULL,
  responsible_user text,
  created_by text,
  created_by_uid text
);

CREATE INDEX IF NOT EXISTS idx_vexo_sales_opportunities_stage
  ON public.vexo_sales_opportunities(stage);

CREATE INDEX IF NOT EXISTS idx_vexo_sales_opportunities_status
  ON public.vexo_sales_opportunities(status);

CREATE INDEX IF NOT EXISTS idx_vexo_sales_opportunities_priority
  ON public.vexo_sales_opportunities(priority);

CREATE INDEX IF NOT EXISTS idx_vexo_sales_opportunities_assigned_to
  ON public.vexo_sales_opportunities(assigned_to);

CREATE INDEX IF NOT EXISTS idx_vexo_sales_opportunities_updated_at
  ON public.vexo_sales_opportunities(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_vexo_sales_interactions_opportunity_id
  ON public.vexo_sales_interactions(opportunity_id, interaction_at DESC);

ALTER TABLE public.vexo_sales_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vexo_sales_interactions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'vexo_sales_opportunities'
      AND policyname = 'Deny direct access to Vexo sales opportunities'
  ) THEN
    CREATE POLICY "Deny direct access to Vexo sales opportunities"
      ON public.vexo_sales_opportunities
      FOR ALL
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'vexo_sales_interactions'
      AND policyname = 'Deny direct access to Vexo sales interactions'
  ) THEN
    CREATE POLICY "Deny direct access to Vexo sales interactions"
      ON public.vexo_sales_interactions
      FOR ALL
      USING (false)
      WITH CHECK (false);
  END IF;
END $$;
