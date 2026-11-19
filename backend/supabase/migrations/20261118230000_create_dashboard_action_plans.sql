-- Plano de ação do Dashboard gravado no servidor: um plano por empresa por semana (segunda-feira, fuso de São Paulo).
--
-- Cada item guarda o que foi combinado (ação, dono, prazo, por qual número se mede) e o NÚMERO DO DIA em que o item
-- entrou no plano (baseline), medido pelo servidor. Na semana seguinte a aba mostra "você combinou X; o número foi
-- de A para B", com A daqui e B medido de novo.
--
-- Quem grava: só usuário da equipe Vexo (a rota confere). O cliente vê e não edita.
--
-- Aditivo e idempotente: uma tabela nova, nenhuma coluna em tabela existente.
-- Código antigo com este schema: não lê nada disto.
-- Código novo com schema antigo: a aba Plano diz que o plano ainda não pode ser salvo; o resto do Dashboard segue.

CREATE TABLE IF NOT EXISTS public.dashboard_action_plans (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   TEXT         NOT NULL,
  week_start  DATE         NOT NULL,
  -- [{ key, subject, checked, owner, due, action, why, metric, baseline: { value, unit } | null, baselineAt }]
  items       JSONB        NOT NULL DEFAULT '[]'::jsonb,
  created_by  TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by  TEXT         NOT NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_action_plans_unique_week UNIQUE (client_id, week_start),
  CONSTRAINT dashboard_action_plans_items_array CHECK (jsonb_typeof(items) = 'array'),
  CONSTRAINT dashboard_action_plans_week_is_monday CHECK (EXTRACT(ISODOW FROM week_start) = 1)
);
