-- Atualiza o valor default de chatbot_inbound_scope para 'all' e atualiza registros existentes para 'all'
ALTER TABLE public.lead_client_n8n_settings
  ALTER COLUMN chatbot_inbound_scope SET DEFAULT 'all';

UPDATE public.lead_client_n8n_settings
  SET chatbot_inbound_scope = 'all'
  WHERE chatbot_inbound_scope IS NULL OR chatbot_inbound_scope != 'all';
