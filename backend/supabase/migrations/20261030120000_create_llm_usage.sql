-- Migration: 20261030120000_create_llm_usage.sql
-- Custo de IA por cliente. Ate 30/10/2026 a conversa rodava no plano gratuito da Groq e custo por cliente era zero; com
-- o Gemini como padrao, cada mensagem vira conta no cartao. Uma linha por chamada de LLM que DEU CERTO (HTTP 200).
--
-- So FATO do evento: provedor, modelo e tokens. Custo em reais NAO e gravado: preco de modelo muda e custo gravado hoje
-- vira mentira amanha. O preco e derivado e calculado na consulta.
-- Texto do prompt e da resposta NAO e gravado: e dado de cliente e nao serve para contar custo.
--
-- tentativas = chamadas feitas ate acertar, contando a que acertou (1 = primeiro degrau). Degrau que tomou 404/413/429
-- nao consome token faturavel e nao vira linha, mas entra nesta conta: e a medida do desperdicio da escada.
-- client_id nulo = chamador que ainda nao passa o tenant; o relatorio mostra quanto do custo esta sem dono.
--
-- DEPLOY: aplicar ANTES do codigo. O codigo tolera a tabela ausente (avisa e segue respondendo), mas sem ela nada e medido.
CREATE TABLE IF NOT EXISTS public.llm_usage (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         TEXT,
  origem            TEXT,
  phone             TEXT,
  provider          TEXT        NOT NULL,
  model             TEXT        NOT NULL,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  total_tokens      INTEGER,
  finish_reason     TEXT,
  latency_ms        INTEGER,
  tentativas        INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_client_created
  ON public.llm_usage (client_id, created_at);
