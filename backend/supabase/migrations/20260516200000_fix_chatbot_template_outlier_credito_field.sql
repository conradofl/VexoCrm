-- Corrige o seed builtin do template outlier:
-- campo 'credito_faixa' → 'credito' para bater com a coluna da tabela leads_outlier
-- e com a lógica de extração do chatbot-ai-engine.js

UPDATE chatbot_templates
SET
  data_fields = (
    SELECT jsonb_agg(
      CASE
        WHEN field->>'key' = 'credito_faixa'
        THEN jsonb_set(field, '{key}', '"credito"') #- '{}'
          || jsonb_build_object('key', 'credito', 'label', 'Crédito Desejado')
        ELSE field
      END
    )
    FROM jsonb_array_elements(data_fields) AS field
  ),
  required_fields = (
    SELECT jsonb_agg(
      CASE
        WHEN val = '"credito_faixa"'
        THEN '"credito"'::jsonb
        ELSE val
      END
    )
    FROM jsonb_array_elements(required_fields) AS val
  ),
  updated_at = now()
WHERE template_key = 'outlier'
  AND client_id IS NULL
  AND is_builtin = true;
