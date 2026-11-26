-- DDL que domains/geracaoDigitalRoutes.js (ensureGdTablesAndSeeds) rodava a CADA boot vira migration (untangle, lote 5,
-- 26/11/2026). Mesmos comandos, na mesma ordem. Cada um num bloco que registra e segue (como o .catch do código fazia):
-- uma migration que falha derruba o boot. Em produção tudo já existe (o código criou): no-op.
-- Inclui a conversão de tenant_id para text (com DROP da FK) que o código fazia; em produção já é text.
-- Não insere, não altera nem apaga dado: os seeds (INSERT ... ON CONFLICT DO NOTHING) continuam no código.

DO $gd$ BEGIN
  CREATE TABLE IF NOT EXISTS public.leads_clients (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$CREATE TABLE IF NOT EXISTS public.leads_clients (
          $q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  CREATE TABLE IF NOT EXISTS public.lead_client_n8n_settings (
            client_id TEXT PRIMARY KEY REFERENCES public.leads_clients(id) ON DELETE CASCADE,
            dispatch_webhook_url TEXT,
            dispatch_webhook_token TEXT,
            inbound_bearer_token TEXT,
            active BOOLEAN DEFAULT true,
            chatbot_enabled BOOLEAN DEFAULT false,
            chatbot_model TEXT,
            chatbot_llm_model TEXT,
            agent_name TEXT,
            persona_template TEXT,
            segmentation_config JSONB DEFAULT '{}'::jsonb,
            sdr_whatsapp_number TEXT,
            allowed_tabs JSONB DEFAULT '[]'::jsonb,
            updated_at TIMESTAMPTZ DEFAULT now(),
            updated_by_uid TEXT,
            updated_by_email TEXT
          );
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$CREATE TABLE IF NOT EXISTS public.lead_client_n8n_settings ($q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.lead_client_n8n_settings ADD COLUMN IF NOT EXISTS agent_name TEXT;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.lead_client_n8n_settings ADD COLUMN IF NO$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.lead_client_n8n_settings ADD COLUMN IF NOT EXISTS plan_tier TEXT DEFAULT 'essencial';
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.lead_client_n8n_settings ADD COLUMN IF NO$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.lead_client_n8n_settings ADD COLUMN IF NOT EXISTS modulos_avulsos JSONB DEFAULT '[]'::jsonb;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.lead_client_n8n_settings ADD COLUMN IF NO$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.lead_client_n8n_settings ADD COLUMN IF NOT EXISTS degustacao_expira_em TIMESTAMPTZ;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.lead_client_n8n_settings ADD COLUMN IF NO$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  CREATE TABLE IF NOT EXISTS public.lead_conversations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
            lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
            telefone TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$CREATE TABLE IF NOT EXISTS public.lead_conversations (
     $q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  CREATE TABLE IF NOT EXISTS public.lead_messages (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
            lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
            direction TEXT NOT NULL DEFAULT 'inbound',
            sender_type TEXT,
            text_content TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$CREATE TABLE IF NOT EXISTS public.lead_messages (
          $q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  CREATE TABLE IF NOT EXISTS public.tenants (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$CREATE TABLE IF NOT EXISTS public.tenants (
          id UUI$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  CREATE TABLE IF NOT EXISTS public.geracao_digital_briefings (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            prospect_name TEXT,
            whatsapp_number TEXT,
            theme_preset TEXT,
            briefing_data JSONB DEFAULT '{}'::jsonb,
            status TEXT DEFAULT 'pendente',
            slack_status TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$CREATE TABLE IF NOT EXISTS public.geracao_digital_briefings $q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  CREATE TABLE IF NOT EXISTS public.gd_segments (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id TEXT NOT NULL DEFAULT 'geracao-digital',
            nome TEXT NOT NULL,
            faturamento_min NUMERIC NOT NULL DEFAULT 50000,
            ativo BOOLEAN NOT NULL DEFAULT true
          );
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$CREATE TABLE IF NOT EXISTS public.gd_segments (
          id$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_segments DROP CONSTRAINT IF EXISTS gd_segments_tenant_id_fkey;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_segments DROP CONSTRAINT IF EXISTS gd_$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_segments ALTER COLUMN tenant_id TYPE text USING tenant_id::text;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_segments ALTER COLUMN tenant_id TYPE t$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  CREATE TABLE IF NOT EXISTS public.gd_products (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id TEXT NOT NULL DEFAULT 'geracao-digital',
            nome TEXT NOT NULL,
            descricao TEXT,
            categoria TEXT NOT NULL DEFAULT 'gd',
            valor_padrao NUMERIC NOT NULL DEFAULT 0,
            valor_vp NUMERIC DEFAULT 0,
            recorrencia TEXT NOT NULL DEFAULT 'mensal',
            ativo BOOLEAN NOT NULL DEFAULT true
          );
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$CREATE TABLE IF NOT EXISTS public.gd_products (
          id$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_products DROP CONSTRAINT IF EXISTS gd_products_tenant_id_fkey;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_products DROP CONSTRAINT IF EXISTS gd_$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_products ALTER COLUMN tenant_id TYPE text USING tenant_id::text;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_products ALTER COLUMN tenant_id TYPE t$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  CREATE TABLE IF NOT EXISTS public.gd_presentations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id TEXT NOT NULL DEFAULT 'geracao-digital',
            prospect_name TEXT,
            prospect_logo TEXT,
            segment_id UUID,
            venda_casada BOOLEAN NOT NULL DEFAULT false,
            produtos_selecionados JSONB,
            roi JSONB,
            status TEXT NOT NULL DEFAULT 'rascunho',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$CREATE TABLE IF NOT EXISTS public.gd_presentations (
       $q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_presentations DROP CONSTRAINT IF EXISTS gd_presentations_tenant_id_fkey;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_presentations DROP CONSTRAINT IF EXIST$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_presentations ALTER COLUMN tenant_id TYPE text USING tenant_id::text;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_presentations ALTER COLUMN tenant_id T$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  CREATE TABLE IF NOT EXISTS public.gd_proposals (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id TEXT NOT NULL DEFAULT 'geracao-digital',
            presentation_id UUID,
            prospect_name TEXT,
            itens JSONB NOT NULL DEFAULT '[]'::jsonb,
            valor_total NUMERIC NOT NULL DEFAULT 0,
            condicoes TEXT,
            status TEXT NOT NULL DEFAULT 'rascunho',
            payment_link TEXT,
            sent_at TIMESTAMPTZ,
            assinatura TEXT,
            signer_name TEXT,
            signed_at TIMESTAMPTZ,
            signer_ip TEXT,
            termo_aceite TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$CREATE TABLE IF NOT EXISTS public.gd_proposals (
          i$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals DROP CONSTRAINT IF EXISTS gd_proposals_tenant_id_fkey;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals DROP CONSTRAINT IF EXISTS gd$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ALTER COLUMN tenant_id TYPE text USING tenant_id::text;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ALTER COLUMN tenant_id TYPE $q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS package_id UUID;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS pac$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS package_vexo_id UUID;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS pac$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS prospect_logo TEXT;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS pro$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS segment_id UUID;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS seg$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS cobrar_setup BOOLEAN DEFAULT false;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS cob$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS valor_setup_vexo NUMERIC;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS val$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS condicoes_pagamento JSONB;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS con$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS periodo_plano TEXT;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS per$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS validade_ate TIMESTAMPTZ;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS val$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS valor_apos_validade NUMERIC;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS val$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS observacao_validade TEXT;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS obs$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS valor_vp NUMERIC;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS val$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS pacotes_ofertados JSONB;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS pac$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS owner_company TEXT NOT NULL DEFAULT 'geracao-digital';
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS own$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS condicoes_especiais TEXT;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS con$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS desconto_setup_pct NUMERIC DEFAULT 0;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS des$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS desconto_mensal_pct NUMERIC DEFAULT 0;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS des$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS vexi_plan VARCHAR(50);
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS vex$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS vexi_price NUMERIC DEFAULT 0;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS vex$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS vexo_plan VARCHAR(50);
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS vex$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS vexo_price NUMERIC DEFAULT 0;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS vex$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS presentation_slides JSONB;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS pre$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS meeting_notes TEXT;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS mee$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS descontos_por_periodo JSONB NULL;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS des$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS vp_percent NUMERIC NULL;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS vp_$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS esconder_valores BOOLEAN DEFAULT false;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS esc$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS assinatura_metodo TEXT DEFAULT 'desenho';
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS ass$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS dados_cadastrais JSONB;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS dad$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_implementation_briefings ADD COLUMN IF NOT EXISTS owner_company TEXT NOT NULL DEFAULT 'geracao-digital';
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_implementation_briefings ADD COLUMN IF$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_contracts ADD COLUMN IF NOT EXISTS owner_company TEXT NOT NULL DEFAULT 'geracao-digital';
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_contracts ADD COLUMN IF NOT EXISTS own$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_contracts ADD COLUMN IF NOT EXISTS signed_file_path TEXT;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_contracts ADD COLUMN IF NOT EXISTS sig$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_contracts ADD COLUMN IF NOT EXISTS signed_file_name TEXT;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_contracts ADD COLUMN IF NOT EXISTS sig$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_contracts ADD COLUMN IF NOT EXISTS signed_uploaded_at TIMESTAMPTZ;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_contracts ADD COLUMN IF NOT EXISTS sig$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_contracts ADD COLUMN IF NOT EXISTS signed_uploaded_by TEXT;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_contracts ADD COLUMN IF NOT EXISTS sig$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_contracts ADD COLUMN IF NOT EXISTS signed_file_history JSONB DEFAULT '[]'::jsonb;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_contracts ADD COLUMN IF NOT EXISTS sig$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  CREATE TABLE IF NOT EXISTS public.gd_packages (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id TEXT NOT NULL DEFAULT 'geracao-digital',
            nome TEXT NOT NULL,
            tipo TEXT DEFAULT 'gd',
            periodo TEXT DEFAULT 'mensal',
            produtos_incluidos JSONB NOT NULL DEFAULT '[]'::jsonb,
            valor NUMERIC NOT NULL DEFAULT 0,
            valor_tabela NUMERIC,
            valor_vp NUMERIC,
            destaque BOOLEAN NOT NULL DEFAULT false,
            ativo BOOLEAN NOT NULL DEFAULT true,
            ad_hoc BOOLEAN NOT NULL DEFAULT false,
            segmento TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$CREATE TABLE IF NOT EXISTS public.gd_packages (
          id$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'gd';
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS tipo$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS periodo TEXT DEFAULT 'mensal';
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS peri$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS produtos_incluidos JSONB DEFAULT '[]'::jsonb;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS prod$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS valor NUMERIC DEFAULT 0;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS valo$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS valor_tabela NUMERIC;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS valo$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS valor_vp NUMERIC;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS valo$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS destaque BOOLEAN DEFAULT false;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS dest$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS ad_hoc BOOLEAN DEFAULT false;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS ad_h$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS segmento TEXT;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS segm$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  CREATE TABLE IF NOT EXISTS public.gd_payment_terms (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id TEXT NOT NULL DEFAULT 'geracao-digital',
            nome TEXT NOT NULL,
            tipo TEXT DEFAULT 'custom',
            config JSONB DEFAULT '{}'::jsonb,
            ativo BOOLEAN NOT NULL DEFAULT true,
            aplica_a TEXT DEFAULT 'setup',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$CREATE TABLE IF NOT EXISTS public.gd_payment_terms (
       $q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_payment_terms ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'custom';
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_payment_terms ADD COLUMN IF NOT EXISTS$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_payment_terms ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}'::jsonb;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_payment_terms ADD COLUMN IF NOT EXISTS$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_payment_terms ADD COLUMN IF NOT EXISTS aplica_a TEXT DEFAULT 'setup';
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_payment_terms ADD COLUMN IF NOT EXISTS$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  CREATE TABLE IF NOT EXISTS public.gd_contracts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id TEXT NOT NULL DEFAULT 'geracao-digital',
            proposal_id UUID,
            client_name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'rascunho',
            file_url TEXT,
            signed_at TIMESTAMPTZ,
            signed_file_path TEXT,
            signed_file_name TEXT,
            signed_uploaded_at TIMESTAMPTZ,
            signed_uploaded_by TEXT,
            signed_file_history JSONB DEFAULT '[]'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$CREATE TABLE IF NOT EXISTS public.gd_contracts (
          i$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  CREATE TABLE IF NOT EXISTS public.gd_implementation_briefings (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id TEXT NOT NULL DEFAULT 'geracao-digital',
            client_name TEXT NOT NULL,
            model_type TEXT NOT NULL DEFAULT 'essencial',
            suggested_model TEXT DEFAULT 'essencial',
            num_employees INTEGER DEFAULT 1,
            has_commercial_sector BOOLEAN DEFAULT false,
            prerequisites JSONB DEFAULT '{}'::jsonb,
            operacao JSONB DEFAULT '{}'::jsonb,
            inteligencia JSONB DEFAULT '{}'::jsonb,
            agente_ia JSONB DEFAULT '{}'::jsonb,
            canais JSONB DEFAULT '{}'::jsonb,
            modulos_custom JSONB DEFAULT '{}'::jsonb,
            fechamento JSONB DEFAULT '{}'::jsonb,
            team_users JSONB DEFAULT '[]'::jsonb,
            knowledge_files JSONB DEFAULT '[]'::jsonb,
            cinco_pilares JSONB DEFAULT '{}'::jsonb,
            status TEXT NOT NULL DEFAULT 'em_andamento',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$CREATE TABLE IF NOT EXISTS public.gd_implementation_briefing$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_implementation_briefings DROP CONSTRAINT IF EXISTS gd_implementation_briefings_tenant_id_fkey;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_implementation_briefings DROP CONSTRAI$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_implementation_briefings ALTER COLUMN tenant_id TYPE text USING tenant_id::text;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_implementation_briefings ALTER COLUMN $q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_implementation_briefings ADD COLUMN IF NOT EXISTS team_users JSONB DEFAULT '[]'::jsonb;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_implementation_briefings ADD COLUMN IF$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_implementation_briefings ADD COLUMN IF NOT EXISTS knowledge_files JSONB DEFAULT '[]'::jsonb;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_implementation_briefings ADD COLUMN IF$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_implementation_briefings ADD COLUMN IF NOT EXISTS cinco_pilares JSONB DEFAULT '{}'::jsonb;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_implementation_briefings ADD COLUMN IF$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_implementation_briefings ADD COLUMN IF NOT EXISTS test_performed_at TIMESTAMPTZ;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_implementation_briefings ADD COLUMN IF$q$, 60), SQLERRM;
END $gd$;

DO $gd$ BEGIN
  ALTER TABLE public.gd_implementation_briefings ADD COLUMN IF NOT EXISTS test_questions_count INTEGER DEFAULT 0;
EXCEPTION WHEN others THEN RAISE NOTICE 'gd ddl (%): %', left($q$ALTER TABLE public.gd_implementation_briefings ADD COLUMN IF$q$, 60), SQLERRM;
END $gd$;
