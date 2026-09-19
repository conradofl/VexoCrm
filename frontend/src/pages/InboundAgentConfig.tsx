import { useState, useEffect, useMemo } from "react";
import {
  Bot,
  Save,
  AlertCircle,
  Sparkles,
  Plus,
  Trash2,
  Send,
  Zap,
  ChevronDown,
  Megaphone,
  Headset,
  Cpu,
  PhoneForwarded,
  MessageSquareText,
  Wand2,
  ChevronRight,
  Database,
  Archive,
} from "lucide-react";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { cn } from "@/lib/utils";
import { useArchiveFupCompany, useCreateFupCompany, useFupCompanies, useUpdateFupCompany } from "@/hooks/useFollowupAdmin";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi } from "@/lib/api";
import { useLeadClients, useUpdateLeadClientN8nSettings, useSdrRotationNext } from "@/hooks/useLeadClients";
import { useLlmModels, useChatbotTemplates, type ChatbotTemplate } from "@/hooks/useChatbotTemplates";
import { assertTenantMatch } from "@/lib/tenantIsolation";
import { AgentInstructionAuditPanel } from "@/components/agente/AgentInstructionAuditPanel";
import { AgentKnowledgeBaseSection } from "@/components/agente/AgentKnowledgeBaseSection";
import { SdrNumbersDialog } from "@/components/agente/SdrNumbersDialog";

