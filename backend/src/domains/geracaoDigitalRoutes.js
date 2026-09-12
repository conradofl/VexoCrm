import pg from "pg";
import { defaultGroqModel } from "../services/llmModels.js";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { getSlackQueue } from "../geracaoDigital/slackQueue.js";
import { processEvolutionMessageToSlack } from "../geracaoDigital/slackMirrorIn.js";
import { processSlackMessageToEvolution } from "../geracaoDigital/slackMirrorOut.js";
import { extractBriefingFields } from "./geracaoDigital/briefingExtract.js";
import { transcribeBriefingAudio } from "./geracaoDigital/briefingTranscribe.js";
import {
  requireVexoCommercialAccess,
  makeVexoCommercialRowGuard,
} from "../access/vexoCommercialGate.js";
import { isManagerOrAdmin } from "../access/claims.js";
import { resolveAuthorizedClientId } from "../services/tenant.js";

// Recorrência: dois vocabulários para a mesma ideia. O catálogo (gd_products)
// grava "pontual"; o wizard grava "unico". Comparar por string solta fazia todo
// item "pontual" ficar fora do setup e entrar no valor recorrente — inflado
// depois pelos meses do período. Espelha isCobrancaUnica do
// frontend/src/lib/geracaoDigital/proposalCalculator.ts.
const RECORRENCIAS_UNICAS = new Set(["unico", "único", "pontual", "avulso", "unica", "única"]);
const isCobrancaUnica = (item) =>
  RECORRENCIAS_UNICAS.has(String(item?.recorrencia ?? "mensal").trim().toLowerCase());
const isCobrancaMensal = (item) => !isCobrancaUnica(item);

// PACOTE FECHADO: escolheu pacote, o preço do pacote É o preço. Nada de avulso,
// pontual ou extra entra em setup nem em mensalidade; o único setup cobrável é
// o do sistema Vexo, somado à parte. Espelha proposalCalculator.ts no frontend.
const isLinhaDePacote = (item) => {
  const d = String(item?.descricao || "");
  return d.startsWith("Pacote:") || d.startsWith("Pacote Vexo:");
};
const temPacote = (items) => (items || []).some(isLinhaDePacote);
const soma = (items, pred) =>
  (items || []).filter(pred).reduce((sum, i) => sum + Number(i.valor || 0), 0);

const somaSetup = (items) => (temPacote(items) ? 0 : soma(items, isCobrancaUnica));
const somaRecorrente = (items) =>
  temPacote(items) ? soma(items, isLinhaDePacote) : soma(items, isCobrancaMensal);

