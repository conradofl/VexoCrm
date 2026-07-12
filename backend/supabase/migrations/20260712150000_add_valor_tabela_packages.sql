-- Valor de tabela (preço cheio, sem desconto) do pacote — ancoragem comercial.
-- Campo opcional; pacotes antigos continuam válidos. Idempotente, não-destrutiva.
ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS valor_tabela NUMERIC;
