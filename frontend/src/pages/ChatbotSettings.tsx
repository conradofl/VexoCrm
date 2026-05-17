import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Bot, Check, ChevronDown, ChevronUp, Clock, Code2, Copy, Eye,
  GripVertical, Pencil, Phone, Plus, Power, Save, Send, Trash2, X, Zap,
} from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";
import { useLeadClients, useUpdateLeadClientN8nSettings } from "@/hooks/useLeadClients";
import {
  useChatbotTemplates, useBuiltinTemplates, useSaveChatbotTemplate, useDeleteChatbotTemplate,
  type ChatbotTemplate, type TemplateField,
} from "@/hooks/useChatbotTemplates";
import { usePrompt, useSavePrompt, type PromptType } from "@/hooks/usePrompts";

const BACKEND_URL = "https://crm.vexoia.com";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildWebhookUrl(clientId: string) {
  return `${BACKEND_URL}/api/hardcoded-chat-webhook?clientId=${encodeURIComponent(clientId)}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "Nunca salvo";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

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

function TabGeral({ clientId, clientName, client }: { clientId: string; clientName: string; client: ReturnType<typeof useLeadClients>["data"][0] }) {
  const { getIdToken, hasPermission } = useAuth();
  const canEdit = hasPermission("empresas.edit") || hasPermission("admin");
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

// ─── Tab: Template ────────────────────────────────────────────────────────────

function emptyTemplate(clientId: string) {
  return {
    clientId,
    client_id: clientId,
    template_key: "",
    display_name: "",
    agent_name: "",
    agent_role: "",
    data_fields: [] as TemplateField[],
    required_fields: [] as string[],
    classification: { quente: "", morno: "", frio: "" },
  };
}

type EditorState = ReturnType<typeof emptyTemplate>;

function FieldEditor({
  field, isRequired, index, total, onUpdate, onToggleRequired, onRemove, onMoveUp, onMoveDown,
}: {
  field: TemplateField; isRequired: boolean; index: number; total: number;
  onUpdate: (p: Partial<TemplateField>) => void; onToggleRequired: () => void;
  onRemove: () => void; onMoveUp: () => void; onMoveDown: () => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-slate-200 dark:border-white/10 p-3">
      <div className="mt-2 flex flex-col gap-0.5 text-slate-400">
        <button onClick={onMoveUp} disabled={index === 0} className="disabled:opacity-30"><ChevronUp className="size-3.5" /></button>
        <GripVertical className="size-3.5" />
        <button onClick={onMoveDown} disabled={index === total - 1} className="disabled:opacity-30"><ChevronDown className="size-3.5" /></button>
      </div>
      <div className="flex-1 grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Chave (key)</Label>
          <Input value={field.key} onChange={(e) => onUpdate({ key: e.target.value.toLowerCase().replace(/\s+/g, "_") })} placeholder="ex: cidade" className="h-8 text-sm" />
        </div>
        <div>
          <Label className="text-xs">Label</Label>
          <Input value={field.label} onChange={(e) => onUpdate({ label: e.target.value })} placeholder="ex: Cidade" className="h-8 text-sm" />
        </div>
        <div className="col-span-2">
          <Label className="text-xs">Descrição (instrução para o agente)</Label>
          <Input value={field.description} onChange={(e) => onUpdate({ description: e.target.value })} placeholder="ex: Cidade onde o lead mora" className="h-8 text-sm" />
        </div>
        <div className="flex items-center gap-2 col-span-2">
          <Switch id={`req-${index}`} checked={isRequired} onCheckedChange={onToggleRequired} />
          <Label htmlFor={`req-${index}`} className="text-xs cursor-pointer">Obrigatório</Label>
        </div>
      </div>
      <Button variant="ghost" size="icon" className="size-7 shrink-0 mt-1 text-red-500" onClick={onRemove}>
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

function TemplateEditorPanel({ initial, clientId, onClose }: { initial: EditorState; clientId: string; onClose: () => void }) {
  const [state, setState] = useState<EditorState>(initial);
  const save = useSaveChatbotTemplate();

  function updateField(idx: number, patch: Partial<TemplateField>) {
    setState((s) => ({ ...s, data_fields: s.data_fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)) }));
  }
  function toggleRequired(key: string) {
    setState((s) => ({
      ...s,
      required_fields: s.required_fields.includes(key)
        ? s.required_fields.filter((k) => k !== key)
        : [...s.required_fields, key],
    }));
  }
  function addField() {
    setState((s) => ({ ...s, data_fields: [...s.data_fields, { key: "", label: "", description: "", required: false }] }));
  }
  function removeField(idx: number) {
    setState((s) => {
      const removed = s.data_fields[idx];
      return { ...s, data_fields: s.data_fields.filter((_, i) => i !== idx), required_fields: s.required_fields.filter((k) => k !== removed.key) };
    });
  }
  function moveField(idx: number, dir: -1 | 1) {
    setState((s) => {
      const arr = [...s.data_fields];
      const target = idx + dir;
      if (target < 0 || target >= arr.length) return s;
      [arr[idx], arr[target]] = [arr[target], arr[idx]];
      return { ...s, data_fields: arr };
    });
  }

  async function handleSave() {
    if (!state.template_key) return toast({ title: "Preencha a chave do template", variant: "destructive" });
    if (!state.display_name) return toast({ title: "Preencha o nome do template", variant: "destructive" });
    try {
      await save.mutateAsync({ ...state, clientId });
      toast({ title: "Template salvo" });
      onClose();
    } catch (e) {
      toast({ title: "Erro ao salvar", description: String(e), variant: "destructive" });
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-base">{initial.template_key ? "Editar template" : "Novo template"}</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose}><X className="size-3.5 mr-1.5" />Cancelar</Button>
          <Button size="sm" onClick={handleSave} disabled={save.isPending}><Save className="size-3.5 mr-1.5" />{save.isPending ? "Salvando…" : "Salvar"}</Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Identidade do Agente</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Chave única (template_key)</Label>
            <Input value={state.template_key} onChange={(e) => setState((s) => ({ ...s, template_key: e.target.value.toLowerCase().replace(/\s+/g, "_") }))} placeholder="ex: outlier_imoveis" className="h-8 text-sm mt-1" />
          </div>
          <div>
            <Label className="text-xs">Nome de exibição</Label>
            <Input value={state.display_name} onChange={(e) => setState((s) => ({ ...s, display_name: e.target.value }))} placeholder="ex: Outlier Imóveis" className="h-8 text-sm mt-1" />
          </div>
          <div>
            <Label className="text-xs">Nome do agente</Label>
            <Input value={state.agent_name} onChange={(e) => setState((s) => ({ ...s, agent_name: e.target.value }))} placeholder="ex: Áureo" className="h-8 text-sm mt-1" />
          </div>
          <div>
            <Label className="text-xs">Cargo / papel</Label>
            <Input value={state.agent_role} onChange={(e) => setState((s) => ({ ...s, agent_role: e.target.value }))} placeholder="ex: SDR da Outlier Consórcios" className="h-8 text-sm mt-1" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Campos de Coleta ({state.data_fields.length})</CardTitle>
            <Button variant="outline" size="sm" onClick={addField}><Plus className="size-3.5 mr-1.5" />Adicionar campo</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {state.data_fields.length === 0 && <p className="text-sm text-slate-400 text-center py-4">Nenhum campo configurado.</p>}
          {state.data_fields.map((field, idx) => (
            <FieldEditor
              key={idx} field={field} isRequired={state.required_fields.includes(field.key)}
              index={idx} total={state.data_fields.length}
              onUpdate={(p) => updateField(idx, p)} onToggleRequired={() => toggleRequired(field.key)}
              onRemove={() => removeField(idx)} onMoveUp={() => moveField(idx, -1)} onMoveDown={() => moveField(idx, 1)}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Classificação SPIN (QUENTE / MORNO / FRIO)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {(["quente", "morno", "frio"] as const).map((tier) => (
            <div key={tier}>
              <Label className={`text-xs font-semibold ${tier === "quente" ? "text-green-600" : tier === "morno" ? "text-yellow-600" : "text-slate-500"}`}>
                {tier.toUpperCase()}
              </Label>
              <Textarea
                value={state.classification[tier]}
                onChange={(e) => setState((s) => ({ ...s, classification: { ...s.classification, [tier]: e.target.value } }))}
                placeholder={tier === "quente" ? "Ex: Objetivo claro, prazo curto, valor informado" : tier === "morno" ? "Ex: Interesse real mas pesquisando" : "Ex: Curioso sem prazo, pouca intenção"}
                rows={2} className="mt-1 text-sm resize-none"
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function TemplateCard({ template, onEdit, onClone, onDelete }: { template: ChatbotTemplate; onEdit: () => void; onClone: () => void; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card className="border border-slate-200 dark:border-white/10">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Bot className="size-4 shrink-0 text-indigo-500" />
            <CardTitle className="truncate text-base">{template.display_name}</CardTitle>
            {template.is_builtin && <Badge variant="secondary" className="shrink-0 text-xs">built-in</Badge>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="icon" className="size-7" onClick={onClone} title="Clonar"><Copy className="size-3.5" /></Button>
            {!template.is_builtin && (
              <>
                <Button variant="ghost" size="icon" className="size-7" onClick={onEdit} title="Editar"><Pencil className="size-3.5" /></Button>
                <Button variant="ghost" size="icon" className="size-7 text-red-500" onClick={onDelete} title="Deletar"><Trash2 className="size-3.5" /></Button>
              </>
            )}
            <Button variant="ghost" size="icon" className="size-7" onClick={() => setExpanded((v) => !v)}>
              {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </Button>
          </div>
        </div>
        <p className="text-xs text-slate-500">{template.agent_name}{template.agent_role && ` · ${template.agent_role}`}</p>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {template.data_fields.map((f) => (
              <Badge key={f.key} variant={template.required_fields.includes(f.key) ? "default" : "outline"} className="text-xs">
                {f.label}{template.required_fields.includes(f.key) ? " *" : ""}
              </Badge>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(["quente", "morno", "frio"] as const).map((tier) => (
              <div key={tier} className="rounded-md border border-slate-100 dark:border-white/10 p-2">
                <p className={`text-xs font-semibold mb-1 ${tier === "quente" ? "text-green-600" : tier === "morno" ? "text-yellow-600" : "text-slate-500"}`}>
                  {tier.charAt(0).toUpperCase() + tier.slice(1)}
                </p>
                <p className="text-xs text-slate-500 line-clamp-2">{template.classification[tier] || "—"}</p>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function TabTemplate({ clientId }: { clientId: string }) {
  const { data: templates = [], isLoading } = useChatbotTemplates(clientId);
  const [editing, setEditing] = useState<EditorState | null>(null);
  const deleteMutation = useDeleteChatbotTemplate();

  const builtins = templates.filter((t) => t.is_builtin);
  const custom = templates.filter((t) => !t.is_builtin);

  function cloneFromBuiltin(t: ChatbotTemplate): EditorState {
    return {
      clientId, client_id: clientId,
      template_key: `${t.template_key}_custom`,
      display_name: `${t.display_name} (cópia)`,
      agent_name: t.agent_name, agent_role: t.agent_role,
      data_fields: t.data_fields.map((f) => ({ ...f })),
      required_fields: [...t.required_fields],
      classification: { ...t.classification },
    };
  }

  async function handleDelete(t: ChatbotTemplate) {
    if (!confirm(`Deletar template "${t.display_name}"?`)) return;
    try {
      await deleteMutation.mutateAsync({ id: t.id, clientId });
      toast({ title: "Template deletado" });
    } catch (e) {
      toast({ title: "Erro ao deletar", description: String(e), variant: "destructive" });
    }
  }

  if (editing) {
    return <TemplateEditorPanel initial={editing} clientId={clientId} onClose={() => setEditing(null)} />;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setEditing(emptyTemplate(clientId))}>
          <Plus className="size-3.5 mr-1.5" />Novo template
        </Button>
      </div>

      {isLoading && <p className="text-sm text-slate-400 text-center py-8">Carregando templates…</p>}

      {!isLoading && builtins.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Templates Built-in</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {builtins.map((t) => (
              <TemplateCard key={t.id} template={t} onEdit={() => {}} onClone={() => setEditing(cloneFromBuiltin(t))} onDelete={() => {}} />
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Templates Personalizados {custom.length > 0 && <span className="normal-case font-normal">({custom.length})</span>}
        </h3>
        {!isLoading && custom.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-white/10 py-12 gap-3">
            <Bot className="size-8 text-slate-300" />
            <p className="text-sm text-slate-400">Nenhum template personalizado ainda.</p>
            <Button variant="outline" size="sm" onClick={() => setEditing(emptyTemplate(clientId))}>
              <Plus className="size-3.5 mr-1.5" />Criar template
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {custom.map((t) => (
              <TemplateCard
                key={t.id} template={t}
                onEdit={() => setEditing({ clientId, client_id: t.client_id, template_key: t.template_key, display_name: t.display_name, agent_name: t.agent_name, agent_role: t.agent_role, data_fields: t.data_fields, required_fields: t.required_fields, classification: t.classification })}
                onClone={() => setEditing(cloneFromBuiltin(t))}
                onDelete={() => handleDelete(t)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab: Prompts ─────────────────────────────────────────────────────────────

const PROMPT_CONFIGS: { type: PromptType; label: string; description: string }[] = [
  { type: "padrao", label: "Prompt Padrão (SPIN)", description: "Usado em todos os atendimentos inbound. Define o fluxo completo de qualificação." },
  { type: "extrato", label: "Extrato SDR", description: "Gera o briefing enviado ao SDR quando o lead finaliza a conversa." },
];

function PromptBlock({ clientId, type, label, description }: { clientId: string; type: PromptType; label: string; description: string }) {
  const { data: prompt, isLoading } = usePrompt(clientId, type);
  const savePrompt = useSavePrompt();
  const [draft, setDraft] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => { setDraft(prompt?.content ?? ""); setIsDirty(false); }, [prompt]);

  async function handleSave() {
    try {
      await savePrompt.mutateAsync({ clientId, type, content: draft });
      setIsDirty(false);
      toast({ title: "Prompt salvo" });
    } catch (e) {
      toast({ title: "Erro ao salvar", description: e instanceof Error ? e.message : "Erro", variant: "destructive" });
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm">{label}</CardTitle>
            <p className="text-xs text-slate-400 mt-0.5">{description}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isDirty && <Badge variant="outline" className="border-amber-300 text-amber-600 text-[10px]">Não salvo</Badge>}
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowPreview((v) => !v)}>
              {showPreview ? <Code2 className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showPreview ? "Editor" : "Preview"}
            </Button>
          </div>
        </div>
        {prompt?.updatedAt && (
          <p className="text-[10px] text-slate-400 flex items-center gap-1 mt-1">
            <Clock className="h-3 w-3" />
            Última edição: {formatDate(prompt.updatedAt)}
            {prompt.updatedByEmail && <> por {prompt.updatedByEmail}</>}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {showPreview ? (
          <div className="min-h-[280px] rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-slate-800/50">
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-700 dark:text-slate-300">{draft || "Sem conteúdo."}</pre>
          </div>
        ) : (
          <Textarea
            value={isLoading ? "" : draft}
            onChange={(e) => { setDraft(e.target.value); setIsDirty(e.target.value !== (prompt?.content ?? "")); }}
            placeholder={isLoading ? "Carregando..." : "Cole ou escreva o prompt aqui..."}
            disabled={isLoading || savePrompt.isPending}
            className="min-h-[280px] resize-y font-mono text-xs leading-relaxed"
          />
        )}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={!isDirty || savePrompt.isPending || isLoading} size="sm" className="gap-1.5">
            <Save className="h-3.5 w-3.5" />
            {savePrompt.isPending ? "Salvando..." : "Salvar prompt"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TabPrompts({ clientId }: { clientId: string }) {
  return (
    <div className="space-y-5 max-w-3xl">
      {PROMPT_CONFIGS.map((p) => (
        <PromptBlock key={p.type} clientId={clientId} type={p.type} label={p.label} description={p.description} />
      ))}
    </div>
  );
}

// ─── Tab: Teste ───────────────────────────────────────────────────────────────

function TabTeste({ clientId }: { clientId: string }) {
  const { getIdToken } = useAuth();
  const [phone] = useState("5511999999999");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversation, setConversation] = useState<{ role: "user" | "bot"; text: string }[]>([]);

  async function handleSend() {
    if (!message.trim()) return;
    const userMsg = message.trim();
    setMessage("");
    setConversation((c) => [...c, { role: "user", text: userMsg }]);
    setLoading(true);
    try {
      const token = await getIdToken();
      const res = await fetchApi(`/api/hardcoded-chat-webhook?clientId=${encodeURIComponent(clientId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ phone, message: userMsg }),
      });
      if (res.ok) {
        const data = await readApiJson<{ chatbotResponse?: { message?: string } }>(res, "chatbot_test");
        const botMsg = data?.chatbotResponse?.message;
        if (botMsg) setConversation((c) => [...c, { role: "bot", text: botMsg }]);
        else setConversation((c) => [...c, { role: "bot", text: "(sem resposta — verifique se o chatbot está ativo e com prompt configurado)" }]);
      } else {
        const err = await readApiErrorMessage(res, "Erro");
        setConversation((c) => [...c, { role: "bot", text: `Erro: ${err}` }]);
      }
    } catch (e) {
      setConversation((c) => [...c, { role: "bot", text: `Falha: ${e instanceof Error ? e.message : "Erro desconhecido"}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <p className="text-sm text-slate-500">
        Simule uma conversa com o chatbot desta empresa. As mensagens usam um número fictício e não chegam ao WhatsApp real.
      </p>

      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="min-h-[320px] max-h-[400px] overflow-y-auto space-y-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-900 p-3">
            {conversation.length === 0 && (
              <p className="text-center text-xs text-slate-400 py-8">Envie uma mensagem para iniciar a conversa.</p>
            )}
            {conversation.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "bg-indigo-500 text-white rounded-br-sm"
                    : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 rounded-bl-sm"
                }`}>
                  {m.text}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-2xl rounded-bl-sm px-3 py-2 text-xs text-slate-400">
                  digitando...
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              placeholder="Digite uma mensagem..."
              disabled={loading}
              className="h-9 text-sm"
            />
            <Button size="sm" className="h-9 gap-1.5" onClick={handleSend} disabled={loading || !message.trim()}>
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>

          {conversation.length > 0 && (
            <Button variant="ghost" size="sm" className="w-full text-xs text-slate-400" onClick={() => setConversation([])}>
              Limpar conversa
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ChatbotSettings() {
  const { canAccessInternalPage } = useAuth();
  const { data: clients = [], isLoading: loadingClients } = useLeadClients();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const tab = searchParams.get("tab") ?? "geral";

  useEffect(() => {
    if (!selectedClientId && clients.length > 0) setSelectedClientId(clients[0].id);
  }, [clients, selectedClientId]);

  const selectedClient = clients.find((c) => c.id === selectedClientId);

  if (!canAccessInternalPage("empresas")) {
    return (
      <PageShell title="Chatbot" subtitle="Acesso restrito">
        <p className="text-sm text-slate-500">Você não tem permissão para acessar esta página.</p>
      </PageShell>
    );
  }

  return (
    <PageShell title="Chatbot" subtitle="Configure o chatbot SPIN por empresa" spacing="space-y-6">
      {/* Seletor de empresa */}
      <div className="flex items-center gap-3">
        <Select value={selectedClientId} onValueChange={setSelectedClientId} disabled={loadingClients}>
          <SelectTrigger className="w-64 h-9 text-sm">
            <SelectValue placeholder={loadingClients ? "Carregando..." : "Selecione a empresa"} />
          </SelectTrigger>
          <SelectContent>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id} className="text-sm">{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedClient && (
          <span className="text-xs text-slate-400 font-mono">{selectedClientId}</span>
        )}
      </div>

      {!selectedClientId ? (
        <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-white/10">
          <p className="text-sm text-slate-400">Selecione uma empresa para configurar o chatbot.</p>
        </div>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setSearchParams({ tab: v })}>
          <TabsList className="h-9">
            <TabsTrigger value="geral" className="text-sm">Geral</TabsTrigger>
            <TabsTrigger value="template" className="text-sm">Template</TabsTrigger>
            <TabsTrigger value="prompts" className="text-sm">Prompts</TabsTrigger>
            <TabsTrigger value="teste" className="text-sm">Teste</TabsTrigger>
          </TabsList>

          <TabsContent value="geral" className="mt-5">
            {selectedClient && (
              <TabGeral clientId={selectedClientId} clientName={selectedClient.name} client={selectedClient} />
            )}
          </TabsContent>

          <TabsContent value="template" className="mt-5">
            <TabTemplate clientId={selectedClientId} />
          </TabsContent>

          <TabsContent value="prompts" className="mt-5">
            <TabPrompts clientId={selectedClientId} />
          </TabsContent>

          <TabsContent value="teste" className="mt-5">
            <TabTeste clientId={selectedClientId} />
          </TabsContent>
        </Tabs>
      )}
    </PageShell>
  );
}
