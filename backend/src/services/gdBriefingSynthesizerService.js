/**
 * gdBriefingSynthesizerService.js
 *
 * Módulo de Síntese Multidocumento com Gemini (Frente 5).
 * Cruza Transcrição da reunião do Meet + Formulário de Briefing Vexo OS +
 * Regras do Contrato assinado + Template/Diretrizes da Geração Digital.
 *
 * Gera os 4 Entregáveis Oficiais nos formatos DOCX e PDF:
 *   1. Briefing Consolidado Oficial
 *   2. Identidade Visual & Diretrizes da Marca
 *   3. Roteiros de Conteúdo para 3 Meses (60 roteiros / 12 semanas)
 *   4. Planejamento Trimestral Visual (Resumo executivo do cronograma)
 *
 * Realiza upload e arquivamento seguro no Google Drive da agência
 * (mrkgeracaodigital@gmail.com) na subpasta 04_Relatorios / Briefing Marketing,
 * limpando arquivos e rascunhos temporários obsoletos.
 */

import crypto from "node:crypto";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  WidthType,
  ShadingType,
  BorderStyle,
} from "docx";
import PDFDocument from "pdfkit";
import { uploadFileToDrive, setupClientDriveFolders } from "./googleDriveClientSetup.js";
import { GD_DONO } from "../domains/gdClientes/campos.js";

export const GD_OFFICIAL_AGENCY_EMAIL = "mrkgeracaodigital@gmail.com";

// ─── Cores Oficiais da Geração Digital ─────────────────────────────────────
const GD_COLORS = {
  navyDark: "0B192C",
  navyMedium: "1E3E62",
  blueRoyal: "2563EB",
  blueLight: "EFF6FF",
  grayDark: "1F2937",
  grayMuted: "6B7280",
  grayLight: "F3F4F6",
  white: "FFFFFF",
  orangeAccent: "FF6500",
  greenSuccess: "10B981",
};

// ─── Extrator de Cotas do Contrato ──────────────────────────────────────────
export function extrairCotasContrato(contrato, escopo = []) {
  const dados = contrato?.dados || (typeof contrato === "object" ? contrato : {}) || {};
  const escopoLista = Array.isArray(escopo) ? escopo : Array.isArray(dados?.escopo) ? dados.escopo : [];
  const escopoTexto = String(dados?.escopo_original || dados?.descricao || escopoLista.join(", ")).toLowerCase();

  let carrosseisPorSemana = 2;
  let videosPorSemana = 2;
  let estaticosPorSemana = 1;

  const matchVideos = escopoTexto.match(/(\d+)\s*(?:v[íi]deos?|reels?)/i);
  if (matchVideos) {
    videosPorSemana = parseInt(matchVideos[1], 10);
  }

  const matchCarrosseis = escopoTexto.match(/(\d+)\s*(?:carross[eé][ií]s?)/i);
  if (matchCarrosseis) {
    carrosseisPorSemana = parseInt(matchCarrosseis[1], 10);
  }

  const matchEstaticos = escopoTexto.match(/(\d+)\s*(?:est[áa]ticos?)/i);
  if (matchEstaticos) {
    estaticosPorSemana = parseInt(matchEstaticos[1], 10);
  }

  const semanas = 12; // 3 meses
  return {
    carrosseisPorSemana,
    videosPorSemana,
    estaticosPorSemana,
    totalPorSemana: carrosseisPorSemana + videosPorSemana + estaticosPorSemana,
    totalTrimestre: (carrosseisPorSemana + videosPorSemana + estaticosPorSemana) * semanas,
    semanas,
  };
}

