import {
  Bot,
  Database,
  Phone,
  Zap,
  ChevronRight,
  GitBranch,
  Clock,
  CheckCircle2,
  Megaphone,
  Users,
  TrendingUp,
  FileText,
  Shuffle,
  Activity,
} from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MainFlowDiagram } from "./ChatbotDocs/MainFlowDiagram";
import { SpinFlowDiagram } from "./ChatbotDocs/SpinFlowDiagram";
import { DataArchDiagram } from "./ChatbotDocs/DataArchDiagram";
import { SdrFlowDiagram } from "./ChatbotDocs/SdrFlowDiagram";
import { BufferDiagram } from "./ChatbotDocs/BufferDiagram";
import { CampaignRoutingDiagram } from "./ChatbotDocs/CampaignRoutingDiagram";
import { CampaignSequenceViewer } from "./ChatbotDocs/CampaignSequenceViewer";
import { LiveStatsPanel } from "./ChatbotDocs/LiveStatsPanel";

// ─── Página Principal ─────────────────────────────────────────────────────────

export default function ChatbotDocs() {
  return (
    <PageShell title="Documentação do Chatbot" description="Arquitetura, fluxos e modelos do sistema de qualificação">
      <div className="space-y-6">
        {/* Header badges */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            SPIN Selling
          </Badge>
          <Badge variant="outline" className="border-cyan-300 text-cyan-700 dark:text-cyan-400">
            <Bot className="mr-1 h-3 w-3" />
            AI Engine
          </Badge>
          <Badge variant="outline" className="border-violet-300 text-violet-700 dark:text-violet-400">
            <Database className="mr-1 h-3 w-3" />
            Multi-tenant
          </Badge>
          <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-400">
            <Phone className="mr-1 h-3 w-3" />
            SDR Alerts
          </Badge>
          <Badge variant="outline" className="border-indigo-300 text-indigo-700 dark:text-indigo-400">
            <Megaphone className="mr-1 h-3 w-3" />
            Campanhas
          </Badge>
        </div>

        {/* Painel de métricas ao vivo */}
        <Card className="border-slate-100 dark:border-white/8">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-emerald-500" />
              Métricas ao Vivo
              <Badge variant="outline" className="ml-1 border-emerald-300 text-[10px] text-emerald-600 dark:text-emerald-400">
                auto 30s
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <LiveStatsPanel />
          </CardContent>
        </Card>

        {/* Resumo de arquitetura */}
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            { label: "Perguntas SPIN", value: "9", sub: "Situação, Problema, Implicação, Necessidade" },
            { label: "Cenários de conversa", value: "3", sub: "Novo, Reengajamento, Recontato" },
            { label: "Modos de campanha", value: "2", sub: "Só Disparo / Com Agente IA" },
            { label: "Debounce buffer", value: "3s", sub: "Agrupa mensagens rápidas" },
          ].map(({ label, value, sub }) => (
            <Card key={label} className="border-slate-100 dark:border-white/8">
              <CardContent className="pt-4">
                <p className="text-2xl font-extrabold text-foreground">{value}</p>
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</p>
                <p className="text-[11px] text-slate-400">{sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tabs com diagramas */}
        <Tabs defaultValue="main-flow">
          <TabsList className="flex-wrap">
            <TabsTrigger value="main-flow">
              <GitBranch className="mr-1.5 h-3.5 w-3.5" />
              Fluxo Principal
            </TabsTrigger>
            <TabsTrigger value="spin">
              <ChevronRight className="mr-1.5 h-3.5 w-3.5" />
              Modelo SPIN
            </TabsTrigger>
            <TabsTrigger value="data">
              <Database className="mr-1.5 h-3.5 w-3.5" />
              Dados & Tabelas
            </TabsTrigger>
            <TabsTrigger value="buffer">
              <Clock className="mr-1.5 h-3.5 w-3.5" />
              Buffer de Msgs
            </TabsTrigger>
            <TabsTrigger value="sdr">
              <Phone className="mr-1.5 h-3.5 w-3.5" />
              Notificação SDR
            </TabsTrigger>
            <TabsTrigger value="campanhas">
              <Megaphone className="mr-1.5 h-3.5 w-3.5" />
              Campanhas
            </TabsTrigger>
          </TabsList>

          <TabsContent value="main-flow">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Fluxo Principal de Mensagem</CardTitle>
              </CardHeader>
              <CardContent>
                <MainFlowDiagram />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="spin">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Modelo SPIN — 9 Perguntas</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-4 text-sm text-slate-500">
                  Clique em cada passo para ver a pergunta completa.
                </p>
                <SpinFlowDiagram />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="data">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Arquitetura de Dados — Tabelas por Empresa</CardTitle>
              </CardHeader>
              <CardContent>
                <DataArchDiagram />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="buffer">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Buffer de Mensagens</CardTitle>
              </CardHeader>
              <CardContent>
                <BufferDiagram />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sdr">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Notificação para SDR/Closer</CardTitle>
              </CardHeader>
              <CardContent>
                <SdrFlowDiagram />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="campanhas">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Shuffle className="h-4 w-4 text-indigo-500" />
                    Roteamento Campanha vs Inbound
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <CampaignRoutingDiagram />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileText className="h-4 w-4 text-slate-500" />
                    Sequência de Mensagens por Campanha
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
                    Visualize os passos configurados para cada campanha, com tipo, texto, delay e modo de disparo.
                  </p>
                  <CampaignSequenceViewer />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Zap className="h-4 w-4 text-amber-500" />
                    Disparos (campaign_dispatches)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Dentro de uma campanha podem existir múltiplos disparos independentes — cada um com seus próprios passos (textos/imagens), podendo ser acionado manualmente ou agendado.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {[
                      { label: "draft", desc: "Criado, ainda não disparado", color: "text-slate-400 border-slate-200 dark:border-white/10" },
                      { label: "running", desc: "Executando envios em background", color: "text-amber-500 border-amber-200 dark:border-amber-800/40" },
                      { label: "done", desc: "Concluído — sent_count / failed_count atualizados", color: "text-emerald-500 border-emerald-200 dark:border-emerald-800/40" },
                    ].map(({ label, desc, color }) => (
                      <div key={label} className={`rounded-xl border p-3 ${color}`}>
                        <p className="font-mono text-[11px] font-bold uppercase">{label}</p>
                        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{desc}</p>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.02]">
                    <p className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">Tabelas</p>
                    <div className="space-y-1.5">
                      {[
                        { table: "campaign_dispatches", desc: "Um disparo por campanha — steps, status, sent_count, failed_count" },
                        { table: "campaign_dispatch_runs", desc: "Um registro por telefone/lead de cada disparo executado" },
                      ].map(({ table, desc }) => (
                        <div key={table} className="flex items-start gap-2 rounded-lg border border-slate-100 px-3 py-2 dark:border-white/8">
                          <code className="shrink-0 font-mono text-[11px] font-bold text-cyan-700 dark:text-cyan-400">{table}</code>
                          <span className="text-[11px] text-slate-500">{desc}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

            </div>
          </TabsContent>
        </Tabs>

        {/* Referência de endpoints */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Endpoints da API</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[
                {
                  method: "POST",
                  path: "/api/hardcoded-chat-webhook",
                  desc: "Webhook Evolution → processa mensagem, roteamento por mode/período, buffer 3s",
                  color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
                },
                {
                  method: "GET",
                  path: "/api/hardcoded-chat-leads",
                  desc: "Lista leads para o Kanban por empresa",
                  color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300",
                },
                {
                  method: "POST",
                  path: "/api/hardcoded-chat-extract",
                  desc: "Gera briefing SDR de uma conversa finalizada (prompt 'extrato' do banco)",
                  color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
                },
                {
                  method: "GET",
                  path: "/api/prompts",
                  desc: "Busca prompt por clientId e type (padrao | campanha | extrato)",
                  color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300",
                },
                {
                  method: "PUT",
                  path: "/api/prompts",
                  desc: "Salva ou atualiza prompt via Editor de Prompts",
                  color: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
                },
                {
                  method: "GET",
                  path: "/api/campaigns/:id/dispatches",
                  desc: "Lista disparos de uma campanha",
                  color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300",
                },
                {
                  method: "POST",
                  path: "/api/campaigns/:id/dispatches",
                  desc: "Cria novo disparo (steps, trigger_type, scheduled_at)",
                  color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
                },
                {
                  method: "PATCH",
                  path: "/api/campaigns/dispatches/:id",
                  desc: "Atualiza disparo — steps, nome, status",
                  color: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
                },
                {
                  method: "POST",
                  path: "/api/campaigns/dispatches/:id/trigger",
                  desc: "Dispara manualmente — executa em background, atualiza sent_count/failed_count",
                  color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
                },
                {
                  method: "DELETE",
                  path: "/api/campaigns/dispatches/:id",
                  desc: "Remove disparo (não permitido quando status = running)",
                  color: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300",
                },
                {
                  method: "GET",
                  path: "/api/chatbot-templates/builtins",
                  desc: "Lista templates built-in disponíveis para o dropdown de modelo",
                  color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300",
                },
                {
                  method: "GET",
                  path: "/api/followup-queue",
                  desc: "Fila de leads aguardando recontato",
                  color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300",
                },
              ].map(({ method, path, desc, color }) => (
                <div
                  key={path}
                  className="flex items-start gap-3 rounded-xl border border-slate-100 bg-white p-3 dark:border-white/8 dark:bg-white/[0.02]"
                >
                  <span
                    className={`shrink-0 rounded-md px-2 py-0.5 font-mono text-[10px] font-bold ${color}`}
                  >
                    {method}
                  </span>
                  <code className="shrink-0 font-mono text-[12px] text-slate-700 dark:text-slate-200">{path}</code>
                  <span className="text-xs text-slate-400">{desc}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
