-- Garante que existe o tenant LivPub para o seed rodar
INSERT INTO public.tenants (id, name)
VALUES ('00000000-0000-0000-0000-000000000000', 'LivPub')
ON CONFLICT (id) DO UPDATE SET name = 'LivPub';

-- Seed idempotente e não-destrutivo do catálogo de produtos GD.
-- Insere apenas produtos que ainda não existem (por tenant + nome);
-- nunca apaga nem sobrescreve itens editados pelo cliente.
INSERT INTO public.gd_products (tenant_id, nome, categoria, valor_padrao, recorrencia, ativo)
SELECT t.id, p.nome, p.categoria, p.valor_padrao, p.recorrencia, true
FROM public.tenants t
CROSS JOIN (
    VALUES
        ('Google Meu Negócio', 'gd', 300.00, 'mensal'),
        ('Google Ads', 'gd', 1500.00, 'mensal'),
        ('Gestão de redes sociais - Instagram', 'gd', 1200.00, 'mensal'),
        ('Gestão de redes sociais - Facebook', 'gd', 800.00, 'mensal'),
        ('Gestão de redes sociais - LinkedIn', 'gd', 1500.00, 'mensal'),
        ('Gestão de redes sociais - TikTok', 'gd', 1200.00, 'mensal'),
        ('Gestão de tráfego google/meta ads', 'gd', 2000.00, 'mensal'),
        ('Logomarca', 'gd', 800.00, 'pontual'),
        ('Branding', 'gd', 3500.00, 'pontual'),
        ('Cartão de visitas', 'gd', 250.00, 'pontual'),
        ('Arte avulsa', 'gd', 150.00, 'pontual'),
        ('Panfletos', 'gd', 400.00, 'pontual'),
        ('Cardápios', 'gd', 600.00, 'pontual'),
        ('Fachadas', 'gd', 1200.00, 'pontual'),
        ('Landing Page/site', 'gd', 2500.00, 'pontual'),
        ('E-commerce', 'gd', 5000.00, 'pontual'),
        ('Cobertura de eventos', 'gd', 1800.00, 'pontual'),
        ('Vídeo avulso', 'gd', 350.00, 'pontual'),
        ('Outros', 'gd', 0.00, 'pontual')
) AS p(nome, categoria, valor_padrao, recorrencia)
WHERE NOT EXISTS (
    SELECT 1 FROM public.gd_products gp
    WHERE gp.tenant_id = t.id AND gp.nome = p.nome
);