// ─── Síntese Padrão Estruturada (Fallback Determinístico) ───────────────────
export function gerarSintesePadrao({ cliente, transcricao = "", respostasFormulario = {}, contrato = null }) {
  const nome = cliente?.nome || "Cliente";
  const responsavel = cliente?.aprovador_nome || cliente?.nome || "Gestor da Empresa";
  const cotas = extrairCotasContrato(contrato, cliente?.escopo);

  const setor = respostasFormulario?.setor || respostasFormulario?.segmento || "Comércio & Serviços Especializados";
  const publico = respostasFormulario?.publico_alvo || "Consumidores finais e tomadores de decisão qualificados";
  const objetivo = respostasFormulario?.objetivo_principal || "Crescimento de autoridade, geração constante de leads e escala de vendas";

  // 1. Briefing Consolidado (11 Blocos Oficiais Geração Digital / Tinge Brasil & Litoral Norte)
  const briefingConsolidado = {
    titulo: `Briefing Estratégico Consolidado (11 Blocos) · ${nome}`,
    clienteNome: nome,
    responsavel,
    cnpj: cliente?.cnpj || "A confirmar",
    dataBriefing: new Date().toLocaleDateString("pt-BR"),
    visaoGeral: `A ${nome} é uma marca consolidada no setor de ${setor}, com atuação orientada à qualidade e atendimento resolutivo. Durante o alinhamento estratégico, foi identificado alto potencial para ampliação de market share por meio de canais digitais integrados e comunicação centrada na proposta de valor.`,
    posicionamento: `Referência em excelência, confiança e entrega de alto padrão no nicho de ${setor}.`,
    propostaDeValor: `Entregar soluções personalizadas com suporte dedicado, agilidade e máxima confiabilidade para o cliente final.`,
    publicoAlvo: publico,
    personas: [
      {
        nome: "Persona Principal — Decisor Pragmático",
        perfil: "Homens e mulheres de 28 a 55 anos, perfil dinâmico, priorizam segurança, previsibilidade e atendimento humano.",
        dores: "Falta de tempo, experiências anteriores frustrantes com fornecedores amadores e busca por garantia de resultado.",
        desejos: "Atendimento descomplicado, transparência, pontualidade e comprovação clara de autoridade.",
      },
      {
        nome: "Persona Secundária — Pesquisador Atento",
        perfil: "Consumidores que pesquisam a fundo no Instagram e Google antes de tomar a decisão final.",
        dores: "Desconfiança de promessas genéricas e receio de suporte ineficiente pós-venda.",
        desejos: "Ver depoimentos reais, bastidores dos processos e provas sociais consistentes.",
      },
    ],
    tomDeVoz: "Confiante, acolhedor, transparente e com forte autoridade técnica sem ser professoral. Linguagem direta, clara e orientada à ação.",
    diferenciais: [
      "Metodologia validada e suporte consultivo próximo",
      "Transparência total em todas as etapas de atendimento",
      "Agilidade operacional e foco em soluções definitivas",
      "Alto índice de satisfação comprovado por avaliações orgânicas",
    ],
    concorrentesEBenchmarks: [
      "Concorrentes Diretos: Players locais e regionais com comunicação massificada e pouco humanizada.",
      "Oportunidade Estratégica: Destacar o acolhimento, atendimento personalizado e autoridade do time.",
    ],
    canaisEstrategicos: ["Instagram (Foco em Reels e Carrosséis)", "WhatsApp Business (Conversão Ágil)", "Google / Meta Ads (Aquisição)"],
    cotasEntregaveis: `${cotas.carrosseisPorSemana} Carrosséis/sem, ${cotas.videosPorSemana} Vídeos (Reels)/sem, ${cotas.estaticosPorSemana} Estático/sem. Total: ${cotas.totalTrimestre} criativos em 3 meses.`,
    kpisEsperados: [
      "Crescimento consistente na taxa de engajamento qualificado",
      "Geração de no mínimo 30 a 60 conversas qualificadas no WhatsApp/mês",
      "Consolidação de prova social com retenção orgânica de seguidores",
    ],

    // ── 01. Resumo da Estratégia
    bloco01_resumoEstrategia: {
      ideiaCentral: `Consolidar a ${nome} como a escolha incontestável em ${setor}, unindo autoridade técnica, atendimento ágil e conversão ativa no WhatsApp.`,
      pilaresRapidos: [
        "Autoridade & Excelência Operacional",
        "Atendimento Consultivo Humanizado",
        "Previsibilidade de Demanda via Vexo OS",
        "Conversão Ágil no WhatsApp",
      ],
      tabelaComparativa: [
        {
          pontoComparacao: "Tempo de Resposta",
          cliente: "Atendimento imediato via WhatsApp com especialista em até 5 minutos",
          concorrencia: "Formulários lentos e respostas automáticas sem acompanhamento",
        },
        {
          pontoComparacao: "Padrão de Qualidade",
          cliente: "Processo rigoroso com acompanhamento passo a passo e garantia formal",
          concorrencia: "Soluções padronizadas e suporte genérico pós-fechamento",
        },
        {
          pontoComparacao: "Comunicação Digital",
          cliente: "Conteúdo autoral, fotos reais da equipe e posicionamento de autoridade",
          concorrencia: "Bancos de imagem genéricos e postagens sem estratégia clara",
        },
        {
          pontoComparacao: "Relacionamento com o Cliente",
          cliente: "Régua de cuidado contínua no Vexo OS e fidelização ativa pós-venda",
          concorrencia: "Contato apenas no momento da venda, sem pós-venda estruturado",
        },
      ],
      mensagemPrincipal: `Na ${nome}, cada cliente recebe atendimento consultivo de alto nível, com processos transparentes, equipe especializada e compromisso total com o resultado final.`,
    },

    // ── 02. Público-Alvo
    bloco02_publicoAlvo: {
      publicoPrincipal: {
        faixaEtaria: "28 a 55 anos",
        classes: "Classes A e B",
        perfil: "Decisores práticos e consumidores exigentes que priorizam segurança, pontualidade, atendimento humano e valor agregado sobre preço baixo.",
        descricao: `Pessoas que buscam soluções definitivas em ${setor}, pesquisam a reputação da empresa e querem ter a certeza de que estão contratando profissionais qualificados.`,
      },
      publicosDeApoio: [
        "Homens & Decisores Práticos: Foco em agilidade, custo-benefício e resolução rápida sem burocracia.",
        "Mães & Gestoras Familiares: Preocupação com acolhimento, segurança, higiene e confiança no time.",
        "Pais & Famílias: Foco em durabilidade, recomendações e tranquilidade no médio e longo prazo.",
        "Empresas & Parceiros B2B: Busca por confiabilidade, nota fiscal, pontualidade e contratos recorrentes.",
      ],
    },

    // ── 03. Canais de Aquisição
    bloco03_canaisAquisicao: {
      baseAtualVexo: "Reativação imediata de clientes inativos e follow-up contínuo através da régua de automação Vexo OS.",
      indicacoes: "Programa estruturado de recomendação de clientes satisfeitos com incentivos mútuos de fidelidade.",
      redeVp: "Ativação de conexões na rede Via Permuta e parcerias comerciais estratégicas no ecossistema local.",
      balcaoDaLoja: "Mostruário físico, atendimento consultivo presencial e QR Code no balcão para captura de leads e avaliações.",
      instagramOrganico: "Produção contínua de Reels e Carrosséis focados em autoridade, bastidores e quebra de objeções.",
      googleAds: "Campanhas de busca de alta intenção capturando demandas ativas no raio geográfico da operação.",
    },

    // ── 04. Banco de Dados e Automação (VEXO)
    bloco04_bancoDeDadosEAutomacao: {
      totalContatos: "Base consolidada e higienizada com segmentação de clientes ativos, inativos e prospects frios.",
      etapasFluxo: [
        {
          etapa: "Etapa 1: Higienização & Estruturação da Base",
          descricao: "Importação e limpeza dos contatos com classificação por perfil e histórico.",
          responsavel: "Gabriel",
          lado: "Agência",
        },
        {
          etapa: "Etapa 2: Configuração dos Chips & Gatilhos no Vexo OS",
          descricao: "Ativação das instâncias de WhatsApp e testes das mensagens de abordagem.",
          responsavel: "Gabriel",
          lado: "Agência",
        },
        {
          etapa: "Etapa 3: Disparo da Campanha de Reativação",
          descricao: "Envio de sondagens e ofertas de oportunidade para a base qualificada.",
          responsavel: "Gabriel",
          lado: "Agência",
        },
        {
          etapa: "Etapa 4: Atendimento Consultivo & Fechamento",
          descricao: "Recepção dos leads aquecidos no WhatsApp e fechamento de novos negócios.",
          responsavel,
          lado: "Cliente",
        },
      ],
    },

    // ── 05. Serviço em Destaque
    bloco05_servicoEmDestaque: {
      carroChefe: `Atendimento e Serviços Especializados de Alto Padrão em ${setor}.`,
      itensAceitos: [
        "Demandas completas e projetos personalizados com escopo bem definido",
        "Atendimento presencial e consultoria técnica especializada",
        "Serviços com padrão de acabamento e controle de qualidade rigoroso",
        "Contratos corporativos e parcerias com demandas programadas",
      ],
      itensNaoAceitos: [
        "Serviços emergenciais sem margem de planejamento prévio",
        "Demandas que desrespeitem os critérios técnicos de segurança e qualidade",
        "Propostas que exijam materiais de padrão inferior não homologados",
      ],
      paletaCoresProduto: "Tons nobres e acabamentos neutros que reforçam sofisticação, higiene e precisão técnica.",
    },

    // ── 06. Mitos para Derrubar
    bloco06_mitosParaDerrubar: [
      {
        mito: `Todo fornecedor em ${setor} entrega o mesmo resultado no final.`,
        verdade: "A metodologia, qualificação da equipe e padrões de garantia fazem com que soluções baratas custem o dobro após alguns meses.",
      },
      {
        mito: "O processo é muito demorado, complexo e burocrático.",
        verdade: "Com cronograma transparente e comunicação no WhatsApp, o cliente acompanha cada avanço em tempo real sem estresse.",
      },
      {
        mito: "Empresas consolidadas têm preço inacessível para quem precisa de agilidade.",
        verdade: "Nosso modelo oferece previsibilidade orçamentária e excelente relação entre investimento e retorno palpável.",
      },
      {
        mito: "Atendimento digital não resolve dúvidas complexas.",
        verdade: "Nossos canais digitais são operados por especialistas humanos prontos para esclarecer cada detalhe técnico.",
      },
    ],

    // ── 07. Problemas que Resolve (6 Dores Reais para Antes e Depois)
    bloco07_problemasQueResolve: [
      "1. Medo de ser enganado por orçamentos imprecisos ou cobranças extras inesperadas.",
      "2. Frustração por falta de cumprimento de prazos combinados por prestadores anteriores.",
      "3. Desgaste com comunicação confusa, atraso de respostas e atendentes despreparados.",
      "4. Dificuldade de encontrar profissionais que compreendam as particularidades do projeto.",
      "5. Receio de receber serviços que percam a qualidade logo após a entrega final.",
      "6. Falta de tempo para acompanhar de perto a execução e necessidade de confiança total na equipe.",
    ],

    // ── 08. Pauta de Conteúdo
    bloco08_pautaConteudo: {
      conveniencia: "Facilidade de contato via WhatsApp, orçamento ágil e comodidade no atendimento.",
      servico: "Passo a passo dos procedimentos, critérios técnicos e rigor na execução do carro-chefe.",
      prova: "Depoimentos reais, transformações antes/depois e avaliações 5 estrelas no Google.",
      educacao: "Mitos derrubados, dicas práticas de manutenção e como escolher o melhor serviço.",
      nichos: "Soluções personalizadas para diferentes perfis e necessidades específicas de clientes.",
      empresas: "Modelos de atendimento corporativo, pontualidade em larga escala e condições para parceiros.",
    },

    // ── 09. Depoimentos e Comunicação na Loja
    bloco09_depoimentosEComunicacaoLoja: {
      provaSocialParceiros: "Vídeos curtos de parceiros e clientes fiéis destacando a seriedade e o compromisso da equipe.",
      mostruarioBalcao: "Expositores táteis e material gráfico elegante no balcão mostrando os padrões de entrega.",
      qrCodeGoogleAvaliacoes: "Placas acrílicas no balcão com QR Code incentivando clientes satisfeitos a deixarem reviews no Google.",
    },

    // ── 10. Próximos Passos
    bloco10_proximosPassos: [
      { acao: "Envio de fotos e vídeos reais do espaço e da equipe", responsavel, lado: "Cliente" },
      { acao: "Validação final do Manual de Identidade Visual e cores", responsavel, lado: "Cliente" },
      { acao: "Estruturação dos chips virtuais e automação Vexo OS", responsavel: "Gabriel", lado: "Agência" },
      { acao: "Produção do primeiro lote mensal de 20 criativos", responsavel: "Santana & Equipe de Arte", lado: "Agência" },
      { acao: "Gravação presencial de depoimentos e bastidores", responsavel: `Carlos & ${responsavel}`, lado: "Agência" },
      { acao: "Instalação da placa de QR Code de avaliações no balcão", responsavel, lado: "Cliente" },
    ],

    // ── 11. Identidade Visual
    bloco11_identidadeVisual: {
      coresHex: [
        { nome: "Azul Petróleo Nobre (Primária)", hex: "#0B192C", rgb: "RGB(11, 25, 44)", uso: "Fundos principais, autoridade e sofisticação." },
        { nome: "Azul Profundo Estratégico (Secundária)", hex: "#1E3E62", rgb: "RGB(30, 62, 98)", uso: "Lâminas de carrossel e contrastes médios." },
        { nome: "Laranja Aceleração (CTA / Destaque)", hex: "#FF6500", rgb: "RGB(255, 101, 0)", uso: "Botões de ação, setas e números em destaque." },
        { nome: "Branco Neve (Neutro)", hex: "#FFFFFF", rgb: "RGB(255, 255, 255)", uso: "Textos claros, fundos de leitura e respiros." },
      ],
      tipografia: {
        titulos: "Montserrat / Poppins (Bold 700-800)",
        subtitulos: "Montserrat / Inter (SemiBold 600)",
        corpo: "Open Sans / Inter (Regular 400-500)",
      },
      diretrizesDesign: [
        "A regra de ouro: 'Uma peça. Uma dor. Uma virada. Uma chamada.'",
        "Design mobile-first com margens de segurança de 88px no Feed 1080×1350.",
        "Fotografia com pessoas reais da empresa, proibido uso de fotos genéricas de banco.",
      ],
    },
  };

  // 2. Identidade Visual & Diretrizes da Marca (Padrão Via Permuta Litoral Norte)
  const identidadeVisual = {
    titulo: `Manual de Identidade Visual & Diretrizes · ${nome}`,
    clienteNome: nome,
    regraDeOuro: "Uma peça. Uma dor. Uma virada. Uma chamada.",
    personalidadeMarca: {
      aMarcaE: "Especialista, acolhedora, transparente, resolutiva e pontual.",
      masNuncaE: "Amadora, sensacionalista, agressiva, prolixa ou com poluição visual.",
      naPratica: "Comunicação visual direta, alto contraste, foco em solucionar a dor do cliente, fotos autênticas e tipografia limpa.",
    },
    formatosEGrids: [
      {
        formato: "Feed Instagram: 1080×1350 px (4:5)",
        diretriz: "Margens de segurança de 88px nas 4 bordas. Garante que títulos e CTAs não sejam cortados na visualização em grade 1:1 do perfil.",
      },
      {
        formato: "Stories & Reels: 1080×1920 px (9:16)",
        diretriz: "Área nobre central livre das sobreposições da interface do Instagram (foto de perfil no topo, botões de curtir/comentar na direita e legenda no rodapé).",
      },
    ],
    diretrizesFotoVideo: [
      "Pessoas reais do negócio: priorizar sócios, especialistas e colaboradores reais atuando no dia a dia da empresa.",
      "Zero banco de imagens genérico: bancos de imagem artificiais reduzem a percepção de verdade e autoridade local.",
      "Iluminação natural & nitidez: fotos frontais bem iluminadas destacando os detalhes do produto ou da infraestrutura física.",
      "Captação em alta resolução: vídeos gravados em 4K/60fps com celular estabilizado e microfone de lapela para áudio cristalino.",
    ],
    conceito: `Identidade desenvolvida para transmitir solidez, dinamismo e elegância. O design visual equilibra estética premium com clareza funcional, assegurando legibilidade instantânea em formatos mobile.`,
    paletaCores: [
      { nome: "Azul Petróleo Nobre (Primária)", hex: "#0B192C", rgb: "RGB(11, 25, 44)", uso: "Fundos principais, tipografia de destaque e elementos institucionais de autoridade." },
      { nome: "Azul Profundo Estratégico (Secundária)", hex: "#1E3E62", rgb: "RGB(30, 62, 98)", uso: "Lâminas de carrossel, cartões de destaque e contrastes médios." },
      { nome: "Laranja Aceleração (Destaque / Ação)", hex: "#FF6500", rgb: "RGB(255, 101, 0)", uso: "Botões de CTA, setas de transição, destaques em números e palavras-chave." },
      { nome: "Branco Neve (Neutro Claro)", hex: "#FFFFFF", rgb: "RGB(255, 255, 255)", uso: "Textos sobre fundos escuros, respiros e fundos secundários limpos." },
      { nome: "Cinza Platina (Neutro Suave)", hex: "#F3F4F6", rgb: "RGB(243, 244, 246)", uso: "Fundos de caixas de texto, divisórias suaves e backgrounds neutros." },
    ],
    tipografia: {
      titulos: "Montserrat / Poppins (Bold ou ExtraBold, peso 700-800) — Impacto imediato, modernidade e legibilidade alta em telas pequenas.",
      subtitulos: "Montserrat / Inter (SemiBold, peso 600) — Hierarquia fluida e destaque de argumentos intermediários.",
      corpo: "Open Sans / Inter (Regular / Medium, peso 400-500) — Conforto visual em leituras longas e descrições detalhadas.",
    },
    diretrizesLogo: [
      "Manter área de respiro mínima equivalente a 50% da altura do isotipo ao redor da marca.",
      "Utilizar a versão monocromática branca sobre fundos escuros e versão em cor sobre fundos claros.",
      "Proibido distorcer proporções, rotacionar ou aplicar sombras excessivas.",
    ],
    elementosGraficos: [
      "Bordas sutilmente arredondadas (8px a 16px) para sensação amigável e contemporânea.",
      "Gradientes sutis entre os tons de azul para profundidade sem poluição visual.",
      "Ícones em estilo outlined (linha fina) com espessura uniforme.",
      "Fotografia com iluminação natural, expressões espontâneas e enquadramento dinâmico.",
    ],
    referenciasNicho: [
      "Estilo minimalista editorial com foco em tipografia limpa e espaçamento generoso.",
      "Composição visual orientada à escaneabilidade mobile rápida.",
    ],
  };

  // 3. Roteiros de Conteúdo para 3 Meses (12 Semanas)
  const roteirosTrimestrais = {
    titulo: `Planejamento Editorial & Roteiros de Conteúdo (90 Dias) · ${nome}`,
    clienteNome: nome,
    resumoCota: cotas,
    pilares: [
      { nome: "Pilar 1: Autoridade & Posicionamento", peso: "30%", foco: "Mostrar domínio técnico, bastidores, padrões de qualidade e por que a marca é a escolha segura." },
      { nome: "Pilar 2: Educação & Dores do Cliente", peso: "25%", foco: "Desmistificar dúvidas comuns, ensinar como evitar erros no setor e entregar valor prático imediato." },
      { nome: "Pilar 3: Prova Social & Casos de Sucesso", peso: "20%", foco: "Depoimentos, antes e depois, avaliações reais e validação por terceiros." },
      { nome: "Pilar 4: Conversão Direta & Oferta", peso: "15%", foco: "Chamadas claras para ação no WhatsApp, vagas abertas, condições especiais e incentivo ao contato." },
      { nome: "Pilar 5: Conexão & Humanização", peso: "10%", foco: "Rotina da equipe, valores da empresa, cultura e propósito que geram identificação emocional." },
    ],
    semanas: Array.from({ length: 12 }, (_, i) => {
      const numSemana = i + 1;
      const mesNum = Math.ceil(numSemana / 4);
      return {
        semana: numSemana,
        mes: mesNum,
        temaCentral: `Semana ${numSemana} — ${
          mesNum === 1 ? "Ativação & Posicionamento de Autoridade" : mesNum === 2 ? "Aprofundamento, Conexão & Prova Social" : "Conversão Intensiva & Decisão de Compra"
        }`,
        conteudos: [
          {
            codigo: `SEM${String(numSemana).padStart(2, "0")}-C01`,
            formato: "Carrossel Estratégico (7 Lâminas)",
            pilar: "Educação & Dores",
            titulo: `Os 5 Maiores Erros que Você Comete ao Contratar no Nicho de ${setor}`,
            gancho: "Você provavelmente está perdendo tempo e dinheiro por ignorar o item 3 desta lista...",
            estrutura: "Lâmina 1: Capa de alto impacto com gancho provocativo. Lâminas 2 a 5: Os 5 erros explicados de forma prática com a solução imediata. Lâmina 6: O diferencial da nossa metodologia. Lâmina 7: CTA para salvar o post e chamar no WhatsApp.",
            cta: "Salve este post para não esquecer e toque no link da bio para tirar suas dúvidas com nossos especialistas!",
            direcionamentoVisual: "Fundo Azul Petróleo com lâminas alternadas em Cinza Platina. Tipografia grande e números em destaque com Laranja Aceleração.",
          },
          {
            codigo: `SEM${String(numSemana).padStart(2, "0")}-V01`,
            formato: "Vídeo Reels / Curto (30s a 45s)",
            pilar: "Autoridade & Posicionamento",
            titulo: `O que ninguém te conta sobre a entrega de qualidade na ${nome}`,
            gancho: "Se você pensa que todo serviço de qualidade é igual, assista a este vídeo até o fim.",
            estrutura: "Cena 1 (0-3s): Fala direta olhando para a câmera com legenda destacada. Cena 2 (4-20s): Demonstração visual rápida dos bastidores ou processo. Cena 3 (21-35s): Apresentação do motivo pelo qual nossa entrega é consistente. Cena 4 (36-45s): Fechamento direto com convite para conversar no WhatsApp.",
            cta: "Envie uma mensagem no direct ou no nosso WhatsApp para entender como podemos ajudar o seu caso!",
            direcionamentoVisual: "Câmera estável na altura dos olhos, iluminação frontal suave e legendas com palavras-chave coloridas.",
          },
          {
            codigo: `SEM${String(numSemana).padStart(2, "0")}-C02`,
            formato: "Carrossel Informativo / Comparativo",
            pilar: "Prova Social & Comparativo",
            titulo: `Como era antes vs. Como ficou depois: O impacto real da nossa solução`,
            gancho: "Veja o que acontece quando a estratégia certa é aplicada do jeito certo.",
            estrutura: "Lâmina 1: Comparativo lado a lado instigante. Lâminas 2 e 3: O desafio inicial e as dificuldades enfrentadas. Lâminas 4 e 5: A intervenção técnica realizada. Lâmina 6: O resultado palpável alcançado. Lâmina 7: Convite para alcançar o mesmo resultado.",
            cta: "Quer transformar os seus resultados também? Toque no link da bio e fale com a nossa equipe hoje mesmo.",
            direcionamentoVisual: "Cards limpos, setas visuais de progressão e depoimento real printado em alta resolução.",
          },
          {
            codigo: `SEM${String(numSemana).padStart(2, "0")}-V02`,
            formato: "Vídeo Reels Dinâmico (Perguntas & Respostas)",
            pilar: "Humanização & Desmistificação",
            titulo: `Respondendo a dúvida que mais recebemos por aqui`,
            gancho: "“Será que isso realmente funciona para o meu tipo de necessidade?”",
            estrutura: "Cena 1 (0-5s): Leitura da pergunta recebida com tom natural e empático. Cena 2 (6-25s): Resposta direta, prática e sem termos excessivamente técnicos. Cena 3 (26-40s): Exemplo prático de aplicação cotidiana. Cena 4 (41-45s): Chamada para enviar a sua própria dúvida nos comentários.",
            cta: "Deixe nos comentários a sua dúvida que responderemos nos próximos vídeos!",
            direcionamentoVisual: "Ambiente de trabalho autêntico, microfone de lapela visível e cortes dinâmicos a cada 4 segundos.",
          },
          {
            codigo: `SEM${String(numSemana).padStart(2, "0")}-E01`,
            formato: "Post Estático de Alto Impacto (Card Único)",
            pilar: "Conversão Direta",
            titulo: `Decisão Inteligente: O checklist essencial para você não errar`,
            gancho: "Guarde este checklist antes de tomar qualquer decisão nesta semana.",
            estrutura: "Card único com 4 pontos de verificação fundamentais em formato de lista com ícones de check verdes. Rodapé com a assinatura oficial da marca.",
            cta: "Compartilhe este post com alguém que precisa saber disso hoje!",
            direcionamentoVisual: "Layout limpo em fundo escuro com alto contraste nas letras e logo oficial no topo.",
          },
        ],
      };
    }),
  };

  // 4. Planejamento Trimestral Visual
  const planejamentoTrimestral = {
    titulo: `Planejamento Estratégico Trimestral (Roadmap 90 Dias) · ${nome}`,
    clienteNome: nome,
    resumoExecutivo: `O plano trimestral visa consolidar a presença digital da ${nome}, gerando tração consistente de demanda comercial e construindo patrimônio de marca duradouro. O cronograma está estruturado em 3 fases progressivas: Fundação & Ativação (Mês 1), Expansão & Engajamento (Mês 2) e Conversão em Escala (Mês 3).`,
    fases: [
      {
        mes: "Mês 1: Fundação, Posicionamento & Primeiras Conversões",
        foco: "Organização da casa, padronização visual completa, alinhamento dos pilares de autoridade e início da captação ativa de leads.",
        entregasChave: [
          "Briefing e Identidade Visual aplicados em todos os canais",
          "Publicação de 20 peças de conteúdo (8 carrosséis, 8 vídeos, 4 estáticos)",
          "Otimização do perfil comercial e links de conversão no WhatsApp",
          "Reunião de alinhamento e análise de primeiros resultados (Checkpoint D+30)",
        ],
        kpisMeta: "15% de aumento de engajamento e mínimo de 25 conversas qualificadas geradas no WhatsApp.",
      },
      {
        mes: "Mês 2: Expansão, Conexão Profunda & Prova Social",
        foco: "Aprofundar a relação com a audiência, explorar depoimentos e casos de sucesso, e testar formatos de maior retenção orgânica.",
        entregasChave: [
          "Publicação de 20 peças de conteúdo focadas em dores e diferenciais",
          "Entrevistas ou vídeos com depoimentos reais de clientes",
          "Análise dos conteúdos de melhor performance para repetição de padrões vencedores",
          "Reunião estratégica de meio de trimestre (Checkpoint D+60)",
        ],
        kpisMeta: "25% de aumento em alcance e mínimo de 40 conversas qualificadas no WhatsApp.",
      },
      {
        mes: "Mês 3: Conversão em Escala, Otimização & Próximo Ciclo",
        foco: "Foco agressivo em fechamento comercial, ofertas estruturadas e consolidação do ROI gerado pelo marketing.",
        entregasChave: [
          "Publicação de 20 peças de conteúdo com ênfase em chamadas diretas de compra",
          "Campanhas de reforço para leads mornos que ainda não fecharam",
          "Relatório executivo completo de performance do trimestre (Checkpoint D+90)",
          "Planejamento do próximo ciclo trimestral de crescimento",
        ],
        kpisMeta: "Mínimo de 50 a 70 conversas qualificadas no WhatsApp e validação positiva de retorno sobre investimento.",
      },
    ],
    matrizSemanal: [
      { dia: "Segunda-feira (18h30)", formato: "Carrossel Educativo", objetivo: "Começar a semana entregando alto valor e incentivando salvamentos." },
      { dia: "Terça-feira (12h00)", formato: "Reels / Vídeo de Autoridade", objetivo: "Pico de horário de almoço com tema de forte identificação." },
      { dia: "Quarta-feira (19h00)", formato: "Post Estático de Impacto", objetivo: "Checklist ou frase de posicionamento para compartilhamento." },
      { dia: "Quinta-feira (18h30)", formato: "Carrossel de Prova Social", objetivo: "Mostrar resultados reais antes do final de semana." },
      { dia: "Sexta-feira (12h30)", formato: "Reels Dinâmico de Dúvidas / Bastidores", objetivo: "Humanizar e aproximar a audiência com tom descontraído." },
    ],
    governancaECheckpoints: [
      { marco: "D+15", descricao: "Verificação dos primeiros dias de postagem e ajuste fino de linguagem/design." },
      { marco: "D+30", descricao: "Fechamento do Mês 1 com métricas de alcance, engajamento e leads gerados." },
      { marco: "D+60", descricao: "Revisão estratégica do Mês 2 e calibração de roteiros para o Mês 3." },
      { marco: "D+90", descricao: "Fechamento oficial do trimestre, análise de ROI e apresentação do próximo roadmap." },
    ],
  };

  return {
    briefingConsolidado,
    identidadeVisual,
    roteirosTrimestrais,
    planejamentoTrimestral,
  };
}

