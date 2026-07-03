-- Fix: corrige client_id errado gerado pelo script de seed (liv_pub -> livpub)
-- ATUALIZADO: com verificação de duplicidade para evitar falha na migração

-- 1. Garante que o client_id correto existe
INSERT INTO public.leads_clients (id, name) 
VALUES ('livpub', 'LivPub') 
ON CONFLICT (id) DO NOTHING;

-- 2. Move os leads do client_id errado para o correto 
-- (apenas os telefones que não existem no livpub ainda)
UPDATE public.leads l1
SET client_id = 'livpub' 
WHERE client_id = 'liv_pub'
  AND NOT EXISTS (
      SELECT 1 FROM public.leads l2 
      WHERE l2.client_id = 'livpub' 
        AND l2.telefone = l1.telefone
  );

-- 3. Exclui os leads restantes que já existiam no livpub
DELETE FROM public.leads WHERE client_id = 'liv_pub';

-- 4. Limpa o client_id errado
DELETE FROM public.leads_clients 
WHERE id = 'liv_pub';
