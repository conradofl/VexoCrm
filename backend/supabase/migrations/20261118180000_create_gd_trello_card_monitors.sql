-- Migration: 20261118180000_create_gd_trello_card_monitors.sql
-- Tabela de monitoramento e régua de cobrança de cards do Trello (Geração Digital & Vexo OS)
-- Autonomia e Cobrança Condicional (D-2, D-1, D-0) gerenciada pela Heloísa / Átrio

CREATE TABLE IF NOT EXISTS public.gd_trello_card_monitors (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trello_card_id        text NOT NULL,
  trello_card_url       text,
  titulo                text NOT NULL,
  descricao             text,
  colaborador_nome      text NOT NULL,
  colaborador_telefone  text NOT NULL,
  due_date              timestamptz NOT NULL,
  aviso_criacao_enviado boolean DEFAULT false,
  cobranca_d2_enviada   boolean DEFAULT false,
  cobranca_d1_enviada   boolean DEFAULT false,
  cobranca_d0_enviada   boolean DEFAULT false,
  status_final          text DEFAULT 'aberto',
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  CONSTRAINT gd_trello_card_monitors_card_id_unique UNIQUE (trello_card_id)
);

CREATE INDEX IF NOT EXISTS idx_gd_trello_card_monitors_due_date ON public.gd_trello_card_monitors (due_date);
CREATE INDEX IF NOT EXISTS idx_gd_trello_card_monitors_colaborador ON public.gd_trello_card_monitors (colaborador_telefone);
CREATE INDEX IF NOT EXISTS idx_gd_trello_card_monitors_status ON public.gd_trello_card_monitors (status_final);

-- Gatilho de updated_at automático
CREATE OR REPLACE FUNCTION public.set_gd_trello_card_monitors_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gd_trello_card_monitors_updated_at ON public.gd_trello_card_monitors;
CREATE TRIGGER trg_gd_trello_card_monitors_updated_at
  BEFORE UPDATE ON public.gd_trello_card_monitors
  FOR EACH ROW
  EXECUTE FUNCTION public.set_gd_trello_card_monitors_updated_at();
