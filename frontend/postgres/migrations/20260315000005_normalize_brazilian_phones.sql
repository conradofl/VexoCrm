CREATE OR REPLACE FUNCTION public.normalize_br_phone(value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  digits TEXT;
BEGIN
  IF value IS NULL OR btrim(value) = '' THEN
    RETURN NULL;
  END IF;

  digits := regexp_replace(value, '\D', '', 'g');

  IF digits = '' THEN
    RETURN NULL;
  END IF;

  digits := regexp_replace(digits, '^0+', '');

  IF length(digits) IN (10, 11) THEN
    RETURN '55' || digits;
  END IF;

  IF length(digits) = 12 AND left(digits, 2) = '55' THEN
    RETURN '55' || right(digits, 10);
  END IF;

  IF length(digits) = 13 AND left(digits, 2) = '55' THEN
    RETURN digits;
  END IF;

  RETURN digits;
END;
$$;

UPDATE public.leads
SET telefone = public.normalize_br_phone(telefone)
WHERE telefone IS NOT NULL
  AND telefone <> public.normalize_br_phone(telefone);

UPDATE public.lead_import_items
SET telefone = public.normalize_br_phone(telefone)
WHERE telefone IS NOT NULL
  AND telefone <> public.normalize_br_phone(telefone);

UPDATE public.lead_conversations
SET telefone = public.normalize_br_phone(telefone)
WHERE telefone IS NOT NULL
  AND telefone <> public.normalize_br_phone(telefone);
