ALTER TABLE lead_client_n8n_settings
  ADD COLUMN IF NOT EXISTS sdr_whatsapp_number VARCHAR(20) DEFAULT NULL;
