-- Migration 20261002090000: Cria tabela de cache para pré-cálculo do Dashboard por tenant e período
CREATE TABLE IF NOT EXISTS public.dashboard_metrics_cache (
  client_id TEXT NOT NULL,
  period TEXT NOT NULL,
  data JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'fresh',
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  PRIMARY KEY (client_id, period)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_metrics_cache_lookup
  ON public.dashboard_metrics_cache (client_id, period);
