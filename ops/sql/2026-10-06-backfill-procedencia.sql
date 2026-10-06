-- Procedência e rótulos da IA ganham campo próprio em dados (aditivo): preenche o HISTÓRICO a partir das tags existentes.
--   dados.procedencia = { grupos: [...], agenda_whatsapp: bool, conversa_whatsapp: bool }
--   dados.rotulos_ia  = [...]   (só da lista fechada abaixo; espelho de AI_LABELS em services/leadProcedencia.js — um teste confere que são iguais; lista GLOBAL, deveria ser por empresa)
--
-- NENHUMA tag é alterada ou removida: o dono tem filtros e campanhas em cima delas. Só acrescenta chaves em `dados`.
-- Idempotente: procedencia é UNIÃO do que já existe com o que as tags dizem (não perde o que o código novo já gravou); rotulos_ia só é preenchido
-- quando o lead ainda não tem o campo (o campo é "o palpite mais recente"; não se sobrescreve o que o código novo gravou).
-- Grupo = tag que é o nome de um grupo extraído, isto é, igual a dados.grupo_nome de algum lead da MESMA empresa.
-- Não toca updated_at (não é edição do lead).
-- MATERIALIZED nos três CTEs: sem isso o planejador pode inlinar `calc` dentro do join com `leads` e reavaliar as subconsultas correlacionadas
-- (unnest/array_agg por lead) a cada linha sondada — O(n²) em 24 mil leads, uma migration que não termina no boot.
WITH grupos AS MATERIALIZED (
  SELECT DISTINCT client_id, dados->>'grupo_nome' AS g
    FROM public.leads
   WHERE dados ? 'grupo_nome' AND COALESCE(dados->>'grupo_nome', '') <> ''
),
calc AS MATERIALIZED (
  SELECT l.id,
         ARRAY(
           SELECT DISTINCT x FROM (
             SELECT t AS x FROM unnest(COALESCE(l.tags, ARRAY[]::text[])) AS t JOIN grupos g ON g.client_id = l.client_id AND g.g = t
             UNION
             SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(l.dados->'procedencia'->'grupos') = 'array' THEN l.dados->'procedencia'->'grupos' ELSE '[]'::jsonb END)
           ) u ORDER BY x
         ) AS grupos,
         ('agenda-whatsapp' = ANY(COALESCE(l.tags, ARRAY[]::text[])) OR COALESCE((l.dados->'procedencia'->>'agenda_whatsapp')::boolean, false)) AS agenda,
         ('WhatsApp WA' = ANY(COALESCE(l.tags, ARRAY[]::text[])) OR COALESCE((l.dados->'procedencia'->>'conversa_whatsapp')::boolean, false)) AS conversa,
         ARRAY(
           SELECT t FROM unnest(COALESCE(l.tags, ARRAY[]::text[])) WITH ORDINALITY AS u(t, pos)
            WHERE t = ANY(ARRAY['Fechamento','Orçamento','Dúvida','Não Convertido','Óculos de Sol','Energia Solar','Prioridade alta','Follow-up'])
            GROUP BY t ORDER BY min(pos)
         ) AS rotulos,
         (l.dados ? 'rotulos_ia') AS tem_rotulos
    FROM public.leads l
),
alvo AS MATERIALIZED (
  SELECT id, grupos, agenda, conversa, rotulos, tem_rotulos,
         jsonb_build_object('grupos', to_jsonb(grupos), 'agenda_whatsapp', agenda, 'conversa_whatsapp', conversa) AS proc
    FROM calc
   WHERE cardinality(grupos) > 0 OR agenda OR conversa OR (NOT tem_rotulos AND cardinality(rotulos) > 0)
)
UPDATE public.leads l
   SET dados = COALESCE(l.dados, '{}'::jsonb)
               || CASE WHEN a.tem_proc THEN jsonb_build_object('procedencia', a.proc) ELSE '{}'::jsonb END
               || CASE WHEN NOT a.tem_rotulos AND cardinality(a.rotulos) > 0 THEN jsonb_build_object('rotulos_ia', to_jsonb(a.rotulos)) ELSE '{}'::jsonb END
  FROM (SELECT *, (cardinality(grupos) > 0 OR agenda OR conversa) AS tem_proc FROM alvo) a
 WHERE l.id = a.id
   AND (
     (a.tem_proc AND (l.dados->'procedencia') IS DISTINCT FROM a.proc)
     OR (NOT a.tem_rotulos AND cardinality(a.rotulos) > 0)
   );
