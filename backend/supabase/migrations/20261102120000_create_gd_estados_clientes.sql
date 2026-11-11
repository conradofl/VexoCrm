-- Tabela de estados do cliente da Geração Digital (frente "GD · Estados e painel do cliente").
-- Decisões do dono, 01-02/11/2026:
--   * gd_cliente_eventos é append-only e É a verdade. gd_clientes.estado_* é atalho, gravado só
--     por gd_registrar_evento(), na mesma transação do evento. Um trigger recusa qualquer outra
--     escrita nesses campos, então divergir exige derrubar o trigger.
--   * Dono do registro pela chave texto leads_clients.id ('geracao-digital'), nunca pelo uuid de
--     tenants.
--   * Os 21 clientes atuais entram com origem='importacao_inicial' e data_estimada=true; o portal
--     mostra "aproximado".
--   * Portal por token aleatório e revogável (só o hash fica no banco), nunca pelo nome.
--   * PAUSADO e ENCERRADO existem fora da linha principal.
--   * Prazo de cada etapa mora em gd_estados, não no código.
--   * ator_tipo distingue humano, GoClaw (credencial própria, na rota), sistema e importação.
-- Só cria objetos novos; não toca em nenhuma tabela existente.

-- ─── Configuração: estados e prazos ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gd_estados (
  codigo          text PRIMARY KEY,
  ordem           integer NOT NULL,
  fase            text NOT NULL CHECK (fase IN ('comercial', 'entrada', 'estrategia', 'regime', 'fora_da_linha')),
  rotulo_interno  text NOT NULL,
  rotulo_portal   text NOT NULL,
  -- Prazo para SAIR deste estado. Três regras:
  --   horas_corridas / horas_uteis: prazo_horas contadas a partir de estado_desde
  --                                 (prazo_horas NULL = sem prazo: ATIVO, PAUSADO, ENCERRADO);
  --   fim_do_dia_util:              até o fim do dia útil em que entrou no estado, sem horas
  --                                 (ASSINADO, "mesmo dia"). O cálculo é do Síndico.
  prazo_horas     integer CHECK (prazo_horas IS NULL OR prazo_horas > 0),
  prazo_contagem  text NOT NULL DEFAULT 'horas_corridas'
                  CHECK (prazo_contagem IN ('horas_corridas', 'horas_uteis', 'fim_do_dia_util')),
  terminal        boolean NOT NULL DEFAULT false,
  ativo           boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gd_estados_fim_do_dia_sem_horas
    CHECK (prazo_contagem <> 'fim_do_dia_util' OR prazo_horas IS NULL)
);

-- Prazos da tabela "05 — Prazos" do MAQUINA-DE-ENTRADA-GD.md (31/10/2026). Editáveis aqui;
-- ON CONFLICT DO NOTHING para nunca sobrescrever prazo ajustado depois.
INSERT INTO public.gd_estados (codigo, ordem, fase, rotulo_interno, rotulo_portal, prazo_horas, prazo_contagem, terminal) VALUES
  ('PROPOSTA_ENVIADA',            10, 'comercial',     'Proposta enviada',                  'Proposta enviada',            168, 'horas_corridas', false),
  ('PROPOSTA_ACEITA',             20, 'comercial',     'Proposta aceita, gerar contrato',   'Proposta aceita',               4, 'horas_uteis', false),
  ('CONTRATO_EM_REVISAO',         30, 'comercial',     'Contrato no jurídico',              'Contrato em preparação',        4, 'horas_uteis', false),
  ('AGUARDANDO_ASSINATURA_CAIO',  40, 'comercial',     'Aguardando assinatura do Caio',     'Contrato em assinatura',       24, 'horas_corridas', false),
  ('AGUARDANDO_ASSINATURA_CLIENTE',50,'comercial',     'Aguardando assinatura do cliente',  'Aguardando sua assinatura',    72, 'horas_corridas', false),
  ('ASSINADO',                    60, 'entrada',       'Assinado, criar pastas e grupos',   'Contrato assinado',          NULL, 'fim_do_dia_util', false),
  ('GRUPOS_CRIADOS',              70, 'entrada',       'Grupos criados, agendar briefing',  'Agendando briefing',           24, 'horas_corridas', false),
  ('BRIEFING_AGENDADO',           80, 'entrada',       'Briefing agendado',                 'Briefing agendado',            72, 'horas_corridas', false),
  ('BRIEFING_REALIZADO',          90, 'estrategia',    'Reunião feita, gerar briefing',     'Montando seu briefing',        48, 'horas_corridas', false),
  ('BRIEFING_APROVACAO_INTERNA', 100, 'estrategia',    'Briefing com o Caio',               'Montando seu briefing',        24, 'horas_corridas', false),
  ('BRIEFING_APROVACAO_CLIENTE', 110, 'estrategia',    'Briefing com o cliente',            'Aguardando sua aprovação',     72, 'horas_corridas', false),
  ('IDENTIDADE_VISUAL',          120, 'estrategia',    'Identidade visual',                 'Identidade visual',            48, 'horas_corridas', false),
  ('ROTEIRO',                    130, 'estrategia',    'Roteiro (aprovação interna)',       'Planejamento em produção',     72, 'horas_corridas', false),
  ('PLANEJAMENTO_APROVACAO',     140, 'estrategia',    'Planejamento para aprovar',         'Aguardando sua aprovação',     48, 'horas_corridas', false),
  ('ESTRATEGIA_APROVADA',        150, 'regime',        'Estratégia aprovada',               'Estratégia aprovada',        NULL, 'horas_corridas', false),
  ('ATIVO',                      160, 'regime',        'Cliente ativo',                     'Em andamento',               NULL, 'horas_corridas', false),
  ('PAUSADO',                    900, 'fora_da_linha', 'Pausado',                           'Pausado',                    NULL, 'horas_corridas', false),
  ('ENCERRADO',                  990, 'fora_da_linha', 'Encerrado',                         'Encerrado',                  NULL, 'horas_corridas', true)
