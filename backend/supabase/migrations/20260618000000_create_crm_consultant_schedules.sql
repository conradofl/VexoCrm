-- Migration: Create crm_consultant_schedules table to manage consultant links in the database

CREATE TABLE IF NOT EXISTS public.crm_consultant_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  scheduling_link TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_consultant_schedules_client_id
  ON public.crm_consultant_schedules (client_id, active);

ALTER TABLE public.crm_consultant_schedules ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'crm_consultant_schedules' AND policyname = 'Deny all direct access to crm_consultant_schedules'
  ) THEN
    CREATE POLICY "Deny all direct access to crm_consultant_schedules"
      ON public.crm_consultant_schedules
      FOR ALL
      USING (false);
  END IF;
END $$;
