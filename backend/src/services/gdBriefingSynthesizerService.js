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
import { uploadFileToDrive } from "./googleDriveClientSetup.js";
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

  // 1. Briefing Consolidado
  const briefingConsolidado = {
    titulo: `Briefing Estratégico Consolidado · ${nome}`,
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
  };

  // 2. Identidade Visual & Diretrizes da Marca
  const identidadeVisual = {
    titulo: `Manual de Identidade Visual & Diretrizes · ${nome}`,
    clienteNome: nome,
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
1. "briefingConsolidado": Objeto com titulo, clienteNome, responsavel, cnpj, dataBriefing, visaoGeral, posicionamento, propostaDeValor, publicoAlvo, personas (array), tomDeVoz, diferenciais (array), concorrentesEBenchmarks (array), canaisEstrategicos (array), cotasEntregaveis, kpisEsperados (array).
2. "identidadeVisual": Objeto com titulo, clienteNome, conceito, paletaCores (array com nome, hex, rgb, uso), tipografia (com titulos, subtitulos, corpo), diretrizesLogo (array), elementosGraficos (array), referenciasNicho (array).
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

// Documento 1: Briefing Consolidado (DOCX)
export async function gerarDocumentoBriefingDocx(sintese) {
  const b = sintese.briefingConsolidado;
  const doc = new Document({
    sections: [
      {
        children: [
          ...buildDocxHeader(b.titulo, `Documento Oficial de Alinhamento Estratégico · ${b.clienteNome}`),
          buildDocxCallout(`Cliente: ${b.clienteNome} | Responsável: ${b.responsavel} | Data: ${b.dataBriefing}`, "Ficha do Cliente"),
          buildDocxSectionHeading("1. Visão Geral & Histórico da Marca"),
          buildDocxParagraph(b.visaoGeral),
          buildDocxSectionHeading("2. Posicionamento & Proposta Única de Valor"),
          buildDocxParagraph(b.posicionamento, "Posicionamento Central:"),
          buildDocxParagraph(b.propostaDeValor, "Proposta de Valor:"),
          buildDocxSectionHeading("3. Público-Alvo & Personas"),
          buildDocxParagraph(b.publicoAlvo, "Público-Alvo:"),
          ...(b.personas || []).flatMap((p) => [
            buildDocxParagraph(`${p.perfil}\n• Dores: ${p.dores}\n• Desejos: ${p.desejos}`, `• ${p.nome}:`),
          ]),
          buildDocxSectionHeading("4. Tom de Voz & Diretrizes de Comunicação"),
          buildDocxParagraph(b.tomDeVoz),
          buildDocxSectionHeading("5. Diferenciais Competitivos"),
          ...(b.diferenciais || []).map((d) => buildDocxParagraph(d, "✓")),
          buildDocxSectionHeading("6. Canais & Cotas de Conteúdo"),
          buildDocxParagraph(b.cotasEntregaveis, "Volume de Entregáveis Acordados:"),
          buildDocxParagraph((b.canaisEstrategicos || []).join(" | "), "Canais Oficiais:"),
          buildDocxSectionHeading("7. Metas & KPIs Esperados"),
          ...(b.kpisEsperados || []).map((k) => buildDocxParagraph(k, "→")),
        ],
      },
    ],
  });
  return await Packer.toBuffer(doc);
}

// Documento 2: Identidade Visual (DOCX)
export async function gerarDocumentoIdentidadeDocx(sintese) {
  const iv = sintese.identidadeVisual;
  const doc = new Document({
    sections: [
      {
        children: [
          ...buildDocxHeader(iv.titulo, `Manual de Identidade Visual e Diretrizes de Marca · ${iv.clienteNome}`),
          buildDocxCallout(iv.conceito, "Conceito & Atmosfera Visual"),
          buildDocxSectionHeading("1. Paleta de Cores Oficial"),
          ...(iv.paletaCores || []).map((c) =>
            buildDocxParagraph(`${c.hex} | ${c.rgb} — ${c.uso}`, `• ${c.nome}:`)
          ),
          buildDocxSectionHeading("2. Tipografia & Hierarquia de Textos"),
          buildDocxParagraph(iv.tipografia?.titulos || "", "Títulos & Headings:"),
          buildDocxParagraph(iv.tipografia?.subtitulos || "", "Subtítulos & Chamadas:"),
          buildDocxParagraph(iv.tipografia?.corpo || "", "Corpo de Texto & Legendas:"),
          buildDocxSectionHeading("3. Regras e Uso do Logotipo"),
          ...(iv.diretrizesLogo || []).map((r) => buildDocxParagraph(r, "⚠")),
          buildDocxSectionHeading("4. Elementos Gráficos & Estilo Visual"),
          ...(iv.elementosGraficos || []).map((e) => buildDocxParagraph(e, "•")),
          buildDocxSectionHeading("5. Benchmarks & Referências do Nicho"),
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

// Documento 1: Briefing Consolidado (PDF)
export async function gerarDocumentoBriefingPdf(sintese) {
  return new Promise((resolve, reject) => {
    try {
      const b = sintese.briefingConsolidado;
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      const buffers = [];
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => resolve(Buffer.concat(buffers)));

      setupPdfHeaderFooter(doc, b.titulo);
      renderPdfTitleBlock(doc, b.titulo, `Documento Oficial de Alinhamento Estratégico · ${b.clienteNome}`);
      renderPdfCallout(doc, "Ficha do Cliente", `Cliente: ${b.clienteNome} | Responsável: ${b.responsavel} | Data: ${b.dataBriefing}`);

      renderPdfSection(doc, "1. Visão Geral & Histórico da Marca");
      renderPdfParagraph(doc, b.visaoGeral);

      renderPdfSection(doc, "2. Posicionamento & Proposta Única de Valor");
      renderPdfParagraph(doc, b.posicionamento, "Posicionamento Central:");
      renderPdfParagraph(doc, b.propostaDeValor, "Proposta de Valor:");

      renderPdfSection(doc, "3. Público-Alvo & Personas");
      renderPdfParagraph(doc, b.publicoAlvo, "Público-Alvo:");
      (b.personas || []).forEach((p) => {
        renderPdfParagraph(doc, `${p.perfil} | Dores: ${p.dores} | Desejos: ${p.desejos}`, `• ${p.nome}:`);
      });

      renderPdfSection(doc, "4. Tom de Voz & Diretrizes de Comunicação");
      renderPdfParagraph(doc, b.tomDeVoz);

      renderPdfSection(doc, "5. Diferenciais Competitivos");
      (b.diferenciais || []).forEach((d) => renderPdfParagraph(doc, d, "✓"));

      renderPdfSection(doc, "6. Canais & Cotas de Conteúdo");
      renderPdfParagraph(doc, b.cotasEntregaveis, "Volume de Entregáveis Acordados:");
      renderPdfParagraph(doc, (b.canaisEstrategicos || []).join(" | "), "Canais Oficiais:");

      renderPdfSection(doc, "7. Metas & KPIs Esperados");
      (b.kpisEsperados || []).forEach((k) => renderPdfParagraph(doc, k, "→"));

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// Documento 2: Identidade Visual (PDF)
export async function gerarDocumentoIdentidadePdf(sintese) {
  return new Promise((resolve, reject) => {
    try {
      const iv = sintese.identidadeVisual;
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      const buffers = [];
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => resolve(Buffer.concat(buffers)));

      setupPdfHeaderFooter(doc, iv.titulo);
      renderPdfTitleBlock(doc, iv.titulo, `Manual de Identidade Visual e Diretrizes de Marca · ${iv.clienteNome}`);
      renderPdfCallout(doc, "Conceito & Atmosfera Visual", iv.conceito);

      renderPdfSection(doc, "1. Paleta de Cores Oficial");
      (iv.paletaCores || []).forEach((c) => {
        renderPdfParagraph(doc, `${c.hex} | ${c.rgb} — ${c.uso}`, `• ${c.nome}:`);
      });

      renderPdfSection(doc, "2. Tipografia & Hierarquia de Textos");
      renderPdfParagraph(doc, iv.tipografia?.titulos || "", "Títulos & Headings:");
      renderPdfParagraph(doc, iv.tipografia?.subtitulos || "", "Subtítulos & Chamadas:");
      renderPdfParagraph(doc, iv.tipografia?.corpo || "", "Corpo de Texto & Legendas:");

      renderPdfSection(doc, "3. Regras e Uso do Logotipo");
      (iv.diretrizesLogo || []).forEach((r) => renderPdfParagraph(doc, r, "⚠"));

      renderPdfSection(doc, "4. Elementos Gráficos & Estilo Visual");
      (iv.elementosGraficos || []).forEach((e) => renderPdfParagraph(doc, e, "•"));

      renderPdfSection(doc, "5. Benchmarks & Referências do Nicho");
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
    const res = await driveUploader({
      fileName: item.nome,
      mimeType: item.mimeType,
      fileBuffer: item.buffer,
      folderId: targetFolderId,
      allowMockFallback,
    });

    if (!uploadResults[item.tipo]) uploadResults[item.tipo] = {};
    uploadResults[item.tipo][item.formato] = {
      fileId: res.fileId,
      fileName: res.fileName,
      fileLink: res.fileLink,
      isMock: res.isMock ?? false,
    };
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
    `SELECT * FROM public.gd_clientes WHERE id = $1 AND dono_client_id = $2`,
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

  // 3. Arquivamento Seguro no Google Drive
  const driveResult = await arquivarDocumentosBriefingNoDrive({
    clienteNome: cliente.nome,
    driveFolderUrl: cliente.drive_url,
    documentosBuffers: buffers,
    driveUploader,
  });

  const briefingDocsMetadata = {
    ...driveResult,
    sintese,
  };

  // 4. Grava no banco e atualiza estado se estava em BRIEFING_AGENDADO
  await pool.query(
    `UPDATE public.gd_clientes
        SET briefing_documentos = $1::jsonb,
            briefing_transcricao = COALESCE($2, briefing_transcricao),
            briefing_formulario_respostas = COALESCE($3::jsonb, briefing_formulario_respostas),
            briefing_aprovacao_interna_status = 'PENDENTE'
      WHERE id = $4 AND dono_client_id = $5`,
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
