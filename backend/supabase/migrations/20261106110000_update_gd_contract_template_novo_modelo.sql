-- 20261106110000_update_gd_contract_template_novo_modelo.sql
-- Atualiza o modelo de contrato padrão da Geração Digital para o novo modelo oficial
-- baseado em CONTRATO_PARCERIA - MODELO (1).docx com 6 cláusulas estruturadas e
-- dados oficiais da Contratada AGÊNCIA GERAÇÃO DIGITAL LTDA (CNPJ: 66.722.723/0001-02).

-- 1. Garante que as colunas clausulas e template_id existam
ALTER TABLE public.gd_contract_templates
ADD COLUMN IF NOT EXISTS clausulas JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.gd_contracts
ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.gd_contract_templates(id);

-- 2. Atualiza os dados da Contratada em public.tenant_modules para o tenant padrão da GD
-- (00000000-0000-0000-0000-000000000000)
INSERT INTO public.tenant_modules (tenant_id, config)
VALUES (
  '00000000-0000-0000-0000-000000000000'::uuid,
  jsonb_build_object(
    'contratada', jsonb_build_object(
      'razao_social', 'AGÊNCIA GERAÇÃO DIGITAL LTDA',
      'cnpj', '66.722.723/0001-02',
      'representante', 'Caio Vinícius Almeida de Oliveira',
      'endereco', 'Av. Paraná, 65, Tibery, Uberlândia – MG, CEP 38405-022',
      'telefone', '(34) 99771-9779',
      'email', 'comercial@mktgeracaodigital.com.br',
      'comarca', 'Uberlândia – MG',
      'assinatura', 'Caio Vinícius Almeida de Oliveira'
    ),
    'gd', jsonb_build_object(
      'contratada', jsonb_build_object(
        'razao_social', 'AGÊNCIA GERAÇÃO DIGITAL LTDA',
        'cnpj', '66.722.723/0001-02',
        'representante', 'Caio Vinícius Almeida de Oliveira',
        'endereco', 'Av. Paraná, 65, Tibery, Uberlândia – MG, CEP 38405-022',
        'telefone', '(34) 99771-9779',
        'email', 'comercial@mktgeracaodigital.com.br',
        'comarca', 'Uberlândia – MG',
        'assinatura', 'Caio Vinícius Almeida de Oliveira'
      )
    )
  )
)
ON CONFLICT (tenant_id) DO UPDATE
SET config = jsonb_set(
  jsonb_set(
    COALESCE(public.tenant_modules.config, '{}'::jsonb),
    '{contratada}',
    jsonb_build_object(
      'razao_social', 'AGÊNCIA GERAÇÃO DIGITAL LTDA',
      'cnpj', '66.722.723/0001-02',
      'representante', 'Caio Vinícius Almeida de Oliveira',
      'endereco', 'Av. Paraná, 65, Tibery, Uberlândia – MG, CEP 38405-022',
      'telefone', '(34) 99771-9779',
      'email', 'comercial@mktgeracaodigital.com.br',
      'comarca', 'Uberlândia – MG',
      'assinatura', 'Caio Vinícius Almeida de Oliveira'
    )
  ),
  '{gd,contratada}',
  jsonb_build_object(
    'razao_social', 'AGÊNCIA GERAÇÃO DIGITAL LTDA',
    'cnpj', '66.722.723/0001-02',
    'representante', 'Caio Vinícius Almeida de Oliveira',
    'endereco', 'Av. Paraná, 65, Tibery, Uberlândia – MG, CEP 38405-022',
    'telefone', '(34) 99771-9779',
    'email', 'comercial@mktgeracaodigital.com.br',
    'comarca', 'Uberlândia – MG',
    'assinatura', 'Caio Vinícius Almeida de Oliveira'
  )
);

-- 3. Insere ou atualiza o template padrão na tabela public.gd_contract_templates
DO $$
DECLARE
  v_conteudo text;
  v_clausulas jsonb;
BEGIN
  v_conteudo := $tpl$CONTRATO DE PRESTAÇÃO DE SERVIÇOS
MARKETING DIGITAL & AUTOMAÇÃO

CLÁUSULA PRIMEIRA | DAS PARTES

CONTRATADA
{{contratada_razao_social}}
CNPJ: {{contratada_cnpj}}
Representante: {{contratada_representante}}
Endereço: {{contratada_endereco}}
Telefone: {{contratada_telefone}}
E-mail: {{contratada_email}}

CONTRATANTE
{{razao_social}}
CNPJ: {{cnpj}}
Responsável: {{representante_nome}}
Endereço: {{endereco}}
Telefone: {{telefone}}
E-mail: {{email}}

Por este instrumento particular, as partes acima qualificadas, doravante designadas simplesmente CONTRATADA e CONTRATANTE, celebram o presente Contrato de Prestação de Serviços, que será regido pelas cláusulas e condições a seguir expostas.

CLÁUSULA SEGUNDA | DOS OBJETOS

Constitui objeto do presente contrato a prestação de serviços de marketing, automação de sistemas, inteligência artificial, consultoria comercial e marketing.

CLÁUSULA TERCEIRA | DAS OBRIGAÇÕES DAS PARTES

Compete à CONTRATANTE:
1. Responder ao Briefing (documento com dados e especificações do material requerido pela cliente, assim como dúvidas surgidas pela equipe na confecção dos mesmos);
2. Dar a devida cadência e atendimento ao cliente final;
3. Repassar informações para campanhas;
4. Comparecer aos dias de gravações previamente autorizados e combinados com a equipe;
5. Fazer pagamento na data agendada.