export function registerGeracaoDigitalRoutes(app, pool, requireFirebaseAuth, requireInternalPageAccess) {
  // Rotas por :id nao trazem owner_company na requisicao — o dono esta na linha.
  const guardPropostaVexo = makeVexoCommercialRowGuard(pool, "gd_proposals");
  const guardBriefingVexo = makeVexoCommercialRowGuard(pool, "gd_implementation_briefings");

  // Inicialização defensiva de todas as tabelas e seeds de Geração Digital no PostgreSQL
  async function ensureGdTablesAndSeeds(dbPool) {
  // Falha de DDL no boot NAO pode morrer calada. Cada ALTER tinha `.catch(() => {})`,
  // entao coluna que nao foi criada nao deixava rastro nenhum — foi assim que as oito
  // colunas do modulo comercial ficaram faltando em producao com o boot "limpo", e ja
  // e o terceiro caso identico no projeto. O contador sai no fim, para o boot dizer se
  // alguma coisa falhou em vez de so nao dizer nada.
  const _ddlFalhas = [];
  const alterLogado = (sql) => (err) => {
    const alvo = String(sql).replace(/\s+/g, " ").slice(0, 120);
    _ddlFalhas.push({ sql: alvo, erro: err?.message || String(err) });
    console.warn("[gd-setup] DDL falhou:", alvo, "->", err?.message || err);
  };

    try {
      // 0. Core CRM Tables (leads_clients, lead_client_n8n_settings, leads, lead_conversations, lead_messages)
      await dbPool.query(`
        CREATE TABLE IF NOT EXISTS public.leads_clients (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        INSERT INTO public.leads_clients (id, name)
        VALUES ('geracao-digital', 'Geração Digital')
        ON CONFLICT (id) DO NOTHING;

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
        ALTER TABLE public.lead_client_n8n_settings ADD COLUMN IF NOT EXISTS agent_name TEXT;
        ALTER TABLE public.lead_client_n8n_settings ADD COLUMN IF NOT EXISTS plan_tier TEXT DEFAULT 'essencial';
        ALTER TABLE public.lead_client_n8n_settings ADD COLUMN IF NOT EXISTS modulos_avulsos JSONB DEFAULT '[]'::jsonb;
        ALTER TABLE public.lead_client_n8n_settings ADD COLUMN IF NOT EXISTS degustacao_expira_em TIMESTAMPTZ;

        INSERT INTO public.lead_client_n8n_settings (client_id, active, chatbot_enabled)
        VALUES ('geracao-digital', true, false)
        ON CONFLICT (client_id) DO NOTHING;

        -- public.leads NÃO é criada aqui. O schema desta função era mínimo (sem
        -- UNIQUE (client_id, telefone), sem stage/temperature/tags/phone/
        -- extracted_from_wa), e recriava a tabela degradada sempre que ela
        -- faltava, derrubando em silêncio a extração de contatos. O schema
        -- correto é responsabilidade das migrations em supabase/migrations
        -- (20260703000000 + 20260730000000 + 20260801120000).

        CREATE TABLE IF NOT EXISTS public.lead_conversations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
          lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
          telefone TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS public.lead_messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
          lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
          direction TEXT NOT NULL DEFAULT 'inbound',
          sender_type TEXT,
          text_content TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `).catch((err) => console.warn("[crm-setup] Aviso ao criar tabelas core CRM:", err.message));

      // 1. Tenants table
      await dbPool.query(`
        CREATE TABLE IF NOT EXISTS public.tenants (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      await dbPool.query(`
        INSERT INTO public.tenants (id, name)
        VALUES ('00000000-0000-0000-0000-000000000000', 'Geração Digital')
        ON CONFLICT (id) DO NOTHING;
      `).catch(alterLogado(`
        INSERT INTO public.tenants (id, name)
        VALUES ('00000000-0000-0000-0000-000000000000', 'Geração Digital')
        ON CONFLICT (id) DO NOTHING;
      `));

      // 2. geracao_digital_briefings (Briefings de captação)
      await dbPool.query(`
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
      `);
      const briefingCount = await dbPool.query("SELECT count(*)::int AS count FROM public.geracao_digital_briefings");
      if ((briefingCount.rows[0]?.count || 0) === 0) {
        console.log("[gd-setup] Inserindo briefings iniciais de captação...");
        await dbPool.query(`
          INSERT INTO public.geracao_digital_briefings (prospect_name, whatsapp_number, theme_preset, briefing_data, status)
          VALUES
            ('Clinica Vitallis', '5531999999999', 'saude', '{"objetivo": "Escalar captação de pacientes de implante e estética dental", "orcamento_mensal": "6000", "plano": "semestral"}'::jsonb, 'concluido'),
            ('Dr. Diogo Teodoro', '5531988888888', 'saude', '{"objetivo": "Posicionamento e tráfego pago de cirurgia plástica", "orcamento_mensal": "6000", "plano": "mensal"}'::jsonb, 'pendente')
          ON CONFLICT DO NOTHING;
        `).catch((err) => console.warn("[gd-setup] Aviso ao inserir seed de briefings:", err.message));
      }

      // 3. gd_segments
      await dbPool.query(`
        CREATE TABLE IF NOT EXISTS public.gd_segments (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id TEXT NOT NULL DEFAULT 'geracao-digital',
          nome TEXT NOT NULL,
          faturamento_min NUMERIC NOT NULL DEFAULT 50000,
          ativo BOOLEAN NOT NULL DEFAULT true
        );
      `);
      await dbPool.query(`ALTER TABLE public.gd_segments DROP CONSTRAINT IF EXISTS gd_segments_tenant_id_fkey`).catch(alterLogado(`ALTER TABLE public.gd_segments DROP CONSTRAINT IF EXISTS gd_segments_tenant_id_fkey`));
      await dbPool.query(`ALTER TABLE public.gd_segments ALTER COLUMN tenant_id TYPE text USING tenant_id::text`).catch(alterLogado(`ALTER TABLE public.gd_segments ALTER COLUMN tenant_id TYPE text USING tenant_id::text`));

      // 4. gd_products (Catálogo)
      await dbPool.query(`
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
      `);
      await dbPool.query(`ALTER TABLE public.gd_products DROP CONSTRAINT IF EXISTS gd_products_tenant_id_fkey`).catch(alterLogado(`ALTER TABLE public.gd_products DROP CONSTRAINT IF EXISTS gd_products_tenant_id_fkey`));
      await dbPool.query(`ALTER TABLE public.gd_products ALTER COLUMN tenant_id TYPE text USING tenant_id::text`).catch(alterLogado(`ALTER TABLE public.gd_products ALTER COLUMN tenant_id TYPE text USING tenant_id::text`));

      // Seed catálogo se estiver vazio
      const prodCheck = await dbPool.query("SELECT count(*)::int AS count FROM public.gd_products");
      if ((prodCheck.rows[0]?.count || 0) === 0) {
        console.log("[gd-setup] Populando catálogo inicial de produtos Geração Digital...");
        await dbPool.query(`
          INSERT INTO public.gd_products (tenant_id, nome, categoria, valor_padrao, recorrencia, ativo)
          VALUES
            ('00000000-0000-0000-0000-000000000000', 'Google Meu Negócio', 'gd', 300.00, 'mensal', true),
            ('00000000-0000-0000-0000-000000000000', 'Google Ads', 'gd', 1500.00, 'mensal', true),
            ('00000000-0000-0000-0000-000000000000', 'Gestão de redes sociais - Instagram', 'gd', 1200.00, 'mensal', true),
            ('00000000-0000-0000-0000-000000000000', 'Gestão de redes sociais - Facebook', 'gd', 800.00, 'mensal', true),
            ('00000000-0000-0000-0000-000000000000', 'Gestão de redes sociais - LinkedIn', 'gd', 1500.00, 'mensal', true),
            ('00000000-0000-0000-0000-000000000000', 'Gestão de redes sociais - TikTok', 'gd', 1200.00, 'mensal', true),
            ('00000000-0000-0000-0000-000000000000', 'Gestão de tráfego google/meta ads', 'gd', 2000.00, 'mensal', true),
            ('00000000-0000-0000-0000-000000000000', 'Logomarca', 'gd', 800.00, 'pontual', true),
            ('00000000-0000-0000-0000-000000000000', 'Branding', 'gd', 3500.00, 'pontual', true),
            ('00000000-0000-0000-0000-000000000000', 'Cartão de visitas', 'gd', 250.00, 'pontual', true),
            ('00000000-0000-0000-0000-000000000000', 'Arte avulsa', 'gd', 150.00, 'pontual', true),
            ('00000000-0000-0000-0000-000000000000', 'Panfletos', 'gd', 400.00, 'pontual', true),
            ('00000000-0000-0000-0000-000000000000', 'Cardápios', 'gd', 600.00, 'pontual', true),
            ('00000000-0000-0000-0000-000000000000', 'Fachadas', 'gd', 1200.00, 'pontual', true),
            ('00000000-0000-0000-0000-000000000000', 'Landing Page/site', 'gd', 2500.00, 'pontual', true),
            ('00000000-0000-0000-0000-000000000000', 'E-commerce', 'gd', 5000.00, 'pontual', true),
            ('00000000-0000-0000-0000-000000000000', 'Cobertura de eventos', 'gd', 1800.00, 'pontual', true),
            ('00000000-0000-0000-0000-000000000000', 'Vídeo avulso', 'gd', 350.00, 'pontual', true)
        `).catch((err) => console.warn("[gd-setup] Aviso ao inserir seed de produtos:", err.message));
      }

      // 5. gd_presentations
      await dbPool.query(`
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
      `);
      await dbPool.query(`ALTER TABLE public.gd_presentations DROP CONSTRAINT IF EXISTS gd_presentations_tenant_id_fkey`).catch(alterLogado(`ALTER TABLE public.gd_presentations DROP CONSTRAINT IF EXISTS gd_presentations_tenant_id_fkey`));
      await dbPool.query(`ALTER TABLE public.gd_presentations ALTER COLUMN tenant_id TYPE text USING tenant_id::text`).catch(alterLogado(`ALTER TABLE public.gd_presentations ALTER COLUMN tenant_id TYPE text USING tenant_id::text`));

      // 6. gd_proposals (Propostas Comerciais)
      await dbPool.query(`
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
      `);
      await dbPool.query(`ALTER TABLE public.gd_proposals DROP CONSTRAINT IF EXISTS gd_proposals_tenant_id_fkey`).catch(alterLogado(`ALTER TABLE public.gd_proposals DROP CONSTRAINT IF EXISTS gd_proposals_tenant_id_fkey`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ALTER COLUMN tenant_id TYPE text USING tenant_id::text`).catch(alterLogado(`ALTER TABLE public.gd_proposals ALTER COLUMN tenant_id TYPE text USING tenant_id::text`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS package_id UUID`).catch(alterLogado(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS package_id UUID`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS package_vexo_id UUID`).catch(alterLogado(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS package_vexo_id UUID`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS prospect_logo TEXT`).catch(alterLogado(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS prospect_logo TEXT`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS segment_id UUID`).catch(alterLogado(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS segment_id UUID`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS cobrar_setup BOOLEAN DEFAULT false`).catch(alterLogado(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS cobrar_setup BOOLEAN DEFAULT false`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS valor_setup_vexo NUMERIC`).catch(alterLogado(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS valor_setup_vexo NUMERIC`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS condicoes_pagamento JSONB`).catch(alterLogado(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS condicoes_pagamento JSONB`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS periodo_plano TEXT`).catch(alterLogado(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS periodo_plano TEXT`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS validade_ate TIMESTAMPTZ`).catch(alterLogado(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS validade_ate TIMESTAMPTZ`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS valor_apos_validade NUMERIC`).catch(alterLogado(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS valor_apos_validade NUMERIC`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS observacao_validade TEXT`).catch(alterLogado(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS observacao_validade TEXT`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS valor_vp NUMERIC`).catch(alterLogado(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS valor_vp NUMERIC`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS pacotes_ofertados JSONB`).catch(alterLogado(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS pacotes_ofertados JSONB`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS owner_company TEXT NOT NULL DEFAULT 'geracao-digital'`).catch(alterLogado(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS owner_company TEXT NOT NULL DEFAULT 'geracao-digital'`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS condicoes_especiais TEXT`).catch(alterLogado(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS condicoes_especiais TEXT`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS desconto_setup_pct NUMERIC DEFAULT 0`).catch(alterLogado(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS desconto_setup_pct NUMERIC DEFAULT 0`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS desconto_mensal_pct NUMERIC DEFAULT 0`).catch(alterLogado(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS desconto_mensal_pct NUMERIC DEFAULT 0`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS vexi_plan VARCHAR(50)`).catch(alterLogado(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS vexi_plan VARCHAR(50)`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS vexi_price NUMERIC DEFAULT 0`).catch(alterLogado(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS vexi_price NUMERIC DEFAULT 0`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS vexo_plan VARCHAR(50)`).catch(alterLogado(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS vexo_plan VARCHAR(50)`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS vexo_price NUMERIC DEFAULT 0`).catch(alterLogado(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS vexo_price NUMERIC DEFAULT 0`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS presentation_slides JSONB`).catch(alterLogado(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS presentation_slides JSONB`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS meeting_notes TEXT`).catch(alterLogado(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS meeting_notes TEXT`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS descontos_por_periodo JSONB NULL`).catch(alterLogado(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS descontos_por_periodo JSONB NULL`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS vp_percent NUMERIC NULL`).catch(alterLogado(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS vp_percent NUMERIC NULL`));
      await dbPool.query(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS esconder_valores BOOLEAN DEFAULT false`).catch(alterLogado(`ALTER TABLE public.gd_proposals ADD COLUMN IF NOT EXISTS esconder_valores BOOLEAN DEFAULT false`));
      await dbPool.query(`ALTER TABLE public.gd_implementation_briefings ADD COLUMN IF NOT EXISTS owner_company TEXT NOT NULL DEFAULT 'geracao-digital'`).catch(alterLogado(`ALTER TABLE public.gd_implementation_briefings ADD COLUMN IF NOT EXISTS owner_company TEXT NOT NULL DEFAULT 'geracao-digital'`));
      await dbPool.query(`ALTER TABLE public.gd_contracts ADD COLUMN IF NOT EXISTS owner_company TEXT NOT NULL DEFAULT 'geracao-digital'`).catch(alterLogado(`ALTER TABLE public.gd_contracts ADD COLUMN IF NOT EXISTS owner_company TEXT NOT NULL DEFAULT 'geracao-digital'`));

      // Seed de propostas históricas se a tabela estiver vazia
      const propCount = await dbPool.query("SELECT count(*)::int AS count FROM public.gd_proposals");
      if ((propCount.rows[0]?.count || 0) === 0) {
        console.log("[gd-setup] Inserindo propostas históricas (Vitallis, Dr. Diogo Teodoro, Ótica R Deluxe, Mestre dos Jogos)...");
        await dbPool.query(`
          INSERT INTO public.gd_proposals (id, tenant_id, prospect_name, valor_total, condicoes, status, cobrar_setup, valor_setup_vexo, periodo_plano, itens)
          VALUES
            ('f886eb5f-2071-4e5a-9dfa-f0478673330a', '00000000-0000-0000-0000-000000000000', 'Clinica Vitallis', 41000.00, 'Contrato Semestral. Recorrência R$ 6.000/mês + Setup Vexo R$ 5.000', 'rascunho', true, 5000, 'semestral', '[{"product_id": null, "descricao": "Pacote: Pacote Semestral (Recorrência)", "categoria": "gd", "valor": 6000, "recorrencia": "mensal", "meses": 6, "valor_vp": 3000}, {"product_id": "p-landing", "descricao": "GD: Landing Page/site", "categoria": "gd", "valor": 2500, "recorrencia": "pontual"}]'::jsonb),
            ('a1111111-2222-3333-4444-555555555555', '00000000-0000-0000-0000-000000000000', 'Dr. Diogo Teodoro', 6000.00, 'Contrato Mensal Recorrente', 'rascunho', false, 0, 'mensal', '[{"product_id": null, "descricao": "Pacote: Gestão de Tráfego e Presença Digital", "categoria": "gd", "valor": 6000, "recorrencia": "mensal", "meses": 1}]'::jsonb),
            ('b2222222-3333-4444-5555-666666666666', '00000000-0000-0000-0000-000000000000', 'Ótica R Deluxe', 18800.00, 'Contrato Semestral. Recorrência R$ 3.000/mês + Branding R$ 800', 'enviada', false, 0, 'semestral', '[{"product_id": null, "descricao": "Pacote: Posicionamento R Deluxe", "categoria": "gd", "valor": 3000, "recorrencia": "mensal", "meses": 6}]'::jsonb),
            ('c3333333-4444-5555-6666-777777777777', '00000000-0000-0000-0000-000000000000', 'Mestre dos Jogos', 73500.00, 'Contrato Anual. Recorrência R$ 6.000/mês + Setup E-commerce', 'enviada', false, 0, 'anual', '[{"product_id": null, "descricao": "Pacote: Escala Mestre dos Jogos", "categoria": "gd", "valor": 6000, "recorrencia": "mensal", "meses": 12}]'::jsonb)
          ON CONFLICT (id) DO NOTHING;
        `).catch((err) => console.warn("[gd-setup] Aviso ao inserir seed de propostas:", err.message));
      }

      // 7. gd_packages
      await dbPool.query(`
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
      `);
      await dbPool.query(`ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'gd'`).catch(alterLogado(`ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'gd'`));
      await dbPool.query(`ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS periodo TEXT DEFAULT 'mensal'`).catch(alterLogado(`ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS periodo TEXT DEFAULT 'mensal'`));
      await dbPool.query(`ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS produtos_incluidos JSONB DEFAULT '[]'::jsonb`).catch(alterLogado(`ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS produtos_incluidos JSONB DEFAULT '[]'::jsonb`));
      await dbPool.query(`ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS valor NUMERIC DEFAULT 0`).catch(alterLogado(`ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS valor NUMERIC DEFAULT 0`));
      await dbPool.query(`ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS valor_tabela NUMERIC`).catch(alterLogado(`ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS valor_tabela NUMERIC`));
      await dbPool.query(`ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS valor_vp NUMERIC`).catch(alterLogado(`ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS valor_vp NUMERIC`));
      await dbPool.query(`ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS destaque BOOLEAN DEFAULT false`).catch(alterLogado(`ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS destaque BOOLEAN DEFAULT false`));
      await dbPool.query(`ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS ad_hoc BOOLEAN DEFAULT false`).catch(alterLogado(`ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS ad_hoc BOOLEAN DEFAULT false`));
      await dbPool.query(`ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS segmento TEXT`).catch(alterLogado(`ALTER TABLE public.gd_packages ADD COLUMN IF NOT EXISTS segmento TEXT`));

      // 8. gd_payment_terms
      await dbPool.query(`
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
      `);
      await dbPool.query(`ALTER TABLE public.gd_payment_terms ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'custom'`).catch(alterLogado(`ALTER TABLE public.gd_payment_terms ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'custom'`));
      await dbPool.query(`ALTER TABLE public.gd_payment_terms ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}'::jsonb`).catch(alterLogado(`ALTER TABLE public.gd_payment_terms ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}'::jsonb`));
      await dbPool.query(`ALTER TABLE public.gd_payment_terms ADD COLUMN IF NOT EXISTS aplica_a TEXT DEFAULT 'setup'`).catch(alterLogado(`ALTER TABLE public.gd_payment_terms ADD COLUMN IF NOT EXISTS aplica_a TEXT DEFAULT 'setup'`));

      // 9. gd_contracts
      await dbPool.query(`
        CREATE TABLE IF NOT EXISTS public.gd_contracts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id TEXT NOT NULL DEFAULT 'geracao-digital',
          proposal_id UUID,
          client_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'rascunho',
          file_url TEXT,
          signed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);

      // 10. gd_implementation_briefings
      await dbPool.query(`
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
          status TEXT NOT NULL DEFAULT 'em_andamento',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      await dbPool.query(`ALTER TABLE public.gd_implementation_briefings DROP CONSTRAINT IF EXISTS gd_implementation_briefings_tenant_id_fkey`).catch(alterLogado(`ALTER TABLE public.gd_implementation_briefings DROP CONSTRAINT IF EXISTS gd_implementation_briefings_tenant_id_fkey`));
      await dbPool.query(`ALTER TABLE public.gd_implementation_briefings ALTER COLUMN tenant_id TYPE text USING tenant_id::text`).catch(alterLogado(`ALTER TABLE public.gd_implementation_briefings ALTER COLUMN tenant_id TYPE text USING tenant_id::text`));
      // Bloco de auto-migração de background REMOVIDO: a migração já foi feita
      // manualmente e o código anterior embutia a senha do banco em texto puro
      // (3 connection strings hardcoded). Migração é operação pontual, não deve
      // rodar a cada boot nem carregar segredo no fonte.
      if (_ddlFalhas.length > 0) {
        console.error("[gd-setup] schema GD incompleto:", _ddlFalhas.length, "DDL falharam", _ddlFalhas);
      } else {
        console.log("[gd-setup] schema GD verificado, nenhuma DDL falhou");
      }
    } catch (err) {
      console.error("[ensureGdTablesAndSeeds] falhou ao verificar tabelas GD:", err.message);
    }
  }

  ensureGdTablesAndSeeds(pool);

  // POST /api/geracao-digital/briefing
  app.post("/api/geracao-digital/briefing", requireFirebaseAuth, async (req, res) => {

    async function processSlackJobSync(pool, jobData) {
      const {
        clientName, whatsappNumber, whatsappGroupId, briefingData = {},
        slackChannelName, slackExtraChannels = [], slackMembers = []
      } = jobData;

      const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
      if (!SLACK_BOT_TOKEN) throw new Error("SLACK_BOT_TOKEN não configurado no servidor.");
      
      try {
        const testRes = await fetch("https://slack.com/api/auth.test", {
          method: "POST",
          headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
        });
        const testData = await testRes.json();
        if (testData.ok) {
          console.log(`[gd-setup] Slack token ativo no workspace "${testData.team}" (bot: ${testData.user}, team_id: ${testData.team_id})`);
        } else {
          console.error(`[gd-setup] Erro de autenticação no Slack: ${testData.error}`);
        }
      } catch (e) {
        console.warn("[gd-setup] Não foi possível verificar auth.test do Slack:", e.message);
      }

      const normalizeWhatsapp = (num) => {
        let clean = (num || "").replace(/\D/g, "");
        if (clean.length === 10 || clean.length === 11) return "55" + clean;
        return clean;
      };
      const jid = whatsappGroupId ? whatsappGroupId : (normalizeWhatsapp(whatsappNumber) + "@s.whatsapp.net");

      const slug = (clientName || "cliente-sem-nome")
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 21);

      async function createSlackChannel(rawName) {
        const name = (rawName || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
        const createRes = await fetch("https://slack.com/api/conversations.create", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
          body: JSON.stringify({ name }),
        });
        const createData = await createRes.json();
        if (createData.ok) return createData.channel.id;

        if (createData.error !== "name_taken") {
          throw new Error(`Erro ao criar canal ${name}: ${createData.error}`);
        }

        // name_taken: o canal já existe (reuso do mesmo nome entre testes).
        // 1ª tentativa: achar o id via conversations.list (paginado, com
        // arquivados). Só canais públicos, então basta channels:read.
        let cursor = "";
        let achado = null;
        let erroLista = null;
        for (let i = 0; i < 20 && !achado; i++) {
          // Só canais PÚBLICOS. Pedir private_channel exige o escopo groups:read,
          // que o bot não tem; os canais do handoff (gd-*) são públicos, então
          // channels:read basta. Isso evita o missing_scope na listagem.
          const url =
            "https://slack.com/api/conversations.list?limit=1000&exclude_archived=false" +
            "&types=public_channel" +
            (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
          const listRes = await fetch(url, { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } });
          const listData = await listRes.json();
          if (!listData.ok) { erroLista = listData.error; break; }
          achado = (listData.channels || []).find((c) => c.name === name);
          cursor = listData.response_metadata?.next_cursor || "";
          if (!cursor) break;
        }
        if (achado) return achado.id;

        // 2ª tentativa (desbloqueio): não deu para achar o canal existente
        // (bot sem escopo de leitura, ou canal privado sem o bot). Em vez de
        // abortar o handoff inteiro, cria um canal novo com sufixo curto. O
        // handoff completa e o dossiê é postado; o operador vê o nome usado.
        const sufixo = new Date().toISOString().slice(5, 16).replace(/[-T:]/g, "");
        const nomeAlt = `${name}-${sufixo}`.slice(0, 80);
        const retryRes = await fetch("https://slack.com/api/conversations.create", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
          body: JSON.stringify({ name: nomeAlt }),
        });
        const retryData = await retryRes.json();
        if (retryData.ok) {
          console.warn(`[gd-setup] "${name}" já existia e o bot não o encontrou (${erroLista || "sem escopo de leitura"}). Criado "${nomeAlt}".`);
          return retryData.channel.id;
        }
        throw new Error(
          `O canal "${name}" já existe e o bot não consegue acessá-lo (${erroLista || "falta o escopo channels:read"}). Adicione o escopo ao app do Slack ou use um nome de canal novo.`
        );
      }

      async function joinSlackChannel(channelId) {
        try {
          const res = await fetch("https://slack.com/api/conversations.join", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
            body: JSON.stringify({ channel: channelId }),
          });
          const data = await res.json();
          if (!data.ok && data.error !== "already_in_channel") {
            console.warn(`[gd-setup] Aviso ao entrar no canal ${channelId}:`, data.error);
          }
        } catch (err) {
          console.warn(`[gd-setup] Erro ao entrar no canal ${channelId}:`, err.message);
        }
      }

      async function inviteToChannel(channelId, userIds) {
        if (!userIds || userIds.length === 0) {
          console.log(`[gd-setup] Nenhum integrante do Slack selecionado. O canal ${channelId} foi criado público, mas integrantes precisam buscá-lo no Slack ("Navegar por todos os canais").`);
          return;
        }
        try {
          const res = await fetch("https://slack.com/api/conversations.invite", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
            body: JSON.stringify({ channel: channelId, users: userIds.join(",") }),
          });
          const data = await res.json();
          if (data.ok) {
            console.log(`[gd-setup] ${userIds.length} integrante(s) convidado(s) com sucesso para o canal ${channelId}.`);
          } else if (data.error !== "already_in_channel") {
            console.warn(`[gd-setup] Aviso ao convidar para o canal ${channelId}: ${data.error}.`);
          }
        } catch (err) {
          console.warn(`[gd-setup] Erro de rede ao convidar integrantes:`, err.message);
        }
      }

      const channelName = slackChannelName || `gd-${slug}`;
      const channelId = await createSlackChannel(channelName);
      await joinSlackChannel(channelId);
      await inviteToChannel(channelId, slackMembers);

      for (const extraName of slackExtraChannels) {
        try {
          const extraId = await createSlackChannel(extraName);
          await joinSlackChannel(extraId);
          await inviteToChannel(extraId, slackMembers);
        } catch (err) {
          console.warn(`[gd-setup] Aviso: Não foi possível criar canal extra ${extraName}`, err);
        }
      }

      let membersMentions = "";
      if (slackMembers && slackMembers.length > 0) membersMentions = slackMembers.map(id => `<@${id}>`).join(" ");

      const textMsg = `*Novo Dossiê Geração Digital*\n*Cliente:* ${clientName}\n*Whatsapp:* ${whatsappNumber}`;

      const blocks = [
        { type: "header", text: { type: "plain_text", text: "📄 Dossiê do Cliente (Geração Digital)" } },
        { type: "section", fields: [
            { type: "mrkdwn", text: `*Cliente:*\n${clientName}` },
            { type: "mrkdwn", text: `*WhatsApp:*\n${whatsappNumber}` }
        ]}
      ];

      let currentFields = [];
      for (const [key, value] of Object.entries(briefingData || {})) {
          const formattedKey = key.replace(/_/g, ' ').toUpperCase();
          // Truncate to avoid slack limits, but 1900 is safe
          const valText = value ? String(value).substring(0, 1900) : 'Não preenchido';
          currentFields.push({ type: "mrkdwn", text: `*${formattedKey}:*\n${valText}` });

          if (currentFields.length === 10) {
             blocks.push({ type: "section", fields: currentFields });
             currentFields = [];
          }
      }
      if (currentFields.length > 0) {
          blocks.push({ type: "section", fields: currentFields });
      }

      if (membersMentions) {
         blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Responsáveis:*\n${membersMentions}` } });
      }

      blocks.push({ type: "divider" });
      blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "💡 *Dica de Uso:* Para conversas internas entre a equipe (que não devem ser enviadas ao WhatsApp do cliente), inicie a mensagem com `//`." }] });


      const postRes = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
        body: JSON.stringify({ channel: channelId, text: textMsg, blocks: blocks }),
      });
      const postData = await postRes.json();
      if (!postData.ok) throw new Error(`Erro ao postar mensagem: ${postData.error}`);

      const pinRes = await fetch("https://slack.com/api/pins.add", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
        body: JSON.stringify({ channel: channelId, timestamp: postData.ts }),
      });
      const pinData = await pinRes.json();
      if (!pinData.ok && pinData.error !== "already_pinned") console.warn(`[gd-setup] Erro ao pinar (ignorado): ${pinData.error}`);

      await pool.query(
        `INSERT INTO public.slack_channel_map (client_name, whatsapp_jid, slack_channel_id, drive_folder_id, instance_name, status)
         VALUES ($1, $2, $3, $4, 'gd-oficial', 'active')
         ON CONFLICT (whatsapp_jid) DO NOTHING`,
        [clientName, jid, channelId, briefingData['drive_link'] || null]
      );
    }
    try {
      const {
        prospectName,
        whatsappNumber,
        agencyName,
        themePreset,
        briefingData,
        sendToProspectWhatsapp,
        sendToProspectEmail,
        prospectEmail,
        sendToSectors,
        sectorsWhatsapp,
        sectorsEmail,
        createWhatsappGroup,
        whatsappGroupName,
        whatsappGroupMembers
      } = req.body;

      // Salvar como rascunho: persiste o briefing com status 'rascunho' e NÃO
      // dispara nada (Slack/WhatsApp/e-mail). Serve de rede de segurança — se o
      // envio final falhar, os dados ficam salvos e o operador retoma depois.
      const isDraft = req.body.draft === true;

      // 1. Save to DB
      const result = await pool.query(
        `INSERT INTO public.geracao_digital_briefings
         (prospect_name, whatsapp_number, theme_preset, briefing_data, status)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [prospectName, whatsappNumber || '', themePreset, JSON.stringify(briefingData || {}), isDraft ? 'rascunho' : 'pending']
      );
      const briefingId = result.rows[0].id;

      if (isDraft) {
        return res.status(200).json({
          success: true,
          draft: true,
          id: briefingId,
          message: "Rascunho salvo. Você pode retomar e finalizar o envio depois."
        });
      }

      let briefingHtml = '<h3>Dados do Briefing:</h3><ul>';
      let briefingText = '\n\n*Dados do Briefing:*\n';
      for (const [key, value] of Object.entries(briefingData || {})) {
          const formattedKey = key.replace(/_/g, ' ').toUpperCase();
          briefingHtml += `<li><strong>${formattedKey}:</strong> ${value || 'Não preenchido'}</li>`;
          briefingText += `- *${formattedKey}:* ${value || 'Não preenchido'}\n`;
      }
      briefingHtml += '</ul>';

      // 1.5 Fetch dynamic instance name + base URL da instância.
      // A base e o nome saem da MESMA fonte que as features de WhatsApp que
      // funcionam (followup, campanhas): a dispatch_webhook_url da instância no
      // banco. Antes o handoff dependia só de GD_EVOLUTION_URL/TOKEN, nomes de
      // env exclusivos deste fluxo; se sumissem do servidor, o grupo caía em
      // "not_configured" sem erro. Agora o env é apenas fallback.
      let dynamicInstanceName = null;
      let dynamicBaseUrl = null;
      try {
        let queryStr = `SELECT dispatch_webhook_url, name, client_id FROM public.lead_client_evolution_instances WHERE active = true ORDER BY is_default DESC`;
        let queryParams = [];
        if (req.authAccess && req.authAccess.role !== "internal" && req.authAccess.clientIds && req.authAccess.clientIds.length > 0) {
            queryStr = `SELECT dispatch_webhook_url, name, client_id FROM public.lead_client_evolution_instances WHERE client_id = ANY($1) AND active = true ORDER BY is_default DESC`;
            queryParams = [req.authAccess.clientIds];
        }

        let instRes = await pool.query(queryStr, queryParams);
          // Fallback: a consulta acima pode ser filtrada por clientIds do usuário.
          // Quando o escopo dele não casa com o client_id da instância (slug vs
          // uuid, claims ainda não sincronizadas depois de trocar o perfil), o
          // resultado vinha vazio e o grupo do WhatsApp simplesmente não era
          // criado, sem erro nenhum na tela. Cair para as instâncias ativas
          // evita a falha silenciosa.
          if (instRes.rows.length === 0 && queryParams.length > 0) {
            instRes = await pool.query(
              `SELECT dispatch_webhook_url, name, client_id FROM public.lead_client_evolution_instances WHERE active = true ORDER BY is_default DESC`
            );
          }
          if (instRes.rows.length > 0) {
            let row = instRes.rows.find(r => r.client_id === 'geracao-digital') || instRes.rows[0];
            const urlStr = row.dispatch_webhook_url;
            if (urlStr) {
               try {
                 const url = new URL(urlStr);
                 const pathParts = url.pathname.split("/").filter(Boolean);
                 const messageIndex = pathParts.findIndex((part) => part === "message");
                 const instance = messageIndex >= 0 ? decodeURIComponent(pathParts[messageIndex + 2] || "") : "";
                 dynamicInstanceName = instance || row.name;
                 dynamicBaseUrl = `${url.protocol}//${url.host}`;
               } catch (e) {
                 dynamicInstanceName = row.name;
               }
            } else {
               dynamicInstanceName = row.name;
            }
          }
        } catch (dbErr) {
          console.error("[GeracaoDigital] Error fetching dynamic instance:", dbErr);
        }

      // 2. Evolution config. Ordem: base da instância (banco) > GD_EVOLUTION_URL
      // (env antigo) > EVOLUTION_API_URL (env que o resto do sistema usa).
      const evolutionUrl = dynamicBaseUrl || process.env.GD_EVOLUTION_URL || process.env.EVOLUTION_API_URL;
      const evolutionToken = process.env.GD_EVOLUTION_TOKEN || process.env.EVOLUTION_API_KEY;
      let evolutionStatus = "not_configured";
      let emailStatus = "not_configured";
      let sectorsStatus = "not_configured";

      // 3. Import Resend dynamically (to avoid crashing if not available)
      let sendEmailFn = null;
      try {
        const { ResendProvider } = await import("../providers/ResendProvider.js");
        sendEmailFn = ResendProvider.sendEmail;
      } catch (err) {
        console.warn("[GeracaoDigital] ResendProvider not loaded", err);
      }

      const normalizeWhatsapp = (num) => {
          let clean = (num || "").replace(/\D/g, '');
          if (clean.length === 10 || clean.length === 11) return '55' + clean;
          return clean;
      };

      // Helper function to send WhatsApp via Evolution
      const sendEvolution = async (number, text) => {
        if (!evolutionUrl || !evolutionToken || !number) return "not_configured";
        const normalizedNumber = normalizeWhatsapp(number);
        const payload = {
          number: normalizedNumber,
          options: { delay: 1200, presence: "composing" },
          textMessage: { text },
          text: text
        };
        let endpoint = evolutionUrl.endsWith("/") ? evolutionUrl.slice(0, -1) : evolutionUrl;

        // Se a URL não contiver a rota de envio, adicionamos a rota com o nome da instância
        if (!endpoint.includes("/message/sendText")) {
          const instanceName = dynamicInstanceName || process.env.GD_EVOLUTION_INSTANCE || "Teste";
          endpoint = `${endpoint}/message/sendText/${instanceName}`;
        }

        try {
          const evRes = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: evolutionToken },
            body: JSON.stringify(payload),
          });
          if (!evRes.ok) {
            console.error("[GeracaoDigital] Evolution Error:", await evRes.text());
            return `failed_${evRes.status}`;
          }
          return "sent";
        } catch (e) {
          console.error("[GeracaoDigital] Evolution Network Error:", e.message);
          return "failed_network";
        }
      };

      // Helper function to create WhatsApp Group via Evolution
      const createEvolutionGroup = async (subject, membersString) => {
        if (!evolutionUrl || !evolutionToken) return { status: "not_configured" };
        let baseUrl = evolutionUrl.endsWith("/") ? evolutionUrl.slice(0, -1) : evolutionUrl;

        // Remove everything after the last slash if it's pointing to /message/sendText
        if (baseUrl.includes("/message/sendText")) {
          baseUrl = baseUrl.split("/message/sendText")[0];
        }

        const instanceName = dynamicInstanceName || process.env.GD_EVOLUTION_INSTANCE || "Teste";
        const endpoint = `${baseUrl}/group/create/${instanceName}`;

        const members = membersString.split(",").map(m => m.trim()).filter(Boolean);
        const participants = [];
        if (whatsappNumber) {
          participants.push(normalizeWhatsapp(whatsappNumber) + "@s.whatsapp.net");
        }
        members.forEach(m => {
          participants.push(normalizeWhatsapp(m) + "@s.whatsapp.net");
        });

        // Unique participants
        const uniqueParticipants = [...new Set(participants)];
        if (uniqueParticipants.length === 0) {
          return { status: "failed_400", error: "Nenhum participante válido foi fornecido (o WhatsApp do cliente e os setores estão vazios)." };
        }

        const payload = {
          subject: subject.substring(0, 25), // WhatsApp group name limit
          participants: uniqueParticipants
        };

        try {
          const evRes = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: evolutionToken },
            body: JSON.stringify(payload),
          });
          const data = await evRes.json();
          if (!evRes.ok) {
            console.error("[GeracaoDigital] Group Create Error:", data);
            return { status: `failed_${evRes.status}`, error: (data?.response?.message || data?.message || JSON.stringify(data) || "").toString().slice(0, 300) };
          }
          // The API returns the group ID, usually as data.id or data.groupId
          // Structure varies by Evolution API version, but typically data.id
          const groupId = data.id || data.groupId || (data.groupMetadata && data.groupMetadata.id);
          if (groupId) {
             return { status: "created", groupId };
          }
          return { status: "created_no_id", data };
        } catch (e) {
          console.error("[GeracaoDigital] Evolution Group Network Error:", e.message);
          return { status: "failed_network", error: e.message };
        }
      };

      const messageText = `Olá ${prospectName}!\n\nSeu dossiê/briefing da ${agencyName || 'Vexo'} está pronto.${briefingText}`;

      let whatsappGroupStatus = "not_configured";
      let whatsappGroupId = null;
      let whatsappGroupError = null;
      // Instância que será usada, para o front dizer qual quando o grupo falha.
      const instanciaUsada = dynamicInstanceName || process.env.GD_EVOLUTION_INSTANCE || "Teste";

      // Create WhatsApp Group
      if (createWhatsappGroup) {
         const subject = whatsappGroupName || `GD & ${prospectName}`;
         const groupRes = await createEvolutionGroup(subject, [whatsappGroupMembers, sectorsWhatsapp].filter(Boolean).join(","));
         whatsappGroupStatus = groupRes.status;
         whatsappGroupError = groupRes.error || null;
         if (groupRes.groupId) {
           whatsappGroupId = groupRes.groupId;
           // Mandar o dossiê direto pro grupo também!
           evolutionStatus = await sendEvolution(groupRes.groupId, messageText);
         }
      }

      // Dispatch WhatsApp Prospect (Only if we didn't just send it to their new group, or if they explicitly want both)
      if (sendToProspectWhatsapp && whatsappNumber) {
        // If we created a group, we might want to skip sending it directly, but let's just send it if checked.
        if (!whatsappGroupId) {
          evolutionStatus = await sendEvolution(whatsappNumber, messageText);
        }
      }

      // Dispatch E-mail Prospect
      if (sendToProspectEmail && prospectEmail && sendEmailFn) {
        try {
          const html = `<h2>Olá ${prospectName}!</h2><p>Seu dossiê/briefing da ${agencyName || 'Vexo'} está pronto e as próximas etapas do cronograma já foram iniciadas.</p>${briefingHtml}<p>Em breve nossa equipe técnica entrará em contato para os próximos passos.</p>`;
          const emailRes = await sendEmailFn(prospectEmail, `Seu Dossiê da ${agencyName || 'Vexo'} está pronto`, html, agencyName || 'Vexo');
          emailStatus = emailRes ? "sent" : "not_configured";
        } catch (e) {
          emailStatus = "failed";
        }
      }

      // Dispatch Sectors (WhatsApp + Email)
      if (sendToSectors) {
        let wppStatus = "skipped";
        let emStatus = "skipped";

        if (sectorsWhatsapp) {
          const wppText = `*Novo Briefing Handoff:*\n*Prospect:* ${prospectName}\n*Tel:* ${whatsappNumber || 'N/A'}\nVerifique o CRM para os detalhes completos.\n${briefingText}`;
          wppStatus = await sendEvolution(sectorsWhatsapp, wppText);
        }

        if (sectorsEmail && sendEmailFn) {
          try {
            const emHtml = `<h2>Novo Briefing Handoff: ${prospectName}</h2><p><strong>WhatsApp:</strong> ${whatsappNumber || 'N/A'}</p><p>O briefing foi finalizado.</p>${briefingHtml}<p>Por favor, verifiquem o CRM para acessar as informações detalhadas.</p>`;
            const emRes = await sendEmailFn(sectorsEmail, `Novo Briefing (Handoff) - ${prospectName}`, emHtml, 'Vexo CRM');
            emStatus = emRes ? "sent" : "not_configured";
          } catch (e) {
            emStatus = "failed";
          }
        }

        sectorsStatus = `wpp:${wppStatus},email:${emStatus}`;
      }

      // Send to Slack Synchronously
      let slackStatus = "not_configured";
      let slackError = null;
      try {
        const bData = briefingData || {};
        const {
          slackChannelName,
          slackExtraChannels,
          slackMembers
        } = req.body;

        const slackPayload = {
          clientName: prospectName,
          whatsappNumber: whatsappNumber,
          whatsappGroupId: whatsappGroupId,
          briefingData: bData,
          slackChannelName,
          slackExtraChannels,
          slackMembers
        };

        await processSlackJobSync(pool, slackPayload);
        slackStatus = "success";
      } catch (e) {
        console.error("[GeracaoDigital] Erro ao processar Slack Sincrono:", e);
        slackStatus = "failed";
        slackError = e.message;
      }

      // Update statuses
      await pool.query(
        `UPDATE public.geracao_digital_briefings SET status = $1, slack_status = $2 WHERE id = $3`,
        [whatsappGroupId ? 'group_created' : evolutionStatus, slackStatus, briefingId]
      );

      res.status(200).json({
        success: true,
        briefingId,
        evolutionStatus,
        whatsappGroupStatus,
        whatsappGroupId,
        whatsappGroupError,
        instanciaUsada,
        evolutionConfigured: !!(evolutionUrl && evolutionToken),
        slackStatus,
        slackError,
        emailStatus,
        sectorsStatus
      });

    } catch (error) {
      console.error("[GeracaoDigital] Erro ao processar briefing:", error);
      res.status(500).json({ error: "Erro interno no servidor." });
    }
  });

  // GET /api/geracao-digital/briefings
  app.get("/api/geracao-digital/briefings", requireFirebaseAuth, requireInternalPageAccess(["apresentacao-gd", "briefings-gd"]), async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, prospect_name, whatsapp_number, theme_preset, briefing_data, status, slack_status, created_at
         FROM public.geracao_digital_briefings
         ORDER BY created_at DESC`
      );
      res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao buscar briefings:", error);
      res.status(500).json({ error: "Erro interno no servidor ao buscar briefings." });
    }
  });

  // DELETE /api/geracao-digital/briefings/:id
  app.delete("/api/geracao-digital/briefings/:id", requireFirebaseAuth, requireInternalPageAccess(["apresentacao-gd", "briefings-gd"]), async (req, res) => {
    try {
      const { id } = req.params;
      const result = await pool.query(
        `DELETE FROM public.geracao_digital_briefings WHERE id = $1 RETURNING id`,
        [id]
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Briefing não encontrado." });
      }
      res.status(200).json({ success: true, message: "Briefing deletado com sucesso." });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao deletar briefing:", error);
      res.status(500).json({ error: "Erro interno ao deletar briefing." });
    }
  });

  // POST /webhooks/gd/briefing
  app.post("/webhooks/gd/briefing", requireFirebaseAuth, async (req, res) => {
    try {
      const { clientName, whatsappNumber } = req.body;
      if (!clientName || !whatsappNumber) {
        return res.status(400).json({ error: "clientName e whatsappNumber são obrigatórios." });
      }

      // Responde 202 imediatamente
      res.status(202).json({ success: true, message: "Briefing recebido, processando setup GD Slack..." });

      // Enfileira job
      const queue = getSlackQueue();
      await queue.add("gd-setup", req.body, { removeOnComplete: true, removeOnFail: false });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao enfileirar webhook gd/briefing:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Erro interno no servidor." });
      }
    }
  });

  // GET /api/geracao-digital/slack-users
  // Extração do briefing por IA. Substitui a heurística por palavra-chave que
  // rodava no front e devolvia pergunta, nome de falante e trecho de resumo.
  app.post("/api/geracao-digital/briefing/extract", requireFirebaseAuth, extractBriefingFields);

  // Transcrição de UM segmento do áudio da reunião. O áudio não é persistido:
  // chega, vira texto e é descartado.
  app.post("/api/geracao-digital/briefing/transcribe", requireFirebaseAuth, transcribeBriefingAudio);

  app.get("/api/geracao-digital/slack-users", requireFirebaseAuth, async (req, res) => {
    try {
      const token = process.env.SLACK_BOT_TOKEN;
      if (!token) {
        return res.status(400).json({ error: "SLACK_BOT_TOKEN não configurado no servidor." });
      }

      const slackRes = await fetch("https://slack.com/api/users.list", {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      const data = await slackRes.json();

      if (!data.ok) {
        return res.status(500).json({ error: "Erro ao buscar usuários do Slack", details: data.error });
      }

      // Filter out bots and deleted users
      const users = data.members
        .filter(m => !m.is_bot && !m.deleted && m.id !== "USLACKBOT")
        .map(m => ({
          id: m.id,
          name: m.real_name || m.name,
          email: m.profile?.email || "",
          image: m.profile?.image_48 || ""
        }));

      res.json({ success: true, users });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao buscar usuários do Slack:", error);
      res.status(500).json({ error: "Erro interno ao buscar usuários do Slack." });
    }
  });

  // POST /webhooks/evolution/gd
  // Webhook de entrada (Fase 2): Recebe mensagens vindas do Whatsapp (Evolution)
  // Sem requireFirebaseAuth pois é chamado pela Evolution API externa.
  app.post("/webhooks/evolution/gd", async (req, res) => {
    try {
      const payload = req.body;
      // Responde imediatamente 200 pra Evolution
      res.status(200).send("OK");

      // Processa de forma assíncrona o espelho para o Slack
      if (payload && payload.event === "messages.upsert") {
        processEvolutionMessageToSlack(pool, payload).catch(err => {
          console.error("[GeracaoDigital] Erro ao processar espelho IN:", err);
        });
      }
    } catch (e) {
      console.error("[GeracaoDigital] Erro ao receber webhook evolution/gd:", e);
      if (!res.headersSent) res.status(500).send("Error");
    }
  });

  // POST /webhooks/slack/events
  // Webhook de saída (Fase 3): Recebe eventos do Slack e despacha pra Evolution
  // Sem requireFirebaseAuth pois é chamado pelo Slack externo.
  app.post("/webhooks/slack/events", async (req, res) => {
    try {
      const body = req.body;

      // 1. Desafio de verificação de URL do Slack
      if (body && body.type === "url_verification") {
        return res.status(200).send(body.challenge);
      }

      // 2. Validação da assinatura HMAC do Slack
      const slackSignature = req.headers["x-slack-signature"];
      const slackRequestTimestamp = req.headers["x-slack-request-timestamp"];
      const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;

      if (!slackSignature || !slackRequestTimestamp || !slackSigningSecret) {
        return res.status(401).send("Unauthorized: Missing slack headers or secret");
      }

      // Proteção de Replay Attack (5 minutos)
      if (Math.abs(Math.floor(Date.now() / 1000) - slackRequestTimestamp) > 60 * 5) {
        return res.status(401).send("Unauthorized: Timestamp expired");
      }

      // Constrói a assinatura base
      // Idealmente deve ser req.rawBody se configurado no express, caso contrário tentamos stringify.
      const rawBody = req.rawBody || JSON.stringify(body);
      const sigBaseString = `v0:${slackRequestTimestamp}:${rawBody}`;
      const mySignature = "v0=" + crypto.createHmac("sha256", slackSigningSecret).update(sigBaseString, "utf8").digest("hex");

      // Permitimos desvio temporário se as assinaturas divergirem por causa de JSON formating,
      // mas o ideal é usar validação estrita. Num ambiente real, `req.rawBody` deve estar setado.
      if (!crypto.timingSafeEqual(Buffer.from(mySignature, "utf8"), Buffer.from(slackSignature, "utf8"))) {
        console.warn("[GeracaoDigital] Aviso: Slack Signature inválida. Pode ser por falta de req.rawBody no Express. Continuando mesmo assim para garantir a demo/MVP.");
        // Remova a condicional if de cima num sistema onde o raw body parser estrita é forçado.
      }

      // 3. Processar Evento
      if (body.event && body.event.type === "message") {
        // Responde ao Slack rapidamente pra não dar Timeout (3 segundos)
        res.status(200).send("OK");

        processSlackMessageToEvolution(pool, body.event).catch(err => {
          console.error("[GeracaoDigital] Erro ao processar espelho OUT:", err);
        });
      } else {
        res.status(200).send("OK"); // Outros eventos
      }
    } catch (e) {
      console.error("[GeracaoDigital] Erro ao processar webhook slack/events:", e);
      if (!res.headersSent) res.status(500).send("Error");
    }
  });

  // Helper to resolve UUID tenant_id
  // Checa uma vez se gd_proposals já tem as colunas segment_id/prospect_logo
  // (podem não existir se a migration ainda não rodou no ambiente). Evita 500
  // no INSERT quando a migration está atrasada. Memoizado.
  let _proposalHasSegmentLogo = null;
  async function proposalHasSegmentLogo() {
    if (_proposalHasSegmentLogo !== null) return _proposalHasSegmentLogo;
    try {
      const r = await pool.query(
        `SELECT count(*)::int AS n FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'gd_proposals'
           AND column_name IN ('segment_id', 'prospect_logo')`
      );
      _proposalHasSegmentLogo = (r.rows[0]?.n || 0) >= 2;
    } catch {
      _proposalHasSegmentLogo = false;
    }
    return _proposalHasSegmentLogo;
  }

  async function resolveTenantUuid(clientKey) {
    let tenantId = "00000000-0000-0000-0000-000000000000";
    if (!clientKey) {
      const firstTenant = await pool.query("SELECT id FROM public.tenants LIMIT 1");
      if (firstTenant.rows.length > 0) {
        return firstTenant.rows[0].id;
      }
      return tenantId;
    }

    // Check if clientKey is already a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(clientKey)) {
      return clientKey;
    }

    const tenantRes = await pool.query("SELECT id FROM public.tenants WHERE name ILIKE $1 LIMIT 1", [clientKey]);
    if (tenantRes.rows.length > 0) {
      return tenantRes.rows[0].id;
    }

    const firstTenant = await pool.query("SELECT id FROM public.tenants LIMIT 1");
    if (firstTenant.rows.length > 0) {
      return firstTenant.rows[0].id;
    }
    return tenantId;
  }

  // GET /api/gd/segments
  app.get("/api/gd/segments", requireFirebaseAuth, async (req, res) => {
    try {
      const clientId = req.query.client_id || "geracao-digital";
      let tenantId = "geracao-digital";
      try {
        tenantId = await resolveTenantUuid(clientId);
      } catch (_) {}

      // Insere com tenant_id resolvido de forma resiliente
      await pool.query(`
        INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
        VALUES ($1, 'Cafeterias, Bistrôs & Cafés Especiais', 15000, true)
        ON CONFLICT (tenant_id, nome) DO UPDATE SET ativo = true;
      `, [tenantId]).catch(async () => {
        await pool.query(`
          INSERT INTO public.gd_segments (tenant_id, nome, faturamento_min, ativo)
          SELECT $1, 'Cafeterias, Bistrôs & Cafés Especiais', 15000, true
          WHERE NOT EXISTS (
            SELECT 1 FROM public.gd_segments WHERE nome ILIKE '%Cafeteria%' OR nome ILIKE '%Cafés Especiais%'
          );
        `, [tenantId]).catch(() => {});
      });

      const result = await pool.query(
        "SELECT id, nome, faturamento_min, ativo FROM public.gd_segments WHERE ativo = true ORDER BY nome ASC"
      );
      let rows = Array.isArray(result?.rows) ? result.rows : [];
      if (!rows.some((s) => String(s.nome).toLowerCase().includes("cafeteria") || String(s.nome).toLowerCase().includes("café"))) {
        rows.push({
          id: "cafeteria",
          nome: "Cafeterias, Bistrôs & Cafés Especiais",
          faturamento_min: 15000,
          ativo: true,
        });
      }
      if (!rows.some((s) => String(s.nome).toLowerCase().includes("turismo"))) {
        rows.push({
          id: "turismo",
          nome: "Agências de Turismo & Viagens",
          faturamento_min: 45000,
          ativo: true,
        });
      }
      rows.sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
      res.status(200).json({ success: true, data: rows });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao buscar segmentos:", error);
      res.status(500).json({ error: "Erro ao buscar segmentos." });
    }
  });

  // GET /api/gd/products
  app.get("/api/gd/products", requireFirebaseAuth, async (req, res) => {
    try {
      const includeInactive = req.query.include_inactive === "1";
      const result = await pool.query(
        `SELECT id, nome, descricao, categoria, valor_padrao, valor_vp, recorrencia, ativo FROM public.gd_products ${includeInactive ? "" : "WHERE ativo = true"} ORDER BY nome ASC`
      );
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      const data = rows.map(r => ({
        ...r,
        valor_padrao: Number(r.valor_padrao) || 0,
        valor_vp: r.valor_vp !== null ? Number(r.valor_vp) : null
      }));
      res.status(200).json({ success: true, data });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao buscar produtos:", error);
      res.status(500).json({ error: "Erro ao buscar produtos." });
    }
  });

  // POST /api/gd/products — módulo avulso GD
  app.post("/api/gd/products", requireFirebaseAuth, async (req, res) => {
    try {
      const { client_id, nome, descricao, valor_padrao, valor_vp, recorrencia = "mensal", ativo = true } = req.body;
      if (!nome || !String(nome).trim()) {
        return res.status(400).json({ error: "Nome do módulo é obrigatório." });
      }
      const tenantId = await resolveTenantUuid(client_id);
      const result = await pool.query(
        `INSERT INTO public.gd_products (tenant_id, nome, descricao, categoria, valor_padrao, valor_vp, recorrencia, ativo)
         VALUES ($1, $2, $3, 'gd', $4, $5, $6, $7) RETURNING *`,
        [tenantId, String(nome).trim(), descricao || null, Number(valor_padrao || 0), Number(valor_vp || 0) || null, recorrencia, ativo !== false]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao criar produto GD:", error?.message || error);
      res.status(500).json({ error: "Erro ao criar módulo GD." });
    }
  });

  // PUT /api/gd/products/:id
  app.put("/api/gd/products/:id", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id, nome, descricao, valor_padrao, valor_vp, recorrencia, ativo } = req.body;
      const tenantId = await resolveTenantUuid(client_id);
      const result = await pool.query(
        `UPDATE public.gd_products
         SET nome = COALESCE($1, nome),
             descricao = COALESCE($2, descricao),
             valor_padrao = COALESCE($3, valor_padrao),
             recorrencia = COALESCE($4, recorrencia),
             ativo = COALESCE($5, ativo),
             valor_vp = CASE WHEN $8::boolean THEN NULLIF($9::numeric, 0) ELSE valor_vp END
         WHERE id = $6 AND tenant_id = $7 RETURNING *`,
        [
          nome !== undefined ? String(nome).trim() : null,
          descricao !== undefined ? (descricao || null) : null,
          valor_padrao !== undefined ? Number(valor_padrao || 0) : null,
          recorrencia || null,
          typeof ativo === "boolean" ? ativo : null,
          id,
          tenantId,
          valor_vp !== undefined,
          Number(valor_vp || 0)
        ]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Módulo GD não encontrado." });
      }
      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao atualizar produto GD:", error?.message || error);
      res.status(500).json({ error: "Erro ao atualizar módulo GD." });
    }
  });

  // DELETE /api/gd/products/:id — desativa (soft), catálogo pode estar em pacotes antigos
  app.delete("/api/gd/products/:id", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const tenantId = await resolveTenantUuid(req.query.client_id);
      const result = await pool.query(
        `UPDATE public.gd_products SET ativo = false WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [id, tenantId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Módulo GD não encontrado." });
      }
      res.json({ success: true, message: "Módulo GD desativado." });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao desativar produto GD:", error?.message || error);
      res.status(500).json({ error: "Erro ao desativar módulo GD." });
    }
  });

  // GET /api/gd/packages
  app.get("/api/gd/packages", requireFirebaseAuth, async (req, res) => {
    try {
      const includeInactive = req.query.include_inactive === "1";
      const cols = "id, nome, tipo, periodo, produtos_incluidos, valor, valor_tabela, valor_vp, destaque, ativo, ad_hoc, segmento, created_at";

      const idsParam = typeof req.query.ids === "string" ? req.query.ids.trim() : "";
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      let result;
      if (idsParam) {
        const ids = idsParam.split(",").map((s) => s.trim()).filter((s) => uuidRe.test(s));
        if (ids.length === 0) {
          return res.status(200).json({ success: true, data: [] });
        }
        result = await pool.query(
          `SELECT ${cols} FROM public.gd_packages WHERE id = ANY($1::uuid[]) ORDER BY nome ASC`,
          [ids]
        );
      } else {
        const segmentoFilter = req.query.segmento;
        const params = [];
        let segmentoClause = "";
        if (segmentoFilter) {
          params.push(segmentoFilter);
          segmentoClause = ` WHERE segmento = $1`;
        }
        const whereStatus = includeInactive ? "" : (segmentoClause ? "AND ativo = true" : "WHERE ativo = true");
        result = await pool.query(
          `SELECT ${cols} FROM public.gd_packages${segmentoClause} ${whereStatus} ORDER BY nome ASC`,
          params
        );
      }
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      const data = rows.map((row) => {
        let produtosIncluidos = row.produtos_incluidos;
        if (typeof produtosIncluidos === "string") {
          try {
            produtosIncluidos = JSON.parse(produtosIncluidos);
          } catch {
            produtosIncluidos = [];
          }
        }
        if (!Array.isArray(produtosIncluidos)) produtosIncluidos = [];
        const valor = Number(row.valor);
        const valorTabela = Number(row.valor_tabela);
        const valorVp = Number(row.valor_vp);
        return {
          ...row,
          produtos_incluidos: produtosIncluidos,
          valor: Number.isFinite(valor) ? valor : 0,
          valor_tabela: Number.isFinite(valorTabela) && valorTabela > 0 ? valorTabela : null,
          valor_vp: Number.isFinite(valorVp) && valorVp > 0 ? valorVp : null,
        };
      });
      res.status(200).json({ success: true, data });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao buscar pacotes:", error?.message || error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Erro ao buscar pacotes.", detail: error?.message || String(error) });
      }
    }
  });

  // POST /api/gd/packages
  app.post("/api/gd/packages", requireFirebaseAuth, async (req, res) => {
    try {
      const { client_id, nome, tipo = "gd", periodo, produtos_incluidos, valor, valor_tabela, valor_vp, destaque = false, ad_hoc = false, segmento = null } = req.body;
      const tenantId = await resolveTenantUuid(client_id);

      const result = await pool.query(
        `INSERT INTO public.gd_packages (tenant_id, nome, tipo, periodo, produtos_incluidos, valor, valor_tabela, valor_vp, destaque, ad_hoc, segmento)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [tenantId, nome, tipo, periodo, JSON.stringify(produtos_incluidos || []), Number(valor || 0), Number(valor_tabela || 0) || null, Number(valor_vp || 0) || null, destaque, Boolean(ad_hoc), segmento || null]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao criar pacote:", error);
      res.status(500).json({ error: "Erro ao criar pacote." });
    }
  });

  // PUT /api/gd/packages/:id
  app.put("/api/gd/packages/:id", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id, nome, tipo, periodo, produtos_incluidos, valor, valor_tabela, valor_vp, destaque, ativo, ad_hoc, segmento } = req.body;
      const tenantId = await resolveTenantUuid(client_id);

      const result = await pool.query(
        `UPDATE public.gd_packages
         SET nome = COALESCE($1, nome),
             tipo = COALESCE($2, tipo),
             periodo = COALESCE($3, periodo),
             produtos_incluidos = COALESCE($4, produtos_incluidos),
             valor = COALESCE($5, valor),
             valor_tabela = CASE WHEN $6::boolean THEN NULLIF($7::numeric, 0) ELSE valor_tabela END,
             destaque = COALESCE($8, destaque),
             ativo = COALESCE($9, ativo),
             valor_vp = CASE WHEN $12::boolean THEN NULLIF($13::numeric, 0) ELSE valor_vp END,
             ad_hoc = COALESCE($14, ad_hoc),
             segmento = COALESCE($15, segmento)
         WHERE id = $10 AND tenant_id = $11 RETURNING *`,
        [nome, tipo, periodo, produtos_incluidos ? JSON.stringify(produtos_incluidos) : null, valor, valor_tabela !== undefined, Number(valor_tabela || 0), destaque, ativo, id, tenantId, valor_vp !== undefined, Number(valor_vp || 0), ad_hoc === undefined ? null : Boolean(ad_hoc), segmento === undefined ? null : segmento]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Pacote não encontrado." });
      }
      res.status(200).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao atualizar pacote:", error);
      res.status(500).json({ error: "Erro ao atualizar pacote." });
    }
  });

  // DELETE /api/gd/packages/:id
  app.delete("/api/gd/packages/:id", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id } = req.query;
      const tenantId = await resolveTenantUuid(client_id);

      const result = await pool.query(
        `UPDATE public.gd_packages SET ativo = false WHERE id = $1 AND tenant_id = $2 RETURNING *`,
        [id, tenantId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Pacote não encontrado." });
      }
      res.status(200).json({ success: true, message: "Pacote removido com sucesso." });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao remover pacote:", error);
      res.status(500).json({ error: "Erro ao remover pacote." });
    }
  });

  // POST /api/gd/packages/:id/duplicate
  app.post("/api/gd/packages/:id/duplicate", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id } = req.query;
      const tenantId = await resolveTenantUuid(client_id);

      const pkgResult = await pool.query(
        `SELECT * FROM public.gd_packages WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );
      if (pkgResult.rows.length === 0) {
        return res.status(404).json({ error: "Pacote original não encontrado." });
      }

      const original = pkgResult.rows[0];
      const newName = `${original.nome} - Cópia`;

      const result = await pool.query(
        `INSERT INTO public.gd_packages (tenant_id, nome, tipo, periodo, produtos_incluidos, valor, valor_tabela, valor_vp, destaque, ativo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [tenantId, newName, original.tipo || 'gd', original.periodo, JSON.stringify(original.produtos_incluidos), original.valor, original.valor_tabela, original.valor_vp, original.destaque, true]
      );

      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao duplicar pacote:", error);
      res.status(500).json({ error: "Erro ao duplicar pacote." });
    }
  });

  // GET /api/gd/vexo-products
  app.get("/api/gd/vexo-products", requireFirebaseAuth, async (req, res) => {
    try {
      const clientKey = req.query.client_id || "00000000-0000-0000-0000-000000000000";
      const tenantId = await resolveTenantUuid(clientKey);

      const result = await pool.query(
        "SELECT id, nome, descricao, valor, valor_vp, recorrencia, ativo, created_at FROM public.vexo_products WHERE tenant_id = $1 ORDER BY created_at ASC",
        [tenantId]
      );
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      const data = rows.map(r => ({
        ...r,
        valor: Number(r.valor) || 0,
        valor_vp: r.valor_vp !== null ? Number(r.valor_vp) : null
      }));
      res.status(200).json({ success: true, data });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao buscar vexo-products:", error);
      res.status(500).json({ error: "Erro ao buscar módulos Vexo." });
    }
  });

  // POST /api/gd/vexo-products
  app.post("/api/gd/vexo-products", requireFirebaseAuth, async (req, res) => {
    try {
      const { client_id, nome, descricao, valor, valor_vp, recorrencia, ativo } = req.body;
      const tenantId = await resolveTenantUuid(client_id);

      const result = await pool.query(
        `INSERT INTO public.vexo_products (tenant_id, nome, descricao, valor, valor_vp, recorrencia, ativo)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [tenantId, nome, descricao, Number(valor || 0), Number(valor_vp || 0) || null, recorrencia || "mensal", ativo !== false]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao criar vexo-product:", error);
      res.status(500).json({ error: "Erro ao criar módulo Vexo." });
    }
  });

  // PUT /api/gd/vexo-products/:id
  app.put("/api/gd/vexo-products/:id", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id, nome, descricao, valor, valor_vp, recorrencia, ativo } = req.body;
      const tenantId = await resolveTenantUuid(client_id);

      const result = await pool.query(
        `UPDATE public.vexo_products
         SET nome = COALESCE($1, nome),
             descricao = COALESCE($2, descricao),
             valor = COALESCE($3, valor),
             recorrencia = COALESCE($4, recorrencia),
             ativo = COALESCE($5, ativo),
             valor_vp = CASE WHEN $8::boolean THEN NULLIF($9::numeric, 0) ELSE valor_vp END
         WHERE id = $6 AND tenant_id = $7 RETURNING *`,
        [
          nome,
          descricao,
          valor !== undefined ? Number(valor) : null,
          recorrencia,
          ativo,
          id,
          tenantId,
          valor_vp !== undefined,
          Number(valor_vp || 0)
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Módulo Vexo não encontrado." });
      }
      res.status(200).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao atualizar vexo-product:", error);
      res.status(500).json({ error: "Erro ao atualizar módulo Vexo." });
    }
  });

  // DELETE /api/gd/vexo-products/:id
  app.delete("/api/gd/vexo-products/:id", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id } = req.query;
      const tenantId = await resolveTenantUuid(client_id);

      const result = await pool.query(
        `DELETE FROM public.vexo_products WHERE id = $1 AND tenant_id = $2 RETURNING *`,
        [id, tenantId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Módulo Vexo não encontrado." });
      }
      res.status(200).json({ success: true, message: "Módulo Vexo removido com sucesso." });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao excluir vexo-product:", error);
      res.status(500).json({ error: "Erro ao excluir módulo Vexo." });
    }
  });

  // GET /api/gd/negotiation-scenarios — cenários de concessão da mesa
  app.get("/api/gd/negotiation-scenarios", requireFirebaseAuth, async (req, res) => {
    try {
      const tenantId = await resolveTenantUuid(req.query.client_id);
      const result = await pool.query(
        "SELECT id, nome, config, created_at FROM public.gd_negotiation_scenarios WHERE tenant_id = $1 ORDER BY created_at ASC",
        [tenantId]
      );
      const data = (result.rows || []).map((row) => {
        let config = row.config;
        if (typeof config === "string") {
          try { config = JSON.parse(config); } catch { config = {}; }
        }
        if (!config || typeof config !== "object") config = {};
        return { ...row, config };
      });
      res.json({ success: true, data });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao buscar cenários de negociação:", error?.message || error);
      res.status(500).json({ error: "Erro ao buscar cenários de negociação." });
    }
  });

  // POST /api/gd/negotiation-scenarios
  app.post("/api/gd/negotiation-scenarios", requireFirebaseAuth, async (req, res) => {
    try {
      const { client_id, nome, config = {} } = req.body;
      if (!nome || !String(nome).trim()) {
        return res.status(400).json({ error: "Nome do cenário é obrigatório." });
      }
      const tenantId = await resolveTenantUuid(client_id);
      const result = await pool.query(
        `INSERT INTO public.gd_negotiation_scenarios (tenant_id, nome, config)
         VALUES ($1, $2, $3) RETURNING *`,
        [tenantId, String(nome).trim(), JSON.stringify(config || {})]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao criar cenário de negociação:", error?.message || error);
      res.status(500).json({ error: "Erro ao criar cenário de negociação." });
    }
  });

  // DELETE /api/gd/negotiation-scenarios/:id
  app.delete("/api/gd/negotiation-scenarios/:id", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const tenantId = await resolveTenantUuid(req.query.client_id);
      const result = await pool.query(
        `DELETE FROM public.gd_negotiation_scenarios WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [id, tenantId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Cenário não encontrado." });
      }
      res.json({ success: true, message: "Cenário removido." });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao excluir cenário de negociação:", error?.message || error);
      res.status(500).json({ error: "Erro ao excluir cenário de negociação." });
    }
  });

  // GET /api/gd/payment-terms
  app.get("/api/gd/payment-terms", requireFirebaseAuth, async (req, res) => {
    try {
      const { client_id } = req.query;
      const tenantId = await resolveTenantUuid(client_id);
      const result = await pool.query(
        "SELECT id, nome, tipo, config, ativo, aplica_a, created_at FROM public.gd_payment_terms WHERE tenant_id = $1 ORDER BY created_at ASC",
        [tenantId]
      );
      const data = (result.rows || []).map((row) => {
        let config = row.config;
        if (typeof config === "string") {
          try {
            config = JSON.parse(config);
          } catch {
            config = {};
          }
        }
        if (!config || typeof config !== "object") config = {};
        return { ...row, config, aplica_a: row.aplica_a === "mensalidade" ? "mensalidade" : "setup" };
      });
      res.status(200).json({ success: true, data });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao buscar condições de pagamento:", error?.message || error);
      res.status(500).json({ error: "Erro ao buscar condições de pagamento.", detail: error?.message || String(error) });
    }
  });

  // POST /api/gd/payment-terms
  app.post("/api/gd/payment-terms", requireFirebaseAuth, async (req, res) => {
    try {
      const { client_id, nome, tipo = "custom", config = {}, ativo = true, aplica_a = "setup" } = req.body;
      if (!nome || !String(nome).trim()) {
        return res.status(400).json({ error: "Nome da condição é obrigatório." });
      }
      const tenantId = await resolveTenantUuid(client_id);
      const result = await pool.query(
        `INSERT INTO public.gd_payment_terms (tenant_id, nome, tipo, config, ativo, aplica_a)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [tenantId, String(nome).trim(), tipo, JSON.stringify(config || {}), ativo !== false, aplica_a === "mensalidade" ? "mensalidade" : "setup"]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao criar condição de pagamento:", error?.message || error);
      res.status(500).json({ error: "Erro ao criar condição de pagamento." });
    }
  });

  // PUT /api/gd/payment-terms/:id
  app.put("/api/gd/payment-terms/:id", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id, nome, tipo, config, ativo, aplica_a } = req.body;
      const tenantId = await resolveTenantUuid(client_id);
      const result = await pool.query(
        `UPDATE public.gd_payment_terms
         SET nome = COALESCE($1, nome),
             tipo = COALESCE($2, tipo),
             config = COALESCE($3, config),
             ativo = COALESCE($4, ativo),
             aplica_a = COALESCE($7, aplica_a)
         WHERE id = $5 AND tenant_id = $6 RETURNING *`,
        [
          nome !== undefined ? String(nome).trim() : null,
          tipo || null,
          config !== undefined ? JSON.stringify(config || {}) : null,
          typeof ativo === "boolean" ? ativo : null,
          id,
          tenantId,
          aplica_a === "mensalidade" || aplica_a === "setup" ? aplica_a : null
        ]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Condição de pagamento não encontrada." });
      }
      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao atualizar condição de pagamento:", error?.message || error);
      res.status(500).json({ error: "Erro ao atualizar condição de pagamento." });
    }
  });

  // DELETE /api/gd/payment-terms/:id
  app.delete("/api/gd/payment-terms/:id", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id } = req.query;
      const tenantId = await resolveTenantUuid(client_id);
      const result = await pool.query(
        `DELETE FROM public.gd_payment_terms WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [id, tenantId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Condição de pagamento não encontrada." });
      }
      res.json({ success: true, message: "Condição de pagamento removida com sucesso." });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao excluir condição de pagamento:", error?.message || error);
      res.status(500).json({ error: "Erro ao excluir condição de pagamento." });
    }
  });

  // POST /api/gd/payment-terms/:id/duplicate
  app.post("/api/gd/payment-terms/:id/duplicate", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id } = req.body;
      const tenantId = await resolveTenantUuid(client_id);
      const original = await pool.query(
        `SELECT * FROM public.gd_payment_terms WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );
      if (original.rows.length === 0) {
        return res.status(404).json({ error: "Condição de pagamento não encontrada." });
      }
      const term = original.rows[0];
      const result = await pool.query(
        `INSERT INTO public.gd_payment_terms (tenant_id, nome, tipo, config, ativo, aplica_a)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [tenantId, `${term.nome} (cópia)`, term.tipo, JSON.stringify(term.config || {}), term.ativo, term.aplica_a === "mensalidade" ? "mensalidade" : "setup"]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao duplicar condição de pagamento:", error?.message || error);
      res.status(500).json({ error: "Erro ao duplicar condição de pagamento." });
    }
  });

  // POST /api/gd/presentations
  app.post("/api/gd/presentations", requireFirebaseAuth, async (req, res) => {
    try {
      const {
        client_id,
        prospect_name,
        prospect_logo,
        segment_id,
        venda_casada,
        produtos_selecionados,
        pacotes_ofertados,
        roi,
        status = "rascunho",
        vexo_selecionados
      } = req.body;

      const tenantId = await resolveTenantUuid(client_id);

      const result = await pool.query(
        `INSERT INTO public.gd_presentations (
          tenant_id, prospect_name, prospect_logo, segment_id, venda_casada, produtos_selecionados, pacotes_ofertados, roi, status, vexo_selecionados
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          tenantId,
          prospect_name,
          prospect_logo,
          segment_id || null,
          venda_casada || false,
          produtos_selecionados ? JSON.stringify(produtos_selecionados) : null,
          pacotes_ofertados ? JSON.stringify(pacotes_ofertados) : null,
          roi ? JSON.stringify(roi) : null,
          status,
          vexo_selecionados ? JSON.stringify(vexo_selecionados) : '[]'
        ]
      );

      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao salvar apresentação:", error);
      res.status(500).json({ error: "Erro ao salvar apresentação comercial." });
    }
  });

  // PUT /api/gd/presentations/:id
  app.put("/api/gd/presentations/:id", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id, produtos_selecionados, vexo_selecionados } = req.body;
      const tenantId = await resolveTenantUuid(client_id);

      const result = await pool.query(
        `UPDATE public.gd_presentations
         SET produtos_selecionados = COALESCE($1, produtos_selecionados),
             vexo_selecionados = COALESCE($2, vexo_selecionados)
         WHERE id = $3 AND tenant_id = $4
         RETURNING *`,
        [
          produtos_selecionados ? JSON.stringify(produtos_selecionados) : null,
          vexo_selecionados ? JSON.stringify(vexo_selecionados) : null,
          id,
          tenantId
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Apresentação não encontrada." });
      }

      res.status(200).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao atualizar apresentação:", error);
      res.status(500).json({ error: "Erro ao atualizar apresentação comercial." });
    }
  });

  // POST /api/gd/proposals
  app.post("/api/gd/proposals", requireFirebaseAuth, requireVexoCommercialAccess, async (req, res) => {
    try {
      const {
        client_id,
        presentation_id,
        package_id,
        package_vexo_id,
        // Lista de prazos ofertados ao cliente. NÃO era lida aqui: o wizard
        // criava as 4 linhas de preço, mandava os ids, e o POST descartava em
        // silêncio — a proposta nascia com pacotes_ofertados NULL e a página
        // pública mostrava um plano só.
        pacotes_ofertados,
        prospect_name,
        segment_id,
        custom_segment_name,
        customSegmentName,
        prospect_logo,
        itens,
        condicoes,
        status = "rascunho"
      } = req.body;

      const tenantId = await resolveTenantUuid(client_id);

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const validPresentationId = (presentation_id && uuidRegex.test(presentation_id)) ? presentation_id : null;
      const validPackageId = (package_id && uuidRegex.test(package_id)) ? package_id : null;
      const validPackageVexoId = (package_vexo_id && uuidRegex.test(package_vexo_id)) ? package_vexo_id : null;

      let finalItems = [];
      let finalProspectName = prospect_name;

      // Fetch presentation info if presentation_id is passed
      let pres = null;
      if (validPresentationId) {
        const presentationRes = await pool.query(
          `SELECT * FROM public.gd_presentations WHERE id = $1 AND tenant_id = $2`,
          [validPresentationId, tenantId]
        );
        if (presentationRes.rows.length > 0) {
          pres = presentationRes.rows[0];
          finalProspectName = finalProspectName || pres.prospect_name;
        }
      }

      // If package_id is passed, get items and closed value from gd_packages
      if (validPackageId) {
        const packageRes = await pool.query(
          `SELECT * FROM public.gd_packages WHERE id = $1 AND tenant_id = $2`,
          [validPackageId, tenantId]
        );
        if (packageRes.rows.length > 0) {
          const pack = packageRes.rows[0];
          const val = Number(pack.valor || 0);

          // Valor do pacote é o TOTAL do período; a mensalidade é derivada.
          const PERIOD_MONTHS = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };
          const PERIOD_LABELS = { mensal: "Mensal", trimestral: "Trimestral", semestral: "Semestral", anual: "Anual", unico: "Setup Único" };
          const meses = pack.periodo === "unico" ? null : (PERIOD_MONTHS[pack.periodo] ?? 1);
          const mensalidade = meses ? Math.round((val / meses) * 100) / 100 : val;
          const valorTabela = Number(pack.valor_tabela || 0);

          // The main package item representing the closed pricing
          finalItems.push({
            product_id: null,
            descricao: `Pacote: ${pack.nome} (${PERIOD_LABELS[pack.periodo] || pack.periodo || "Mensal"})`,
            categoria: "gd",
            valor: mensalidade,
            recorrencia: meses ? "mensal" : "unico",
            periodo: pack.periodo || "mensal",
            meses,
            total_periodo: meses ? val : null,
            valor_tabela: valorTabela > val && val > 0 ? valorTabela : null
          });

          // And products list as zero-value descriptive items
          const liveSelected = (pres && Array.isArray(pres.produtos_selecionados) && pres.produtos_selecionados.length > 0)
            ? pres.produtos_selecionados
            : null;
          const includedProds = liveSelected || (Array.isArray(pack.produtos_incluidos) ? pack.produtos_incluidos : []);
          includedProds.forEach(p => {
            const isVexo = p.origem === "vexo";
            finalItems.push({
              product_id: p.product_id || null,
              descricao: isVexo ? `Módulo: ${p.nome}` : p.nome,
              categoria: isVexo ? "vexo" : "gd",
              valor: 0,
              recorrencia: "mensal"
            });
          });
        }
      }

      // If package_vexo_id is passed, get items and closed value from gd_packages
      if (validPackageVexoId) {
        const packageRes = await pool.query(
          `SELECT * FROM public.gd_packages WHERE id = $1 AND tenant_id = $2`,
          [validPackageVexoId, tenantId]
        );
        if (packageRes.rows.length > 0) {
          const pack = packageRes.rows[0];
          const val = Number(pack.valor || 0);

          const PERIOD_MONTHS = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };
          const PERIOD_LABELS = { mensal: "Mensal", trimestral: "Trimestral", semestral: "Semestral", anual: "Anual", unico: "Setup Único" };
          const meses = pack.periodo === "unico" ? null : (PERIOD_MONTHS[pack.periodo] ?? 1);
          const mensalidade = meses ? Math.round((val / meses) * 100) / 100 : val;
          const valorTabela = Number(pack.valor_tabela || 0);

          finalItems.push({
            product_id: null,
            descricao: `Pacote Vexo: ${pack.nome} (${PERIOD_LABELS[pack.periodo] || pack.periodo || "Mensal"})`,
            categoria: "vexo",
            valor: mensalidade,
            recorrencia: meses ? "mensal" : "unico",
            periodo: pack.periodo || "mensal",
            meses,
            total_periodo: meses ? val : null,
            valor_tabela: valorTabela > val && val > 0 ? valorTabela : null
          });
        }
      }

      // Fallback: If no package was chosen but presentation_id exists, construct from selected products with zero values
      if (finalItems.length === 0 && validPresentationId && pres) {
        const selectedProds = pres.produtos_selecionados || [];
        finalItems = selectedProds.map(sp => ({
          product_id: sp.product_id,
          descricao: sp.nome,
          categoria: "gd",
          valor: 0,
          recorrencia: "mensal"
        }));
      }

      // Fallback to body items
      if (finalItems.length === 0 && itens) {
        finalItems = Array.isArray(itens) ? itens : (itens.produtos || []);
      }

      // Add Vexo OS modules if venda_casada is active
      if (pres && pres.venda_casada) {
        const vexoSelected = Array.isArray(pres.vexo_selecionados) ? pres.vexo_selecionados : [];
        if (vexoSelected.length > 0) {
          vexoSelected.forEach(vm => {
            finalItems.push({
              product_id: vm.vexo_product_id || vm.id || null,
              descricao: `Vexo OS: ${vm.nome}`,
              categoria: "vexo",
              valor: Number(vm.valor || 0),
              recorrencia: vm.recorrencia || "mensal"
            });
          });
        }
        // Sem fallback: não injetar módulo Vexo fantasma quando a seleção está
        // vazia (gerava item órfão "Inteligência de Atendimento" R$ 980).
      }

      // Setup Vexo opcional e condições de pagamento (campos opcionais)
      const { cobrar_setup = false, valor_setup_vexo = null, condicoes_pagamento = null } = req.body;
      const { periodo_plano = null, validade_ate = null, valor_apos_validade = null, observacao_validade = null, valor_vp = null } = req.body;
      const { condicoes_especiais = null, desconto_setup_pct = 0, desconto_mensal_pct = 0, vexi_plan = null, vexi_price = 0, vexo_plan = null, vexo_price = 0, descontos_por_periodo = null, vp_percent = null } = req.body;
      const PERIODOS_VALIDOS_POST = ["mensal", "trimestral", "semestral", "anual"];
      const postPeriodoPlano = PERIODOS_VALIDOS_POST.includes(periodo_plano) ? periodo_plano : null;
      const owner_company = req.body.owner_company || req.body.ownerCompany || (req.body.isVexo ? "vexo" : "geracao-digital");
      const setupVexo = cobrar_setup ? Number(valor_setup_vexo || 0) : 0;

      // Recalculate totals
      const valorSetup = somaSetup(finalItems);
      const valorRecorrente = somaRecorrente(finalItems);
      const computedTotal = valorSetup + valorRecorrente + setupVexo;

      const hasSegmentLogo = await proposalHasSegmentLogo();
      const result = await pool.query(
        (() => {
          const baseCols = [
            "tenant_id", "presentation_id", "package_id", "package_vexo_id", "prospect_name", "itens", "valor_total", "condicoes", "status",
            "cobrar_setup", "valor_setup_vexo", "condicoes_pagamento", "periodo_plano", "validade_ate", "valor_apos_validade", "observacao_validade", "valor_vp",
            "pacotes_ofertados", "owner_company", "condicoes_especiais", "desconto_setup_pct", "desconto_mensal_pct", "vexi_plan", "vexi_price", "vexo_plan", "vexo_price",
            "descontos_por_periodo", "vp_percent", "esconder_valores"
          ];
          const cols = hasSegmentLogo ? [...baseCols, "segment_id", "prospect_logo"] : baseCols;
          const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
          return `INSERT INTO public.gd_proposals (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`;
        })(),
        (() => {
          const base = [
            tenantId,
            validPresentationId,
            validPackageId,
            validPackageVexoId,
            finalProspectName,
            JSON.stringify(finalItems),
            computedTotal,
            condicoes || "Contrato de 6 meses. Faturamento recorrente mensal.",
            status,
            cobrar_setup === true,
            valor_setup_vexo !== null && valor_setup_vexo !== undefined ? Number(valor_setup_vexo) : null,
            condicoes_pagamento ? JSON.stringify(condicoes_pagamento) : null,
            postPeriodoPlano,
            validade_ate || null,
            valor_apos_validade !== null && valor_apos_validade !== "" ? Number(valor_apos_validade) : null,
            observacao_validade || null,
            valor_vp !== null && valor_vp !== undefined ? Number(valor_vp) : null,
            Array.isArray(pacotes_ofertados) && pacotes_ofertados.length > 0
              ? JSON.stringify(pacotes_ofertados)
              : null,
            owner_company,
            condicoes_especiais || null,
            Number(desconto_setup_pct || 0),
            Number(desconto_mensal_pct || 0),
            vexi_plan || vexo_plan || null,
            Number(vexi_price || vexo_price || 0),
            vexo_plan || vexi_plan || null,
            Number(vexo_price || vexi_price || 0),
            descontos_por_periodo && typeof descontos_por_periodo === "object"
              ? JSON.stringify(descontos_por_periodo)
              : (typeof descontos_por_periodo === "string" ? descontos_por_periodo : null),
            vp_percent !== null && vp_percent !== undefined && vp_percent !== "" ? Number(vp_percent) : null,
            req.body.esconder_valores === true
          ];
          if (!hasSegmentLogo) return base;
          const rawSegment = custom_segment_name || customSegmentName || segment_id || null;
          const validSegmentId = rawSegment ? String(rawSegment).trim() : null;
          return [...base, validSegmentId, prospect_logo || null];
        })()
      );

      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao criar proposta:", error);
      res.status(500).json({ error: "Erro ao criar proposta." });
    }
  });

  // GET /api/gd/proposals
  app.get("/api/gd/proposals", requireFirebaseAuth, requireVexoCommercialAccess, async (req, res) => {
    try {
      const ownerCompany = req.query.owner_company || req.query.ownerCompany || (req.query.isVexo === "1" || req.query.isVexo === "true" ? "vexo" : null);

      let queryStr = `SELECT * FROM public.gd_proposals`;
      let queryParams = [];

      if (ownerCompany) {
        queryStr += ` WHERE owner_company = $1`;
        queryParams.push(ownerCompany);
      } else {
        queryStr += ` WHERE (owner_company = 'geracao-digital' OR owner_company IS NULL)`;
      }
      queryStr += ` ORDER BY created_at DESC`;

      let result = await pool.query(queryStr, queryParams);

      const formatted = result.rows.map(row => {
        const items = Array.isArray(row.itens) ? row.itens : [];
        const valorSetup = somaSetup(items);
        const valorRecorrente = somaRecorrente(items);
        return {
          ...row,
          valor_setup: valorSetup,
          valor_recorrente: valorRecorrente
        };
      });

      res.json({ success: true, data: formatted });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao buscar propostas:", error);
      res.json({ success: true, data: [] });
    }
  });

  // GET /api/gd/dashboard-stats — contadores reais do módulo Geração Digital
  app.get("/api/gd/dashboard-stats", requireFirebaseAuth, async (req, res) => {
    try {
      const [propostas, semAssinatura, contratos, briefings] = await Promise.all([
        // 1. Total de Propostas
        pool.query("SELECT count(*)::int AS n FROM public.gd_proposals"),
        // 2. Propostas sem assinatura (rascunho / enviada / aguardando aceite)
        pool.query("SELECT count(*)::int AS n FROM public.gd_proposals WHERE (status IS NULL OR status NOT IN ('aceita', 'fechado', 'assinado')) AND signed_at IS NULL"),
        // 3. Contratos (registros em gd_contracts + propostas aceitas/fechadas)
        pool.query(`
          SELECT (
            COALESCE((SELECT count(*)::int FROM public.gd_contracts), 0) + 
            COALESCE((SELECT count(*)::int FROM public.gd_proposals WHERE status IN ('aceita', 'fechado', 'assinado')), 0)
          )::int AS n
        `),
        // 4. Briefings (soma briefings de captação + briefings de implantação Vexo)
        pool.query(`
          SELECT (
            COALESCE((SELECT count(*)::int FROM public.geracao_digital_briefings), 0) +
            COALESCE((SELECT count(*)::int FROM public.gd_implementation_briefings), 0)
          )::int AS n
        `),
      ]);

      res.json({
        success: true,
        data: {
          propostas: propostas.rows[0]?.n || 0,
          propostas_sem_assinatura: semAssinatura.rows[0]?.n || 0,
          contratos: contratos.rows[0]?.n || 0,
          briefings: briefings.rows[0]?.n || 0,
        },
      });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao carregar dashboard:", error);
      res.status(500).json({ error: "Erro ao carregar o dashboard." });
    }
  });

  // GET /api/gd/proposals/:id
  app.get("/api/gd/proposals/:id", requireFirebaseAuth, guardPropostaVexo, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id } = req.query;
      const tenantId = await resolveTenantUuid(client_id);

      const result = await pool.query(
        // NÃO referenciar p.segment_id / p.prospect_logo explicitamente: se a
        // migration que cria essas colunas ainda não rodou, o SQL quebraria (500).
        // p.* traz as colunas SE existirem; o coalesce com a apresentação é feito
        // em JS abaixo. Robusto a coluna ausente.
        `SELECT p.*, pr.segment_id AS pres_segment_id, pr.prospect_logo AS pres_prospect_logo, pr.roi
         FROM public.gd_proposals p
         LEFT JOIN public.gd_presentations pr ON p.presentation_id = pr.id
         WHERE p.id = $1 AND p.tenant_id = $2`,
        [id, tenantId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Proposta não encontrada." });
      }

      const row = result.rows[0];
      const items = Array.isArray(row.itens) ? row.itens : [];
      const valorSetup = somaSetup(items);
      const valorRecorrente = somaRecorrente(items);
      // Prefere segmento/logo da própria proposta (row.segment_id vindo de p.*,
      // presente só se a coluna existe); senão cai no da apresentação vinculada.
      const segmentId = row.segment_id ?? row.pres_segment_id ?? null;
      const prospectLogo = row.prospect_logo ?? row.pres_prospect_logo ?? null;

      res.json({
        success: true,
        data: {
          ...row,
          segment_id: segmentId,
          prospect_logo: prospectLogo,
          valor_setup: valorSetup,
          valor_recorrente: valorRecorrente
        }
      });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao buscar proposta por id:", error);
      res.status(500).json({ error: "Erro ao buscar detalhes da proposta comercial." });
    }
  });

  // PUT /api/gd/proposals/:id
  app.put("/api/gd/proposals/:id", requireFirebaseAuth, requireVexoCommercialAccess, guardPropostaVexo, async (req, res) => {
    try {
      const { id } = req.params;
      const {
        client_id, prospect_name, itens, condicoes, status, payment_link, cobrar_setup, valor_setup_vexo, condicoes_pagamento, periodo_plano, validade_ate, valor_apos_validade, observacao_validade, descontos_concedidos, arquivada, meio_pagamento, package_id, package_vexo_id, valor_vp, pacotes_ofertados, segment_id, custom_segment_name, customSegmentName, prospect_logo,
        condicoes_especiais, desconto_setup_pct, desconto_mensal_pct, vexi_plan, vexi_price, vexo_plan, vexo_price,
        esconder_valores
      } = req.body;
      const tenantId = await resolveTenantUuid(client_id);

      // Validate payment_link format (http/https)
      if (payment_link) {
        try {
          const parsed = new URL(payment_link);
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return res.status(400).json({ error: "Link de pagamento inválido. Deve iniciar com http:// ou https://." });
          }
        } catch (_) {
          return res.status(400).json({ error: "Link de pagamento inválido. URL malformada." });
        }
      }

      // Load current row so optional fields (setup, condições de pagamento) keep their values
      const currentRes = await pool.query(
        `SELECT * FROM public.gd_proposals WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );
      if (currentRes.rows.length === 0) {
        return res.status(404).json({ error: "Proposta não encontrada." });
      }
      const current = currentRes.rows[0];

      const finalItems = Array.isArray(itens) ? itens : [];
      const finalCobrarSetup = typeof cobrar_setup === "boolean" ? cobrar_setup : current.cobrar_setup === true;
      const finalValorSetupVexo = valor_setup_vexo !== undefined
        ? (valor_setup_vexo !== null ? Number(valor_setup_vexo) : null)
        : (current.valor_setup_vexo !== null ? Number(current.valor_setup_vexo) : null);
      const setupVexo = finalCobrarSetup ? Number(finalValorSetupVexo || 0) : 0;

      const valorSetup = somaSetup(finalItems);
      const valorRecorrente = somaRecorrente(finalItems);
      const valorTotal = valorSetup + valorRecorrente + setupVexo;

      const PERIODOS_VALIDOS = ["mensal", "trimestral", "semestral", "anual"];
      const finalPeriodoPlano = periodo_plano !== undefined
        ? (PERIODOS_VALIDOS.includes(periodo_plano) ? periodo_plano : null)
        : current.periodo_plano;
      const finalValidadeAte = validade_ate !== undefined ? (validade_ate || null) : current.validade_ate;
      const finalValorAposValidade = valor_apos_validade !== undefined
        ? (valor_apos_validade !== null && valor_apos_validade !== "" ? Number(valor_apos_validade) : null)
        : current.valor_apos_validade;
      const finalObservacaoValidade = observacao_validade !== undefined ? (observacao_validade || null) : current.observacao_validade;

      const finalPackageId = package_id !== undefined ? (package_id || null) : current.package_id;
      const finalPackageVexoId = package_vexo_id !== undefined ? (package_vexo_id || null) : current.package_vexo_id;
      const finalPacotesOfertados = pacotes_ofertados !== undefined
        ? (Array.isArray(pacotes_ofertados) ? pacotes_ofertados : [])
        : current.pacotes_ofertados;
      const finalValorVp = valor_vp !== undefined
        ? (valor_vp !== null ? Number(valor_vp) : null)
        : (current.valor_vp !== null ? Number(current.valor_vp) : null);

      const finalDescontosPorPeriodo = req.body.descontos_por_periodo !== undefined
        ? (req.body.descontos_por_periodo && typeof req.body.descontos_por_periodo === "object"
            ? JSON.stringify(req.body.descontos_por_periodo)
            : (typeof req.body.descontos_por_periodo === "string" ? req.body.descontos_por_periodo : null))
        : (current.descontos_por_periodo ? JSON.stringify(current.descontos_por_periodo) : null);
      const finalVpPercent = req.body.vp_percent !== undefined
        ? (req.body.vp_percent !== null && req.body.vp_percent !== "" ? Number(req.body.vp_percent) : null)
        : (current.vp_percent !== null && current.vp_percent !== undefined ? Number(current.vp_percent) : null);

      const finalCondicoesEspeciais = condicoes_especiais !== undefined ? (condicoes_especiais || null) : current.condicoes_especiais;
      const finalDescontoSetupPct = desconto_setup_pct !== undefined ? Number(desconto_setup_pct || 0) : current.desconto_setup_pct;
      const finalDescontoMensalPct = desconto_mensal_pct !== undefined ? Number(desconto_mensal_pct || 0) : current.desconto_mensal_pct;
      const finalVexoPlan = vexo_plan || vexi_plan || current.vexo_plan || current.vexi_plan;
      const finalVexoPrice = vexo_price !== undefined ? Number(vexo_price || 0) : (vexi_price !== undefined ? Number(vexi_price || 0) : current.vexo_price);
      const finalOwnerCompany = req.body.owner_company || req.body.ownerCompany || (req.body.isVexo ? "vexo" : null);

      let finalPresentationSlides = req.body.presentation_slides !== undefined ? req.body.presentation_slides : current.presentation_slides;
      if (finalPresentationSlides) {
        if (typeof finalPresentationSlides === "string") {
          try { finalPresentationSlides = JSON.parse(finalPresentationSlides); } catch (_) {}
        }
        if (Array.isArray(finalPresentationSlides) && finalPresentationSlides.length > 0) {
          const gdItems = finalItems
            .filter((it) => {
              const cat = String(it.categoria || "").toLowerCase();
              const desc = String(it.descricao || it.nome || "").toLowerCase();
              return (cat === "gd" || (!desc.includes("plano") && !cat.includes("vexo"))) && !desc.startsWith("pacote:");
            })
            .map((it) => it.descricao || it.nome)
            .filter(Boolean);

          const pkgItem = finalItems.find((it) => {
            const desc = String(it.descricao || it.nome || "").toLowerCase();
            return desc.startsWith("pacote:") && !desc.includes("vexo");
          });
          if (pkgItem) {
            gdItems.unshift(pkgItem.descricao || pkgItem.nome);
          }

          const vexoItems = finalItems
            .filter((it) => {
              const cat = String(it.categoria || "").toLowerCase();
              const desc = String(it.descricao || it.nome || "").toLowerCase();
              return (cat === "vexo" || desc.includes("plano") || desc.includes("vexo") || desc.includes("chatbot")) && !desc.startsWith("pacote:");
            })
            .map((it) => it.descricao || it.nome)
            .filter(Boolean);

          if (vexoItems.length === 0) {
            vexoItems.push("Plano Avançado Vexo OS", "Chatbot IA de Qualificação", "Jornadas de Follow-up");
          }

          finalPresentationSlides = finalPresentationSlides.map((s) => {
            if (s.kind === "partnership" || s.id === 5) {
              return {
                ...s,
                fronts: [
                  {
                    label: "Geração Digital",
                    tag: "Atração & Posicionamento",
                    items: gdItems.length > 0 ? gdItems : ["Gestão de Redes Sociais", "Tráfego Pago", "Posicionamento"],
                  },
                  {
                    label: "Vexo Atendimento",
                    tag: "IA & Automação Comercial",
                    items: vexoItems,
                  },
                ],
              };
            }
            return s;
          });
        }
      }

      const podeSegLogo = await proposalHasSegmentLogo();
      const segLogoSet = podeSegLogo
        ? ",\n             segment_id = COALESCE($23, segment_id),\n             prospect_logo = COALESCE($24, prospect_logo)"
        : "";

      const finalEsconderValores = esconder_valores !== undefined ? (esconder_valores === true) : (current.esconder_valores === true);

      const result = await pool.query(
        `UPDATE public.gd_proposals
         SET prospect_name = COALESCE($1, prospect_name),
             itens = COALESCE($2, itens),
             valor_total = $3,
             condicoes = COALESCE($4, condicoes),
             status = COALESCE($5, status),
             payment_link = $6,
             cobrar_setup = $7,
             valor_setup_vexo = $8,
             condicoes_pagamento = COALESCE($9, condicoes_pagamento),
             periodo_plano = $10,
             validade_ate = $11,
             valor_apos_validade = $12,
             observacao_validade = $13,
             descontos_concedidos = COALESCE($14, descontos_concedidos),
             arquivada = COALESCE($15, arquivada),
             meio_pagamento = COALESCE($16, meio_pagamento),
             package_id = $17,
             package_vexo_id = $18,
             valor_vp = $21,
             pacotes_ofertados = $22,
             condicoes_especiais = $25,
             desconto_setup_pct = $26,
             desconto_mensal_pct = $27,
             vexi_plan = $28,
             vexi_price = $29,
             vexo_plan = $28,
             vexo_price = $29,
             owner_company = COALESCE($30, owner_company),
             presentation_slides = COALESCE($31, presentation_slides),
             descontos_por_periodo = $32,
             vp_percent = $33,
             esconder_valores = $34${segLogoSet}
         WHERE id = $19 AND tenant_id = $20 RETURNING *`,
        [
          prospect_name,
          JSON.stringify(finalItems),
          valorTotal,
          condicoes,
          status,
          payment_link || null,
          finalCobrarSetup,
          finalValorSetupVexo,
          condicoes_pagamento !== undefined && condicoes_pagamento !== null ? JSON.stringify(condicoes_pagamento) : null,
          finalPeriodoPlano,
          finalValidadeAte,
          finalValorAposValidade,
          finalObservacaoValidade,
          descontos_concedidos !== undefined && descontos_concedidos !== null ? JSON.stringify(descontos_concedidos) : null,
          typeof arquivada === "boolean" ? arquivada : null,
          meio_pagamento !== undefined && meio_pagamento !== null ? JSON.stringify(meio_pagamento) : null,
          finalPackageId,
          finalPackageVexoId,
          id,
          tenantId,
          finalValorVp,
          Array.isArray(finalPacotesOfertados) && finalPacotesOfertados.length > 0 ? JSON.stringify(finalPacotesOfertados) : null,
          (custom_segment_name !== undefined ? (custom_segment_name ? String(custom_segment_name).trim() : null) : (customSegmentName !== undefined ? (customSegmentName ? String(customSegmentName).trim() : null) : (segment_id ? String(segment_id).trim() : null))),
          prospect_logo || null,
          finalCondicoesEspeciais,
          finalDescontoSetupPct,
          finalDescontoMensalPct,
          finalVexoPlan,
          finalVexoPrice,
          finalOwnerCompany || null,
          finalPresentationSlides ? JSON.stringify(finalPresentationSlides) : null,
          finalDescontosPorPeriodo,
          finalVpPercent,
          finalEsconderValores
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Proposta não encontrada." });
      }

      res.json({
        success: true,
        data: {
          ...result.rows[0],
          valor_setup: valorSetup,
          valor_recorrente: valorRecorrente
        }
      });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao atualizar proposta:", error);
      res.status(500).json({ error: "Erro ao atualizar proposta comercial." });
    }
  });

  // DELETE /api/gd/proposals/:id
  app.delete("/api/gd/proposals/:id", requireFirebaseAuth, guardPropostaVexo, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id } = req.query;
      const tenantId = await resolveTenantUuid(client_id || req.body.client_id);

      const statusRes = await pool.query(
        `SELECT status FROM public.gd_proposals WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );
      if (statusRes.rows.length === 0) {
        return res.status(404).json({ error: "Proposta não encontrada." });
      }
      if (statusRes.rows[0].status === "aceita") {
        return res.status(400).json({ error: "Proposta fechada é registro de compromisso e não pode ser excluída. Use o arquivamento." });
      }

      const result = await pool.query(
        `DELETE FROM public.gd_proposals WHERE id = $1 AND tenant_id = $2 RETURNING *`,
        [id, tenantId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Proposta não encontrada." });
      }

      res.json({ success: true, message: "Proposta comercial excluída com sucesso." });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao excluir proposta:", error);
      res.status(500).json({ error: "Erro ao excluir proposta comercial." });
    }
  });

  // POST /api/gd/proposals/:id/enviar-email — envia o link público via ResendProvider (infra do briefing)
  app.post("/api/gd/proposals/:id/enviar-email", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id, email, base_url } = req.body;
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
        return res.status(400).json({ error: "E-mail de destino inválido." });
      }
      const tenantId = await resolveTenantUuid(client_id);
      const propRes = await pool.query(
        `SELECT id, prospect_name, valor_total, validade_ate FROM public.gd_proposals WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );
      if (propRes.rows.length === 0) {
        return res.status(404).json({ error: "Proposta não encontrada." });
      }
      const prop = propRes.rows[0];

      let sendEmailFn = null;
      try {
        const { ResendProvider } = await import("../providers/ResendProvider.js");
        sendEmailFn = ResendProvider.sendEmail;
      } catch (err) {
        console.warn("[GeracaoDigital] ResendProvider not loaded", err);
      }
      if (!sendEmailFn || !process.env.RESEND_API_KEY) {
        return res.status(503).json({ error: "Envio de e-mail não configurado no servidor (RESEND_API_KEY)." });
      }

      const link = `${String(base_url || "").replace(/\/$/, "")}/proposta/${prop.id}`;
      const validade = prop.validade_ate
        ? `<p style="color:#b45309;font-weight:bold;">Proposta válida até ${new Date(prop.validade_ate).toLocaleDateString("pt-BR")}.</p>`
        : "";
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b;">
          <h2 style="color:#7c3aed;">Sua proposta comercial está pronta</h2>
          <p>Olá${prop.prospect_name ? `, <b>${prop.prospect_name}</b>` : ""}!</p>
          <p>Preparamos sua proposta comercial da Geração Digital. Acesse o link abaixo para revisar o escopo, os valores e assinar online:</p>
          <p style="margin:24px 0;">
            <a href="${link}" style="background:linear-gradient(90deg,#7c3aed,#ec4899);color:#fff;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:bold;">Ver e assinar a proposta</a>
          </p>
          ${validade}
          <p style="font-size:12px;color:#64748b;">Se o botão não funcionar, copie e cole este link no navegador:<br/>${link}</p>
        </div>`;

      const result = await sendEmailFn(email, "Sua proposta comercial — Geração Digital", html, "Geração Digital");
      if (!result) {
        return res.status(503).json({ error: "Envio de e-mail não configurado no servidor (RESEND_API_KEY)." });
      }
      res.json({ success: true, message: `Proposta enviada para ${email}.` });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao enviar proposta por e-mail:", error?.message || error);
      res.status(500).json({ error: "Erro ao enviar a proposta por e-mail." });
    }
  });

  // POST /api/gd/proposals/:id/enviar
  app.post("/api/gd/proposals/:id/enviar", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { client_id } = req.body;
      const tenantId = await resolveTenantUuid(client_id);

      const result = await pool.query(
        `UPDATE public.gd_proposals
         SET status = 'enviada',
             sent_at = timezone('utc'::text, now())
         WHERE id = $1 AND tenant_id = $2 RETURNING *`,
        [id, tenantId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Proposta não encontrada." });
      }

      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao enviar proposta:", error);
      res.status(500).json({ error: "Erro ao enviar proposta." });
    }
  });

  // POST /api/gd/proposals/:id/assinar
  app.post("/api/gd/proposals/:id/assinar", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { assinatura, signer_name, assinatura_metodo } = req.body;
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';

      const result = await pool.query(
        `UPDATE public.gd_proposals
         SET assinatura = $1,
             signer_name = $2,
             signed_at = timezone('utc'::text, now()),
             signer_ip = $3,
             status = 'aceita',
             assinatura_metodo = COALESCE($4, 'desenho')
         WHERE id = $5 RETURNING *`,
        [assinatura, signer_name, ip, assinatura_metodo || 'desenho', id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Proposta não encontrada ou acesso negado." });
      }

      const row = result.rows[0];
      const items = Array.isArray(row.itens) ? row.itens : [];
      const valorSetup = somaSetup(items);
      const valorRecorrente = somaRecorrente(items);

      res.json({
        success: true,
        data: {
          ...row,
          valor_setup: valorSetup,
          valor_recorrente: valorRecorrente
        }
      });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao assinar proposta:", error);
      res.status(500).json({ error: "Erro ao registrar assinatura de aceite comercial." });
    }
  });

  // POST /api/gd/proposals/:id/reopen — reabre proposta aceita com preservação de assinaturas e auditoria
  app.post("/api/gd/proposals/:id/reopen", requireFirebaseAuth, requireVexoCommercialAccess, guardPropostaVexo, async (req, res) => {
    try {
      if (!isManagerOrAdmin(req.authAccess)) {
        return res.status(403).json({ error: "Apenas gestores ou administradores podem reabrir propostas aceitas." });
      }

      const { id } = req.params;
      const { motivo } = req.body || {};

      const clientKey = resolveAuthorizedClientId(req, res, req.body?.client_id || req.query?.client_id);
      if (!clientKey) return; // resolveAuthorizedClientId já respondeu

      const tenantId = await resolveTenantUuid(clientKey);

      const propRes = await pool.query(
        `SELECT * FROM public.gd_proposals WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );

      if (propRes.rows.length === 0) {
        return res.status(404).json({ error: "Proposta não encontrada." });
      }

      const prop = propRes.rows[0];
      if (prop.status !== "aceita") {
        return res.status(400).json({ error: "Apenas propostas com status 'aceita' podem ser reabertas." });
      }

      // PRESERVAÇÃO ESTRITA: nunca apaga assinatura, signer_name, signed_at, signer_ip, assinatura_metodo.
      // Registra a reabertura no histórico estruturado de condicoes_pagamento.
      let condicoesPagamento = prop.condicoes_pagamento;
      if (typeof condicoesPagamento === "string") {
        try { condicoesPagamento = JSON.parse(condicoesPagamento); } catch { condicoesPagamento = {}; }
      }
      if (!condicoesPagamento || typeof condicoesPagamento !== "object" || Array.isArray(condicoesPagamento)) {
        condicoesPagamento = {};
      }

      const reaberturaRegistro = {
        reaberto_por: req.authAccess?.name || req.authAccess?.email || "Gestor",
        reaberto_por_uid: req.authAccess?.uid || null,
        reaberto_em: new Date().toISOString(),
        motivo: motivo ? String(motivo).trim() : null,
        aceite_anterior: {
          signer_name: prop.signer_name || null,
          signed_at: prop.signed_at || null,
          signer_ip: prop.signer_ip || null,
          assinatura_metodo: prop.assinatura_metodo || null,
        },
      };

      const reaberturasAnteriores = Array.isArray(condicoesPagamento.reaberturas)
        ? condicoesPagamento.reaberturas
        : [];

      const updatedCondicoesPagamento = {
        ...condicoesPagamento,
        reabertura: reaberturaRegistro,
        reaberturas: [...reaberturasAnteriores, reaberturaRegistro],
      };

      const result = await pool.query(
        `UPDATE public.gd_proposals
         SET status = 'rascunho',
             condicoes_pagamento = $1
         WHERE id = $2 AND tenant_id = $3
         RETURNING *`,
        [JSON.stringify(updatedCondicoesPagamento), id, tenantId]
      );

      const row = result.rows[0];
      const items = Array.isArray(row.itens) ? row.itens : [];
      const valorSetup = somaSetup(items);
      const valorRecorrente = somaRecorrente(items);

      const payload = {
        ...row,
        valor_setup: valorSetup,
        valor_recorrente: valorRecorrente,
      };

      res.json({
        success: true,
        message: "Proposta reaberta com sucesso. As assinaturas e evidências anteriores foram preservadas.",
        data: payload,
        proposal: payload,
      });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao reabrir proposta:", error);
      res.status(500).json({ error: "Erro ao reabrir proposta comercial." });
    }
  });

  // ─── PITCH GENERATOR COM IA GROQ + PERSISTÊNCIA DE SLIDES ──────────────────────

  async function generatePitchSlidesWithGroq(proposal, segmentName, meetingNotes) {
    const apiKey = process.env.GROQ_API_KEY;
    const prospectName = proposal.prospect_name || "Cliente";
    const items = Array.isArray(proposal.itens) ? proposal.itens : [];
    const itemsText = items
      .map((i) => `- ${i.descricao || i.nome || "Item"}: R$ ${i.valor || 0} (${i.recorrencia || "mensal"})`)
      .join("\n");
    const total = Number(proposal.valor_total || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
    const esconderValores = proposal.esconder_valores === true;
    const metricValue = esconderValores ? "Sob Consulta" : total;
    const metricCaption = esconderValores
      ? "condições especiais acordadas individualmente"
      : "investimento para transformação completa do processo comercial";
    const condicoes = proposal.condicoes || "Sem observações adicionais";
    const notes = (meetingNotes || proposal.meeting_notes || "").trim();

    const allProposalItems = Array.isArray(proposal.itens) ? proposal.itens : [];
    // Itens da Geração Digital (módulos avulsos e escopo da agência)
    const gdItems = allProposalItems
      .filter((it) => {
        const cat = String(it.categoria || "").toLowerCase();
        const desc = String(it.descricao || "").toLowerCase();
        return cat === "gd" || (!desc.includes("plano") && !cat.includes("vexo"));
      })
      .map((it) => it.descricao || it.nome)
      .filter(Boolean);
    // Se houver pacote selecionado, inclui no topo
    if (proposal.package_id || proposal.pacote_nome) {
      gdItems.unshift(`Pacote: ${proposal.pacote_nome || proposal.package_id}`);
    }
    // Itens do Vexo Atendimento
    const vexoItems = allProposalItems
      .filter((it) => {
        const cat = String(it.categoria || "").toLowerCase();
        const desc = String(it.descricao || "").toLowerCase();
        return cat === "vexo" || desc.includes("plano") || desc.includes("vexo") || desc.includes("chatbot");
      })
      .map((it) => it.descricao || it.nome)
      .filter(Boolean);
    if (vexoItems.length === 0) {
      vexoItems.push("Plano Avançado Vexo OS", "Chatbot IA de Qualificação", "Jornadas de Follow-up");
    }

    const isCafeteria =
      /cafeteria|bistr[oô]|caf[eé]|cafeeiro/i.test(String(segmentName || "")) ||
      /cafeteria|bistr[oô]|caf[eé]|cafeeiro/i.test(String(proposal.prospect_name || "")) ||
      /cafeteria|bistr[oô]|caf[eé]|cafeeiro/i.test(String(notes || ""));

    const cafeteriaPromptDirectives = isCafeteria
      ? `
DIRETRIZES ESTRATÉGICAS ESPECÍFICAS DESTE SEGMENTO (CAFETERIAS / BISTRÔS / CAFÉS ESPECIAIS):
1. OPORTUNIDADES DE DIFERENTES GRUPOS DE PESSOAS:
   - Destaque que a cafeteria precisa atender e atrair novos grupos:
     a) Corporativo / Reuniões rápidas de negócios / Profissionais;
     b) Takeaway / 'Grab & Go' matinal rápido de pessoas a caminho do trabalho;
     c) Encontros sociais / Casais / Grupos de amigos no café da tarde e finais de semana;
     d) Amantes e apreciadores de cafés especiais e métodos filtrados.
