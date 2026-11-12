-- Biblioteca de áudios (Fases 1 e 2): áudios gravados pelo próprio cliente,
-- reutilizáveis no follow-up e, depois, pelo agente de atendimento.
--
-- Tudo aqui é aditivo e idempotente: tabela nova, tabela de ligação nova e uma
-- coluna NULL em followup_templates. Código antigo roda igual com este schema
-- (não lê nada disto); código novo com schema antigo falha só nas rotas novas
-- e no passo de follow-up que apontar para a biblioteca — que não existe antes
-- desta migration.
--
-- Limites de produto (5 MB, 3 minutos, "quando usar" com até 140 caracteres)
-- ficam TAMBÉM no banco: a rota valida e explica, o CHECK garante que nenhum
-- outro caminho de escrita grava fora do limite.
--
-- Apagar = arquivar (archived_at). A linha e o arquivo ficam: passo de
-- follow-up e mensagem já enviada continuam apontando para algo que existe.

CREATE TABLE IF NOT EXISTS public.audio_library (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        TEXT          NOT NULL,
  name             TEXT          NOT NULL
                   CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  when_to_use      TEXT          NULL
                   CHECK (when_to_use IS NULL OR char_length(when_to_use) <= 140),
  storage_key      TEXT          NOT NULL,
  mime_type        TEXT          NOT NULL,
  size_bytes       INTEGER       NOT NULL
                   CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  duration_seconds NUMERIC(6,2)  NOT NULL
                   CHECK (duration_seconds > 0 AND duration_seconds <= 180),
  created_by_uid   TEXT          NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  archived_at      TIMESTAMPTZ   NULL
);

CREATE INDEX IF NOT EXISTS idx_audio_library_client_active
  ON public.audio_library (client_id, created_at DESC)
  WHERE archived_at IS NULL;

-- Quais agentes podem usar cada áudio na conversa (Fase 3). Tabela de ligação,
-- não jsonb: a chave estrangeira impede ligação com agente que não existe e
-- apaga a ligação junto com o agente. client_id repetido aqui para toda
-- consulta filtrar por tenant sem depender de JOIN.
CREATE TABLE IF NOT EXISTS public.audio_library_agents (
  audio_id    UUID         NOT NULL REFERENCES public.audio_library(id) ON DELETE CASCADE,
  company_id  UUID         NOT NULL REFERENCES public.followup_companies(id) ON DELETE CASCADE,
  client_id   TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (audio_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_audio_library_agents_company
  ON public.audio_library_agents (company_id);

-- Fase 2: o passo de follow-up aponta para um áudio da biblioteca. Sem ON
-- DELETE: áudio nunca é apagado (só arquivado), então a referência não fica
-- órfã; se alguém tentar DELETE na mão, o banco recusa em vez de quebrar o passo.
ALTER TABLE public.followup_templates
  ADD COLUMN IF NOT EXISTS audio_library_id UUID NULL REFERENCES public.audio_library(id);

CREATE INDEX IF NOT EXISTS idx_followup_templates_audio_library
  ON public.followup_templates (audio_library_id)
  WHERE audio_library_id IS NOT NULL;
