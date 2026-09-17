import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Bot, Save, AlertCircle, Sparkles, Smartphone, Plus, Trash2, Send, Zap, ChevronDown, Megaphone, Headset, Database, Cpu, PhoneForwarded, UserRound } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { cn } from "@/lib/utils";
import { useCreateFupCompany, useFupCompanies, useUpdateFupCompany } from "@/hooks/useFollowupAdmin";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi } from "@/lib/api";
import { useLeadClients, useUpdateLeadClientN8nSettings } from "@/hooks/useLeadClients";
import { useLlmModels } from "@/hooks/useChatbotTemplates";
import { assertTenantMatch } from "@/lib/tenantIsolation";
import { AgentInstructionAuditPanel } from "@/components/agente/AgentInstructionAuditPanel";
import { AgentKnowledgeBaseSection } from "@/components/agente/AgentKnowledgeBaseSection";

// Empresa "de mentira" mostrada quando o tenant ainda nao tem linha em
// followup_companies. Salvar com ela cria a linha de verdade.
const PLACEHOLDER_COMPANY_ID = "__sem_empresa__";
// O nome real da instancia Evolution fica no fim da URL de disparo do chip.
function instanceNameFromChip(chip: { name?: string; dispatch_webhook_url?: string | null }) {
  const url = chip?.dispatch_webhook_url || "";
  const last = url.split("/").filter(Boolean).pop();
  return (last && !last.includes("?") ? last : chip?.name) || "";
}

