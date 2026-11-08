/**
 * gdPresentationGeneratorService.js
 *
 * Gerador de Slides Comerciais Personalizados por Nicho "Máquina de Vendas" (Frente 3).
 *
 * Responsabilidades:
 * 1. Catálogo especializado de conteúdo comercial adaptado por nicho de mercado:
 *    - Advocacia, Estética, Clínicas Médicas & Odontologia, Óticas, Varejo e B2B Geral.
 *    - Dores de mercado, diagnósticos, funis passo a passo, projeções de ROI e métricas.
 * 2. Adaptação dinâmica de conteúdo via Gemini (ou fallback heurístico determinístico).
 * 3. Geração da Apresentação em PowerPoint editável (.pptx) via pptxgenjs em formato 16:9.
 * 4. Geração da Apresentação pronta para exibição em PDF (.pdf) via pdfkit em formato 16:9.
 * 5. Aplicação da logomarca refinada e da paleta institucional de cores da marca.
 */

import PptxGenJS from "pptxgenjs";
import PDFDocument from "pdfkit";
import { normalizarChaveNicho, obterPaletaPadraoPorNicho, sanitizarHex } from "./gdLogoEnhancerService.js";

// ─── Catálogo Especializado de Dores, Diagnósticos e Soluções por Nicho ──────
export const CATALOGO_CONTEUDO_NICHOS = {
  advocacia: {
    nichoNome: "Advocacia & Serviços Jurídicos",
    subtituloCapa: "Aquisição Previsível de Clientes e Autoridade Jurídica Ética",
    estatisticaMercado: "82% dos potenciais clientes buscam advogados online quando enfrentam uma urgência jurídica e fecham com o primeiro escritório que responde de forma consultiva em até 5 minutos.",
    dores: [
      {
        titulo: "Dependência de Indicações Passivas",
        descricao: "Faturamento em montanha-russa devido à dependência exclusiva do 'boca a boca' de clientes antigos.",
      },
      {
        titulo: "Leads Desqualificados & Curiosos",
        descricao: "Sócios e advogados gastando horas respondendo pessoas que buscam apenas orientações gratuitas.",
      },
      {
        titulo: "Falta de Prospecção Ética e Previsível",
        descricao: "Dificuldade em prospectar ativamente respeitando o provimento e as diretrizes do código de ética da OAB.",
      },
    ],
    diagnosticoGargalos: [
      {
        fase: "1. Atração",
        problema: "Anúncios genéricos sem autoridade técnica ou focados em termos institucionais frios.",
        impacto: "Custo por lead alto e baixa intenção de contratação.",
      },
      {
        fase: "2. Atendimento",
        problema: "Demora de horas para responder o WhatsApp; o cliente em crise busca outro escritório.",
        impacto: "Perda de 65% dos leads antes mesmo do primeiro contato.",
      },
      {
        fase: "3. Fechamento",
        problema: "Falta de follow-up após o envio da proposta de honorários.",
        impacto: "Contratos de alto valor esquecidos na gaveta.",
      },
    ],
    solucaoPilares: [
      {
        pilar: "Atração Ética de Alta Intenção",
        titulo: "Tráfego Jurídico Especializado",
        descricao: "Campanhas no Google e Meta focadas em áreas de alto ticket (Trabalhista, Tributário, Família e Cível).",
      },
      {
        pilar: "Qualificação Imediata por IA",
        titulo: "SDR Jurídico Vexo OS",
        descricao: "Triagem automática em menos de 45 segundos, filtrando casos viáveis antes de passar para o advogado.",
      },
      {
        pilar: "Agendamento & Fechamento",
        titulo: "Agenda Integrada & Contratos",
        descricao: "Reuniões pré-agendadas direto na pauta dos sócios com proposta e contrato digital com 1 clique.",
      },
    ],
    etapasFunil: [
      { etapa: "1. Atração", canal: "Google & Meta Ads", descricao: "Anúncios de autoridade jurídica direcionados para quem precisa de solução urgente." },
      { etapa: "2. Triagem", canal: "WhatsApp + IA", descricao: "Filtro automatizado por capacidade financeira, urgência e requisitos da ação." },
      { etapa: "3. Consulta", canal: "Google Meet / Presencial", descricao: "Atendimento consultivo apenas com clientes qualificados e prontos para fechar." },
      { etapa: "4. Contrato", canal: "Assinatura Digital", descricao: "Fechamento ágil com contrato digital e procuração no mesmo dia." },
    ],
    metricas: [
      { valor: "< 45s", label: "Tempo de Resposta", detalhe: "Atendimento 24 horas por dia no WhatsApp" },
      { valor: "3x", label: "Crescimento em Contratos", detalhe: "Aumento consistente no volume de causas fechadas" },
      { valor: "+60%", label: "Economia de Tempo dos Sócios", detalhe: "Eliminação total do tempo perdido com curiosos" },
      { valor: "100%", label: "Conformidade OAB", detalhe: "Marketing jurídico ético, informativo e consultivo" },
    ],
  },

  estetica: {
    nichoNome: "Estética Avançada & Clínicas de Beleza",
    subtituloCapa: "Previsibilidade de Procedimentos e Redução Drástica de No-Show",
    estatisticaMercado: "Clínicas de estética perdem até 70% dos contatos no direct e WhatsApp por falta de agilidade no atendimento e ausência de scripts de fechamento consultivo.",
    dores: [
      {
        titulo: "Faltas e Cancelamentos de Última Hora (No-Show)",
        descricao: "Pacientes que agendam consultas avaliativas e não comparecem ('no-show'), gerando salas ociosas.",
      },
      {
        titulo: "Enxurrada de Curiosos por Preço",
        descricao: "Centenas de mensagens perguntando apenas 'quanto custa o Botox?', sem conversão real em procedimentos.",
      },
      {
        titulo: "Dependência de Posts Orgânicos",
        descricao: "Muitas curtidas no Instagram, mas pouquíssimos pacientes pagantes de procedimentos de alto valor.",
      },
    ],
    diagnosticoGargalos: [
      {
        fase: "1. Atração",
        problema: "Anúncios focados apenas em preço ou 'antes e depois' sem história e autoridade médica.",
        impacto: "Público sem poder aquisitivo e atração desqualificada.",
      },
      {
        fase: "2. Atendimento",
        problema: "Recepção sobrecarregada demorando para responder orçamentos e dúvidas dos procedimentos.",
        impacto: "A paciente esfria e fecha na clínica concorrente que respondeu antes.",
      },
      {
        fase: "3. Retenção",
        problema: "Ausência de rotina de pós-venda para novos procedimentos e manutenções periódicas.",
        impacto: "Perda da receita recorrente da carteira de clientes existente.",
      },
    ],
    solucaoPilares: [
      {
        pilar: "Funil de Procedimentos Âncora",
        titulo: "Campanhas de Alta Conversão",
        descricao: "Foco nos tratamentos mais lucrativos: Harmonização, Bioestimuladores, Botox e Tecnologias Corporais.",
      },
      {
        pilar: "Atendimento Instantâneo Humanizado",
        titulo: "Concierge de Vendas Vexo OS",
        descricao: "Acolhimento imediato com quebra de objeções, explicação dos benefícios e agendamento guiado.",
      },
      {
        pilar: "Confirmação & Redução de No-Show",
        titulo: "Lembretes Automáticos Multicanal",
        descricao: "Régua de confirmação 24h e 2h antes da consulta, reduzindo faltas para menos de 10%.",
      },
    ],
    etapasFunil: [
      { etapa: "1. Desejo", canal: "Meta Ads (Instagram)", descricao: "Vídeos e criativos de autoridade destacando transformação e segurança." },
      { etapa: "2. Conexão", canal: "WhatsApp Instantâneo", descricao: "Apresentação consultiva do procedimento e quebra de dúvidas de pós-operatório." },
      { etapa: "3. Avaliação", canal: "Agenda na Clínica", descricao: "Consulta avaliativa com presença confirmada e pré-alinhamento de expectativas." },
      { etapa: "4. Recompra", canal: "CRM de Retenção", descricao: "Avisos de manutenção programada (Botox a cada 6 meses, etc.)." },
    ],
    metricas: [
      { valor: "< 10%", label: "Taxa de No-Show", detalhe: "Redução drástica de faltas nas avaliações" },
      { valor: "+45%", label: "Conversão em Vendas", detalhe: "Pacotes fechados com ticket médio superior" },
      { valor: "24/7", label: "Recepção Virtual Ativa", detalhe: "Agendamentos mesmo à noite e aos finais de semana" },
      { valor: "2x", label: "LTV das Pacientes", detalhe: "Recorrência programada para novos procedimentos" },
    ],
  },

  clinica_medica: {
    nichoNome: "Clínicas Médicas & Odontologia",
    subtituloCapa: "Captação de Pacientes Particulares e Ocupação Máxima de Agenda",
    estatisticaMercado: "O paciente particular busca conveniência, autoridade e segurança. 74% dos pacientes fecham com a clínica que oferece agendamento rápido e explicação clara do tratamento.",
    dores: [
      {
        titulo: "Dependência de Repasses Baixos de Convênios",
        descricao: "Consultas de plano de saúde mal remuneradas que sobrecarregam a equipe sem rentabilidade.",
      },
      {
        titulo: "Salas e Equipamentos Ociosos",
        descricao: "Estrutura clínica de alto custo fixa com lacunas na grade de atendimento ao longo da semana.",
      },
      {
        titulo: "Falta de Follow-up de Orçamentos",
        descricao: "Planos de tratamento e cirurgias apresentados que nunca recebem contato de retorno.",
      },
    ],
    diagnosticoGargalos: [
      {
        fase: "1. Atração",
        problema: "Dificuldade em se posicionar como clínica particular premium na região.",
        impacto: "Atração massiva de usuários de convênio sem margem.",
      },
      {
        fase: "2. Atendimento",
        problema: "Recepção focada no balcão físico, deixando os leads do WhatsApp sem resposta rápida.",
        impacto: "Pacientes particulares desistem e agendam em outra clínica.",
      },
      {
        fase: "3. Negociação",
        problema: "Orçamentos de tratamentos complexos deixados na mão do paciente para decidir sozinho.",
        impacto: "Milhares de reais em tratamentos não iniciados todos os meses.",
      },
    ],
    solucaoPilares: [
      {
        pilar: "Posicionamento Particular",
        titulo: "Captação Direta de Alto Valor",
        descricao: "Anúncios segmentados por geolocalização e poder de compra para tratamentos particulares.",
      },
      {
        pilar: "Triagem Inteligente 24h",
        titulo: "Secretária Virtual Vexo OS",
        descricao: "Identificação do tratamento desejado, coleta de sintomas e agendamento direto na grade do médico/dentista.",
      },
      {
        pilar: "Fechamento de Tratamentos",
        titulo: "Follow-up Ativo & Contratos",
        descricao: "Acompanhamento consultivo de orçamentos pendentes com facilidade de pagamento parcelado.",
      },
    ],
    etapasFunil: [
      { etapa: "1. Descoberta", canal: "Google & Meta Ads", descricao: "Buscas por especialidades médicas e tratamentos específicos na sua cidade." },
      { etapa: "2. Acolhimento", canal: "WhatsApp com IA", descricao: "Respostas imediatas sobre convênios aceitos, particular e horários disponíveis." },
      { etapa: "3. Consulta", canal: "Agenda Integrada", descricao: "Paciente comparece com confirmação e histórico prévio coletado." },
      { etapa: "4. Tratamento", canal: "Acompanhamento CRM", descricao: "Fechamento do plano de tratamento e adesão ao cronograma de retorno." },
    ],
    metricas: [
      { valor: "+40%", label: "Receita Particular", detalhe: "Menor dependência de convênios médicos" },
      { valor: "92%", label: "Ocupação da Grade", detalhe: "Redução de janelas vagas na agenda dos especialistas" },
      { valor: "< 1 min", label: "Tempo Médio de Espera", detalhe: "Paciente atendido no momento em que procura" },
      { valor: "+50%", label: "Fechamento de Orçamentos", detalhe: "Aumento na adesão a tratamentos completos" },
    ],
  },

  otica: {
    nichoNome: "Óticas & Saúde Visual",
    subtituloCapa: "Geração de Fluxo de Loja e Vendas Diárias de Lentes Premium",
    estatisticaMercado: "Mais de 50% dos usuários de óculos precisam atualizar suas lentes a cada 12 a 18 meses, mas 85% das óticas nunca entram em contato para realizar a recompra ativa.",
    dores: [
      {
        titulo: "Guerra de Preços e Concorrência",
        descricao: "Disputa predatória com redes de fast-fashion ótico e lojas que vendem apenas pelo preço baixo.",
      },
      {
        titulo: "Dependência do Movimento da Calçada",
        descricao: "Dias com a loja vazia dependendo de pessoas que passam na porta sem intenção clara de compra.",
      },
      {
        titulo: "Receitas Antigas Esquecidas",
        descricao: "Base de milhares de clientes que compraram óculos há 1 ou 2 anos e nunca mais foram contatados.",
      },
    ],
    diagnosticoGargalos: [
      {
        fase: "1. Atração",
        problema: "Falta de campanhas direcionadas para exames de vista e lentes de alta tecnologia.",
        impacto: "Clientes compram lentes básicas com margens mínimas de lucro.",
      },
      {
        fase: "2. Atendimento",
        problema: "Orçamentos de óculos completos cotados no balcão sem registro de telefone para acompanhamento.",
        impacto: "O cliente vai embora 'pesquisar' e compra no concorrente.",
      },
      {
        fase: "3. Reativação",
        problema: "Zero contato após a entrega dos óculos.",
        impacto: "O cliente volta ao médico e compra os próximos óculos em qualquer outra ótica.",
      },
    ],
    solucaoPilares: [
      {
        pilar: "Captação Local de Exames & Armações",
        titulo: "Campanhas de Raio Curto",
        descricao: "Anúncios no raio de 3 a 7 km da sua ótica atraindo quem precisa trocar de armação e lentes.",
      },
      {
        pilar: "Atendimento & Reserva Express",
        titulo: "Consultor Ótico Vexo OS",
        descricao: "Apresentação dos modelos de armação e lentes no WhatsApp com reserva antecipada para prova na loja.",
      },
      {
        pilar: "Reativação de Receitas Vencidas",
        titulo: "Máquina de Recompra Anual",
        descricao: "Disparos segmentados para quem completou 1 ano da última receita, convidando para nova aferição.",
      },
    ],
    etapasFunil: [
      { etapa: "1. Atração", canal: "Meta & Google Ads", descricao: "Anúncios de armações exclusivas e campanhas de saúde visual na sua região." },
      { etapa: "2. Reserva", canal: "WhatsApp Comercial", descricao: "Cliente escolhe o estilo e agenda horário com o consultor ótico na loja." },
      { etapa: "3. Experiência", canal: "Loja Física", descricao: "Atendimento consultivo com venda casada de armação de marca e lentes premium." },
      { etapa: "4. Pós-Venda", canal: "CRM de Receitas", descricao: "Lembretes anuais de aferição e garantia de adaptação das lentes." },
    ],
    metricas: [
      { valor: "+45%", label: "Vendas de Lentes Premium", detalhe: "Maior ticket médio por cliente atendido" },
      { valor: "30%", label: "Recuperação de Inativos", detalhe: "Clientes antigos voltando a comprar todo ano" },
      { valor: "+35%", label: "Fluxo Semanal de Loja", detalhe: "Mais clientes entrando com intenção de compra" },
      { valor: "0%", label: "Orçamentos Perdidos", detalhe: "Todo cliente cotado recebe acompanhamento ativo" },
    ],
  },

  varejo: {
    nichoNome: "Varejo & Comércio Local",
    subtituloCapa: "Aceleração de Giro de Estoque e Vendas Omnicanal no WhatsApp",
    estatisticaMercado: "65% dos consumidores compram pelo WhatsApp quando há atendimento imediato, catálogo claro e link de pagamento facilitado, enquanto lojas lentas perdem a venda em 3 minutos.",
    dores: [
      {
        titulo: "Produtos Parados no Estoque",
        descricao: "Capital de giro imobilizado em coleções ou mercadorias que não giram com a velocidade necessária.",
      },
      {
        titulo: "Perda de Vendas Fora do Horário Comercial",
        descricao: "Clientes que querem comprar à noite ou nos finais de semana e não encontram ninguém para responder.",
      },
      {
        titulo: "Concorrência com Grandes Marketplaces",
        descricao: "Pressão de gigantes online (Mercado Livre, Shopee) exigindo atendimento mais consultivo e rápido.",
      },
    ],
    diagnosticoGargalos: [
      {
        fase: "1. Atração",
        problema: "Divulgação desordenada sem campanhas estruturadas para os produtos de maior margem.",
        impacto: "Desperdício de orçamento de publicidade sem retorno mensurável.",
      },
      {
        fase: "2. Atendimento",
        problema: "Mensagens acumuladas no WhatsApp Business da loja com horas de atraso na resposta.",
        impacto: "O consumidor compra em outro site com 1 clique.",
      },
      {
        fase: "3. Fechamento",
        problema: "Dificuldade em fechar o pagamento no próprio WhatsApp e enviar o produto rapidamente.",
        impacto: "Abandono de orçamentos e carrinhos de compras.",
      },
    ],
    solucaoPilares: [
      {
        pilar: "Tráfego de Alto Giro",
        titulo: "Campanhas de Produto & Catálogo",
        descricao: "Anúncios focados nos itens campeões de vendas com chamada direta para o WhatsApp da loja.",
      },
      {
        pilar: "Vendedor Virtual 24/7",
        titulo: "Atendimento Vexo OS",
        descricao: "Apresentação de fotos, grade de tamanhos/cores, cálculo de frete e link de pagamento PIX/Cartão.",
      },
      {
        pilar: "Recuperação de Vendas",
        titulo: "Régua Ativa de Fechamento",
        descricao: "Acompanhamento automático de orçamentos pendentes com ofertas de frete grátis ou parcelamento.",
      },
    ],
    etapasFunil: [
      { etapa: "1. Vitrine", canal: "Instagram & TikTok Ads", descricao: "Vídeos e fotos de demonstração dos produtos mais desejados da loja." },
      { etapa: "2. Seleção", canal: "WhatsApp Automatizado", descricao: "Cliente escolhe modelo, cor e tira dúvidas em menos de 30 segundos." },
      { etapa: "3. Pagamento", canal: "Link Seguro de Checkout", descricao: "Recebimento via PIX ou Cartão sem fricção dentro da conversa." },
      { etapa: "4. Entrega", canal: "Logística Expressa", descricao: "Rastreio e pós-venda para incentivar a próxima compra com cupom VIP." },
    ],
    metricas: [
      { valor: "2x", label: "Giro de Estoque", detalhe: "Liquidação acelerada de coleções e produtos âncora" },
      { valor: "+50%", label: "Vendas Noturnas e Fim de Semana", detalhe: "Loja vendendo mesmo de portas fechadas" },
      { valor: "< 30s", label: "Tempo de Atendimento", detalhe: "Resposta imediata na hora do impulso de compra" },
      { valor: "+38%", label: "Recompra no WhatsApp", detalhe: "Clientes comprando com frequência via lista VIP" },
    ],
  },

  geral_b2b: {
    nichoNome: "Serviços B2B & Consultoria",
    subtituloCapa: "Previsibilidade de Pipeline, SDR Automatizado e Escala de Vendas",
    estatisticaMercado: "Propostas comerciais B2B enviadas sem um processo estruturado de acompanhamento ativo perdem mais de 80% do potencial de fechamento após as primeiras 72 horas.",
    dores: [
      {
        titulo: "Ciclo de Vendas Longo e Imprevisível",
        descricao: "Meses de negociação sem certeza de quando os contratos serão assinados, gerando insegurança de caixa.",
      },
      {
        titulo: "Executivos Ocupados com Prospecção Fria",
        descricao: "Diretores e sócios gastando energia minerando leads frios em vez de focar no fechamento de grandes contas.",
      },
      {
        titulo: "Propostas Comerciais 'Esquecidas'",
        descricao: "Dezenas de propostas enviadas por e-mail que somem no vácuo e nunca recebem uma resposta definitiva.",
      },
    ],
    diagnosticoGargalos: [
      {
        fase: "1. Atração",
        problema: "Dificuldade em atingir os reais tomadores de decisão (C-Level, Diretores e Gerentes).",
        impacto: "Conversas com estagiários e intermediários sem poder de caneta.",
      },
      {
        fase: "2. Qualificação",
        problema: "Reuniões comerciais agendadas com empresas sem orçamento ou fit para o seu produto/serviço.",
        impacto: "Tempo dos closers desperdiçado em chamadas infrutíferas.",
      },
      {
        fase: "3. Fechamento",
        problema: "Follow-up manual e inconsistente após a apresentação da solução.",
        impacto: "Oportunidades quentes esfriam e são engavetadas.",
      },
    ],
    solucaoPilares: [
      {
        pilar: "Prospecção ABM & Inbound",
        titulo: "Tráfego & ICP Hipersegmentado",
        descricao: "Campanhas focadas exatamente no Perfil de Cliente Ideal (faturamento, porte e setor).",
      },
      {
        pilar: "Qualificação BANT por IA",
        titulo: "SDR Comercial Vexo OS",
        descricao: "Filtragem de Orçamento (Budget), Autoridade, Necessidade e Prazo antes da reunião.",
      },
      {
        pilar: "Follow-up Implacável",
        titulo: "Esteira de Fechamento & Assinatura",
        descricao: "Cadência multicanal (WhatsApp e E-mail) até a assinatura digital do contrato.",
      },
    ],
    etapasFunil: [
      { etapa: "1. Conexão", canal: "LinkedIn & Meta Ads", descricao: "Anúncios com cases de sucesso e diagnósticos exclusivos para tomadores de decisão." },
      { etapa: "2. Triagem", canal: "WhatsApp + SDR IA", descricao: "Validação do fit comercial e faturamento da empresa em tempo real." },
      { etapa: "3. Pitch", canal: "Reunião Comercial", descricao: "Demonstração estratégica com foco no ROI do projeto para os diretores." },
      { etapa: "4. Assinatura", canal: "Contrato Digital", descricao: "Fechamento simplificado com validade jurídica e início imediato." },
    ],
    metricas: [
      { valor: "-50%", label: "Ciclo Médio de Vendas", detalhe: "Fechamentos mais rápidos com clientes qualificados" },
      { valor: "3x", label: "Reuniões Qualificadas", detalhe: "Executivos falando apenas com quem tem poder de compra" },
      { valor: "+42%", label: "Taxa de Conversão em Propostas", detalhe: "Maior aproveitamento do pipeline comercial" },
      { valor: "100%", label: "Visibilidade do Funil", detalhe: "Métricas transparentes de ponta a ponta" },
    ],
  },
};

