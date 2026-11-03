-- Dados operacionais do cliente da Geração Digital (03/11/2026), pedidos para a importação dos
-- clientes ativos. O GoClaw cobra o briefing no WhatsApp do aprovador e põe arquivo na pasta do
-- Drive do cliente; escopo diz quais frentes o cliente contratou.
--
-- Nenhuma coluna é obrigatória: cliente do funil nasce sem esses dados. As travas abaixo recusam
-- no banco o valor que levaria o GoClaw para o lugar errado, não a ausência dele.

ALTER TABLE public.gd_clientes
  ADD COLUMN IF NOT EXISTS aprovador_nome     text,
  -- Só dígitos, sempre com o DDI 55: é o formato em que o número é discado.
  ADD COLUMN IF NOT EXISTS aprovador_telefone text,
  ADD COLUMN IF NOT EXISTS drive_url          text,
  -- Lista de códigos: google, social, linkedin, meta, consultoria, eventos, vexo.
  ADD COLUMN IF NOT EXISTS escopo             jsonb,
  -- O escopo como veio, em texto livre. Os códigos perdem informação real: "Vexo disparo
  -- (dezembro)" ainda não começou, "LinkedIn (Criar)" é perfil que não existe.
  ADD COLUMN IF NOT EXISTS escopo_original    text,
  -- CNPJ gravado mas não confirmado. É coluna, não dado de evento: o evento é append-only e a
  -- pendência precisa poder ser desligada quando o CNPJ for confirmado.
  ADD COLUMN IF NOT EXISTS cnpj_a_confirmar   boolean NOT NULL DEFAULT false;

-- DDD nunca começa com 0: isso também recusa o "5500..." do telefone fabricado na importação de leads.
ALTER TABLE public.gd_clientes DROP CONSTRAINT IF EXISTS gd_clientes_telefone_55;
ALTER TABLE public.gd_clientes ADD CONSTRAINT gd_clientes_telefone_55
  CHECK (aprovador_telefone IS NULL OR aprovador_telefone ~ '^55[1-9][0-9]{9,10}$');

-- "/u/0/" é "a primeira conta logada neste navegador": abre a pasta certa só para quem copiou o link.
ALTER TABLE public.gd_clientes DROP CONSTRAINT IF EXISTS gd_clientes_drive_url;
ALTER TABLE public.gd_clientes ADD CONSTRAINT gd_clientes_drive_url
  CHECK (drive_url IS NULL OR (drive_url ~ '^https://' AND drive_url NOT LIKE '%/u/0/%'));

ALTER TABLE public.gd_clientes DROP CONSTRAINT IF EXISTS gd_clientes_escopo;
ALTER TABLE public.gd_clientes ADD CONSTRAINT gd_clientes_escopo
  CHECK (escopo IS NULL OR (
    jsonb_typeof(escopo) = 'array'
    AND escopo <@ '["google","social","linkedin","meta","consultoria","eventos","vexo"]'::jsonb
  ));

ALTER TABLE public.gd_clientes DROP CONSTRAINT IF EXISTS gd_clientes_cnpj_a_confirmar;
ALTER TABLE public.gd_clientes ADD CONSTRAINT gd_clientes_cnpj_a_confirmar
  CHECK (NOT cnpj_a_confirmar OR cnpj IS NOT NULL);

COMMENT ON COLUMN public.gd_clientes.origem IS
  'importacao_inicial: cliente que já existia quando começamos a medir (carga inicial), não cliente que entrou hoje.';
COMMENT ON COLUMN public.gd_cliente_eventos.origem IS
  'importacao_inicial: estado conhecido quando começamos a medir, não a data em que o cliente entrou nele. '
  'Nesses eventos ocorrido_em é a data da importação e data_estimada = true.';
