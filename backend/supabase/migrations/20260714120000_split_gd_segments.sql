-- Migration to split composite segments in gd_segments table
-- 1. Insert the new split segments for ALL tenants that currently have the old ones
INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
SELECT DISTINCT tenant_id, 'Imobiliário', 80000, true FROM public.gd_segments WHERE nome = 'Imobiliário e incorporadoras'
ON CONFLICT (tenant_id, nome) DO NOTHING;

INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
SELECT DISTINCT tenant_id, 'Incorporadoras', 100000, true FROM public.gd_segments WHERE nome = 'Imobiliário e incorporadoras'
ON CONFLICT (tenant_id, nome) DO NOTHING;

INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
SELECT DISTINCT tenant_id, 'Clínicas de Estética', 40000, true FROM public.gd_segments WHERE nome = 'Clínicas de estética e odontologia'
ON CONFLICT (tenant_id, nome) DO NOTHING;

INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
SELECT DISTINCT tenant_id, 'Odontologia', 40000, true FROM public.gd_segments WHERE nome = 'Clínicas de estética e odontologia'
ON CONFLICT (tenant_id, nome) DO NOTHING;

INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
SELECT DISTINCT tenant_id, 'E-commerce', 60000, true FROM public.gd_segments WHERE nome = 'E-commerce e varejo escalável'
ON CONFLICT (tenant_id, nome) DO NOTHING;

INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
SELECT DISTINCT tenant_id, 'Varejo Escalável', 60000, true FROM public.gd_segments WHERE nome = 'E-commerce e varejo escalável'
ON CONFLICT (tenant_id, nome) DO NOTHING;

INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
SELECT DISTINCT tenant_id, 'Automotivo (Concessionárias)', 100000, true FROM public.gd_segments WHERE nome = 'Automotivo (concessionárias e seminovos)'
ON CONFLICT (tenant_id, nome) DO NOTHING;

INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
SELECT DISTINCT tenant_id, 'Automotivo (Seminovos)', 80000, true FROM public.gd_segments WHERE nome = 'Automotivo (concessionárias e seminovos)'
ON CONFLICT (tenant_id, nome) DO NOTHING;

INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
SELECT DISTINCT tenant_id, 'Advocacia', 20000, true FROM public.gd_segments WHERE nome = 'Advocacia e contabilidade'
ON CONFLICT (tenant_id, nome) DO NOTHING;

INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
SELECT DISTINCT tenant_id, 'Contabilidade', 20000, true FROM public.gd_segments WHERE nome = 'Advocacia e contabilidade'
ON CONFLICT (tenant_id, nome) DO NOTHING;

INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
SELECT DISTINCT tenant_id, 'Educação (Cursos)', 35000, true FROM public.gd_segments WHERE nome = 'Educação (cursos e escolas)'
ON CONFLICT (tenant_id, nome) DO NOTHING;

INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
SELECT DISTINCT tenant_id, 'Educação (Escolas)', 40000, true FROM public.gd_segments WHERE nome = 'Educação (cursos e escolas)'
ON CONFLICT (tenant_id, nome) DO NOTHING;

INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
SELECT DISTINCT tenant_id, 'Saúde (Clínicas)', 50000, true FROM public.gd_segments WHERE nome = 'Saúde (clínicas e laboratórios)'
ON CONFLICT (tenant_id, nome) DO NOTHING;

INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
SELECT DISTINCT tenant_id, 'Saúde (Laboratórios)', 60000, true FROM public.gd_segments WHERE nome = 'Saúde (clínicas e laboratórios)'
ON CONFLICT (tenant_id, nome) DO NOTHING;

INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
SELECT DISTINCT tenant_id, 'Franquias', 150000, true FROM public.gd_segments WHERE nome = 'Franquias e redes multiunidade'
ON CONFLICT (tenant_id, nome) DO NOTHING;

INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
SELECT DISTINCT tenant_id, 'Redes Multiunidade', 150000, true FROM public.gd_segments WHERE nome = 'Franquias e redes multiunidade'
ON CONFLICT (tenant_id, nome) DO NOTHING;

INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
SELECT DISTINCT tenant_id, 'Turismo', 45000, true FROM public.gd_segments WHERE nome = 'Turismo e hospitalidade'
ON CONFLICT (tenant_id, nome) DO NOTHING;

INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
SELECT DISTINCT tenant_id, 'Hospitalidade', 50000, true FROM public.gd_segments WHERE nome = 'Turismo e hospitalidade'
ON CONFLICT (tenant_id, nome) DO NOTHING;

INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
SELECT DISTINCT tenant_id, 'Food Service Premium', 30000, true FROM public.gd_segments WHERE nome = 'Food service premium e delivery'
ON CONFLICT (tenant_id, nome) DO NOTHING;

INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
SELECT DISTINCT tenant_id, 'Delivery', 25000, true FROM public.gd_segments WHERE nome = 'Food service premium e delivery'
ON CONFLICT (tenant_id, nome) DO NOTHING;

-- 2. Update existing presentations to point to the new split segments of the SAME tenant
WITH name_map(old_name, new_name) AS (
  VALUES
    ('Imobiliário e incorporadoras', 'Imobiliário'),
    ('Clínicas de estética e odontologia', 'Clínicas de Estética'),
    ('E-commerce e varejo escalável', 'E-commerce'),
    ('Automotivo (concessionárias e seminovos)', 'Automotivo (Concessionárias)'),
    ('Advocacia e contabilidade', 'Advocacia'),
    ('Educação (cursos e escolas)', 'Educação (Cursos)'),
    ('Saúde (clínicas e laboratórios)', 'Saúde (Clínicas)'),
    ('Franquias e redes multiunidade', 'Franquias'),
    ('Turismo e hospitalidade', 'Turismo'),
    ('Food service premium e delivery', 'Food Service Premium')
),
updates AS (
  SELECT
    p.id AS presentation_id,
    s_new.id AS new_segment_id
  FROM public.gd_presentations p
  JOIN public.gd_segments s_old ON p.segment_id = s_old.id
  JOIN name_map m ON s_old.nome = m.old_name
  JOIN public.gd_segments s_new ON s_old.tenant_id = s_new.tenant_id AND s_new.nome = m.new_name
)
UPDATE public.gd_presentations p
SET segment_id = updates.new_segment_id
FROM updates
WHERE p.id = updates.presentation_id;

-- 3. Safe fallback: set segment_id to NULL for any presentation that still references the old composite segments
UPDATE public.gd_presentations
SET segment_id = NULL
WHERE segment_id IN (
  SELECT id FROM public.gd_segments
  WHERE nome IN (
    'Imobiliário e incorporadoras',
    'Clínicas de estética e odontologia',
    'E-commerce e varejo escalável',
    'Automotivo (concessionárias e seminovos)',
    'Advocacia e contabilidade',
    'Educação (cursos e escolas)',
    'Saúde (clínicas e laboratórios)',
    'Franquias e redes multiunidade',
    'Turismo e hospitalidade',
    'Food service premium e delivery'
  )
);

-- 4. Delete the old composite segments now that they are completely unreferenced
DELETE FROM public.gd_segments
WHERE nome IN (
  'Imobiliário e incorporadoras',
  'Clínicas de estética e odontologia',
  'E-commerce e varejo escalável',
  'Automotivo (concessionárias e seminovos)',
  'Advocacia e contabilidade',
  'Educação (cursos e escolas)',
  'Saúde (clínicas e laboratórios)',
  'Franquias e redes multiunidade',
  'Turismo e hospitalidade',
  'Food service premium e delivery'
);
