-- Concessão e desfecho de cada mensagem de lead que o agente de IA deveria responder.
--
-- Por quê (Container LED, 17/11/2026): o webhook responde 200 "buffering" à Evolution e processa a mensagem depois, em
-- memória (buffer de 3 s + chamada da IA). Um restart do contêiner nesse intervalo perdia a mensagem para sempre: a
-- Evolution não reenvia e ninguém olhava de novo. Com esta tabela:
--   - cada mensagem do lead ganha uma linha (status 'processando', dono = o processo, prazo);
--   - o desfecho fica gravado: 'respondida', 'descartada' (barrada por um portão: pausa humana, SDR, opt-out, campanha
--     Sem IA, agente desligado, freio, janela), 'falhou' (IA ou envio falhou depois das tentativas);
--   - a varredura de órfãs (services/agentInboundRecovery.js) pega o que ficou 'processando' com dono morto ou prazo
--     vencido, e o que 'falhou' com menos de 3 tentativas. A concessão é um INSERT ... ON CONFLICT condicional: duas
--     execuções nunca ficam com a mesma mensagem.
-- O código funciona sem esta tabela (concessão em memória, um processo só): o runner de migration pode estar travado.

CREATE TABLE IF NOT EXISTS public.agent_inbound_claims (
  client_id TEXT NOT NULL,
  msg_key TEXT NOT NULL,
  phone TEXT,
  status TEXT NOT NULL CHECK (status IN ('processando', 'respondida', 'descartada', 'falhou')),
  motivo TEXT,
  origem TEXT NOT NULL DEFAULT 'webhook' CHECK (origem IN ('webhook', 'varredura')),
  attempts INTEGER NOT NULL DEFAULT 1,
  owner TEXT,
  lease_until TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  total_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, msg_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_inbound_claims_status_updated
  ON public.agent_inbound_claims (status, updated_at);
