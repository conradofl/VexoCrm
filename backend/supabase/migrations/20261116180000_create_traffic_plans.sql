-- Gestor de Tráfego, Fase 2 (conselheiro): verba atual lida da plataforma,
-- plano do dia e aprovação dupla (gestor da GD e cliente).
--
-- NADA aqui é aplicado em plataforma. Item aprovado pelos dois vira linha da
-- lista "aplicar à mão": alguém aplica no gerenciador de anúncios e marca
-- feito (applied_by / applied_at).
--
-- Aditivo e idempotente: três tabelas novas, nenhuma coluna em tabela
-- existente. Código antigo roda igual com este schema (não lê nada disto).
-- Código novo com schema antigo: a coleta de métricas segue (a leitura de
-- verba falha, registra aviso e não grava nada); as rotas de plano devolvem
-- erro 500 com mensagem genérica.

-- Verba atual de cada campanha (ou conjunto, quando a verba mora no conjunto),
-- como a plataforma devolveu na última coleta que deu certo. Valores em
-- unidade da moeda (reais), já convertidos de centavos/micros.
CREATE TABLE IF NOT EXISTS public.traffic_budgets (
  id                   BIGSERIAL     PRIMARY KEY,
  client_id            TEXT          NOT NULL,
  platform             TEXT          NOT NULL CHECK (platform IN ('meta', 'google')),
  external_account_id  TEXT          NOT NULL,
  level                TEXT          NOT NULL CHECK (level IN ('campaign', 'adset')),
  entity_id            TEXT          NOT NULL,
  campaign_id          TEXT          NOT NULL,
  name                 TEXT          NULL,
  daily_budget         NUMERIC(14,2) NULL CHECK (daily_budget IS NULL OR daily_budget >= 0),
  lifetime_budget      NUMERIC(14,2) NULL CHECK (lifetime_budget IS NULL OR lifetime_budget >= 0),
  -- Google: verba compartilhada entre campanhas. Mexer nela mexe nas outras.
  shared               BOOLEAN       NOT NULL DEFAULT false,
  status               TEXT          NULL,
  collected_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT traffic_budgets_unique_entity UNIQUE (client_id, platform, level, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_traffic_budgets_campaign
  ON public.traffic_budgets (client_id, platform, campaign_id);

-- Um plano por empresa por dia (fuso de São Paulo).
CREATE TABLE IF NOT EXISTS public.traffic_plans (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          TEXT         NOT NULL,
  plan_date          DATE         NOT NULL,
  window_days        INTEGER      NOT NULL CHECK (window_days > 0),
  window_since       DATE         NOT NULL,
  window_until       DATE         NOT NULL,
  primary_kpi        TEXT         NOT NULL,
  -- Coleta mais recente usada. O plano seguinte só nasce com coleta mais nova.
  data_collected_at  TIMESTAMPTZ  NOT NULL,
  -- 'agendador' ou o uid de quem pediu.
  generated_by       TEXT         NOT NULL,
  generated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ  NOT NULL,
  -- Travas e tetos usados, e o que ficou de fora e por quê.
  summary            JSONB        NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT traffic_plans_unique_day UNIQUE (client_id, plan_date),
  CONSTRAINT traffic_plans_expiry_after_generation CHECK (expires_at > generated_at)
);

CREATE TABLE IF NOT EXISTS public.traffic_plan_items (
  id                       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id                  UUID          NOT NULL REFERENCES public.traffic_plans(id) ON DELETE CASCADE,
  client_id                TEXT          NOT NULL,
  platform                 TEXT          NOT NULL CHECK (platform IN ('meta', 'google')),
  external_account_id      TEXT          NOT NULL,
  level                    TEXT          NOT NULL CHECK (level IN ('campaign', 'adset', 'ad')),
  entity_id                TEXT          NOT NULL,
  entity_name              TEXT          NULL,
  campaign_id              TEXT          NULL,
  campaign_name            TEXT          NULL,
  action                   TEXT          NOT NULL CHECK (action IN ('pausar', 'reduzir_verba', 'aumentar_verba', 'manter')),
  -- Verba diária em reais. Nulo em pausar e manter.
  current_value            NUMERIC(14,2) NULL,
  proposed_value           NUMERIC(14,2) NULL,
  kpi_key                  TEXT          NULL,
  kpi_value                NUMERIC(14,4) NULL,
  kpi_target               NUMERIC(14,4) NULL,
  decision                 TEXT          NULL,
  -- Frase com os números. Item sem motivo não existe.
  reason                   TEXT          NOT NULL CHECK (char_length(btrim(reason)) > 0),
  numbers                  JSONB         NOT NULL DEFAULT '{}'::jsonb,
  window_since             DATE          NOT NULL,
  window_until             DATE          NOT NULL,
  status                   TEXT          NOT NULL DEFAULT 'proposto'
                           CHECK (status IN ('proposto', 'aprovado_gd', 'aprovado_cliente', 'aprovado', 'recusado', 'expirado')),
  expires_at               TIMESTAMPTZ   NOT NULL,
  gd_approved_by_uid       TEXT          NULL,
  gd_approved_by_email     TEXT          NULL,
  gd_approved_at           TIMESTAMPTZ   NULL,
  client_approved_by_uid   TEXT          NULL,
  client_approved_by_email TEXT          NULL,
  client_approved_at       TIMESTAMPTZ   NULL,
  rejected_by_uid          TEXT          NULL,
  rejected_by_email        TEXT          NULL,
  rejected_role            TEXT          NULL CHECK (rejected_role IS NULL OR rejected_role IN ('gestor_gd', 'cliente')),
  rejected_at              TIMESTAMPTZ   NULL,
  rejection_reason         TEXT          NULL,
  applied_by_uid           TEXT          NULL,
  applied_by_email         TEXT          NULL,
  applied_at               TIMESTAMPTZ   NULL,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
  -- A mesma pessoa não vale pelas duas aprovações (o servidor já recusa; o
  -- banco é a segunda trava).
  CONSTRAINT traffic_plan_items_two_people CHECK (
    gd_approved_by_uid IS NULL OR client_approved_by_uid IS NULL OR gd_approved_by_uid <> client_approved_by_uid
  ),
  CONSTRAINT traffic_plan_items_approved_needs_both CHECK (
    status <> 'aprovado' OR (gd_approved_at IS NOT NULL AND client_approved_at IS NOT NULL)
  ),
  CONSTRAINT traffic_plan_items_rejected_needs_reason CHECK (
    status <> 'recusado' OR (rejected_at IS NOT NULL AND char_length(btrim(coalesce(rejection_reason, ''))) > 0)
  ),
  CONSTRAINT traffic_plan_items_applied_only_approved CHECK (
    applied_at IS NULL OR (status = 'aprovado' AND action <> 'manter')
  )
);

CREATE INDEX IF NOT EXISTS idx_traffic_plan_items_plan ON public.traffic_plan_items (plan_id);
CREATE INDEX IF NOT EXISTS idx_traffic_plan_items_client_campaign
  ON public.traffic_plan_items (client_id, platform, campaign_id, applied_at DESC);
