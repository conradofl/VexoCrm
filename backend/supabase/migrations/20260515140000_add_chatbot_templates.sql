-- Templates de configuração de chatbot
-- Cada template define quais dados o agente coleta, critérios de qualificação e finalização
-- is_builtin = true: templates padrão (outlier, infinie) — exibidos como base, clonáveis
-- client_id = NULL: template global/builtin; preenchido = template de empresa específica

CREATE TABLE IF NOT EXISTS chatbot_templates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key    text        NOT NULL,
  client_id       text,
  display_name    text        NOT NULL,
  agent_name      text        NOT NULL DEFAULT '',
  agent_role      text        NOT NULL DEFAULT '',
  data_fields     jsonb       NOT NULL DEFAULT '[]',
  required_fields jsonb       NOT NULL DEFAULT '[]',
  classification  jsonb       NOT NULL DEFAULT '{"quente":"","morno":"","frio":""}',
  is_builtin      boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by_email text,
  UNIQUE (template_key, client_id)
);

CREATE INDEX IF NOT EXISTS chatbot_templates_client_id_idx ON chatbot_templates (client_id);

-- Seeds: templates built-in Outlier e Infinie
INSERT INTO chatbot_templates (template_key, client_id, display_name, agent_name, agent_role, data_fields, required_fields, classification, is_builtin)
VALUES
(
  'outlier', NULL, 'Outlier Consórcios', 'Áureo', 'SDR da Outlier Consórcios',
  '[
    {"key":"interesse",          "label":"Interesse",        "description":"Imóvel, veículo, investimento, empresa, carta contemplada", "required":true},
    {"key":"objetivo",           "label":"Objetivo",         "description":"Morar, investir, trabalho, patrimônio",                    "required":true},
    {"key":"cidade",             "label":"Cidade",           "description":"Cidade do lead",                                           "required":true},
    {"key":"estado",             "label":"Estado",           "description":"Estado (UF)",                                              "required":true},
    {"key":"credito_faixa",      "label":"Faixa de Crédito", "description":"Valor aproximado desejado",                               "required":true},
    {"key":"parcela",            "label":"Parcela",          "description":"Parcela mensal confortável",                              "required":false},
    {"key":"prazo",              "label":"Prazo",            "description":"Logo, próximos meses, com calma",                         "required":true},
    {"key":"lance_entrada_fgts", "label":"FGTS / Lance",     "description":"Tem lance, entrada ou FGTS disponível?",                  "required":true},
    {"key":"melhor_horario",     "label":"Melhor Horário",   "description":"Manhã, tarde ou noite",                                   "required":true}
  ]'::jsonb,
  '["interesse","objetivo","cidade","estado","credito_faixa","prazo","lance_entrada_fgts","melhor_horario"]'::jsonb,
  '{"quente":"Objetivo claro, prazo curto, crédito e parcela informados","morno":"Interesse real mas pesquisando ou faltam dados","frio":"Curioso sem prazo, sem valor, pouca intenção"}'::jsonb,
  true
),
(
  'infinie', NULL, 'Infinie Energia Solar', 'Lara', 'SDR da Infinie Energia Solar',
  '[
    {"key":"tipo",              "label":"Tipo de Instalação",  "description":"Residência, empresa, rural, condomínio",    "required":true},
    {"key":"cidade",            "label":"Cidade",              "description":"Cidade do lead",                             "required":true},
    {"key":"estado",            "label":"Estado",              "description":"Estado (UF)",                                "required":true},
    {"key":"conta_luz_faixa",   "label":"Conta de Luz",        "description":"Valor médio mensal da conta de energia",    "required":true},
    {"key":"tipo_instalacao",   "label":"Local de Instalação", "description":"Telhado, solo, estacionamento",             "required":false},
    {"key":"prazo",             "label":"Prazo",               "description":"Previsão de implementação",                  "required":true},
    {"key":"melhor_horario",    "label":"Melhor Horário",      "description":"Manhã, tarde ou noite",                     "required":true}
  ]'::jsonb,
  '["tipo","cidade","estado","conta_luz_faixa","prazo","melhor_horario"]'::jsonb,
  '{"quente":"Tipo definido, conta informada, prazo curto","morno":"Interesse real mas pesquisando ou faltam dados","frio":"Curioso sem prazo, sem valor, pouca intenção"}'::jsonb,
  true
)
ON CONFLICT (template_key, client_id) DO NOTHING;
