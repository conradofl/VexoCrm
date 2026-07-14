-- Garante que existe pelo menos um tenant para o seed rodar
INSERT INTO public.tenants (id, name)
VALUES ('00000000-0000-0000-0000-000000000000', 'Tenant Seed')
ON CONFLICT (id) DO NOTHING;

-- Seeds de todos os produtos do catálogo comercial da GD
-- Usando a identificação padrão de UUID de Tenant Seed
DELETE FROM public.gd_products WHERE tenant_id = '00000000-0000-0000-0000-000000000000';

INSERT INTO public.gd_products (tenant_id, nome, categoria, valor_padrao, recorrencia, ativo)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'Google Meu Negócio', 'gd', 300.00, 'mensal', true),
  ('00000000-0000-0000-0000-000000000000', 'Google Ads', 'gd', 1500.00, 'mensal', true),
  ('00000000-0000-0000-0000-000000000000', 'Gestão de redes sociais - Instagram', 'gd', 1200.00, 'mensal', true),
  ('00000000-0000-0000-0000-000000000000', 'Gestão de redes sociais - Facebook', 'gd', 800.00, 'mensal', true),
  ('00000000-0000-0000-0000-000000000000', 'Gestão de redes sociais - LinkedIn', 'gd', 1500.00, 'mensal', true),
  ('00000000-0000-0000-0000-000000000000', 'Gestão de redes sociais - TikTok', 'gd', 1200.00, 'mensal', true),
  ('00000000-0000-0000-0000-000000000000', 'Gestão de tráfego google/meta ads', 'gd', 2000.00, 'mensal', true),
  ('00000000-0000-0000-0000-000000000000', 'Logomarca', 'gd', 800.00, 'pontual', true),
  ('00000000-0000-0000-0000-000000000000', 'Branding', 'gd', 3500.00, 'pontual', true),
  ('00000000-0000-0000-0000-000000000000', 'Cartão de visitas', 'gd', 250.00, 'pontual', true),
  ('00000000-0000-0000-0000-000000000000', 'Arte avulsa', 'gd', 150.00, 'pontual', true),
  ('00000000-0000-0000-0000-000000000000', 'Panfletos', 'gd', 400.00, 'pontual', true),
  ('00000000-0000-0000-0000-000000000000', 'Cardápios', 'gd', 600.00, 'pontual', true),
  ('00000000-0000-0000-0000-000000000000', 'Fachadas', 'gd', 1200.00, 'pontual', true),
  ('00000000-0000-0000-0000-000000000000', 'Landing Page/site', 'gd', 2500.00, 'pontual', true),
  ('00000000-0000-0000-0000-000000000000', 'E-commerce', 'gd', 5000.00, 'pontual', true),
  ('00000000-0000-0000-0000-000000000000', 'Cobertura de eventos', 'gd', 1800.00, 'pontual', true),
  ('00000000-0000-0000-0000-000000000000', 'Vídeo avulso', 'gd', 350.00, 'pontual', true),
  ('00000000-0000-0000-0000-000000000000', 'Outros', 'gd', 0.00, 'pontual', true);
