-- DDL que o código rodava em runtime e ainda não tinha migration (untangle, lote 4, 26/11/2026). Em produção já existe
-- (o código criou): no-op. Só cria; não altera nem apaga dado.

-- Disparos da Página de Captação (services/leadCapture.js)
CREATE TABLE IF NOT EXISTS public.lead_capture_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  instance_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_capture_dispatches_client_time
  ON public.lead_capture_dispatches (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_capture_dispatches_phone_time
  ON public.lead_capture_dispatches (client_id, phone, created_at DESC);

-- Notificações do CRM (tabela em 20260221031218; o índice era criado no boot por domains/notifications/routes.js)
CREATE INDEX IF NOT EXISTS idx_notifications_client_read_created
  ON public.notifications (client_id, read, created_at DESC);

-- Vocabulário do funil por empresa (services/funnelService.js rodava o ALTER a cada gravação)
ALTER TABLE public.leads_clients ADD COLUMN IF NOT EXISTS funnel_config JSONB DEFAULT '{}'::jsonb;