Compete à CONTRATADA:
1. Efetuar treinamento para utilização do sistema Vexo;
2. Prestar consultoria para validar o projeto de marketing e afins;
3. Criar as campanhas de disparo para WhatsApp;
4. Acompanhar resultados mensais do cliente;
5. Organizar o banco de dados de acordo com o repasse do cliente;
6. Estruturar conjuntamente a área comercial da CONTRATANTE.

CLÁUSULA QUARTA | DO PREÇO E CONDIÇÕES

O valor do contrato corresponde à soma total das mensalidades pelo período acordado:

Compromisso do Período:
{{valor_total}}

COMPOSIÇÃO DO PERÍODO

Em reais (conforme condições de pagamento):
{{cronograma_pagamento}}

Em permuta:
{{condicao_permuta}}

CLÁUSULA QUINTA | DO PRAZO

O presente instrumento é firmado pelo prazo de {{prazo_meses}} meses, contados a partir da data de sua assinatura.

CLÁUSULA SEXTA | DO FORO

As partes, em comum acordo, elegem o foro da Comarca de {{contratada_comarca}} para dirimir quaisquer questões ou dúvidas oriundas do presente contrato.

E, por estarem assim justas e contratadas, firmam o presente contrato em 02 (duas) vias, para um só efeito.

{{contratada_comarca}}, {{data_extenso}}.

____________________________________________________
CONTRATADA
{{contratada_razao_social}}
{{contratada_representante}}

____________________________________________________
CONTRATANTE
{{razao_social}}
{{representante_nome}}

Testemunha 1
Nome: _____________________________________________
CPF: ______________________________________________

Testemunha 2
Nome: _____________________________________________
CPF: ______________________________________________$tpl$;

  v_clausulas := $json$[
    {
      "id": "partes",
      "titulo": "Das Partes",
      "conteudo": "CONTRATADA\n{{contratada_razao_social}}\nCNPJ: {{contratada_cnpj}}\nRepresentante: {{contratada_representante}}\nEndereço: {{contratada_endereco}}\nTelefone: {{contratada_telefone}}\nE-mail: {{contratada_email}}\n\nCONTRATANTE\n{{razao_social}}\nCNPJ: {{cnpj}}\nResponsável: {{representante_nome}}\nEndereço: {{endereco}}\nTelefone: {{telefone}}\nE-mail: {{email}}\n\nPor este instrumento particular, as partes acima qualificadas, doravante designadas simplesmente CONTRATADA e CONTRATANTE, celebram o presente Contrato de Prestação de Serviços, que será regido pelas cláusulas e condições a seguir expostas.",
      "ativo": true,
      "obrigatorio": true
    },
    {
      "id": "objetos",
      "titulo": "Dos Objetos",
      "conteudo": "Constitui objeto do presente contrato a prestação de serviços de marketing, automação de sistemas, inteligência artificial, consultoria comercial e marketing.",
      "ativo": true,
      "obrigatorio": true
    },
    {
      "id": "obrigacoes",
      "titulo": "Das Obrigações das Partes",
      "conteudo": "Compete à CONTRATANTE:\n1. Responder ao Briefing (documento com dados e especificações do material requerido pela cliente, assim como dúvidas surgidas pela equipe na confecção dos mesmos);\n2. Dar a devida cadência e atendimento ao cliente final;\n3. Repassar informações para campanhas;\n4. Comparecer aos dias de gravações previamente autorizados e combinados com a equipe;\n5. Fazer pagamento na data agendada.\n\nCompete à CONTRATADA:\n1. Efetuar treinamento para utilização do sistema Vexo;\n2. Prestar consultoria para validar o projeto de marketing e afins;\n3. Criar as campanhas de disparo para WhatsApp;\n4. Acompanhar resultados mensais do cliente;\n5. Organizar o banco de dados de acordo com o repasse do cliente;\n6. Estruturar conjuntamente a área comercial da CONTRATANTE.",
      "ativo": true,
      "obrigatorio": true
    },
    {
      "id": "preco_condicoes",
      "titulo": "Do Preço e Condições",
      "conteudo": "O valor do contrato corresponde à soma total das mensalidades pelo período acordado:\n\nCompromisso do Período:\n{{valor_total}}\n\nCOMPOSIÇÃO DO PERÍODO\n\nEm reais (conforme condições de pagamento):\n{{cronograma_pagamento}}\n\nEm permuta:\n{{condicao_permuta}}",
      "ativo": true,
      "obrigatorio": true
    },
    {
      "id": "prazo",
      "titulo": "Do Prazo",
      "conteudo": "O presente instrumento é firmado pelo prazo de {{prazo_meses}} meses, contados a partir da data de sua assinatura.",
      "ativo": true,
      "obrigatorio": true
    },
    {
      "id": "foro",
      "titulo": "Do Foro",
      "conteudo": "As partes, em comum acordo, elegem o foro da Comarca de {{contratada_comarca}} para dirimir quaisquer questões ou dúvidas oriundas do presente contrato.",
      "ativo": true,
      "obrigatorio": true
    }
  ]$json$::jsonb;

  -- Desativa templates antigos do tenant padrão
  UPDATE public.gd_contract_templates
  SET ativo = false
  WHERE tenant_id = '00000000-0000-0000-0000-000000000000'::uuid;

  -- Insere o novo modelo oficial ativo
  INSERT INTO public.gd_contract_templates (
    tenant_id,
    nome,
    conteudo,
    clausulas,
    ativo,
    created_at,
    updated_at
  )
  VALUES (
    '00000000-0000-0000-0000-000000000000'::uuid,
    'Contrato Oficial de Parceria - Marketing Digital & Automação',
    v_conteudo,
    v_clausulas,
    true,
    now(),
    now()
  );
END $$;
