-- Mantém ativos apenas os segmentos que têm roteiro de apresentação
-- personalizado hoje (entretenimento_local + saude_estetica). Os demais são
-- DESATIVADOS (ativo = false) — não apagados: continuam no banco, preservam
-- histórico/FK de propostas antigas e podem ser reativados quando ganharem
-- roteiro próprio. Idempotente e não-destrutivo.
UPDATE public.gd_segments
SET ativo = false
WHERE nome NOT IN (
  'Entretenimento Local (Luderias, Bares, Boliches)',
  'Clínicas de Saúde',
  'Clínicas de Estética',
  'Odontologia'
);
