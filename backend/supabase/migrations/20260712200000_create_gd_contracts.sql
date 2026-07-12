CREATE TABLE IF NOT EXISTS gd_contract_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  nome TEXT NOT NULL,
  conteudo TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gd_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  proposal_id UUID REFERENCES gd_proposals(id),
  dados JSONB NOT NULL,
  pdf_url TEXT,
  status TEXT NOT NULL DEFAULT 'rascunho',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ 
DECLARE
  v_tenant_id UUID;
  v_template_nome TEXT := 'Mestre - GD Assessoria';
  v_template_conteudo TEXT := 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS 
MARKETING DIGITAL E PUBLICIDADE EM GERAL 

Cláusula Primeira - Das Partes 
Por instrumento particular, de um lado, CAIO VINÍCIUS ALMEIDA DE OLIVEIRA, CNPJ: 40.508.817/0001-90 com sede na cidade de Uberlândia. Av. Paraná – 65. Tibery, CEP: 38405-022. Telefone (34) 99771-9779, doravante designada Contratada, e de outro lado, o {{razao_social}}, inscrito sob o CNPJ: {{cnpj}} e telefone {{telefone}} e-mail: {{email}}, sob responsabilidade de {{representante}}; endereço {{endereco}} Brasil, doravante designado Contratante, avençado o presente Contrato de Prestação de Serviços que será regido pelas cláusulas e condições a seguir expostas. 

Cláusula Segunda - Dos Objetos 
{{produtos}}

Cláusula Terceira - Das Obrigações das Partes 
Compete à Contratante: 
A. Responder ao Briefing (documento com perguntas sobre a realidade da contratante, abrangendo seu produto ou serviço e seu público). 
B. Fazer pagamento na data agendada. 
C. Comparecer às agendas previamente marcadas seja de forma on-line ou presencial. 

Compete à Contratada: 
A. Efetuar a criação de até 15 artes mensais, assim como o seu conteúdo escrito, considerando: Carrossel, estáticos e vídeos. 
B. Realizar as devidas postagens seguindo cronograma mensal. 
C. Passar os dados de resultados dos anúncios realizados, sempre que solicitado pela Contratante. 
D. Fazer a gravação de conteúdo e fotos para início do projeto e sempre que marcado previamente. 

Cláusula Quarta – Do Preço e Condições 
O pagamento para a gestão de redes sociais tráfego pago e manutenção de conteúdo será feito nos seguintes termos:
{{condicoes_pagamento}}

Cláusula Quinta - Do Prazo 
O presente instrumento é firmado no prazo de {{vigencia}} dias após a assinatura do contrato. 
O instrumento aqui analisado pode ser rescindido a qualquer tempo, por qualquer das partes, devendo para tanto fazer comunicação prévia de 60 (sessenta) dias, formalizado por escrito em um dos canais de comunicação oficial da empresa contratada. 
Este objeto será automaticamente renovado por igual período, se não houver manifestação de desacordo de uma das partes. 
O mesmo será analisado em reunião mútua para reajuste de valores (reajuste de 10%) para novo contrato, após o fim deste período inicial. 

Cláusula Sexta – Do Foro 
As partes em comum acordo elegem o foro da Comarca de Uberlândia-MG, para dirimir quaisquer questões ou dúvidas oriundas do presente contrato. 
E, por estarem assim justas e contratadas, firmam o presente contrato em 02 (duas) vias, para um só efeito. 

Uberlândia, {{data_extenso}}';
BEGIN
  -- We assume the tenant 'LuizApenas' or whatever standard tenant GD operates under. 
  -- Typically, this seed might need to be run per-tenant or on the master tenant.
  -- We'll try to find the GD tenant, if not, fallback to the first one available.
  SELECT id INTO v_tenant_id FROM tenants WHERE name ILIKE '%Luiz%' OR name ILIKE '%Geração Digital%' LIMIT 1;
  
  IF v_tenant_id IS NULL THEN
    SELECT id INTO v_tenant_id FROM tenants LIMIT 1;
  END IF;

  IF v_tenant_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM gd_contract_templates WHERE nome = v_template_nome AND tenant_id = v_tenant_id) THEN
      INSERT INTO gd_contract_templates (tenant_id, nome, conteudo)
      VALUES (v_tenant_id, v_template_nome, v_template_conteudo);
    END IF;
  END IF;
END $$;
