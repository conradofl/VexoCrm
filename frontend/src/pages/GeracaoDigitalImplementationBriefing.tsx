import React, { useState, useEffect } from "react";
import { PageShell, PageShellContext } from "@/components/PageShell";
import { GeracaoDigitalTabs } from "@/components/GeracaoDigitalTabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import {
  buildImplementationBriefingPdfHtml,
  buildImplementationBriefingWhatsAppMessage,
} from "@/lib/geracaoDigital/implementationBriefingExport";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiJson } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Building2,
  Users,
  Settings,
  Bot,
  Wifi,
  LineChart,
  Layers,
  Calendar,
  Save,
  Send,
  HelpCircle,
  Clock,
  ShieldAlert,
  FolderCheck,
  Edit3,
  Printer,
  MessageSquare,
  Search,
  Plus,
  Upload,
  FileText,
  File,
  Trash2,
  UserPlus,
  ChevronRight,
  ChevronLeft,
  FileCode,
  FileSpreadsheet,
  Zap,
} from "lucide-react";

type ModelType = "essencial" | "avancado";

interface TenantOption {
  id: string;
  name: string;
  slug?: string;
}

interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "sdr" | "atendente";
}

interface KnowledgeFile {
  id: string;
  name: string;
  size: number;
  type: string;
  dataUrl?: string;
}

interface ImplementationBriefingProps {
  isVexoCommercial?: boolean;
}

