import { useState, useEffect } from "react";
import { Check, Copy, Phone, Power, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";
import { useLeadClients, useUpdateLeadClientN8nSettings } from "@/hooks/useLeadClients";
import { useChatbotTemplates, useBuiltinTemplates } from "@/hooks/useChatbotTemplates";
import { buildWebhookUrl } from "@/lib/chatbotSettings/helpers";

// ─── CopyButton ───────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="ml-1 rounded p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
      title="Copiar"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

// ─── Tab: Geral ───────────────────────────────────────────────────────────────

export function TabGeral({ clientId, clientName, client }: { clientId: string; clientName: string; client: ReturnType<typeof useLeadClients>["data"][0] }) {
  const { getIdToken, hasPermission } = useAuth();
  const canEdit = hasPermission("empresas.edit" as import("@/lib/access").AccessPermission) || hasPermission("admin" as import("@/lib/access").AccessPermission);
  const updateSettings = useUpdateLeadClientN8nSettings();
  const { data: builtinModels = [] } = useBuiltinTemplates();
  const { data: clientTemplates = [] } = useChatbotTemplates(clientId);
  const customModels = clientTemplates.filter((t) => !t.is_builtin);

  const n8n = client?.n8n_settings;
  const [enabled, setEnabled] = useState(n8n?.chatbot_enabled ?? false);
  const [model, setModel] = useState(n8n?.chatbot_model ?? "");
  const [sdrNumber, setSdrNumber] = useState(n8n?.sdr_whatsapp_number ?? "");
  const [savingSdr, setSavingSdr] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(n8n?.chatbot_enabled ?? false);
    setModel(n8n?.chatbot_model ?? "");
    setSdrNumber(n8n?.sdr_whatsapp_number ?? "");
  }, [clientId, n8n]);

  const webhookUrl = buildWebhookUrl(clientId);
  const evolutionUrl = n8n?.dispatch_webhook_url ?? null;
  const hasEvolution = !!evolutionUrl;

  const allModels = [
    ...builtinModels,
    ...customModels.map((m) => ({ template_key: m.template_key, agent_name: m.agent_name, display_name: m.display_name })),
  ];

  async function handleToggle(value: boolean) {
    setEnabled(value);
    try {
      await updateSettings.mutateAsync({ tenantId: clientId, chatbotEnabled: value });
      toast({ title: value ? "Chatbot ativado" : "Chatbot desativado" });
    } catch {
      setEnabled(!value);
      toast({ title: "Erro ao salvar", variant: "destructive" });
    }
  }

  async function handleModelChange(value: string) {
    const prev = model;
    setModel(value);
    try {
      await updateSettings.mutateAsync({ tenantId: clientId, chatbotModel: value });
      const found = allModels.find((m) => m.template_key === value);
      toast({ title: "Modelo atualizado", description: found ? `${found.agent_name} — ${found.display_name}` : value });
    } catch {
      setModel(prev);
      toast({ title: "Erro ao salvar modelo", variant: "destructive" });
    }
  }

  async function handleSaveSdr() {
    setSavingSdr(true);
    try {
      await updateSettings.mutateAsync({ tenantId: clientId, sdrWhatsappNumber: sdrNumber || null });
      toast({ title: "Número SDR salvo" });
    } catch {
      toast({ title: "Erro ao salvar", variant: "destructive" });
    } finally {
      setSavingSdr(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const token = await getIdToken();
      const res = await fetchApi(`/api/hardcoded-chat-webhook?clientId=${encodeURIComponent(clientId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ phone: "5511999999999", message: "Olá" }),
      });
      if (res.ok) {
        const data = await readApiJson<{ chatbotResponse?: { message?: string } }>(res, "chatbot_test");
        setTestResult(data?.chatbotResponse?.message ?? "Conexão OK — sem resposta retornada");
      } else {
        const err = await readApiErrorMessage(res, "Erro");
        setTestResult(`Erro: ${err}`);
      }
    } catch (e) {
      setTestResult(`Falha: ${e instanceof Error ? e.message : "Erro desconhecido"}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Status */}
      <Card>
        <CardContent className="pt-5 space-y-4">
          {canEdit && (
            <div className={`flex items-center justify-between rounded-lg border px-3 py-2.5 transition-colors ${
              enabled
                ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800/50 dark:bg-emerald-900/10"
                : "border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-slate-800/50"
            }`}>
              <div className="flex items-center gap-2">
                <Power className={`h-4 w-4 ${enabled ? "text-emerald-500" : "text-slate-400"}`} />
                <div>
                  <p className={`text-sm font-medium leading-none ${enabled ? "text-emerald-700 dark:text-emerald-300" : ""}`}>
                    {enabled ? "Chatbot ativo" : "Chatbot desativado"}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {enabled ? "Responde automaticamente no WhatsApp" : "Mensagens ignoradas pelo bot"}
                  </p>
                </div>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={handleToggle}
                disabled={updateSettings.isPending}
                aria-label="Ativar chatbot"
              />
            </div>
          )}

          {/* Modelo */}
          {canEdit && (
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">Modelo de chatbot</Label>
              <Select value={model} onValueChange={handleModelChange} disabled={updateSettings.isPending}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione um modelo..." />
                </SelectTrigger>
                <SelectContent>
                  {builtinModels.map((m) => (
                    <SelectItem key={m.template_key} value={m.template_key} className="text-xs">
                      {m.agent_name} — {m.display_name}
                    </SelectItem>
                  ))}
                  {customModels.length > 0 && (
                    <>
                      <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        Personalizados
                      </div>
                      {customModels.map((m) => (
                        <SelectItem key={m.template_key} value={m.template_key} className="text-xs">
                          {m.agent_name} — {m.display_name}
                        </SelectItem>
                      ))}
                    </>
                  )}
                </SelectContent>
              </Select>
              {!model && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Nenhum modelo selecionado — chatbot ficará silencioso.
                </p>
              )}
            </div>
          )}

          {/* SDR */}
          {canEdit && (
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500 flex items-center gap-1">
                <Phone className="h-3 w-3" /> Número SDR/Closer (recebe briefing)
              </Label>
              <div className="flex gap-2">
                <Input
                  value={sdrNumber}
                  onChange={(e) => setSdrNumber(e.target.value)}
                  placeholder="5511999999999"
                  className="h-8 text-xs font-mono"
                  disabled={savingSdr}
                />
                <Button variant="outline" size="sm" className="shrink-0 h-8 text-xs" onClick={handleSaveSdr} disabled={savingSdr}>
                  {savingSdr ? "..." : "Salvar"}
                </Button>
              </div>
              {sdrNumber && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  Briefing enviado automaticamente ao finalizar conversa
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* URLs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Integração Evolution</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500">URL do Webhook (cole na Evolution)</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex cursor-default items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-slate-800/50">
                  <span className="flex-1 truncate font-mono text-xs text-slate-700 dark:text-slate-300">{webhookUrl}</span>
                  <CopyButton text={webhookUrl} />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-sm break-all font-mono text-xs">{webhookUrl}</TooltipContent>
            </Tooltip>
          </div>

          {evolutionUrl && (
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">Instância Evolution (envio)</Label>
              <div className="flex cursor-default items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-slate-800/50">
                <span className="flex-1 truncate font-mono text-xs text-slate-600 dark:text-slate-400">{evolutionUrl}</span>
                <CopyButton text={evolutionUrl} />
              </div>
            </div>
          )}

          {!hasEvolution && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              URL de envio não configurada. Configure em <strong>Empresas</strong>.
            </p>
          )}

          <div className="rounded-lg bg-indigo-50 px-3 py-2.5 text-xs text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300 space-y-1">
            <p className="font-medium">Como configurar na Evolution:</p>
            <ol className="list-decimal list-inside space-y-0.5 text-indigo-600 dark:text-indigo-400">
              <li>Abra o painel da Evolution → instância desta empresa</li>
              <li>Vá em <strong>Webhook</strong> e cole a URL acima</li>
              <li>Habilite os eventos: <code className="rounded bg-indigo-100 px-1 dark:bg-indigo-800">MESSAGES_UPSERT</code></li>
              <li>Salve e teste enviando uma mensagem</li>
            </ol>
          </div>

          <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={handleTest} disabled={testing || !enabled}>
            <Zap className={`h-3.5 w-3.5 ${testing ? "animate-pulse" : ""}`} />
            {testing ? "Testando..." : "Testar webhook"}
          </Button>

          {testResult && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-slate-900">
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Resposta:</p>
              <p className="text-xs font-mono text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{testResult}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
