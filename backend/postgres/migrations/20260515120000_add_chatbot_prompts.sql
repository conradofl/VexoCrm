-- Armazena prompts customizados por empresa e tipo
-- Fallback: se não existir linha, o chatbot usa o prompt hardcoded do código
-- Tipos:
--   padrao     — conversa de qualificação inbound (Áureo / Lara base)
--   campanha   — primeira resposta de campanha (tom mais leve, SPIN suave)
--   qualificar — prompt especializado de qualificação aprofundada
--   extrato    — prompt de extração de dados / resumo para o SDR
CREATE TABLE IF NOT EXISTS chatbot_prompts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       text        NOT NULL,
  type            text        NOT NULL CHECK (type IN ('padrao', 'campanha', 'qualificar', 'extrato')),
  content         text        NOT NULL DEFAULT '',
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by_email text,
  UNIQUE (client_id, type)
);

CREATE INDEX IF NOT EXISTS chatbot_prompts_client_id_idx ON chatbot_prompts (client_id);

-- Adiciona estado de followup ao lead_import_items para métricas de campanha
-- followup_status: pending (aguardando resposta), replied, scheduled, discarded, converted
ALTER TABLE lead_import_items
  ADD COLUMN IF NOT EXISTS followup_status       text        CHECK (followup_status IS NULL OR followup_status IN ('pending', 'replied', 'scheduled', 'discarded', 'converted')),
  ADD COLUMN IF NOT EXISTS followup_scheduled_at timestamptz;

CREATE INDEX IF NOT EXISTS lead_import_items_followup_status_idx ON lead_import_items (client_id, followup_status) WHERE followup_status IS NOT NULL;

-- Adiciona rastreamento de origem ao leads_{clientId} (aplicar via script por empresa)
-- source_campaign_name: nome da campanha que originou o lead (desnormalizado para consulta rápida)
-- lead_source: canal de origem — campanha, organico, trafego_pago, whatsapp_ads, indicacao, outro
-- Exemplo de execução para outlier:
--   ALTER TABLE leads_outlier ADD COLUMN IF NOT EXISTS source_campaign_name text;
--   ALTER TABLE leads_outlier ADD COLUMN IF NOT EXISTS lead_source text CHECK (lead_source IS NULL OR lead_source IN ('campanha', 'organico', 'trafego_pago', 'whatsapp_ads', 'indicacao', 'outro'));
-- Nota: tabelas leads_{clientId} são criadas dinamicamente, aplicar via registerAllDomainRoutes auto-migrate