ON CONFLICT (codigo) DO NOTHING;

-- ─── Clientes ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gd_clientes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dono_client_id        text NOT NULL REFERENCES public.leads_clients (id),
  nome                  text NOT NULL,
  cnpj                  text,
  -- Tenant do próprio cliente no Vexo, quando ele tiver um (login no portal, disparo).
  cliente_client_id     text REFERENCES public.leads_clients (id),
  proposal_id           uuid,
  contract_id           uuid,
  origem                text NOT NULL CHECK (origem IN ('fluxo', 'importacao_inicial')),
  -- Atalho do último evento. Escrito só por gd_registrar_evento() (trigger abaixo).
  estado_atual          text REFERENCES public.gd_estados (codigo),
  estado_desde          timestamptz,
  estado_data_estimada  boolean,
  ultimo_evento_id      uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dono_client_id, nome)
);

CREATE INDEX IF NOT EXISTS idx_gd_clientes_dono_estado ON public.gd_clientes (dono_client_id, estado_atual);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gd_clientes_dono_cnpj
  ON public.gd_clientes (dono_client_id, cnpj) WHERE cnpj IS NOT NULL;

-- ─── Eventos: append-only, a verdade ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gd_cliente_eventos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq            bigserial NOT NULL UNIQUE,
  cliente_id     uuid NOT NULL REFERENCES public.gd_clientes (id) ON DELETE RESTRICT,
  -- Sem estado_de (decisão do dono, 02/11/2026): o estado anterior é o estado_para do evento
  -- anterior na linha do tempo (ocorrido_em, seq). Gravá-lo mentiria num evento retroativo.
  estado_para    text NOT NULL REFERENCES public.gd_estados (codigo),
  -- Quando aconteceu de fato; registrado_em é quando entrou no banco.
  ocorrido_em    timestamptz NOT NULL,
  registrado_em  timestamptz NOT NULL DEFAULT now(),
  data_estimada  boolean NOT NULL DEFAULT false,
  origem         text NOT NULL CHECK (origem IN ('fluxo', 'importacao_inicial', 'correcao')),
  ator_tipo      text NOT NULL CHECK (ator_tipo IN ('humano', 'goclaw', 'sistema', 'importacao')),
  ator_id        text NOT NULL,
  motivo         text,
  dados          jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_gd_cliente_eventos_linha ON public.gd_cliente_eventos (cliente_id, ocorrido_em, seq);

CREATE OR REPLACE FUNCTION public.gd_cliente_eventos_somente_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'gd_cliente_eventos é append-only: % recusado. Corrija com um evento novo de origem correcao.', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_gd_cliente_eventos_somente_insert ON public.gd_cliente_eventos;
CREATE TRIGGER trg_gd_cliente_eventos_somente_insert
  BEFORE UPDATE OR DELETE ON public.gd_cliente_eventos
  FOR EACH ROW EXECUTE FUNCTION public.gd_cliente_eventos_somente_insert();

DROP TRIGGER IF EXISTS trg_gd_cliente_eventos_sem_truncate ON public.gd_cliente_eventos;
CREATE TRIGGER trg_gd_cliente_eventos_sem_truncate
  BEFORE TRUNCATE ON public.gd_cliente_eventos
  FOR EACH STATEMENT EXECUTE FUNCTION public.gd_cliente_eventos_somente_insert();