// ─── Chamada ao Gemini com Insumos ──────────────────────────────────────────
export async function sintetizarBriefingComGemini({
  cliente,
  transcricao = "",
  respostasFormulario = {},
  contrato = null,
  templateGd = null,
  model = "gemini-flash-latest",
  apiKey = null,
  llmCaller = null,
}) {
  const effectiveApiKey =
    apiKey ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    "";

  // Se não temos chave de IA ou foi explicitamente pedido fallback em testes
  if (!effectiveApiKey && !llmCaller) {
    console.info("[gdBriefingSynthesizer] Nenhuma chave do Gemini disponível. Utilizando síntese padrão estruturada de alta qualidade.");
    return gerarSintesePadrao({ cliente, transcricao, respostasFormulario, contrato });
  }

  const promptInstrucoes = `
Você é o Diretor Estratégico de Marketing e Criação da Geração Digital (agência especializada em growth, branding e inbound sales com Vexo OS).
Sua missão é sintetizar TODOS os insumos fornecidos a seguir e produzir os 4 documentos estratégicos oficiais para o cliente ${cliente?.nome || "Cliente"}.

ESTRUTURA DOS 11 BLOCOS OFICIAIS DO BRIEFING CONSOLIDADO (Padrão Tinge Brasil & Litoral Norte):
01. Resumo da Estratégia:
    - ideiaCentral: Visão central da estratégia da marca.
    - pilaresRapidos: Array com 4 pilares rápidos.
    - tabelaComparativa: Array de objetos com { pontoComparacao, cliente, concorrencia } comparando diferenciais claros.
    - mensagemPrincipal: Frase principal e promessa de valor inegociável da marca.
02. Público-Alvo:
    - publicoPrincipal: { faixaEtaria, classes, perfil, descricao }
    - publicosDeApoio: Array de 4 perfis complementares (Homens/Decisores, Mães/Gestoras, Pais/Famílias, Empresas/B2B).
03. Canais de Aquisição:
    - Objeto com { baseAtualVexo, indicacoes, redeVp, balcaoDaLoja, instagramOrganico, googleAds }.
04. Banco de Dados e Automação (VEXO):
    - totalContatos: Diagnóstico do volume e qualidade da base.
    - etapasFluxo: Array de 4 etapas atribuídas a Gabriel (Agência) e Cliente ({ etapa, descricao, responsavel, lado: "Agência" | "Cliente" }).
05. Serviço em Destaque:
    - carroChefe: Nome e descrição do produto/serviço principal.
    - itensAceitos: Array de serviços/peças aceitas.
    - itensNaoAceitos: Array de serviços/peças recusadas (filtro de entrada).
    - paletaCoresProduto: Paleta de cores ou acabamentos do produto.
06. Mitos para Derrubar:
    - Array de objetos { mito, verdade } desmistificando crenças do mercado.
07. Problemas que Resolve:
    - Array de exatamente 6 dores reais dos clientes para pauta de "Antes e Depois".
08. Pauta de Conteúdo:
    - Objeto categorizado por formato e objetivo: { conveniencia, servico, prova, educacao, nichos, empresas }.
09. Depoimentos e Comunicação na Loja:
    - Objeto com { provaSocialParceiros, mostruarioBalcao, qrCodeGoogleAvaliacoes }.
10. Próximos Passos:
    - Tabela/Array de objetos { acao, responsavel, lado: "Agência" | "Cliente" }.
11. Identidade Visual:
    - Objeto com { coresHex (array de { nome, hex, rgb, uso }), tipografia ({ titulos, subtitulos, corpo }), diretrizesDesign (array) }.

DIRETRIZES DO DOCUMENTO 2 - IDENTIDADE VISUAL (Padrão Via Permuta Litoral Norte):
- Regra de Ouro: "Uma peça. Uma dor. Uma virada. Uma chamada."
- Personalidade da Marca: { aMarcaE, masNuncaE, naPratica }
- Formatos e Grids Recomendados: Feed 1080×1350 (margens de 88px) e Reels/Stories 1080×1920.
- Diretrizes de Foto/Vídeo: Pessoas reais do negócio (proibido fotos genéricas de banco).
- Conceito, paletaCores, tipografia, diretrizesLogo, elementosGraficos, referenciasNicho.

INSUMOS FORNECIDOS:
1. TRANSCRIÇÃO DA REUNIÃO NO GOOGLE MEET:
${transcricao || "(Reunião realizada com alinhamento geral de objetivos e posicionamento comercial)"}

2. RESPOSTAS DO FORMULÁRIO DE BRIEFING VEXO OS:
${JSON.stringify(respostasFormulario || {}, null, 2)}

3. DADOS DO CONTRATO E ESCOPO:
${JSON.stringify(contrato || { escopo: cliente?.escopo, escopo_original: cliente?.escopo_original }, null, 2)}

4. DIRETRIZES DA AGÊNCIA GERAÇÃO DIGITAL:
${templateGd || "Padrão premium, foco em autoridade, conversão no WhatsApp, design mobile-first e escaneabilidade."}

SAÍDA OBRIGATÓRIA:
Retorne APENAS um objeto JSON válido (sem blocos markdown soltos fora do json) contendo exatamente as seguintes 4 propriedades:
1. "briefingConsolidado": Objeto contendo os 11 blocos descritos acima (bloco01_resumoEstrategia, bloco02_publicoAlvo, bloco03_canaisAquisicao, bloco04_bancoDeDadosEAutomacao, bloco05_servicoEmDestaque, bloco06_mitosParaDerrubar, bloco07_problemasQueResolve, bloco08_pautaConteudo, bloco09_depoimentosEComunicacaoLoja, bloco10_proximosPassos, bloco11_identidadeVisual), além de titulo, clienteNome, responsavel, cnpj, dataBriefing, visaoGeral, posicionamento, propostaDeValor, publicoAlvo.
2. "identidadeVisual": Objeto com titulo, clienteNome, regraDeOuro, personalidadeMarca, formatosEGrids, diretrizesFotoVideo, conceito, paletaCores, tipografia, diretrizesLogo, elementosGraficos, referenciasNicho.
3. "roteirosTrimestrais": Objeto com titulo, clienteNome, resumoCota (objeto), pilares (array), semanas (array com 12 semanas, cada semana com semana, mes, temaCentral, conteudos contendo codigo, formato, pilar, titulo, gancho, estrutura, cta, direcionamentoVisual).
4. "planejamentoTrimestral": Objeto com titulo, clienteNome, resumoExecutivo, fases (array com os 3 meses), matrizSemanal (array), governancaECheckpoints (array).
`;

  try {
    if (typeof llmCaller === "function") {
      const res = await llmCaller({ prompt: promptInstrucoes, model, apiKey: effectiveApiKey });
      if (typeof res === "object" && res.briefingConsolidado) return res;
      if (typeof res === "string") {
        const cleaned = res.replace(/```json/g, "").replace(/```/g, "").trim();
        return JSON.parse(cleaned);
      }
    }

    // Chamada REST nativa para o Gemini
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${effectiveApiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptInstrucoes }] }],
        generationConfig: {
          temperature: 0.3,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      console.warn(`[gdBriefingSynthesizer] API do Gemini retornou HTTP ${response.status}. Aplicando fallback seguro.`);
      return gerarSintesePadrao({ cliente, transcricao, respostasFormulario, contrato });
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parsed = JSON.parse(rawText);

    if (parsed && parsed.briefingConsolidado && parsed.identidadeVisual && parsed.roteirosTrimestrais && parsed.planejamentoTrimestral) {
      return parsed;
    }
    return gerarSintesePadrao({ cliente, transcricao, respostasFormulario, contrato });
  } catch (err) {
    console.warn("[gdBriefingSynthesizer] Erro durante chamada da IA:", err.message, "-> Usando síntese padrão.");
    return gerarSintesePadrao({ cliente, transcricao, respostasFormulario, contrato });
  }
}

