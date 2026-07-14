-- Novo segmento comercial "Clínicas de Saúde" (médicos, consultórios e centros
-- clínicos). Inserido para todos os tenants existentes. Idempotente e
-- não-destrutivo.
INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
SELECT DISTINCT id, 'Clínicas de Saúde', 50000, true FROM public.tenants
ON CONFLICT (tenant_id, nome) DO NOTHING;
