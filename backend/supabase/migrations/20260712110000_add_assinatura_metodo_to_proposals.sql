-- Adiciona a coluna assinatura_metodo para registrar se o cliente assinou desenhando ou digitando
ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS assinatura_metodo TEXT DEFAULT 'desenho';
