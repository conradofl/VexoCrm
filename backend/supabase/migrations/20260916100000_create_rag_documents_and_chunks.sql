-- Base de Conhecimento RAG (Leva 2, Commit 1): documentos e trechos.
--
-- embedding é JSONB, não pgvector — o banco não tem a extensão instalada, e
-- nesta escala não precisa: base de empresa dá alguns milhares de trechos, e
-- comparar isso na memória (cosine similarity em JS) leva décimos de segundo.
-- Se algum tenant passar de ~20 mil trechos, aí sim migrar pra pgvector — o
-- único ponto que muda é o formato de armazenamento da coluna embedding,
-- nada do resto do pipeline (fatiamento, busca, prompt) depende do formato.

CREATE TABLE IF NOT EXISTS public.rag_documents (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       TEXT        NOT NULL,
  company_id      UUID        NULL REFERENCES public.followup_companies(id) ON DELETE CASCADE,
  filename        TEXT        NOT NULL,
  mime_type       TEXT        NOT NULL,
  size_bytes      INTEGER     NOT NULL,
  storage_key     TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  error_log       TEXT        NULL,
  chunk_count     INTEGER     NOT NULL DEFAULT 0,
  -- Procedência do vetor: sem isso, trocar de provedor/modelo (ou a cota do
  -- Gemini estourar e alguém cair pro lexical) faz a busca comparar vetores de
  -- espaços diferentes silenciosamente — 768 dimensões contra 256, ou dois
  -- modelos Gemini diferentes — e o sintoma vira "o RAG não funciona", sem
  -- erro, sem log. embedding_dim é redundante com o que dá pra inferir do
  -- vetor, mas guardado explícito: permite auditar/filtrar sem reabrir JSONB.
  embedding_provider TEXT     NULL,
  embedding_model    TEXT     NULL,
  embedding_dim      INTEGER  NULL,
  created_by_uid  TEXT        NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rag_documents_client
  ON public.rag_documents (client_id);
CREATE INDEX IF NOT EXISTS idx_rag_documents_company
  ON public.rag_documents (company_id);

CREATE TABLE IF NOT EXISTS public.rag_chunks (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID        NOT NULL REFERENCES public.rag_documents(id) ON DELETE CASCADE,
  client_id   TEXT        NOT NULL,
  ordinal     INTEGER     NOT NULL,
  content     TEXT        NOT NULL,
  embedding   JSONB       NULL,
  char_count  INTEGER     NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- (client_id, document_id): filtro de isolamento de tenant na busca semântica —
-- é a query mais quente do módulo e a que nunca pode vazar entre tenants.
CREATE INDEX IF NOT EXISTS idx_rag_chunks_client_document
  ON public.rag_chunks (client_id, document_id);
-- (document_id, ordinal): releitura ordenada dos trechos de um documento
-- (reprocessar, exibir, apagar em ordem).
CREATE INDEX IF NOT EXISTS idx_rag_chunks_document_ordinal
  ON public.rag_chunks (document_id, ordinal);
