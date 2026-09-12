-- Atualiza o template padrao de contratos GD substituindo o texto fixo da Contratada
-- com CNPJ 40.508.817/0001-90 por marcadores dinamicos {{contratada_*}}, garantindo
-- o isolamento multi-tenant (cada empresa preenche sua Contratada em tenant_modules).
--
-- Idempotente: filtra por WHERE conteudo LIKE '%40.508.817/0001-90%'.
-- Contratos ja gerados (gd_contracts) permanecem 100% intocados como registros historicos.

UPDATE public.gd_contract_templates
SET conteudo = REPLACE(
      REPLACE(
        conteudo,
        'CAIO VINÍCIUS ALMEIDA DE OLIVEIRA, CNPJ: 40.508.817/0001-90, com sede na cidade de Uberlândia. Av. Paraná – 65, Tibery, CEP: 38405-022. Telefone (34) 99771-9779, doravante designada Contratada',
        '{{contratada_razao_social}}, CNPJ: {{contratada_cnpj}}, sob responsabilidade de {{contratada_representante}}, com sede em {{contratada_endereco}}, telefone: {{contratada_telefone}}, e-mail: {{contratada_email}}, doravante designada Contratada'
      ),
      'elegem o foro da Comarca de {{foro_cidade}}',
      'elegem o foro da Comarca de {{contratada_comarca}}'
    ),
    updated_at = now()
WHERE conteudo LIKE '%40.508.817/0001-90%';