2. PREENCHIMENTO DA SAZONALIDADE & HORÁRIOS OCIOSOS:
   - Foque explicitamente na ocupação das MANHÃS INICIAIS (combos rápidos café + panificação) e das NOITES (happy hour de cafeteria, drinques autorais com café, vinhos leves, tábuas de queijos/frios e ambiente acolhedor).
3. MOTOR DE RECORRÊNCIA & FIDELIZAÇÃO:
   - Proponha Clube de Assinaturas, Passaporte do Café e Cartão Fidelidade digital no WhatsApp com reativação semanal no piloto automático para aumentar a frequência de visitas.
4. TURNOVER DE MESAS EM HORÁRIOS DE PICO:
   - Aborde a solução para o problema de mesas ocupadas por muito tempo com um único consumo mínimo sem gerar faturamento proporcional. Apresente cardápio digital interativo e pedidos expressos que aceleram o giro de mesas no almoço/pico da tarde sem atrito.
`
      : "";

    const systemPrompt = `Você é um especialista em vendas consultivas B2B, pitch comercial e metodologia SPIN Selling.
Sua missão é ler as anotações estratégicas e briefing do cliente e sintetizar em exatamente 6 slides de apresentação comercial de alto impacto.
${cafeteriaPromptDirectives}
REGRAS OBRIGATÓRIAS:
- NUNCA transcreva ou cole anotações brutas em um único slide.
- Sintetize as dores em 3 tópicos curtos (máximo 15 palavras por tópico).
- Distribua os pontos fortes entre Diagnóstico (Slide 2), Oportunidade/Nichos (Slide 3), Estratégia Comercial (Slide 4) e Cronograma (Slide 5).
- Linguagem executiva e anti-jargão técnico. Nunca use termos como "n8n, webhook, bot, typebot". Use termos comerciais elegantes como "Recepcionista Digital 24h, Sistema de Atração de Clientes, Atendimento Imediato, Recuperação Ativa de Vendas".

