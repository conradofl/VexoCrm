-- Reconstrução das importações ANTIGAS (anteriores ao registro em lead_imports, 05/10/2026), para a campanha por planilha do Banco as encontrar.
--
-- Duas fontes, as ÚNICAS que dão para saber sem palpite:
--   (1) ids em dados.import_ids que não têm linha em lead_imports (a importação existiu, o registro não);
--   (2) tags `#Imp-…` (a tag que a tela de importação cria com o nome do arquivo): o grupo de leads com a mesma tag é "a planilha".
--       Só reconstrói o grupo se ALGUM lead dele não pertence a nenhuma importação com registro (inclusive as reconstruídas em (1)): grupo todo coberto já está representado.
--
-- Regras da reconstrução (elas importam):
--   * nome SINTÉTICO e marcado: "Importação reconstruída — <tag em comum> (≈ dd/mm/aaaa)" — nunca um nome de arquivo inventado;
--   * source_type = 'reconstruida' (é o que a aplicação lê); import_params guarda reconstruida/total_e_piso/data_aproximada;
--   * total_rows = leads ENCONTRADOS e é PISO, não exato (linhas sem telefone, duplicadas ou apagadas depois não deixaram rastro);
--   * created_at = menor created_at do grupo, e é APROXIMADA;
--   * NADA por palpite: sem quem importou (uploaded_by_* NULL), sem linhas puladas (skipped_rows 0 é "não sei", ver campos_desconhecidos), sem dados
--     brutos (nenhum lead_import_items), sem mapeamento de colunas;
--   * não existe hora de abertura: a separação "nasceram / já existiam" NÃO vale para estas (a aplicação mostra só o total e diz por quê).
--
-- Aditivo e idempotente: só INSERE linhas em lead_imports e acrescenta o id da importação em dados.import_ids (união; nada removido). Não toca tags,
-- updated_at nem outras chaves de dados. Rodar de novo não duplica nada (e liga a planilha os leads que ganharam a tag depois).
-- Fora do boot: rode no console psql, medindo — `BEGIN; \timing on; <este arquivo>; ROLLBACK;` mostra o tempo sem gravar nada.

