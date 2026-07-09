import { useState } from "react";
import {
  BookOpen,
  Smartphone,
  Bot,
  Send,
  ListChecks,
  BarChart3,
  ArrowRight,
  Lightbulb,
  CheckCircle2,
  Server,
  Sparkles,
  Briefcase
} from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function OnboardingWizard() {
  const [activeTab, setActiveTab] = useState("modulo-1");

  return (
    <PageShell
      title="Vexo Academy"
      subtitle="Domine o sistema de ponta a ponta. Aprenda as estratégias por trás de cada ferramenta para escalar suas vendas e qualificações."
    >
      <div className="flex flex-col lg:flex-row gap-6 animate-fade-in-up">
        {/* Menu Lateral de Módulos */}
        <div className="lg:w-1/4 shrink-0">
          <Tabs value={activeTab} onValueChange={setActiveTab} orientation="vertical" className="w-full">
            <div className="sticky top-6">
              <Card className="border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <CardHeader className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 pb-4">
                  <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-500">
                    Trilha de Aprendizado
                  </CardTitle>
                </CardHeader>
                <TabsList className="flex-col items-stretch h-auto bg-transparent p-0">
                  <TabsTrigger
                    value="modulo-1"
                    className="justify-start gap-3 rounded-none border-b border-slate-100 dark:border-slate-800 px-4 py-3 data-[state=active]:bg-indigo-50 dark:data-[state=active]:bg-indigo-900/20 data-[state=active]:text-indigo-600 dark:data-[state=active]:text-indigo-400"
                  >
                    <Smartphone className="h-4 w-4" />
                    <span className="text-left font-semibold">1. Canais & Conexões</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="modulo-2"
                    className="justify-start gap-3 rounded-none border-b border-slate-100 dark:border-slate-800 px-4 py-3 data-[state=active]:bg-indigo-50 dark:data-[state=active]:bg-indigo-900/20 data-[state=active]:text-indigo-600 dark:data-[state=active]:text-indigo-400"
                  >
                    <Bot className="h-4 w-4" />
                    <span className="text-left font-semibold">2. Agente IA & Chatbot</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="modulo-3"
                    className="justify-start gap-3 rounded-none border-b border-slate-100 dark:border-slate-800 px-4 py-3 data-[state=active]:bg-indigo-50 dark:data-[state=active]:bg-indigo-900/20 data-[state=active]:text-indigo-600 dark:data-[state=active]:text-indigo-400"
                  >
                    <Send className="h-4 w-4" />
                    <span className="text-left font-semibold">3. Campanhas & Disparos</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="modulo-4"
                    className="justify-start gap-3 rounded-none border-b border-slate-100 dark:border-slate-800 px-4 py-3 data-[state=active]:bg-indigo-50 dark:data-[state=active]:bg-indigo-900/20 data-[state=active]:text-indigo-600 dark:data-[state=active]:text-indigo-400"
                  >
                    <ListChecks className="h-4 w-4" />
                    <span className="text-left font-semibold">4. Cadências de Follow-up</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="modulo-5"
                    className="justify-start gap-3 rounded-none border-b border-slate-100 dark:border-slate-800 px-4 py-3 data-[state=active]:bg-indigo-50 dark:data-[state=active]:bg-indigo-900/20 data-[state=active]:text-indigo-600 dark:data-[state=active]:text-indigo-400"
                  >
                    <Briefcase className="h-4 w-4" />
                    <span className="text-left font-semibold">5. Geração Digital (GD)</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="modulo-6"
                    className="justify-start gap-3 rounded-none border-b border-slate-100 dark:border-slate-800 px-4 py-3 data-[state=active]:bg-indigo-50 dark:data-[state=active]:bg-indigo-900/20 data-[state=active]:text-indigo-600 dark:data-[state=active]:text-indigo-400"
                  >
                    <Sparkles className="h-4 w-4" />
                    <span className="text-left font-semibold">6. LivPub & Eventos</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="modulo-7"
                    className="justify-start gap-3 rounded-none border-b border-slate-100 dark:border-slate-800 px-4 py-3 data-[state=active]:bg-indigo-50 dark:data-[state=active]:bg-indigo-900/20 data-[state=active]:text-indigo-600 dark:data-[state=active]:text-indigo-400"
                  >
                    <Server className="h-4 w-4" />
                    <span className="text-left font-semibold">7. Administração</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="modulo-8"
                    className="justify-start gap-3 rounded-none px-4 py-3 data-[state=active]:bg-indigo-50 dark:data-[state=active]:bg-indigo-900/20 data-[state=active]:text-indigo-600 dark:data-[state=active]:text-indigo-400"
                  >
                    <BarChart3 className="h-4 w-4" />
                    <span className="text-left font-semibold">8. Inteligência Comercial</span>
                  </TabsTrigger>
                </TabsList>
              </Card>
            </div>
          </Tabs>
        </div>

        {/* Conteúdo do Módulo */}
        <div className="lg:w-3/4">
          <Tabs value={activeTab}>
            {/* MÓDULO 1: CANAIS & CONEXÕES */}
            <TabsContent value="modulo-1" className="m-0 space-y-6 animate-fade-in-up">
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl text-indigo-700 dark:text-indigo-400">
                    Módulo 1: Canais & Conexões (Chips WhatsApp)
                  </CardTitle>
                  <CardDescription className="text-base">
                    Como plugar o seu número de WhatsApp no Vexo, aquecer seus chips e monitorar conexões.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 text-slate-700 dark:text-slate-300">
                  <p>
                    O primeiro passo no Vexo é conectar os números de WhatsApp (chamados de "Chips") que dispararão suas campanhas, farão follow-ups automatizados e atenderão novos contatos.
                  </p>
                  
                  <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
                    <div>
                      <h4 className="font-bold text-base text-indigo-600 dark:text-indigo-400">Aba Conexões (Pareamento QR Code)</h4>
                      <ul className="mt-2 space-y-2 list-disc list-inside text-sm">
                        <li>Acesse o menu <strong>Chips WhatsApp</strong> na barra lateral.</li>
                        <li>Na aba <strong>Conexões</strong>, clique em <strong>Adicionar Instância</strong> e digite um nome identificador.</li>
                        <li>Aguarde o QR Code carregar na tela.</li>
                        <li>Abra o WhatsApp no seu smartphone, acesse "Aparelhos Conectados" &gt; "Conectar um Aparelho" e escaneie o código.</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-bold text-base text-indigo-600 dark:text-indigo-400">Aba Aquecimento (Warming de Chips)</h4>
                      <p className="text-sm mt-1">
                        Para evitar que o WhatsApp bloqueie chips novos ao enviar muitas mensagens, use a aba **Aquecimento**. Ao cadastrar e ativar o aquecimento de vários chips, o Vexo faz com que eles conversem entre si de forma simulada no background, criando "reputação" com os servidores do WhatsApp antes de iniciar as campanhas comerciais frias.
                      </p>
                    </div>
                  </div>

                  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-5 flex gap-4">
                    <Lightbulb className="h-6 w-6 text-amber-500 shrink-0" />
                    <div>
                      <h4 className="font-bold text-amber-800 dark:text-amber-500 mb-1">Dica de Ouro: Blindagem e Rotação</h4>
                      <p className="text-sm text-amber-700 dark:text-amber-400">
                        Sempre mantenha a internet do celular de conexão ativa e estável. Para campanhas de alto volume, conecte múltiplos chips. O Vexo distribui os disparos de forma rotativa entre os chips conectados de modo totalmente automático, diluindo a carga e blindando seus números contra banimento.
                      </p>
                    </div>
                  </div>

                  <Button onClick={() => window.location.href = "/crm/chips-whatsapp?tab=conexoes"} className="w-full sm:w-auto mt-4 bg-indigo-600 hover:bg-indigo-700">
                    Ir para Conexões <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* MÓDULO 2: AGENTE IA */}
            <TabsContent value="modulo-2" className="m-0 space-y-6 animate-fade-in-up">
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl text-indigo-700 dark:text-indigo-400">
                    Módulo 2: Agente IA & Chatbot
                  </CardTitle>
                  <CardDescription className="text-base">
                    Transforme seu WhatsApp em uma máquina inteligente de triagem, atendimento e qualificação de leads.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 text-slate-700 dark:text-slate-300">
                  <p>
                    O menu **Agente IA** consolida todo o comportamento dos robôs que conversam com seus leads de forma receptiva (inbound) ou ativa. A Inteligência Artificial qualifica e coleta dados de forma autônoma.
                  </p>

                  <div className="grid gap-6 md:grid-cols-2">
                    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
                      <h3 className="font-bold text-base mb-2 text-indigo-600 dark:text-indigo-400">1. O Kanban (Aba Operação)</h3>
                      <p className="text-sm">
                        Monitore todas as conversas ativas da IA em tempo real. Veja em qual estágio da qualificação o cliente está e as respostas estruturadas obtidas pela inteligência.
                      </p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
                      <h3 className="font-bold text-base mb-2 text-indigo-600 dark:text-indigo-400">2. A Coleta SPIN (Aba Configurações)</h3>
                      <p className="text-sm">
                        Aqui você define quais dados a IA **é obrigada** a extrair da conversa (ex: Orçamento, Volume, Data). A IA conduzirá a conversa dinamicamente para colher estas respostas antes de concluir.
                      </p>
                    </div>
                  </div>

                  <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
                    <h3 className="font-bold text-base mb-2 text-indigo-600 dark:text-indigo-400">3. Identidade & Base de Conhecimento (Aba Documentação)</h3>
                    <p className="text-sm">
                      Dê personalidade à IA! Descreva quem é a sua empresa e defina a base de perguntas e respostas recomendadas para contornar objeções comuns de clientes de forma humanizada.
                    </p>
                  </div>

                  <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-5 flex gap-4">
                    <CheckCircle2 className="h-6 w-6 text-emerald-500 shrink-0" />
                    <div>
                      <h4 className="font-bold text-emerald-800 dark:text-emerald-500 mb-1">Webhook de Finalização</h4>
                      <p className="text-sm text-emerald-700 dark:text-emerald-400">
                        Quando a IA conclui a coleta de dados de qualificação com sucesso, ela dispara um webhook (JSON) enviando as informações capturadas diretamente para seu CRM, planilha ou sistema de reservas no n8n/Zapier.
                      </p>
                    </div>
                  </div>

                  <Button onClick={() => window.location.href = "/crm/agente?tab=operacao"} className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700">
                    Configurar Agente IA <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* MÓDULO 3: CAMPANHAS */}
            <TabsContent value="modulo-3" className="m-0 space-y-6 animate-fade-in-up">
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl text-indigo-700 dark:text-indigo-400">
                    Módulo 3: Campanhas & Disparos (Envio em Massa)
                  </CardTitle>
                  <CardDescription className="text-base">
                    Como importar listas de contatos por planilhas e engajar centenas de leads ativamente.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 text-slate-700 dark:text-slate-300">
                  <p>
                    Com o menu **Campanhas**, você pode subir bases frias ou listas de contatos em massa via arquivo Excel ou CSV, disparando mensagens humanizadas de abordagem um a um.
                  </p>

                  <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
                    <h3 className="font-bold text-lg mb-3">Como criar uma Campanha:</h3>
                    <ol className="space-y-3 list-decimal list-inside text-sm">
                      <li>Prepare um arquivo Excel (.xlsx) ou CSV contendo no mínimo as colunas: <strong>nome</strong> e <strong>telefone</strong>.</li>
                      <li>Acesse o menu **Campanhas** e clique no botão para criar uma nova campanha.</li>
                      <li>Escreva o texto de abordagem. Você pode usar variáveis como <code>{"{{nome}}"}</code> no texto para que a mensagem de cada cliente seja totalmente personalizada.</li>
                      <li>O robô enviará as mensagens com pequenos intervalos aleatórios de tempo (delay), simulando o comportamento de um vendedor humano e protegendo a linha contra banimentos.</li>
                    </ol>
                  </div>

                  <Button onClick={() => window.location.href = "/crm/campanhas"} className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700">
                    Ir para Campanhas <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* MÓDULO 4: CADÊNCIAS DE FOLLOW-UP */}
            <TabsContent value="modulo-4" className="m-0 space-y-6 animate-fade-in-up">
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl text-indigo-700 dark:text-indigo-400 flex items-center gap-2">
                    <ListChecks className="h-6 w-6" />
                    Módulo 4: Cadências de Follow-up
                  </CardTitle>
                  <CardDescription className="text-base">
                    Nunca mais perca vendas por esquecimento. Configure o motor de cadências e cobranças inteligentes do Vexo.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 text-slate-700 dark:text-slate-300">
                  <p>
                    Grande parte das vendas é perdida porque o vendedor esquece de retornar o contato caso o lead não responda de primeira. O Follow-up do Vexo funciona como uma régua de cobrança automática via WhatsApp, enviando mensagens em datas programadas até que o lead reaja.
                  </p>

                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-5">
                    <h4 className="font-bold text-red-800 dark:text-red-500 mb-1 flex items-center gap-2">
                      <Bot className="h-5 w-5" /> A Regra de Ouro: Auto-Pausa Reativa
                    </h4>
                    <p className="text-sm text-red-700 dark:text-red-400">
                      <strong>Garantia anti-robô:</strong> assim que o cliente responder à qualquer mensagem no WhatsApp, o Vexo cancela instantaneamente toda a sequência de follow-ups programada para ele. Dessa forma, você nunca correrá o risco de cobrar um cliente que já respondeu ou iniciou atendimento humano.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <h3 className="font-bold text-lg">Como Configurar:</h3>
                    <ul className="space-y-2 list-disc list-inside text-sm">
                      <li>Acesse a aba <strong>Configurações</strong> do Follow-up.</li>
                      <li>Ative as Jornadas que se aplicam ao seu modelo (ex: "Novo Lead", "Proposta Enviada", "Sem Contato").</li>
                      <li>Defina o tempo de espera e o texto das mensagens usando I.A. para gerar variações humanizadas no envio.</li>
                    </ul>
                  </div>

                  <Button onClick={() => window.location.href = "/crm/followup"} className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700">
                    Acessar Fila de Follow-up <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* MÓDULO 5: GERAÇÃO DIGITAL */}
            <TabsContent value="modulo-5" className="m-0 space-y-6 animate-fade-in-up">
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl text-indigo-700 dark:text-indigo-400">
                    Módulo 5: Geração Digital (Módulo Personalizado)
                  </CardTitle>
                  <CardDescription className="text-base">
                    Apresente pitches comerciais interativos e gerencie briefings gerados de forma rápida.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 text-slate-700 dark:text-slate-300">
                  <p>
                    O módulo **Geração Digital** foi projetado especialmente para apoiar as reuniões de vendas de consultores e fechar contratos de marketing digital, gerando inteligência a partir do diagnóstico.
                  </p>

                  <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
                    <div>
                      <h4 className="font-bold text-base text-indigo-600 dark:text-indigo-400">Aba Apresentação (Pitch Comercial Interativo)</h4>
                      <p className="text-sm mt-1">
                        Use esta tela durante reuniões de vendas para apresentar a metodologia de Geração Digital de forma visual e guiada. À medida que o cliente responde perguntas sobre o negócio dele, o sistema constrói um briefing técnico e diagnóstico automático.
                      </p>
                    </div>

                    <div>
                      <h4 className="font-bold text-base text-indigo-600 dark:text-indigo-400">Aba Briefings Salvos</h4>
                      <p className="text-sm mt-1">
                        Todos os formulários e briefings gerados durante os pitches de vendas ficam salvos nesta aba de forma vitalícia. É o local ideal para consultar o histórico dos leads, analisar as respostas do dossiê e encaminhar as propostas formatadas.
                      </p>
                    </div>
                  </div>

                  <Button onClick={() => window.location.href = "/crm/geracao-digital?tab=apresentacao"} className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700">
                    Acessar Geração Digital <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* MÓDULO 6: LIVPUB */}
            <TabsContent value="modulo-6" className="m-0 space-y-6 animate-fade-in-up">
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl text-indigo-700 dark:text-indigo-400 flex items-center gap-2">
                    <Sparkles className="h-6 w-6 text-indigo-600" />
                    Módulo 6: LivPub & Gestão de Eventos
                  </CardTitle>
                  <CardDescription className="text-base">
                    Automação de relacionamento para o público de eventos, controle de esteiras de ingressos e cupons.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 text-slate-700 dark:text-slate-300">
                  <p>
                    O módulo **Painel LivPub** automatiza e gerencia a régua de relacionamento com os participantes dos eventos programados da casa, coordenando canais de mensagens e segmentações dinâmicas.
                  </p>

                  <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
                    <div>
                      <h4 className="font-bold text-base text-indigo-600 dark:text-indigo-400">1. Gestão de Eventos (Muito Importante)</h4>
                      <p className="text-sm mt-1">
                        A automação de disparos depende da criação de eventos ativos. Na aba **Eventos**, clique em **Novo Evento** e defina o Nome, a Data e o Local do evento. 
                        A criação do evento é **crucial**, pois o sistema monitora a data do evento para rodar as réguas automáticas:
                      </p>
                      <ul className="mt-2 space-y-1.5 list-disc list-inside text-sm pl-2">
                        <li><strong>Esteira 1 (Pre-Event 3 Days):</strong> Dispara mensagens 3 dias antes do evento lembrando o participante de emitir o ingresso via Sympla.</li>
                        <li><strong>Esteira 5 (After-Event):</strong> Envia automaticamente um cupom de desconto exclusivo dias após a realização do evento.</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-bold text-base text-indigo-600 dark:text-indigo-400">2. Relacionamento & Segmentação</h4>
                      <p className="text-sm mt-1">
                        Filtre a base de clientes do clube por perfil de comportamento. Configure disparos apenas para aniversariantes do mês, clientes inativos (há mais de 60 dias sem visitas) ou novas assinaturas.
                      </p>
                    </div>
                  </div>

                  <Button onClick={() => window.location.href = "/crm/livpub?tab=eventos"} className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700">
                    Acessar Painel LivPub <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* MÓDULO 7: ADMINISTRAÇÃO */}
            <TabsContent value="modulo-7" className="m-0 space-y-6 animate-fade-in-up">
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl text-indigo-700 dark:text-indigo-400 flex items-center gap-2">
                    <Server className="h-6 w-6 text-indigo-600" />
                    Módulo 7: Administração (Gerenciamento Global)
                  </CardTitle>
                  <CardDescription className="text-base">
                    Como gerenciar empresas parceiras (tenants), cadastrar usuários e criar tokens de integração.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 text-slate-700 dark:text-slate-300">
                  <p>
                    A tela de **Administração** concentra os controles avançados do sistema e é visível apenas para usuários administradores.
                  </p>

                  <div className="grid gap-6 md:grid-cols-3">
                    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
                      <h4 className="font-bold text-base text-indigo-600 dark:text-indigo-400">1. Empresas (Tenants)</h4>
                      <p className="text-xs mt-1 leading-relaxed">
                        Crie e configure as contas de empresas parceiras que usam o CRM. Defina limites de envio de mensagens e gerencie as configurações técnicas básicas de banco de dados.
                      </p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
                      <h4 className="font-bold text-base text-indigo-600 dark:text-indigo-400">2. Usuários</h4>
                      <p className="text-xs mt-1 leading-relaxed">
                        Gerencie a sua equipe. Cadastre novos acessos e atribua permissões de forma granular (ex: "Administrador" com acesso total, ou "Vendedor/Consultor" limitado).
                      </p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
                      <h4 className="font-bold text-base text-indigo-600 dark:text-indigo-400">3. Integrações</h4>
                      <p className="text-xs mt-1 leading-relaxed">
                        Gere chaves e tokens de segurança para conectar o Vexo OS a sistemas de automação de terceiros, como plataformas de tráfego pago, n8n ou Zapier.
                      </p>
                    </div>
                  </div>

                  <Button onClick={() => window.location.href = "/crm/admin?tab=empresas"} className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700">
                    Acessar Painel de Administração <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* MÓDULO 8: INTELIGÊNCIA COMERCIAL */}
            <TabsContent value="modulo-8" className="m-0 space-y-6 animate-fade-in-up">
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl text-indigo-700 dark:text-indigo-400">
                    Módulo 8: Inteligência Comercial & Métricas
                  </CardTitle>
                  <CardDescription className="text-base">
                    Monitore a saúde da sua operação, meça tempos de resposta e gerencie a fila de distribuição de leads.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 text-slate-700 dark:text-slate-300">
                  <p>
                    O menu **Int. Comercial** fornece inteligência ativa sobre a eficiência das suas vendas, auxiliando os gestores a otimizarem o tempo de fechamento.
                  </p>

                  <div className="space-y-4">
                    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
                      <h4 className="font-bold text-base">Controle de SLA (Tempo de Resposta)</h4>
                      <p className="text-sm mt-1">
                        Acompanhe o tempo médio que os vendedores levam para responder um lead após a IA passar o bastão do atendimento. Responder contatos qualificados em menos de 5 minutos aumenta as taxas de fechamento exponencialmente.
                      </p>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
                      <h4 className="font-bold text-base">Roteamento Round-Robin (Roleta Comercial)</h4>
                      <p className="text-sm mt-1">
                        Evite disputas ou esquecimento de leads. Defina as regras de distribuição automatizada de leads qualificados entre os seus vendedores cadastrados, garantindo uma divisão justa, ordenada e rápida de novos negócios.
                      </p>
                    </div>
                  </div>

                  <Button onClick={() => window.location.href = "/crm/inteligencia-comercial"} className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700">
                    Visualizar Relatórios <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </PageShell>
  );
}
