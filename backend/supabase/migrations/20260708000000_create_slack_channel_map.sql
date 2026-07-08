-- Migration: slack_channel_map
-- Para o módulo gd-slack-bridge
-- Tabela para mapear clientes e gerenciar o envio automático de briefing.

CREATE TABLE IF NOT EXISTS public.slack_channel_map (
    id SERIAL PRIMARY KEY,
    client_name TEXT NOT NULL,
    whatsapp_jid TEXT UNIQUE NOT NULL,
    slack_channel_id TEXT NOT NULL,
    drive_folder_id TEXT NULL,
    instance_name TEXT DEFAULT 'gd-oficial',
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indices para otimização se necessário no futuro
CREATE INDEX IF NOT EXISTS idx_slack_channel_map_jid ON public.slack_channel_map(whatsapp_jid);
