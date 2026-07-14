-- Garante que existe pelo menos um tenant para o seed rodar
INSERT INTO public.tenants (id, name)
VALUES ('00000000-0000-0000-0000-000000000000', 'Tenant Seed')
ON CONFLICT (id) DO NOTHING;

-- Seeds de segmentos
INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'Energia solar', 50000, true),
  ('00000000-0000-0000-0000-000000000000', 'Consórcios', 30000, true),
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