// ─── Geradores de DOCX Profissionais ────────────────────────────────────────

function buildDocxHeader(titulo, subtitulo) {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [
        new TextRun({
          text: "GERAÇÃO DIGITAL · MARKETING & VENDAS",
          bold: true,
          size: 20,
          color: GD_COLORS.navyMedium,
          font: "Arial",
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: titulo,
          bold: true,
          size: 32,
          color: GD_COLORS.navyDark,
          font: "Arial",
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [
        new TextRun({
          text: subtitulo,
          italics: true,
          size: 20,
          color: GD_COLORS.grayMuted,
          font: "Arial",
        }),
      ],
    }),
  ];
}

function buildDocxSectionHeading(text) {
  return new Paragraph({
    spacing: { before: 300, after: 120 },
    heading: HeadingLevel.HEADING_1,
    children: [
      new TextRun({
        text,
        bold: true,
        size: 24,
        color: GD_COLORS.navyMedium,
        font: "Arial",
      }),
    ],
  });
}

function buildDocxParagraph(text, boldPrefix = "") {
  return new Paragraph({
    spacing: { after: 120 },
    children: [
      ...(boldPrefix ? [new TextRun({ text: boldPrefix + " ", bold: true, color: GD_COLORS.grayDark, font: "Arial", size: 21 })] : []),
      new TextRun({ text, color: GD_COLORS.grayDark, font: "Arial", size: 21 }),
    ],
  });
}

function buildDocxCallout(text, title = "") {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { fill: GD_COLORS.blueLight, type: ShadingType.CLEAR },
            borders: {
              left: { style: BorderStyle.SINGLE, size: 24, color: GD_COLORS.blueRoyal },
              top: { style: BorderStyle.NONE },
              right: { style: BorderStyle.NONE },
              bottom: { style: BorderStyle.NONE },
            },
            margins: { top: 150, bottom: 150, left: 200, right: 200 },
            children: [
              ...(title ? [new Paragraph({ children: [new TextRun({ text: title, bold: true, color: GD_COLORS.navyDark, font: "Arial", size: 22 })] })] : []),
              new Paragraph({ children: [new TextRun({ text, color: GD_COLORS.grayDark, font: "Arial", size: 21 })] }),
            ],
          }),
        ],
      }),
    ],
  });
}

function buildDocxSimpleTable(headers, rowsData) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h) =>
          new TableCell({
            shading: { fill: GD_COLORS.navyMedium, type: ShadingType.CLEAR },
            margins: { top: 100, bottom: 100, left: 120, right: 120 },
            children: [
              new Paragraph({
                children: [new TextRun({ text: h, bold: true, color: GD_COLORS.white, size: 20, font: "Arial" })],
              }),
            ],
          })
        ),
      }),
      ...rowsData.map((row, rIdx) =>
        new TableRow({
          children: row.map((cellText) =>
            new TableCell({
              shading: { fill: rIdx % 2 === 0 ? GD_COLORS.white : GD_COLORS.grayLight, type: ShadingType.CLEAR },
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: String(cellText || ""), color: GD_COLORS.grayDark, size: 19, font: "Arial" })],
                }),
              ],
            })
          ),
        })
      ),
    ],
  });
}