-- ─── Trava do atalho: estado_* só muda por dentro de gd_registrar_evento() ──────
CREATE OR REPLACE FUNCTION public.gd_clientes_trava_estado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('gd.via_evento', true) IS DISTINCT FROM '1' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.estado_atual IS NOT NULL OR NEW.estado_desde IS NOT NULL
         OR NEW.estado_data_estimada IS NOT NULL OR NEW.ultimo_evento_id IS NOT NULL THEN
        RAISE EXCEPTION 'gd_clientes nasce sem estado; o primeiro estado vem de gd_registrar_evento()';
      END IF;
    ELSIF NEW.estado_atual IS DISTINCT FROM OLD.estado_atual
       OR NEW.estado_desde IS DISTINCT FROM OLD.estado_desde
       OR NEW.estado_data_estimada IS DISTINCT FROM OLD.estado_data_estimada
       OR NEW.ultimo_evento_id IS DISTINCT FROM OLD.ultimo_evento_id THEN
      RAISE EXCEPTION 'estado de gd_clientes só muda por gd_registrar_evento()';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gd_clientes_trava_estado ON public.gd_clientes;
CREATE TRIGGER trg_gd_clientes_trava_estado
  BEFORE INSERT OR UPDATE ON public.gd_clientes
  FOR EACH ROW EXECUTE FUNCTION public.gd_clientes_trava_estado();

-- ─── A única porta de escrita do estado ─────────────────────────────────────────
-- Grava o evento e recalcula o atalho a partir da tabela de eventos (último por ocorrido_em,
-- desempate por seq), na mesma transação. Recalcular em vez de copiar o evento novo faz um
-- evento retroativo (importação, correção) não virar estado atual por engano.
CREATE OR REPLACE FUNCTION public.gd_registrar_evento(
  p_cliente_id    uuid,
  p_estado_para   text,
  p_ocorrido_em   timestamptz,
  p_data_estimada boolean,
  p_origem        text,
  p_ator_tipo     text,
  p_ator_id       text,
  p_motivo        text DEFAULT NULL,
  p_dados         jsonb DEFAULT '{}'::jsonb
) RETURNS public.gd_cliente_eventos
LANGUAGE plpgsql AS $$
DECLARE
  v_cliente public.gd_clientes;
  v_evento  public.gd_cliente_eventos;
  v_ultimo  public.gd_cliente_eventos;
BEGIN
  SELECT * INTO v_cliente FROM public.gd_clientes WHERE id = p_cliente_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'gd_cliente % não existe', p_cliente_id;
  END IF;

  INSERT INTO public.gd_cliente_eventos
    (cliente_id, estado_para, ocorrido_em, data_estimada, origem, ator_tipo, ator_id, motivo, dados)
  VALUES
    (p_cliente_id, p_estado_para, p_ocorrido_em, COALESCE(p_data_estimada, false),
     p_origem, p_ator_tipo, p_ator_id, p_motivo, COALESCE(p_dados, '{}'::jsonb))
  RETURNING * INTO v_evento;

  SELECT * INTO v_ultimo FROM public.gd_cliente_eventos
   WHERE cliente_id = p_cliente_id
   ORDER BY ocorrido_em DESC, seq DESC
   LIMIT 1;

  PERFORM set_config('gd.via_evento', '1', true);
  UPDATE public.gd_clientes
     SET estado_atual = v_ultimo.estado_para,
         estado_desde = v_ultimo.ocorrido_em,
         estado_data_estimada = v_ultimo.data_estimada,
         ultimo_evento_id = v_ultimo.id
   WHERE id = p_cliente_id;
  PERFORM set_config('gd.via_evento', '', true);

  RETURN v_evento;
END;
$$;

-- ─── Portal: token aleatório e revogável ────────────────────────────────────────
-- O token (32 bytes aleatórios, base64url) é gerado na aplicação e mostrado uma vez; aqui só
-- fica o sha256 dele. Revogar = preencher revogado_em. No máximo um token ativo por cliente.
CREATE TABLE IF NOT EXISTS public.gd_cliente_portal_tokens (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id        uuid NOT NULL REFERENCES public.gd_clientes (id) ON DELETE CASCADE,
  token_sha256      text NOT NULL UNIQUE CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  criado_em         timestamptz NOT NULL DEFAULT now(),
  criado_por        text NOT NULL,
  revogado_em       timestamptz,
  revogado_por      text,
  ultimo_acesso_em  timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gd_portal_token_ativo
  ON public.gd_cliente_portal_tokens (cliente_id) WHERE revogado_em IS NULL;
