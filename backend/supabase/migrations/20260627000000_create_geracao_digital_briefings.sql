CREATE TABLE IF NOT EXISTS public.geracao_digital_briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_name TEXT NOT NULL,
  whatsapp_number TEXT NOT NULL,
  theme_preset TEXT,
  briefing_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  slack_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.set_current_timestamp_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_geracao_digital_briefings_updated_at ON public.geracao_digital_briefings;
CREATE TRIGGER set_geracao_digital_briefings_updated_at
BEFORE UPDATE ON public.geracao_digital_briefings
FOR EACH ROW
EXECUTE FUNCTION public.set_current_timestamp_updated_at();
