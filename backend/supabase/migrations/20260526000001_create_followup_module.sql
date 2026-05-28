-- Módulo de Follow-up com BullMQ + Webhooks + Campanhas Independentes
-- Tabelas completamente novas — não modifica nada existente

CREATE TABLE IF NOT EXISTS followup_companies (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    TEXT        NOT NULL,
  evolution_instance      TEXT        NOT NULL,
  calendly_webhook_secret TEXT,
  webhook_url             TEXT,
  panel_access            BOOLEAN     DEFAULT FALSE,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS followup_campaigns (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           UUID        NOT NULL REFERENCES followup_companies(id) ON DELETE CASCADE,
  name                 TEXT        NOT NULL,
  description          TEXT,
  status               TEXT        NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  default_origin       TEXT,
  webhook_trigger_url  TEXT,
  webhook_secret       TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS followup_campaigns_company_id_idx ON followup_campaigns (company_id);
CREATE INDEX IF NOT EXISTS followup_campaigns_status_idx     ON followup_campaigns (status);

CREATE TABLE IF NOT EXISTS followup_templates (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       UUID        NOT NULL REFERENCES followup_campaigns(id) ON DELETE CASCADE,
  name              TEXT        NOT NULL,
  message           TEXT        NOT NULL,
  trigger_type      TEXT        NOT NULL
                      CHECK (trigger_type IN ('on_schedule', 'before_meeting', 'after_meeting', 'no_reply')),
  trigger_value     INTEGER     NOT NULL,
  trigger_unit      TEXT        NOT NULL CHECK (trigger_unit IN ('minutes', 'hours', 'days')),
  trigger_direction TEXT        CHECK (trigger_direction IN ('before', 'after')),
  is_active         BOOLEAN     DEFAULT TRUE,
  order_index       INTEGER     DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS followup_templates_campaign_id_idx ON followup_templates (campaign_id);

CREATE TABLE IF NOT EXISTS followup_schedules (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id        UUID        NOT NULL REFERENCES followup_campaigns(id),
  company_id         UUID        NOT NULL REFERENCES followup_companies(id),
  lead_name          TEXT        NOT NULL,
  phone              TEXT,
  meeting_datetime   TIMESTAMPTZ,
  calendly_event_uri TEXT,
  status             TEXT        NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'canceled', 'completed', 'missing_phone')),
  origin             TEXT,
  origin_source      TEXT,
  origin_medium      TEXT,
  origin_campaign    TEXT,
  origin_content     TEXT,
  origin_term        TEXT,
  origin_type        TEXT        CHECK (origin_type IN ('utm', 'default')),
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS followup_schedules_campaign_id_idx ON followup_schedules (campaign_id);
CREATE INDEX IF NOT EXISTS followup_schedules_company_id_idx  ON followup_schedules (company_id);
CREATE INDEX IF NOT EXISTS followup_schedules_phone_idx       ON followup_schedules (phone);
CREATE INDEX IF NOT EXISTS followup_schedules_status_idx      ON followup_schedules (status);
CREATE INDEX IF NOT EXISTS followup_schedules_created_at_idx  ON followup_schedules (created_at);

CREATE TABLE IF NOT EXISTS followup_jobs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id   UUID        NOT NULL REFERENCES followup_schedules(id),
  template_id   UUID        NOT NULL REFERENCES followup_templates(id),
  bull_job_id   TEXT,
  status        TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sent', 'failed', 'skipped', 'canceled')),
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at       TIMESTAMPTZ,
  error_log     TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS followup_jobs_schedule_id_idx   ON followup_jobs (schedule_id);
CREATE INDEX IF NOT EXISTS followup_jobs_status_idx        ON followup_jobs (status);
CREATE INDEX IF NOT EXISTS followup_jobs_scheduled_for_idx ON followup_jobs (scheduled_for);

CREATE TABLE IF NOT EXISTS followup_replies (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID        REFERENCES followup_companies(id),
  campaign_id UUID        REFERENCES followup_campaigns(id),
  phone       TEXT,
  payload     JSONB,
  received_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS followup_replies_phone_idx       ON followup_replies (phone);
CREATE INDEX IF NOT EXISTS followup_replies_company_id_idx  ON followup_replies (company_id);
CREATE INDEX IF NOT EXISTS followup_replies_received_at_idx ON followup_replies (received_at);