// Documento 1: Briefing Consolidado (11 Blocos Oficiais) (DOCX)
export async function gerarDocumentoBriefingDocx(sintese) {
  const b = sintese.briefingConsolidado;
  const b1 = b.bloco01_resumoEstrategia || {};
  const b2 = b.bloco02_publicoAlvo || {};
  const b3 = b.bloco03_canaisAquisicao || {};
  const b4 = b.bloco04_bancoDeDadosEAutomacao || {};
  const b5 = b.bloco05_servicoEmDestaque || {};
  const b6 = b.bloco06_mitosParaDerrubar || [];
  const b7 = b.bloco07_problemasQueResolve || [];
  const b8 = b.bloco08_pautaConteudo || {};
  const b9 = b.bloco09_depoimentosEComunicacaoLoja || {};
  const b10 = b.bloco10_proximosPassos || [];
  const b11 = b.bloco11_identidadeVisual || {};

  const doc = new Document({
    sections: [
      {
        children: [
          ...buildDocxHeader(b.titulo, `Documento Oficial de Alinhamento Estratégico (11 Blocos) · ${b.clienteNome}`),
          buildDocxCallout(`Cliente: ${b.clienteNome} | Responsável: ${b.responsavel} | Data: ${b.dataBriefing} | CNPJ: ${b.cnpj || "A confirmar"}`, "Ficha Cadastral Oficial"),

          // 01. Resumo da Estratégia
          buildDocxSectionHeading("01. Resumo da Estratégia"),
          buildDocxParagraph(b1.ideiaCentral || b.posicionamento, "Ideia Central:"),
          buildDocxParagraph((b1.pilaresRapidos || []).join(" • "), "4 Pilares Rápidos:"),
          ...(b1.tabelaComparativa?.length > 0
            ? [
                new Paragraph({ spacing: { before: 100, after: 60 }, children: [new TextRun({ text: "Comparativo de Mercado vs. Concorrência:", bold: true, size: 21, color: GD_COLORS.navyMedium, font: "Arial" })] }),
                buildDocxSimpleTable(
                  ["Ponto de Comparação", b.clienteNome, "Concorrência"],
                  b1.tabelaComparativa.map((t) => [t.pontoComparacao, t.cliente, t.concorrencia])
                ),
              ]
            : []),
          buildDocxCallout(b1.mensagemPrincipal || b.propostaDeValor, "Mensagem Principal da Marca"),

          // 02. Público-Alvo
          buildDocxSectionHeading("02. Público-Alvo"),
          buildDocxParagraph(
            `${b2.publicoPrincipal?.faixaEtaria || "28 a 55 anos"} | ${b2.publicoPrincipal?.classes || "Classes A e B"}\n${b2.publicoPrincipal?.perfil || b.publicoAlvo}\n${b2.publicoPrincipal?.descricao || ""}`,
            "Público Principal:"
          ),
          buildDocxParagraph("Segmentos e personas complementares de compra:", "Públicos de Apoio:"),
          ...(b2.publicosDeApoio || []).map((pa) => buildDocxParagraph(pa, "•")),

          // 03. Canais de Aquisição
          buildDocxSectionHeading("03. Canais de Aquisição"),
          buildDocxParagraph(b3.baseAtualVexo || "Reativação e régua no Vexo OS", "1. Base Atual VEXO:"),
          buildDocxParagraph(b3.indicacoes || "Member-get-member estruturado", "2. Indicações:"),
          buildDocxParagraph(b3.redeVp || "Alavancagem de parcerias da rede", "3. Rede VP (Via Permuta / Parceiros):"),
          buildDocxParagraph(b3.balcaoDaLoja || "Displays e QR Code de balcão", "4. Balcão da Loja / Ponto Físico:"),
          buildDocxParagraph(b3.instagramOrganico || "Linha editorial de Reels e Carrosséis", "5. Instagram Orgânico:"),
          buildDocxParagraph(b3.googleAds || "Campanhas de busca de alta intenção", "6. Google Ads:"),

          // 04. Banco de Dados e Automação (VEXO)
          buildDocxSectionHeading("04. Banco de Dados e Automação (VEXO)"),
          buildDocxParagraph(b4.totalContatos || "Base total de contatos da empresa", "Volume da Base:"),
          ...(b4.etapasFluxo?.length > 0
            ? [
                buildDocxSimpleTable(
                  ["Etapa", "Descrição", "Responsável", "Lado"],
                  b4.etapasFluxo.map((e) => [e.etapa, e.descricao, e.responsavel, e.lado])
                ),
              ]
            : []),

          // 05. Serviço em Destaque
          buildDocxSectionHeading("05. Serviço em Destaque"),
          buildDocxParagraph(b5.carroChefe || b.visaoGeral, "Carro-Chefe:"),
          buildDocxParagraph((b5.itensAceitos || []).join("; "), "✓ Peças / Serviços Aceitos:"),
          buildDocxParagraph((b5.itensNaoAceitos || []).join("; "), "✗ Não Aceitos (Filtro de Entrada):"),
          buildDocxParagraph(b5.paletaCoresProduto || "Tons institucionais alinhados à marca", "Paleta de Cores do Produto:"),

          // 06. Mitos para Derrubar
          buildDocxSectionHeading("06. Mitos para Derrubar"),
          ...(b6.length > 0
            ? [
                buildDocxSimpleTable(
                  ["Mito do Mercado", "A Verdade da Marca"],
                  b6.map((m) => [m.mito, m.verdade])
                ),
              ]
            : []),

          // 07. Problemas que Resolve
          buildDocxSectionHeading("07. Problemas que Resolve (Dores para Antes e Depois)"),
          ...(b7.map((dor) => buildDocxParagraph(dor, "⚠"))),

          // 08. Pauta de Conteúdo
          buildDocxSectionHeading("08. Pauta de Conteúdo (Formatos & Objetivos)"),
          buildDocxParagraph(b8.conveniencia || "", "• Conveniência:"),
          buildDocxParagraph(b8.servico || "", "• Serviço (Técnico / Carro-Chefe):"),
          buildDocxParagraph(b8.prova || "", "• Prova Social & Casos de Sucesso:"),
          buildDocxParagraph(b8.educacao || "", "• Educação & Mitos:"),
          buildDocxParagraph(b8.nichos || "", "• Nichos Específicos:"),
          buildDocxParagraph(b8.empresas || "", "• Empresas & B2B:"),

          // 09. Depoimentos e Comunicação na Loja
          buildDocxSectionHeading("09. Depoimentos e Comunicação na Loja"),
          buildDocxParagraph(b9.provaSocialParceiros || "", "Prova Social de Parceiros:"),
          buildDocxParagraph(b9.mostruarioBalcao || "", "Mostruário de Balcão:"),
          buildDocxParagraph(b9.qrCodeGoogleAvaliacoes || "", "QR Code Google Avaliações:"),

          // 10. Próximos Passos
          buildDocxSectionHeading("10. Próximos Passos & Cronograma"),
          ...(b10.length > 0
            ? [
                buildDocxSimpleTable(
                  ["Ação", "Responsável", "Lado"],
                  b10.map((p) => [p.acao, p.responsavel, p.lado])
                ),
              ]
            : []),

          // 11. Identidade Visual
          buildDocxSectionHeading("11. Identidade Visual & Diretrizes"),
          buildDocxParagraph(
            (b11.coresHex || []).map((c) => `${c.nome}: ${c.hex}`).join(" | "),
            "Cores Principais:"
          ),
          buildDocxParagraph(
            `Títulos: ${b11.tipografia?.titulos || "Montserrat"} | Corpo: ${b11.tipografia?.corpo || "Open Sans"}`,
            "Tipografia:"
          ),
          ...(b11.diretrizesDesign || []).map((dir) => buildDocxParagraph(dir, "•")),
        ],
      },
    ],
  });
  return await Packer.toBuffer(doc);
}

// Documento 2: Identidade Visual (DOCX - Padrão Via Permuta Litoral Norte)
export async function gerarDocumentoIdentidadeDocx(sintese) {
  const iv = sintese.identidadeVisual;
  const pm = iv.personalidadeMarca || {};
  const doc = new Document({
    sections: [
      {
        children: [
          ...buildDocxHeader(iv.titulo, `Manual de Identidade Visual e Diretrizes de Marca · ${iv.clienteNome}`),
          buildDocxCallout(iv.regraDeOuro || "Uma peça. Uma dor. Uma virada. Uma chamada.", "A Regra de Ouro (Via Permuta Litoral Norte)"),
          buildDocxSectionHeading("1. Conceito & Atmosfera Visual"),
          buildDocxParagraph(iv.conceito),
          buildDocxSectionHeading("2. Personalidade da Marca"),
          buildDocxParagraph(pm.aMarcaE || "Especialista, acolhedora, transparente e resolutiva.", "A Marca É:"),
          buildDocxParagraph(pm.masNuncaE || "Amadora, agressiva, prolixa ou com poluição visual.", "Mas NUNCA É:"),
          buildDocxParagraph(pm.naPratica || "Comunicação direta, alto contraste e fotos autênticas.", "Na Prática:"),
          buildDocxSectionHeading("3. Formatos e Grids Recomendados"),
          ...(Array.isArray(iv.formatosEGrids)
            ? iv.formatosEGrids.map((f) => buildDocxParagraph(typeof f === "string" ? f : `${f.formato}: ${f.diretriz}`, "📐"))
            : [
                buildDocxParagraph("Feed Instagram: 1080×1350 px (4:5) com margens de segurança de 88px nas 4 bordas.", "•"),
                buildDocxParagraph("Stories & Reels: 1080×1920 px (9:16) com área nobre central livre.", "•"),
              ]),
          buildDocxSectionHeading("4. Diretrizes de Foto & Vídeo (Pessoas Reais)"),
          ...(iv.diretrizesFotoVideo || []).map((dfv) => buildDocxParagraph(dfv, "📷")),
          buildDocxSectionHeading("5. Paleta de Cores Oficial"),
          ...(iv.paletaCores || []).map((c) =>
            buildDocxParagraph(`${c.hex} | ${c.rgb} — ${c.uso}`, `• ${c.nome}:`)
          ),
          buildDocxSectionHeading("6. Tipografia & Hierarquia de Textos"),
          buildDocxParagraph(iv.tipografia?.titulos || "", "Títulos & Headings:"),
          buildDocxParagraph(iv.tipografia?.subtitulos || "", "Subtítulos & Chamadas:"),
          buildDocxParagraph(iv.tipografia?.corpo || "", "Corpo de Texto & Legendas:"),
          buildDocxSectionHeading("7. Regras e Uso do Logotipo"),
          ...(iv.diretrizesLogo || []).map((r) => buildDocxParagraph(r, "⚠")),
          buildDocxSectionHeading("8. Elementos Gráficos & Estilo Visual"),
          ...(iv.elementosGraficos || []).map((e) => buildDocxParagraph(e, "•")),
          buildDocxSectionHeading("9. Benchmarks & Referências do Nicho"),
          ...(iv.referenciasNicho || []).map((ref) => buildDocxParagraph(ref, "★")),
        ],
      },
    ],
  });
  return await Packer.toBuffer(doc);
}

// Documento 3: Roteiros de Conteúdo (DOCX)
export async function gerarDocumentoRoteirosDocx(sintese) {
  const r = sintese.roteirosTrimestrais;
  const semanasList = (r.semanas || []).flatMap((sem) => [
    buildDocxSectionHeading(`${sem.temaCentral} (Mês ${sem.mes})`),
    ...(sem.conteudos || []).flatMap((c) => [
      new Paragraph({
        spacing: { before: 180, after: 60 },
        children: [
          new TextRun({ text: `[${c.codigo}] ${c.titulo}`, bold: true, color: GD_COLORS.navyMedium, font: "Arial", size: 22 }),
        ],
      }),
      buildDocxParagraph(`${c.formato} | Pilar: ${c.pilar}`, "Formato:"),
      buildDocxParagraph(c.gancho, "Gancho (Hook 0-3s):"),
      buildDocxParagraph(c.estrutura, "Estrutura do Roteiro:"),
      buildDocxParagraph(c.cta, "Chamada para Ação (CTA):"),
      buildDocxParagraph(c.direcionamentoVisual, "Direcionamento Visual:"),
    ]),
  ]);

  const doc = new Document({
    sections: [
      {
        children: [
          ...buildDocxHeader(r.titulo, `Roteiros Estruturados para 3 Meses · 12 Semanas · ${r.clienteNome}`),
          buildDocxCallout(
            `Cota Contratual: ${r.resumoCota?.carrosseisPorSemana || 2} Carrosséis/sem, ${r.resumoCota?.videosPorSemana || 2} Vídeos/sem, ${r.resumoCota?.estaticosPorSemana || 1} Estáticos/sem. Total: ${r.resumoCota?.totalTrimestre || 60} conteúdos.`,
            "Volume Contratado"
          ),
          buildDocxSectionHeading("Pilares Editoriais"),
          ...(r.pilares || []).map((p) => buildDocxParagraph(`${p.foco} (Distribuição: ${p.peso})`, `• ${p.nome}:`)),
          ...semanasList,
        ],
      },
    ],
  });
  return await Packer.toBuffer(doc);
}

