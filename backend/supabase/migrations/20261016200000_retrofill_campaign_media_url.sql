-- ==============================================================================
-- Migration: Retro-fill de Imagens de Campanha em Mensagens Antigas
-- Garante colunas media_url / content_type e preenche mensagens de campanha
-- ==============================================================================

-- 1. Garante as colunas no PostgreSQL
ALTER TABLE public.lead_messages ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE public.lead_messages ADD COLUMN IF NOT EXISTS content_type TEXT;

-- 2. Retro-fill: preenche media_url e content_type nas mensagens da campanha que continham o link ou imagem
UPDATE public.lead_messages lm
SET 
  media_url = (
    SELECT COALESCE(step->'image'->>'dataUrl', step->'image'->>'url', step->>'mediaUrl', step->>'media_url')
    FROM public.campaigns c,
         jsonb_array_elements(c.analytics_meta->'sequence') AS step
    WHERE c.id = lm.campaign_id
      AND (step->>'type' = 'image' OR step->'image'->>'dataUrl' IS NOT NULL OR step->'image'->>'url' IS NOT NULL OR step->>'mediaUrl' IS NOT NULL)
      AND COALESCE(step->'image'->>'dataUrl', step->'image'->>'url', step->>'mediaUrl', step->>'media_url') IS NOT NULL
    LIMIT 1
  ),
  content_type = 'image',
  meta = COALESCE(lm.meta, '{}'::jsonb) || jsonb_build_object(
    'mediaUrl', (
      SELECT COALESCE(step->'image'->>'dataUrl', step->'image'->>'url', step->>'mediaUrl', step->>'media_url')
      FROM public.campaigns c,
           jsonb_array_elements(c.analytics_meta->'sequence') AS step
      WHERE c.id = lm.campaign_id
        AND (step->>'type' = 'image' OR step->'image'->>'dataUrl' IS NOT NULL OR step->'image'->>'url' IS NOT NULL OR step->>'mediaUrl' IS NOT NULL)
        AND COALESCE(step->'image'->>'dataUrl', step->'image'->>'url', step->>'mediaUrl', step->>'media_url') IS NOT NULL
      LIMIT 1
    ),
    'contentType', 'image'
  )
WHERE lm.campaign_id IS NOT NULL
  AND lm.direction = 'outbound'
  AND lm.media_url IS NULL
  AND (
    lm.message_text LIKE '%Link de Acesso%' 
    OR lm.message_text LIKE '%mesa-de-negocios%'
    OR lm.message_text LIKE '%[Imagem%'
    OR lm.phone LIKE '%991008869%'
    OR lm.phone LIKE '%91008869%'
  )
  AND EXISTS (
    SELECT 1
    FROM public.campaigns c,
         jsonb_array_elements(c.analytics_meta->'sequence') AS step
    WHERE c.id = lm.campaign_id
      AND (step->>'type' = 'image' OR step->'image'->>'dataUrl' IS NOT NULL OR step->'image'->>'url' IS NOT NULL OR step->>'mediaUrl' IS NOT NULL)
      AND COALESCE(step->'image'->>'dataUrl', step->'image'->>'url', step->>'mediaUrl', step->>'media_url') IS NOT NULL
  );
