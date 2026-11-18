-- Migration: 20261116180000_create_heloisa_execucoes_and_agendas.sql
-- Adiciona suporte oficial a execuções, agendas e configurações da Heloísa.
-- Garante campo email em heloisa_usuarios_autorizados e índices de auditoria para o painel.

-- 1. Garante coluna email em public.heloisa_usuarios_autorizados
ALTER TABLE public.heloisa_usuarios_autorizados 
ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- 2. Tabela de configurações da Heloísa
CREATE TABLE IF NOT EXISTS public.heloisa_config (
  chave VARCHAR(100) PRIMARY KEY,
  valor JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by VARCHAR(150)
);

-- 3. Tabela de agendas ativas para convites e reuniões
CREATE TABLE IF NOT EXISTS public.heloisa_agendas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome VARCHAR(150) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  telefone VARCHAR(50),
  papel VARCHAR(100) DEFAULT 'Participante',
  ativo BOOLEAN DEFAULT true,
  notificar_whatsapp BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_heloisa_agendas_email ON public.heloisa_agendas (email);
CREATE INDEX IF NOT EXISTS idx_heloisa_agendas_ativo ON public.heloisa_agendas (ativo);

-- 4. Tabela de auditoria de execuções da Heloísa (Painel de Execuções)
CREATE TABLE IF NOT EXISTS public.heloisa_execucoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canal VARCHAR(50) NOT NULL DEFAULT 'whatsapp',
  solicitante_nome VARCHAR(150),
  solicitante_telefone VARCHAR(50),
  solicitante_papel VARCHAR(100),
  client_id VARCHAR(100) DEFAULT 'vexo-adm',
  texto_entrada TEXT,
  tipo_entrada VARCHAR(50) DEFAULT 'text',
  ferramenta_executada VARCHAR(100),
  parametros JSONB DEFAULT '{}',
  resultado JSONB DEFAULT '{}',
  resposta_saida TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'sucesso',
  erro_detalhes TEXT,
  tempo_execucao_ms INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices essenciais para consultas paginadas e métricas do painel
CREATE INDEX IF NOT EXISTS idx_heloisa_execucoes_created_at ON public.heloisa_execucoes (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_heloisa_execucoes_status ON public.heloisa_execucoes (status);
CREATE INDEX IF NOT EXISTS idx_heloisa_execucoes_canal ON public.heloisa_execucoes (canal);
CREATE INDEX IF NOT EXISTS idx_heloisa_execucoes_solicitante_telefone ON public.heloisa_execucoes (solicitante_telefone);
CREATE INDEX IF NOT EXISTS idx_heloisa_execucoes_ferramenta ON public.heloisa_execucoes (ferramenta_executada);

-- 5. Seeds iniciais essenciais com idempotência
INSERT INTO public.heloisa_config (chave, valor)
VALUES ('status_ativo', '{"ativo": true}')
ON CONFLICT (chave) DO NOTHING;

INSERT INTO public.heloisa_agendas (nome, email, telefone, papel, ativo, notificar_whatsapp)
VALUES 
  ('Conrado Finzi', 'conradofinzi@gmail.com', '5534997817660', 'Sócio Diretor Executivo', true, true),
  ('Caio Almeida', 'caioalmeidmrk@gmail.com', '5534997719779', 'Sócio Diretor Comercial', true, true),
  ('Geração Digital', 'mrkgeracaodigital@gmail.com', NULL, 'Agência Oficial', true, false)
ON CONFLICT (email) DO NOTHING;

INSERT INTO public.heloisa_usuarios_autorizados (client_id, nome, telefone, email, papel, ativo)
VALUES
  ('geracao-digital', 'Conrado Finzi', '5534997817660', 'conradofinzi@gmail.com', 'Diretor Executivo / Sócio', true),
  ('geracao-digital', 'Caio Almeida', '5534997719779', 'caioalmeidmrk@gmail.com', 'Diretor Comercial / Sócio', true)
ON CONFLICT (telefone) DO UPDATE SET email = EXCLUDED.email WHERE public.heloisa_usuarios_autorizados.email IS NULL;
