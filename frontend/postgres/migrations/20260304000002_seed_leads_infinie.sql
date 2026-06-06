-- VexoCrm: seed initial Infinie leads from planilha-leads-infinie
-- Upsert by (client_id, telefone) so re-running is idempotent

INSERT INTO public.leads (
  client_id, telefone, nome, tipo_cliente, faixa_consumo, cidade, estado,
  conta_energia, status, bot_ativo, historico, data_hora, qualificacao
) VALUES
  (
    'infinie', '553498976954', 'Maria Eduarda', 'casa', 'acima de 300',
    'Uberlândia', 'Minas Gerais', NULL, 'em_qualificacao', true,
    '🔥 NOVO LEAD QUALIFICADO
📍 Local: Uberlândia
🏠 Perfil: casa
💰 Consumo: acima de 300

📝 Resumo: O cliente tem uma conta de aproximadamente R$ 400 e está interessado em desenvolver um projeto de energia solar para sua casa. Está aberto a soluções que se encaixem no seu consumo elevado.',
    '2026-02-12T00:45:06.860-03:00'::timestamptz, NULL
  ),
  (
    'infinie', '553497909004', 'Fabricio', 'residencial', '500',
    'Araguari', 'MG', NULL, 'em_qualificacao', true,
    '🔥 NOVO LEAD QUALIFICADO

📍 Local: Araguari - MG
🏠 Perfil: Casa
💰 Consumo: R$ 500 /mês

⚡ Temperatura: QUENTE 🔴

📝 Resumo:
Lead confirmou interesse em energia solar para residência com conta alta de R$500/mês e aguarda proposta personalizada, demonstrando boa disposição e rapidez no contato.

🎯 Dica pro vendedor:
Apresentar proposta ágil e destacar a economia mensal e vantagens específicas para o perfil residencial do cliente.

⚠️ Pontos de atenção:
Nenhum',
    '2026-02-20T08:40:37.712-03:00'::timestamptz, NULL
  ),
  (
    'infinie', '553491614690', 'Luiz Felipe', NULL, 'R$200',
    'Uberlândia', 'Minas Gerais', NULL, 'em_qualificacao', true,
    '🔥 NOVO LEAD RESIDENCIAL INFINIE

📍 Local: Uberlândia - Minas Gerais
🏠 Imóvel: Casa
💰 Consumo: R$ 200 /mês | 1 unidade
⚡ Distribuidora: Cemig

📧 E-mail: luiz@gmail.com

⚡ Temperatura: QUENTE 🔴

📝 Resumo:
O cliente busca uma solução para otimizar seus custos de energia; o lead está aberto a receber uma proposta personalizada.

🎯 Dica pro closer:
Aproveite para destacar como sua solução pode ajudar a reduzir os custos de energia para a residência, considerando a possibilidade de uma proposta personalizada com condições especiais.

⚠️ Pontos de atenção:
- Consumo mensal moderado → destacar benefícios de longo prazo;
- Residência unifamiliar → fácil implementação de soluções.',
    '2026-02-25T15:54:15.404-03:00'::timestamptz, NULL
  ),
  (
    'infinie', '553430464943', 'ECV Uberlândia Vistorias', NULL, NULL,
    'Po', NULL, NULL, NULL, false, NULL,
    '2026-02-20T09:23:50.286-03:00'::timestamptz, NULL
  ),
  (
    'infinie', '553499881913', 'Cayke', 'residencial', '200',
    'Uberlândia', 'MG', NULL, 'em_qualificacao', true,
    '🔥 NOVO LEAD QUALIFICADO

📍 Local: Uberlândia - MG
🏠 Perfil: Casa
💰 Consumo: R$ 200 /mês

⚡ Temperatura: FRIO 🔵

📝 Resumo:
Lead forneceu os dados básicos para cotação de energia solar para sua casa. A conversa não apresentou sinais de urgência ou engajamento do lead, apenas a coleta das informações.

🎯 Dica pro vendedor:
O consumo é baixo, então o foco deve ser em avaliar a viabilidade financeira do projeto e ser transparente sobre a economia esperada. Sondar o interesse real do lead antes de aprofundar muito.

⚠️ Pontos de atenção:
- Consumo abaixo de R$300 — avaliar se o projeto fecha conta antes de investir muito tempo
- Ausência de informações sobre o engajamento ou urgência do lead na conversa
- Sem sinais de compra explícitos — abordar de forma breve para sondar interesse real',
    '2026-02-22T15:14:57.367-03:00'::timestamptz, NULL
  ),
  (
    'infinie', '553497817660', 'Conrado', NULL, 'R$1.300',
    'Uberlândia', 'MG', NULL, 'em_qualificacao', true,
    '🔥 NOVO LEAD EMPRESARIAL INFINIE

📍 Local: Uberlândia - MG
🏢 Empresa: Comércio
💰 Consumo: R$ 1300 /mês | 2 unidades
⚡ Distribuidora: CEMIG

📧 E-mail: conradofl@gmail.com

⚡ Temperatura: QUENTE 🔴

📝 Resumo:
A empresa busca uma solução para otimizar seus custos de energia; o lead está aberto a receber uma proposta personalizada.

🎯 Dica pro closer:
Aproveite para destacar como sua solução pode ajudar a reduzir os custos de energia para o comércio, considerando a possibilidade de uma proposta personalizada com condições especiais para múltiplas unidades.

⚠️ Pontos de atenção:
- Múltiplas unidades → perguntar sobre CNPJ de cada unidade e possibilidade de unificar contratos;
- Consumo mensal considerável → destacar ROI rápido.',
    '2026-02-25T15:29:35.433-03:00'::timestamptz, NULL
  )
ON CONFLICT (client_id, telefone) DO UPDATE SET
  nome = EXCLUDED.nome,
  tipo_cliente = EXCLUDED.tipo_cliente,
  faixa_consumo = EXCLUDED.faixa_consumo,
  cidade = EXCLUDED.cidade,
  estado = EXCLUDED.estado,
  conta_energia = EXCLUDED.conta_energia,
  status = EXCLUDED.status,
  bot_ativo = EXCLUDED.bot_ativo,
  historico = EXCLUDED.historico,
  data_hora = EXCLUDED.data_hora,
  qualificacao = EXCLUDED.qualificacao,
  updated_at = now();