/**
 * Obtém o conteúdo de apresentação especializado conforme o nicho do prospect
 */
export async function obterConteudoNicho({
  nicho = "",
  prospectName = "Prospect",
  apiKey = null,
  model = "gemini-flash-latest",
  llmCaller = null,
} = {}) {
  const chave = normalizarChaveNicho(nicho || prospectName);
  const baseConteudo = CATALOGO_CONTEUDO_NICHOS[chave] || CATALOGO_CONTEUDO_NICHOS.geral_b2b;

  const effectiveApiKey =
    apiKey ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    "";

  // Se não temos API key e nem mock caller: retorna conteúdo determinístico de altíssima qualidade
  if (!effectiveApiKey && typeof llmCaller !== "function") {
    return {
      chaveNicho: chave,
      prospectName,
      ...baseConteudo,
    };
  }

  // Refinamento dinâmico com Gemini se credencial disponível
  const prompt = `
Você é o Estrategista Comercial Sênior da Geração Digital (agência de growth e inbound marketing com Vexo OS).
Personalize os textos da apresentação comercial "Máquina de Vendas" para o prospect:
- Nome da Empresa: "${prospectName}"
- Nicho de Atuação: "${nicho || baseConteudo.nichoNome}"

BASE DE REFERÊNCIA DO NICHO:
${JSON.stringify(baseConteudo, null, 2)}

SUA MISSÃO:
Gere uma versão adaptada mantendo o rigor técnico e o poder de persuasão comercial.
Retorne APENAS um JSON válido com as seguintes propriedades idênticas à estrutura base:
{
  "nichoNome": "Nome formal do nicho",
  "subtituloCapa": "Subtítulo de alto impacto para a capa",
  "estatisticaMercado": "Estatística forte do nicho",
  "dores": [
    { "titulo": "Dor 1", "descricao": "Detalhamento da dor 1" },
    { "titulo": "Dor 2", "descricao": "Detalhamento da dor 2" },
    { "titulo": "Dor 3", "descricao": "Detalhamento da dor 3" }
  ],
  "diagnosticoGargalos": [
    { "fase": "1. Atração", "problema": "problema", "impacto": "impacto" },
    { "fase": "2. Atendimento", "problema": "problema", "impacto": "impacto" },
    { "fase": "3. Fechamento", "problema": "problema", "impacto": "impacto" }
  ],
  "solucaoPilares": [
    { "pilar": "Pilar 1", "titulo": "Título", "descricao": "Descrição" },
    { "pilar": "Pilar 2", "titulo": "Título", "descricao": "Descrição" },
    { "pilar": "Pilar 3", "titulo": "Título", "descricao": "Descrição" }
  ],
  "etapasFunil": [
    { "etapa": "1", "canal": "canal", "descricao": "desc" },
    { "etapa": "2", "canal": "canal", "descricao": "desc" },
    { "etapa": "3", "canal": "canal", "descricao": "desc" },
    { "etapa": "4", "canal": "canal", "descricao": "desc" }
  ],
  "metricas": [
    { "valor": "valor", "label": "label", "detalhe": "detalhe" },
    { "valor": "valor", "label": "label", "detalhe": "detalhe" },
    { "valor": "valor", "label": "label", "detalhe": "detalhe" },
    { "valor": "valor", "label": "label", "detalhe": "detalhe" }
  ]
}
`;

  try {
    if (typeof llmCaller === "function") {
      const res = await llmCaller({ prompt, model, apiKey: effectiveApiKey });
      if (typeof res === "object" && res.dores) {
        return { chaveNicho: chave, prospectName, ...res };
      }
      if (typeof res === "string") {
        const cleaned = res.replace(/```json/g, "").replace(/```/g, "").trim();
        return { chaveNicho: chave, prospectName, ...JSON.parse(cleaned) };
      }
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${effectiveApiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, responseMimeType: "application/json" },
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      const parsed = JSON.parse(rawText);
      if (parsed && Array.isArray(parsed.dores) && parsed.dores.length >= 3) {
        return { chaveNicho: chave, prospectName, ...parsed };
      }
    }
    return { chaveNicho: chave, prospectName, ...baseConteudo };
  } catch (err) {
    console.warn("[gdPresentationGenerator] Falha ao adaptar conteúdo via Gemini:", err.message);
    return { chaveNicho: chave, prospectName, ...baseConteudo };
  }
}

