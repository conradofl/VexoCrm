CREATE TABLE IF NOT EXISTS public.fup_journeys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.fup_companies(id) ON DELETE CASCADE,
    trigger_event VARCHAR(50) NOT NULL,
    is_active BOOLEAN DEFAULT false,
    channel VARCHAR(20) DEFAULT 'whatsapp',
    delay_value INTEGER DEFAULT 0,
    delay_unit VARCHAR(20) DEFAULT 'minutes',
    ai_prompt TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(company_id, trigger_event)
);

CREATE OR REPLACE FUNCTION set_fup_journeys_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_fup_journeys_updated_at ON public.fup_journeys;
CREATE TRIGGER trigger_set_fup_journeys_updated_at
BEFORE UPDATE ON public.fup_journeys
FOR EACH ROW
EXECUTE FUNCTION set_fup_journeys_updated_at();
