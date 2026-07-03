-- Fix: corrige client_id errado gerado pelo script de seed (liv_pub -> livpub)

-- 1. Garante que o client_id correto existe
INSERT INTO public.leads_clients (id, name) 
VALUES ('livpub', 'LivPub') 
ON CONFLICT (id) DO NOTHING;

-- 2. Move os leads do client_id errado para o correto (ignora conflitos de telefone caso já existam)
UPDATE public.leads 
SET client_id = 'livpub' 
WHERE client_id = 'liv_pub';

-- 3. Limpa o client_id errado (isso não excluirá os leads, pois já foram movidos)
DELETE FROM public.leads_clients 
WHERE id = 'liv_pub';
