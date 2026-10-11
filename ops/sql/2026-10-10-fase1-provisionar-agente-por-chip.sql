-- Fase 1: Unificação das Fontes de Verdade dos Agentes IA ("Uma Fonte por Conceito")
--
-- Objetivos estritos e aditivos:
-- 1. Preenche evolution_instances (JSONB) a partir de evolution_instance (TEXT)
--    em agentes existentes onde o array estiver vazio ou não for array, preservando
--    integralmente prompts, modelos, templates e estado de consolidação.
-- 2. Cria um agente em followup_companies para todo chip ATIVO (lead_client_evolution_instances com active = true)
--    que ainda NÃO possui nenhum agente de atendimento amarrado a ele.
--
-- Regras de Segurança e Herança Fiel (Critério de Sucesso: Zero alteração de comportamento para qualquer cliente):
-- * O agente criado HERDA o estado de atendimento ativo hoje:
--   - O tenant deve estar ligado: COALESCE(s.chatbot_enabled, false) = true
--   - E o chip deve estar autorizado: lista chatbot_instances vazia OU chip listado nela (por id, nome ou slug).
--   - Se o chip não estiver na lista (ou se o chatbot_enabled for false), o agente nasce desligado (inbound_enabled = false).
-- * O agente grava o UUID do chip (lead_client_evolution_instances.id) em evolution_instances (sem derivações frágeis de URL).
-- * O agente grava o nome do chip em evolution_instance (exibição) e recebe o nome reconhecível "<Nome do Chip> (Padrão do Chip)".
-- * NENHUM modelo LLM ou template é alterado ou forçado.
-- * NENHUMA consolidação de instruções é realizada (instructions_consolidated_at = NULL nos novos, intocado nos antigos).
-- * 100% idempotente: rodar múltiplas vezes resulta em 0 inserções e 0 alterações após a primeira execução.

-- ─── PARTE 1: Preencher evolution_instances onde o JSONB estiver vazio ───────

UPDATE public.followup_companies
SET evolution_instances = jsonb_build_array(evolution_instance),
    updated_at = now()
WHERE evolution_instance IS NOT NULL
  AND btrim(evolution_instance) <> ''
  AND (
    jsonb_typeof(evolution_instances) <> 'array'
    OR jsonb_array_length(evolution_instances) = 0
  );

-- ─── PARTE 2: Provisionar agente para todo chip ativo sem nenhum agente ──────

WITH chips_ativos AS (
  SELECT
    i.id AS chip_id,
    i.client_id AS tenant_id,
    COALESCE(NULLIF(btrim(i.name), ''), 'Chip') AS chip_name,
    COALESCE(NULLIF(btrim(i.name), ''), 'Atendimento') AS chip_display_name,
    COALESCE(
      NULLIF(regexp_replace(i.dispatch_webhook_url, '^.*/([^/?#]+)[/?#]?.*$', '\1'), ''),
      ''
    ) AS chip_url_slug
  FROM public.lead_client_evolution_instances i
  WHERE i.active = true
),
chips_sem_agente AS (
  SELECT
    c.chip_id,
    c.tenant_id,
    c.chip_name,
    c.chip_display_name,
    (
      COALESCE(s.chatbot_enabled, false) = true
      AND (
        s.chatbot_instances IS NULL
        OR jsonb_typeof(s.chatbot_instances) <> 'array'
        OR jsonb_array_length(s.chatbot_instances) = 0
        OR s.chatbot_instances ? c.chip_id::text
        OR s.chatbot_instances ? c.chip_name
        OR (c.chip_url_slug <> '' AND s.chatbot_instances ? c.chip_url_slug)
      )
    ) AS inherited_inbound_enabled
  FROM chips_ativos c
  LEFT JOIN public.lead_client_n8n_settings s ON s.client_id = c.tenant_id
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.followup_companies f
    WHERE f.tenant_id = c.tenant_id
      AND f.archived_at IS NULL
      AND (
        f.evolution_instance = c.chip_name
        OR f.evolution_instance = c.chip_id::text
        OR (c.chip_url_slug <> '' AND f.evolution_instance = c.chip_url_slug)
        OR (jsonb_typeof(f.evolution_instances) = 'array' AND (
             f.evolution_instances ? c.chip_name
          OR f.evolution_instances ? c.chip_id::text
          OR (c.chip_url_slug <> '' AND f.evolution_instances ? c.chip_url_slug)
        ))
      )
  )
)
INSERT INTO public.followup_companies (
  tenant_id,
  name,
  evolution_instance,
  evolution_instances,
  agent_kind,
  inbound_enabled,
  inbound_prompt,
  inbound_spin_fields,
  instructions_consolidated_at,
  archived_at,
  created_at,
  updated_at
)
SELECT
  c.tenant_id,
  c.chip_display_name || ' (Padrão do Chip)',
  c.chip_name,
  jsonb_build_array(c.chip_id::text),
  'atendimento',
  c.inherited_inbound_enabled,
  NULL,
  '[]'::jsonb,
  NULL,
  NULL,
  now(),
  now()
FROM chips_sem_agente c;