// ─── Gerador de Apresentação PowerPoint Editável (.pptx) via pptxgenjs ────────
export async function gerarApresentacaoPptx({
  prospectName = "Prospect",
  nicho = "Geral",
  paletaCores = {},
  conteudoNicho = null,
  logoBuffer = null,
} = {}) {
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_16x9"; // Widescreen padrão profissional
  pres.title = `Máquina de Vendas - ${prospectName}`;
  pres.author = "Caio Vinícius & Conrado Finzi | Geração Digital";
  pres.company = "Geração Digital & Vexo OS";

  // Tratamento de cores hexadecimais para o pptxgenjs (sem o "#")
  const corPrimaria = (paletaCores.primaria || "#0B192C").replace("#", "").toUpperCase();
  const corSecundaria = (paletaCores.secundaria || "#1E3E62").replace("#", "").toUpperCase();
  const corDestaque = (paletaCores.destaque || "#FF6500").replace("#", "").toUpperCase();
  const corFundo = (paletaCores.fundo || "#F8FAFC").replace("#", "").toUpperCase();
  const corBranco = "FFFFFF";
  const corDark = "0F172A";
  const corCinza = "64748B";

  const conteudo = conteudoNicho || (await obterConteudoNicho({ nicho, prospectName }));

  let logoDataUri = null;
  if (logoBuffer && Buffer.isBuffer(logoBuffer) && logoBuffer.length > 50) {
    logoDataUri = `data:image/png;base64,${logoBuffer.toString("base64")}`;
  }

  // ── SLIDE 1: Capa Oficial ──
  const s1 = pres.addSlide();
  s1.background = { color: corPrimaria };

  // Barra de Destaque Superior
  s1.addShape(pres.ShapeType.rect, {
    x: 0,
    y: 0,
    w: "100%",
    h: 0.15,
    fill: { color: corDestaque },
  });

  // Tag do Projeto
  s1.addShape(pres.ShapeType.roundRect, {
    x: 0.8,
    y: 1.0,
    w: 3.2,
    h: 0.45,
    fill: { color: corSecundaria },
    line: { color: corDestaque, width: 1 },
  });
  s1.addText("PROPOSTA ESTRATÉGICA EXCLUSIVA", {
    x: 0.8,
    y: 1.0,
    w: 3.2,
    h: 0.45,
    fontSize: 10,
    bold: true,
    color: corBranco,
    align: "center",
    valign: "middle",
  });

  // Título e Subtítulo
  s1.addText("MÁQUINA DE VENDAS", {
    x: 0.8,
    y: 1.6,
    w: 8.5,
    h: 1.1,
    fontSize: 44,
    bold: true,
    color: corBranco,
    fontFace: "Arial",
  });
  s1.addText(`Estratégia de Escala Comercial e Aquisição Previsível para ${prospectName}`, {
    x: 0.8,
    y: 2.8,
    w: 8.5,
    h: 0.8,
    fontSize: 18,
    color: corDestaque,
    fontFace: "Arial",
  });
  s1.addText(`Nicho de Atuação: ${conteudo.nichoNome || nicho}`, {
    x: 0.8,
    y: 3.7,
    w: 8.5,
    h: 0.5,
    fontSize: 14,
    color: "CBD5E1",
  });

  // Logo da Empresa
  if (logoDataUri) {
    s1.addImage({
      data: logoDataUri,
      x: 9.2,
      y: 1.2,
      w: 3.2,
      h: 2.0,
      sizing: { type: "contain" },
    });
  }

  // Rodapé da Capa
  s1.addShape(pres.ShapeType.rect, {
    x: 0.8,
    y: 6.2,
    w: 11.7,
    h: 0.05,
    fill: { color: "334155" },
  });
  s1.addText("Apresentado por: Caio Vinícius (Comercial) & Conrado Finzi (Estratégia) | Geração Digital & Vexo OS", {
    x: 0.8,
    y: 6.35,
    w: 11.7,
    h: 0.4,
    fontSize: 11,
    color: "94A3B8",
  });

  // ── SLIDE 2: Cenário de Mercado & As 3 Grandes Dores ──
  const s2 = pres.addSlide();
  s2.background = { color: corFundo };

  // Cabeçalho Padrão
  s2.addShape(pres.ShapeType.rect, { x: 0.8, y: 0.5, w: 0.15, h: 0.6, fill: { color: corDestaque } });
  s2.addText("O CENÁRIO DE MERCADO", { x: 1.1, y: 0.45, w: 9.0, h: 0.4, fontSize: 13, bold: true, color: corDestaque });
  s2.addText(`Os 3 Principais Gargalos em ${conteudo.nichoNome || nicho}`, {
    x: 1.1,
    y: 0.85,
    w: 10.0,
    h: 0.5,
    fontSize: 22,
    bold: true,
    color: corDark,
  });

  // 3 Cards de Dores
  const dores = conteudo.dores || [];
  const cardW = 3.65;
  const gap = 0.35;
  dores.slice(0, 3).forEach((dor, idx) => {
    const cardX = 0.8 + idx * (cardW + gap);
    s2.addShape(pres.ShapeType.roundRect, {
      x: cardX,
      y: 1.7,
      w: cardW,
      h: 3.5,
      fill: { color: corBranco },
      line: { color: "E2E8F0", width: 1.5 },
    });
    // Tarja superior do card
    s2.addShape(pres.ShapeType.rect, {
      x: cardX,
      y: 1.7,
      w: cardW,
      h: 0.15,
      fill: { color: idx === 0 ? corDestaque : corSecundaria },
    });
    s2.addText(`GARGALO 0${idx + 1}`, {
      x: cardX + 0.3,
      y: 2.0,
      w: cardW - 0.6,
      h: 0.3,
      fontSize: 11,
      bold: true,
      color: corCinza,
    });
    s2.addText(dor.titulo, {
      x: cardX + 0.3,
      y: 2.4,
      w: cardW - 0.6,
      h: 0.8,
      fontSize: 16,
      bold: true,
      color: corDark,
    });
    s2.addText(dor.descricao, {
      x: cardX + 0.3,
      y: 3.3,
      w: cardW - 0.6,
      h: 1.6,
      fontSize: 13,
      color: "334155",
      valign: "top",
    });
  });

  // Banner da Estatística de Mercado
  s2.addShape(pres.ShapeType.roundRect, {
    x: 0.8,
    y: 5.5,
    w: 11.7,
    h: 1.1,
    fill: { color: corPrimaria },
  });
  s2.addText("DADO DE MERCADO:", {
    x: 1.1,
    y: 5.65,
    w: 2.5,
    h: 0.3,
    fontSize: 11,
    bold: true,
    color: corDestaque,
  });
  s2.addText(conteudo.estatisticaMercado || "", {
    x: 1.1,
    y: 5.95,
    w: 11.1,
    h: 0.55,
    fontSize: 12,
    color: corBranco,
  });

  // ── SLIDE 3: O Diagnóstico: Onde as Empresas Mais Perdem Dinheiro ──
  const s3 = pres.addSlide();
  s3.background = { color: corFundo };

  s3.addShape(pres.ShapeType.rect, { x: 0.8, y: 0.5, w: 0.15, h: 0.6, fill: { color: corDestaque } });
  s3.addText("DIAGNÓSTICO COMERCIAL", { x: 1.1, y: 0.45, w: 9.0, h: 0.4, fontSize: 13, bold: true, color: corDestaque });
  s3.addText("Onde o Dinheiro Está Vazando no Seu Funil Hoje", {
    x: 1.1,
    y: 0.85,
    w: 10.0,
    h: 0.5,
    fontSize: 22,
    bold: true,
    color: corDark,
  });

  const gargalos = conteudo.diagnosticoGargalos || [];
  gargalos.slice(0, 3).forEach((g, idx) => {
    const rowY = 1.8 + idx * 1.6;
    s3.addShape(pres.ShapeType.roundRect, {
      x: 0.8,
      y: rowY,
      w: 11.7,
      h: 1.35,
      fill: { color: corBranco },
      line: { color: "CBD5E1", width: 1 },
    });
    // Caixa da Fase
    s3.addShape(pres.ShapeType.roundRect, {
      x: 1.1,
      y: rowY + 0.25,
      w: 2.5,
      h: 0.85,
      fill: { color: corSecundaria },
    });
    s3.addText(g.fase, {
      x: 1.1,
      y: rowY + 0.25,
      w: 2.5,
      h: 0.85,
      fontSize: 14,
      bold: true,
      color: corBranco,
      align: "center",
      valign: "middle",
    });

    s3.addText(`Gargalo: ${g.problema}`, {
      x: 3.9,
      y: rowY + 0.25,
      w: 5.0,
      h: 0.85,
      fontSize: 13,
      color: corDark,
      valign: "middle",
    });
    s3.addText(`Impacto: ${g.impacto}`, {
      x: 9.1,
      y: rowY + 0.25,
      w: 3.1,
      h: 0.85,
      fontSize: 12,
      bold: true,
      color: "#DC2626", // Alerta vermelho
      valign: "middle",
    });
  });

  // ── SLIDE 4: A Solução: Arquitetura da Máquina de Vendas Vexo OS ──
  const s4 = pres.addSlide();
  s4.background = { color: corPrimaria };

  s4.addShape(pres.ShapeType.rect, { x: 0.8, y: 0.5, w: 0.15, h: 0.6, fill: { color: corDestaque } });
  s4.addText("A SOLUÇÃO DEFINITIVA", { x: 1.1, y: 0.45, w: 9.0, h: 0.4, fontSize: 13, bold: true, color: corDestaque });
  s4.addText("O Tripé da Máquina de Vendas: Geração Digital & Vexo OS", {
    x: 1.1,
    y: 0.85,
    w: 10.0,
    h: 0.5,
    fontSize: 22,
    bold: true,
    color: corBranco,
  });

  const pilares = conteudo.solucaoPilares || [];
  pilares.slice(0, 3).forEach((pilar, idx) => {
    const cardX = 0.8 + idx * (cardW + gap);
    s4.addShape(pres.ShapeType.roundRect, {
      x: cardX,
      y: 1.8,
      w: cardW,
      h: 4.6,
      fill: { color: corSecundaria },
      line: { color: corDestaque, width: 1.5 },
    });
    s4.addShape(pres.ShapeType.roundRect, {
      x: cardX + 0.3,
      y: 2.1,
      w: cardW - 0.6,
      h: 0.4,
      fill: { color: corPrimaria },
    });
    s4.addText(pilar.pilar.toUpperCase(), {
      x: cardX + 0.3,
      y: 2.1,
      w: cardW - 0.6,
      h: 0.4,
      fontSize: 10,
      bold: true,
      color: corDestaque,
      align: "center",
      valign: "middle",
    });
    s4.addText(pilar.titulo, {
      x: cardX + 0.3,
      y: 2.7,
      w: cardW - 0.6,
      h: 0.8,
      fontSize: 17,
      bold: true,
      color: corBranco,
    });
    s4.addText(pilar.descricao, {
      x: cardX + 0.3,
      y: 3.6,
      w: cardW - 0.6,
      h: 2.4,
      fontSize: 13,
      color: "E2E8F0",
      valign: "top",
    });
  });

  // ── SLIDE 5: O Funil na Prática para o Prospect ──
  const s5 = pres.addSlide();
  s5.background = { color: corFundo };

  s5.addShape(pres.ShapeType.rect, { x: 0.8, y: 0.5, w: 0.15, h: 0.6, fill: { color: corDestaque } });
  s5.addText("PASSO A PASSO OPERACIONAL", { x: 1.1, y: 0.45, w: 9.0, h: 0.4, fontSize: 13, bold: true, color: corDestaque });
  s5.addText(`Como Funciona a Máquina de Vendas de ${prospectName}`, {
    x: 1.1,
    y: 0.85,
    w: 10.0,
    h: 0.5,
    fontSize: 22,
    bold: true,
    color: corDark,
  });

  const etapas = conteudo.etapasFunil || [];
  const etapaW = 2.7;
  const etapaGap = 0.3;
  etapas.slice(0, 4).forEach((et, idx) => {
    const eX = 0.8 + idx * (etapaW + etapaGap);
    s5.addShape(pres.ShapeType.roundRect, {
      x: eX,
      y: 1.8,
      w: etapaW,
      h: 4.5,
      fill: { color: corBranco },
      line: { color: "CBD5E1", width: 1.5 },
    });
    s5.addShape(pres.ShapeType.rect, {
      x: eX,
      y: 1.8,
      w: etapaW,
      h: 0.5,
      fill: { color: idx === 3 ? corDestaque : corSecundaria },
    });
    s5.addText(`PASSO 0${idx + 1}`, {
      x: eX,
      y: 1.8,
      w: etapaW,
      h: 0.5,
      fontSize: 12,
      bold: true,
      color: corBranco,
      align: "center",
      valign: "middle",
    });

    s5.addText(et.etapa, {
      x: eX + 0.2,
      y: 2.5,
      w: etapaW - 0.4,
      h: 0.5,
      fontSize: 16,
      bold: true,
      color: corDark,
    });
    s5.addText(`Canal: ${et.canal}`, {
      x: eX + 0.2,
      y: 3.1,
      w: etapaW - 0.4,
      h: 0.4,
      fontSize: 11,
      bold: true,
      color: corDestaque,
    });
    s5.addText(et.descricao, {
      x: eX + 0.2,
      y: 3.6,
      w: etapaW - 0.4,
      h: 2.4,
      fontSize: 12,
      color: "334155",
      valign: "top",
    });
  });

  // ── SLIDE 6: Resultados Esperados & ROI ──
  const s6 = pres.addSlide();
  s6.background = { color: corFundo };

  s6.addShape(pres.ShapeType.rect, { x: 0.8, y: 0.5, w: 0.15, h: 0.6, fill: { color: corDestaque } });
  s6.addText("RESULTADOS ESPERADOS", { x: 1.1, y: 0.45, w: 9.0, h: 0.4, fontSize: 13, bold: true, color: corDestaque });
  s6.addText(`Projeção de Impacto e KPIs para ${prospectName}`, {
    x: 1.1,
    y: 0.85,
    w: 10.0,
    h: 0.5,
    fontSize: 22,
    bold: true,
    color: corDark,
  });

  const metricas = conteudo.metricas || [];
  const mBoxW = 5.65;
  const mBoxH = 2.1;
  metricas.slice(0, 4).forEach((m, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const mX = 0.8 + col * (mBoxW + 0.4);
    const mY = 1.8 + row * (mBoxH + 0.35);

    s6.addShape(pres.ShapeType.roundRect, {
      x: mX,
      y: mY,
      w: mBoxW,
      h: mBoxH,
      fill: { color: corBranco },
      line: { color: "CBD5E1", width: 1.5 },
    });
    s6.addText(m.valor, {
      x: mX + 0.4,
      y: mY + 0.2,
      w: mBoxW - 0.8,
      h: 0.8,
      fontSize: 34,
      bold: true,
      color: corDestaque,
    });
    s6.addText(m.label, {
      x: mX + 0.4,
      y: mY + 1.0,
      w: mBoxW - 0.8,
      h: 0.4,
      fontSize: 15,
      bold: true,
      color: corDark,
    });
    s6.addText(m.detalhe, {
      x: mX + 0.4,
      y: mY + 1.45,
      w: mBoxW - 0.8,
      h: 0.5,
      fontSize: 12,
      color: corCinza,
    });
  });

  // ── SLIDE 7: Próximos Passos & Plano de Implementação ──
  const s7 = pres.addSlide();
  s7.background = { color: corPrimaria };

  s7.addShape(pres.ShapeType.rect, { x: 0.8, y: 0.5, w: 0.15, h: 0.6, fill: { color: corDestaque } });
  s7.addText("CRONOGRAMA DE ATIVAÇÃO", { x: 1.1, y: 0.45, w: 9.0, h: 0.4, fontSize: 13, bold: true, color: corDestaque });
  s7.addText(`Próximos Passos: Colocando a Máquina no Ar`, {
    x: 1.1,
    y: 0.85,
    w: 10.0,
    h: 0.5,
    fontSize: 22,
    bold: true,
    color: corBranco,
  });

  const passos = [
    { etapa: "Kickoff & Alinhamento", prazo: "Dias 1 a 3", descricao: "Conexão dos canais de WhatsApp, briefing detalhado e provisionamento do ecossistema." },
    { etapa: "IA & Treinamento", prazo: "Dias 4 a 7", descricao: "Configuração do Agente Vexo OS com a linguagem, regras de negócios e quebra de objeções." },
    { etapa: "Campanhas de Alta Intenção", prazo: "Dias 8 a 10", descricao: "Criação dos criativos de alta conversão e subida dos anúncios no Google e Meta." },
    { etapa: "Go-Live Comercial", prazo: "Dia 11 em diante", descricao: "Lançamento oficial da Máquina de Vendas e otimização contínua de conversão." },
  ];

  passos.forEach((p, idx) => {
    const pX = 0.8 + idx * (etapaW + etapaGap);
    s7.addShape(pres.ShapeType.roundRect, {
      x: pX,
      y: 1.8,
      w: etapaW,
      h: 3.5,
      fill: { color: corSecundaria },
      line: { color: corDestaque, width: 1 },
    });
    s7.addText(`ETAPA 0${idx + 1}`, {
      x: pX + 0.2,
      y: 2.1,
      w: etapaW - 0.4,
      h: 0.3,
      fontSize: 11,
      bold: true,
      color: corDestaque,
    });
    s7.addText(p.etapa, {
      x: pX + 0.2,
      y: 2.5,
      w: etapaW - 0.4,
      h: 0.7,
      fontSize: 15,
      bold: true,
      color: corBranco,
    });
    s7.addText(p.prazo, {
      x: pX + 0.2,
      y: 3.25,
      w: etapaW - 0.4,
      h: 0.3,
      fontSize: 11,
      bold: true,
      color: "94A3B8",
    });
    s7.addText(p.descricao, {
      x: pX + 0.2,
      y: 3.65,
      w: etapaW - 0.4,
      h: 1.4,
      fontSize: 12,
      color: "E2E8F0",
      valign: "top",
    });
  });

  // Banner Final de CTA
  s7.addShape(pres.ShapeType.roundRect, {
    x: 0.8,
    y: 5.6,
    w: 11.7,
    h: 1.1,
    fill: { color: corDestaque },
  });
  s7.addText(`Vamos acelerar as vendas de ${prospectName}?`, {
    x: 1.1,
    y: 5.75,
    w: 8.0,
    h: 0.4,
    fontSize: 18,
    bold: true,
    color: corBranco,
  });
  s7.addText("Contato Comercial: Caio Vinícius | (34) 99771-9779 | Geração Digital & Vexo OS", {
    x: 1.1,
    y: 6.2,
    w: 11.0,
    h: 0.35,
    fontSize: 12,
    bold: true,
    color: corPrimaria,
  });

  return pres.write({ outputType: "nodebuffer" });
}

