-- Add inbound configuration fields to followup_companies table

ALTER TABLE followup_companies
ADD COLUMN IF NOT EXISTS inbound_enabled BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS inbound_model TEXT DEFAULT 'gpt-4o',
ADD COLUMN IF NOT EXISTS inbound_prompt TEXT,
ADD COLUMN IF NOT EXISTS inbound_spin_fields JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS sdr_whatsapp_number TEXT,
ADD COLUMN IF NOT EXISTS sdr_transfer_enabled BOOLEAN DEFAULT FALSE;
