-- Migration 20261003120000: o envio passa a guardar o id do ITEM da planilha que o originou.
-- campaign_dispatch_runs.lead_id é polimórfico (id do item numa campanha de planilha; id do lead numa campanha do
-- CRM) e por isso não serve para dizer "esta planilha". lead_import_item_id é sempre item ou nulo.
-- O Relatório & Auditoria cruza por telefone canônico; esta coluna devolve precisão para separar "enviado por
-- uma campanha desta planilha" de "mesmo telefone em outra". Histórico fica nulo (o cruzamento por telefone cobre).
ALTER TABLE public.campaign_dispatch_runs
  ADD COLUMN IF NOT EXISTS lead_import_item_id UUID;

CREATE INDEX IF NOT EXISTS idx_campaign_dispatch_runs_import_item
  ON public.campaign_dispatch_runs (lead_import_item_id)
  WHERE lead_import_item_id IS NOT NULL;
