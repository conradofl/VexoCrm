-- Migration to split composite segments in gd_segments table
-- Deletes the composite ones and inserts the split ones.

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

INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'Imobiliário', 80000, true),
  ('00000000-0000-0000-0000-000000000000', 'Incorporadoras', 100000, true),
  ('00000000-0000-0000-0000-000000000000', 'Clínicas de Estética', 40000, true),
  ('00000000-0000-0000-0000-000000000000', 'Odontologia', 40000, true),
  ('00000000-0000-0000-0000-000000000000', 'E-commerce', 60000, true),
  ('00000000-0000-0000-0000-000000000000', 'Varejo Escalável', 60000, true),
  ('00000000-0000-0000-0000-000000000000', 'Automotivo (Concessionárias)', 100000, true),
  ('00000000-0000-0000-0000-000000000000', 'Automotivo (Seminovos)', 80000, true),
  ('00000000-0000-0000-0000-000000000000', 'Advocacia', 20000, true),
  ('00000000-0000-0000-0000-000000000000', 'Contabilidade', 20000, true),
  ('00000000-0000-0000-0000-000000000000', 'Educação (Cursos)', 35000, true),
  ('00000000-0000-0000-0000-000000000000', 'Educação (Escolas)', 40000, true),
  ('00000000-0000-0000-0000-000000000000', 'Saúde (Clínicas)', 50000, true),
  ('00000000-0000-0000-0000-000000000000', 'Saúde (Laboratórios)', 60000, true),
  ('00000000-0000-0000-0000-000000000000', 'Franquias', 150000, true),
  ('00000000-0000-0000-0000-000000000000', 'Redes Multiunidade', 150000, true),
  ('00000000-0000-0000-0000-000000000000', 'Turismo', 45000, true),
  ('00000000-0000-0000-0000-000000000000', 'Hospitalidade', 50000, true),
  ('00000000-0000-0000-0000-000000000000', 'Food Service Premium', 30000, true),
  ('00000000-0000-0000-0000-000000000000', 'Delivery', 25000, true)
ON CONFLICT (tenant_id, nome) DO NOTHING;
