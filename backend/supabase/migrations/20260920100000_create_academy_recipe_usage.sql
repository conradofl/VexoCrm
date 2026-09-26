-- Vexo Academy — medição de uso das receitas. Sem isso não há como saber
-- qual receita serve: quem só abriu, quem copiou o conteúdo, quem instalou.
CREATE TABLE IF NOT EXISTS public.academy_recipe_usage (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  TEXT        NOT NULL,
  recipe_id  TEXT        NOT NULL,
  action     TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.academy_recipe_usage
  DROP CONSTRAINT IF EXISTS academy_recipe_usage_action_check;
ALTER TABLE public.academy_recipe_usage
  ADD CONSTRAINT academy_recipe_usage_action_check
  CHECK (action IN ('opened', 'copied', 'installed'));

CREATE INDEX IF NOT EXISTS academy_recipe_usage_client_recipe_idx
  ON public.academy_recipe_usage (client_id, recipe_id);