// Empresa "de mentira" mostrada quando o tenant ainda nao tem linha em
// followup_companies. Salvar com ela cria a linha de verdade. Toda linha de
// rascunho (a primeira, ou as criadas por "+ Novo agente") usa esse prefixo,
// pra dar pra ter mais de um rascunho ao mesmo tempo sem colidir id.
const DRAFT_PREFIX = "__draft_";
const PLACEHOLDER_COMPANY_ID = `${DRAFT_PREFIX}default`;
function isDraftCompanyId(id: string | undefined) {
  return !!id && id.startsWith(DRAFT_PREFIX);
}
function makeDraft() {
  return {
    id: `${DRAFT_PREFIX}${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    name: "Agente ainda não criado",
    company_name: "Agente ainda não criado",
    evolution_instance: "",
  } as any;
}
// O nome real da instancia Evolution fica no fim da URL de disparo do chip.
function instanceNameFromChip(chip: { name?: string; dispatch_webhook_url?: string | null }) {
  const url = chip?.dispatch_webhook_url || "";
  const last = url.split("/").filter(Boolean).pop();
  return (last && !last.includes("?") ? last : chip?.name) || "";
}
// Números (chips) gravados numa linha de agente — mesma regra de fallback
// usada em todo lugar que lê evolution_instances: lista nova, com a coluna
// antiga como reserva pra linhas de antes da migration.
function instancesOfCompany(c: any): string[] {
  if (Array.isArray(c?.evolution_instances) && c.evolution_instances.length > 0) return c.evolution_instances;
  return c?.evolution_instance ? [c.evolution_instance] : [];
}
// O que fica gravado (nome/id/slug da URL) nem sempre é o nome que o dono
// reconhece na lista de chips — resolve pro nome de exibição quando achar.
function chipDisplayName(value: string, chips: any[]): string {
  const found = chips.find((c) => instanceNameFromChip(c) === value || c.name === value || c.id === value);
  return found?.name || value;
}

// "Uma tela, um agente, de cima para baixo" — modelo pronto não guarda texto
// de prompt, guarda campos de coleta (chatbot_templates). Escolher um modelo
// compõe um texto de partida a partir desses campos e COPIA pro prompt deste
// agente — cópia única, não vínculo vivo. Editar aqui depois não muda o
// modelo, e mudar o modelo depois não muda o que já foi copiado.
function composeStarterPrompt(template: ChatbotTemplate): string {
  const fields = Array.isArray(template.data_fields) ? template.data_fields : [];
  const perguntas = fields.length > 0
    ? fields.map((f) => `- ${f.label}: ${f.description}`).join("\n")
    : "- (este modelo não define campos)";
  const papel = template.agent_role || "Consultor de Atendimento e Qualificação Comercial";
  const nome = template.agent_name || "Assistente";
  return `Você é ${nome}, ${papel}.

Atenda com simpatia e objetividade, sempre em português. Ao longo da conversa, procure descobrir, sem parecer um formulário:
${perguntas}

Não repita perguntas já respondidas. Quando tiver o suficiente, resuma o que entendeu e encaminhe para o próximo passo.`;
}

export default function InboundAgentConfig() {
  const { toast } = useToast();
  const crmClient = useOptionalCrmClient();
  const { getIdToken } = useAuth();
  const selectedClientId = crmClient?.selectedClientId || "";

  const { data: rawCompanies = [], isLoading: loadingCompanies } = useFupCompanies(selectedClientId);
  // Rascunhos locais: "+ Novo agente" empilha aqui até salvar (vira linha de
  // verdade e some daqui). Sem isto so dava pra ter UM agente ainda-nao-criado
  // por vez — não dava pra começar um segundo enquanto o tenant já tem outros.
  const [drafts, setDrafts] = useState<any[]>([]);
  // Rascunho padrão (tenant sem nenhum agente ainda): criado UMA VEZ, id
  // estável. Antes ele nascia dentro do useMemo abaixo, chamando makeDraft()
  // (que usa Date.now()) toda vez que rawCompanies mudava de referência —
  // com rawCompanies vindo de uma fonte que devolve um array novo a cada
  // render (ex.: um hook mockado em teste), o id mudava a cada render, o
  // efeito de companyId nunca via o id como "já selecionado" e reentrava
  // em loop, travando a aba inteira. Um id que nasce uma vez resolve pra sempre.
  const [defaultDraft] = useState(() => makeDraft());

  const companies = useMemo(() => {
    if (rawCompanies.length === 0 && drafts.length === 0) return [defaultDraft];
    return [...rawCompanies, ...drafts];
  }, [rawCompanies, drafts, defaultDraft]);

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

  // Modelos vem do backend (LLM_MODELS), nao mais de uma lista fixa nesta tela:
  // ela oferecia ids que o motor nao conhece e escondia os que funcionam.
  const { data: llmInfo } = useLlmModels();
  const llmModels = llmInfo?.models ?? [];
  const providerStatus = llmInfo?.providerStatus;
  const providerOrder = ["groq", "openai", "anthropic", "gemini"] as const;

  // Modelos prontos de prompt — mesma tabela chatbot_templates da consolidação
  // (Commits 1-3). "Começar de um modelo pronto" copia o texto composto a
  // partir dela; editar aqui depois não afeta o template, editar o template
  // depois não afeta o que já foi copiado.
  const { data: templates = [] } = useChatbotTemplates(selectedClientId || null);

  useEffect(() => {
    setCompanyId("all");
  }, [selectedClientId]);

  useEffect(() => {
    if (companies.length > 0 && (companyId === "all" || !companies.some((c) => c.id === companyId))) {
      setCompanyId(companies[0].id);
    }
  }, [companies, companyId]);

  const activeCompany = companies.find((c) => c.id === companyId);
  const isPlaceholderCompany = isDraftCompanyId(activeCompany?.id);

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
  // Rodízio de SDR: "todos" avisa a lista inteira (de sempre); "rodizio" gira
  // um consultor por vez, fixo por lead (services/sdrTarget.js).
  const [sdrDistribution, setSdrDistribution] = useState<"todos" | "rodizio">("todos");

  const tenantN8nSettings = useMemo(() => {
    return leadClients.find((c) => c.id === selectedClientId)?.n8n_settings;
  }, [leadClients, selectedClientId]);

  useEffect(() => {
    if (tenantN8nSettings) {
      setChatbotInboundScope(tenantN8nSettings.chatbot_inbound_scope === "all" ? "all" : "leads_only");
      setRecontactMessage(tenantN8nSettings.recontact_message ?? "");
      setSdrDistribution(tenantN8nSettings.sdr_distribution === "rodizio" ? "rodizio" : "todos");
    }
  }, [tenantN8nSettings]);

  const rotationNext = useSdrRotationNext(selectedClientId || null, sdrDistribution === "rodizio");

  const [simMessages, setSimMessages] = useState<{ role: "user" | "bot"; text: string }[]>([
    { role: "bot", text: "Olá! Como posso ajudar?" }
  ]);
  const [simInput, setSimInput] = useState("");

  // Depende do ID, nao do objeto: recarregar a lista nao pode apagar o que o
  // usuario acabou de mexer e ainda nao salvou.
  useEffect(() => {
    if (activeCompany) {
      const isPlaceholder = isDraftCompanyId(activeCompany.id);
      setAgentName(isPlaceholder ? "" : (activeCompany.name ?? ""));
      setAgentKind(activeCompany.agent_kind === "campanha" ? "campanha" : "atendimento");
      setInboundEnabled(activeCompany.inbound_enabled ?? false);
      setInboundModel(activeCompany.inbound_model || "");
      setInboundPrompt(activeCompany.inbound_prompt ?? "");
      setSdrPhone(activeCompany.sdr_whatsapp_number ?? "");
      setSdrTransferEnabled(activeCompany.sdr_transfer_enabled ?? false);
      setSpinFields(activeCompany.inbound_spin_fields ?? []);
      setInboundWebhookUrl(activeCompany.inbound_webhook_url ?? "");
      const lista = !isPlaceholder && Array.isArray(activeCompany.evolution_instances) && activeCompany.evolution_instances.length > 0
        ? activeCompany.evolution_instances
        : (!isPlaceholder && activeCompany.evolution_instance ? [activeCompany.evolution_instance] : []);
      setNumerosVinculados(lista);
      setInboundRole(activeCompany.inbound_role === "qualificador" ? "qualificador" : "atendimento");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompany?.id]);

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

  // Regra nova: agente sem chip não pode ficar ligado. Se o último número sai
  // da lista enquanto o agente está ligado, ele desliga sozinho — nunca fica
  // "ligado" sem nada pra servir. Roda depois de handleToggleInbound existir.
  useEffect(() => {
    if (numerosVinculados.length === 0 && inboundEnabled) {
      handleToggleInbound(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numerosVinculados.length, inboundEnabled]);

  const handleSave = async () => {
    if (!activeCompany) return;
    try {
      assertTenantMatch(selectedClientId, crmClient?.selectedClientId);
    } catch (e: any) {
      toast({ title: "Erro de segurança", description: e.message, variant: "destructive" });
      return;
    }
    // Nunca grava ligado sem chip, mesmo que o switch local ainda não tenha
    // reagido (ex.: usuário desmarcou o número e clicou Salvar rapidamente).
    const enabledParaSalvar = numerosVinculados.length === 0 ? false : inboundEnabled;
    const payload = {
      inbound_enabled: enabledParaSalvar,
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
          description: 'Marque os números em "Número atendido" antes de salvar.',
          variant: "destructive",
        });
        return;
      }
      try {
        const instancia = numerosVinculados[0] || "WhatsApp";
        const nomePadrao = agentKind === "campanha" ? "Agente de Disparo" : inboundRole === "qualificador" ? "Agente Qualificador" : "Agente de Atendimento";
        const criada = await createCompany.mutateAsync({
          name: agentName.trim() || nomePadrao,
          evolution_instance: instancia,
          tenant_id: selectedClientId,
          ...payload,
        } as any);
        const draftIdSalvo = activeCompany.id;
        if (criada?.id) setCompanyId(criada.id);
        setDrafts((prev) => prev.filter((d) => d.id !== draftIdSalvo));
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
        ...payload,
      });
      if (selectedClientId) {
        await updateN8nSettings.mutateAsync({
          tenantId: selectedClientId,
          chatbotInboundScope,
          recontactMessage,
          sdrDistribution,
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

  // Chama a IA de verdade passando o ID DESTE agente — o backend resolve o
  // prompt, o modelo, a coleta e a base de conhecimento dele diretamente
  // (services/inboundAgent.js: resolveInboundAgentConfig com agentId), sem
  // precisar de chip vinculado. É o que permite o fluxo criar → escrever
  // prompt → testar → só então amarrar ao chip. Sem agente salvo ainda não
  // há id pra testar (ver bloco "Testar antes de soltar" abaixo).
  const handleSimulate = async () => {
    const texto = simInput.trim();
    if (!texto || simulando || isPlaceholderCompany || !activeCompany) return;
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
          agentId: activeCompany.id,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.response) {
        const motivo = data?.error?.message || data?.reason || `HTTP ${res.status}`;
        setSimMessages((prev) => [...prev, { role: "bot", text: `[falha] ${motivo}` }]);
        return;
      }
      const origem = data?.meta?.agente === "inbound" ? "este agente" : "chatbot do tenant";
      setSimMessages((prev) => [...prev, { role: "bot", text: `${data.response}\n\n— respondido pelo ${origem}` }]);
    } catch (e: any) {
      setSimMessages((prev) => [...prev, { role: "bot", text: `[erro] ${e?.message || "falha na simulação"}` }]);
    } finally {
      setSimulando(false);
    }
  };

  if (loadingCompanies) {
    return (
      <PageShell title="Agentes" description="Gerencie seus agentes receptivos.">
        <div className="flex h-32 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-slate-900 dark:border-slate-100" />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Agentes"
      description="Cada chip do WhatsApp tem um agente — ou nenhum. Aqui você vê e configura cada um."
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
            const isPlaceholder = isDraftCompanyId(c.id);
            const isSelected = c.id === companyId;
            const kind = c.agent_kind === "campanha" ? "campanha" : "atendimento";
            const hasChip = !isPlaceholder && (
              (Array.isArray(c.evolution_instances) && c.evolution_instances.length > 0) || !!c.evolution_instance
            );
            const chipLabel = hasChip
              ? (Array.isArray(c.evolution_instances) && c.evolution_instances.length > 1
                  ? `${c.evolution_instances.length} números`
                  : c.evolution_instance || c.evolution_instances?.[0])
              : "sem chip";
            return (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => setCompanyId(c.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCompanyId(c.id); }
                }}
                className={cn(
                  "relative flex flex-col items-start gap-1 rounded-xl border px-3.5 py-2.5 text-left transition-colors min-w-[180px] cursor-pointer",
                  isSelected
                    ? "border-indigo-400 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950/30"
                    : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-700"
                )}
              >
                {!isPlaceholder && (
                  <ArchiveAgentButton
                    agent={c}
                    chips={chips}
                    variant="card"
                    onArchived={() => {
                      if (c.id === companyId) setCompanyId("all");
                    }}
                  />
                )}
                <div className="flex items-center gap-1.5">
                  {hasChip && (
                    <span className={cn("h-1.5 w-1.5 rounded-full", c.inbound_enabled ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700")} />
                  )}
                  <span className="text-sm font-semibold text-foreground truncate max-w-[160px] pr-4">{c.name}</span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant="outline" className={cn("text-[10px] gap-1 px-1.5 py-0", kind === "campanha" ? "text-purple-600 border-purple-500/30" : "text-cyan-600 border-cyan-500/30")}>
                    {kind === "campanha" ? <Megaphone className="w-2.5 h-2.5" /> : <Headset className="w-2.5 h-2.5" />}
                    {kind === "campanha" ? "Disparo" : "Atendimento"}
                  </Badge>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate max-w-[120px]">
                    {!hasChip && !isPlaceholder ? "desligado · sem chip" : chipLabel}
                  </span>
                </div>
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => {
              const draft = makeDraft();
              setDrafts((prev) => [...prev, draft]);
              setCompanyId(draft.id);
            }}
            className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-3.5 py-2.5 text-xs font-medium text-slate-500 hover:border-slate-400 hover:text-slate-700 dark:hover:border-slate-600 dark:hover:text-slate-300 min-w-[140px] transition-colors"
          >
            <Plus className="h-4 w-4" />
            Novo agente
          </button>
        </div>
      </div>

      {!activeCompany ? (
        <div className="flex h-32 items-center justify-center rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
          <p className="text-sm text-slate-500">Selecione um agente acima.</p>
        </div>
      ) : (
        <div className="space-y-8 max-w-3xl">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Agentes <span className="mx-1">›</span> <span className="text-foreground font-medium">{activeCompany.name}</span>
            </p>
            {!isPlaceholderCompany && (
              <ArchiveAgentButton
                agent={activeCompany}
                chips={chips}
                variant="header"
                onArchived={() => setCompanyId("all")}
              />
            )}
          </div>

          {isPlaceholderCompany && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/20 dark:text-amber-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Este agente ainda não existe. Escolha um número, ajuste o resto e clique em{" "}
                <strong>Salvar Alterações</strong> para criá-lo.
              </span>
            </div>
          )}

          {!isPlaceholderCompany && <AgentInstructionAuditPanel agentId={activeCompany.id} />}

          {/* 1 — Quem é este agente */}
          <section className="space-y-4">
            <SectionHeading n={1} title="Quem é este agente" icon={<Bot className="h-4 w-4" />} />
            <Card>
              <CardContent className="pt-6 space-y-5">
                <div className="space-y-2 max-w-md">
                  <Label>Nome do agente</Label>
                  <Input
                    placeholder="Ex: Atendimento Loja Centro"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Função</Label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setAgentKind("atendimento")}
                      className={cn(
                        "flex-1 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors",
                        agentKind === "atendimento"
                          ? "border-cyan-400 bg-cyan-50 text-cyan-700 dark:border-cyan-600 dark:bg-cyan-950/30 dark:text-cyan-300"
                          : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                      )}
                    >
                      <Headset className="h-4 w-4" /> Atendimento
                    </button>
                    <button
                      type="button"
                      onClick={() => setAgentKind("campanha")}
                      className={cn(
                        "flex-1 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors",
                        agentKind === "campanha"
                          ? "border-purple-400 bg-purple-50 text-purple-700 dark:border-purple-600 dark:bg-purple-950/30 dark:text-purple-300"
                          : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                      )}
                    >
                      <Megaphone className="h-4 w-4" /> Disparo
                    </button>
                  </div>
                  <p className="text-xs text-slate-500">
                    {agentKind === "campanha"
                      ? "Mensagem de lead novo, sem campanha ativa, não é respondida — decisão, não falha. Resposta a uma campanha ativa continua funcionando normalmente."
                      : "Responde normalmente qualquer mensagem que chegar, seguindo o Escopo Inbound do tenant."}
                  </p>
                </div>

                <div className="space-y-2 max-w-md">
                  <Label>Número atendido</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="flex h-11 w-full items-center justify-between rounded-md border border-input bg-muted/30 px-3 text-sm"
                      >
                        <span className="truncate">
                          {numerosVinculados.length === 0
                            ? "Nenhum número — escolha um chip"
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
                    Um chip marcado aqui não pode estar marcado em outro agente deste tenant — salvar
                    recusa e diz qual agente já o usa.
                  </p>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                  <div className="space-y-0.5">
                    <Label className="text-base">Agente ligado</Label>
                    <p className="text-sm text-slate-500">
                      {numerosVinculados.length === 0
                        ? "Escolha um número para poder ligar este agente."
                        : "Se ligado, a IA responde automaticamente às mensagens recebidas nos números acima."}
                    </p>
                  </div>
                  <Switch
                    checked={inboundEnabled}
                    onCheckedChange={handleToggleInbound}
                    disabled={numerosVinculados.length === 0}
                  />
                </div>
              </CardContent>
            </Card>
          </section>

          {/* 2 — Como fala */}
          <section className="space-y-4">
            <SectionHeading n={2} title="Como fala" icon={<MessageSquareText className="h-4 w-4" />} />
            <Card>
              <CardContent className="pt-6 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">
                    Vale a partir da próxima mensagem de quem já está conversando.
                  </p>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="text-xs gap-1.5 shrink-0">
                        <Wand2 className="h-3.5 w-3.5" />
                        Começar de um modelo pronto
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 p-1" align="end">
                      <div className="max-h-72 overflow-y-auto">
                        {templates.length === 0 && (
                          <p className="px-2 py-3 text-xs text-slate-400">Nenhum modelo disponível para este tenant.</p>
                        )}
                        {templates.map((tpl) => (
                          <button
                            key={tpl.id}
                            type="button"
                            onClick={() => setInboundPrompt(composeStarterPrompt(tpl))}
                            className="flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent"
                          >
                            <span className="font-medium">{tpl.display_name}</span>
                            <span className="text-[11px] text-muted-foreground">{tpl.agent_name} · {tpl.data_fields?.length ?? 0} campo(s)</span>
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <Textarea
                  value={inboundPrompt}
                  onChange={(e) => setInboundPrompt(e.target.value)}
                  placeholder="Você é uma assistente virtual de um restaurante... Seu objetivo é realizar reservas..."
                  className="min-h-[320px] font-mono text-sm"
                />
              </CardContent>
            </Card>
          </section>

          {/* 3 — O que ele precisa descobrir */}
          <section className="space-y-4">
            <SectionHeading n={3} title="O que ele precisa descobrir" icon={<Sparkles className="h-4 w-4" />} />
            <Card>
              <CardContent className="pt-6 space-y-4">
                <p className="text-xs text-slate-500">
                  Perguntas feitas aos poucos, ao longo da conversa — não um formulário. O telefone já é
                  conhecido e nunca entra aqui.
                </p>
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
          </section>

          {/* 4 — O que ele sabe */}
          <section className="space-y-4">
            <SectionHeading n={4} title="O que ele sabe" icon={<Database className="h-4 w-4" />} />
            <AgentKnowledgeBaseSection clientId={selectedClientId} companyId={isPlaceholderCompany ? undefined : activeCompany?.id} />
          </section>

          {/* 5 — Quando ele chama gente */}
          <section className="space-y-4">
            <SectionHeading n={5} title="Quando ele chama gente" icon={<PhoneForwarded className="h-4 w-4" />} />
            <Card>
              <CardContent className="pt-6 space-y-6">
                <div className="flex items-center justify-between rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                  <div className="space-y-0.5">
                    <Label className="text-base">Enviar a qualificação</Label>
                    <p className="text-sm text-slate-500">
                      Ao qualificar um lead, manda o resumo para os números abaixo. O robô continua
                      atendendo — não há transferência da conversa. Desligado, ninguém é avisado.
                    </p>
                  </div>
                  <Switch checked={sdrTransferEnabled} onCheckedChange={setSdrTransferEnabled} />
                </div>

                {sdrTransferEnabled && (
                  <div className="space-y-4">
                    {/* Quem recebe de fato, em ordem de precedencia — a mesma de
                        resolveSdrTarget. */}
                    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Label className="text-sm">Quem recebe a qualificação</Label>
                        {selectedClientId && (
                          <SdrNumbersDialog tenantId={selectedClientId} numbers={sdrNumbersDoTenant} />
                        )}
                      </div>
                      <p className="text-xs text-slate-500">
                        É a mesma lista usada pelos disparos. Vale para todos os agentes deste tenant.
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

                      {/* Todos de uma vez, ou um por vez em rodízio — decisão por LEAD, não por mensagem. */}
                      <div className="pt-2 space-y-2">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setSdrDistribution("todos")}
                            className={cn(
                              "flex-1 rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                              sdrDistribution === "todos"
                                ? "border-indigo-400 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950/30"
                                : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                            )}
                          >
                            <span className="font-semibold text-foreground">Todos recebem</span>
                            <p className="text-[11px] text-slate-500">Como hoje — o resumo vai para a lista inteira.</p>
                          </button>
                          <button
                            type="button"
                            onClick={() => setSdrDistribution("rodizio")}
                            className={cn(
                              "flex-1 rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                              sdrDistribution === "rodizio"
                                ? "border-indigo-400 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950/30"
                                : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                            )}
                          >
                            <span className="font-semibold text-foreground">Um por vez, em rodízio</span>
                            <p className="text-[11px] text-slate-500">
                              Cada lead novo vai para o próximo da lista. O mesmo lead sempre volta para quem o pegou.
                            </p>
                          </button>
                        </div>
                        {sdrDistribution === "rodizio" && (
                          <p className="text-[11px] text-slate-500 pl-1">
                            Próximo da lista:{" "}
                            {rotationNext.isLoading ? (
                              "carregando..."
                            ) : rotationNext.data?.next ? (
                              <span className="font-mono font-semibold text-foreground">{rotationNext.data.next}</span>
                            ) : (
                              "—"
                            )}
                          </p>
                        )}
                      </div>
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
                      O botão <strong>Enviar a qualificação</strong> sobrepõe tudo: desligado, ninguém
                      recebe, mesmo com a lista preenchida.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          {/* 6 — Testar antes de soltar */}
          <section className="space-y-4">
            <SectionHeading n={6} title="Testar antes de soltar" icon={<Zap className="h-4 w-4" />} />
            <Card>
              <CardContent className="pt-6">
                {isPlaceholderCompany ? (
                  <p className="text-xs text-slate-500 rounded-md border border-slate-200 dark:border-slate-800 p-4 text-center">
                    Salve este agente para poder testar — depois dá pra escrever o prompt, testar, e só então escolher o número.
                  </p>
                ) : (
                  <div className="flex flex-col h-[420px] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
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
                )}
              </CardContent>
            </Card>
          </section>

          {/* Avançado — vem configurado, mexer é opcional. */}
          <Collapsible>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="group flex w-full items-center gap-1.5 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 px-4 py-3 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
              >
                <ChevronRight className="h-4 w-4 transition-transform group-data-[state=open]:rotate-90" />
                Avançado
                <span className="ml-auto text-xs font-normal text-slate-400">Vem configurado; mexer é opcional.</span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-6 pt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-indigo-500" />
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

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Papel na qualificação</CardTitle>
                  <CardDescription>O que o agente FAZ dentro do atendimento — diferente da Função do passo 1, que diz SE ele atende.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 max-w-md">
                  <Select value={inboundRole} onValueChange={(v) => setInboundRole(v as "atendimento" | "qualificador")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="atendimento">Atendimento — responde quem procurou a empresa</SelectItem>
                      <SelectItem value="qualificador">Qualificador — responde quem recebeu disparo</SelectItem>
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Mensagem de recontato</CardTitle>
                  <CardDescription>Enviada quando um lead já qualificado/finalizado manda nova mensagem. Vale para o tenant inteiro.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={recontactMessage}
                    onChange={(e) => setRecontactMessage(e.target.value)}
                    placeholder="Ex: Oi! Vi que já conversamos sobre isso. Nosso consultor vai entrar em contato em breve. Posso ajudar com mais alguma coisa?"
                    rows={3}
                    className="text-sm font-sans"
                  />
                </CardContent>
              </Card>
            </CollapsibleContent>
          </Collapsible>

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
        </div>
      )}
    </PageShell>
  );
}

function SectionHeading({ n, title, icon }: { n: number; title: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold dark:bg-indigo-950/50 dark:text-indigo-300">
        {n}
      </div>
      <h2 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
        {icon}
        {title}
      </h2>
    </div>
  );
}

// "Arquivar", não "Excluir" — nomeia a ação pelo que ela faz. A linha
// continua no banco (archived_at, followup/routes.js DELETE /companies/:id);
// só some da lista e, se tinha chip, o chip volta a cair no chatbot padrão
// da empresa (resolveInboundAgentConfig já ignora linha arquivada).
function ArchiveAgentButton({
  agent,
  chips,
  variant = "header",
  onArchived,
}: {
  agent: any;
  chips: any[];
  variant?: "header" | "card";
  onArchived: () => void;
}) {
  const { toast } = useToast();
  const archiveMutation = useArchiveFupCompany();
  const chipNames = instancesOfCompany(agent).map((v) => chipDisplayName(v, chips));

  const handleArchive = () => {
    archiveMutation.mutate(agent.id, {
      onSuccess: () => {
        toast({ title: "Agente arquivado", description: `"${agent.name}" saiu da lista.` });
        onArchived();
      },
      onError: (err: any) => toast({ title: "Erro ao arquivar", description: err?.message, variant: "destructive" }),
    });
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {variant === "card" ? (
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="absolute top-1.5 right-1.5 rounded-md p-1 text-slate-300 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
            title="Arquivar agente"
          >
            <Archive className="h-3.5 w-3.5" />
          </button>
        ) : (
          <Button variant="outline" size="sm" className="text-xs gap-1.5 text-slate-500 hover:text-rose-600 shrink-0">
            <Archive className="h-3.5 w-3.5" />
            Arquivar agente
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Arquivar "{agent.name}"?</AlertDialogTitle>
          <AlertDialogDescription className="text-xs text-muted-foreground space-y-2">
            {chipNames.length > 0 ? (
              <span className="block">
                O chip <strong className="text-foreground">{chipNames.join(", ")}</strong> volta a ser atendido pelo chatbot padrão da empresa.
              </span>
            ) : (
              <span className="block">Este agente não tem nenhum chip vinculado — arquivar não afeta nenhuma conversa.</span>
            )}
            <span className="block">O agente some da lista. A linha continua no banco — não é apagada.</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-8 text-xs">Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleArchive} disabled={archiveMutation.isPending} className="h-8 text-xs bg-rose-600 hover:bg-rose-700 text-white">
            {archiveMutation.isPending ? "Arquivando..." : "Arquivar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
