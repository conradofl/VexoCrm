-- Redesign de pacotes (2 camadas): distingue Modelos reutilizáveis de pacotes
-- criados dentro de uma proposta específica.
--   ad_hoc = true  -> pacote montado para UMA proposta; NÃO aparece na biblioteca
--                     de Modelos (some da tela Pacotes), mas é referenciado por id
--                     na proposta e hidratado normalmente (lookup por id não filtra).
--   segmento       -> classificação do Modelo (substitui a gambiarra de prefixar
--                     letra no nome para identificar o segmento).
-- Idempotente e não-destrutivo. Pacotes existentes ficam ad_hoc=false (Modelos).
ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS ad_hoc BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS segmento TEXT;
