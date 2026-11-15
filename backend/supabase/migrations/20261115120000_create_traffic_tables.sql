-- Gestor de Tráfego, Fase 1 (somente leitura): contas de anúncio por empresa,
-- perfil de metas e regras, e métricas diárias por anúncio.
--
-- Tudo aqui é aditivo e idempotente: três tabelas novas, nenhuma coluna em
-- tabela existente. Código antigo roda igual com este schema (não lê nada
-- disto); código novo com schema antigo só falha no coletor de tráfego, que
-- nasce desligado (TRAFFIC_COLLECTOR_ENABLED) e registra o erro sem derrubar
-- o processo.
--
-- client_id é TEXT (o identificador do tenant, como em audio_library), repetido
-- nas três tabelas para toda consulta filtrar por empresa sem depender de JOIN.
--
-- Token de plataforma NÃO mora aqui: fica em variável de ambiente do bk-vexo.

CREATE TABLE IF NOT EXISTS public.traffic_accounts (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             TEXT         NOT NULL,
  platform              TEXT         NOT NULL CHECK (platform IN ('meta', 'google')),
  -- Meta: número da conta de anúncios, sem o prefixo "act_". Google: customer id.
  external_account_id   TEXT         NOT NULL CHECK (char_length(btrim(external_account_id)) > 0),
  display_name          TEXT         NULL,
  currency              TEXT         NULL,
  timezone              TEXT         NULL,
  -- 'active' entra na coleta; 'paused' é a chave por conta para desligar.
  status                TEXT         NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  -- last_sync_at só avança em coleta que deu certo. Falha grava last_sync_error
  -- e last_sync_attempt_at e deixa last_sync_at e as métricas como estavam.
  last_sync_at          TIMESTAMPTZ  NULL,
  last_sync_attempt_at  TIMESTAMPTZ  NULL,
  last_sync_error       TEXT         NULL,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT traffic_accounts_unique_account UNIQUE (client_id, platform, external_account_id)
);

CREATE TABLE IF NOT EXISTS public.traffic_profiles (
  client_id           TEXT          PRIMARY KEY,
  objectives          JSONB         NOT NULL DEFAULT '[]'::jsonb,
  -- Lista de { key, target, better: 'lower'|'higher', scale_at, kill_at, min_spend }.
  kpis                JSONB         NOT NULL DEFAULT '[]'::jsonb,
  primary_kpi         TEXT          NULL,
  windows             JSONB         NOT NULL DEFAULT '[4, 7, 14, 30]'::jsonb,
  min_spend_factor    NUMERIC(6,2)  NOT NULL DEFAULT 1.2 CHECK (min_spend_factor > 0),
  daily_budget_cap    NUMERIC(14,2) NULL CHECK (daily_budget_cap IS NULL OR daily_budget_cap >= 0),
  monthly_budget_cap  NUMERIC(14,2) NULL CHECK (monthly_budget_cap IS NULL OR monthly_budget_cap >= 0),
  max_increase_pct    NUMERIC(6,2)  NOT NULL DEFAULT 50 CHECK (max_increase_pct >= 0),
  -- O banco conhece os três níveis para a Fase 2 não precisar de migration.
  -- Na Fase 1 quem recusa tudo que não for 'relatorio' é o servidor.
  autonomy_level      TEXT          NOT NULL DEFAULT 'relatorio'
                      CHECK (autonomy_level IN ('relatorio', 'sugere', 'aplica_com_limites')),
  approvers           JSONB         NOT NULL DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.traffic_metrics_daily (
  id                   BIGSERIAL     PRIMARY KEY,
  client_id            TEXT          NOT NULL,
  platform             TEXT          NOT NULL CHECK (platform IN ('meta', 'google')),
  external_account_id  TEXT          NOT NULL,
  campaign_id          TEXT          NULL,
  campaign_name        TEXT          NULL,
  adset_id             TEXT          NULL,
  adset_name           TEXT          NULL,
  ad_id                TEXT          NOT NULL,
  ad_name              TEXT          NULL,
  objective            TEXT          NULL,
  effective_status     TEXT          NULL,
  date                 DATE          NOT NULL,
  spend                NUMERIC(14,2) NOT NULL DEFAULT 0,
  impressions          BIGINT        NOT NULL DEFAULT 0,
  clicks               BIGINT        NOT NULL DEFAULT 0,
  leads                INTEGER       NOT NULL DEFAULT 0,
  messages_started     INTEGER       NOT NULL DEFAULT 0,
  purchases            INTEGER       NOT NULL DEFAULT 0,
  purchase_value       NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Linha como a plataforma devolveu: permite recalcular uma coluna derivada
  -- sem coletar de novo.
  raw                  JSONB         NOT NULL DEFAULT '{}'::jsonb,
  collected_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT traffic_metrics_daily_unique_ad_day UNIQUE (client_id, platform, ad_id, date)
);

CREATE INDEX IF NOT EXISTS idx_traffic_metrics_daily_client_date
  ON public.traffic_metrics_daily (client_id, platform, date DESC);

CREATE INDEX IF NOT EXISTS idx_traffic_metrics_daily_account_date
  ON public.traffic_metrics_daily (client_id, platform, external_account_id, date DESC);
