-- PR 6a do untangle (25/11/2026): motivo de pausa do lote como dado, não frase.
--
-- Hoje o agendador decide se um lote pausado volta sozinho procurando frase em error_message
-- ("fora da janela de envio" / "cota diária do chip atingida"). Esta coluna é GERADA a partir
-- do mesmo texto, com a mesma regra (ILIKE), então:
-- - não precisa de backfill: o Postgres calcula para todas as linhas na hora do ALTER;
-- - não precisa mudar quem grava: continua gravando error_message e a coluna acompanha;
-- - não diverge do texto em nenhuma linha.
-- Nenhum leitor usa a coluna ainda. O PR 6b troca a leitura (restartBlockers, agendador e ações
-- em massa) para pause_reason, depois que esta migration estiver provada em produção.
-- Os textos têm que ser iguais a WINDOW_PAUSE_MARKER (services/restartBlockers.js) e
-- QUOTA_PAUSE_MARKER (services/campaignQuotaGate.js); test/pauseReasonColumn.test.js confere.
ALTER TABLE public.campaign_dispatches
  ADD COLUMN IF NOT EXISTS pause_reason text
  GENERATED ALWAYS AS (
    CASE
      WHEN error_message ILIKE '%fora da janela de envio%' THEN 'fora_da_janela'
      WHEN error_message ILIKE '%cota diária do chip atingida%' THEN 'cota_chip'
      ELSE NULL
    END
  ) STORED;
