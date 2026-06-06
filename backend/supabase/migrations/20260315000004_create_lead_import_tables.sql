CREATE TABLE public.lead_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'spreadsheet',
  total_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  skipped_rows INTEGER NOT NULL DEFAULT 0,
  uploaded_by_uid TEXT,
  uploaded_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.lead_import_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID NOT NULL REFERENCES public.lead_imports(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  telefone TEXT,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  imported BOOLEAN NOT NULL DEFAULT false,
  skip_reason TEXT,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lead_imports_client_created_at
  ON public.lead_imports (client_id, created_at DESC);

CREATE INDEX idx_lead_import_items_import_id
  ON public.lead_import_items (import_id);

CREATE INDEX idx_lead_import_items_client_id
  ON public.lead_import_items (client_id);

CREATE INDEX idx_lead_import_items_phone
  ON public.lead_import_items (telefone);

ALTER TABLE public.lead_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_import_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Deny all direct access to lead_imports"
ON public.lead_imports
FOR ALL
USING (false);

CREATE POLICY "Deny all direct access to lead_import_items"
ON public.lead_import_items
FOR ALL
USING (false);
