-- Propostas passam a guardar o próprio segmento e logo do prospect, para que
-- "Iniciar Apresentação" a partir de uma proposta consiga puxar segmento e
-- imagem mesmo quando a proposta foi criada pelo wizard (sem gd_presentation
-- vinculada). O GET faz COALESCE com os campos da apresentação vinculada.
-- Idempotente e não-destrutivo.
ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS segment_id TEXT;
ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS prospect_logo TEXT;
