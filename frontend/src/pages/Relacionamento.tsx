// VexoCrm/frontend/src/pages/Relacionamento.tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { 
  Heart, 
  Users, 
  Sparkles, 
  Info, 
  ArrowLeft, 
  Gift, 
  Search, 
  UserMinus, 
  Sliders, 
  Settings2,
  CalendarDays
} from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Relacionamento() {
  const [searchQuery, setSearchQuery] = useState("");

  const segmentationFields = [
    { label: "Perfil Musical", field: "perfil_musical", type: "Categoria (Texto)", desc: "Estilos preferidos (ex: Funk, Sertanejo, Eletrônico) mapeados a partir do histórico de ingressos e comportamento." },
    { label: "Última Visita", field: "ultima_visita", type: "Data (Date)", desc: "Data do último evento frequentado pelo cliente na casa. Usado na régua de reativação." },
    { label: "Data de Nascimento", field: "data_nascimento", type: "Data (Date)", desc: "Data de nascimento para campanhas automáticas de aniversário." }
  ];

  return (
    <PageShell
      title="Relacionamento & Segmentação"
      subtitle="Gerencie campanhas de aniversário, reativação de leads e filtros personalizados"
      spacing="space-y-6"
    >
      <div className="flex items-center justify-between border border-border bg-muted/20 p-4 rounded-lg">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-pink-400 mt-0.5" />
          <div className="space-y-0.5">
            <h4 className="text-sm font-semibold text-foreground">Planejamento do Track B (Luiz)</h4>
            <p className="text-xs text-muted-foreground max-w-2xl">
              Esta tela agrupará a gestão de clientes aniversariantes, inativos e as definições do catálogo de segmentações. As esteiras automáticas 3 e 4 serão acopladas a esta interface na Semana 4.
            </p>
          </div>
        </div>
        <Button asChild size="sm" variant="outline" className="gap-1.5 text-xs">
          <Link to="/crm/livpub">
            <ArrowLeft className="h-3 w-3" />
            Voltar ao Hub
          </Link>
        </Button>
      </div>

      <Tabs defaultValue="segmentacao" className="w-full space-y-6">
        <TabsList className="grid w-full grid-cols-3 max-w-md bg-muted border border-border h-10 p-1">
          <TabsTrigger value="segmentacao" className="text-xs data-[state=active]:bg-background data-[state=active]:text-foreground">
            <Sliders className="h-3.5 w-3.5 mr-1.5" />
            Catálogo
          </TabsTrigger>
          <TabsTrigger value="aniversariantes" className="text-xs data-[state=active]:bg-background data-[state=active]:text-foreground">
            <Gift className="h-3.5 w-3.5 mr-1.5" />
            Aniversariantes
          </TabsTrigger>
          <TabsTrigger value="inativos" className="text-xs data-[state=active]:bg-background data-[state=active]:text-foreground">
            <UserMinus className="h-3.5 w-3.5 mr-1.5" />
            Clientes Inativos
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Catálogo de Segmentação */}
        <TabsContent value="segmentacao" className="space-y-4 outline-none">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sliders className="h-4.5 w-4.5 text-pink-400" />
                Catálogo de Campos LivPub
              </CardTitle>
              <CardDescription>
                Filtros e campos mapeados no banco para criação de réguas dinâmicas
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {segmentationFields.map((field) => (
                  <div key={field.field} className="p-4 rounded-lg border border-border bg-muted/20 flex flex-col justify-between space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-foreground">{field.label}</span>
                        <Badge variant="secondary" className="text-[10px] bg-pink-500/10 text-pink-300 border border-pink-500/20 px-1.5">{field.type}</Badge>
                      </div>
                      <code className="text-[10px] text-muted-foreground block font-mono bg-muted/40 px-1.5 py-0.5 rounded w-max mt-1">
                        {field.field}
                      </code>
                      <p className="text-xs text-muted-foreground leading-relaxed mt-2">
                        {field.desc}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" className="w-full text-xs h-8 border-border text-muted-foreground hover:text-foreground" disabled>
                      <Settings2 className="h-3.5 w-3.5 mr-1.5" />
                      Ajustar Filtro
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Aniversariantes */}
        <TabsContent value="aniversariantes" className="space-y-4 outline-none">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2 border-border bg-card">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <CalendarDays className="h-4.5 w-4.5 text-pink-400" />
                    Aniversariantes do Dia
                  </CardTitle>
                  <CardDescription>
                    Lista de clientes fazendo aniversário hoje
                  </CardDescription>
                </div>
                <Badge variant="secondary" className="bg-pink-500/10 text-pink-300 border border-pink-500/20">
                  Semana 4
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative">
                  <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                  <Input 
                    placeholder="Buscar aniversariante..." 
                    className="pl-9"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    disabled
                  />
                </div>
                <div className="border border-dashed border-border py-12 rounded-lg text-center flex flex-col items-center justify-center">
                  <Gift className="h-8 w-8 text-muted-foreground mb-3 animate-pulse" />
                  <span className="text-sm font-medium text-muted-foreground">Nenhum aniversariante listado</span>
                  <span className="text-xs text-muted-foreground mt-0.5">As sugestões de benefícios automáticas da Esteira 3 aparecerão aqui.</span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Esteira 3 — Benefício Automático</CardTitle>
                <CardDescription>Regras da automação de aniversário</CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-3 leading-relaxed">
                <p>
                  • **Rotina Diária:** Um cron job roda às 08:00 buscando clientes cuja data de nascimento é idêntica ao dia atual.
                </p>
                <p>
                  • **Validação da Proposta:** Gera sugestões pré-aprovadas contendo cortesia de entrada ou drink especial.
                </p>
                <p>
                  • **Disparo:** O assessor revisa a lista e aprova o envio da mensagem personalizada via WhatsApp.
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab 3: Clientes Inativos */}
        <TabsContent value="inativos" className="space-y-4 outline-none">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2 border-border bg-card">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <UserMinus className="h-4.5 w-4.5 text-pink-400" />
                    Sugestões de Reativação
                  </CardTitle>
                  <CardDescription>
                    Clientes sem comparecimento nos últimos X dias
                  </CardDescription>
                </div>
                <Badge variant="secondary" className="bg-pink-500/10 text-pink-300 border border-pink-500/20">
                  Semana 4
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="border border-dashed border-border py-12 rounded-lg text-center flex flex-col items-center justify-center">
                  <Users className="h-8 w-8 text-muted-foreground mb-3 animate-pulse" />
                  <span className="text-sm font-medium text-muted-foreground">Nenhuma sugestão disponível</span>
                  <span className="text-xs text-muted-foreground mt-0.5">Clientes ausentes serão analisados com base na data da última visita.</span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Esteira 4 — Abordagem de Inativos</CardTitle>
                <CardDescription>Regras de reengajamento</CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-3 leading-relaxed">
                <p>
                  • **Métrica de Ausência:** Identifica leads onde a data `ultima_visita` é superior ao limite definido pelo administrador (ex: 30, 60 ou 90 dias).
                </p>
                <p>
                  • **IA de Abordagem:** O chatbot inicia a conversa de forma sutil, lembrando de eventos marcantes do perfil musical preferido e oferecendo cortesia para o próximo evento.
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
