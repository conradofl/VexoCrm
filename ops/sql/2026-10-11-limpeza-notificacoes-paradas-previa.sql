-- ops/sql/2026-10-11-limpeza-notificacoes-paradas-previa.sql
--
-- PRÉVIA DE LIMPEZA (SÓ LEITURA - Não apaga nada sem autorização expressa).
-- Padrão de segurança: exibe a contagem exata e amostra de notificações que foram
-- geradas indevidamente pela regra antiga (ou seja, de contatos que NUNCA tiveram conversa).
--
-- Critério Canônico de Proteção:
-- - Notificações de 'lead_stalled' de contatos que POSSUEM conversa real (last_message_at ou last_interaction_at)
--   SÃO PRESERVADAS.
-- - Apenas notificações de contatos frios/importados que NUNCA tiveram mensagem/interação seriam alvo de limpeza.

\timing on

-- 1. PRÉVIA POR TENANT: Quantas notificações de 'lead_stalled' pertencem a leads SEM nenhuma conversa?
SELECT
  n.client_id,
  count(*)::int AS total_notificacoes_lead_stalled,
  count(*) FILTER (
    WHERE l.last_message_at IS NULL AND l.last_interaction_at IS NULL
  )::int AS indevidas_leads_nunca_abordados,
  count(*) FILTER (
    WHERE l.last_message_at IS NOT NULL OR l.last_interaction_at IS NOT NULL
  )::int AS legitimas_leads_em_conversa
FROM public.notifications n
LEFT JOIN public.leads l 
  ON l.client_id = n.client_id 
 AND ('/crm/whatsapp?phone=' || COALESCE(l.telefone, l.phone, '')) = n.link
WHERE n.type = 'lead_stalled'
GROUP BY n.client_id
ORDER BY total_notificacoes_lead_stalled DESC;

-- 2. AMOSTRA das 10 primeiras notificações que seriam atingidas
SELECT
  n.id,
  n.client_id,
  n.title,
  n.link,
  n.read,
  n.created_at,
  COALESCE(l.nome, 'Sem nome') AS lead_nome,
  l.last_message_at,
  l.last_interaction_at
FROM public.notifications n
LEFT JOIN public.leads l 
  ON l.client_id = n.client_id 
 AND ('/crm/whatsapp?phone=' || COALESCE(l.telefone, l.phone, '')) = n.link
WHERE n.type = 'lead_stalled'
  AND (l.id IS NULL OR (l.last_message_at IS NULL AND l.last_interaction_at IS NULL))
ORDER BY n.created_at DESC
LIMIT 10;
