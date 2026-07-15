-- Tabelas do módulo de Contratos GD (gd_contracts / gd_contract_templates).
-- As rotas/handlers existiam mas a migration nunca foi criada — por isso o
-- endpoint GET /api/gd/contracts respondia 500 ("relation does not exist").
-- Idempotente e não-destrutivo. Schema derivado do uso real nos handlers:
--   listContracts / createContract / updateContract / generateContractPdf /
--   webhook ZapSign.

CREATE TABLE IF NOT EXISTS public.gd_contract_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nome text,
  conteudo text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.gd_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  proposal_id uuid,
  dados jsonb,
  status text NOT NULL DEFAULT 'rascunho',
  provider_id text,
  provider_name text,
  sign_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gd_contracts_tenant ON public.gd_contracts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_gd_contracts_proposal ON public.gd_contracts (proposal_id);
CREATE INDEX IF NOT EXISTS idx_gd_contracts_provider ON public.gd_contracts (provider_id);
CREATE INDEX IF NOT EXISTS idx_gd_contract_templates_tenant ON public.gd_contract_templates (tenant_id);

-- Template padrão por tenant (só onde ainda não existe nenhum) para o PDF/merge
-- funcionar de imediato. Campos de merge no formato {{campo}}.
INSERT INTO public.gd_contract_templates (tenant_id, nome, conteudo, ativo)
SELECT t.id, 'Contrato Padrão de Prestação de Serviços',
$tpl$CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE MARKETING DIGITAL

Pelo presente instrumento particular, de um lado {{razao_social}}, doravante denominada CONTRATANTE, e de outro lado a CONTRATADA, têm entre si justo e contratado o seguinte:

Cláusula 1 - DO OBJETO
O presente contrato tem por objeto a prestação dos serviços descritos na proposta comercial aceita pela CONTRATANTE.

Cláusula 2 - DO VALOR E FORMA DE PAGAMENTO
Os valores e condições de pagamento são os constantes na proposta comercial aceita.

Cláusula 3 - DO PRAZO
O presente contrato vigora conforme o período contratado na proposta.

E por estarem assim justos e contratados, firmam o presente em via eletrônica.

{{data_extenso}}$tpl$,
       true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.gd_contract_templates ct WHERE ct.tenant_id = t.id
);
