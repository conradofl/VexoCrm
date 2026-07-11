-- 1. Create public.vexo_products table
CREATE TABLE IF NOT EXISTS public.vexo_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  nome TEXT NOT NULL,
  descricao TEXT,
  valor NUMERIC NOT NULL DEFAULT 0,
  recorrencia TEXT NOT NULL DEFAULT 'mensal',
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Seed idempotente e não-destrutivo dos módulos Vexo.
-- Insere apenas módulos que ainda não existem (por tenant + nome);
-- nunca apaga nem sobrescreve itens editados pelo cliente.
INSERT INTO public.vexo_products (tenant_id, nome, descricao, valor, recorrencia, ativo)
SELECT t.id, p.nome, p.descricao, p.valor, p.recorrencia, true
FROM public.tenants t
CROSS JOIN (
    VALUES
        ('Agente de IA / SDR', 'Agente inteligente automatizado para prospecção ativa e qualificação de leads.', 1500.00, 'mensal'),
        ('Automação de WhatsApp', 'Disparos automáticos, gerenciamento de filas e atendimento automatizado via WhatsApp.', 450.00, 'mensal'),
        ('CRM Vexo', 'Funil de vendas, gestão de contatos, histórico e pipeline comercial integrado.', 300.05, 'mensal'),
        ('Follow-up automático', 'Lembretes automáticos, réguas de relacionamento e cadência automatizada.', 200.00, 'mensal'),
        ('Campanhas', 'Gestão de disparos em lote, testes A/B e relatórios de entrega.', 150.00, 'mensal'),
        ('Chips WhatsApp', 'Conectividade multi-chips, controle de instâncias e status de conexão.', 100.00, 'mensal'),
        ('Inteligência Comercial / Relatórios', 'Painel analítico, previsões de faturamento, ROI e inteligência de dados.', 500.00, 'mensal')
) AS p(nome, descricao, valor, recorrencia)
WHERE NOT EXISTS (
    SELECT 1 FROM public.vexo_products vp
    WHERE vp.tenant_id = t.id AND vp.nome = p.nome
);
