-- ops/sql/2026-10-11-execucao-limpeza-notificacoes-paradas.sql
--
-- LIMPEZA CIRÚRGICA DE NOTIFICAÇÕES 'lead_stalled' INDEVIDAS
-- Medição realizada em produção:
-- Total geral de lead_stalled: 2.889
-- Indevidas (leads frios/importados que NUNCA tiveram mensagem/interação): 2.674
--   - gmca: 1.892
--   - sonhare: 782
-- Legítimas a preservar (leads com conversa real): 215
--   - gmca: 212
--   - sonhare: 3
-- geracao-digital: 0 (totalmente limpa)
--
-- Padrão de segurança: Sempre executar dentro de transação (BEGIN / COMMIT)

BEGIN;

-- 1. Exclui estritamente as 2.674 notificações de contatos que nunca foram abordados
DELETE FROM public.notifications n
WHERE n.type = 'lead_stalled'
  AND EXISTS (
    SELECT 1 
    FROM public.leads l
    WHERE l.client_id = n.client_id
      AND ('/crm/whatsapp?phone=' || COALESCE(l.telefone, l.phone, '')) = n.link
      AND l.last_message_at IS NULL
      AND l.last_interaction_at IS NULL
  );

-- VALIDAÇÃO IMEDIATA:
-- Espera-se: DELETE 2674

-- 2. Conferir as notificações legítimas restantes (deve restar exatamente 212 em gmca e 3 em sonhare)
SELECT 
  client_id, 
  count(*)::int AS total_restantes_legitimas
FROM public.notifications 
WHERE type = 'lead_stalled' 
GROUP BY client_id
ORDER BY total_restantes_legitimas DESC;

-- Se o DELETE retornar exatamente 2674 e a conferência mostrar 212 (gmca) e 3 (sonhare):
-- COMMIT;
--
-- Caso haja qualquer divergência:
-- ROLLBACK;