-- (1) importações com id em dados.import_ids e SEM registro: o registro nasce com o MESMO id
WITH ids AS MATERIALIZED (
  SELECT l.client_id, l.id AS lead_id, l.created_at, l.tags, x.import_id::uuid AS import_id
    FROM public.leads l
   CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(l.dados->'import_ids') = 'array' THEN l.dados->'import_ids' ELSE '[]'::jsonb END) AS x(import_id)
   WHERE x.import_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
),
faltam AS MATERIALIZED (
  SELECT client_id, import_id, count(DISTINCT lead_id)::int AS leads, min(created_at) AS primeira
    FROM ids
   WHERE NOT EXISTS (SELECT 1 FROM public.lead_imports li WHERE li.id = ids.import_id)
   GROUP BY 1, 2
),
tags_do_grupo AS MATERIALIZED (
  SELECT i.client_id, i.import_id, t AS tag, count(DISTINCT i.lead_id) AS n
    FROM ids i
    JOIN faltam f ON f.client_id = i.client_id AND f.import_id = i.import_id
   CROSS JOIN LATERAL unnest(COALESCE(i.tags, ARRAY[]::text[])) AS t
   GROUP BY 1, 2, 3
),
comum AS MATERIALIZED (
  -- tag presente em TODOS os leads do grupo; prefere a de planilha (#Imp-), depois ordem alfabética
  SELECT DISTINCT ON (g.client_id, g.import_id) g.client_id, g.import_id, g.tag
    FROM tags_do_grupo g
    JOIN faltam f ON f.client_id = g.client_id AND f.import_id = g.import_id AND f.leads = g.n
   ORDER BY g.client_id, g.import_id, (lower(g.tag) LIKE '#imp-%') DESC, g.tag
)
INSERT INTO public.lead_imports (id, client_id, source_name, source_type, total_rows, imported_rows, skipped_rows, uploaded_by_uid, uploaded_by_email, created_at, column_mapping, status, import_params)
SELECT f.import_id, f.client_id,
       'Importação reconstruída — ' || COALESCE(c.tag, 'sem tag em comum') || ' (≈ ' || to_char(f.primeira AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') || ')',
       'reconstruida', f.leads, f.leads, 0, NULL, NULL, f.primeira, NULL, 'completed',
       jsonb_build_object('reconstruida', true, 'fonte', 'import_ids', 'tag_em_comum', c.tag, 'total_e_piso', true, 'data_aproximada', true,
                          'campos_desconhecidos', jsonb_build_array('nome_do_arquivo', 'uploaded_by', 'skipped_rows', 'dados_brutos'))
  FROM faltam f
  LEFT JOIN comum c ON c.client_id = f.client_id AND c.import_id = f.import_id
ON CONFLICT (id) DO NOTHING;

-- (2) grupos de tag #Imp-… cujos leads não estão todos numa importação registrada: uma importação reconstruída por (empresa, tag)
WITH tg AS MATERIALIZED (
  SELECT l.client_id, t AS tag, l.id AS lead_id, l.created_at,
         EXISTS (
           SELECT 1
             FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(l.dados->'import_ids') = 'array' THEN l.dados->'import_ids' ELSE '[]'::jsonb END) AS x(import_id)
             JOIN public.lead_imports li ON li.id::text = x.import_id AND li.client_id = l.client_id
         ) AS coberto
    FROM public.leads l
   CROSS JOIN LATERAL unnest(COALESCE(l.tags, ARRAY[]::text[])) AS t
   WHERE lower(t) LIKE '#imp-%'
),
grupos AS MATERIALIZED (
  SELECT client_id, tag, count(*)::int AS leads, min(created_at) AS primeira, bool_and(coberto) AS tudo_coberto
    FROM tg GROUP BY 1, 2
)
INSERT INTO public.lead_imports (client_id, source_name, source_type, total_rows, imported_rows, skipped_rows, uploaded_by_uid, uploaded_by_email, created_at, column_mapping, status, import_params)
SELECT g.client_id,
       'Importação reconstruída — ' || g.tag || ' (≈ ' || to_char(g.primeira AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') || ')',
       'reconstruida', g.leads, g.leads, 0, NULL, NULL, g.primeira, NULL, 'completed',
       jsonb_build_object('reconstruida', true, 'fonte', 'tag', 'tag_planilha', g.tag, 'total_e_piso', true, 'data_aproximada', true,
                          'campos_desconhecidos', jsonb_build_array('nome_do_arquivo', 'uploaded_by', 'skipped_rows', 'dados_brutos'))
  FROM grupos g
 WHERE NOT g.tudo_coberto
   AND NOT EXISTS (SELECT 1 FROM public.lead_imports li WHERE li.client_id = g.client_id AND li.source_type = 'reconstruida' AND li.import_params->>'tag_planilha' = g.tag);

-- (3) liga cada lead à importação reconstruída da(s) sua(s) tag(s): acrescenta o id em dados.import_ids (união). A tag é a ÚNICA prova de que o lead veio
--     daquela planilha (e é editável): a ligação é exata para quem tem a tag, e só isso.
WITH par AS MATERIALIZED (
  SELECT l.id AS lead_id, li.id::text AS import_id
    FROM public.leads l
   CROSS JOIN LATERAL unnest(COALESCE(l.tags, ARRAY[]::text[])) AS t
    JOIN public.lead_imports li ON li.client_id = l.client_id AND li.source_type = 'reconstruida' AND li.import_params->>'tag_planilha' = t
),
novos AS MATERIALIZED (
  SELECT p.lead_id, jsonb_agg(p.import_id ORDER BY p.import_id) AS ids
    FROM par p
    JOIN public.leads l ON l.id = p.lead_id
   WHERE NOT (CASE WHEN jsonb_typeof(l.dados->'import_ids') = 'array' THEN l.dados->'import_ids' ELSE '[]'::jsonb END) @> to_jsonb(p.import_id)
   GROUP BY p.lead_id
)
UPDATE public.leads l
   SET dados = jsonb_set(COALESCE(l.dados, '{}'::jsonb), '{import_ids}',
                         (CASE WHEN jsonb_typeof(l.dados->'import_ids') = 'array' THEN l.dados->'import_ids' ELSE '[]'::jsonb END) || n.ids)
  FROM novos n
 WHERE l.id = n.lead_id;
