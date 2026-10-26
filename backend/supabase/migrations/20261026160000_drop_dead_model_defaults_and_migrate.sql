-- Migration: Drop defaults on dead models in lead_client_n8n_settings and followup_companies,
-- reaplica a migração de modelos mortos para openai/gpt-oss-120b e verifica assertividade dentro da migration.

-- 1. Remover defaults que recriam modelos mortos
ALTER TABLE public.lead_client_n8n_settings ALTER COLUMN chatbot_llm_model DROP DEFAULT;
ALTER TABLE public.followup_companies ALTER COLUMN inbound_model DROP DEFAULT;

-- 2. Reaplicar UPDATE da migration 20260825180000 para linhas nascidas depois
UPDATE public.followup_companies
  SET inbound_model = 'openai/gpt-oss-120b'
  WHERE inbound_model IN (
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'llama3-70b-8192',
    'llama3-8b-8192',
    'mixtral-8x7b-32768',
    'gemma2-9b-it',
    'gemma-7b-it',
    'deepseek-r1-distill-llama-70b',
    'qwen-2.5-32b'
  );

UPDATE public.lead_client_n8n_settings
  SET chatbot_llm_model = 'openai/gpt-oss-120b'
  WHERE chatbot_llm_model IN (
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'llama3-70b-8192',
    'llama3-8b-8192',
    'mixtral-8x7b-32768',
    'gemma2-9b-it',
    'gemma-7b-it',
    'deepseek-r1-distill-llama-70b',
    'qwen-2.5-32b'
  );

-- 3. Verificação dentro da própria migration:
-- Conferindo column_default IS NULL nas duas colunas e contagem zero de linhas com modelo da lista morta.
DO $$
DECLARE
  default_n8n text;
  default_followup text;
  count_n8n_dead integer;
  count_followup_dead integer;
BEGIN
  -- Verificar column_default de lead_client_n8n_settings.chatbot_llm_model
  SELECT column_default INTO default_n8n
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'lead_client_n8n_settings'
    AND column_name = 'chatbot_llm_model';

  IF default_n8n IS NOT NULL THEN
    RAISE EXCEPTION 'lead_client_n8n_settings.chatbot_llm_model ainda possui default: %', default_n8n;
  END IF;

  -- Verificar column_default de followup_companies.inbound_model
  SELECT column_default INTO default_followup
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'followup_companies'
    AND column_name = 'inbound_model';

  IF default_followup IS NOT NULL THEN
    RAISE EXCEPTION 'followup_companies.inbound_model ainda possui default: %', default_followup;
  END IF;

  -- Conferir contagem zero de modelos mortos em lead_client_n8n_settings
  SELECT count(*) INTO count_n8n_dead
  FROM public.lead_client_n8n_settings
  WHERE chatbot_llm_model IN (
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'llama3-70b-8192',
    'llama3-8b-8192',
    'mixtral-8x7b-32768',
    'gemma2-9b-it',
    'gemma-7b-it',
    'deepseek-r1-distill-llama-70b',
    'qwen-2.5-32b'
  );

  IF count_n8n_dead > 0 THEN
    RAISE EXCEPTION 'lead_client_n8n_settings ainda possui % linhas com modelo morto', count_n8n_dead;
  END IF;

  -- Conferir contagem zero de modelos mortos em followup_companies
  SELECT count(*) INTO count_followup_dead
  FROM public.followup_companies
  WHERE inbound_model IN (
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'llama3-70b-8192',
    'llama3-8b-8192',
    'mixtral-8x7b-32768',
    'gemma2-9b-it',
    'gemma-7b-it',
    'deepseek-r1-distill-llama-70b',
    'qwen-2.5-32b'
  );

  IF count_followup_dead > 0 THEN
    RAISE EXCEPTION 'followup_companies ainda possui % linhas com modelo morto', count_followup_dead;
  END IF;
END $$;
