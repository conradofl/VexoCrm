-- Novo segmento comercial "Entretenimento Local" (luderias, bares, boliches,
-- karaokês) — base do roteiro de apresentação `entretenimento_local`
-- (ex: Luderia Mestre dos Jogos). Inserido para todos os tenants existentes.
-- Idempotente e não-destrutivo. O nome contém "Entretenimento"/"Luderias", que
-- o resolveSegmentGroup usa (por palavra-chave) para escolher o roteiro certo.
INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
SELECT DISTINCT id, 'Entretenimento Local (Luderias, Bares, Boliches)', 15000, true FROM public.tenants
ON CONFLICT (tenant_id, nome) DO NOTHING;
