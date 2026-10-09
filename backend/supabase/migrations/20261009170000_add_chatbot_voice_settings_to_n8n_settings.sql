-- Migration: 20261009170000_add_chatbot_voice_settings_to_n8n_settings.sql
-- Marco 4: Mensageria Multimodal Avançada & Voz da IA
-- Configurações de voz (OpenAI TTS) por tenant na tabela public.lead_client_n8n_settings

ALTER TABLE public.lead_client_n8n_settings
  ADD COLUMN IF NOT EXISTS chatbot_voice_mode TEXT DEFAULT 'disabled',
  ADD COLUMN IF NOT EXISTS chatbot_voice_id TEXT DEFAULT 'nova',
  ADD COLUMN IF NOT EXISTS chatbot_voice_speed NUMERIC(3,2) DEFAULT 1.0;
