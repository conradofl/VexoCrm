-- Opt-out: fonte única em public.lead_optouts, por empresa e telefone canônico.
--
-- A tabela já existe em produção (id, client_id, phone, optout_at, reason), criada fora das migrations, e foi medida VAZIA em
-- 29/10, 11/11 e 12/11/2026. Esta migration a cria onde não existir, acrescenta o que falta e é idempotente.
--
-- leads.opt_out e leads.metadata.opt_out passam a ser só espelho para a tela; a decisão de envio lê esta tabela.
-- A expressão de telefone canônico abaixo é a mesma de backend/src/services/canonicalPhone.js (SQL_CANONICAL_PHONE).

CREATE TABLE IF NOT EXISTS public.lead_optouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL,
  phone text NOT NULL,
  optout_at timestamptz NOT NULL DEFAULT now(),
  reason text
);

ALTER TABLE public.lead_optouts ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.lead_optouts ALTER COLUMN optout_at SET DEFAULT now();

-- origem: manual (interruptor da tela), palavra, sem_interesse (captura na mensagem do lead), migracao (marca antiga do lead)
ALTER TABLE public.lead_optouts ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE public.lead_optouts ADD COLUMN IF NOT EXISTS created_by text;
ALTER TABLE public.lead_optouts ADD COLUMN IF NOT EXISTS wa_message_id text;
ALTER TABLE public.lead_optouts ADD COLUMN IF NOT EXISTS message_text text;
-- revogar não apaga: a linha fica, com a data e quem revogou
ALTER TABLE public.lead_optouts ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE public.lead_optouts ADD COLUMN IF NOT EXISTS revoked_by text;

-- Linhas que já existirem passam para a grafia canônica; repetidas do mesmo número ficam só com a mais antiga ativa.
UPDATE public.lead_optouts o
   SET phone = CASE WHEN o.phone LIKE '%@g.us' OR o.phone LIKE '%@lid' THEN o.phone WHEN length(regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g')) = 12 AND regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g') ~ '^55[1-9]{2}[6-9]' THEN '55' || substr(regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g'), 3, 2) || '9' || substr(regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g'), 5) WHEN length(regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g')) = 10 AND regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g') ~ '^[1-9]{2}[6-9]' THEN '55' || substr(regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g'), 1, 2) || '9' || substr(regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g'), 3) WHEN length(regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g')) = 10 AND regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g') ~ '^[1-9]{2}[2-5]' THEN '55' || regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g') WHEN length(regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g')) = 11 AND regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g') ~ '^[1-9]{2}9' THEN '55' || regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g') ELSE regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g') END
 WHERE o.phone IS DISTINCT FROM CASE WHEN o.phone LIKE '%@g.us' OR o.phone LIKE '%@lid' THEN o.phone WHEN length(regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g')) = 12 AND regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g') ~ '^55[1-9]{2}[6-9]' THEN '55' || substr(regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g'), 3, 2) || '9' || substr(regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g'), 5) WHEN length(regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g')) = 10 AND regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g') ~ '^[1-9]{2}[6-9]' THEN '55' || substr(regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g'), 1, 2) || '9' || substr(regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g'), 3) WHEN length(regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g')) = 10 AND regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g') ~ '^[1-9]{2}[2-5]' THEN '55' || regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g') WHEN length(regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g')) = 11 AND regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g') ~ '^[1-9]{2}9' THEN '55' || regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g') ELSE regexp_replace(regexp_replace(o.phone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g') END;

UPDATE public.lead_optouts o
   SET revoked_at = now(), revoked_by = 'migration:duplicada'
 WHERE o.revoked_at IS NULL
   AND EXISTS (
     SELECT 1 FROM public.lead_optouts older
      WHERE older.client_id = o.client_id AND older.phone = o.phone AND older.revoked_at IS NULL
        AND (older.optout_at, older.id) < (o.optout_at, o.id)
   );

-- Um pedido ATIVO por empresa e número. Revogado sai do índice, e um pedido novo depois cria outra linha.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_optouts_ativo
  ON public.lead_optouts (client_id, phone)
  WHERE revoked_at IS NULL;

-- Quem estava marcado só no lead (interruptor antigo) entra na tabela. Medido em 12/11/2026: 3 leads, todos em bia-do-spazio.
INSERT INTO public.lead_optouts (client_id, phone, source, reason)
SELECT DISTINCT m.client_id, m.phone, 'migracao', 'Marcado no lead antes da fonte única'
  FROM (
    SELECT l.client_id, CASE WHEN l.telefone LIKE '%@g.us' OR l.telefone LIKE '%@lid' THEN l.telefone WHEN length(regexp_replace(regexp_replace(l.telefone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g')) = 12 AND regexp_replace(regexp_replace(l.telefone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g') ~ '^55[1-9]{2}[6-9]' THEN '55' || substr(regexp_replace(regexp_replace(l.telefone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g'), 3, 2) || '9' || substr(regexp_replace(regexp_replace(l.telefone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g'), 5) WHEN length(regexp_replace(regexp_replace(l.telefone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g')) = 10 AND regexp_replace(regexp_replace(l.telefone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g') ~ '^[1-9]{2}[6-9]' THEN '55' || substr(regexp_replace(regexp_replace(l.telefone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g'), 1, 2) || '9' || substr(regexp_replace(regexp_replace(l.telefone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g'), 3) WHEN length(regexp_replace(regexp_replace(l.telefone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g')) = 10 AND regexp_replace(regexp_replace(l.telefone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g') ~ '^[1-9]{2}[2-5]' THEN '55' || regexp_replace(regexp_replace(l.telefone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g') WHEN length(regexp_replace(regexp_replace(l.telefone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g')) = 11 AND regexp_replace(regexp_replace(l.telefone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g') ~ '^[1-9]{2}9' THEN '55' || regexp_replace(regexp_replace(l.telefone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g') ELSE regexp_replace(regexp_replace(l.telefone, '@(s\.whatsapp\.net|c\.us)$', '', 'i'), '\D', '', 'g') END AS phone
      FROM public.leads l
     WHERE (l.opt_out IS TRUE OR l.metadata->>'opt_out' = 'true' OR l.dados->>'opt_out' = 'true')
       AND l.telefone IS NOT NULL AND l.telefone <> ''
  ) m
 WHERE m.phone <> '' AND m.phone NOT LIKE '%@%'
ON CONFLICT (client_id, phone) WHERE revoked_at IS NULL DO NOTHING;