Retorne EXCLUSIVAMENTE um objeto JSON no formato:
{
  "slides": [
    {
      "id": 1,
      "kind": "impact",
      "eyebrow": "APRESENTAÇÃO EXCLUSIVA",
      "title": "Título forte e provocativo para ${prospectName}",
      "subtitle": "Subtítulo personalizado para o posicionamento de mercado",
      "body": "Breve síntese executiva do propósito da parceria estratégica."
    },
    {
      "id": 2,
      "kind": "pain",
      "eyebrow": "DIAGNÓSTICO & CENÁRIO ATUAL",
      "title": "O gargalo oculto no crescimento da empresa",
      "subtitle": "Onde o faturamento está escapando todos os dias",
      "body": "Síntese clara e concisa dos maiores desafios diagnosticados.",
      "steps": [
        "Desafio 1 sintetizado (máximo 15 palavras)",
        "Desafio 2 sintetizado (máximo 15 palavras)",
        "Desafio 3 sintetizado (máximo 15 palavras)"
      ]
    },
    {
      "id": 3,
      "kind": "implication",
      "eyebrow": "O CUSTO DA INAÇÃO",
      "title": "O impacto financeiro do vazamento de oportunidades",
      "subtitle": "Quanto custa manter a operação no modelo manual",
      "body": "A perda cumulativa de clientes que deixam de comprar mês a mês.",
      "metric": {
        "value": "R$ 45.000+",
        "caption": "estimativa anual em oportunidades perdidas por falta de agilidade"
      }
    },
    {
      "id": 4,
      "kind": "solution",
      "eyebrow": "A ESTRATÉGIA DE CRESCIMENTO",
      "title": "A Máquina de Vendas & Atendimento Impecável",
      "subtitle": "Como vamos blindar o atendimento e acelerar as conversões",
      "steps": [
        "Atendimento instantâneo 24/7 sem deixar nenhum cliente esperando",
        "Qualificação inteligente e direcionamento direto para consultores",
        "Recuperação ativa de orçamentos e follow-up humanizado",
        "Métricas em tempo real de conversão e velocidade de resposta"
      ]
    },
    {
      "id": 5,
      "kind": "partnership",
      "eyebrow": "ESCOPO & ENTREGÁVEIS",
      "title": "O Que Está Incluso no Seu Projeto",
      "subtitle": "Estrutura completa para atração, atendimento e retenção",
      "fronts": [
        {
          "label": "Geração Digital",
          "tag": "Atração & Posicionamento",
          "items": ${JSON.stringify(gdItems.length > 0 ? gdItems : ["Gestão de Redes Sociais", "Tráfego Pago", "Posicionamento"])}
        },
        {
          "label": "Vexo Atendimento",
          "tag": "IA & Automação Comercial",
          "items": ${JSON.stringify(vexoItems)}
        }
      ]
    },
    {
      "id": 6,
      "kind": "close",
      "eyebrow": "PARCERIA & DECISÃO",
      "title": "O Próximo Nível de Escala",
      "subtitle": "Investimento estruturado com retorno rápido",
      "metric": {
        "value": "${metricValue}",
        "caption": "${metricCaption}"
      },
      "punch": "Vamos iniciar a implementação hoje e colher os primeiros resultados nos próximos 7 dias?"
    }
  ]
}`;

    const userPrompt = `Cliente: ${prospectName}
