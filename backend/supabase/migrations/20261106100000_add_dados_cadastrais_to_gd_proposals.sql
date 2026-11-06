-- Adiciona dados_cadastrais JSONB em public.gd_proposals para salvar o cadastro completo no aceite da proposta.
ALTER TABLE public.gd_proposals
  ADD COLUMN IF NOT EXISTS dados_cadastrais JSONB;

