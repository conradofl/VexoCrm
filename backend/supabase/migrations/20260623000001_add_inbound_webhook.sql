-- Add inbound_webhook_url to followup_companies

ALTER TABLE followup_companies
ADD COLUMN IF NOT EXISTS inbound_webhook_url TEXT;
