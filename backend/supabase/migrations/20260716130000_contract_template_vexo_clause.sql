-- Versão final do template de contrato: adiciona a Cláusula Terceira (Plataforma
-- Vexo OS, como PRODUTO fornecido pela Contratada — nunca como segunda parte) e
-- transforma a quantidade de artes mensais em merge field {{artes_mensais}}.
--
-- Arquivo novo (e não edição do 20260716120000) porque o runner registra as
-- migrations por NOME em app_schema_migrations e nunca re-executa um arquivo já
-- aplicado. Idempotente: UPDATE por nome, converge para o mesmo estado final.
UPDATE public.gd_contract_templates
SET nome = 'Contrato de Prestação de Serviços - Marketing Digital',
    conteudo = $tpl$CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE MARKETING DIGITAL E PUBLICIDADE EM GERAL

Cláusula Primeira - Das Partes
Por instrumento particular, de um lado, CAIO VINÍCIUS ALMEIDA DE OLIVEIRA, CNPJ: 40.508.817/0001-90, com sede na cidade de Uberlândia. Av. Paraná – 65, Tibery, CEP: 38405-022. Telefone (34) 99771-9779, doravante designada Contratada, e de outro lado, {{razao_social}}, inscrito sob o CNPJ: {{cnpj}}, telefone {{telefone}} {{telefone2}}, e-mail: {{email}}, sob responsabilidade de {{representante}}; endereço {{endereco}}, doravante designado Contratante, avençado o presente Contrato de Prestação de Serviços que será regido pelas cláusulas e condições a seguir expostas.

Cláusula Segunda - Dos Objetos
{{produtos}}

Cláusula Terceira - Da Plataforma Vexo OS
Como parte integrante dos serviços ora contratados, a Contratada disponibilizará à Contratante, durante toda a vigência deste contrato, o acesso à plataforma Vexo OS, sistema de gestão comercial, automação de atendimento, follow-up e relatórios fornecido pela Contratada como componente de sua solução.
A licença de uso é pessoal, intransferível e vigora enquanto durar o presente contrato, cessando automaticamente com o seu término.
Os dados inseridos na plataforma pertencem à Contratante, que poderá solicitar a sua exportação a qualquer tempo.
O treinamento das equipes e o suporte técnico relativos à plataforma serão prestados pela Contratada, que responde perante a Contratante pela disponibilidade e pelo funcionamento da solução.

Cláusula Quarta - Das Obrigações das Partes
Compete à Contratante:
A. Responder ao Briefing (documento com perguntas sobre a realidade da contratante, abrangendo seu produto ou serviço e seu público).
B. Fazer pagamento na data agendada.
C. Comparecer às agendas previamente marcadas, seja de forma on-line ou presencial.
Compete à Contratada:
A. Efetuar a criação de até {{artes_mensais}} artes mensais, assim como o seu conteúdo escrito, considerando: carrossel, estáticos e vídeos.
B. Realizar as devidas postagens seguindo cronograma mensal.
C. Passar os dados de resultados dos anúncios realizados, sempre que solicitado pela Contratante.
D. Fazer a gravação de conteúdo e fotos para início do projeto e sempre que marcado previamente.
E. Disponibilizar e manter o acesso à plataforma Vexo OS, nos termos da Cláusula Terceira.

Cláusula Quinta – Do Preço e Condições
O pagamento pela prestação dos serviços será feito {{forma_pagamento}}, com vencimento nas seguintes datas:
{{cronograma_pagamento}}

Cláusula Sexta - Do Prazo
O presente instrumento é firmado no prazo de {{prazo_dias}} dias após a assinatura do contrato. O instrumento aqui analisado pode ser rescindido a qualquer tempo, por qualquer das partes, devendo para tanto fazer comunicação prévia de {{aviso_previo_dias}} dias, formalizado por escrito em um dos canais de comunicação oficial da empresa contratada. Este objeto será automaticamente renovado por igual período, se não houver manifestação de desacordo de uma das partes. O mesmo será analisado em reunião mútua para reajuste de valores para novo contrato, após o fim deste período inicial.

Cláusula Sétima – Do Foro
As partes, em comum acordo, elegem o foro da Comarca de {{foro_cidade}}, para dirimir quaisquer questões ou dúvidas oriundas do presente contrato.

E, por estarem assim justas e contratadas, firmam o presente contrato em 02 (duas) vias, para um só efeito.

{{cidade_assinatura}}, {{data_extenso}}$tpl$,
    updated_at = now()
WHERE nome IN (
  'Contrato Padrão de Prestação de Serviços',
  'Contrato de Prestação de Serviços - Marketing Digital'
);
