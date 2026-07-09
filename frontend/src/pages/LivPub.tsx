import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { 
  Sparkles, 
  Calendar, 
  Heart, 
  ChevronRight, 
  Layers, 
  Users, 
  Clock, 
  AlertCircle,
  CheckCircle2,
  Play,
  TrendingUp,
  Sliders
} from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Eventos } from "./Eventos";
import Relacionamento from "./Relacionamento";

function PainelLivPub() {
  const [activeStep] = useState(1);

  const cronograma = [
    { semana: 1, titulo: "Fundação Técnica", descricao: "Banco de dados de leads e catálogo de segmentações.", status: "doing" },
    { semana: 2, titulo: "Esteiras Core", descricao: "Esteira 1 (Pré-venda) e Início da Esteira 4 (Reativação).", status: "todo" },
    { semana: 3, titulo: "Inteligência & Esteiras IA", descricao: "Esteira 2 (VIP), Esteira 3 (Aniversários) e Esteira 5 (Pós-evento).", status: "todo" },
    { semana: 4, titulo: "Entrega & Fork", descricao: "Frontend final, homologação e migração para ambiente dedicado.", status: "todo" }
  ];

  const esteiras = [
    { id: 1, nome: "Esteira 1 — Pré-venda de Evento", status: "Em Breve", track: "Track A (Conrado)", desc: "Abordagem automática anterior ao evento convidando para compra antecipada." },
    { id: 2, nome: "Esteira 2 — Camarote / VIP", status: "Em Breve", track: "Track A (Conrado)", desc: "Fluxo de negociação assistida por IA para leads interessados em camarotes." },
    { id: 3, nome: "Esteira 3 — Aniversariantes", status: "Em Breve", track: "Track B (Luiz)", desc: "Identificação de aniversariantes diários e geração de benefícios no painel do assessor." },
    { id: 4, nome: "Esteira 4 — Reativação de Inativos", status: "Em Breve", track: "Track B (Luiz)", desc: "Gatilho automático para leads inativos há mais de X dias com cupom de retorno." },
    { id: 5, nome: "Esteira 5 — Pós-evento", status: "Em Breve", track: "Track A (Conrado)", desc: "Pesquisa de satisfação e oferta de retorno automática pós-evento." }
  ];

  return (
    <div className="space-y-6">
      {/* Grid Superior: Visão Geral e Atalhos */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="relative overflow-hidden border-border bg-card hover:shadow-md transition-all">
          <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-bl-full pointer-events-none" />
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Calendar className="h-4 w-4 text-indigo-500" />
              Eventos cadastrados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between mt-1">
              <div>
                <span className="text-3xl font-bold tracking-tight">0</span>
                <span className="text-xs text-muted-foreground ml-2">ativos</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-border bg-card hover:shadow-md transition-all">
          <div className="absolute top-0 right-0 w-24 h-24 bg-pink-500/5 rounded-bl-full pointer-events-none" />
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Heart className="h-4 w-4 text-pink-500" />
              Campanhas de Relacionamento
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between mt-1">
              <div>
                <span className="text-3xl font-bold tracking-tight">0</span>
                <span className="text-xs text-muted-foreground ml-2">rodando</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-border bg-card hover:shadow-md transition-all">
          <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-bl-full pointer-events-none" />
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="h-4 w-4 text-amber-500" />
              Base de Leads LivPub
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between mt-1">
              <div>
                <span className="text-3xl font-bold tracking-tight">21k</span>
                <span className="text-xs text-muted-foreground ml-2">importados</span>
              </div>
              <Button asChild size="sm" variant="ghost" className="gap-1 hover:text-amber-400 text-xs h-8">
                <Link to="/crm/leads">
                  Ver Leads
                  <ChevronRight className="h-3 w-3" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Grid Principal: Cronograma & Esteiras */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Lado Esquerdo: Cronograma das Semanas */}
        <Card className="lg:col-span-1 border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Clock className="h-5 w-5 text-indigo-400" />
              Cronograma de Implantação
            </CardTitle>
            <CardDescription>
              Fases do setup e progresso do desenvolvimento
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {cronograma.map((item) => (
              <div 
                key={item.semana}
                className={`p-3 rounded-lg border transition-all ${
                  item.semana === activeStep 
                    ? "bg-indigo-500/5 border-indigo-500/30" 
                    : "bg-muted/30 border-transparent"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-indigo-400">
                    Semana 0{item.semana}
                  </span>
                  {item.status === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                  {item.status === "doing" && <Badge variant="secondary" className="bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 h-5 px-1.5 text-[10px]">Em Dev</Badge>}
                  {item.status === "todo" && <Badge variant="outline" className="text-muted-foreground border-muted h-5 px-1.5 text-[10px]">Pendente</Badge>}
                </div>
                <h4 className="text-sm font-semibold text-foreground">{item.titulo}</h4>
                <p className="text-xs text-muted-foreground mt-0.5">{item.descricao}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Lado Direito: As 5 Esteiras da LivPub */}
        <Card className="lg:col-span-2 border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Layers className="h-5 w-5 text-pink-400" />
                Status das Esteiras (Jornadas)
              </CardTitle>
              <CardDescription>
                Regras automatizadas de follow-up e inteligência
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-muted-foreground border-border">
              0 / 5 ativas
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="divide-y divide-border">
              {esteiras.map((e) => (
                <div key={e.id} className="py-3 first:pt-0 last:pb-0 flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-medium text-foreground">{e.nome}</h4>
                      <Badge variant="outline" className="text-[10px] text-muted-foreground bg-muted/20 px-1.5 h-4.5">
                        {e.track}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed max-w-xl">
                      {e.desc}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 self-end md:self-start">
                    <Badge variant="secondary" className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] px-2">
                      {e.status}
                    </Badge>
                    <Button size="icon" variant="ghost" className="h-8 w-8 hover:bg-muted text-muted-foreground" disabled>
                      <Play className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Seção Inferior: Próximos Passos de Integração e FAQ Técnico */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="h-4.5 w-4.5 text-indigo-400" />
              Atributos de Segmentação Ativos
            </CardTitle>
            <CardDescription>
              Campos personalizados indexados no banco e disponíveis no catálogo
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-muted/30 p-2.5 rounded border border-border/50 text-center">
                <span className="text-[10px] text-muted-foreground block uppercase font-mono">Coluna BD</span>
                <span className="text-xs font-semibold text-foreground block mt-0.5">perfil_musical</span>
                <Badge variant="secondary" className="mt-1.5 bg-indigo-500/10 text-indigo-300 text-[9px] h-4">Categoria</Badge>
              </div>
              <div className="bg-muted/30 p-2.5 rounded border border-border/50 text-center">
                <span className="text-[10px] text-muted-foreground block uppercase font-mono">Coluna BD</span>
                <span className="text-xs font-semibold text-foreground block mt-0.5">ultima_visita</span>
                <Badge variant="secondary" className="mt-1.5 bg-pink-500/10 text-pink-300 text-[9px] h-4">Data</Badge>
              </div>
              <div className="bg-muted/30 p-2.5 rounded border border-border/50 text-center">
                <span className="text-[10px] text-muted-foreground block uppercase font-mono">Coluna BD</span>
                <span className="text-xs font-semibold text-foreground block mt-0.5">data_nascimento</span>
                <Badge variant="secondary" className="mt-1.5 bg-amber-500/10 text-amber-300 text-[9px] h-4">Data</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <AlertCircle className="h-4.5 w-4.5 text-pink-400" />
              Diretrizes de Homologação
            </CardTitle>
            <CardDescription>
              Notas importantes sobre a base e o fork
            </CardDescription>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-2 leading-relaxed">
            <p>
              • **Isolamento de Dados:** Cada tabela de lead é criada separadamente usando o prefixo `leads_` e o identificador do cliente para garantir multi-tenant robusto.
            </p>
            <p>
              • **Fase de Fork:** No final da Semana 4, esta branch será forkada. Evite acoplar a lógica da LivPub em arquivos que não sejam do domínio `events`, `followup/triggers` ou telas próprias do frontend.
            </p>
            <p>
              • **Aprovador de follow-up:** As esteiras criam sugestões de envio de mensagens. Elas requerem a ativação de um canal de WhatsApp válido na aba de conexões para disparar.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function LivPub() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "painel";

  const handleTabChange = (val: string) => {
    setSearchParams({ tab: val });
  };

  return (
    <PageShell
      title="LivPub"
      subtitle="Módulo específico de inteligência e automação para LivPub"
    >
      <div className="w-full space-y-6">
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <div className="border-b border-slate-200 dark:border-white/10 pb-2 mb-4">
            <TabsList className="flex w-full max-w-md bg-muted border border-border h-10 p-1">
              <TabsTrigger value="painel" className="flex-1 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground">
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                Painel
              </TabsTrigger>
              <TabsTrigger value="relacionamento" className="flex-1 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground">
                <Sliders className="h-3.5 w-3.5 mr-1.5" />
                Relacionamento
              </TabsTrigger>
              <TabsTrigger value="eventos" className="flex-1 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground">
                <Calendar className="h-3.5 w-3.5 mr-1.5" />
                Eventos
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="painel" className="focus-visible:outline-none focus-visible:ring-0">
            <PainelLivPub />
          </TabsContent>
          <TabsContent value="relacionamento" className="focus-visible:outline-none focus-visible:ring-0">
            <Relacionamento />
          </TabsContent>
          <TabsContent value="eventos" className="focus-visible:outline-none focus-visible:ring-0">
            <Eventos />
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}
