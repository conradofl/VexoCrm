import { useState } from "react";
import { Bot, Copy, Check, Settings2, Zap, Power } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLeadClients, useUpdateLeadClientN8nSettings } from "@/hooks/useLeadClients";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage } from "@/lib/api";
import { toast } from "@/components/ui/use-toast";

const BACKEND_URL = "https://crm.vexoia.com";

function buildWebhookUrl(clientId: string) {
  return `${BACKEND_URL}/api/hardcoded-chat-webhook?clientId=${encodeURIComponent(clientId)}`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="ml-1 rounded p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
      title="Copiar"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

interface ClientChatbotCardProps {
  clientId: string;
  clientName: string;
  hasEvolutionConfigured: boolean;
  evolutionUrl: string | null;
  chatbotEnabled: boolean;
}

function ClientChatbotCard({ clientId, clientName, hasEvolutionConfigured, evolutionUrl, chatbotEnabled: initialEnabled }: ClientChatbotCardProps) {
  const webhookUrl = buildWebhookUrl(clientId);
  const { getIdToken, hasPermission } = useAuth();
  const [testing, setTesting] = useState(false);
  const [enabled, setEnabled] = useState(initialEnabled);
  const canEdit = hasPermission("empresas.edit") || hasPermission("admin");
  const updateSettings = useUpdateLeadClientN8nSettings();

  const handleToggleChatbot = async (value: boolean) => {
    setEnabled(value);
    try {
      await updateSettings.mutateAsync({ tenantId: clientId, chatbotEnabled: value });
      toast({
        title: value ? "Chatbot ativado" : "Chatbot desativado",
        description: `${clientName}: chatbot ${value ? "habilitado" : "desabilitado"} com sucesso.`,
      });
    } catch (e) {
      setEnabled(!value);
      toast({
        title: "Erro ao salvar",
        description: e instanceof Error ? e.message : "Erro desconhecido",
        variant: "destructive",
      });
    }
  };

  const handleTestWebhook = async () => {
    setTesting(true);
    try {
      const token = await getIdToken();
      const res = await fetchApi(`/api/hardcoded-chat-webhook?clientId=${encodeURIComponent(clientId)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ phone: "5511999999999", message: null }),
      });

      if (res.ok) {
        const data = await res.json();
        toast({
          title: "Chatbot respondeu",
          description: data.chatbotResponse?.message?.slice(0, 100) || "Conexão OK",
        });
      } else {
        const errText = await readApiErrorMessage(res, "Erro");
        toast({ title: "Erro no teste", description: errText, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Falha na conexão", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className={`border-slate-200 dark:border-white/10 transition-opacity ${!enabled ? "opacity-60" : ""}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className={`h-4 w-4 shrink-0 ${enabled ? "text-indigo-500" : "text-slate-400"}`} />
              <span className="truncate">{clientName}</span>
            </CardTitle>
            <CardDescription className="mt-0.5 font-mono text-xs">{clientId}</CardDescription>
          </div>
          <Badge variant={hasEvolutionConfigured ? "default" : "outline"} className="shrink-0 text-xs">
            {hasEvolutionConfigured ? "Evolution OK" : "Sem Evolution"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Toggle chatbot habilitado */}
        {canEdit && (
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-white/10 dark:bg-slate-800/50">
            <div className="flex items-center gap-2">
              <Power className={`h-4 w-4 ${enabled ? "text-emerald-500" : "text-slate-400"}`} />
              <div>
                <p className="text-sm font-medium leading-none">{enabled ? "Chatbot ativo" : "Chatbot desativado"}</p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {enabled ? "Responde automaticamente no WhatsApp" : "Mensagens ignoradas pelo bot"}
                </p>
              </div>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={handleToggleChatbot}
              disabled={updateSettings.isPending}
              aria-label={`Habilitar chatbot para ${clientName}`}
            />
          </div>
        )}

        {/* URL do Webhook */}
        <div className="space-y-1.5">
          <Label className="text-xs text-slate-500 dark:text-slate-400">URL do Webhook (cole na Evolution)</Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex cursor-default items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-slate-800/50">
                <span className="flex-1 truncate font-mono text-xs text-slate-700 dark:text-slate-300">
                  {webhookUrl}
                </span>
                <CopyButton text={webhookUrl} />
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-sm break-all font-mono text-xs">
              {webhookUrl}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* URL da Evolution configurada */}
        {evolutionUrl && (
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500 dark:text-slate-400">Instância Evolution (envio)</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex cursor-default items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-slate-800/50">
                  <span className="flex-1 truncate font-mono text-xs text-slate-600 dark:text-slate-400">
                    {evolutionUrl}
                  </span>
                  <CopyButton text={evolutionUrl} />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-sm break-all font-mono text-xs">
                {evolutionUrl}
              </TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Instruções */}
        <div className="rounded-lg bg-indigo-50 px-3 py-2.5 text-xs text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300 space-y-1">
          <p className="font-medium">Como configurar na Evolution:</p>
          <ol className="list-decimal list-inside space-y-0.5 text-indigo-600 dark:text-indigo-400">
            <li>Abra o painel da Evolution → instância desta empresa</li>
            <li>Vá em <strong>Webhook</strong> e cole a URL acima</li>
            <li>Habilite os eventos: <code>MESSAGES_UPSERT</code> e <code>SEND_MESSAGE</code></li>
            <li>Salve e teste enviando uma mensagem</li>
          </ol>
        </div>

        {/* Botão de teste */}
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-1.5"
          onClick={handleTestWebhook}
          disabled={testing || !enabled}
        >
          <Zap className={`h-3.5 w-3.5 ${testing ? "animate-pulse" : ""}`} />
          {testing ? "Testando..." : "Testar chatbot"}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function ChatbotConfig() {
  const { data: clients = [], isLoading } = useLeadClients();
  const { canAccessInternalPage } = useAuth();

  if (!canAccessInternalPage("empresas")) {
    return (
      <PageShell title="Configuração do Chatbot" subtitle="Acesso restrito">
        <p className="text-sm text-slate-500">Você não tem permissão para acessar esta página.</p>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Configuração do Chatbot"
      subtitle="Gerencie a integração do chatbot SPIN com a Evolution API por empresa"
      spacing="space-y-6"
    >
      {/* Info geral */}
      <Card className="border-indigo-200 bg-indigo-50/50 dark:border-indigo-800 dark:bg-indigo-900/10">
        <CardContent className="pt-4">
          <div className="flex gap-3">
            <Settings2 className="h-5 w-5 shrink-0 text-indigo-500 mt-0.5" />
            <div className="space-y-1 text-sm text-indigo-800 dark:text-indigo-300">
              <p className="font-medium">Como funciona</p>
              <p className="text-indigo-700 dark:text-indigo-400">
                Cada empresa tem uma URL de webhook única com seu <code className="rounded bg-indigo-100 px-1 dark:bg-indigo-800">clientId</code>.
                Cole essa URL na Evolution API da empresa para ativar o chatbot SPIN automaticamente.
              </p>
              <p className="text-indigo-700 dark:text-indigo-400">
                A URL de envio (instância Evolution) é configurada na aba <strong>Empresas</strong> do CRM.
                Use o toggle para habilitar ou desabilitar o chatbot por empresa sem remover a configuração.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista de empresas */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : clients.length === 0 ? (
        <p className="text-center text-sm text-slate-400 py-12">Nenhuma empresa cadastrada.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {clients.map((client) => (
            <ClientChatbotCard
              key={client.id}
              clientId={client.id}
              clientName={client.name}
              hasEvolutionConfigured={!!client.n8n_settings?.dispatch_webhook_url}
              evolutionUrl={client.n8n_settings?.dispatch_webhook_url ?? null}
              chatbotEnabled={client.n8n_settings?.chatbot_enabled ?? false}
            />
          ))}
        </div>
      )}
    </PageShell>
  );
}