export default function GeracaoDigitalImplementationBriefing({ isVexoCommercial = false }: ImplementationBriefingProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Mode View (form vs saved list)
  const [activeTabMode, setActiveTabMode] = useState<"form" | "list">("form");
  const [editingBriefingId, setEditingBriefingId] = useState<string | null>(null);

  // Stepper state (Passos 1 a 5)
  const [currentStep, setCurrentStep] = useState<number>(1);

  // Search & Filter for Saved Briefings
  const [searchSaved, setSearchSaved] = useState<string>("");
  const [filterSavedStatus, setFilterSavedStatus] = useState<string>("todos");

  // WhatsApp Dialog State
  const [waDialogOpen, setWaDialogOpen] = useState<boolean>(false);
  const [selectedWaBriefing, setSelectedWaBriefing] = useState<any | null>(null);
  const [waPhone, setWaPhone] = useState<string>("");

  // Selected Tenant
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");
  const [clientName, setClientName] = useState<string>("");

  // Rule Routing
  const [numEmployees, setNumEmployees] = useState<number>(1);
  const [hasCommercialSector, setHasCommercialSector] = useState<boolean>(false);
  const [modelType, setModelType] = useState<ModelType>("essencial");
  const [manualOverride, setManualOverride] = useState<boolean>(false);

  // Dynamic lists for Step 2 and Step 3
  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([
    { id: "1", name: "", email: "", role: "sdr" },
  ]);
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFile[]>([]);

  // Briefing Form State
  const [prerequisites, setPrerequisites] = useState({
    segmento: "",
    unidades: "1",
    atendentes: "1",
    participantes: "",
    contratoAssinado: false,
  });

  const [operacao, setOperacao] = useState({
    kanbanEtapas: "Lead, Em Atendimento, Agendado, Proposta, Fechado, Perdido",
    kanbanMoverRegra: "",
    visaoPreferida: "inbox", // lista | kanban | inbox
    quemAcessa: "todos", // todos | supervisao
    followupGatilho: "Lead sem resposta em 24h",
    followupIntervalo: "24 horas, 3 tentativas",
    horarioComercial: "08:00 às 18:00 (Seg a Sex)",
    campanhasBase: "leads_sistema",
    sdrWhatsappNumbers: "",
    campanhasOrigemOptIn: "",
    campanhasVolumeEstimado: "500 msgs/mês",
    campanhasRelatorioAuto: false,
    eventosFeatureGlobal: false,
  });

  const [inteligencia, setInteligencia] = useState({
    slaPrimeiraRespostaMinutos: "15",
    taxaConversaoMeta: "10%",
    ticketMedioEstimado: "",
    origensTrafego: "Google Ads, Instagram, Inbound",
    jaMedeHoje: "",
    relatoriosFrequencia: "semanal",
    relatoriosFormato: "sistema",
  });

  const [agenteIa, setAgenteIa] = useState({
    tomDeVoz: "Casual e Atencioso",
    exemplosMensagens: "",
    regraEscalonamento: "Transferir para humano se o lead pedir valores específicos ou orçamento customizado.",
    precisaSaber: "Horário de funcionamento, endereço, serviços principais, link de agendamento.",
    naoPodeInformar: "Descontos especiais sem autorização do gerente.",
    materialAnexoUrls: "",
    quemValidaCliente: "",
    kanbanAgenteEtapas: "Triagem e Qualificação",
    inboundIniciaOuResponde: "responde",
    qualificacaoObrigatoria: "Nome, Cidade, Necessidade principal",
  });

  const [canais, setCanais] = useState({
    quantosChips: "1",
    numeroNovoOuHistorico: "numero_novo",
    prazoVolumeTotal: "14 dias",
    aquecimentoAlinhado: true,
  });

  const [modulosCustom, setModulosCustom] = useState({
    necessidadeEspecifica: false,
    descricao: "",
  });

  const [fechamento, setFechamento] = useState({
    recapitulado: true,
    dataGoLive: "",
    proximoContatoQuem: "",
    proximoContatoData: "",
  });

  // Calculate suggested model based on rules
  const suggestedModel: ModelType =
    numEmployees >= 3 && hasCommercialSector ? "avancado" : "essencial";

  // Auto-update modelType if user hasn't manually overridden it
  useEffect(() => {
    if (!manualOverride) {
      setModelType(suggestedModel);
    }
  }, [numEmployees, hasCommercialSector, suggestedModel, manualOverride]);

  const { getIdToken } = useAuth();

  // Fetch Closed Contracts & Proposals
  const { data: closedOptions = [], isLoading: isLoadingClosedOptions } = useQuery({
    queryKey: ["gd-closed-contracts-and-proposals"],
    queryFn: async () => {
      const token = await getIdToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const [resContracts, resProposals] = await Promise.all([
        fetchApi("/api/gd/contracts", { headers }).catch(() => null),
        fetchApi("/api/gd/proposals", { headers }).catch(() => null),
      ]);

      const items: Array<{ id: string; name: string; status: string }> = [];
      const seenIds = new Set<string>();

      if (resContracts && resContracts.ok) {
        const jsonC = await readApiJson<any>(resContracts, "gd-contracts");
        const listC = Array.isArray(jsonC) ? jsonC : jsonC?.data || [];
        for (const c of listC) {
          const id = c.id || c.proposal_id;
          const name = c.dados?.razao_social || c.dados?.representante || "Contrato Sem Nome";
          const statusLabel = c.status === "enviado_juridico" ? "No Jurídico" : c.status === "gerado" ? "Gerado" : "Contrato";
          if (id && !seenIds.has(id)) {
            seenIds.add(id);
            items.push({ id, name, status: statusLabel });
          }
        }
      }

      if (resProposals && resProposals.ok) {
        const jsonP = await readApiJson<any>(resProposals, "gd-proposals");
        const listP = Array.isArray(jsonP) ? jsonP : jsonP?.data || [];
        for (const p of listP) {
          if (p.status !== "aceita" && p.status !== "fechado" && p.status !== "assinado") {
            continue;
          }
          const id = p.id || p.tenant_id;
          const name = p.prospect_name || p.client_name || p.dados?.razao_social || "Proposta Aceita";
          const statusLabel = "Contrato Fechado";
          if (id && !seenIds.has(id)) {
            seenIds.add(id);
            items.push({ id, name, status: statusLabel });
          }
        }
      }

      return items;
    },
  });

  // Fetch Tenants
  const { data: tenants = [] } = useQuery<TenantOption[]>({
    queryKey: ["gd-tenants-list"],
    queryFn: async () => {
      const token = await getIdToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetchApi("/api/gd/implementation-briefings?list_tenants=true", { headers }).catch(() => null);
      if (!res || !res.ok) return [];
      const json = await res.json();
      return json.tenants || json.data || [];
    },
  });

  // Load Existing Implementation Briefings
  const { data: existingBriefings = [], isLoading: isLoadingBriefings } = useQuery({
    queryKey: ["gd-implementation-briefings", selectedTenantId, isVexoCommercial],
    queryFn: async () => {
      const token = await getIdToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const ownerParam = isVexoCommercial ? "owner_company=vexo" : "owner_company=geracao-digital";
      const url = selectedTenantId
        ? `/api/gd/implementation-briefings?tenant_id=${selectedTenantId}&${ownerParam}`
        : `/api/gd/implementation-briefings?${ownerParam}`;
      const res = await fetchApi(url, { headers });
      if (!res.ok) throw new Error("Erro ao buscar briefings de implantação");
      const json = await res.json();
      return json.data || [];
    },
  });

  // Mutation to Save Briefing
  const saveMutation = useMutation({
    mutationFn: async (status: "em_andamento" | "concluido") => {
      if (!clientName.trim()) throw new Error("Informe o nome da empresa / cliente para prosseguir.");
      const targetTenantId = selectedTenantId || clientName.trim().toLowerCase().replace(/[^a-z0-9]/g, "-") || "tenant-default";

      const token = await getIdToken();
      const headers: HeadersInit = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      const payload = {
        tenant_id: targetTenantId,
        client_name: clientName.trim(),
        model_type: modelType,
        suggested_model: suggestedModel,
        num_employees: numEmployees,
        has_commercial_sector: hasCommercialSector,
        prerequisites,
        operacao,
        inteligencia,
        agente_ia: agenteIa,
        canais,
        modulos_custom: modulosCustom,
        fechamento,
        team_users: teamUsers,
        knowledge_files: knowledgeFiles,
        status,
        owner_company: isVexoCommercial ? "vexo" : "geracao-digital",
      };

      const url = editingBriefingId
        ? `/api/gd/implementation-briefings/${editingBriefingId}`
        : `/api/gd/implementation-briefings`;

      const res = await fetchApi(url, {
        method: editingBriefingId ? "PUT" : "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || "Erro ao salvar briefing de implantação.");
      }
      return await res.json();
    },
    onSuccess: (data, status) => {
      queryClient.invalidateQueries({ queryKey: ["gd-implementation-briefings"] });
      toast({
        title: editingBriefingId ? "Implantação Atualizada" : status === "concluido" ? "Implantação Concluída!" : "Rascunho Salvo!",
        description:
          status === "concluido"
            ? "O briefing de implantação foi finalizado e as configurações do tenant foram sincronizadas."
            : "As informações foram salvas com sucesso no banco de dados.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Erro ao salvar",
        description: err.message || "Não foi possível salvar o briefing de implantação.",
        variant: "destructive",
      });
    },
  });

  // Reset completo do formulário
  const handleResetForm = () => {
    setEditingBriefingId(null);
    setSelectedTenantId("");
    setClientName("");
    setNumEmployees(1);
    setHasCommercialSector(false);
    setModelType("essencial");
    setManualOverride(false);
    setCurrentStep(1);
    setTeamUsers([{ id: "1", name: "", email: "", role: "sdr" }]);
    setKnowledgeFiles([]);
    setPrerequisites({
      segmento: "",
      unidades: "1",
      atendentes: "1",
      participantes: "",
      contratoAssinado: false,
    });
    setOperacao({
      kanbanEtapas: "Lead, Em Atendimento, Agendado, Proposta, Fechado, Perdido",
      kanbanMoverRegra: "",
      visaoPreferida: "inbox",
      quemAcessa: "todos",
      followupGatilho: "Lead sem resposta em 24h",
      followupIntervalo: "24 horas, 3 tentativas",
      horarioComercial: "08:00 às 18:00 (Seg a Sex)",
      campanhasBase: "leads_sistema",
      sdrWhatsappNumbers: "",
      campanhasOrigemOptIn: "",
      campanhasVolumeEstimado: "500 msgs/mês",
      campanhasRelatorioAuto: false,
      eventosFeatureGlobal: false,
    });
    setInteligencia({
      slaPrimeiraRespostaMinutos: "15",
      taxaConversaoMeta: "10%",
      ticketMedioEstimado: "",
      origensTrafego: "Google Ads, Instagram, Inbound",
      jaMedeHoje: "",
      relatoriosFrequencia: "semanal",
      relatoriosFormato: "sistema",
    });
    setAgenteIa({
      tomDeVoz: "Casual e Atencioso",
      exemplosMensagens: "",
      regraEscalonamento: "Transferir para humano se o lead pedir valores específicos ou orçamento customizado.",
      precisaSaber: "Horário de funcionamento, endereço, serviços principais, link de agendamento.",
      naoPodeInformar: "Descontos especiais sem autorização do gerente.",
      materialAnexoUrls: "",
      quemValidaCliente: "",
      kanbanAgenteEtapas: "Triagem e Qualificação",
      inboundIniciaOuResponde: "responde",
      qualificacaoObrigatoria: "Nome, Cidade, Necessidade principal",
    });
    setCanais({
      quantosChips: "1",
      numeroNovoOuHistorico: "numero_novo",
      prazoVolumeTotal: "14 dias",
      aquecimentoAlinhado: true,
    });
    setModulosCustom({
      necessidadeEspecifica: false,
      descricao: "",
    });
    setFechamento({
      recapitulado: true,
      dataGoLive: "",
      proximoContatoQuem: "",
      proximoContatoData: "",
    });
  };

  // Load saved briefing into form
  const handleLoadBriefing = (b: any) => {
    setEditingBriefingId(b.id || null);
    setSelectedTenantId(b.tenant_id || "");
    setClientName(b.client_name || "");
    setNumEmployees(b.num_employees || 1);
    setHasCommercialSector(Boolean(b.has_commercial_sector));
    setModelType(b.model_type || "essencial");
    setManualOverride(true);

    if (b.prerequisites) setPrerequisites(prev => ({ ...prev, ...b.prerequisites }));
    if (b.operacao) setOperacao(prev => ({ ...prev, ...b.operacao }));
    if (b.inteligencia) setInteligencia(prev => ({ ...prev, ...b.inteligencia }));
    if (b.agente_ia) setAgenteIa(prev => ({ ...prev, ...b.agente_ia }));
    if (b.canais) setCanais(prev => ({ ...prev, ...b.canais }));
    if (b.modulos_custom) setModulosCustom(prev => ({ ...prev, ...b.modulos_custom }));
    if (b.fechamento) setFechamento(prev => ({ ...prev, ...b.fechamento }));
    if (Array.isArray(b.team_users)) setTeamUsers(b.team_users);
    if (Array.isArray(b.knowledge_files)) setKnowledgeFiles(b.knowledge_files);

    setActiveTabMode("form");
    setCurrentStep(1);
    toast({
      title: "Implantação Carregada",
      description: `Editando briefing técnico de ${b.client_name}.`,
    });
  };

  // Team users handlers
  const addTeamUser = () => {
    setTeamUsers(prev => [
      ...prev,
      { id: Date.now().toString(), name: "", email: "", role: "sdr" }
    ]);
  };

  const updateTeamUser = (id: string, field: keyof TeamUser, value: string) => {
    setTeamUsers(prev =>
      prev.map(u => (u.id === id ? { ...u, [field]: value } : u))
    );
  };

  const removeTeamUser = (id: string) => {
    setTeamUsers(prev => prev.filter(u => u.id !== id));
  };

  // Knowledge base file handlers
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const dataUrl = evt.target?.result as string;
        setKnowledgeFiles(prev => [
          ...prev,
          {
            id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
            name: file.name,
            size: file.size,
            type: file.type || file.name.split(".").pop() || "unknown",
            dataUrl,
          },
        ]);
      };
      reader.readAsDataURL(file);
    });

    e.target.value = "";
  };

  const removeKnowledgeFile = (id: string) => {
    setKnowledgeFiles(prev => prev.filter(f => f.id !== id));
  };

  function formatFileSize(bytes: number) {
    if (!bytes) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getFileIcon(fileName: string) {
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (ext === "pdf") return <FileText className="h-5 w-5 text-red-500" />;
    if (ext === "csv" || ext === "xlsx" || ext === "xls") return <FileSpreadsheet className="h-5 w-5 text-emerald-500" />;
    if (ext === "txt") return <FileCode className="h-5 w-5 text-blue-500" />;
    if (ext === "doc" || ext === "docx") return <FileText className="h-5 w-5 text-indigo-500" />;
    return <File className="h-5 w-5 text-slate-500" />;
  }

  // Export printable PDF — template puro em lib/geracaoDigital/implementationBriefingExport.ts
  const handleExportPdf = (b: any) => {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(buildImplementationBriefingPdfHtml(b));
    win.document.close();
  };

  // Open WhatsApp Modal
  const handleOpenWhatsAppModal = (b: any) => {
    setSelectedWaBriefing(b);
    setWaPhone("");
    setWaDialogOpen(true);
  };

  const handleSendWa = () => {
    if (!selectedWaBriefing) return;
    const cleanNumber = waPhone.replace(/\D/g, "");
    const msg = buildImplementationBriefingWhatsAppMessage(selectedWaBriefing);

    const dest = cleanNumber ? `55${cleanNumber}` : "";
    const url = dest ? `https://wa.me/${dest}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
    setWaDialogOpen(false);
  };

  // Filter saved briefings
  const filteredBriefings = existingBriefings.filter((b: any) => {
    const matchName = !searchSaved.trim() || (b.client_name || "").toLowerCase().includes(searchSaved.toLowerCase());
    const matchStatus = filterSavedStatus === "todos" || b.status === filterSavedStatus;
    return matchName && matchStatus;
  });

  return (
    <PageShellContext.Provider value={isVexoCommercial}>
      <PageShell
        title={isVexoCommercial ? "Briefings de Implantação Vexo OS" : "Briefing de Implantação (Onboarding Técnico)"}
        subtitle={isVexoCommercial ? "Ferramenta de parametrização de clientes do Vexo OS." : "Ferramenta de parametrização pós-contrato para go-live e configuração do tenant no Vexo OS."}
        icon={Layers}
      >
        {!isVexoCommercial && <GeracaoDigitalTabs />}

      {/* SUB-ABA: FORMULÁRIO DE IMPLANTAÇÃO vs IMPLANTAÇÕES SALVAS */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 my-6 pb-4 border-b border-slate-200 dark:border-white/10">
        <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200 dark:border-white/10">
          <Button
            type="button"
            variant={activeTabMode === "form" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTabMode("form")}
            className="h-9 px-4 text-xs font-black gap-2 rounded-xl"
          >
            <Edit3 className="h-4 w-4" />
            {editingBriefingId ? "Editando Implantação" : "Esteira de Implantação (5 Passos)"}
          </Button>

          <Button
            type="button"
            variant={activeTabMode === "list" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTabMode("list")}
            className="h-9 px-4 text-xs font-black gap-2 rounded-xl"
          >
            <FolderCheck className="h-4 w-4 text-indigo-500" />
            Implantações Salvas
            <Badge className="ml-1 bg-indigo-600 text-white font-mono text-[10px] px-1.5 py-0">
              {existingBriefings.length}
            </Badge>
          </Button>
        </div>

        {activeTabMode === "form" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              handleResetForm();
              toast({ title: "Formulário Reiniciado", description: "Todos os campos foram limpos para uma nova implantação." });
            }}
            className="h-8 text-xs font-bold gap-1.5 border-slate-300"
          >
            <Plus className="h-3.5 w-3.5" />
            Limpar & Criar Nova
          </Button>
        )}
      </div>

      {/* MODAL COMPARTILHAR WHATSAPP */}
      <Dialog open={waDialogOpen} onOpenChange={setWaDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-black">
              <MessageSquare className="h-5 w-5 text-emerald-500" />
              Enviar Implantação por WhatsApp
            </DialogTitle>
            <DialogDescription className="text-xs">
              Informe o número do destinatário para abrir a mensagem de onboarding no WhatsApp.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs font-bold">Número de WhatsApp (com DDD)</Label>
              <Input
                placeholder="Ex: 34999998888"
                value={waPhone}
                onChange={(e) => setWaPhone(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
            {selectedWaBriefing && (
              <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-white/10 text-xs space-y-1">
                <span className="font-bold text-slate-800 dark:text-slate-100 block">Resumo do Onboarding:</span>
                <p className="text-slate-500 line-clamp-3 text-[11px] font-mono">
                  {selectedWaBriefing.client_name} • {selectedWaBriefing.model_type === "avancado" ? "Trilha Avançada" : "Trilha Essencial"} • {selectedWaBriefing.num_employees} atendentes
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setWaDialogOpen(false)} className="h-9 text-xs font-bold">
              Cancelar
            </Button>
            <Button onClick={handleSendWa} className="h-9 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white gap-2">
              <Send className="h-3.5 w-3.5" />
              Enviar no WhatsApp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* VISUALIZAÇÃO: ABA LISTA vs ESTEIRA EM 5 PASSOS */}
      {activeTabMode === "list" ? (
        <div className="space-y-5">
          <Card className="border border-slate-200 dark:border-white/10 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-lg font-black flex items-center gap-2">
                    <FolderCheck className="h-5 w-5 text-indigo-500" />
                    Empresas & Implantações Registradas
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Consulte as especificações técnicas pós-contrato salvas para cada cliente Vexo.
                  </CardDescription>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <div className="relative flex-1 sm:w-64">
                    <Search className="h-3.5 w-3.5 absolute left-3 top-3 text-slate-400" />
                    <Input
                      placeholder="Buscar por empresa..."
                      value={searchSaved}
                      onChange={(e) => setSearchSaved(e.target.value)}
                      className="h-9 pl-9 text-xs"
                    />
                  </div>

                  <Select value={filterSavedStatus} onValueChange={setFilterSavedStatus}>
                    <SelectTrigger className="h-9 w-36 text-xs">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos Status</SelectItem>
                      <SelectItem value="em_andamento">Em Andamento</SelectItem>
                      <SelectItem value="concluido">Concluído</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingBriefings ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  Carregando implantações registradas...
                </div>
              ) : filteredBriefings.length === 0 ? (
                <div className="py-12 text-center space-y-3">
                  <FolderCheck className="h-10 w-10 text-slate-300 mx-auto" />
                  <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
                    Nenhuma implantação técnica encontrada.
                  </p>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    Preencha o formulário para salvar o briefing de onboarding de um cliente.
                  </p>
                  <Button
                    onClick={() => setActiveTabMode("form")}
                    className="h-8 text-xs font-bold bg-indigo-600 text-white gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Criar Nova Implantação
                  </Button>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {filteredBriefings.map((b: any) => {
                    const isAdv = b.model_type === "avancado";
                    const isDone = b.status === "concluido";
                    return (
                      <Card key={b.id} className="border border-slate-200 dark:border-slate-800 hover:border-indigo-500/50 transition-all duration-300 shadow-sm flex flex-col justify-between">
                        <CardHeader className="pb-3 pt-4 px-4 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h3 className="font-black text-sm text-slate-900 dark:text-white truncate">
                                {b.client_name}
                              </h3>
                              <p className="text-[10px] text-slate-400 font-mono truncate">
                                Tenant ID: {b.tenant_id}
                              </p>
                            </div>
                            <Badge
                              className={cn(
                                "text-[10px] font-extrabold px-2 py-0.5 border-none shrink-0",
                                isDone ? "bg-emerald-500 text-white" : "bg-amber-500 text-white"
                              )}
                            >
                              {isDone ? "Concluído" : "Em Andamento"}
                            </Badge>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[10px] font-bold border-indigo-300 text-indigo-700 bg-indigo-50">
                              {isAdv ? "Trilha [A] Avançado" : "Trilha [E] Essencial"}
                            </Badge>
                            <span className="text-[10px] text-slate-400">
                              • {b.num_employees || 1} atendente(s)
                            </span>
                          </div>
                        </CardHeader>

                        <CardContent className="px-4 pb-4 space-y-3 pt-0">
                          <div className="p-2.5 bg-slate-50 dark:bg-slate-900/60 rounded-lg border border-slate-150 dark:border-slate-800 text-[11px] space-y-1 font-mono text-slate-600 dark:text-slate-300">
                            <div><strong>IA Tom de Voz:</strong> {b.agente_ia?.tomDeVoz || "Atencioso"}</div>
                            <div><strong>Chips WhatsApp:</strong> {b.canais?.quantosChips || 1} chip(s)</div>
                          </div>

                          <div className="flex items-center gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleLoadBriefing(b)}
                              className="h-8 text-[11px] font-bold gap-1 flex-1 px-2 border-slate-200"
                            >
                              <Edit3 className="h-3 w-3" />
                              Ver / Editar
                            </Button>

                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleExportPdf(b)}
                              className="h-8 text-[11px] font-bold gap-1 px-2.5 border-slate-200 text-indigo-600 hover:text-indigo-700"
                              title="Exportar em PDF Imprimível"
                            >
                              <Printer className="h-3 w-3" />
                              PDF
                            </Button>

                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenWhatsAppModal(b)}
                              className="h-8 text-[11px] font-bold gap-1 px-2.5 border-emerald-200 text-emerald-600 hover:text-emerald-700 bg-emerald-50/50"
                              title="Enviar resumo por WhatsApp"
                            >
                              <MessageSquare className="h-3 w-3" />
                              WhatsApp
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-6">

          {/* STEPPER VISUAL SUPERIOR (5 PASSOS) */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-black uppercase tracking-wider text-slate-500">
                Esteira de Implantação Vexo — Passo {currentStep} de 5
              </span>
              <Badge variant="outline" className="text-xs font-bold border-indigo-200 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                {currentStep === 1 && "Passo 1: Empresa & Contrato"}
                {currentStep === 2 && "Passo 2: Usuários & Acessos da Equipe"}
                {currentStep === 3 && "Passo 3: Base de Conhecimento (Uploads)"}
                {currentStep === 4 && "Passo 4: Regras da IA & Canais"}
                {currentStep === 5 && "Passo 5: Conclusão & Sincronização"}
              </Badge>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                { num: 1, title: "1. Empresa & Contrato", icon: Building2 },
                { num: 2, title: "2. Equipe & Acessos", icon: Users },
                { num: 3, title: "3. Base Conhecimento", icon: FileText },
                { num: 4, title: "4. Regras IA & Canais", icon: Bot },
                { num: 5, title: "5. Conclusão & Sync", icon: CheckCircle2 },
              ].map((step) => {
                const StepIcon = step.icon;
                const isActive = currentStep === step.num;
                const isPast = currentStep > step.num;
                return (
                  <button
                    key={step.num}
                    type="button"
                    onClick={() => setCurrentStep(step.num)}
                    className={cn(
                      "flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all cursor-pointer",
                      isActive
                        ? "border-indigo-600 bg-indigo-50/80 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 ring-2 ring-indigo-500/20 font-black"
                        : isPast
                        ? "border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 font-bold"
                        : "border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900 text-slate-500 font-medium hover:border-slate-300"
                    )}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <StepIcon className="h-4 w-4 shrink-0" />
                      <span className="text-xs truncate">{step.title}</span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden mt-1">
                      <div
                        className={cn(
                          "h-full transition-all duration-300",
                          isActive ? "bg-indigo-600 w-full" : isPast ? "bg-emerald-500 w-full" : "w-0"
                        )}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* CONTEÚDO DO PASSO ATUAL */}

          {/* PASSO 1: EMPRESA & CONTRATO */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <Card className="border-indigo-100 dark:border-indigo-900/40 bg-gradient-to-br from-indigo-50/40 to-slate-50 dark:from-indigo-950/20 dark:to-slate-900 shadow-sm">
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                      <CardTitle className="text-lg font-black text-slate-800 dark:text-white">
                        Passo 1: Empresa & Contrato Fechado
                      </CardTitle>
                    </div>
                    <Badge variant="outline" className="bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 font-bold border-indigo-200">
                      Identificação Inicial
                    </Badge>
                  </div>
                  <CardDescription className="text-xs text-slate-600 dark:text-slate-400">
                    Selecione o cliente contratante e defina o modelo da trilha técnica de implantação.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-3">
                    <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      Empresa Contratante (Vincule ao Contrato / Proposta Aceita)
                    </Label>
                    <Select
                      value={selectedTenantId}
                      onValueChange={(val) => {
                        setSelectedTenantId(val);
                        const found = closedOptions.find((opt) => opt.id === val);
                        if (found) {
                          setClientName(found.name);
                        }
                      }}
                    >
                      <SelectTrigger className="w-full h-10 text-sm bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                        <SelectValue placeholder={isLoadingClosedOptions ? "Carregando contratos..." : "Selecione a empresa contratante..."} />
                      </SelectTrigger>
                      <SelectContent>
                        {closedOptions.length === 0 ? (
                          <SelectItem value="none" disabled>
                            Nenhum contrato fechado encontrado no sistema
                          </SelectItem>
                        ) : (
                          closedOptions.map((opt) => (
                            <SelectItem key={opt.id} value={opt.id} className="text-sm">
                              {opt.name} <span className="text-xs text-emerald-600 font-bold ml-2">({opt.status})</span>
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>

                    <div className="pt-1">
                      <Label className="text-[11px] font-semibold text-slate-500">Nome do Cliente / Razão Social Confirmada</Label>
                      <Input
                        placeholder="Nome da empresa do cliente"
                        value={clientName}
                        onChange={(e) => setClientName(e.target.value)}
                        className="mt-1 h-9 text-xs bg-slate-50 dark:bg-slate-900"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold">Segmento da Empresa</Label>
                      <Input
                        placeholder="Ex: Odontologia, Educação, Imobiliária"
                        value={prerequisites.segmento}
                        onChange={(e) => setPrerequisites(p => ({ ...p, segmento: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold">Horário Comercial de Atendimento</Label>
                      <Input
                        placeholder="Ex: 08:00 às 18:00 (Seg a Sex)"
                        value={operacao.horarioComercial}
                        onChange={(e) => setOperacao(o => ({ ...o, horarioComercial: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold">Responsáveis pelo Lado do Cliente</Label>
                      <Input
                        placeholder="Ex: João (Sócio-Decisor), Ana (Supervisora)"
                        value={prerequisites.participantes}
                        onChange={(e) => setPrerequisites(p => ({ ...p, participantes: e.target.value }))}
                      />
                    </div>
                  </div>

                  {/* REGRAS DE ROTEAMENTO DO MODELO */}
                  <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                        <Users className="h-4 w-4 text-purple-600" />
                        Perfil da Operação & Escolha da Trilha
                      </h4>
                      {manualOverride && (
                        <Badge variant="secondary" className="text-[10px]">
                          Seleção Manual Ativa
                        </Badge>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400">Número de Funcionários / Atendentes</Label>
                        <Input
                          type="number"
                          min={1}
                          value={numEmployees}
                          onChange={(e) => setNumEmployees(parseInt(e.target.value) || 1)}
                          className="w-full bg-slate-50 dark:bg-slate-800"
                        />
                      </div>

                      <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700">
                        <div className="space-y-0.5">
                          <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">Possui Setor Comercial Dedicado?</Label>
                          <p className="text-[11px] text-slate-500">Equipe de vendas própria estruturada.</p>
                        </div>
                        <Switch
                          checked={hasCommercialSector}
                          onCheckedChange={(checked) => setHasCommercialSector(checked)}
                        />
                      </div>
                    </div>

                    {/* SELETORES DE MODELO */}
                    <div className="pt-2">
                      <Label className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2 block">
                        Modelo de Implantação Selecionado:
                      </Label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setModelType("essencial");
                            setManualOverride(true);
                          }}
                          className={`p-4 rounded-xl border text-left transition-all relative cursor-pointer ${
                            modelType === "essencial"
                              ? "border-blue-600 bg-blue-50/60 dark:bg-blue-950/30 ring-2 ring-blue-500/20"
                              : "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 hover:border-slate-300"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-1.5">
                              <Badge className="bg-blue-600 hover:bg-blue-700 text-white">Trilha [E]</Badge>
                              Modelo Essencial
                            </span>
                            {suggestedModel === "essencial" && (
                              <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-950 px-2 py-0.5 rounded-full">
                                Sugerido
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-400">
                            Operação simplificada (menos de 3 func). Foco em Kanban simples, Follow-up e IA básica.
                          </p>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setModelType("avancado");
                            setManualOverride(true);
                          }}
                          className={`p-4 rounded-xl border text-left transition-all relative cursor-pointer ${
                            modelType === "avancado"
                              ? "border-purple-600 bg-purple-50/60 dark:bg-purple-950/30 ring-2 ring-purple-500/20"
                              : "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 hover:border-slate-300"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-1.5">
                              <Badge className="bg-purple-600 hover:bg-purple-700 text-white">Trilha [A]</Badge>
                              Modelo Avançado
                            </span>
                            {suggestedModel === "avancado" && (
                              <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-950 px-2 py-0.5 rounded-full">
                                Sugerido
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-400">
                            Operação robusta com equipe. Inclui Inteligência Comercial, Inbound IA e Automações avançadas.
                          </p>
                        </button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* PASSO 2: USUÁRIOS & ACESSOS DA EQUIPE */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base font-bold flex items-center gap-2">
                        <Users className="h-5 w-5 text-blue-500" />
                        Passo 2: Cadastro de Usuários & E-mails da Equipe
                      </CardTitle>
                      <CardDescription className="text-xs mt-1">
                        Cadastre os e-mails e cargos dos colaboradores da empresa do cliente para liberação de acessos no CRM.
                      </CardDescription>
                    </div>
                    <Button
                      type="button"
                      onClick={addTeamUser}
                      size="sm"
                      className="h-9 font-bold text-xs bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5"
                    >
                      <UserPlus className="h-4 w-4" />
                      + Adicionar Usuário
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {teamUsers.length === 0 ? (
                    <div className="py-8 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
                      <Users className="h-8 w-8 text-slate-400 mx-auto" />
                      <p className="text-xs font-bold text-slate-600">Nenhum usuário cadastrado até o momento.</p>
                      <Button
                        type="button"
                        onClick={addTeamUser}
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs font-bold gap-1"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Adicionar Primeiro Usuário
                      </Button>
                    </div>
                  ) : (
                    <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-[11px] font-black text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                            <th className="p-3">Nome Completo</th>
                            <th className="p-3">E-mail de Login</th>
                            <th className="p-3">Perfil / Perfil de Acesso</th>
                            <th className="p-3 text-center w-16">Ação</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                          {teamUsers.map((user) => (
                            <tr key={user.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/50">
                              <td className="p-2.5">
                                <Input
                                  placeholder="Ex: Ana Souza"
                                  value={user.name}
                                  onChange={(e) => updateTeamUser(user.id, "name", e.target.value)}
                                  className="h-9 text-xs"
                                />
                              </td>
                              <td className="p-2.5">
                                <Input
                                  type="email"
                                  placeholder="ana@empresa.com.br"
                                  value={user.email}
                                  onChange={(e) => updateTeamUser(user.id, "email", e.target.value)}
                                  className="h-9 text-xs"
                                />
                              </td>
                              <td className="p-2.5">
                                <Select
                                  value={user.role}
                                  onValueChange={(val) => updateTeamUser(user.id, "role", val as any)}
                                >
                                  <SelectTrigger className="h-9 text-xs bg-white dark:bg-slate-900">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="admin">Administrador (Gestor)</SelectItem>
                                    <SelectItem value="sdr">Consultor SDR (Vendas)</SelectItem>
                                    <SelectItem value="atendente">Atendente (Suporte/Operação)</SelectItem>
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="p-2.5 text-center">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => removeTeamUser(user.id)}
                                  className="h-8 w-8 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="p-4 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                    <Label className="text-xs font-bold">Quem terá acesso à Tela de Conversas / Inbox?</Label>
                    <Select
                      value={operacao.quemAcessa}
                      onValueChange={(val) => setOperacao(o => ({ ...o, quemAcessa: val }))}
                    >
                      <SelectTrigger className="h-9 text-xs bg-white dark:bg-slate-800">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todos">Todos os Atendentes e Consultores SDRs</SelectItem>
                        <SelectItem value="supervisao">Apenas Supervisores e Administradores</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* PASSO 3: BASE DE CONHECIMENTO (UPLOAD DE ARQUIVOS) */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <FileText className="h-5 w-5 text-indigo-500" />
                    Passo 3: Base de Conhecimento da Empresa (Documentos & Regras)
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Anexe cardápios, PDFs de preços, contratos padrão, políticas de troca e FAQs para alimentar o cérebro da Inteligência Artificial.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">

                  {/* UPLOAD AREA */}
                  <div className="relative border-2 border-dashed border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/30 dark:bg-indigo-950/20 hover:bg-indigo-50/70 transition-all rounded-2xl p-6 text-center space-y-3">
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.txt,.docx,.doc,.csv,.xlsx"
                      onChange={handleFileUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div className="w-12 h-12 rounded-2xl bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center mx-auto text-indigo-600 dark:text-indigo-400">
                      <Upload className="h-6 w-6" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-black text-slate-800 dark:text-slate-100">
                        Clique aqui ou arraste os arquivos de conhecimento
                      </p>
                      <p className="text-xs text-slate-500">
                        Formatos aceitos: PDF, TXT, DOCX, CSV (Cardápios, Tabelas de Preço, Manuais, PDFs)
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 bg-white dark:bg-slate-900 font-bold">
                      Arquivo ainda não é salvo — fica só na memória deste navegador até você sair da página
                    </Badge>
                  </div>

                  {/* LISTA DE ARQUIVOS ANEXADOS */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center justify-between">
                      <span>Documentos Anexados na Base ({knowledgeFiles.length})</span>
                      {knowledgeFiles.length > 0 && (
                        <span className="text-[11px] font-normal text-slate-400">
                          {knowledgeFiles.reduce((acc, f) => acc + (f.size || 0), 0) > 0 &&
                            formatFileSize(knowledgeFiles.reduce((acc, f) => acc + (f.size || 0), 0))}
                        </span>
                      )}
                    </h4>

                    {knowledgeFiles.length === 0 ? (
                      <div className="p-6 text-center border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-400">
                        Nenhum arquivo anexado ainda. Faça upload dos materiais da empresa acima.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {knowledgeFiles.map((file) => (
                          <div
                            key={file.id}
                            className="flex items-center justify-between p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              {getFileIcon(file.name)}
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                                  {file.name}
                                </p>
                                <p className="text-[10px] text-slate-400 font-mono">
                                  {formatFileSize(file.size)}
                                </p>
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeKnowledgeFile(file.id)}
                              className="h-8 w-8 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 shrink-0"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* CAMPO DE LINKS ADICIONAIS */}
                  <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <Label className="text-xs font-bold">Links de Drive, Sites ou Catálogos Externos</Label>
                    <Textarea
                      placeholder="Cole aqui links adicionais de materiais de apoio (ex: https://drive.google.com/... ou https://site.com.br/catalogo)"
                      value={agenteIa.materialAnexoUrls}
                      onChange={(e) => setAgenteIa(a => ({ ...a, materialAnexoUrls: e.target.value }))}
                      className="h-20 text-xs"
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* PASSO 4: REGRAS DA IA & CANAIS */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <Bot className="h-5 w-5 text-purple-500" />
                    Passo 4: Regras da Inteligência Artificial & Alerta de SDRs
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Defina o tom de voz do robô, regras de transbordo para humanos, WhatsApps dos SDRs e chips do tenant.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* TOM DE VOZ E DIRETIAS */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs font-bold">Tom de Voz do Agente IA</Label>
                      <Input
                        placeholder="Ex: Casual, Consultivo, Formal, Entusiasta"
                        value={agenteIa.tomDeVoz}
                        onChange={(e) => setAgenteIa(a => ({ ...a, tomDeVoz: e.target.value }))}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs font-bold">Regra de Escalonamento (Transferir para Humano)</Label>
                      <Input
                        placeholder="Ex: Transferir ao pedir orçamento customizado ou se pedir atendente"
                        value={agenteIa.regraEscalonamento}
                        onChange={(e) => setAgenteIa(a => ({ ...a, regraEscalonamento: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs font-bold text-emerald-700 dark:text-emerald-400">O que a IA DEVE informar obrigatoriamente</Label>
                      <Textarea
                        placeholder="Ex: Endereço completo, horários, preços padrão e link de agendamento."
                        value={agenteIa.precisaSaber}
                        onChange={(e) => setAgenteIa(a => ({ ...a, precisaSaber: e.target.value }))}
                        className="h-24 text-xs"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs font-bold text-red-700 dark:text-red-400">O que a IA NÃO PODE informar / prometer</Label>
                      <Textarea
                        placeholder="Ex: Descontos acima de 10% sem falar com gerente, prazos abaixo de 5 dias."
                        value={agenteIa.naoPodeInformar}
                        onChange={(e) => setAgenteIa(a => ({ ...a, naoPodeInformar: e.target.value }))}
                        className="h-24 text-xs"
                      />
                    </div>
                  </div>

                  {/* WHATSAPPS DOS SDRs PARA BROADCAST */}
                  <div className="p-4 bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900 rounded-xl space-y-3">
                    <div className="flex items-center gap-2">
                      <Zap className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                      <Label className="text-xs font-black uppercase text-purple-900 dark:text-purple-200">
                        Lista de WhatsApps dos SDRs (Alertas Simultâneos / Broadcast)
                      </Label>
                    </div>
                    <p className="text-xs text-purple-700 dark:text-purple-300">
                      Quando um lead for qualificado como QUENTE ou pedir recontato, todos esses números receberão o alerta de WhatsApp no mesmo instante.
                    </p>
                    <Input
                      placeholder="Ex: 34999998888, 34988887777 (separados por vírgula com DDD)"
                      value={operacao.sdrWhatsappNumbers}
                      onChange={(e) => setOperacao(o => ({ ...o, sdrWhatsappNumbers: e.target.value }))}
                      className="bg-white dark:bg-slate-900 text-xs font-mono"
                    />
                  </div>

                  {/* CHIPS E CANAIS */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                    <div className="space-y-2">
                      <Label className="text-xs font-bold">Quantidade de Chips WhatsApp Contratados</Label>
                      <Select
                        value={canais.quantosChips}
                        onValueChange={(val) => setCanais(c => ({ ...c, quantosChips: val }))}
                      >
                        <SelectTrigger className="bg-white dark:bg-slate-900">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">1 Chip de Atendimento</SelectItem>
                          <SelectItem value="2">2 Chips (Rodízio)</SelectItem>
                          <SelectItem value="3">3 Chips (Rodízio)</SelectItem>
                          <SelectItem value="4+">4 ou mais Chips</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs font-bold">Tipo do Número de WhatsApp</Label>
                      <Select
                        value={canais.numeroNovoOuHistorico}
                        onValueChange={(val) => setCanais(c => ({ ...c, numeroNovoOuHistorico: val }))}
                      >
                        <SelectTrigger className="bg-white dark:bg-slate-900">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="numero_novo">Número Novo (Requer Aquecimento)</SelectItem>
                          <SelectItem value="ja_usado">Número Antigo / Já em Uso</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* PASSO 5: CONCLUSÃO & SINCRONIZAÇÃO */}
          {currentStep === 5 && (
            <div className="space-y-6">
              <Card className="border-emerald-200 dark:border-emerald-900/50 bg-gradient-to-br from-emerald-50/40 to-slate-50 dark:from-emerald-950/20 dark:to-slate-900 shadow-sm">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                      <CardTitle className="text-lg font-black text-slate-900 dark:text-white">
                        Passo 5: Conclusão & Resumo de Implantação
                      </CardTitle>
                    </div>
                    <Badge className="bg-emerald-600 text-white font-bold">
                      Revisão Final
                    </Badge>
                  </div>
                  <CardDescription className="text-xs text-slate-600 dark:text-slate-400">
                    Confira a compilação do onboarding técnico de {clientName || "Cliente"} antes de finalizar.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* CARDS RESUMO */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
                      <h4 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 border-b pb-2">
                        <Building2 className="h-4 w-4 text-indigo-500" />
                        Empresa & Trilha
                      </h4>
                      <div><strong>Cliente:</strong> {clientName || "Não informado"}</div>
                      <div><strong>Modelo:</strong> {modelType === "avancado" ? "Trilha Avançada [A]" : "Trilha Essencial [E]"}</div>
                      <div><strong>Segmento:</strong> {prerequisites.segmento || "Não informado"}</div>
                      <div><strong>Horário:</strong> {operacao.horarioComercial}</div>
                    </div>

                    <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
                      <h4 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 border-b pb-2">
                        <Users className="h-4 w-4 text-blue-500" />
                        Equipe & Base de Conhecimento
                      </h4>
                      <div><strong>Usuários Cadastrados:</strong> {teamUsers.length} e-mail(s)</div>
                      <div><strong>Documentos Anexados:</strong> {knowledgeFiles.length} arquivo(s)</div>
                      <div><strong>Chips WhatsApp:</strong> {canais.quantosChips} chip(s)</div>
                    </div>
                  </div>

                  {/* CAMPOS DE GO LIVE */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold">Data Prevista para Go-Live</Label>
                      <Input
                        type="date"
                        value={fechamento.dataGoLive}
                        onChange={(e) => setFechamento(f => ({ ...f, dataGoLive: e.target.value }))}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold">Responsável pelo Próximo Contato</Label>
                      <Input
                        placeholder="Ex: Gestora de Contas (Ana)"
                        value={fechamento.proximoContatoQuem}
                        onChange={(e) => setFechamento(f => ({ ...f, proximoContatoQuem: e.target.value }))}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold">Data do Próximo Contato</Label>
                      <Input
                        type="date"
                        value={fechamento.proximoContatoData}
                        onChange={(e) => setFechamento(f => ({ ...f, proximoContatoData: e.target.value }))}
                      />
                    </div>
                  </div>

                  {/* BOTÕES DE AÇÃO DE EXPORTAÇÃO */}
                  <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                    <Label className="text-xs font-bold block">Ações de Envio e Documentação:</Label>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleExportPdf({ client_name: clientName, tenant_id: selectedTenantId, model_type: modelType, num_employees: numEmployees, has_commercial_sector: hasCommercialSector, prerequisites, operacao, inteligencia, agente_ia: agenteIa, canais, status: "concluido" })}
                        className="h-10 text-xs font-bold gap-2 border-indigo-200 text-indigo-700 bg-indigo-50/50 hover:bg-indigo-100"
                      >
                        <Printer className="h-4 w-4" />
                        Exportar PDF Estilizado
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleOpenWhatsAppModal({ client_name: clientName, model_type: modelType, num_employees: numEmployees, has_commercial_sector: hasCommercialSector, prerequisites, inteligencia, agente_ia: agenteIa, canais, operacao, status: "concluido" })}
                        className="h-10 text-xs font-bold gap-2 border-emerald-200 text-emerald-700 bg-emerald-50/50 hover:bg-emerald-100"
                      >
                        <MessageSquare className="h-4 w-4" />
                        Enviar no WhatsApp
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* BARRA DE NAVEGAÇÃO DOS PASSOS (INFERIOR) */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-800">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCurrentStep((prev) => Math.max(1, prev - 1))}
              disabled={currentStep === 1}
              className="h-10 text-xs font-bold gap-2"
            >
              <ChevronLeft className="h-4 w-4" />
              Passo Anterior
            </Button>

            {currentStep < 5 ? (
              <Button
                type="button"
                onClick={() => setCurrentStep((prev) => Math.min(5, prev + 1))}
                className="h-10 px-6 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white gap-2 cursor-pointer shadow-sm"
              >
                Próximo Passo
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => saveMutation.mutate("em_andamento")}
                  disabled={saveMutation.isPending}
                  className="h-10 text-xs font-bold gap-2 border-slate-300"
                >
                  <Save className="h-4 w-4 text-slate-500" />
                  Salvar Rascunho
                </Button>
                <Button
                  type="button"
                  onClick={() => saveMutation.mutate("concluido")}
                  disabled={saveMutation.isPending}
                  className="h-10 px-6 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white gap-2 shadow-md cursor-pointer"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {editingBriefingId ? "Atualizar Implantação" : "Finalizar & Sincronizar Tenant"}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </PageShell>
    </PageShellContext.Provider>
  );
}