export default function InboundAgentConfig() {
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const crmClient = useOptionalCrmClient();
  const { getIdToken } = useAuth();
  const selectedClientId = crmClient?.selectedClientId || "";

  const [activeTab, setActiveTab] = useState("identidade");

  const { data: rawCompanies = [], isLoading: loadingCompanies } = useFupCompanies(selectedClientId);
  // useMemo obrigatorio: sem ele o fallback criava um array (e um objeto de
  // empresa) NOVOS a cada render. Como o efeito que preenche o formulario
  // depende de activeCompany, ele rodava a cada render e resetava todos os
  // campos — nenhum switch ou select conseguia mudar de valor.
  const companies = useMemo(
    () =>
      rawCompanies.length > 0
        ? rawCompanies
        : [{ id: PLACEHOLDER_COMPANY_ID, name: "Agente ainda não criado", company_name: "Agente ainda não criado", evolution_instance: "" } as any],
    [rawCompanies]
  );

  // Chips conectados do tenant: sao eles que devem aparecer como "numero"
  // deste agente. Cada chip vira uma linha propria em followup_companies, entao
  // varios numeros de atendimento funcionam sem mudar schema.
  const { data: leadClients = [] } = useLeadClients();
  const chips = useMemo(() => {
    const tenant = leadClients.find((c) => c.id === selectedClientId);
    return (tenant?.n8n_settings?.evolution_instances ?? []).filter((i) => i.active !== false);
  }, [leadClients, selectedClientId]);

  // Lista de SDR do TENANT — a mesma que o disparo usa. O backend ja resolve por
  // ela (services/sdrTarget.js: resolveSdrTarget), entao aqui e so leitura: mostrar
  // quem recebe hoje evita a impressao de que o inbound so aceita um numero.
  const sdrNumbersDoTenant = useMemo(() => {
    const tenant = leadClients.find((c) => c.id === selectedClientId);
    const lista = tenant?.n8n_settings?.sdr_whatsapp_numbers;
    if (Array.isArray(lista) && lista.length > 0) return lista;
    const unico = tenant?.n8n_settings?.sdr_whatsapp_number;
    return unico ? [unico] : [];
  }, [leadClients, selectedClientId]);

  const [companyId, setCompanyId] = useState<string>("all");
  const updateCompany = useUpdateFupCompany();
  const createCompany = useCreateFupCompany();
  const updateN8nSettings = useUpdateLeadClientN8nSettings();

  const tenantN8nSettings = useMemo(() => {
    return leadClients.find((c) => c.id === selectedClientId)?.n8n_settings;
  }, [leadClients, selectedClientId]);

  // Modelos vem do backend (LLM_MODELS), nao mais de uma lista fixa nesta tela:
  // ela oferecia ids que o motor nao conhece (llama3-70b-8192, llama3-8b-8192,
  // claude-3-5-sonnet sem data) e escondia os que funcionam.
  const { data: llmInfo } = useLlmModels();
  const llmModels = llmInfo?.models ?? [];
  const providerStatus = llmInfo?.providerStatus;
  const providerOrder = ["groq", "openai", "anthropic", "gemini"] as const;

  useEffect(() => {
    setCompanyId("all");
  }, [selectedClientId]);

  useEffect(() => {
    if (companies.length > 0 && (companyId === "all" || !companies.some((c) => c.id === companyId))) {
      setCompanyId(companies[0].id);
    }
  }, [companies, companyId]);

  const activeCompany = companies.find((c) => c.id === companyId);

  const defaultLlmModel = llmInfo?.defaultModel || "openai/gpt-oss-120b";
  const [agentName, setAgentName] = useState("");
  // "Um agente por chip, com função declarada": pra que serve o chip —
  // atendimento (responde quem procurou a empresa) ou campanha (chip de
  // disparo, não faz atendimento espontâneo). Não confundir com inboundRole
  // (qualificador/atendimento), que é o que o agente FAZ dentro do
  // atendimento — eixos diferentes, perguntas diferentes.
  const [agentKind, setAgentKind] = useState<"atendimento" | "campanha">("atendimento");
  const [inboundEnabled, setInboundEnabled] = useState(false);
  const [inboundModel, setInboundModel] = useState("");
  const [inboundPrompt, setInboundPrompt] = useState("");
  const [sdrPhone, setSdrPhone] = useState("");
  const [sdrTransferEnabled, setSdrTransferEnabled] = useState(false);
  const [spinFields, setSpinFields] = useState<{ id: string; name: string; required: boolean }[]>([]);
  const [inboundWebhookUrl, setInboundWebhookUrl] = useState("");
  // Números atendidos por ESTE agente. Um agente qualificador pode cobrir os
  // celulares de vários consultores sem duplicar prompt, modelo e SPIN.
  const [numerosVinculados, setNumerosVinculados] = useState<string[]>([]);
  // Funcao do agente. Qualificador atende quem foi disparado; atendimento
  // atende quem procurou a empresa. Muda o rotulo e o agrupamento na tela.
  const [inboundRole, setInboundRole] = useState<"atendimento" | "qualificador">("atendimento");

  // Escopo de inbound e Frase de Recontato configurados no tenant (lead_client_n8n_settings)
  const [chatbotInboundScope, setChatbotInboundScope] = useState<"leads_only" | "all">("leads_only");
  const [recontactMessage, setRecontactMessage] = useState("");

  useEffect(() => {
    if (tenantN8nSettings) {
      setChatbotInboundScope(tenantN8nSettings.chatbot_inbound_scope === "all" ? "all" : "leads_only");
      setRecontactMessage(tenantN8nSettings.recontact_message ?? "");
    }
  }, [tenantN8nSettings]);

  const [simMessages, setSimMessages] = useState<{ role: "user" | "bot"; text: string }[]>([
    { role: "bot", text: "Olá! Como posso ajudar?" }
  ]);
  const [simInput, setSimInput] = useState("");

  // Depende do ID, nao do objeto: recarregar a lista nao pode apagar o que o
  // usuario acabou de mexer e ainda nao salvou.
  useEffect(() => {
    if (activeCompany) {
      setAgentName(activeCompany.id === PLACEHOLDER_COMPANY_ID ? "" : (activeCompany.name ?? ""));
      setAgentKind(activeCompany.agent_kind === "campanha" ? "campanha" : "atendimento");
      setInboundEnabled(activeCompany.inbound_enabled ?? false);
      setInboundModel(activeCompany.inbound_model || "");
      setInboundPrompt(activeCompany.inbound_prompt ?? "");
      setSdrPhone(activeCompany.sdr_whatsapp_number ?? "");
      setSdrTransferEnabled(activeCompany.sdr_transfer_enabled ?? false);
      setSpinFields(activeCompany.inbound_spin_fields ?? []);
      setInboundWebhookUrl(activeCompany.inbound_webhook_url ?? "");
      const isPlaceholder = activeCompany.id === PLACEHOLDER_COMPANY_ID;
      const lista = !isPlaceholder && Array.isArray(activeCompany.evolution_instances) && activeCompany.evolution_instances.length > 0
        ? activeCompany.evolution_instances
        : (!isPlaceholder && activeCompany.evolution_instance ? [activeCompany.evolution_instance] : []);
      setNumerosVinculados(lista);
      setInboundRole(activeCompany.inbound_role === "qualificador" ? "qualificador" : "atendimento");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompany?.id]);

  const isPlaceholderCompany = activeCompany?.id === PLACEHOLDER_COMPANY_ID;

  // Ligar/desligar grava na hora. Antes era estado local ate clicar em Salvar,
  // entao sair da tela desfazia — parecia que o agente "desligava sozinho".
  const handleToggleInbound = async (value: boolean) => {
    setInboundEnabled(value);
    if (isPlaceholderCompany || !activeCompany) return; // sem linha ainda: salva junto na criacao
    try {
      assertTenantMatch(selectedClientId, crmClient?.selectedClientId);
      await updateCompany.mutateAsync({ id: activeCompany.id, inbound_enabled: value } as any);
      toast({ title: value ? "Agente ativado" : "Agente desativado" });
    } catch (e: any) {
      setInboundEnabled(!value);
      toast({ title: "Erro ao salvar status", description: e.message, variant: "destructive" });
    }
  };

  const handleSave = async () => {
    if (!activeCompany) return;
    try {
      assertTenantMatch(selectedClientId, crmClient?.selectedClientId);
    } catch (e: any) {
      toast({ title: "Erro de segurança", description: e.message, variant: "destructive" });
      return;
    }
    const payload = {
      inbound_enabled: inboundEnabled,
      inbound_model: inboundModel,
      inbound_prompt: inboundPrompt,
      inbound_spin_fields: spinFields,
      inbound_webhook_url: inboundWebhookUrl,
      sdr_whatsapp_number: sdrPhone,
      sdr_transfer_enabled: sdrTransferEnabled,
      evolution_instances: numerosVinculados,
      inbound_role: inboundRole,
      agent_kind: agentKind,
    };

    // Sem linha em followup_companies o PATCH ia para um id inexistente e o
    // salvar nunca surtia efeito. Aqui a linha e criada no primeiro salvamento.
    if (isPlaceholderCompany) {
      // O backend exige pelo menos um numero. Sem isto o Salvar devolvia
      // 400 MISSING_FIELDS e o agente nunca era criado.
      if (numerosVinculados.length === 0) {
        toast({
          title: "Escolha ao menos um número",
          description: 'Marque os números em "Números atendidos por este agente" antes de salvar.',
          variant: "destructive",
        });
        return;
      }
      try {
        const instancia = numerosVinculados[0] || "WhatsApp";
        const nomePadrao = agentKind === "campanha" ? "Agente de Campanha" : inboundRole === "qualificador" ? "Agente Qualificador" : "Agente de Atendimento";
        const criada = await createCompany.mutateAsync({
          name: agentName.trim() || nomePadrao,
          evolution_instance: instancia,
          tenant_id: selectedClientId,
          ...payload,
        } as any);
        if (criada?.id) setCompanyId(criada.id);
        toast({
          title: "Agente criado",
          description: `Configuração gravada para o número "${instancia}".`,
        });
      } catch (e: any) {
        toast({ title: "Erro ao criar configuração", description: e.message, variant: "destructive" });
      }
      return;
    }

    try {
      await updateCompany.mutateAsync({
        id: activeCompany.id,
        name: agentName.trim() || activeCompany.name,
        inbound_enabled: inboundEnabled,
        inbound_model: inboundModel,
        inbound_prompt: inboundPrompt,
        inbound_spin_fields: spinFields,
        inbound_webhook_url: inboundWebhookUrl,
        sdr_whatsapp_number: sdrPhone,
        sdr_transfer_enabled: sdrTransferEnabled,
        agent_kind: agentKind,
      });
      if (selectedClientId) {
        await updateN8nSettings.mutateAsync({
          tenantId: selectedClientId,
          chatbotInboundScope,
          recontactMessage,
        });
      }
      toast({ title: "Sucesso", description: "Configurações salvas." });
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
  };

  const addSpinField = () => {
    setSpinFields([...spinFields, { id: Date.now().toString(), name: "", required: true }]);
  };

  const updateSpinField = (id: string, updates: any) => {
    setSpinFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  };

  const removeSpinField = (id: string) => {
    setSpinFields((prev) => prev.filter((f) => f.id !== id));
  };

  const [simulando, setSimulando] = useState(false);

  // Chama a IA de verdade, passando o numero vinculado para o backend resolver
  // o agente inbound daquele numero (prompt, modelo e SPIN desta tela). Antes
  // era um setTimeout com texto fixo, que nao testava nada.
  const handleSimulate = async () => {
    const texto = simInput.trim();
    if (!texto || simulando) return;
    setSimMessages((prev) => [...prev, { role: "user", text: texto }]);
    setSimInput("");
    setSimulando(true);
    try {
      const token = await getIdToken();
      const res = await fetchApi("/api/chatbot-test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          clientId: selectedClientId,
          message: texto,
          instanceName: numerosVinculados[0] || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.response) {
        const motivo = data?.error?.message || data?.reason || `HTTP ${res.status}`;
        setSimMessages((prev) => [...prev, { role: "bot", text: `[falha] ${motivo}` }]);
        return;
      }
      const origem = data?.meta?.agente === "inbound" ? "agente inbound" : "chatbot do tenant";
      setSimMessages((prev) => [...prev, { role: "bot", text: `${data.response}\n\n— respondido pelo ${origem}` }]);
    } catch (e: any) {
      setSimMessages((prev) => [...prev, { role: "bot", text: `[erro] ${e?.message || "falha na simulação"}` }]);
    } finally {
      setSimulando(false);
    }
  };

  if (loadingCompanies) {
    return (
      <PageShell title="Assistentes Inbound" description="Gerencie seus agentes receptivos.">
        <div className="flex h-32 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-slate-900 dark:border-slate-100" />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Assistentes Inbound"
      description="Configure IAs que respondem ativamente quem chama no seu WhatsApp."
    >
      {/* Lista de agentes — chip e função visíveis em cada um, pra entender em
          três segundos quem atende o quê. Sempre visível, mesmo com um só:
          é o que ensina que "agente" e "chip" não são a mesma coisa. */}
      <div className="mb-6 space-y-2">
        <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Agentes deste tenant
        </Label>
        <div className="flex flex-wrap gap-2">
          {companies.map((c: any) => {
            const isPlaceholder = c.id === PLACEHOLDER_COMPANY_ID;
            const isSelected = c.id === companyId;
            const kind = c.agent_kind === "campanha" ? "campanha" : "atendimento";
            const chipLabel = Array.isArray(c.evolution_instances) && c.evolution_instances.length > 1
              ? `${c.evolution_instances.length} números`
              : c.evolution_instance || "sem chip";
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCompanyId(c.id)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-xl border px-3.5 py-2.5 text-left transition-colors min-w-[180px]",
                  isSelected
                    ? "border-indigo-400 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950/30"
                    : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-700"
                )}
              >
                <div className="flex items-center gap-1.5">
                  {!isPlaceholder && (
                    <span className={cn("h-1.5 w-1.5 rounded-full", c.inbound_enabled ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700")} />
                  )}
                  <span className="text-sm font-semibold text-foreground truncate max-w-[160px]">{c.name}</span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant="outline" className={cn("text-[10px] gap-1 px-1.5 py-0", kind === "campanha" ? "text-purple-600 border-purple-500/30" : "text-cyan-600 border-cyan-500/30")}>
                    {kind === "campanha" ? <Megaphone className="w-2.5 h-2.5" /> : <Headset className="w-2.5 h-2.5" />}
                    {kind === "campanha" ? "Campanha" : "Atendimento"}
                  </Badge>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate max-w-[120px]">{chipLabel}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {!activeCompany ? (
        <div className="flex h-32 items-center justify-center rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
          <p className="text-sm text-slate-500">Selecione um Número de WhatsApp acima.</p>
        </div>
      ) : (
        <>
        {activeCompany.id !== PLACEHOLDER_COMPANY_ID && (
          <AgentInstructionAuditPanel agentId={activeCompany.id} />
        )}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full space-y-6">
          <TabsList className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 h-auto p-1 grid w-full max-w-4xl grid-cols-4 sm:grid-cols-7">
            <TabsTrigger value="identidade" className="rounded-md py-2 text-xs sm:text-sm data-[state=active]:bg-slate-100 dark:data-[state=active]:bg-slate-900">
              Identidade
            </TabsTrigger>
            <TabsTrigger value="prompt" className="rounded-md py-2 text-xs sm:text-sm data-[state=active]:bg-slate-100 dark:data-[state=active]:bg-slate-900">
              Prompt
            </TabsTrigger>
            <TabsTrigger value="modelo" className="rounded-md py-2 text-xs sm:text-sm data-[state=active]:bg-slate-100 dark:data-[state=active]:bg-slate-900">
              Modelo
            </TabsTrigger>
            <TabsTrigger value="coleta" className="rounded-md py-2 text-xs sm:text-sm data-[state=active]:bg-slate-100 dark:data-[state=active]:bg-slate-900">
              Coleta
            </TabsTrigger>
            <TabsTrigger value="base" className="rounded-md py-2 text-xs sm:text-sm data-[state=active]:bg-slate-100 dark:data-[state=active]:bg-slate-900">
              Base de Conhecimento
            </TabsTrigger>
            <TabsTrigger value="transferencia" className="rounded-md py-2 text-xs sm:text-sm data-[state=active]:bg-slate-100 dark:data-[state=active]:bg-slate-900">
              Transferência
            </TabsTrigger>
            <TabsTrigger value="simulador" className="rounded-md py-2 text-xs sm:text-sm data-[state=active]:bg-slate-100 dark:data-[state=active]:bg-slate-900">
              Simulador
            </TabsTrigger>
          </TabsList>

          <TabsContent value="identidade" className="space-y-6">
            {isPlaceholderCompany && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/20 dark:text-amber-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Este agente ainda não existe no banco. Marque os números em
                  <strong> "Números atendidos por este agente"</strong>, ajuste o resto e clique em
                  <strong> Salvar Alterações</strong> para criá-lo. Enquanto isso, o botão de ligar não tem efeito.
                </span>
              </div>
            )}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Bot className="h-5 w-5 text-indigo-500" />
                  Identidade e Função
                </CardTitle>
                <CardDescription>Quem é este agente, pra que serve o chip dele, e se está ligado.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2 max-w-md">
                  <Label>Nome do agente</Label>
                  <Input
                    placeholder="Ex: Atendimento Loja Centro"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                  />
                </div>

                <div className="flex items-center justify-between rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                  <div className="space-y-0.5">
                    <Label className="text-base">Agente Ativado</Label>
                    <p className="text-sm text-slate-500">
                      Se ativo, a IA responderá automaticamente às mensagens recebidas neste número.
                    </p>
                  </div>
                  <Switch checked={inboundEnabled} onCheckedChange={handleToggleInbound} />
                </div>

                <div className="space-y-2 max-w-md">
                  <Label>Função do chip (agent_kind)</Label>
                  <Select value={agentKind} onValueChange={(v) => setAgentKind(v as "atendimento" | "campanha")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="atendimento">
                        <span className="flex items-center gap-1.5"><Headset className="h-3.5 w-3.5" /> Atendimento — responde quem procura a empresa</span>
                      </SelectItem>
                      <SelectItem value="campanha">
                        <span className="flex items-center gap-1.5"><Megaphone className="h-3.5 w-3.5" /> Campanha — chip de disparo, não atende lead espontâneo</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500">
                    {agentKind === "campanha"
                      ? "Mensagem de lead novo, sem campanha ativa, não é respondida — decisão, não falha. Resposta a uma campanha ativa continua funcionando normalmente."
                      : "Responde normalmente qualquer mensagem que chegar, seguindo o Escopo Inbound abaixo."}
                  </p>
                </div>

                <div className="space-y-2 max-w-md">
                  <Label>Papel dentro do atendimento (inbound_role)</Label>
                  <Select value={inboundRole} onValueChange={(v) => setInboundRole(v as "atendimento" | "qualificador")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="atendimento">Atendimento — responde quem procurou a empresa</SelectItem>
                      <SelectItem value="qualificador">Qualificador — responde quem recebeu disparo</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500">
                    Diferente da função do chip acima: isto diz o QUE o agente faz dentro do atendimento, não SE ele atende.
                  </p>
                </div>

                <div className="space-y-2 max-w-md">
                  <Label>Números (chips) atendidos por este agente</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <span className="truncate">
                          {numerosVinculados.length === 0
                            ? "Nenhum número vinculado"
                            : numerosVinculados.length === 1
                              ? (chips.find((c) => instanceNameFromChip(c) === numerosVinculados[0] || c.name === numerosVinculados[0] || c.id === numerosVinculados[0])?.name || numerosVinculados[0])
                              : `${numerosVinculados.length} números vinculados`}
                        </span>
                        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[min(26rem,calc(100vw-2rem))] p-1" align="start">
                      <div className="max-h-64 overflow-y-auto">
                        {chips.length === 0 && (
                          <p className="px-2 py-3 text-xs text-slate-400">
                            Nenhum chip conectado. Conecte em "Chips WhatsApp".
                          </p>
                        )}
                        {chips.map((chip) => {
                          const inst = instanceNameFromChip(chip) || chip.name || chip.id || "";
                          const marcado = numerosVinculados.some(
                            (v) => v === inst || v === chip.name || v === chip.id
                          );
                          const toggleItem = () => {
                            setNumerosVinculados((atual) => {
                              const jaMarcado = atual.some(
                                (v) => v === inst || v === chip.name || v === chip.id
                              );
                              if (jaMarcado) {
                                return atual.filter(
                                  (v) => v !== inst && v !== chip.name && v !== chip.id
                                );
                              }
                              return [...atual, inst];
                            });
                          };

                          return (
                            <div
                              key={chip.id || chip.name || inst}
                              onClick={toggleItem}
                              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent select-none"
                            >
                              <Checkbox
                                checked={marcado}
                                onCheckedChange={toggleItem}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <span className="truncate">{chip.name}</span>
                            </div>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <p className="text-xs text-slate-500">
                    Todos os números marcados respondem com este mesmo prompt, modelo e coleta. Um chip
                    marcado aqui não pode estar marcado em outro agente deste tenant — salvar recusa e
                    diz qual agente já o usa.
                  </p>
                </div>

                <div className="space-y-2 max-w-md">
                  <Label>Quem o chatbot atende (Escopo Inbound)</Label>
                  <Select value={chatbotInboundScope} onValueChange={(val) => setChatbotInboundScope(val as "leads_only" | "all")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="leads_only">
                        Apenas Contatos de Campanhas / Leads cadastrados (Recomendado)
                      </SelectItem>
                      <SelectItem value="all">
                        Qualquer Mensagem Recebida (Atendimento Aberto)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500">
                    {chatbotInboundScope === "all"
                      ? "⚠️ Qualquer mensagem recebida neste WhatsApp ativará o atendimento por IA. Vale para o tenant inteiro, não só este agente."
                      : "🔒 Apenas contatos já cadastrados ou originados de campanhas serão atendidos pela IA. Vale para o tenant inteiro, não só este agente."}
                  </p>
                </div>

                <div className="space-y-2 max-w-xl">
                  <Label>Mensagem de Recontato (Lead Finalizado)</Label>
                  <Textarea
                    value={recontactMessage}
                    onChange={(e) => setRecontactMessage(e.target.value)}
                    placeholder="Ex: Oi! Vi que já conversamos sobre isso. Nosso consultor vai entrar em contato em breve. Posso ajudar com mais alguma coisa?"
                    rows={3}
                    className="text-sm font-sans"
                  />
                  <p className="text-xs text-slate-500">
                    Mensagem enviada quando um lead que já foi qualificado/finalizado envia uma nova mensagem. Em branco, utiliza o texto padrão. Vale para o tenant inteiro.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="prompt" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Prompt Principal (Instruções)</CardTitle>
                <CardDescription>
                  Defina o comportamento, tom de voz e objetivo principal deste agente.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-slate-500 rounded-md border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-900/40">
                  Este campo grava só no agente selecionado — alterar aqui muda a resposta na PRÓXIMA
                  mensagem de qualquer conversa em andamento com ele, e não afeta nenhum outro agente.
                  Se o painel de diagnóstico acima disser que a fonte hoje é o "prompt padrão do
                  tenant", este agente ainda não tem texto próprio — o que você digitar aqui passa a
                  valer assim que salvar.
                </p>
                <Textarea
                  value={inboundPrompt}
                  onChange={(e) => setInboundPrompt(e.target.value)}
                  placeholder="Você é uma assistente virtual de um restaurante... Seu objetivo é realizar reservas..."
                  className="min-h-[400px] font-mono text-sm"
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="modelo" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Cpu className="h-5 w-5 text-indigo-500" />
                  Modelo de IA
                </CardTitle>
                <CardDescription>Qual modelo este agente usa, e quais chaves existem no servidor.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {(() => {
                  const isCustomInboundModel = Boolean(inboundModel && llmModels.some((m) => m.id === inboundModel));
                  const isDeadInboundModel = Boolean(inboundModel && llmModels.length > 0 && !llmModels.some((m) => m.id === inboundModel));
                  const effectiveInboundModel = isCustomInboundModel ? inboundModel : defaultLlmModel;
                  const defaultModelName = llmModels.find((m) => m.id === defaultLlmModel)?.name || defaultLlmModel;

                  return (
                    <div className="space-y-2 max-w-md">
                      <div className="flex items-center justify-between">
                        <Label>Modelo de IA</Label>
                        {!isCustomInboundModel && (
                          <span className="text-[10px] text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/40 px-1.5 py-0.5 rounded border border-purple-200 dark:border-purple-800 font-normal">
                            Padrão do Sistema ({defaultModelName})
                          </span>
                        )}
                      </div>
                      <Select value={effectiveInboundModel} onValueChange={setInboundModel}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o modelo" />
                        </SelectTrigger>
                        <SelectContent>
                          {providerOrder.map((provider) => {
                            const group = llmModels.filter((m) => m.provider === provider);
                            if (group.length === 0) return null;
                            const configured = providerStatus?.[provider];
                            return (
                              <SelectGroup key={provider}>
                                <SelectLabel className="text-[10px] uppercase tracking-wide">
                                  {group[0].providerName}
                                  {configured === false && " — sem chave de API"}
                                </SelectLabel>
                                {group.map((m) => (
                                  <SelectItem key={m.id} value={m.id} disabled={configured === false}>
                                    {m.name}{m.id === defaultLlmModel ? " (Padrão)" : ""}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            );
                          })}
                        </SelectContent>
                      </Select>
                      {isDeadInboundModel && (
                        <p className="text-xs text-amber-600 dark:text-amber-500">
                          O modelo salvo ("{inboundModel}") não está mais disponível. O agente está usando o padrão do sistema ({defaultModelName}). Escolha outro e salve.
                        </p>
                      )}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="base" className="space-y-6">
            <AgentKnowledgeBaseSection clientId={selectedClientId} companyId={isPlaceholderCompany ? undefined : activeCompany?.id} />
          </TabsContent>

          <TabsContent value="transferencia" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <PhoneForwarded className="h-5 w-5 text-indigo-500" />
                  Transferência — Envio da qualificação
                </CardTitle>
                <CardDescription>Quem recebe o resumo da qualificação quando o agente termina de qualificar um lead. O robô continua atendendo — não há transferência da conversa.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                  <div className="space-y-0.5">
                    <Label className="text-base">Enviar a qualificação</Label>
                    <p className="text-sm text-slate-500">
                      Ao qualificar um lead, manda o resumo para os números abaixo. Vale no atendimento e nas campanhas. Desligado, ninguém é avisado.
                    </p>
                  </div>
                  <Switch checked={sdrTransferEnabled} onCheckedChange={setSdrTransferEnabled} />
                </div>

                {sdrTransferEnabled && (
                  <div className="space-y-4">
                    {/* Quem recebe de fato, em ordem de precedencia — a mesma de
                        resolveSdrTarget. Antes a tela mostrava so o campo unico e
                        parecia que o inbound aceitava um numero apenas. */}
                    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Label className="text-sm">Quem recebe a qualificação</Label>
                        <a
                          href="/crm/agente?tab=settings&subtab=geral"
                          className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          Editar lista
                        </a>
                      </div>
                      <p className="text-xs text-slate-500">
                        É a mesma lista usada pelos disparos, configurada em Agente IA → Configurações.
                        Vale para todos os números deste tenant.
                      </p>
                      {sdrNumbersDoTenant.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {sdrNumbersDoTenant.map((numero) => (
                            <span
                              key={numero}
                              className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-mono dark:bg-slate-800"
                            >
                              {numero}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
                          Nenhum número na lista do tenant. Sem um número abaixo, ninguém recebe o
                          resumo da qualificação.
                        </p>
                      )}
                    </div>

                    <div className="space-y-2 max-w-md">
                      <Label>WhatsApp do SDR só deste número (opcional)</Label>
                      <Input
                        placeholder="Ex: 5511999999999"
                        value={sdrPhone}
                        onChange={(e) => setSdrPhone(e.target.value)}
                      />
                      <p className="text-xs text-slate-500">
                        Preenchido, <strong>substitui</strong> a lista do tenant para este número de
                        WhatsApp — só ele recebe. Em branco, vale a lista acima.
                      </p>
                    </div>

                    <p className="text-xs text-slate-500">
                      O botão <strong>Permitir Transferência</strong> sobrepõe tudo: desligado, ninguém
                      recebe, mesmo com a lista preenchida.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="coleta" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-indigo-500" />
                  Coleta de Dados (SPIN)
                </CardTitle>
                <CardDescription>
                  Quais informações o robô deve extrair obrigatoriamente antes de finalizar o atendimento?
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  {spinFields.map((field, index) => (
                    <div key={field.id} className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 font-mono text-sm text-slate-500 dark:bg-slate-800">
                        {index + 1}
                      </div>
                      <Input
                        placeholder="Nome do campo (ex: Data da Reserva)"
                        value={field.name}
                        onChange={(e) => updateSpinField(field.id, { name: e.target.value })}
                        className="flex-1"
                      />
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={field.required}
                          onCheckedChange={(c) => updateSpinField(field.id, { required: c })}
                        />
                        <Label className="text-xs text-slate-500">Obrigatório</Label>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => removeSpinField(field.id)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" onClick={addSpinField} className="w-full sm:w-auto">
                    <Plus className="mr-2 h-4 w-4" /> Adicionar Dado para Coleta
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="simulador" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Zap className="h-5 w-5 text-indigo-500" />
                  Simulador de Conversa
                </CardTitle>
                <CardDescription>
                  Teste seu agente usando o prompt e os campos de coleta SPIN definidos.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col h-[500px] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                  <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-slate-50 dark:bg-slate-900/50">
                    {simMessages.map((msg, i) => (
                      <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                            msg.role === "user"
                              ? "bg-indigo-600 text-white"
                              : "bg-white border border-slate-200 text-slate-900 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100"
                          }`}
                        >
                          {msg.text}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex items-center gap-2">
                    <Input
                      placeholder="Digite sua mensagem..."
                      value={simInput}
                      onChange={(e) => setSimInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSimulate();
                      }}
                      className="flex-1"
                    />
                    <Button onClick={handleSimulate} className="shrink-0 bg-indigo-600 hover:bg-indigo-700">
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <div className="flex items-center justify-end border-t border-slate-200 pt-6 dark:border-slate-800">
            <Button
              onClick={handleSave}
              disabled={updateCompany.isPending}
              className="bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-700"
            >
              {updateCompany.isPending ? (
                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Salvar Alterações
            </Button>
          </div>
        </Tabs>
        </>
      )}
    </PageShell>
  );
}
