import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";

export type DeliverableStatus =
  | "publicado"
  | "em_producao"
  | "aguardando_aprovacao"
  | "roteiro_pronto"
  | "ajuste_solicitado";

export type FunnelStageId = "atrair" | "apresentar" | "provar" | "converter";

export interface FunnelStage {
  id: FunnelStageId;
  number: string;
  name: string;
  subtitle: string;
  totalVideos: number;
  completedVideos: number;
}

export interface DeliverableItem {
  id: string;
  code: string;
  title: string;
  stage: FunnelStageId;
  date: string;
  dayOfWeek: string;
  format: string;
  channel: string;
  status: DeliverableStatus;
  hook: string;
  script: string;
  cta: string;
  technicalNotes?: string;
  videoUrl?: string;
  feedback?: string;
}

export interface ClientPortalData {
  slug: string;
  companyName: string;
  logoUrl?: string;
  tagline: string;
  partnershipBadge: string;
  period: string;
  commercialGoal: string;
  whatsappSupportNumber: string;
  trafficStatus: {
    status: string;
    budget: string;
    activeCampaigns: number;
  };
  weeklyPacing: {
    delivered: number;
    target: number;
  };
  funnelStages: FunnelStage[];
  deliverables: DeliverableItem[];
}

export const VOX2YOU_DEFAULT_DATA: ClientPortalData = {
  slug: "vox2you",
  companyName: "Vox2you Uberlândia Lídice",
  tagline: "Comunicação não é dom. É habilidade.",
  partnershipBadge: "Assessoria Estratégica: Geração Digital + Vexo OS",
  period: "21/10 a 30/11",
  commercialGoal: "Matrículas Turma Teens & Formação Oratória",
  whatsappSupportNumber: "5534991751267",
  trafficStatus: {
    status: "Campanhas Ativas no Meta & Google",
    budget: "R$ 2.400 / mês",
    activeCampaigns: 3,
  },
  weeklyPacing: {
    delivered: 3,
    target: 4,
  },
  funnelStages: [
    {
      id: "atrair",
      number: "01",
      name: "Atrair",
      subtitle: "Oratória se treina · Quebra de mitos",
      totalVideos: 6,
      completedVideos: 3,
    },
    {
      id: "apresentar",
      number: "02",
      name: "Apresentar",
      subtitle: "Conheça o curso e dinâmica de sala",
      totalVideos: 6,
      completedVideos: 0,
    },
    {
      id: "provar",
      number: "03",
      name: "Provar",
      subtitle: "Evolução dos alunos e cases reais",
      totalVideos: 5,
      completedVideos: 0,
    },
    {
      id: "converter",
      number: "04",
      name: "Converter",
      subtitle: "Matrículas Teens e aulas experimentais",
      totalVideos: 4,
      completedVideos: 0,
    },
  ],
  deliverables: [
    // 01. ATRAIR (6 vídeos)
    {
      id: "vox-v01",
      code: "V01",
      title: "Perguntas que Prendem a Plateia nos Primeiros 5 Segundos",
      stage: "atrair",
      date: "23/10",
      dayOfWeek: "Quarta-feira",
      format: "Vídeo Reels (9:16)",
      channel: "Instagram Reels & TikTok",
      status: "publicado",
      hook: "Você começa uma apresentação com 'Boa tarde a todos'? Pare agora mesmo.",
      script:
        "Se você começa suas reuniões ou apresentações com frases mornas como 'boa tarde, obrigado pela presença', você já perdeu 80% do interesse do público. Em vez disso, faça uma pergunta provocativa ou conte um fato contraintuitivo. Na Vox2you, ensinamos que os primeiros 5 segundos determinam se você será ouvido ou ignorado.",
      cta: "Salve este vídeo e use essa técnica na sua próxima reunião.",
      technicalNotes: "Câmera estável, iluminação frontal quente, corte dinâmico a cada frase.",
      videoUrl: "https://assets.mixkit.co/videos/preview/mixkit-man-holding-a-speech-in-front-of-an-audience-40292-large.mp4",
    },
    {
      id: "vox-v02",
      code: "V02",
      title: "O Medo de Falar em Público é Biológico (E Tem Cura)",
      stage: "atrair",
      date: "25/10",
      dayOfWeek: "Sexta-feira",
      format: "Storytelling Reels",
      channel: "Instagram Reels",
      status: "publicado",
      hook: "Suor frio, coração acelerado e boca seca. Por que seu corpo reage assim no palco?",
      script:
        "O cérebro primitivo enxerga dezenas de olhares fixos como uma ameaça de predador. Sentir medo diante de pessoas não é fraqueza, é instinto biológico. A boa notícia? Esse reflexo pode ser reprogramado através de técnicas práticas de respiração e postura.",
      cta: "Comente 'ORATÓRIA' para receber nosso guia rápido de respiração diafragmática.",
      technicalNotes: "Música de fundo sutil, tom explicativo e acolhedor.",
    },
    {
      id: "vox-v03",
      code: "V03",
      title: "3 Vícios de Linguagem que Destroem sua Autoridade",
      stage: "atrair",
      date: "28/10",
      dayOfWeek: "Segunda-feira",
      format: "Carrossel & Reels",
      channel: "Instagram & Meta Ads",
      status: "publicado",
      hook: "Você fala 'né', 'tipo assim' ou 'tá entendendo' o tempo todo?",
      script:
        "Vícios de linguagem são como ruído em rádio sintonizado: desviam o foco da sua ideia e passam insegurança. O segredo para eliminá-los não é tentar falar rápido, mas aprender a abraçar a pausa de 1 segundo entre as frases.",
      cta: "Marque aquele amigo que fala 'né' a cada 3 palavras.",
      technicalNotes: "Texto dinâmico animado na tela com legendas destacadas.",
    },
    {
      id: "vox-v04",
      code: "V04",
      title: "Gaguejou ou Deu Branco? O que Fazer Imediatamente",
      stage: "atrair",
      date: "30/10",
      dayOfWeek: "Quarta-feira",
      format: "Vídeo Reels (9:16)",
      channel: "Instagram & TikTok",
      status: "em_producao",
      hook: "Deu branco total no meio da apresentação. E agora?",
      script:
        "O maior erro ao dar um branco é pedir desculpas. A plateia não sabe o que você ia falar! Respire fundo, tome um gole de água ou reformule a última frase. Na Vox2you, você treina cenários imprevistos para nunca mais travar.",
      cta: "Gostou da dica? Compartilhe com quem tem apresentação marcada para esta semana.",
      technicalNotes: "Enquadramento plano médio, demonstração corporal prática do gole de água.",
    },
    {
      id: "vox-v05",
      code: "V05",
      title: "Como Fazer um Pitch de 60 Segundos Irresistível",
      stage: "atrair",
      date: "01/11",
      dayOfWeek: "Sexta-feira",
      format: "Vídeo Reels com Motion",
      channel: "Instagram Reels & Anúncios",
      status: "aguardando_aprovacao",
      hook: "Se você tivesse apenas 1 minuto no elevador com seu maior cliente, o que diria?",
      script:
        "A estrutura perfeita de um Pitch de Elevador: 1. A Dor que seu cliente sente. 2. A Solução única que você entrega. 3. O Resultado mensurável. 4. A Chamada direta. Sem enrolação, sem jargões. Na Vox2you Lídice, nossos alunos saem dominando essa fórmula na ponta da língua.",
      cta: "Toque no link da bio para agendar sua aula experimental gratuita na unidade Lídice.",
      technicalNotes: "Vídeo já editado com legendas dinâmicas, vinheta Vox2you e correção de cor.",
      videoUrl: "https://assets.mixkit.co/videos/preview/mixkit-young-businessman-explaining-a-project-in-an-office-42512-large.mp4",
    },
    {
      id: "vox-v06",
      code: "V06",
      title: "A Regra dos 7 Segundos para Manter a Atenção da Plateia",
      stage: "atrair",
      date: "04/11",
      dayOfWeek: "Segunda-feira",
      format: "Vídeo Reels (9:16)",
      channel: "Instagram Reels",
      status: "em_producao",
      hook: "As pessoas decidem se vão te ouvir ou pegar o celular nos primeiros 7 segundos.",
      script:
        "Variação tonal, contato visual em triângulo e movimentação intencional no palco. Descubra os 3 gatilhos que impedem a dispersão da sala de aula ou da reunião comercial.",
      cta: "Quer dominar essas técnicas na prática? Conheça a Vox2you Lídice.",
      technicalNotes: "Corte rápido com transição de zoom nos pontos-chave.",
    },

    // 02. APRESENTAR (6 vídeos)
    {
      id: "vox-v07",
      code: "V07",
      title: "Por Dentro da Sala de Aula Vox2you Uberlândia Lídice",
      stage: "apresentar",
      date: "06/11",
      dayOfWeek: "Quarta-feira",
      format: "Tour Dinâmico Reels",
      channel: "Instagram & TikTok",
      status: "em_producao",
      hook: "Uma escola de oratória onde você não senta para ouvir palestras chatas.",
      script:
        "Aqui na unidade Lídice, 80% do tempo de aula é prática pura no palco. Salas acústicas, câmeras para gravação do seu progresso e feedback individual a cada aula. Venha tomar um café conosco e conhecer nossa estrutura.",
      cta: "Envie uma mensagem no direct e venha conhecer a unidade Lídice nesta semana.",
      technicalNotes: "B-roll caprichado da fachada, salas de aula e auditório da unidade Lídice.",
    },
    {
      id: "vox-v08",
      code: "V08",
      title: "A Dinâmica do Espelho: Como Destravar a Expressão Facial",
      stage: "apresentar",
      date: "08/11",
      dayOfWeek: "Sexta-feira",
      format: "Demonstração Prática",
      channel: "Instagram Reels",
      status: "roteiro_pronto",
      hook: "O que o seu rosto transmite quando você está sob pressão?",
      script:
        "Mais de 55% da comunicação é não-verbal. Veja como essa dinâmica exclusiva do curso destrava sorrisos congelados e olhares inseguros.",
      cta: "Comente 'METODOLOGIA' para receber a grade de disciplinas do curso.",
      technicalNotes: "Gravação em sala de dinâmica com instrutor Vox2you.",
    },
    {
      id: "vox-v09",
      code: "V09",
      title: "Oratória não é Dom: É Ciência e Repetição Guiada",
      stage: "apresentar",
      date: "11/11",
      dayOfWeek: "Segunda-feira",
      format: "Vídeo Institucional",
      channel: "Instagram & YouTube Shorts",
      status: "roteiro_pronto",
      hook: "Você ainda acredita no mito de que quem fala bem 'já nasceu com esse dom'?",
      script:
        "Nenhum grande orador nasceu pronto. Todos treinaram técnicas de modulação de voz, respiração e conexão emocional. A Vox2you já transformou mais de 30 mil vidas no Brasil com esse método.",
      cta: "Sua habilidade de comunicação define o tamanho do seu sucesso. Conheça a Vox2you.",
      technicalNotes: "Depoimento de professor com tom inspirador e confiante.",
    },
    {
      id: "vox-v10",
      code: "V10",
      title: "Turma Teens: Como Nossos Jovens Vencem a Timidez na Escola",
      stage: "apresentar",
      date: "13/11",
      dayOfWeek: "Quarta-feira",
      format: "Vídeo Focado em Pais",
      channel: "Instagram & Anúncios Meta",
      status: "roteiro_pronto",
      hook: "Seu filho trava na hora de apresentar seminários na escola?",
      script:
        "A timidez na adolescência prejudica notas, amizades e a autoconfiança para vestibulares e entrevistas. A Turma Teens da Vox2you Lídice prepara seu filho para liderar e falar com segurança em qualquer ambiente.",
      cta: "Toque no link abaixo e garanta uma avaliação de comunicação gratuita para seu filho.",
      technicalNotes: "Linguagem voltada para pais de adolescentes de 12 a 17 anos.",
    },
    {
      id: "vox-v11",
      code: "V11",
      title: "Conheça Nossos Mentores e a Metodologia Prática",
      stage: "apresentar",
      date: "15/11",
      dayOfWeek: "Sexta-feira",
      format: "Apresentação de Equipe",
      channel: "Instagram Reels",
      status: "roteiro_pronto",
      hook: "Quem são os especialistas que vão guiar sua evolução na Vox2you Lídice?",
      script:
        "Mentores com vivência de palco, mercado corporativo e comunicação de alta performance prontos para lapidar seu talento.",
      cta: "Agende sua conversa inicial com nossa coordenação pedagógica.",
      technicalNotes: "Cortes rápidos com os professores em ação na unidade Lídice.",
    },
    {
      id: "vox-v12",
      code: "V12",
      title: "Oratória para Negócios, Carreiras e Vendas",
      stage: "apresentar",
      date: "18/11",
      dayOfWeek: "Segunda-feira",
      format: "Pitch Corporativo",
      channel: "LinkedIn & Instagram",
      status: "roteiro_pronto",
      hook: "O melhor produto do mundo não se vende se você não souber explicá-lo.",
      script:
        "Executivos e profissionais liberais que dominam oratória fecham mais contratos e aceleram promoções. Conheça nosso módulo executivo.",
      cta: "Solicite o catálogo de cursos corporativos no WhatsApp da unidade.",
      technicalNotes: "Visual moderno, traje executivo elegante.",
    },

    // 03. PROVAR (5 vídeos)
    {
      id: "vox-v13",
      code: "V13",
      title: "Do Pânico ao Palco: A Transformação Real do Matheus",
      stage: "provar",
      date: "20/11",
      dayOfWeek: "Quarta-feira",
      format: "Case de Sucesso",
      channel: "Instagram & TikTok",
      status: "roteiro_pronto",
      hook: "'Eu chegava a tremer só de pensar em falar no microfone.'",
      script:
        "Veja como o Matheus, após 8 semanas na Vox2you Lídice, apresentou o relatório da empresa dele para 120 pessoas sem nenhuma anotação na mão.",
      cta: "A próxima história de sucesso pode ser a sua. Clique e saiba mais.",
      technicalNotes: "Imagens do antes e depois com depoimento sincero.",
    },
    {
      id: "vox-v14",
      code: "V14",
      title: "Como a Dra. Amanda Venceu a Insegurança em Congressos Médicos",
      stage: "provar",
      date: "22/11",
      dayOfWeek: "Sexta-feira",
      format: "Depoimento Profissional",
      channel: "Instagram Reels",
      status: "roteiro_pronto",
      hook: "Muito conhecimento técnico, mas dificuldade de passar autoridade no palco.",
      script:
        "A Dra. Amanda compartilha como o treinamento na Vox2you permitiu palestrar com desenvoltura e segurança em congressos nacionais.",
      cta: "Potencialize sua carreira com oratória profissional.",
      technicalNotes: "Depoimento gravado no auditório da Vox2you com iluminação profissional.",
    },
    {
      id: "vox-v15",
      code: "V15",
      title: "Apresentando o TCC sem Tremer as Mãos: O Caso da Larissa",
      stage: "provar",
      date: "25/11",
      dayOfWeek: "Segunda-feira",
      format: "Relato de Aluna",
      channel: "Instagram & TikTok",
      status: "roteiro_pronto",
      hook: "Nota 10 no TCC e elogio da banca avaliadora pela postura e firmeza de voz.",
      script:
        "Larissa conta como o curso transformou semanas de ansiedade em um momento de orgulho e segurança acadêmica.",
      cta: "Não sofra com apresentações na faculdade. Venha para a Vox2you Lídice.",
      technicalNotes: "Corte dinâmico com fotos da formatura e da banca.",
    },
    {
      id: "vox-v16",
      code: "V16",
      title: "Pais Relatam Mudança de Comportamento dos Filhos Teens",
      stage: "provar",
      date: "27/11",
      dayOfWeek: "Quarta-feira",
      format: "Entrevista com Pais",
      channel: "Instagram & Anúncios",
      status: "roteiro_pronto",
      hook: "'Meu filho não saía do quarto. Hoje ele lidera o grêmio estudantil.'",
      script:
        "Mães e pais de alunos da Turma Teens relatam a transformação na socialização, liderança e notas escolares dos filhos.",
      cta: "Dê a seu filho a habilidade mais valorizada do século XXI.",
      technicalNotes: "Tom emocionante e acolhedor, trilha acústica suave.",
    },
    {
      id: "vox-v17",
      code: "V17",
      title: "Antes e Depois: A Postura Corporal Após 4 Semanas de Treino",
      stage: "provar",
      date: "29/11",
      dayOfWeek: "Sexta-feira",
      format: "Split Screen Comparativo",
      channel: "Instagram Reels & TikTok",
      status: "roteiro_pronto",
      hook: "A mesma pessoa, com 30 dias de diferença. Olhe a mudança de presença.",
      script:
        "Vídeo em tela dividida mostrando o primeiro teste de palco e o exercício do módulo avançado. A evolução é visível e mensurável.",
      cta: "Quer testar sua comunicação hoje mesmo? Agende sua avaliação gratuita.",
      technicalNotes: "Efeito split screen lado a lado com legendas explicativas.",
    },

    // 04. CONVERTER (4 vídeos)
    {
      id: "vox-v18",
      code: "V18",
      title: "Matrículas Abertas Turma Teens Vox2you Uberlândia Lídice",
      stage: "converter",
      date: "02/12",
      dayOfWeek: "Segunda-feira",
      format: "Vídeo de Conversão Direta",
      channel: "Instagram Ads & Google Ads",
      status: "roteiro_pronto",
      hook: "Atenção pais de Uberlândia: turmas reduzidas abertas para o próximo mês.",
      script:
        "Garantir uma comunicação assertiva na juventude é o maior presente para a carreira e vida do seu filho. Vagas estritamente limitadas para manter o padrão de atendimento individual.",
      cta: "Toque no botão e converse agora com nossa equipe de matrículas no WhatsApp.",
      technicalNotes: "CTA forte com botão pulsante e texto claro de escassez responsável.",
    },
    {
      id: "vox-v19",
      code: "V19",
      title: "Condição Especial de Lançamento para Matrículas em Novembro",
      stage: "converter",
      date: "04/12",
      dayOfWeek: "Quarta-feira",
      format: "Anúncio Promocional",
      channel: "Instagram Stories & Reels",
      status: "roteiro_pronto",
      hook: "Bônus exclusivo para quem se matricular até esta sexta-feira na unidade Lídice.",
      script:
        "Inscreva-se na nova turma e ganhe 1 sessão individual de mentoria de voz com nossa fonoaudióloga parceira.",
      cta: "Clique em 'Saiba Mais' e aproveite essa condição única antes do encerramento.",
      technicalNotes: "Texto dinâmico em motion com destaque para os bônus.",
    },
    {
      id: "vox-v20",
      code: "V20",
      title: "Agende sua Aula Experimental Gratuita na Unidade Lídice",
      stage: "converter",
      date: "06/12",
      dayOfWeek: "Sexta-feira",
      format: "Convite Pessoal",
      channel: "Instagram & WhatsApp",
      status: "roteiro_pronto",
      hook: "Você não precisa acreditar nas nossas palavras: venha viver a experiência.",
      script:
        "Participe de 1 aula prática gratuita, suba no palco e sinta na pele como o método Vox2you funciona. Sem compromisso financeiro.",
      cta: "Envie 'QUERO AULA' no WhatsApp para reservar sua cadeira nesta semana.",
      technicalNotes: "Apresentador convidativo com sorriso e gesto de boas-vindas.",
    },
    {
      id: "vox-v21",
      code: "V21",
      title: "Últimas 5 Vagas para a Nova Formação de Oratória",
      stage: "converter",
      date: "09/12",
      dayOfWeek: "Segunda-feira",
      format: "Urgência & Fechamento",
      channel: "Instagram Stories & Meta Ads",
      status: "roteiro_pronto",
      hook: "Estamos fechando a lista da próxima turma da Vox2you Lídice.",
      script:
        "Restam apenas 5 vagas para o curso presencial na unidade Lídice. Se você quer começar o próximo ano se comunicando com autoridade e maestria, o momento é agora.",
      cta: "Garanta a sua vaga antes que o lote encerre. Toque no link da bio.",
      technicalNotes: "Cronômetro sutil e mensagem de encerramento de lote.",
    },
  ],
};