// ─── Gerador de Apresentação em PDF (.pdf) via pdfkit ────────────────────────
export async function gerarApresentacaoPdf({
  prospectName = "Prospect",
  nicho = "Geral",
  paletaCores = {},
  conteudoNicho = null,
  logoBuffer = null,
} = {}) {
  const conteudo = conteudoNicho || (await obterConteudoNicho({ nicho, prospectName }));

  const corPrimaria = sanitizarHex(paletaCores.primaria, "#0B192C");
  const corSecundaria = sanitizarHex(paletaCores.secundaria, "#1E3E62");
  const corDestaque = sanitizarHex(paletaCores.destaque, "#FF6500");
  const corFundo = sanitizarHex(paletaCores.fundo, "#F8FAFC");
  const corDark = "#0F172A";
  const corBranco = "#FFFFFF";
  const corCinza = "#64748B";

  return new Promise((resolve, reject) => {
    try {
      // 16:9 Landscape Widescreen (960 x 540)
      const doc = new PDFDocument({
        size: [960, 540],
        layout: "landscape",
        margin: 0,
        autoFirstPage: false,
      });

      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err) => reject(err));

      // Helper para desenhar o rodapé nas páginas internas
      const desenharRodape = (paginaNum) => {
        doc.rect(40, 500, 880, 1).fill("#E2E8F0");
        doc.fontSize(9).fillColor(corCinza).text(
          `Máquina de Vendas • ${prospectName} • Geração Digital & Vexo OS`,
          40,
          512,
          { width: 700 }
        );
        doc.fontSize(9).fillColor(corCinza).text(
          `Slide ${paginaNum} de 7`,
          740,
          512,
          { width: 180, align: "right" }
        );
      };

      // Helper para desenhar o cabeçalho padrão
      const desenharCabecalho = (categoria, titulo) => {
        doc.rect(40, 30, 8, 40).fill(corDestaque);
        doc.fontSize(10).font("Helvetica-Bold").fillColor(corDestaque).text(categoria.toUpperCase(), 58, 32);
        doc.fontSize(18).font("Helvetica-Bold").fillColor(corDark).text(titulo, 58, 48, { width: 750 });

        if (logoBuffer && Buffer.isBuffer(logoBuffer) && logoBuffer.length > 50) {
          try {
            doc.image(logoBuffer, 820, 25, { fit: [100, 45], align: "right" });
          } catch {
            // tolera formato de imagem não reconhecido pelo pdfkit
          }
        }
      };

      // ── SLIDE 1: Capa ──
      doc.addPage();
      doc.rect(0, 0, 960, 540).fill(corPrimaria);
      doc.rect(0, 0, 960, 10).fill(corDestaque);

      // Badge
      doc.roundedRect(50, 60, 260, 30, 6).fill(corSecundaria);
      doc.fontSize(10).font("Helvetica-Bold").fillColor(corBranco).text("PROPOSTA COMERCIAL EXCLUSIVA", 50, 70, {
        width: 260,
        align: "center",
      });

      doc.fontSize(36).font("Helvetica-Bold").fillColor(corBranco).text("MÁQUINA DE VENDAS", 50, 120);
      doc.fontSize(18).font("Helvetica-Bold").fillColor(corDestaque).text(
        `Estratégia de Escala Comercial e Aquisição Previsível para ${prospectName}`,
        50,
        170,
        { width: 600 }
      );
      doc.fontSize(13).font("Helvetica").fillColor("#CBD5E1").text(
        `Nicho de Atuação: ${conteudo.nichoNome || nicho}`,
        50,
        230
      );

      if (logoBuffer && Buffer.isBuffer(logoBuffer) && logoBuffer.length > 50) {
        try {
          doc.image(logoBuffer, 680, 80, { fit: [220, 150] });
        } catch {
          // tolera logo não renderizável no PDF
        }
      }

      doc.rect(50, 470, 860, 2).fill("#334155");
      doc.fontSize(10).font("Helvetica").fillColor("#94A3B8").text(
        "Apresentado por: Caio Vinícius (Comercial) & Conrado Finzi (Estratégia) | Geração Digital & Vexo OS",
        50,
        485
      );

      // ── SLIDE 2: Cenário de Mercado & Dores ──
      doc.addPage();
      doc.rect(0, 0, 960, 540).fill(corFundo);
      desenharCabecalho("O Cenário de Mercado", `Os 3 Principais Gargalos em ${conteudo.nichoNome || nicho}`);

      const dores = conteudo.dores || [];
      const cardW = 275;
      const cardGap = 25;
      dores.slice(0, 3).forEach((dor, idx) => {
        const cX = 40 + idx * (cardW + cardGap);
        doc.roundedRect(cX, 100, cardW, 260, 8).fillAndStroke(corBranco, "#E2E8F0");
        doc.rect(cX, 100, cardW, 6).fill(idx === 0 ? corDestaque : corSecundaria);

        doc.fontSize(10).font("Helvetica-Bold").fillColor(corCinza).text(`GARGALO 0${idx + 1}`, cX + 20, 120);
        doc.fontSize(14).font("Helvetica-Bold").fillColor(corDark).text(dor.titulo, cX + 20, 140, { width: cardW - 40 });
        doc.fontSize(11).font("Helvetica").fillColor("#334155").text(dor.descricao, cX + 20, 195, { width: cardW - 40 });
      });

      // Banner da estatística
      doc.roundedRect(40, 380, 880, 90, 8).fill(corPrimaria);
      doc.fontSize(10).font("Helvetica-Bold").fillColor(corDestaque).text("DADO CRÍTICO DE MERCADO:", 60, 395);
      doc.fontSize(12).font("Helvetica").fillColor(corBranco).text(conteudo.estatisticaMercado || "", 60, 415, { width: 840 });

      desenharRodape(2);

      // ── SLIDE 3: O Diagnóstico ──
      doc.addPage();
      doc.rect(0, 0, 960, 540).fill(corFundo);
      desenharCabecalho("Diagnóstico Comercial", "Onde o Dinheiro Está Vazando no Seu Funil Hoje");

      const gargalos = conteudo.diagnosticoGargalos || [];
      gargalos.slice(0, 3).forEach((g, idx) => {
        const rY = 100 + idx * 115;
        doc.roundedRect(40, rY, 880, 95, 8).fillAndStroke(corBranco, "#CBD5E1");

        doc.roundedRect(60, rY + 20, 180, 55, 6).fill(corSecundaria);
        doc.fontSize(13).font("Helvetica-Bold").fillColor(corBranco).text(g.fase, 60, rY + 40, { width: 180, align: "center" });

        doc.fontSize(12).font("Helvetica").fillColor(corDark).text(`Gargalo: ${g.problema}`, 260, rY + 30, { width: 360 });
        doc.fontSize(12).font("Helvetica-Bold").fillColor("#DC2626").text(`Impacto: ${g.impacto}`, 640, rY + 30, { width: 260 });
      });

      desenharRodape(3);

      // ── SLIDE 4: A Solução (Tripé Vexo OS) ──
      doc.addPage();
      doc.rect(0, 0, 960, 540).fill(corPrimaria);

      doc.rect(40, 30, 8, 40).fill(corDestaque);
      doc.fontSize(10).font("Helvetica-Bold").fillColor(corDestaque).text("A SOLUÇÃO DEFINITIVA", 58, 32);
      doc.fontSize(18).font("Helvetica-Bold").fillColor(corBranco).text("O Tripé da Máquina de Vendas: Geração Digital & Vexo OS", 58, 48);

      const pilares = conteudo.solucaoPilares || [];
      pilares.slice(0, 3).forEach((pilar, idx) => {
        const cX = 40 + idx * (cardW + cardGap);
        doc.roundedRect(cX, 100, cardW, 370, 8).fillAndStroke(corSecundaria, corDestaque);

        doc.roundedRect(cX + 20, 120, cardW - 40, 30, 4).fill(corPrimaria);
        doc.fontSize(9).font("Helvetica-Bold").fillColor(corDestaque).text(pilar.pilar.toUpperCase(), cX + 20, 130, {
          width: cardW - 40,
          align: "center",
        });

        doc.fontSize(15).font("Helvetica-Bold").fillColor(corBranco).text(pilar.titulo, cX + 20, 170, { width: cardW - 40 });
        doc.fontSize(11).font("Helvetica").fillColor("#E2E8F0").text(pilar.descricao, cX + 20, 230, { width: cardW - 40 });
      });

      desenharRodape(4);

      // ── SLIDE 5: O Funil na Prática ──
      doc.addPage();
      doc.rect(0, 0, 960, 540).fill(corFundo);
      desenharCabecalho("Passo a Passo Operacional", `Como Funciona a Máquina de Vendas de ${prospectName}`);

      const etapas = conteudo.etapasFunil || [];
      const eW = 200;
      const eGap = 20;
      etapas.slice(0, 4).forEach((et, idx) => {
        const eX = 40 + idx * (eW + eGap);
        doc.roundedRect(eX, 100, eW, 360, 8).fillAndStroke(corBranco, "#CBD5E1");
        doc.rect(eX, 100, eW, 30).fill(idx === 3 ? corDestaque : corSecundaria);
        doc.fontSize(10).font("Helvetica-Bold").fillColor(corBranco).text(`PASSO 0${idx + 1}`, eX, 110, { width: eW, align: "center" });

        doc.fontSize(14).font("Helvetica-Bold").fillColor(corDark).text(et.etapa, eX + 15, 150, { width: eW - 30 });
        doc.fontSize(10).font("Helvetica-Bold").fillColor(corDestaque).text(`Canal: ${et.canal}`, eX + 15, 185, { width: eW - 30 });
        doc.fontSize(10).font("Helvetica").fillColor("#334155").text(et.descricao, eX + 15, 215, { width: eW - 30 });
      });

      desenharRodape(5);

      // ── SLIDE 6: Resultados Esperados & ROI ──
      doc.addPage();
      doc.rect(0, 0, 960, 540).fill(corFundo);
      desenharCabecalho("Resultados Esperados", `Projeção de Impacto e KPIs para ${prospectName}`);

      const metricas = conteudo.metricas || [];
      const mW = 425;
      const mH = 160;
      metricas.slice(0, 4).forEach((m, idx) => {
        const col = idx % 2;
        const row = Math.floor(idx / 2);
        const mX = 40 + col * (mW + 30);
        const mY = 110 + row * (mH + 20);

        doc.roundedRect(mX, mY, mW, mH, 8).fillAndStroke(corBranco, "#CBD5E1");
        doc.fontSize(30).font("Helvetica-Bold").fillColor(corDestaque).text(m.valor, mX + 25, mY + 25);
        doc.fontSize(14).font("Helvetica-Bold").fillColor(corDark).text(m.label, mX + 25, mY + 75);
        doc.fontSize(11).font("Helvetica").fillColor(corCinza).text(m.detalhe, mX + 25, mY + 105, { width: mW - 50 });
      });

      desenharRodape(6);

      // ── SLIDE 7: Próximos Passos & Início da Operação ──
      doc.addPage();
      doc.rect(0, 0, 960, 540).fill(corPrimaria);

      doc.rect(40, 30, 8, 40).fill(corDestaque);
      doc.fontSize(10).font("Helvetica-Bold").fillColor(corDestaque).text("CRONOGRAMA DE ATIVAÇÃO", 58, 32);
      doc.fontSize(18).font("Helvetica-Bold").fillColor(corBranco).text("Próximos Passos: Colocando a Máquina no Ar", 58, 48);

      const passos = [
        { etapa: "Kickoff & Alinhamento", prazo: "Dias 1 a 3", descricao: "Conexão dos canais de WhatsApp, briefing e provisionamento do ecossistema." },
        { etapa: "IA & Treinamento", prazo: "Dias 4 a 7", descricao: "Configuração do Agente Vexo OS com a linguagem e quebra de objeções." },
        { etapa: "Campanhas de Alta Intenção", prazo: "Dias 8 a 10", descricao: "Criação dos criativos e subida dos anúncios no Google e Meta." },
        { etapa: "Go-Live Comercial", prazo: "Dia 11 em diante", descricao: "Lançamento oficial da Máquina de Vendas e otimização diária." },
      ];

      passos.forEach((p, idx) => {
        const pX = 40 + idx * (eW + eGap);
        doc.roundedRect(pX, 100, eW, 260, 8).fillAndStroke(corSecundaria, corDestaque);
        doc.fontSize(10).font("Helvetica-Bold").fillColor(corDestaque).text(`ETAPA 0${idx + 1}`, pX + 15, 120);
        doc.fontSize(13).font("Helvetica-Bold").fillColor(corBranco).text(p.etapa, pX + 15, 140, { width: eW - 30 });
        doc.fontSize(10).font("Helvetica-Bold").fillColor("#94A3B8").text(p.prazo, pX + 15, 190);
        doc.fontSize(10).font("Helvetica").fillColor("#E2E8F0").text(p.descricao, pX + 15, 215, { width: eW - 30 });
      });

      // Banner Final de CTA
      doc.roundedRect(40, 390, 880, 90, 8).fill(corDestaque);
      doc.fontSize(16).font("Helvetica-Bold").fillColor(corBranco).text(
        `Vamos acelerar as vendas de ${prospectName}?`,
        60,
        410
      );
      doc.fontSize(12).font("Helvetica-Bold").fillColor(corPrimaria).text(
        "Contato Comercial: Caio Vinícius | (34) 99771-9779 | Geração Digital & Vexo OS",
        60,
        440
      );

      desenharRodape(7);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Orquestrador: Gera os dois arquivos obrigatórios (.pptx e .pdf) da apresentação
 */
export async function gerarArquivosApresentacao({
  prospectName = "Prospect",
  nicho = "Geral",
  paletaCores = {},
  logoBuffer = null,
  conteudoCustomizado = null,
  apiKey = null,
  llmCaller = null,
} = {}) {
  const cleanProspect = (prospectName || "Prospect").replace(/[^a-zA-Z0-9_-]/g, "_");

  // 1. Obtém conteúdo estruturado por nicho
  const conteudoNicho =
    conteudoCustomizado ||
    (await obterConteudoNicho({
      nicho,
      prospectName,
      apiKey,
      llmCaller,
    }));

  // 2. Gera o arquivo PowerPoint editável (.pptx)
  const pptxBuffer = await gerarApresentacaoPptx({
    prospectName,
    nicho,
    paletaCores,
    conteudoNicho,
    logoBuffer,
  });

  // 3. Gera o arquivo de apresentação em PDF (.pdf)
  const pdfBuffer = await gerarApresentacaoPdf({
    prospectName,
    nicho,
    paletaCores,
    conteudoNicho,
    logoBuffer,
  });

  return {
    prospectName,
    nicho,
    paletaCores,
    conteudoNicho,
    pptx: {
      fileName: `Apresentacao_Maquina_de_Vendas_${cleanProspect}.pptx`,
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer: pptxBuffer,
      size: pptxBuffer.length,
    },
    pdf: {
      fileName: `Apresentacao_Maquina_de_Vendas_${cleanProspect}.pdf`,
      mimeType: "application/pdf",
      buffer: pdfBuffer,
      size: pdfBuffer.length,
    },
  };
}
