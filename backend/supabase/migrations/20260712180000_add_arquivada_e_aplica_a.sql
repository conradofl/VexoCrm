-- 1. Arquivamento de propostas (some da lista principal sem perder histórico).
--    Campo opcional com default; propostas antigas continuam válidas.
ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS arquivada BOOLEAN NOT NULL DEFAULT false;

-- 2. Escopo da condição de pagamento: 'setup' (entrada) ou 'mensalidade'.
--    Condições antigas caem no default 'setup'. Idempotente, não-destrutiva.
ALTER TABLE public.gd_payment_terms ADD COLUMN IF NOT EXISTS aplica_a TEXT NOT NULL DEFAULT 'setup';
