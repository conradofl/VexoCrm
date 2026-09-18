import { useState, useEffect, useRef } from "react";
import { Check, Copy, Phone, Power, Zap, Cpu, Sparkles, AlertCircle, CheckCircle2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";
import { useLeadClients, useUpdateLeadClientN8nSettings } from "@/hooks/useLeadClients";
import { useFupCompanies } from "@/hooks/useFollowupAdmin";
import { useChatbotTemplates, useBuiltinTemplates, useLlmModels } from "@/hooks/useChatbotTemplates";
import { buildWebhookUrl } from "@/lib/chatbotSettings/helpers";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { hasFeatureUnlocked } from "@/lib/planTier";
import { assertTenantMatch } from "@/lib/tenantIsolation";

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
  const { getIdToken } = useAuth();
  const crmClient = useOptionalCrmClient();
  const currentClient = client || crmClient?.selectedClient;
  const isSdrBroadcastUnlocked = hasFeatureUnlocked(currentClient, "sdr_broadcast");
  const canEdit = true;
  const updateSettings = useUpdateLeadClientN8nSettings();
  const { data: builtinModels = [] } = useBuiltinTemplates(clientId);
  const { data: clientTemplates = [] } = useChatbotTemplates(clientId);
  const { data: llmInfo } = useLlmModels();
  
  const customModels = clientTemplates.filter((t) => !t.is_builtin);
  const llmModels = llmInfo?.models ?? [];
  const providerStatus = llmInfo?.providerStatus ?? { groq: false, openai: false, anthropic: false, gemini: false };

  const n8n = client?.n8n_settings;
  const [enabled, setEnabled] = useState(n8n?.chatbot_enabled ?? false);
  const [model, setModel] = useState(n8n?.chatbot_model ?? "generico");
  const [llmModel, setLlmModel] = useState(n8n?.chatbot_llm_model || "");
  const [sdrNumber, setSdrNumber] = useState("");
  // Lista de destinos do briefing. Vem do backend ja com o numero antigo
  // migrado, entao ninguem perde configuracao.
  const [sdrNumbers, setSdrNumbers] = useState<string[]>(n8n?.sdr_whatsapp_numbers ?? []);
  // Chips que ESTE chatbot atende. Vazio = qualquer chip sem agente inbound.
  const [chipsDoChatbot, setChipsDoChatbot] = useState<string[]>(n8n?.chatbot_instances ?? []);
  const [savingSdr, setSavingSdr] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  // Hidrata UMA VEZ por tenant, e só quando os dados realmente chegaram.
  //
  // Duas tentativas anteriores erraram nos dois extremos: depender do objeto
  // n8n fazia qualquer refetch reescrever a escolha do usuário (o template
  // voltava sozinho ao anterior); depender só de clientId fazia o efeito rodar
  // antes dos dados carregarem e nunca mais, congelando a tela nos valores
  // iniciais ("generico", chatbot desativado) mesmo com o banco correto.
  const hidratadoPara = useRef<string | null>(null);
  useEffect(() => {
    if (!n8n) return;                          // dados ainda não chegaram
    if (hidratadoPara.current === clientId) return; // já hidratou; não sobrescreve edição
    hidratadoPara.current = clientId;
    setEnabled(n8n.chatbot_enabled ?? false);
    setModel(n8n.chatbot_model ?? "generico");
    setLlmModel(n8n.chatbot_llm_model || "");
    // O campo de texto e so a caixa de digitacao; a lista vem do backend ja
    // com o numero antigo migrado.
    setSdrNumber("");
    setSdrNumbers(Array.isArray(n8n.sdr_whatsapp_numbers) ? n8n.sdr_whatsapp_numbers : (n8n.sdr_whatsapp_number ? [n8n.sdr_whatsapp_number] : []));
    setChipsDoChatbot(Array.isArray(n8n.chatbot_instances) ? n8n.chatbot_instances : []);
  }, [clientId, n8n]);

  const webhookUrl = buildWebhookUrl(clientId);
  const evolutionUrl = n8n?.dispatch_webhook_url ?? null;
  const hasEvolution = !!evolutionUrl;

  const defaultBuiltins = [
    { template_key: "generico", agent_name: "Atendente Geral", display_name: "Atendente Geral (Padrão)" },
  ];

  // O backend ja devolve so built-ins globais ou do proprio tenant.
  const availableBuiltins = builtinModels.length > 0 ? builtinModels : defaultBuiltins;

  const allModels = [
    ...availableBuiltins,
    ...customModels.map((m) => ({ template_key: m.template_key, agent_name: m.agent_name, display_name: m.display_name })),
  ];

  async function handleToggle(value: boolean) {
    setEnabled(value);
    try {
      assertTenantMatch(clientId, crmClient?.selectedClientId);
      await updateSettings.mutateAsync({ tenantId: clientId, chatbotEnabled: value });
      toast({ title: value ? "Chatbot ativado" : "Chatbot desativado" });
    } catch (e: any) {
      setEnabled(!value);
      toast({ title: "Erro ao salvar status do chatbot", description: e?.message, variant: "destructive" });
    }
  }

  // O nome real da instancia Evolution fica no fim da URL de disparo do chip.
  const chipsDoTenant = (client?.n8n_settings?.evolution_instances ?? []).filter((i: any) => i.active !== false);
  const nomeInstancia = (chip: any) => {
    const url = chip?.dispatch_webhook_url || "";
    const ultimo = url.split("/").filter(Boolean).pop();
    return (ultimo && !ultimo.includes("?") ? ultimo : chip?.name) || "";
  };

  async function salvarChipsDoChatbot(lista: string[]) {
    const anterior = chipsDoChatbot;
    setChipsDoChatbot(lista);
    try {
      assertTenantMatch(clientId, crmClient?.selectedClientId);
      await updateSettings.mutateAsync({ tenantId: clientId, chatbotInstances: lista });
      toast({
        title: "Chips do chatbot atualizados",
        description: lista.length === 0
          ? "Sem chip marcado: atende qualquer número que não tenha agente inbound."
          : `${lista.length} ${lista.length === 1 ? "chip vinculado" : "chips vinculados"}.`,
      });
    } catch (e: any) {
      setChipsDoChatbot(anterior);
      toast({ title: "Erro ao salvar chips", description: e?.message, variant: "destructive" });
    }
  }

  async function handleModelChange(value: string) {
    const prev = model;
    setModel(value);
    try {
      assertTenantMatch(clientId, crmClient?.selectedClientId);
      // Usa o que o SERVIDOR devolveu, nao o que mandamos. Se o backend gravar
      // outra coisa (ou ignorar o campo), a tela mostra a divergencia na hora em
      // vez de fingir que salvou e "voltar sozinho" depois.
      const salvo = await updateSettings.mutateAsync({ tenantId: clientId, chatbotModel: value });
      const persistido = salvo?.chatbot_model ?? null;
      setModel(persistido ?? value);
      if (persistido !== value) {
        toast({
          title: "O servidor não gravou o template escolhido",
          description: `Enviado: "${value}". Gravado: "${persistido ?? "(nada)"}".`,
          variant: "destructive",
        });
        console.error("[chatbot-settings] divergencia ao salvar template", { enviado: value, persistido, resposta: salvo });
        return;
      }
      const found = allModels.find((m) => m.template_key === value);
      toast({ title: "Template de Persona atualizado", description: found ? `${found.agent_name} — ${found.display_name}` : value });
    } catch (e: any) {
      setModel(prev);
      // Mensagem real do servidor: antes o erro era generico e a selecao
      // simplesmente voltava, parecendo que o sistema "escolhia sozinho".
      toast({
        title: "Erro ao salvar template",
        description: e?.message || "O servidor recusou a alteração.",
        variant: "destructive",
      });
      console.error("[chatbot-settings] falha ao salvar template:", e);
    }
  }

  async function handleLlmModelChange(value: string) {
    const prev = llmModel;
    setLlmModel(value);
    try {
      assertTenantMatch(clientId, crmClient?.selectedClientId);
      await updateSettings.mutateAsync({ tenantId: clientId, chatbotLlmModel: value });
      const found = llmModels.find((m) => m.id === value);
      toast({ title: "Motor de IA atualizado", description: found ? `${found.providerName}: ${found.name}` : value });
    } catch (e: any) {
      setLlmModel(prev);
      toast({ title: "Erro ao salvar modelo LLM", description: e?.message, variant: "destructive" });
    }
  }

  // Mesmo criterio do backend (services/sdrTarget.js): so digitos, 10 a 15.
  // Numero invalido nao entra na lista.
  const sdrNumberValido = /^\d{10,15}$/.test(sdrNumber.replace(/\D/g, ""));

  async function salvarListaSdr(novaLista: string[]) {
    setSavingSdr(true);
    try {
      assertTenantMatch(clientId, crmClient?.selectedClientId);
      await updateSettings.mutateAsync({ tenantId: clientId, sdrWhatsappNumbers: novaLista });
      setSdrNumbers(novaLista);
      toast({ title: "Números SDR salvos" });
    } catch (e: any) {
      toast({ title: "Erro ao salvar números SDR", description: e?.message, variant: "destructive" });
    } finally {
      setSavingSdr(false);
    }
  }

  async function adicionarSdr() {
    const numero = sdrNumber.replace(/\D/g, "");
    if (!sdrNumberValido || sdrNumbers.includes(numero)) return;
    await salvarListaSdr([...sdrNumbers, numero]);
    setSdrNumber("");
  }

  async function removerSdr(numero: string) {
    await salvarListaSdr(sdrNumbers.filter((n) => n !== numero));
  }

  async function handleTestChatbot() {
    setTesting(true);
    setTestResult(null);
    try {
      const token = await getIdToken();
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      // /api/chatbot-ai/test-direct NUNCA existiu no backend — 404 desde sempre.
      // A rota real e /api/chatbot-test, que roda o processBatch de verdade
      // (prompt do tenant + agente inbound do chip) e devolve a resposta gerada.
      const path = "/api/chatbot-test";
      const res = await fetchApi(path, {
        method: "POST",
        headers,
        body: JSON.stringify({
          clientId,
          message: "Olá, teste de conexão do chatbot",
          // Testa o agente do chip marcado; sem chip, testa o chatbot do tenant.
          instanceName: chipsDoChatbot[0] ?? undefined,
        }),
      });

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        // Antes caia em "Resposta HTML inesperada da API." — generico demais para
        // achar que o problema era rota inexistente. Agora diz status e caminho.
        setTestResult(
          `Erro ${res.status} em ${path}: a API respondeu ${contentType || "sem content-type"} em vez de JSON.` +
            (res.status === 404 ? " A rota nao existe no backend implantado." : "")
        );
        return;
      }

      if (res.ok) {
        const data = await res.json();
        setTestResult(
          data?.response ??
            data?.reason ??
            "Conexão OK — o chatbot não retornou mensagem (prompt não configurado ou desativado)."
        );
      } else {
        const err = await readApiErrorMessage(res, "Erro");
        setTestResult(`Erro ${res.status} em ${path}: ${err}`);
      }
    } catch (e) {
      setTestResult(`Falha: ${e instanceof Error ? e.message : "Erro desconhecido"}`);
    } finally {
      setTesting(false);
    }
  }

  const defaultLlmModel = llmInfo?.defaultModel || "openai/gpt-oss-120b";
  const isCustomModel = Boolean(llmModel && llmModels.some((m) => m.id === llmModel));
  const isDeadModel = Boolean(llmModel && llmModels.length > 0 && !llmModels.some((m) => m.id === llmModel));
  const effectiveLlmModel = isCustomModel ? llmModel : defaultLlmModel;
  const defaultModelName = llmModels.find((m) => m.id === defaultLlmModel)?.name || defaultLlmModel;

  const groqModels = llmModels.filter((m) => m.provider === "groq");
  const openaiModels = llmModels.filter((m) => m.provider === "openai");
  const anthropicModels = llmModels.filter((m) => m.provider === "anthropic");
  const geminiModels = llmModels.filter((m) => m.provider === "gemini");

  const isChipMarcado = (chip: any) => {
    const inst = nomeInstancia(chip);
    const url = chip?.dispatch_webhook_url || "";
    const ultimo = url.split("/").filter(Boolean).pop() || "";
    return (
      chipsDoChatbot.includes(inst) ||
      (chip.id && chipsDoChatbot.includes(chip.id)) ||
      (chip.name && chipsDoChatbot.includes(chip.name)) ||
      (ultimo && chipsDoChatbot.includes(ultimo))
    );
  };

  const hasOrphanChips =
    enabled &&
    chipsDoChatbot.length > 0 &&
    chipsDoTenant.length > 0 &&
    !chipsDoTenant.some((chip: any) => isChipMarcado(chip));

  // "Padrões da empresa": este chatbot é o destino de todo chip que não tem
  // agente próprio (a aba Agentes). Sem esta lista, ninguém sabia quais
  // números estão nessa situação sem ir contar um a um.
  const { data: fupCompanies = [] } = useFupCompanies(clientId);
  const chipsComAgente = new Set<string>();
  fupCompanies.forEach((c: any) => {
    const lista = Array.isArray(c.evolution_instances) && c.evolution_instances.length > 0
      ? c.evolution_instances
      : (c.evolution_instance ? [c.evolution_instance] : []);
    lista.forEach((v: string) => v && chipsComAgente.add(v));
  });
  const chipTemAgente = (chip: any) => {
    const inst = nomeInstancia(chip);
    return chipsComAgente.has(inst) || (chip.id && chipsComAgente.has(chip.id)) || (chip.name && chipsComAgente.has(chip.name));
  };
  const chipsSemAgente = chipsDoTenant.filter((chip: any) => !chipTemAgente(chip));

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Status */}
      <Card>
        <CardContent className="pt-5 space-y-4">
          {hasOrphanChips && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 flex items-start gap-2.5 text-xs text-red-800 dark:text-red-300">
              <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5 min-w-0 flex-1">
                <p className="font-bold">Atenção: Chip configurado desconectado ou renomeado</p>
                <p className="text-[11px] text-red-700/90 dark:text-red-300/90 leading-normal">
                  O chip salvo nas configurações deste chatbot ({chipsDoChatbot.join(", ")}) não corresponde a nenhuma instância WhatsApp conectada no momento.
                  Selecione o chip ativo abaixo para garantir que as mensagens dos leads sejam respondidas.
                </p>
              </div>
            </div>
          )}

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

          {/* Campo "Nome do Agente de IA (Persona)" removido: o nome vive no
              template (aba Template -> Nome do agente), que e a fonte usada
              pelo motor. Ter os dois divergia sem o usuario perceber. */}

          {/* Chips atendidos por este chatbot */}
          {canEdit && (
            <div className="space-y-1.5 pt-1">
              <Label className="text-xs text-slate-500 font-medium">
                Chips que este chatbot atende
              </Label>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex h-8 w-full items-center justify-between rounded-md border border-input bg-white px-2 text-xs dark:bg-slate-900"
                  >
                    <span className="truncate">
                      {chipsDoChatbot.length === 0
                        ? "Todos sem agente inbound"
                        : `${chipsDoChatbot.length} ${chipsDoChatbot.length === 1 ? "chip" : "chips"}`}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(24rem,calc(100vw-2rem))] p-1" align="start">
                  <div className="max-h-56 overflow-y-auto">
                    {chipsDoTenant.length === 0 && (
                      <p className="px-2 py-3 text-xs text-slate-400">
                        Nenhum chip conectado. Conecte em "Chips WhatsApp".
                      </p>
                    )}
                    {chipsDoTenant.map((chip: any) => {
                      const inst = nomeInstancia(chip);
                      const marcado = isChipMarcado(chip);
                      return (
                        <label key={chip.id || chip.name || inst} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-xs hover:bg-accent">
                          <Checkbox
                            checked={marcado}
                            onCheckedChange={() => {
                              const semEste = chipsDoChatbot.filter((i) => i !== inst && i !== chip.id && i !== chip.name);
                              void salvarChipsDoChatbot(marcado ? semEste : [...semEste, inst]);
                            }}
                          />
                          <span className="truncate">{chip.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
              <p className="text-[11px] text-slate-500">
                Sem nenhum marcado, o chatbot atende qualquer chip que não esteja em um agente inbound.
              </p>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5 text-[11px] dark:border-slate-800 dark:bg-slate-900/40">
                {chipsSemAgente.length === 0 ? (
                  <span className="text-slate-500">Todo chip conectado já tem um agente na aba Agentes.</span>
                ) : (
                  <span className="text-slate-600 dark:text-slate-300">
                    <strong>{chipsSemAgente.length}</strong> {chipsSemAgente.length === 1 ? "chip sem agente" : "chips sem agente"} — é este chatbot padrão que responde por{" "}
                    {chipsSemAgente.map((c: any) => c.name).join(", ")}.
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Template de Modelo Personalizado */}
          <div className="space-y-1.5 pt-1">
            <Label className="text-xs text-slate-500 font-medium flex items-center gap-1.5">
              Template Base de Instruções
            </Label>
            <Select value={model} onValueChange={handleModelChange} disabled={updateSettings.isPending}>
              <SelectTrigger className="h-8 text-xs bg-white dark:bg-slate-900">
                <SelectValue placeholder="Selecione um template..." />
              </SelectTrigger>
              <SelectContent>
                {/* Template salvo que nao esta mais na lista (ex.: persona de
                    cliente encerrado) aparece marcado, em vez do campo em
                    branco que nao dizia nada ao usuario. */}
                {model && !allModels.some((m) => m.template_key === model) && (
                  <SelectItem value={model} className="text-xs text-amber-600">
                    {model} — não disponível para esta empresa
                  </SelectItem>
                )}
                {allModels.map((m) => (
                  <SelectItem key={m.template_key} value={m.template_key} className="text-xs">
                    {m.agent_name || m.display_name} — {m.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Motor de Inteligência LLM */}
          <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-white/5">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-slate-500 font-medium flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5 text-purple-500" /> Provedor & Motor de IA (LLM)
              </Label>
              {!isCustomModel && (
                <span className="text-[10px] text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/40 px-1.5 py-0.5 rounded border border-purple-200 dark:border-purple-800 font-normal">
                  Padrão do Sistema ({defaultModelName})
                </span>
              )}
            </div>

            <Select value={effectiveLlmModel} onValueChange={handleLlmModelChange} disabled={updateSettings.isPending}>
              <SelectTrigger className="h-8 text-xs bg-white dark:bg-slate-900">
                <SelectValue placeholder="Selecione o motor de IA..." />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel className="text-[10px] font-semibold uppercase text-purple-600 dark:text-purple-400">
                    ⚡ Groq (Ultra-rápido)
                  </SelectLabel>
                  {groqModels.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      {m.name}{m.id === defaultLlmModel ? " (Padrão)" : ""}
                    </SelectItem>
                  ))}
                </SelectGroup>

                <SelectGroup>
                  <SelectLabel className="text-[10px] font-semibold uppercase text-emerald-600 dark:text-emerald-400">
                    🤖 ChatGPT (OpenAI)
                  </SelectLabel>
                  {openaiModels.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      {m.name}{m.id === defaultLlmModel ? " (Padrão)" : ""}
                    </SelectItem>
                  ))}
                </SelectGroup>

                <SelectGroup>
                  <SelectLabel className="text-[10px] font-semibold uppercase text-amber-600 dark:text-amber-400">
                    🧠 Claude (Anthropic)
                  </SelectLabel>
                  {anthropicModels.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      {m.name}{m.id === defaultLlmModel ? " (Padrão)" : ""}
                    </SelectItem>
                  ))}
                </SelectGroup>

                <SelectGroup>
                  <SelectLabel className="text-[10px] font-semibold uppercase text-blue-600 dark:text-blue-400">
                    ✨ Gemini (Google)
                  </SelectLabel>
                  {geminiModels.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      {m.name}{m.id === defaultLlmModel ? " (Padrão)" : ""}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>

            {isDeadModel && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                O modelo salvo ("{llmModel}") não está mais disponível. O agente está usando o padrão do sistema ({defaultModelName}). Escolha um modelo e salve para atualizar.
              </p>
            )}

            {/* Status de chaves de API no servidor */}
            <div className="rounded-md border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-slate-900/50 p-2.5 space-y-2">
              <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 flex items-center justify-between">
                <span>Status das Chaves de API no Servidor (Easypanel):</span>
              </p>
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <div className="flex items-center gap-1.5">
                  {providerStatus.groq ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <AlertCircle className="h-3 w-3 text-amber-500" />}
                  <span className={providerStatus.groq ? "text-slate-700 dark:text-slate-200" : "text-slate-400"}>
                    Groq (GROQ_API_KEY)
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  {providerStatus.openai ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <AlertCircle className="h-3 w-3 text-amber-500" />}
                  <span className={providerStatus.openai ? "text-slate-700 dark:text-slate-200" : "text-slate-400"}>
                    OpenAI (OPENAI_API_KEY)
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  {providerStatus.anthropic ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <AlertCircle className="h-3 w-3 text-amber-500" />}
                  <span className={providerStatus.anthropic ? "text-slate-700 dark:text-slate-200" : "text-slate-400"}>
                    Claude (ANTHROPIC_API_KEY)
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  {providerStatus.gemini ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <AlertCircle className="h-3 w-3 text-amber-500" />}
                  <span className={providerStatus.gemini ? "text-slate-700 dark:text-slate-200" : "text-slate-400"}>
                    Gemini (GEMINI_API_KEY)
                  </span>
                </div>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200 dark:border-white/10">
                💡 <em>Dica: Adicione as chaves de API nas variáveis do Easypanel para habilitar cada provedor.</em>
              </p>
            </div>
          </div>

          {/* SDR — lista de destinos do briefing, usada pelos DOIS agentes */}
          <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-white/5">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-slate-500 font-medium flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 text-primary" /> Números SDR/Closer (recebem o briefing)
              </Label>
              <span className="text-[10px] text-muted-foreground font-semibold">
                {sdrNumbers.length} {sdrNumbers.length === 1 ? "número ativo" : "números ativos"}
              </span>
            </div>

            {sdrNumbers.length > 0 ? (
              <div className="space-y-1.5">
                {sdrNumbers.map((numero) => (
                  <div
                    key={numero}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-white/10 dark:bg-slate-800/50"
                  >
                    <span className="text-xs font-mono text-slate-700 dark:text-slate-200">{numero}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px] text-red-500 hover:text-red-600 hover:bg-red-500/10"
                      onClick={() => removerSdr(numero)}
                      disabled={savingSdr}
                    >
                      Excluir
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                Nenhum número cadastrado — ninguém receberá o briefing.
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <Input
                value={sdrNumber}
                onChange={(e) => setSdrNumber(e.target.value)}
                placeholder="5511999999999"
                className="h-8 text-xs font-mono"
                disabled={savingSdr}
              />
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 h-8 text-xs font-semibold"
                onClick={adicionarSdr}
                disabled={savingSdr || !sdrNumberValido}
                title={sdrNumber && !sdrNumberValido ? "Número inválido: use só dígitos, 10 a 15" : undefined}
              >
                {savingSdr ? "..." : "Adicionar"}
              </Button>
            </div>
            {sdrNumber !== "" && !sdrNumberValido && (
              <p className="text-[10px] text-red-500">Número inválido: só dígitos, de 10 a 15.</p>
            )}

            {/* Banner de Upsell para Múltiplos Números / SDR Broadcast (Apenas Plano Essencial) */}
            {!isSdrBroadcastUnlocked && (
              <div className="rounded-xl border border-purple-500/30 bg-gradient-to-r from-purple-500/10 via-card to-purple-500/5 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-sm mt-2">
                <div className="flex items-start gap-2 text-foreground">
                  <Sparkles className="w-4 h-4 text-purple-500 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <span className="font-bold text-slate-800 dark:text-slate-100 block">
                      Deseja adicionar múltiplos números de atendimento e distribuir por equipe?
                    </span>
                    <span className="text-[11px] text-muted-foreground block">
                      O <strong>SDR Broadcast Multiatendentes</strong> encaminha os briefings e distribui leads qualificados entre seus closers em tempo real.
                    </span>
                  </div>
                </div>

                <Button
                  size="sm"
                  className="h-8 text-xs font-bold bg-gradient-to-r from-amber-600 to-purple-600 hover:from-amber-700 hover:to-purple-700 text-white shrink-0 gap-1.5 shadow-sm"
                  onClick={() => {
                    const msg = "Olá! Gostaria de adicionar múltiplos números de atendimento e habilitar o SDR Broadcast no meu plano.";
                    window.open(`https://wa.me/5511999999999?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
                  }}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Fazer Upgrade 🚀
                </Button>
              </div>
            )}
          </div>
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

          <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={handleTestChatbot} disabled={testing || !enabled}>
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
