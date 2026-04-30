-- Stores operational campaign segmentation, message and image metadata.
-- Additive and safe for existing campaign records.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS analytics_meta JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_campaigns_analytics_meta
  ON public.campaigns USING GIN (analytics_meta);
