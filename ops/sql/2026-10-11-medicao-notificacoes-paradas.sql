-- ops/sql/2026-10-11-medicao-notificacoes-paradas.sql
--
-- SÓ LEITURA (Zero escrita, zero transação de alteração).
-- Medição das notificações de 'lead_stalled' gravadas pela regra antiga em public.notifications,
-- contagem de não lidas por tenant, e medição real de tempo da varredura com EXPLAIN ANALYZE.
--
-- Instruções de Execução (Console do Easypanel -> db-vexo -> Postgres Client -> \c vexo):
-- Cole o bloco abaixo.

\timing on

-- 1. Contagem de notificações de 'lead_stalled' por tenant (total, não lidas, lidas e datas)
SELECT 
  n.client_id,
  count(*)::int AS total_notificacoes_parados,
  count(*) FILTER (WHERE n.read = false)::int AS nao_lidas,
  count(*) FILTER (WHERE n.read = true)::int AS lidas,
  min(n.created_at) AS mais_antiga,
  max(n.created_at) AS mais_recente
FROM public.notifications n
WHERE n.type = 'lead_stalled'
GROUP BY n.client_id
ORDER BY total_notificacoes_parados DESC;

-- 2. Panorama geral de todas as notificações por tipo no banco
SELECT 
  n.type,
  count(*)::int AS total,
  count(*) FILTER (WHERE n.read = false)::int AS nao_lidas
FROM public.notifications n
GROUP BY n.type
ORDER BY total DESC;

-- 3. Status de sincronização diária por tenant (lead_client_n8n_settings)
SELECT 
  client_id, 
  stalled_notifications_synced_at,
  reactivation_enabled,
  reactivation_stalled_days
FROM public.lead_client_n8n_settings
ORDER BY stalled_notifications_synced_at DESC NULLS LAST;

-- 4. Separação canônica na base de leads (Parados vs Nunca Abordados) por tenant
SELECT
  l.client_id,
  count(*)::int AS total_base_aberta,
  count(*) FILTER (
    WHERE (l.last_message_at IS NOT NULL OR l.last_interaction_at IS NOT NULL)
      AND (NOW() - COALESCE(l.last_message_at, l.last_interaction_at)) >= INTERVAL '7 days'
  )::int AS parados_com_conversa_7d,
  count(*) FILTER (
    WHERE l.last_message_at IS NULL AND l.last_interaction_at IS NULL
  )::int AS nunca_abordados_base_fria
FROM public.leads l
WHERE (l.stage IS NULL OR lower(l.stage) NOT IN ('fechado', 'buyer', 'perdido', 'descartado', 'lost'))
GROUP BY l.client_id
ORDER BY total_base_aberta DESC;

-- 5. MEDIÇÃO REAL DE TEMPO (EXPLAIN ANALYZE): Tempo exato da varredura nova no Postgres
-- Executa a query canônica corrigida com medição de buffers e tempo de execução:
EXPLAIN (ANALYZE, BUFFERS)
SELECT
  l.client_id,
  l.nome,
  COALESCE(l.telefone, l.phone) AS telefone,
  EXTRACT(DAY FROM (NOW() - COALESCE(l.last_message_at, l.last_interaction_at)))::int AS days_idle
FROM public.leads l
WHERE l.client_id = 'geracao-digital'
  AND (l.stage IS NULL OR lower(l.stage) NOT IN ('fechado', 'buyer', 'perdido', 'descartado', 'lost'))
  AND (l.last_message_at IS NOT NULL OR l.last_interaction_at IS NOT NULL)
  AND (NOW() - COALESCE(l.last_message_at, l.last_interaction_at)) >= INTERVAL '7 days'
  AND COALESCE(l.telefone, l.phone) IS NOT NULL;