const LOCAL_STORAGE_KEY_PREFIX = "vexo_client_portal_";

export function useClientPortal(slug: string = "vox2you") {
  return useQuery({
    queryKey: ["client-portal", slug],
    queryFn: async (): Promise<ClientPortalData> => {
      try {
        const res = await fetchApi(`/api/geracao-digital/portal/${slug}`);
        if (res.ok) {
          const json = await res.json();
          if (json && json.data) {
            return json.data;
          }
        }
      } catch (e) {
        // Fallback silencioso para dados locais
      }

      // Verifica se há dados alterados localmente (aprovações etc)
      const stored = localStorage.getItem(`${LOCAL_STORAGE_KEY_PREFIX}${slug}`);
      if (stored) {
        try {
          return JSON.parse(stored);
        } catch (e) {
          // ignore
        }
      }

      return VOX2YOU_DEFAULT_DATA;
    },
    initialData: () => {
      const stored = localStorage.getItem(`${LOCAL_STORAGE_KEY_PREFIX}${slug}`);
      if (stored) {
        try {
          return JSON.parse(stored);
        } catch (e) {
          // ignore
        }
      }
      return VOX2YOU_DEFAULT_DATA;
    },
    staleTime: 1000 * 60 * 5,
  });
}

export function useApproveDeliverable(slug: string = "vox2you") {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ itemId }: { itemId: string }) => {
      try {
        await fetchApi(`/api/geracao-digital/portal/${slug}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId }),
        });
      } catch (e) {
        // Fallback offline/local
      }

      // Atualiza o estado em cache e no localStorage
      const current =
        queryClient.getQueryData<ClientPortalData>(["client-portal", slug]) ||
        VOX2YOU_DEFAULT_DATA;

      const updatedDeliverables = current.deliverables.map((item) =>
        item.id === itemId ? { ...item, status: "publicado" as DeliverableStatus } : item
      );

      const completedCount = updatedDeliverables.filter((d) => d.status === "publicado").length;
      const updatedStages = current.funnelStages.map((stage) => {
        const stageItems = updatedDeliverables.filter((d) => d.stage === stage.id);
        const stageDone = stageItems.filter((d) => d.status === "publicado").length;
        return {
          ...stage,
          completedVideos: stageDone,
        };
      });

      const updatedData: ClientPortalData = {
        ...current,
        weeklyPacing: {
          ...current.weeklyPacing,
          delivered: Math.min(current.weeklyPacing.delivered + 1, current.weeklyPacing.target),
        },
        funnelStages: updatedStages,
        deliverables: updatedDeliverables,
      };

      localStorage.setItem(
        `${LOCAL_STORAGE_KEY_PREFIX}${slug}`,
        JSON.stringify(updatedData)
      );

      queryClient.setQueryData(["client-portal", slug], updatedData);
      return { success: true, itemId };
    },
  });
}

export function useRequestRevision(slug: string = "vox2you") {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ itemId, feedback }: { itemId: string; feedback: string }) => {
      try {
        await fetchApi(`/api/geracao-digital/portal/${slug}/revision`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId, feedback }),
        });
      } catch (e) {
        // Fallback offline/local
      }

      const current =
        queryClient.getQueryData<ClientPortalData>(["client-portal", slug]) ||
        VOX2YOU_DEFAULT_DATA;

      const updatedDeliverables = current.deliverables.map((item) =>
        item.id === itemId
          ? {
              ...item,
              status: "ajuste_solicitado" as DeliverableStatus,
              feedback,
            }
          : item
      );

      const updatedData: ClientPortalData = {
        ...current,
        deliverables: updatedDeliverables,
      };

      localStorage.setItem(
        `${LOCAL_STORAGE_KEY_PREFIX}${slug}`,
        JSON.stringify(updatedData)
      );

      queryClient.setQueryData(["client-portal", slug], updatedData);
      return { success: true, itemId, feedback };
    },
  });
}
