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
  CheckCircle2
} from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export default function OnboardingWizard() {
  const [activeTab, setActiveTab] = useState("modulo-1");

  return (
    <PageShell
      title="Vexo Academy"
      subtitle="Domine o sistema de ponta a ponta. Aprenda as estratégias por trás de cada ferramenta para escalar suas vendas e qualificações."
      icon={BookOpen}
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
                    <span className="text-left font-semibold">1. Conexões WhatsApp</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="modulo-2"
                    className="justify-start gap-3 rounded-none border-b border-slate-100 dark:border-slate-800 px-4 py-3 data-[state=active]:bg-indigo-50 dark:data-[state=active]:bg-indigo-900/20 data-[state=active]:text-indigo-600 dark:data-[state=active]:text-indigo-400"
                  >
                    <Bot className="h-4 w-4" />
                    <span className="text-left font-semibold">2. Assistentes Inbound</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="modulo-3"
                    className="justify-start gap-3 rounded-none border-b border-slate-100 dark:border-slate-800 px-4 py-3 data-[state=active]:bg-indigo-50 dark:data-[state=active]:bg-indigo-900/20 data-[state=active]:text-indigo-600 dark:data-[state=active]:text-indigo-400"
                  >
                    <Send className="h-4 w-4" />
                    <span className="text-left font-semibold">3. Disparos Ativos</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="modulo-4"
                    className="justify-start gap-3 rounded-none border-b border-slate-100 dark:border-slate-800 px-4 py-3 data-[state=active]:bg-indigo-50 dark:data-[state=active]:bg-indigo-900/20 data-[state=active]:text-indigo-600 dark:data-[state=active]:text-indigo-400"
                  >
                    <ListChecks className="h-4 w-4" />
                    <span className="text-left font-semibold">4. Maestria em Follow-up</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="modulo-5"
                    className="justify-start gap-3 rounded-none border-slate-100 dark:border-slate-800 px-4 py-3 data-[state=active]:bg-indigo-50 dark:data-[state=active]:bg-indigo-900/20 data-[state=active]:text-indigo-600 dark:data-[state=active]:text-indigo-400"
                  >
                    <BarChart3 className="h-4 w-4" />
                    <span className="text-left font-semibold">5. Inteligência Comercial</span>
                  </TabsTrigger>
                </TabsList>
              </Card>
            </div>
          </Tabs>
        </div>

        {/* Conteúdo do Módulo */}
        <div className="lg:w-3/4">
          <Tabs value={activeTab}>
            {/* MÓDULO 1: CONEXÕES */}
            <TabsContent value="modulo-1" className="m-0 space-y-6 animate-fade-in-up">
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl text-indigo-700 dark:text-indigo-400">
                    Módulo 1: Conexões WhatsApp
                  </CardTitle>
                  <CardDescription className="text-base">
                    Como plugar o seu número de WhatsApp no Vexo e deixá-lo pronto para o trabalho.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 text-slate-700 dark:text-slate-300">
                  <p>
                    O primeiro passo no Vexo é conectar os "Chips" que farão o disparo de campanhas, os follow-ups e os atendimentos de inbound. 
                  </p>
                  
                  <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
                    <h3 className="font-bold text-lg mb-3">Passo a Passo:</h3>
                    <ul className="space-y-3 list-disc list-inside">
                      <li>Acesse o menu <strong>Chips WhatsApp</strong> (Dentro do modo Disparos).</li>
                      <li>Clique em <strong>Adicionar Instância</strong> e dê um nome claro (ex: "WhatsApp Comercial 1").</li>
                      <li>Aguarde gerar o QR Code na tela.</li>
                      <li>Abra o WhatsApp no celular, vá em "Aparelhos Conectados" e escaneie.</li>
                    </ul>
                  </div>

                  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-5 flex gap-4">
                    <Lightbulb className="h-6 w-6 text-amber-500 shrink-0" />
                    <div>
                      <h4 className="font-bold text-amber-800 dark:text-amber-500 mb-1">Dica de Ouro: Blindagem contra Spam</h4>
                      <p className="text-sm text-amber-700 dark:text-amber-400">
                        Sempre matenha o celular da conexão com internet estável. Para escalar muito, conecte VÁRIOS chips. O Vexo sabe rotacionar o envio entre eles automaticamente, o que evita que o WhatsApp bloqueie o seu número.
                      </p>
                    </div>
                  </div>

                  <Button onClick={() => window.location.href = "/crm/conexoes"} className="w-full sm:w-auto mt-4 bg-indigo-600 hover:bg-indigo-700">
                    Ir para Conexões <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* MÓDULO 2: INBOUND */}
            <TabsContent value="modulo-2" className="m-0 space-y-6 animate-fade-in-up">
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl text-indigo-700 dark:text-indigo-400">
                    Módulo 2: Assistentes Inbound & Coleta SPIN
                  </CardTitle>
                  <CardDescription className="text-base">
                    Transforme seu WhatsApp em uma máquina automática de atendimento e qualificação.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 text-slate-700 dark:text-slate-300">
                  <p>
                    O Módulo Inbound serve para clientes que <strong>entram em contato com você</strong> de forma receptiva (ex: campanhas no Google Ads, Meta Ads, links na bio). Em vez de você responder manualmente, a Inteligência Artificial qualifica e agenda a reunião pra você.
                  </p>

                  <div className="grid gap-6 md:grid-cols-2">
                    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
                      <h3 className="font-bold text-lg mb-2 text-indigo-600 dark:text-indigo-400">1. O Prompt (Cérebro da IA)</h3>
                      <p className="text-sm">
                        Na aba <strong>Identidade & Prompt</strong>, descreva exatamente quem é a sua empresa e quais são as objeções mais comuns. Seja específico: <em>"Se o cliente achar caro, explique que o nosso valor entrega qualidade superior e parcelamento em 12x"</em>.
                      </p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
                      <h3 className="font-bold text-lg mb-2 text-indigo-600 dark:text-indigo-400">2. A Coleta SPIN</h3>
                      <p className="text-sm">
                        É aqui que a mágica acontece. Defina quais dados o robô <strong>é obrigado</strong> a coletar antes de terminar a conversa (Ex: Nome, Quantidade de pessoas, Data da reserva). O robô vai conduzir a conversa para arrancar essas respostas do lead.
                      </p>
                    </div>
                  </div>

                  <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-5 flex gap-4">
                    <CheckCircle2 className="h-6 w-6 text-emerald-500 shrink-0" />
                    <div>
                      <h4 className="font-bold text-emerald-800 dark:text-emerald-500 mb-1">Integração Mágica: Webhook de Finalização</h4>
                      <p className="text-sm text-emerald-700 dark:text-emerald-400">
                        Quando a Coleta SPIN for finalizada, o Vexo não deixa a informação presa no chat. Ele envia os dados coletados (via JSON) diretamente para o <strong>Webhook de Finalização</strong> (que pode ser seu N8N ou sistema de reservas), agendando a mesa ou reunião de forma 100% autônoma.
                      </p>
                    </div>
                  </div>

                  <Button onClick={() => window.location.href = "/crm/inbound-agents"} className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700">
                    Configurar Inbound <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* MÓDULO 3: DISPAROS */}
            <TabsContent value="modulo-3" className="m-0 space-y-6 animate-fade-in-up">
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl text-indigo-700 dark:text-indigo-400">
                    Módulo 3: Disparos Ativos
                  </CardTitle>
                  <CardDescription className="text-base">
                    Como reativar bases inativas e fazer campanhas de captação em massa.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 text-slate-700 dark:text-slate-300">
                  <p>
                    Com as campanhas ativas por planilha, você pode subir listas de centenas de leads e o Vexo irá abordar um por um de forma humanizada.
                  </p>

                  <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
                    <h3 className="font-bold text-lg mb-3">Passo a Passo:</h3>
                    <ul className="space-y-3 list-disc list-inside">
                      <li>Prepare sua planilha de Excel ou CSV contendo as colunas mínimas: <strong>nome</strong> e <strong>telefone</strong>.</li>
                      <li>Acesse <strong>Envios por Planilha</strong> e clique em Nova Campanha.</li>
                      <li>Crie o texto de abordagem inicial. Você pode usar a variável <code>{"{{nome}}"}</code> para chamar o cliente pelo nome.</li>
                      <li>Evite abordagens "vendedoras". O ideal é despertar curiosidade: <em>"Olá {"{{nome}}"}, tudo bem? Vi seu contato aqui e lembrei de algo, posso te mandar?"</em></li>
                    </ul>
                  </div>

                  <Button onClick={() => window.location.href = "/crm/planilhas"} className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700">
                    Ir para Disparos <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* MÓDULO 4: FOLLOW-UP (Principal) */}
            <TabsContent value="modulo-4" className="m-0 space-y-6 animate-fade-in-up">
              <Card className="border-indigo-200 shadow-md">
                <CardHeader className="bg-indigo-50 dark:bg-indigo-900/20 border-b border-indigo-100 dark:border-indigo-900/50">
                  <CardTitle className="text-2xl text-indigo-700 dark:text-indigo-400 flex items-center gap-3">
                    <ListChecks className="h-7 w-7" />
                    Módulo 4: Maestria em Follow-up
                  </CardTitle>
                  <CardDescription className="text-base font-medium text-indigo-600/80 dark:text-indigo-400/80">
                    Nenhum lead vai esfriar. Entenda o motor de cadências automáticas que multiplica as suas vendas.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-8 pt-6 text-slate-700 dark:text-slate-300">
                  
                  <div>
                    <h3 className="text-xl font-bold mb-2">O Conceito: O que é o Follow-up do Vexo?</h3>
                    <p>
                      O maior erro comercial é achar que um lead perdeu interesse apenas porque não respondeu de primeira. O Follow-up do Vexo é um <strong>motor de insistência inteligente</strong>. Ele dispara mensagens automáticas em datas programadas até o cliente responder.
                    </p>
                  </div>

                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-5">
                    <h4 className="font-bold text-red-800 dark:text-red-500 mb-1 flex items-center gap-2">
                      <Bot className="h-5 w-5" /> A Regra de Ouro: A Pausa Automática
                    </h4>
                    <p className="text-sm text-red-700 dark:text-red-400 font-medium">
                      Assim que o cliente responde ao WhatsApp (qualquer mensagem), o robô INTERROMPE toda a sequência de follow-up automaticamente naquele mesmo segundo. A partir dali, o vendedor humano assume o chat. O sistema nunca fará você parecer um robô ou mandar mensagens desconexas para quem já está interagindo.
                    </p>
                  </div>

                  <div>
                    <h3 className="text-xl font-bold mb-4 border-b border-slate-200 dark:border-slate-800 pb-2">Como configurar sua Máquina:</h3>
                    
                    <div className="space-y-6">
                      <div className="flex gap-4">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 font-bold dark:bg-indigo-900 dark:text-indigo-300">1</div>
                        <div>
                          <h4 className="font-bold text-lg">Crie uma Regra de Cadência</h4>
                          <p className="text-sm mt-1">
                            Vá em <strong>Regras de Cadência</strong> (dentro de Follow-up). Defina a condição. Por exemplo, uma regra chamada "Proposta Enviada".
                          </p>
                        </div>
                      </div>

                      <div className="flex gap-4">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 font-bold dark:bg-indigo-900 dark:text-indigo-300">2</div>
                        <div>
                          <h4 className="font-bold text-lg">Adicione os Estágios (Mensagens)</h4>
                          <p className="text-sm mt-1">
                            Dentro da regra, você vai criar as mensagens que serão engatilhadas nos dias subsequentes:<br/><br/>
                            • <strong>Dia 1:</strong> <em>"Olá {"{{nome}}"}, você conseguiu olhar a proposta que te enviei ontem?"</em><br/>
                            • <strong>Dia 3:</strong> <em>"Ei {"{{nome}}"}, alguma dúvida sobre o documento?"</em><br/>
                            • <strong>Dia 7 (Despedida):</strong> <em>"Como não tive retorno, estou fechando seu atendimento. Se precisar no futuro, me chame."</em>
                          </p>
                        </div>
                      </div>

                      <div className="flex gap-4">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 font-bold dark:bg-indigo-900 dark:text-indigo-300">3</div>
                        <div>
                          <h4 className="font-bold text-lg">Injete os Leads na Fila</h4>
                          <p className="text-sm mt-1">
                            Sempre que um vendedor seu enviar uma proposta, ele pega o contato e clica em "Adicionar ao Follow-up", escolhendo a regra "Proposta Enviada". Pronto. O motor assume daqui pra frente e o vendedor pode esquecer aquele lead até ele responder.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <Button onClick={() => window.location.href = "/crm/followup"} className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700">
                    Ir para Fila de Follow-up <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* MÓDULO 5: INTELIGÊNCIA COMERCIAL */}
            <TabsContent value="modulo-5" className="m-0 space-y-6 animate-fade-in-up">
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl text-indigo-700 dark:text-indigo-400">
                    Módulo 5: Inteligência Comercial
                  </CardTitle>
                  <CardDescription className="text-base">
                    Para quem é gestor: domine os números e a distribuição de leads da sua operação.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 text-slate-700 dark:text-slate-300">
                  <p>
                    O módulo de Inteligência não apenas fornece gráficos bonitos, ele age ativamente na sua operação distribuindo o jogo.
                  </p>

                  <div className="space-y-4">
                    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
                      <h4 className="font-bold">Performance e SLAs</h4>
                      <p className="text-sm mt-1">Acompanhe qual é o "Tempo Médio de Primeiro Contato" da sua equipe. Em vendas, responder em 5 minutos multiplica a chance de conversão por 10x.</p>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
                      <h4 className="font-bold">Equipe & Roteamento (Round Robin)</h4>
                      <p className="text-sm mt-1">
                        Se você tem mais de um vendedor, cadastre-os aqui. O Vexo pode roletar os leads qualificados (1 para o vendedor A, 1 para o vendedor B, e assim por diante), garantindo que todos tenham chances justas e que nenhum lead fique perdido.
                      </p>
                    </div>
                  </div>

                  <Button onClick={() => window.location.href = "/crm/inteligencia"} className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700">
                    Acessar Dashboard <ArrowRight className="ml-2 h-4 w-4" />
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
