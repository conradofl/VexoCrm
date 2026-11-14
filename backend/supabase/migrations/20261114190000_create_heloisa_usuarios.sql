-- Migration: 20261114190000_create_heloisa_usuarios.sql
-- Tabela de usuários autorizados a interagir com a Heloísa (Secretária Executiva WhatsApp)
-- Centraliza diretores, sócios e gestores autorizados com fallback de segurança.

CREATE TABLE IF NOT EXISTS public.heloisa_usuarios_autorizados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL DEFAULT 'geracao-digital',
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL UNIQUE,
  papel TEXT NOT NULL DEFAULT 'Diretor',
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_heloisa_usuarios_ativo ON public.heloisa_usuarios_autorizados (ativo);
CREATE INDEX IF NOT EXISTS idx_heloisa_usuarios_telefone ON public.heloisa_usuarios_autorizados (telefone);

-- Gatilho de updated_at automático
CREATE OR REPLACE FUNCTION public.set_heloisa_usuarios_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_heloisa_usuarios_updated_at ON public.heloisa_usuarios_autorizados;
CREATE TRIGGER trg_heloisa_usuarios_updated_at
  BEFORE UPDATE ON public.heloisa_usuarios_autorizados
  FOR EACH ROW
  EXECUTE FUNCTION public.set_heloisa_usuarios_updated_at();

-- Seed inicial com Conrado e Caio
INSERT INTO public.heloisa_usuarios_autorizados (client_id, nome, telefone, papel, ativo)
VALUES 
  ('geracao-digital', 'Conrado Finzi', '5534997817660', 'Diretor Executivo / Sócio', true),
  ('geracao-digital', 'Caio Almeida', '5534997719779', 'Diretor Comercial / Sócio', true)
ON CONFLICT (telefone) DO NOTHING;
