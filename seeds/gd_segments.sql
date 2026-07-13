-- Garante que existe pelo menos um tenant para o seed rodar
INSERT INTO public.tenants (id, name)
VALUES ('00000000-0000-0000-0000-000000000000', 'Tenant Seed')
ON CONFLICT (id) DO NOTHING;

-- Seeds de segmentos
INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'Energia solar', 50000, true),
  ('00000000-0000-0000-0000-000000000000', 'Consórcios', 30000, true),
  ('00000000-0000-0000-0000-000000000000', 'Imobiliário e incorporadoras', 80000, true),
  ('00000000-0000-0000-0000-000000000000', 'Clínicas de estética e odontologia', 40000, true),
  ('00000000-0000-0000-0000-000000000000', 'E-commerce e varejo escalável', 60000, true),
  ('00000000-0000-0000-0000-000000000000', 'Automotivo (concessionárias e seminovos)', 100000, true),
  ('00000000-0000-0000-0000-000000000000', 'Advocacia e contabilidade', 20000, true),
  ('00000000-0000-0000-0000-000000000000', 'Educação (cursos e escolas)', 35000, true),
  ('00000000-0000-0000-0000-000000000000', 'Saúde (clínicas e laboratórios)', 50000, true),
  ('00000000-0000-0000-0000-000000000000', 'Franquias e redes multiunidade', 150000, true),
  ('00000000-0000-0000-0000-000000000000', 'Turismo e hospitalidade', 45000, true),
  ('00000000-0000-0000-0000-000000000000', 'Food service premium e delivery', 30000, true)
ON CONFLICT (tenant_id, nome) DO NOTHING;
