-- Diário do chip: cada queda e cada volta de conexão de uma instância Evolution, com o motivo e o que o sistema enviou
-- pelo chip antes da queda.
--
-- Por quê (Nous, 17/11/2026): quatro chips caíram e o Vexo não tinha como dizer quando nem por quê. A Evolution v2
-- guarda no cadastro da instância a última queda (disconnectionReasonCode, disconnectionAt, disconnectionObject); o
-- Vexo passa a ler isso periodicamente (services/chipDiary.js) e a gravar aqui. Leitura de produção em 17/11 14:14Z:
-- os quatro chips caídos tinham código 401, "conflict / device_removed".
--
-- instance_id é TEXT de propósito: o id do chip já foi uuid e text em tabelas diferentes, e comparar uuid com text
-- derrubou produção em 05/10/2026 (commit d657449). Toda comparação aqui é feita em ::text.

CREATE TABLE IF NOT EXISTS public.evolution_instance_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  instance_id TEXT,
  instance_name TEXT NOT NULL,
  chip_name TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('queda', 'conectado')),
  occurred_at TIMESTAMPTZ NOT NULL,
  occurred_at_approx BOOLEAN NOT NULL DEFAULT false,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason_code INTEGER,
  reason_kind TEXT,
  reason_label TEXT,
  reason_detail JSONB,
  snapshot JSONB,
  source TEXT NOT NULL DEFAULT 'evolution_fetch'
);

-- A mesma queda lida em vários ciclos grava uma vez só.
CREATE UNIQUE INDEX IF NOT EXISTS uq_evolution_instance_events_instance_kind_at
  ON public.evolution_instance_events (instance_name, kind, occurred_at);

CREATE INDEX IF NOT EXISTS idx_evolution_instance_events_client_at
  ON public.evolution_instance_events (client_id, occurred_at DESC);