// Documento 4: Planejamento Trimestral (DOCX)
export async function gerarDocumentoPlanejamentoDocx(sintese) {
  const p = sintese.planejamentoTrimestral;
  const doc = new Document({
    sections: [
      {
        children: [
          ...buildDocxHeader(p.titulo, `Resumo Executivo do Cronograma Trimestral · ${p.clienteNome}`),
          buildDocxCallout(p.resumoExecutivo, "Visão Executiva do Trimestre"),
          buildDocxSectionHeading("1. Evolução Mensal Estratégica (Roadmap 90 Dias)"),
          ...(p.fases || []).flatMap((f) => [
            new Paragraph({
              spacing: { before: 180, after: 60 },
              children: [new TextRun({ text: f.mes, bold: true, color: GD_COLORS.navyMedium, font: "Arial", size: 22 })],
            }),
            buildDocxParagraph(f.foco, "Foco Principal:"),
            buildDocxParagraph((f.entregasChave || []).join("; "), "Entregas-Chave:"),
            buildDocxParagraph(f.kpisMeta, "Meta do Mês:"),
          ]),
          buildDocxSectionHeading("2. Matriz Semanal de Publicações"),
          ...(p.matrizSemanal || []).map((m) =>
            buildDocxParagraph(`${m.formato} — ${m.objetivo}`, `• ${m.dia}:`)
          ),
          buildDocxSectionHeading("3. Governança, Reuniões e Checkpoints"),
          ...(p.governancaECheckpoints || []).map((chk) =>
            buildDocxParagraph(chk.descricao, `[${chk.marco}]`)
          ),
        ],
      },
    ],
  });
  return await Packer.toBuffer(doc);
}

// ─── Geradores de PDF Profissionais (PDFKit) ───────────────────────────────

function setupPdfHeaderFooter(doc, title) {
  const margin = 40;
  // Header
  doc.fillColor("#1E3E62").fontSize(8).text("GERAÇÃO DIGITAL · MARKETING & VENDAS", margin, 20, { align: "left" });
  doc.fillColor("#6B7280").fontSize(8).text("DOCUMENTO OFICIAL", margin, 20, { align: "right" });
  doc.moveTo(margin, 32).lineTo(doc.page.width - margin, 32).strokeColor("#E5E7EB").lineWidth(0.5).stroke();

  // Move cursor para início do conteúdo
  doc.y = 48;
}

function renderPdfTitleBlock(doc, title, subtitle) {
  doc.fillColor("#0B192C").fontSize(18).font("Helvetica-Bold").text(title, { align: "center" });
  doc.moveDown(0.3);
  doc.fillColor("#6B7280").fontSize(10).font("Helvetica-Oblique").text(subtitle, { align: "center" });
  doc.moveDown(0.8);
}

function renderPdfSection(doc, title) {
  doc.moveDown(0.6);
  const startY = doc.y;
  // Barrinha colorida
  doc.rect(40, startY + 2, 4, 14).fillColor("#2563EB").fill();
  doc.fillColor("#0B192C").fontSize(12).font("Helvetica-Bold").text(title, 50, startY);
  doc.moveDown(0.4);
}

function renderPdfParagraph(doc, text, boldPrefix = "") {
  doc.font("Helvetica").fontSize(9.5).fillColor("#1F2937");
  if (boldPrefix) {
    doc.font("Helvetica-Bold").text(boldPrefix + " ", { continued: true });
  }
  doc.font("Helvetica").text(text, { lineGap: 2.5, paragraphGap: 3 });
}

function renderPdfCallout(doc, title, text) {
  const margin = 40;
  const width = doc.page.width - margin * 2;
  const startY = doc.y;

  doc.rect(margin, startY, width, 40).fillAndStroke("#EFF6FF", "#BFDBFE");
  doc.rect(margin, startY, 4, 40).fillColor("#2563EB").fill();

  doc.fillColor("#0B192C").fontSize(9.5).font("Helvetica-Bold").text(title, margin + 12, startY + 6);
  doc.fillColor("#1F2937").fontSize(9).font("Helvetica").text(text, margin + 12, startY + 20, { width: width - 24 });
  doc.y = startY + 48;
}

function renderPdfTable(doc, headers, rowsData, colWidths = null) {
  const margin = 40;
  const availableWidth = doc.page.width - margin * 2;
  const numCols = headers.length;
  const widths = colWidths || headers.map(() => availableWidth / numCols);

  doc.moveDown(0.3);
  let startY = doc.y;

  // Se estiver muito perto do rodapé, avança página
  if (startY > doc.page.height - 70) {
    doc.addPage();
    setupPdfHeaderFooter(doc, "");
    startY = doc.y;
  }

  // Header da tabela
  doc.rect(margin, startY, availableWidth, 18).fillColor("#1E3E62").fill();
  let currentX = margin;
  headers.forEach((h, i) => {
    doc.fillColor("#FFFFFF").fontSize(8).font("Helvetica-Bold")
      .text(h, currentX + 6, startY + 5, { width: widths[i] - 12 });
    currentX += widths[i];
  });
  doc.y = startY + 18;

  // Linhas da tabela
  rowsData.forEach((row, rIdx) => {
    let rowY = doc.y;
    if (rowY > doc.page.height - 50) {
      doc.addPage();
      setupPdfHeaderFooter(doc, "");
      rowY = doc.y;
    }

    let maxCellHeight = 16;
    row.forEach((cell, i) => {
      const cellHeight = doc.heightOfString(String(cell || ""), { width: widths[i] - 12, fontSize: 8 });
      if (cellHeight + 8 > maxCellHeight) maxCellHeight = cellHeight + 8;
    });

    if (rIdx % 2 === 1) {
      doc.rect(margin, rowY, availableWidth, maxCellHeight).fillColor("#F9FAFB").fill();
    }
    doc.rect(margin, rowY, availableWidth, maxCellHeight).strokeColor("#E5E7EB").lineWidth(0.5).stroke();

    let cellX = margin;
    row.forEach((cell, i) => {
      doc.fillColor("#1F2937").fontSize(8).font("Helvetica")
        .text(String(cell || ""), cellX + 6, rowY + 4, { width: widths[i] - 12 });
      cellX += widths[i];
    });
    doc.y = rowY + maxCellHeight;
  });
  doc.moveDown(0.4);
}

