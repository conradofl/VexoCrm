-- Migration: 20261114180000_create_gd_colaboradores.sql
-- Tabela de colaboradores da Geração Digital & Vexo OS
-- Centraliza telefones oficiais de WhatsApp, funções, Trello e flags de cobrança para os agentes autônomos (GoClaw / Heloísa / Vigia).

CREATE TABLE IF NOT EXISTS public.gd_colaboradores (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                     text NOT NULL,
  funcao                   text NOT NULL,
  telefone                 text NOT NULL,
  email                    text,
  trello_username          text,
  recebe_cobranca_whatsapp boolean NOT NULL DEFAULT true,
  ativo                    boolean NOT NULL DEFAULT true,
  observacoes              text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gd_colaboradores_telefone_unique UNIQUE (telefone),
  CONSTRAINT gd_colaboradores_telefone_valido CHECK (telefone ~ '^55[1-9][0-9]{9,10}$')
);

CREATE INDEX IF NOT EXISTS idx_gd_colaboradores_ativo ON public.gd_colaboradores (ativo);
CREATE INDEX IF NOT EXISTS idx_gd_colaboradores_telefone ON public.gd_colaboradores (telefone);

-- Gatilho de updated_at automático se a função existir, ou cria se não existir
CREATE OR REPLACE FUNCTION public.set_gd_colaboradores_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gd_colaboradores_updated_at ON public.gd_colaboradores;
CREATE TRIGGER trg_gd_colaboradores_updated_at
  BEFORE UPDATE ON public.gd_colaboradores
  FOR EACH ROW
  EXECUTE FUNCTION public.set_gd_colaboradores_updated_at();

-- Carga inicial oficial (Base extraída da planilha Relação de colaboradores - Agencia GD.xlsx)
INSERT INTO public.gd_colaboradores (nome, funcao, telefone, trello_username, recebe_cobranca_whatsapp, ativo)
VALUES
  ('Caio Almeida', 'Diretor - proprietário', '5534997719779', 'caio', true, true),
  ('Conrado Finzi', 'TI & Produto', '5534997817660', 'conrado', true, true),
  ('Gabriel', 'Gestor de operações', '5534996916397', 'gabriel', true, true),
  ('Maria Eduarda (Duda)', 'Gerente de operações', '5534997066114', 'mariaeduarda33081262', true, true),
  ('Santana', 'Diretor de arte', '5516982447360', 'felipesantanamoraes', true, true),
  ('Éflen', 'Editor de Vídeo', '5534991531361', 'eflenhenrique1', true, true),
  ('Humberto', 'Gestor de Tráfego', '5534992223651', 'humberto', true, true),
  ('Carlos', 'Videomaker', '5534997690926', 'carlosrafael', true, true)
ON CONFLICT (telefone) DO UPDATE SET
  nome = EXCLUDED.nome,
  funcao = EXCLUDED.funcao,
  trello_username = EXCLUDED.trello_username,
  recebe_cobranca_whatsapp = EXCLUDED.recebe_cobranca_whatsapp,
  ativo = EXCLUDED.ativo,
  updated_at = now();
