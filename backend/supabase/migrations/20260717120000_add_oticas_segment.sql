-- Novo segmento comercial "Óticas" — base do roteiro de apresentação `otica`
-- (fim da guerra de preço: resgate de orçamentos + recompra de troca de lente).
-- Inserido para todos os tenants existentes. Idempotente e não-destrutivo.
-- O nome contém "Óticas", que o resolveSegmentGroup usa (por palavra-chave) para
-- escolher o roteiro certo. Roda depois da deactivate_unused_gd_segments
-- (20260715130000), então nasce e permanece ativo.
INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
SELECT DISTINCT id, 'Óticas', 25000, true FROM public.tenants
ON CONFLICT (tenant_id, nome) DO NOTHING;