// Documento 1: Briefing Consolidado (11 Blocos Oficiais) (PDF)
export async function gerarDocumentoBriefingPdf(sintese) {
  return new Promise((resolve, reject) => {
    try {
      const b = sintese.briefingConsolidado;
      const b1 = b.bloco01_resumoEstrategia || {};
      const b2 = b.bloco02_publicoAlvo || {};
      const b3 = b.bloco03_canaisAquisicao || {};
      const b4 = b.bloco04_bancoDeDadosEAutomacao || {};
      const b5 = b.bloco05_servicoEmDestaque || {};
      const b6 = b.bloco06_mitosParaDerrubar || [];
      const b7 = b.bloco07_problemasQueResolve || [];
      const b8 = b.bloco08_pautaConteudo || {};
      const b9 = b.bloco09_depoimentosEComunicacaoLoja || {};
      const b10 = b.bloco10_proximosPassos || [];
      const b11 = b.bloco11_identidadeVisual || {};

      const doc = new PDFDocument({ margin: 40, size: "A4" });
      const buffers = [];
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => resolve(Buffer.concat(buffers)));

      setupPdfHeaderFooter(doc, b.titulo);
      renderPdfTitleBlock(doc, b.titulo, `Documento Oficial de Alinhamento Estratégico (11 Blocos) · ${b.clienteNome}`);
      renderPdfCallout(doc, "Ficha Cadastral Oficial", `Cliente: ${b.clienteNome} | Responsável: ${b.responsavel} | Data: ${b.dataBriefing} | CNPJ: ${b.cnpj || "A confirmar"}`);

      // 01. Resumo da Estratégia
      renderPdfSection(doc, "01. Resumo da Estratégia");
      renderPdfParagraph(doc, b1.ideiaCentral || b.posicionamento, "Ideia Central:");
      renderPdfParagraph(doc, (b1.pilaresRapidos || []).join(" • "), "4 Pilares Rápidos:");
      if (b1.tabelaComparativa?.length > 0) {
        doc.moveDown(0.2);
        renderPdfParagraph(doc, "Comparativo com o Mercado e Concorrência:", "Tabela Comparativa:");
        renderPdfTable(
          doc,
          ["Ponto de Comparação", b.clienteNome, "Concorrência"],
          b1.tabelaComparativa.map((t) => [t.pontoComparacao, t.cliente, t.concorrencia]),
          [140, 185, 185]
        );
      }
      renderPdfCallout(doc, "Mensagem Principal da Marca", b1.mensagemPrincipal || b.propostaDeValor);

      // 02. Público-Alvo
      renderPdfSection(doc, "02. Público-Alvo");
      renderPdfParagraph(
        doc,
        `${b2.publicoPrincipal?.faixaEtaria || "28 a 55 anos"} | ${b2.publicoPrincipal?.classes || "Classes A e B"}\n${b2.publicoPrincipal?.perfil || b.publicoAlvo}\n${b2.publicoPrincipal?.descricao || ""}`,
        "Público Principal:"
      );
      renderPdfParagraph(doc, "Segmentos complementares de compra:", "Públicos de Apoio:");
      (b2.publicosDeApoio || []).forEach((pa) => renderPdfParagraph(doc, pa, "•"));

      // 03. Canais de Aquisição
      renderPdfSection(doc, "03. Canais de Aquisição");
      renderPdfParagraph(doc, b3.baseAtualVexo || "Reativação e régua no Vexo OS", "1. Base Atual VEXO:");
      renderPdfParagraph(doc, b3.indicacoes || "Member-get-member estruturado", "2. Indicações:");
      renderPdfParagraph(doc, b3.redeVp || "Alavancagem de parcerias da rede", "3. Rede VP (Via Permuta / Parceiros):");
      renderPdfParagraph(doc, b3.balcaoDaLoja || "Displays e QR Code de balcão", "4. Balcão da Loja / Ponto Físico:");
      renderPdfParagraph(doc, b3.instagramOrganico || "Linha editorial de Reels e Carrosséis", "5. Instagram Orgânico:");
      renderPdfParagraph(doc, b3.googleAds || "Campanhas de busca de alta intenção", "6. Google Ads:");

      // 04. Banco de Dados e Automação (VEXO)
      renderPdfSection(doc, "04. Banco de Dados e Automação (VEXO)");
      renderPdfParagraph(doc, b4.totalContatos || "Base total de contatos da empresa", "Volume da Base:");
      if (b4.etapasFluxo?.length > 0) {
        renderPdfTable(
          doc,
          ["Etapa", "Descrição", "Responsável", "Lado"],
          b4.etapasFluxo.map((e) => [e.etapa, e.descricao, e.responsavel, e.lado]),
          [130, 210, 90, 80]
        );
      }

      // 05. Serviço em Destaque
      renderPdfSection(doc, "05. Serviço em Destaque");
      renderPdfParagraph(doc, b5.carroChefe || b.visaoGeral, "Carro-Chefe:");
      renderPdfParagraph(doc, (b5.itensAceitos || []).join("; "), "✓ Peças / Serviços Aceitos:");
      renderPdfParagraph(doc, (b5.itensNaoAceitos || []).join("; "), "✗ Não Aceitos (Filtro de Entrada):");
      renderPdfParagraph(doc, b5.paletaCoresProduto || "Tons institucionais alinhados à marca", "Paleta de Cores do Produto:");

      // 06. Mitos para Derrubar
      renderPdfSection(doc, "06. Mitos para Derrubar");
      if (b6.length > 0) {
        renderPdfTable(
          doc,
          ["Mito do Mercado", "A Verdade da Marca"],
          b6.map((m) => [m.mito, m.verdade]),
          [220, 290]
        );
      }

      // 07. Problemas que Resolve
      renderPdfSection(doc, "07. Problemas que Resolve (Dores para Antes e Depois)");
      b7.forEach((dor) => renderPdfParagraph(doc, dor, "⚠"));

      // 08. Pauta de Conteúdo
      renderPdfSection(doc, "08. Pauta de Conteúdo (Formatos & Objetivos)");
      renderPdfParagraph(doc, b8.conveniencia || "", "• Conveniência:");
      renderPdfParagraph(doc, b8.servico || "", "• Serviço (Técnico / Carro-Chefe):");
      renderPdfParagraph(doc, b8.prova || "", "• Prova Social & Casos de Sucesso:");
      renderPdfParagraph(doc, b8.educacao || "", "• Educação & Mitos:");
      renderPdfParagraph(doc, b8.nichos || "", "• Nichos Específicos:");
      renderPdfParagraph(doc, b8.empresas || "", "• Empresas & B2B:");

      // 09. Depoimentos e Comunicação na Loja
      renderPdfSection(doc, "09. Depoimentos e Comunicação na Loja");
      renderPdfParagraph(doc, b9.provaSocialParceiros || "", "Prova Social de Parceiros:");
      renderPdfParagraph(doc, b9.mostruarioBalcao || "", "Mostruário de Balcão:");
      renderPdfParagraph(doc, b9.qrCodeGoogleAvaliacoes || "", "QR Code Google Avaliações:");

      // 10. Próximos Passos
      renderPdfSection(doc, "10. Próximos Passos & Cronograma");
      if (b10.length > 0) {
        renderPdfTable(
          doc,
          ["Ação", "Responsável", "Lado"],
          b10.map((p) => [p.acao, p.responsavel, p.lado]),
          [270, 140, 100]
        );
      }

      // 11. Identidade Visual
      renderPdfSection(doc, "11. Identidade Visual & Diretrizes");
      renderPdfParagraph(
        doc,
        (b11.coresHex || []).map((c) => `${c.nome}: ${c.hex}`).join(" | "),
        "Cores Principais:"
      );
      renderPdfParagraph(
        doc,
        `Títulos: ${b11.tipografia?.titulos || "Montserrat"} | Corpo: ${b11.tipografia?.corpo || "Open Sans"}`,
        "Tipografia:"
      );
      (b11.diretrizesDesign || []).forEach((dir) => renderPdfParagraph(doc, dir, "•"));

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// Documento 2: Identidade Visual (PDF - Padrão Via Permuta Litoral Norte)
export async function gerarDocumentoIdentidadePdf(sintese) {
  return new Promise((resolve, reject) => {
    try {
      const iv = sintese.identidadeVisual;
      const pm = iv.personalidadeMarca || {};
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      const buffers = [];
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => resolve(Buffer.concat(buffers)));

      setupPdfHeaderFooter(doc, iv.titulo);
      renderPdfTitleBlock(doc, iv.titulo, `Manual de Identidade Visual e Diretrizes de Marca · ${iv.clienteNome}`);
      renderPdfCallout(doc, "A Regra de Ouro (Via Permuta Litoral Norte)", iv.regraDeOuro || "Uma peça. Uma dor. Uma virada. Uma chamada.");

      renderPdfSection(doc, "1. Conceito & Atmosfera Visual");
      renderPdfParagraph(doc, iv.conceito);

      renderPdfSection(doc, "2. Personalidade da Marca");
      renderPdfParagraph(doc, pm.aMarcaE || "Especialista, acolhedora, transparente e resolutiva.", "A Marca É:");
      renderPdfParagraph(doc, pm.masNuncaE || "Amadora, agressiva, prolixa ou com poluição visual.", "Mas NUNCA É:");
      renderPdfParagraph(doc, pm.naPratica || "Comunicação direta, alto contraste e fotos autênticas.", "Na Prática:");

      renderPdfSection(doc, "3. Formatos e Grids Recomendados");
      if (Array.isArray(iv.formatosEGrids)) {
        iv.formatosEGrids.forEach((f) => {
          renderPdfParagraph(doc, typeof f === "string" ? f : `${f.formato} — ${f.diretriz}`, "📐");
        });
      }

      renderPdfSection(doc, "4. Diretrizes de Foto & Vídeo (Pessoas Reais)");
      (iv.diretrizesFotoVideo || []).forEach((dfv) => renderPdfParagraph(doc, dfv, "📷"));

      renderPdfSection(doc, "5. Paleta de Cores Oficial");
      (iv.paletaCores || []).forEach((c) => {
        renderPdfParagraph(doc, `${c.hex} | ${c.rgb} — ${c.uso}`, `• ${c.nome}:`);
      });

      renderPdfSection(doc, "6. Tipografia & Hierarquia de Textos");
      renderPdfParagraph(doc, iv.tipografia?.titulos || "", "Títulos & Headings:");
      renderPdfParagraph(doc, iv.tipografia?.subtitulos || "", "Subtítulos & Chamadas:");
      renderPdfParagraph(doc, iv.tipografia?.corpo || "", "Corpo de Texto & Legendas:");

      renderPdfSection(doc, "7. Regras e Uso do Logotipo");
      (iv.diretrizesLogo || []).forEach((r) => renderPdfParagraph(doc, r, "⚠"));

      renderPdfSection(doc, "8. Elementos Gráficos & Estilo Visual");
      (iv.elementosGraficos || []).forEach((e) => renderPdfParagraph(doc, e, "•"));

      renderPdfSection(doc, "9. Benchmarks & Referências do Nicho");
      (iv.referenciasNicho || []).forEach((ref) => renderPdfParagraph(doc, ref, "★"));

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// Documento 3: Roteiros de Conteúdo (PDF)
export async function gerarDocumentoRoteirosPdf(sintese) {
  return new Promise((resolve, reject) => {
    try {
      const r = sintese.roteirosTrimestrais;
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      const buffers = [];
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => resolve(Buffer.concat(buffers)));

      setupPdfHeaderFooter(doc, r.titulo);
      renderPdfTitleBlock(doc, r.titulo, `Roteiros Estruturados para 3 Meses (12 Semanas) · ${r.clienteNome}`);
      renderPdfCallout(
        doc,
        "Volume Contratado",
        `Cota: ${r.resumoCota?.carrosseisPorSemana || 2} Carrosséis/sem, ${r.resumoCota?.videosPorSemana || 2} Vídeos/sem, ${r.resumoCota?.estaticosPorSemana || 1} Estáticos/sem. Total: ${r.resumoCota?.totalTrimestre || 60} conteúdos.`
      );

      renderPdfSection(doc, "Pilares Editoriais");
      (r.pilares || []).forEach((p) => {
        renderPdfParagraph(doc, `${p.foco} (Distribuição: ${p.peso})`, `• ${p.nome}:`);
      });

      (r.semanas || []).forEach((sem) => {
        renderPdfSection(doc, `${sem.temaCentral} (Mês ${sem.mes})`);
        (sem.conteudos || []).forEach((c) => {
          doc.moveDown(0.2);
          doc.font("Helvetica-Bold").fontSize(10).fillColor("#1E3E62").text(`[${c.codigo}] ${c.titulo}`);
          renderPdfParagraph(doc, `${c.formato} | Pilar: ${c.pilar}`, "Formato:");
          renderPdfParagraph(doc, c.gancho, "Gancho (0-3s):");
          renderPdfParagraph(doc, c.estrutura, "Estrutura:");
          renderPdfParagraph(doc, c.cta, "CTA:");
          renderPdfParagraph(doc, c.direcionamentoVisual, "Visual:");
        });
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// Documento 4: Planejamento Trimestral (PDF)
export async function gerarDocumentoPlanejamentoPdf(sintese) {
  return new Promise((resolve, reject) => {
    try {
      const p = sintese.planejamentoTrimestral;
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      const buffers = [];
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => resolve(Buffer.concat(buffers)));

      setupPdfHeaderFooter(doc, p.titulo);
      renderPdfTitleBlock(doc, p.titulo, `Resumo Executivo do Cronograma Trimestral · ${p.clienteNome}`);
      renderPdfCallout(doc, "Visão Executiva do Trimestre", p.resumoExecutivo);

      renderPdfSection(doc, "1. Evolução Mensal Estratégica (Roadmap 90 Dias)");
      (p.fases || []).forEach((f) => {
        doc.moveDown(0.2);
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#1E3E62").text(f.mes);
        renderPdfParagraph(doc, f.foco, "Foco Principal:");
        renderPdfParagraph(doc, (f.entregasChave || []).join("; "), "Entregas-Chave:");
        renderPdfParagraph(doc, f.kpisMeta, "Meta do Mês:");
      });

      renderPdfSection(doc, "2. Matriz Semanal de Publicações");
      (p.matrizSemanal || []).forEach((m) => {
        renderPdfParagraph(doc, `${m.formato} — ${m.objetivo}`, `• ${m.dia}:`);
      });

      renderPdfSection(doc, "3. Governança, Reuniões e Checkpoints");
      (p.governancaECheckpoints || []).forEach((chk) => {
        renderPdfParagraph(doc, chk.descricao, `[${chk.marco}]`);
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ─── Gerador de Todos os 8 Arquivos (DOCX + PDF) ───────────────────────────
export async function gerarTodosDocumentosBriefing(sintese) {
  const [
    briefingDocx,
    briefingPdf,
    identidadeDocx,
    identidadePdf,
    roteirosDocx,
    roteirosPdf,
    planejamentoDocx,
    planejamentoPdf,
  ] = await Promise.all([
    gerarDocumentoBriefingDocx(sintese),
    gerarDocumentoBriefingPdf(sintese),
    gerarDocumentoIdentidadeDocx(sintese),
    gerarDocumentoIdentidadePdf(sintese),
    gerarDocumentoRoteirosDocx(sintese),
    gerarDocumentoRoteirosPdf(sintese),
    gerarDocumentoPlanejamentoDocx(sintese),
    gerarDocumentoPlanejamentoPdf(sintese),
  ]);

  return {
    briefing: { docx: briefingDocx, pdf: briefingPdf },
    identidade: { docx: identidadeDocx, pdf: identidadePdf },
    roteiros: { docx: roteirosDocx, pdf: roteirosPdf },
    planejamento: { docx: planejamentoDocx, pdf: planejamentoPdf },
  };
}

// ─── Arquivamento no Google Drive ──────────────────────────────────────────
export async function arquivarDocumentosBriefingNoDrive({
  clienteNome,
  driveFolderId = null,
  driveFolderUrl = null,
  documentosBuffers,
  timestamp = null,
  driveUploader = uploadFileToDrive,
  allowMockFallback = true,
}) {
  const cleanName = (clienteNome || "Cliente").replace(/[^a-zA-Z0-9À-ÿ_-]/g, "_");
  const ts =
    timestamp ||
    new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/T/, "_")
      .slice(0, 15);

  let targetFolderId = driveFolderId;
  if (!targetFolderId && driveFolderUrl) {
    const match = driveFolderUrl.match(/folders\/([a-zA-Z0-9_-]+)/);
    if (match) targetFolderId = match[1];
  }

  const arquivosParaSubir = [
    {
      tipo: "briefing",
      formato: "docx",
      nome: `${cleanName}_01_Briefing_Consolidado_${ts}_vFinal.docx`,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: documentosBuffers.briefing.docx,
    },
    {
      tipo: "briefing",
      formato: "pdf",
      nome: `${cleanName}_01_Briefing_Consolidado_${ts}_vFinal.pdf`,
      mimeType: "application/pdf",
      buffer: documentosBuffers.briefing.pdf,
    },
    {
      tipo: "identidade",
      formato: "docx",
      nome: `${cleanName}_02_Identidade_Visual_${ts}_vFinal.docx`,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: documentosBuffers.identidade.docx,
    },
    {
      tipo: "identidade",
      formato: "pdf",
      nome: `${cleanName}_02_Identidade_Visual_${ts}_vFinal.pdf`,
      mimeType: "application/pdf",
      buffer: documentosBuffers.identidade.pdf,
    },
    {
      tipo: "roteiros",
      formato: "docx",
      nome: `${cleanName}_03_Roteiros_3Meses_${ts}_vFinal.docx`,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: documentosBuffers.roteiros.docx,
    },
    {
      tipo: "roteiros",
      formato: "pdf",
      nome: `${cleanName}_03_Roteiros_3Meses_${ts}_vFinal.pdf`,
      mimeType: "application/pdf",
      buffer: documentosBuffers.roteiros.pdf,
    },
    {
      tipo: "planejamento",
      formato: "docx",
      nome: `${cleanName}_04_Planejamento_Trimestral_${ts}_vFinal.docx`,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: documentosBuffers.planejamento.docx,
    },
    {
      tipo: "planejamento",
      formato: "pdf",
      nome: `${cleanName}_04_Planejamento_Trimestral_${ts}_vFinal.pdf`,
      mimeType: "application/pdf",
      buffer: documentosBuffers.planejamento.pdf,
    },
  ];

  const uploadResults = {};

  for (const item of arquivosParaSubir) {
    try {
      const res = await driveUploader({
        fileName: item.nome,
        mimeType: item.mimeType,
        fileBuffer: item.buffer,
        folderId: targetFolderId,
        allowMockFallback,
      });

      const fileId =
        res?.fileId ||
        `gd_safe_${crypto.createHash("sha256").update(item.buffer).digest("hex").slice(0, 24)}`;
      const fileName = res?.fileName || item.nome;
      const fileLink =
        res?.fileLink ||
        `https://drive.google.com/file/d/${fileId}/view`;

      if (!uploadResults[item.tipo]) uploadResults[item.tipo] = {};
      uploadResults[item.tipo][item.formato] = {
        fileId,
        fileName,
        fileLink,
        isMock: res?.isMock ?? false,
      };
    } catch (err) {
      console.warn(`[gdBriefingSynthesizer] Falha ao fazer upload de ${item.nome} no Google Drive:`, err.message);
      const hash = crypto.createHash("sha256").update(item.buffer).digest("hex").slice(0, 24);
      const fallbackFileId = `gd_contingencia_${hash}`;
      const fallbackLink = `https://drive.google.com/file/d/${fallbackFileId}/view`;

      if (!uploadResults[item.tipo]) uploadResults[item.tipo] = {};
      uploadResults[item.tipo][item.formato] = {
        fileId: fallbackFileId,
        fileName: item.nome,
        fileLink: fallbackLink,
        isMock: true,
        contingencia: true,
        aviso: err.message,
      };
    }
  }

  return {
    geradoEm: new Date().toISOString(),
    versao: `${ts}_vFinal`,
    folderId: targetFolderId,
    documentos: uploadResults,
  };
}

// ─── Orquestrador Completo de Síntese & Geração ─────────────────────────────
export async function executarSinteseEGeracaoBriefing({
  clienteId,
  pool,
  transcricao = null,
  respostasFormulario = null,
  contrato = null,
  templateGd = null,
  model = "gemini-flash-latest",
  apiKey = null,
  driveUploader = uploadFileToDrive,
  llmCaller = null,
  actor = { id: "sistema", tipo: "sistema" },
}) {
  if (!clienteId || !pool) {
    throw new Error("clienteId e pool são obrigatórios para executar a síntese.");
  }

  const { rows } = await pool.query(
    `SELECT * FROM public.gd_clientes WHERE id = $1 AND (dono_client_id = $2 OR dono_client_id = '00000000-0000-0000-0000-000000000000' OR dono_client_id IS NULL)`,
    [clienteId, GD_DONO]
  );

  if (rows.length === 0) {
    throw new Error("Cliente não encontrado.");
  }

  const cliente = rows[0];

  const effectiveTranscricao = transcricao || cliente.briefing_transcricao || "";
  const effectiveFormulario = respostasFormulario || cliente.briefing_formulario_respostas || {};

  // 1. Síntese com Gemini
  const sintese = await sintetizarBriefingComGemini({
    cliente,
    transcricao: effectiveTranscricao,
    respostasFormulario: effectiveFormulario,
    contrato,
    templateGd,
    model,
    apiKey,
    llmCaller,
  });

  // 2. Geração dos 8 arquivos DOCX e PDF
  const buffers = await gerarTodosDocumentosBriefing(sintese);

  // 3. Arquivamento Seguro no Google Drive com contingência resiliente
  let driveFolderUrl = cliente.drive_url || null;
  let targetFolderId = null;

  if (driveFolderUrl) {
    const match = driveFolderUrl.match(/folders\/([a-zA-Z0-9_-]+)/);
    if (match) targetFolderId = match[1];
  } else {
    try {
      console.info(`[gdBriefingSynthesizer] Provisionando pastas no Google Drive para "${cliente.nome}"...`);
      const driveSetup = await setupClientDriveFolders({
        clientName: cliente.nome,
        makePublic: true,
        allowMockFallback: true,
      });
      if (driveSetup?.driveLink) {
        driveFolderUrl = driveSetup.driveLink;
        targetFolderId = driveSetup.subfolders?.relatorios?.id || driveSetup.drive_folder_id;
        await pool.query(
          `UPDATE public.gd_clientes SET drive_url = $1 WHERE id = $2 AND (dono_client_id = $3 OR dono_client_id = '00000000-0000-0000-0000-000000000000' OR dono_client_id IS NULL)`,
          [driveFolderUrl, clienteId, GD_DONO]
        );
      }
    } catch (driveSetupErr) {
      console.warn(`[gdBriefingSynthesizer] Aviso ao auto-provisionar pastas no Drive para ${cliente.nome}:`, driveSetupErr.message);
    }
  }

  let driveResult;
  try {
    driveResult = await arquivarDocumentosBriefingNoDrive({
      clienteNome: cliente.nome,
      driveFolderUrl,
      driveFolderId: targetFolderId,
      documentosBuffers: buffers,
      driveUploader,
      allowMockFallback: true,
    });
  } catch (driveErr) {
    console.warn("[gdBriefingSynthesizer] Erro geral ao arquivar documentos no Google Drive:", driveErr.message);
    const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/T/, "_").slice(0, 15);
    const buildFallback = (tipo, formato, nome) => {
      const hash = crypto.createHash("sha256").update(buffers?.[tipo]?.[formato] || tipo).digest("hex").slice(0, 24);
      const fileId = `gd_contingencia_${hash}`;
      return {
        fileId,
        fileName: nome,
        fileLink: `https://drive.google.com/file/d/${fileId}/view`,
        isMock: true,
        contingencia: true,
      };
    };
    driveResult = {
      geradoEm: new Date().toISOString(),
      versao: `${ts}_vFinal`,
      folderId: targetFolderId || null,
      documentos: {
        briefing: {
          docx: buildFallback("briefing", "docx", `${cliente.nome}_01_Briefing_Consolidado_${ts}_vFinal.docx`),
          pdf: buildFallback("briefing", "pdf", `${cliente.nome}_01_Briefing_Consolidado_${ts}_vFinal.pdf`),
        },
        identidade: {
          docx: buildFallback("identidade", "docx", `${cliente.nome}_02_Identidade_Visual_${ts}_vFinal.docx`),
          pdf: buildFallback("identidade", "pdf", `${cliente.nome}_02_Identidade_Visual_${ts}_vFinal.pdf`),
        },
        roteiros: {
          docx: buildFallback("roteiros", "docx", `${cliente.nome}_03_Roteiros_3Meses_${ts}_vFinal.docx`),
          pdf: buildFallback("roteiros", "pdf", `${cliente.nome}_03_Roteiros_3Meses_${ts}_vFinal.pdf`),
        },
        planejamento: {
          docx: buildFallback("planejamento", "docx", `${cliente.nome}_04_Planejamento_Trimestral_${ts}_vFinal.docx`),
          pdf: buildFallback("planejamento", "pdf", `${cliente.nome}_04_Planejamento_Trimestral_${ts}_vFinal.pdf`),
        },
      },
    };
  }

  const docsFormatados = {};
  for (const [k, v] of Object.entries(driveResult.documentos || {})) {
    docsFormatados[k] = {
      nome: k,
      pdfUrl: v?.pdf?.fileLink || null,
      docxUrl: v?.docx?.fileLink || null,
      driveFileIdPdf: v?.pdf?.fileId || null,
      driveFileIdDocx: v?.docx?.fileId || null,
      versao: driveResult.versao,
      sintetizadoEm: driveResult.geradoEm,
      docx: v?.docx,
      pdf: v?.pdf,
    };
  }

  const briefingDocsMetadata = {
    ...driveResult,
    ...docsFormatados,
    documentos: driveResult.documentos,
    sintese,
  };

  // 4. Grava no banco e atualiza estado se estava em BRIEFING_AGENDADO
  await pool.query(
    `UPDATE public.gd_clientes
        SET briefing_documentos = $1::jsonb,
            briefing_transcricao = COALESCE($2, briefing_transcricao),
            briefing_formulario_respostas = COALESCE($3::jsonb, briefing_formulario_respostas),
            briefing_aprovacao_interna_status = 'PENDENTE'
      WHERE id = $4 AND (dono_client_id = $5 OR dono_client_id = '00000000-0000-0000-0000-000000000000' OR dono_client_id IS NULL)`,
    [
      JSON.stringify(briefingDocsMetadata),
      effectiveTranscricao || null,
      effectiveFormulario ? JSON.stringify(effectiveFormulario) : null,
      clienteId,
      GD_DONO,
    ]
  );

  // Registra evento de transição de estado se ainda estava em agendado
  if (cliente.estado_atual === "BRIEFING_AGENDADO") {
    try {
      await pool.query(
        `SELECT public.gd_registrar_evento($1, 'BRIEFING_REALIZADO', now(), false, 'fluxo', $2, $3, $4, $5::jsonb)`,
        [
          clienteId,
          actor.tipo || "sistema",
          actor.id || "sistema",
          "Reunião de Briefing realizada. Síntese dos 4 documentos gerada com sucesso pelo Gemini.",
          JSON.stringify({
            documentos: driveResult.documentos,
            versao: driveResult.versao,
          }),
        ]
      );
    } catch (e) {
      console.warn("[gdBriefingSynthesizer] Aviso ao registrar evento BRIEFING_REALIZADO:", e.message);
    }
  }

  const { rows: updatedRows } = await pool.query(
    `SELECT * FROM public.gd_clientes WHERE id = $1`,
    [clienteId]
  );

  return {
    success: true,
    clienteId,
    versao: driveResult.versao,
    documentos: driveResult.documentos,
    sintese,
    cliente: updatedRows[0],
  };
}