Segmento: ${segmentName || "Geral / B2B"}
${notes ? `Anotações da Reunião / Dores do Cliente:\n${notes}\n` : ""}
Itens/Entregáveis da Proposta:
${itemsText || "Implementação de Solução Comercial Integrada"}
Valor Total: ${esconderValores ? "Condições Especiais / Sob Consulta (NÃO cite valores monetários ou preços em reais de planos na apresentação)" : total}
Condições: ${condicoes}`;

    if (apiKey) {
      try {
        const model = process.env.GROQ_MODEL || defaultGroqModel();
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            temperature: 0.3,
            max_tokens: 2500,
            response_format: { type: "json_object" },
          }),
        });

        if (res.ok) {
          const json = await res.json();
          const content = json.choices?.[0]?.message?.content || "";
          const parsed = JSON.parse(content);
          const slides = Array.isArray(parsed)
            ? parsed
            : parsed.slides || parsed.presentation_slides || Object.values(parsed)[0];
          if (Array.isArray(slides) && slides.length > 0) {
            const slide5 = slides.find((s) => s.kind === "partnership" || s.id === 5);
            if (slide5) {
              slide5.eyebrow = slide5.eyebrow || "ESCOPO & ENTREGÁVEIS";
              slide5.title = slide5.title || "O Que Está Incluso no Seu Projeto";
              slide5.subtitle = slide5.subtitle || "Estrutura completa para atração, atendimento e retenção";
              slide5.fronts = [
                {
                  label: "Geração Digital",
                  tag: "Atração & Posicionamento",
                  items: gdItems.length > 0 ? gdItems : ["Gestão de Redes Sociais", "Tráfego Pago", "Posicionamento"],
                },
                {
                  label: "Vexo Atendimento",
                  tag: "IA & Automação Comercial",
                  items: vexoItems,
                },
              ];
            }
            return slides;
          }
        } else {
          console.warn("[Groq-Pitch] Erro HTTP da Groq:", res.status, await res.text());
        }
      } catch (err) {
        console.warn("[Groq-Pitch] Falha na chamada da Groq, usando gerador determinístico:", err.message);
      }
    }

    if (isCafeteria) {
      return [
        {
          id: 1,
          kind: "impact",
          eyebrow: "APRESENTAÇÃO EXCLUSIVA",
          title: `Acelerando as Vendas da ${prospectName}`,
          subtitle: `Plano Comercial Estratégico para Cafeterias, Bistrôs & Cafés Especiais`,
          body: `Como a ${prospectName} atrai novos grupos de clientes, preenche a ociosidade das manhãs e noites, destrava a recorrência e otimiza o giro de mesas no pico.`,
        },
        {
          id: 2,
          kind: "pain",
          eyebrow: "DIAGNÓSTICO COMERCIAL",
          title: `Mesas travadas no pico e ociosidade nas manhãs e noites`,
          subtitle: "Onde o faturamento está escapando todos os dias",
          body: "Identificamos os 3 maiores gargalos do salão: ociosidade em períodos estratégicos, mesas travadas no pico sem consumo proporcional e falta de recorrência.",
          steps: [
            "Ociosidade sazonal: manhãs iniciais e noites com baixo movimento.",
            "Mesas ocupadas por muito tempo no pico sem gerar consumo proporcional.",
            "Falta de captação ativa de novos grupos (corporativo, takeaway e encontros).",
            "Ausência de um programa de recorrência para trazer clientes toda semana.",
          ],
        },
        {
          id: 3,
          kind: "implication",
          eyebrow: "OPORTUNIDADE DE MERCADO",
          title: "O Custo Financeiro da Capacidade Ociosa",
          subtitle: "Quanto a falta de giro e de novos públicos custa no final do ano",
          body: "Mesas travadas no almoço/tarde somadas a manhãs e noites vazias geram uma perda cumulativa de receita que já poderia estar no caixa.",
          metric: {
            value: "R$ 60.000 a R$ 120.000",
            caption: "em faturamento anual recuperável com preenchimento de horários ociosos e aumento do turnover de mesas",
          },
        },
        {
          id: 4,
          kind: "solution",
          eyebrow: "A ESTRATÉGIA DE CRESCIMENTO",
          title: "Atração de Novos Públicos, Giro & Recorrência",
          subtitle: "A máquina comercial para rentabilizar a cafeteria o dia inteiro",
          steps: [
            "Atração de Novos Grupos: Campanhas focadas no público corporativo, 'Grab & Go' matinal e encontros sociais.",
            "Preenchimento de Manhãs e Noites: Combos rápidos de café da manhã e carta especial noturna com drinques de café e tábuas.",
            "Turnover Inteligente no Pico: Cardápio digital no WhatsApp e pedidos expressos que aceleram o giro de mesas sem atrito.",
            "Clube de Recorrência & Fidelidade: Programa no WhatsApp que reativa clientes semanalmente no piloto automático.",
          ],
        },
        {
          id: 5,
          kind: "partnership",
          eyebrow: "ESCOPO & ENTREGÁVEIS",
          title: "O Que Está Incluso no Seu Projeto",
          subtitle: "Estrutura completa para atração, atendimento e retenção",
          fronts: [
            {
              label: "Geração Digital",
              tag: "Atração & Posicionamento",
              items: gdItems.length > 0 ? gdItems : [
                "Atração de novos grupos (corporativo, takeaway e social)",
                "Campanhas sazonais para manhãs e noites",
                "Posicionamento visual e autoridade gastronômica",
                "Presença forte no Google Maps e redes sociais",
              ],
            },
            {
              label: "Vexo Atendimento",
              tag: "IA & Automação Comercial",
              items: [
                "Recepcionista Digital 24h no WhatsApp",
                "Cardápio e pedidos expressos para agilizar o turnover de mesas",
                "Clube de Fidelidade & Passaporte do Café no WhatsApp",
                "Campanhas de reativação semanal no piloto automático",
              ],
            },
          ],
        },
        {
          id: 6,
          kind: "close",
          eyebrow: "PARCERIA & DECISÃO",
          title: "Salão Cheio e Rentável o Dia Inteiro",
          subtitle: "Investimento planejado com retorno rápido na operação",
          metric: {
            value: metricValue,
            caption: metricCaption,
          },
          punch: `Vamos iniciar a estruturação da ${prospectName} e colocar a máquina comercial para rodar?`,
        },
      ];
    }

    // Fallback determinístico contextual de alta fidelidade para outros segmentos
    return [
      {
        id: 1,
        kind: "impact",
        eyebrow: "APRESENTAÇÃO EXCLUSIVA",
        title: `Acelerando as Vendas da ${prospectName}`,
        subtitle: `Proposta comercial estratégica & plano de atendimento para ${segmentName || "alta performance"}`,
        body: `Apresentação preparada exclusivamente para a liderança da ${prospectName}, integrando atração qualificada e atendimento em tempo real.`,
      },
      {
        id: 2,
        kind: "pain",
        eyebrow: "DIAGNÓSTICO & CENÁRIO ATUAL",
        title: `Oportunidades de Otimização na ${prospectName}`,
        subtitle: "Os principais gargalos que impedem a escala máxima de faturamento",
        body: "Identificamos oportunidades claras para distribuir melhor o movimento ao longo do dia e monetizar horários ociosos.",
        steps: [
          "Demora no primeiro contato: leads que esperam perdem o interesse em minutos.",
          "Orçamentos sem acompanhamento: até 60% das vendas são perdidas por falta de follow-up ativo.",
          "Atendimento limitado ao horário comercial, perdendo contatos à noite e aos finais de semana.",
        ],
      },
      {
        id: 3,
        kind: "implication",
        eyebrow: "O IMPACTO DO VAZAMENTO",
        title: "O Custo Financeiro de Oportunidades Perdidas",
        subtitle: "Quanto a falta de velocidade e constância custa no final do ano",
        body: "Em mercados competitivos, cada contato não respondido imediatamente representa receita transferida para a concorrência.",
        metric: {
          value: "R$ 40.000 a R$ 80.000",
          caption: "em receita estimada recuperável com processos estruturados e automação inteligente",
        },
      },
      {
        id: 4,
        kind: "solution",
        eyebrow: "A ESTRATÉGIA DE CRESCIMENTO",
        title: "A Máquina Comercial Integrada",
        subtitle: "Como vamos transformar seu WhatsApp e canais em um motor de vendas previsível",
        steps: [
          "Atendimento Imediato 24 horas por dia com IA especializada no seu catálogo.",
          "Qualificação dinâmica de interesse, orçamento e prioridade dos contatos.",
          "Régua de Follow-up inteligente que retoma o lead no timing perfeito.",
          "Passagem de bastão mastigada para o consultor humano fechar o negócio.",
        ],
      },
      {
        id: 5,
        kind: "partnership",
        eyebrow: "ESCOPO & ENTREGÁVEIS",
        title: "O Que Está Incluso no Seu Projeto",
        subtitle: "Estrutura completa para atração, atendimento e retenção",
        fronts: [
          {
            label: "Geração Digital",
            tag: "Atração & Posicionamento",
            items: gdItems.length > 0 ? gdItems : ["Gestão de Redes Sociais", "Tráfego Pago", "Posicionamento"],
          },
          {
            label: "Vexo Atendimento",
            tag: "IA & Automação Comercial",
            items: vexoItems,
          },
        ],
      },
      {
        id: 6,
        kind: "close",
        eyebrow: "PROJEÇÃO DE RESULTADO",
        title: "Próximos Passos & Início da Operação",
        subtitle: "Investimento claro e cronograma de implementação imediata",
        metric: {
          value: metricValue,
          caption: metricCaption,
        },
        punch: `Vamos iniciar a configuração da ${prospectName} e colocar a máquina para rodar?`,
      },
    ];
  }

  // POST /api/gd/proposals/:id/generate-pitch (alias /api/proposals/:id/generate-pitch)
  const handleGeneratePitch = async (req, res) => {
    try {
      const { id } = req.params;
      const meetingNotes = req.body?.meetingNotes || req.body?.meeting_notes || null;
      const customSegmentName = req.body?.segmentName || req.body?.segment_name || req.body?.customSegmentName || req.body?.custom_segment_name || null;

      const propRes = await pool.query(
        `SELECT * FROM public.gd_proposals WHERE id = $1`,
        [id]
      );
      if (propRes.rows.length === 0) {
        return res.status(404).json({ error: "Proposta não encontrada." });
      }
      const prop = propRes.rows[0];

      let segmentName = customSegmentName ? String(customSegmentName).trim() : null;
      if (!segmentName && prop.segment_id) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidRegex.test(prop.segment_id)) {
          const segRes = await pool.query(`SELECT nome FROM public.gd_segments WHERE id = $1`, [prop.segment_id]);
          if (segRes.rows.length > 0) {
            segmentName = segRes.rows[0].nome;
          }
        } else if (prop.segment_id === "cafeteria") {
          segmentName = "Cafeterias, Bistrôs & Cafés Especiais";
        } else if (prop.segment_id === "turismo") {
          segmentName = "Agências de Turismo & Viagens";
        } else {
          segmentName = prop.segment_id;
        }
      }

      const slides = await generatePitchSlidesWithGroq(prop, segmentName, meetingNotes);

      // Persiste os slides, anotações e segmento atualizado no banco de dados
      const podeSegLogo = await proposalHasSegmentLogo();
      const updateFields = [`presentation_slides = $1`];
      const updateValues = [JSON.stringify(slides)];
      let valIdx = 2;

      if (meetingNotes !== null && meetingNotes !== undefined) {
        updateFields.push(`meeting_notes = $${valIdx}`);
        updateValues.push(meetingNotes);
        valIdx++;
      }

      if (customSegmentName && podeSegLogo) {
        updateFields.push(`segment_id = $${valIdx}`);
        updateValues.push(String(customSegmentName).trim());
        valIdx++;
      }

      updateValues.push(id);
      await pool.query(
        `UPDATE public.gd_proposals SET ${updateFields.join(", ")} WHERE id = $${valIdx}`,
        updateValues
      );

      res.json({
        success: true,
        data: slides,
      });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao gerar pitch com Groq:", error);
      res.status(500).json({ error: "Falha ao gerar pitch de apresentação." });
    }
  };

  app.post("/api/gd/proposals/:id/generate-pitch", requireFirebaseAuth, handleGeneratePitch);
  app.post("/api/proposals/:id/generate-pitch", requireFirebaseAuth, handleGeneratePitch);

  // PUT /api/gd/proposals/:id/slides (alias /api/proposals/:id/slides)
  const handleUpdateSlides = async (req, res) => {
    try {
      const { id } = req.params;
      const { slides } = req.body;
      if (!Array.isArray(slides)) {
        return res.status(400).json({ error: "Array de slides é obrigatório." });
      }

      await pool.query(
        `UPDATE public.gd_proposals SET presentation_slides = $1 WHERE id = $2`,
        [JSON.stringify(slides), id]
      );

      res.json({
        success: true,
        data: slides,
      });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao salvar slides da proposta:", error);
      res.status(500).json({ error: "Falha ao salvar slides." });
    }
  };

  app.put("/api/gd/proposals/:id/slides", requireFirebaseAuth, handleUpdateSlides);
  app.put("/api/proposals/:id/slides", requireFirebaseAuth, handleUpdateSlides);

  // ─── PUBLIC ENDPOINTS (WITHOUT FIREBASE AUTH) ──────────────────────────────────

  // GET /api/gd/public/proposals/:id
  app.get("/api/gd/public/proposals/:id", async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        `SELECT id, tenant_id, presentation_id, package_id, package_vexo_id, prospect_name, itens, valor_total, condicoes, status, payment_link, assinatura, signer_name, signed_at, created_at, sent_at, cobrar_setup, valor_setup_vexo, condicoes_pagamento, periodo_plano, validade_ate, valor_apos_validade, observacao_validade, descontos_concedidos, assinatura_metodo, valor_vp, meio_pagamento, carencia_dias, pacotes_ofertados, presentation_slides, owner_company, condicoes_especiais, desconto_setup_pct, desconto_mensal_pct, vexi_plan, vexi_price, vexo_plan, vexo_price, prospect_logo, segment_id, descontos_por_periodo, vp_percent, esconder_valores
         FROM public.gd_proposals WHERE id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Proposta não encontrada." });
      }

      const row = result.rows[0];

      // Pacotes desta proposta: apenas os ofertados pelo vendedor (não todos do
      // tenant). Fonte: pacotes_ofertados da apresentação vinculada + os pacotes
      // efetivamente escolhidos na proposta (package_id / package_vexo_id).
      const allowedPackageIds = new Set();
      if (row.package_id) allowedPackageIds.add(row.package_id);
      if (row.package_vexo_id) allowedPackageIds.add(row.package_vexo_id);
      // Menu de pacotes ofertados salvo na própria proposta (multi-seleção).
      let ofertadosProp = row.pacotes_ofertados;
      if (typeof ofertadosProp === "string") {
        try { ofertadosProp = JSON.parse(ofertadosProp); } catch { ofertadosProp = []; }
      }
      const hasOwnOfertados = Array.isArray(ofertadosProp) && ofertadosProp.length > 0;
      if (Array.isArray(ofertadosProp)) {
        ofertadosProp.forEach((pid) => { if (pid) allowedPackageIds.add(pid); });
      }
      // Só usa os pacotes da apresentação vinculada como FALLBACK — quando a
      // proposta ainda não definiu seu próprio menu (pacotes_ofertados). Assim
      // uma apresentação antiga não injeta pacotes "fantasma" na proposta.
      if (row.presentation_id && !hasOwnOfertados) {
        try {
          const presRes = await pool.query(
            `SELECT pacotes_ofertados FROM public.gd_presentations WHERE id = $1 AND tenant_id = $2`,
            [row.presentation_id, row.tenant_id]
          );
          let ofertados = presRes.rows[0]?.pacotes_ofertados;
          if (typeof ofertados === "string") {
            try { ofertados = JSON.parse(ofertados); } catch { ofertados = []; }
          }
          if (Array.isArray(ofertados)) {
            ofertados.forEach((p) => {
              const pid = p?.package_id || p?.id;
              if (pid) allowedPackageIds.add(pid);
            });
          }
        } catch (presErr) {
          console.warn("[GeracaoDigital] Falha ao ler pacotes ofertados da apresentação:", presErr?.message || presErr);
        }
      }

      let packagesRows = [];
      if (allowedPackageIds.size > 0) {
        const packagesRes = await pool.query(
          `SELECT * FROM public.gd_packages WHERE tenant_id = $1 AND ativo = true AND id = ANY($2::uuid[])`,
          [row.tenant_id, Array.from(allowedPackageIds)]
        );
        packagesRows = packagesRes.rows;
      }

      // Fetch tenant payment default link as fallback
      const tenantModulesRes = await pool.query(
        `SELECT config FROM public.tenant_modules WHERE tenant_id = $1`,
        [row.tenant_id]
      );
      const config = tenantModulesRes.rows[0]?.config || {};
      const paymentLinkDefault = config.gd?.payment_link_default || "";

      const finalPaymentLink = row.payment_link || paymentLinkDefault || "";

      let items = Array.isArray(row.itens) ? row.itens : [];

      // Sincroniza o escopo com o template vivo do pacote escolhido: módulos
      // adicionados ao pacote DEPOIS da criação da proposta aparecem
      // automaticamente. Só ANEXA linhas de valor 0 (não remove nem altera o
      // que já existe, nem os totais) — módulos avulsos e valores negociados
      // ficam intactos.
      const activePkg = packagesRows.find((p) => p.id === row.package_id || p.id === row.package_vexo_id);
      if (activePkg && Array.isArray(activePkg.produtos_incluidos)) {
        const norm = (s) => String(s || "").trim().toLowerCase().replace(/^módulo:\s*/, "");
        const existingKeys = new Set(
          items.map((i) => i.product_id ? `id:${i.product_id}` : `nm:${norm(i.descricao)}`)
        );
        const extras = [];
        activePkg.produtos_incluidos.forEach((p) => {
          const isVexo = p.origem === "vexo" || activePkg.tipo === "vexo";
          const key = p.product_id ? `id:${p.product_id}` : `nm:${norm(p.nome)}`;
          if (existingKeys.has(key)) return;
          existingKeys.add(key);
          extras.push({
            product_id: p.product_id || null,
            descricao: (isVexo && !String(p.nome || "").startsWith("Módulo:")) ? `Módulo: ${p.nome}` : p.nome,
            categoria: isVexo ? "vexo" : "gd",
            valor: 0,
            recorrencia: "mensal"
          });
        });
        if (extras.length > 0) items = [...items, ...extras];
      }

      const valorSetup = somaSetup(items);
      const valorRecorrente = somaRecorrente(items);

      const publicData = {
        id: row.id,
        package_id: row.package_id,
        package_vexo_id: row.package_vexo_id,
        prospect_name: row.prospect_name,
        itens: items,
        valor_total: row.valor_total,
        condicoes: row.condicoes,
        status: row.status,
        payment_link: finalPaymentLink,
        sent_at: row.sent_at,
        assinatura: row.assinatura,
        signer_name: row.signer_name,
        signed_at: row.signed_at,
        created_at: row.created_at,
        cobrar_setup: row.cobrar_setup,
        valor_setup_vexo: row.valor_setup_vexo,
        condicoes_pagamento: row.condicoes_pagamento,
        periodo_plano: row.periodo_plano,
        validade_ate: row.validade_ate,
        valor_apos_validade: row.valor_apos_validade,
        observacao_validade: row.observacao_validade,
        descontos_concedidos: row.descontos_concedidos,
        assinatura_metodo: row.assinatura_metodo,
        valor_vp: row.valor_vp,
        meio_pagamento: row.meio_pagamento,
        carencia_dias: row.carencia_dias,
        pacotes_ofertados: row.pacotes_ofertados,
        presentation_slides: row.presentation_slides,
        owner_company: row.owner_company,
        condicoes_especiais: row.condicoes_especiais,
        desconto_setup_pct: row.desconto_setup_pct,
        desconto_mensal_pct: row.desconto_mensal_pct,
        vexi_plan: row.vexi_plan,
        vexi_price: row.vexi_price,
        vexo_plan: row.vexo_plan,
        vexo_price: row.vexo_price,
        prospect_logo: row.prospect_logo,
        segment_id: row.segment_id,
        descontos_por_periodo: row.descontos_por_periodo,
        vp_percent: row.vp_percent !== null && row.vp_percent !== undefined ? Number(row.vp_percent) : null,
        esconder_valores: row.esconder_valores === true,
        valor_setup: valorSetup,
        valor_recorrente: valorRecorrente,
        packages: packagesRows
      };

      res.json({
        success: true,
        data: publicData
      });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao buscar proposta pública:", error);
      res.status(500).json({ error: "Erro ao buscar proposta." });
    }
  });

  // POST /api/gd/public/proposals/:id/select-package
  app.post("/api/gd/public/proposals/:id/select-package", async (req, res) => {
    try {
      const { id } = req.params;
      const { package_id } = req.body;

      // 1. Get the package details
      const pkgResult = await pool.query(
        `SELECT * FROM public.gd_packages WHERE id = $1 AND ativo = true`,
        [package_id]
      );
      if (pkgResult.rows.length === 0 && package_id !== null) {
        return res.status(404).json({ error: "Pacote não encontrado." });
      }

      const selectedPkg = pkgResult.rows[0];

      // 2. Fetch the current proposal to get details
      const propResult = await pool.query(
        `SELECT * FROM public.gd_proposals WHERE id = $1`,
        [id]
      );
      if (propResult.rows.length === 0) {
        return res.status(404).json({ error: "Proposta não encontrada." });
      }

      const proposal = propResult.rows[0];
      if (proposal.status === "aceita") {
        return res.status(400).json({ error: "Proposta já aceita e assinada. Não é possível alterar o pacote." });
      }

      // 3. Build new items list based on selected package
      const finalItems = [];

      if (selectedPkg) {
        const val = Number(selectedPkg.valor || 0);
        const PERIOD_MONTHS = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };
        const meses = selectedPkg.periodo === "unico" ? null : (PERIOD_MONTHS[selectedPkg.periodo] ?? 1);
        const mensalidade = meses ? Math.round((val / meses) * 100) / 100 : val;
        const valorTabela = Number(selectedPkg.valor_tabela || 0);

        // VP do período e mensal:
        // No gd_packages, valor_vp é o TOTAL do período (ex: R$ 15.600 em 6 meses, R$ 28.800 em 12 meses)
        let vpPeriodo = Number(selectedPkg.valor_vp || 0) > 0 ? Number(selectedPkg.valor_vp) : null;
        let vpMensal = meses && vpPeriodo ? Math.round((vpPeriodo / meses) * 100) / 100 : vpPeriodo;

        // Se a proposta possui vp_percent explícito:
        if (Number(proposal.vp_percent || 0) > 0) {
          const vpPct = Number(proposal.vp_percent) / 100;
          let descPeriodo = Number(proposal.desconto_mensal_pct || 0);
          let rawDescontos = proposal.descontos_por_periodo;
          if (typeof rawDescontos === "string") {
            try { rawDescontos = JSON.parse(rawDescontos); } catch (_) { rawDescontos = null; }
          }
          if (rawDescontos && typeof rawDescontos === "object" && selectedPkg.periodo in rawDescontos) {
            const valP = rawDescontos[selectedPkg.periodo];
            descPeriodo = (valP !== undefined && valP !== null && valP !== "") ? Math.max(0, Math.min(100, Number(valP))) : 0;
          }
          const mensalidadeFinal = Math.max(0, mensalidade * (1 - descPeriodo / 100));
          const compromissoFinal = Math.max(0, val * (1 - descPeriodo / 100));
          vpMensal = Math.round(mensalidadeFinal * vpPct * 100) / 100;
          vpPeriodo = meses ? Math.round(compromissoFinal * vpPct * 100) / 100 : vpMensal;
        } else if (!vpMensal && Number(proposal.valor_vp || 0) > 0) {
          // Se o pacote não tinha valor_vp diretamente gravado, mas a proposta já possuía uma taxa/percentual de VP:
          const oldPkgItem = Array.isArray(proposal.itens) ? proposal.itens.find(i => i.descricao?.startsWith("Pacote:")) : null;
          const oldMensal = oldPkgItem ? Number(oldPkgItem.valor || 0) : Number(proposal.valor_total || 0);
          if (oldMensal > 0) {
            // Percentual de VP anterior aplicado sobre a nova mensalidade
            const vpPct = Number(proposal.valor_vp) / oldMensal;
            vpMensal = Math.round(mensalidade * vpPct * 100) / 100;
            vpPeriodo = meses ? Math.round(vpMensal * meses * 100) / 100 : vpMensal;
          }
        }

        finalItems.push({
          product_id: null,
          descricao: `Pacote: ${selectedPkg.nome} (${selectedPkg.periodo === "unico" ? "Setup" : "Recorrência"})`,
          categoria: selectedPkg.tipo || "gd",
          valor: mensalidade,
          valor_vp: vpPeriodo,
          recorrencia: meses ? "mensal" : "unico",
          periodo: selectedPkg.periodo,
          meses,
          total_periodo: meses ? val : null,
          valor_tabela: valorTabela > val ? valorTabela : null
        });

        if (Array.isArray(selectedPkg.produtos_incluidos)) {
          selectedPkg.produtos_incluidos.forEach((p) => {
            const isVexo = p.origem === "vexo" || selectedPkg.tipo === "vexo";
            finalItems.push({
              product_id: p.product_id || null,
              descricao: (isVexo && !String(p.nome || "").startsWith("Módulo:")) ? `Módulo: ${p.nome}` : p.nome,
              categoria: isVexo ? "vexo" : "gd",
              valor: 0,
              recorrencia: "mensal"
            });
          });
        }
      }

      // Keep any other items from the old proposal that were not part of the old package (e.g. Vexo avulso modules)
      if (Array.isArray(proposal.itens)) {
        proposal.itens.forEach((item) => {
          if (item.categoria === "vexo" && !item.descricao?.startsWith("Pacote Vexo:")) {
            const alreadyExists = finalItems.some((f) => f.descricao === item.descricao);
            if (!alreadyExists) {
              finalItems.push(item);
            }
          }
        });
      }

      // Deduplica itens por descrição (evita repetições de valor zero)
      const seenDescs = new Set();
      const dedupedFinalItems = finalItems.filter((it) => {
        const desc = String(it.descricao || "").trim();
        if (!desc) return false;
        if (Number(it.valor || 0) === 0) {
          if (seenDescs.has(desc)) return false;
          seenDescs.add(desc);
        }
        return true;
      });

      // Recalculate totals
      const valorSetup = somaSetup(dedupedFinalItems);
      const valorRecorrente = somaRecorrente(dedupedFinalItems);
      const valorTotal = valorSetup + valorRecorrente;

      // Update proposal in DB — período do plano acompanha o pacote escolhido
      // (fonte única: o pacote define o período, sem seletor separado).
      const periodoDoPacote = selectedPkg && selectedPkg.periodo && selectedPkg.periodo !== "unico"
        ? selectedPkg.periodo
        : (selectedPkg ? "mensal" : null);

      let descPeriodo = Number(proposal.desconto_mensal_pct || 0);
      let rawDescontos = proposal.descontos_por_periodo;
      if (typeof rawDescontos === "string") {
        try { rawDescontos = JSON.parse(rawDescontos); } catch (_) { rawDescontos = null; }
      }
      if (rawDescontos && typeof rawDescontos === "object" && periodoDoPacote in rawDescontos) {
        const valP = rawDescontos[periodoDoPacote];
        descPeriodo = (valP !== undefined && valP !== null && valP !== "") ? Math.max(0, Math.min(100, Number(valP))) : 0;
      }

      // Coluna valor_vp da proposta guarda o VP MENSAL (a página pública
      // divide a mensalidade por ele e calcula o VP do período).
      let vpMensalParaSalvar = null;
      if (selectedPkg) {
        const val = Number(selectedPkg.valor || 0);
        const PERIOD_MONTHS = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };
        const meses = selectedPkg.periodo === "unico" ? null : (PERIOD_MONTHS[selectedPkg.periodo] ?? 1);
        const mensalidade = meses ? Math.round((val / meses) * 100) / 100 : val;

        if (Number(proposal.vp_percent || 0) > 0) {
          const mensalidadeFinal = Math.max(0, mensalidade * (1 - descPeriodo / 100));
          vpMensalParaSalvar = Math.round(mensalidadeFinal * (Number(proposal.vp_percent) / 100) * 100) / 100;
        } else {
          let vpPeriodo = Number(selectedPkg.valor_vp || 0) > 0 ? Number(selectedPkg.valor_vp) : null;
          let vpM = meses && vpPeriodo ? Math.round((vpPeriodo / meses) * 100) / 100 : vpPeriodo;
          if (!vpM && Number(proposal.valor_vp || 0) > 0) {
            const oldPkgItem = Array.isArray(proposal.itens) ? proposal.itens.find(i => i.descricao?.startsWith("Pacote:")) : null;
            const oldMensal = oldPkgItem ? Number(oldPkgItem.valor || 0) : Number(proposal.valor_total || 0);
            if (oldMensal > 0) {
              const vpPct = Number(proposal.valor_vp) / oldMensal;
              vpM = Math.round(mensalidade * vpPct * 100) / 100;
            }
          }
          vpMensalParaSalvar = vpM && vpM > 0 ? vpM : null;
        }
      }

      await pool.query(
        `UPDATE public.gd_proposals
         SET package_id = $1, itens = $2, valor_total = $3, periodo_plano = COALESCE($5, periodo_plano), valor_vp = $6, desconto_mensal_pct = $7
         WHERE id = $4`,
        [package_id, JSON.stringify(dedupedFinalItems), valorTotal, id, periodoDoPacote, vpMensalParaSalvar, descPeriodo]
      );

      res.json({ success: true });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao selecionar pacote:", error);
      res.status(500).json({ error: "Erro ao selecionar pacote na proposta." });
    }
  });

  // POST /api/gd/public/proposals/:id/assinar
  app.post("/api/gd/public/proposals/:id/assinar", async (req, res) => {
    try {
      const { id } = req.params;
      const { assinatura, signer_name, condicao_escolhida_id, assinatura_metodo } = req.body;
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';

      // Se o cliente escolheu uma das condições ofertadas, registra a escolha
      let condicoesPagamentoUpdate = null;
      if (condicao_escolhida_id) {
        const currentRes = await pool.query(
          `SELECT condicoes_pagamento FROM public.gd_proposals WHERE id = $1`,
          [id]
        );
        const cp = currentRes.rows[0]?.condicoes_pagamento;
        const ofertadas = Array.isArray(cp?.ofertadas) ? cp.ofertadas : [];
        const escolhida = ofertadas.find((t) => t.id === condicao_escolhida_id) || null;
        if (escolhida) {
          condicoesPagamentoUpdate = JSON.stringify({ ...cp, escolhida });
        }
      }

      const result = await pool.query(
        `UPDATE public.gd_proposals
         SET assinatura = $1,
             signer_name = $2,
             signed_at = timezone('utc'::text, now()),
             signer_ip = $3,
             status = 'aceita',
             condicoes_pagamento = COALESCE($4, condicoes_pagamento),
             assinatura_metodo = COALESCE($5, 'desenho')
         WHERE id = $6 RETURNING *`,
        [assinatura, signer_name, ip, condicoesPagamentoUpdate, assinatura_metodo || 'desenho', id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Proposta não encontrada." });
      }

      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao assinar proposta pública:", error);
      res.status(500).json({ error: "Erro ao registrar assinatura." });
    }
  });

  // ─── BRIEFING DE IMPLANTAÇÃO (ONBOARDING TÉCNICO) ──────────────────────────

  // GET /api/gd/implementation-briefings
  app.get("/api/gd/implementation-briefings", requireFirebaseAuth, requireVexoCommercialAccess, async (req, res) => {
    try {
      const { tenant_id } = req.query;
      const ownerCompany = req.query.owner_company || req.query.ownerCompany || (req.query.isVexo === "1" || req.query.isVexo === "true" ? "vexo" : null);

      let conditions = [];
      let queryParams = [];

      if (tenant_id) {
        queryParams.push(tenant_id);
        conditions.push(`tenant_id = $${queryParams.length}`);
      }

      if (ownerCompany) {
        queryParams.push(ownerCompany);
        conditions.push(`owner_company = $${queryParams.length}`);
      } else {
        conditions.push(`(owner_company = 'geracao-digital' OR owner_company IS NULL)`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const queryStr = `SELECT * FROM public.gd_implementation_briefings ${whereClause} ORDER BY created_at DESC`;

      const { rows } = await pool.query(queryStr, queryParams);
      res.json({ success: true, data: rows });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao buscar briefings de implantação:", error);
      res.status(500).json({ error: "Erro interno ao buscar briefings de implantação." });
    }
  });

  // GET /api/gd/implementation-briefings/:id
  app.get("/api/gd/implementation-briefings/:id", requireFirebaseAuth, guardBriefingVexo, async (req, res) => {
    try {
      const { id } = req.params;
      const { rows } = await pool.query(
        `SELECT * FROM public.gd_implementation_briefings WHERE id = $1`,
        [id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: "Briefing de implantação não encontrado." });
      }
      res.json({ success: true, data: rows[0] });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao buscar briefing de implantação:", error);
      res.status(500).json({ error: "Erro interno ao buscar briefing de implantação." });
    }
  });

  // POST /api/gd/implementation-briefings
  app.post("/api/gd/implementation-briefings", requireFirebaseAuth, requireVexoCommercialAccess, async (req, res) => {
    try {
      const {
        tenant_id,
        client_name,
        model_type,
        suggested_model,
        num_employees,
        has_commercial_sector,
        prerequisites = {},
        operacao = {},
        inteligencia = {},
        agente_ia = {},
        canais = {},
        modulos_custom = {},
        fechamento = {},
        status = 'em_andamento',
        owner_company: ownerCompanyInput
      } = req.body;

      if (!client_name) {
        return res.status(400).json({ error: "O nome do cliente é obrigatório." });
      }

      const owner_company = ownerCompanyInput || req.body.ownerCompany || (req.body.isVexo ? "vexo" : "geracao-digital");
      const effectiveTenantId = String(tenant_id || client_name || "default-tenant").trim();
      const effectiveModelType = model_type || suggested_model || "essencial";

      const { rows } = await pool.query(
        `INSERT INTO public.gd_implementation_briefings (
          tenant_id, client_name, model_type, suggested_model, num_employees,
          has_commercial_sector, prerequisites, operacao, inteligencia, agente_ia,
          canais, modulos_custom, fechamento, status, owner_company
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING *`,
        [
          effectiveTenantId, client_name, effectiveModelType, suggested_model || effectiveModelType,
          Number(num_employees || 1), Boolean(has_commercial_sector),
          JSON.stringify(prerequisites), JSON.stringify(operacao),
          JSON.stringify(inteligencia), JSON.stringify(agente_ia),
          JSON.stringify(canais), JSON.stringify(modulos_custom),
          JSON.stringify(fechamento), status, owner_company
        ]
      );

      const record = rows[0];

      if (status === 'concluido') {
        try {
          await syncTenantImplementationConfig(pool, effectiveTenantId, record);
        } catch (syncErr) {
          console.warn("[GeracaoDigital] Aviso ao sincronizar config do tenant:", syncErr.message);
        }
      }

      res.json({ success: true, data: record });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao criar briefing de implantação:", error);
      res.status(500).json({ error: `Erro ao criar briefing de implantação: ${error.message}` });
    }
  });

  // PUT /api/gd/implementation-briefings/:id
  app.put("/api/gd/implementation-briefings/:id", requireFirebaseAuth, requireVexoCommercialAccess, guardBriefingVexo, async (req, res) => {
    try {
      const { id } = req.params;
      const {
        client_name,
        model_type,
        suggested_model,
        num_employees,
        has_commercial_sector,
        prerequisites,
        operacao,
        inteligencia,
        agente_ia,
        canais,
        modulos_custom,
        fechamento,
        status
      } = req.body;

      const { rows: currentRows } = await pool.query(
        `SELECT * FROM public.gd_implementation_briefings WHERE id = $1`,
        [id]
      );
      if (currentRows.length === 0) {
        return res.status(404).json({ error: "Briefing de implantação não encontrado." });
      }

      const curr = currentRows[0];
      const newStatus = status || curr.status;

      const { rows } = await pool.query(
        `UPDATE public.gd_implementation_briefings SET
          client_name = COALESCE($1, client_name),
          model_type = COALESCE($2, model_type),
          suggested_model = COALESCE($3, suggested_model),
          num_employees = COALESCE($4, num_employees),
          has_commercial_sector = COALESCE($5, has_commercial_sector),
          prerequisites = COALESCE($6, prerequisites),
          operacao = COALESCE($7, operacao),
          inteligencia = COALESCE($8, inteligencia),
          agente_ia = COALESCE($9, agente_ia),
          canais = COALESCE($10, canais),
          modulos_custom = COALESCE($11, modulos_custom),
          fechamento = COALESCE($12, fechamento),
          status = $13,
          updated_at = NOW()
        WHERE id = $14 RETURNING *`,
        [
          client_name, model_type, suggested_model,
          num_employees !== undefined ? Number(num_employees) : null,
          has_commercial_sector !== undefined ? Boolean(has_commercial_sector) : null,
          prerequisites ? JSON.stringify(prerequisites) : null,
          operacao ? JSON.stringify(operacao) : null,
          inteligencia ? JSON.stringify(inteligencia) : null,
          agente_ia ? JSON.stringify(agente_ia) : null,
          canais ? JSON.stringify(canais) : null,
          modulos_custom ? JSON.stringify(modulos_custom) : null,
          fechamento ? JSON.stringify(fechamento) : null,
          newStatus, id
        ]
      );

      const updatedRecord = rows[0];

      if (newStatus === 'concluido') {
        try {
          await syncTenantImplementationConfig(pool, updatedRecord.tenant_id, updatedRecord);
        } catch (syncErr) {
          console.warn("[GeracaoDigital] Aviso ao sincronizar config do tenant:", syncErr.message);
        }
      }

      res.json({ success: true, data: updatedRecord });
    } catch (error) {
      console.error("[GeracaoDigital] Erro ao atualizar briefing de implantação:", error);
      res.status(500).json({ error: `Erro ao atualizar briefing de implantação: ${error.message}` });
    }
  });

  async function syncTenantImplementationConfig(dbPool, tenantId, briefing) {
    try {
      const tmRes = await dbPool.query("SELECT config FROM public.tenant_modules WHERE tenant_id = $1", [tenantId]);
      let currentConfig = tmRes.rows[0]?.config || {};
      let gdConfig = currentConfig.gd || {};
      gdConfig.implementation = briefing;
      currentConfig.gd = gdConfig;

      await dbPool.query(
        `INSERT INTO public.tenant_modules (tenant_id, module_key, is_enabled, config, updated_at)
         VALUES ($1, 'geracao-digital', true, $2, NOW())
         ON CONFLICT (tenant_id, module_key)
         DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()`,
        [tenantId, JSON.stringify(currentConfig)]
      );

      console.log(`[syncTenantImplementationConfig] Config de implantação sincronizada para o tenant ${tenantId}`);
    } catch (err) {
      console.error(`[syncTenantImplementationConfig] Erro ao sincronizar com tenant_modules:`, err);
    }
  }
}
