-- DDL que o código rodava em runtime (services/evolution.js) vira migration (untangle, 26/11/2026).
--
-- Antes: ensureLeadClientEvolutionInstancesTable, ensureSyncProgressTable e o sync de conversas criavam tabelas,
-- colunas e índices a cada boot/uso, vários com .catch(() => {}) engolindo erro. Em produção tudo isto JÁ existe
-- (foi criado por esse código): aqui é no-op. Serve para banco novo e para o código parar de rodar DDL.
--
-- Só cria (IF NOT EXISTS) e afrouxa um NOT NULL. Não altera nem apaga dado.

-- Empresas (base; já criada por 20260304000001 em quase todo banco)
CREATE TABLE IF NOT EXISTS public.leads_clients (
  id TEXT PRIMARY KEY,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chips da empresa (nenhuma migration criava a tabela base; só o código)
CREATE TABLE IF NOT EXISTS public.lead_client_evolution_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Evolution',
  dispatch_webhook_url TEXT NOT NULL,
  dispatch_webhook_token TEXT,
  inbound_bearer_token TEXT,
  owner_uid TEXT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  webhook_enabled BOOLEAN NOT NULL DEFAULT false,
  chip_state TEXT NOT NULL DEFAULT 'cold',
  connection_state TEXT NOT NULL DEFAULT 'unknown',
  daily_limit_override INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_uid TEXT,
  updated_by_email TEXT
);
ALTER TABLE public.lead_client_evolution_instances ADD COLUMN IF NOT EXISTS connection_state TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE public.lead_client_evolution_instances ADD COLUMN IF NOT EXISTS owner_uid TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_client_evolution_client
  ON public.lead_client_evolution_instances (client_id, active);
CREATE INDEX IF NOT EXISTS idx_lead_client_evolution_owner_uid
  ON public.lead_client_evolution_instances (client_id, owner_uid);

-- Um chip padrão por empresa. O código criava com .catch engolindo erro: se uma empresa já tiver dois padrões, o índice
-- nunca existiu. Aqui também não derruba a subida (migration que falha para o boot): registra e segue sem o índice.
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_client_evolution_default
    ON public.lead_client_evolution_instances (client_id)
    WHERE is_default = true;
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'idx_lead_client_evolution_default não criado: empresa com mais de um chip padrão';
END $$;

-- Auditoria de limite diário (já em 20260914110000; repetido idempotente)
CREATE TABLE IF NOT EXISTS public.evolution_instance_daily_limit_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  previous_limit INTEGER,
  new_limit INTEGER,
  changed_by_uid TEXT,
  changed_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_evolution_instance_daily_limit_audit_instance
  ON public.evolution_instance_daily_limit_audit (instance_id, created_at DESC);

-- Progresso do sync de conversas por chip
CREATE TABLE IF NOT EXISTS public.whatsapp_instance_sync_progress (
  client_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  instance_name TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  total_chats INTEGER NOT NULL DEFAULT 0,
  processed_chats INTEGER NOT NULL DEFAULT 0,
  synced_chats INTEGER NOT NULL DEFAULT 0,
  inserted_messages INTEGER NOT NULL DEFAULT 0,
  last_remote_jid TEXT,
  current_batch INTEGER NOT NULL DEFAULT 0,
  total_batches INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  blocked_by_campaign TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, instance_id)
);

-- Mapa LID -> telefone (base em 20260802140000): telefone opcional (LID sem número) e dados do perfil
ALTER TABLE public.whatsapp_lid_map ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE public.whatsapp_lid_map ADD COLUMN IF NOT EXISTS profile_pic TEXT;
ALTER TABLE public.whatsapp_lid_map ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.whatsapp_lid_map ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE public.whatsapp_lid_map ADD COLUMN IF NOT EXISTS profile_checked BOOLEAN DEFAULT false;
