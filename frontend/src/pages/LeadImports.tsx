import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useLocalStorage } from "../hooks/useLocalStorage";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  History,
  Loader2,
  Megaphone,
  Zap,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import {
  ALL_IMPORTS_VALUE,
  CRM_BASE_VALUE,
  useCreateLeadImport,
  useDeleteLeadImport,
  useLeadImports,
  useLeadImportItems,
  type LeadImportPreviewItem,
} from "@/hooks/useLeadImports";
import {
  useCampanhas,
  useCampaignAiStatus,
  useCreateCampaign,
  useDeleteCampaign,
  useGenerateCampaignTemplateVariants,
  useTriggerCampaign,
  useUpdateCampaign,
  useCampaignDispatches,
  useCreateDispatch,
  useDeleteDispatch,
  useTriggerDispatch,
  useUpdateDispatch,
  useAllDispatches,
  useDispatchPreviewLeads,
  type Campaign,
  type CampaignDispatch,
  type CampaignStatus,
  type CampaignDispatchOptions,
  type CampaignImageAsset,
  type CampaignSequenceStep,
} from "@/hooks/useCampanhas";
import {
  useConsultantSchedules,
  useCreateConsultantSchedule,
  useUpdateConsultantSchedule,
  useDeleteConsultantSchedule,
} from "@/hooks/useConsultantSchedules";
import { PageShell } from "@/components/PageShell";
import { ErrorMessage } from "@/components/ErrorMessage";
import { cn } from "@/lib/utils";
import { useCampaignPrompts, useSaveCampaignPrompt } from "@/hooks/useCampaignPrompts";
import { toast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { API_BASE_URL } from "@/lib/api";
import {
  campaignLocalDateTimeToUtcIso,
  createCampaignStep,
  detectSpreadsheetColumns,
  getLeadField,
  normalizeCampaignSequence,
  parseSpreadsheetFile,
  type FilterRule,
  type StepActionButton,
} from "@/lib/leadImports/spreadsheet";

import { LeadSourceStep } from "./LeadImports/LeadSourceStep";
import { MessageSequenceStep } from "./LeadImports/MessageSequenceStep";
import { SchedulingStep } from "./LeadImports/SchedulingStep";
import { WhatsAppPreviewPanel } from "./LeadImports/WhatsAppPreviewPanel";
import { CampaignsTable } from "./LeadImports/CampaignsTable";
import { DispatchQueueTable } from "./LeadImports/DispatchQueueTable";
import { LeadImportAuditReport } from "./LeadImports/LeadImportAuditReport";

type SheetTab = "campanha" | "enviadas" | "agendamentos" | "relatorios";
type CampaignTemplateStrategy = "single" | "ai_variations";

interface LeadImportsProps {
  fixedClientId?: string;
  fixedClientName?: string;
  title?: string;
  subtitle?: string;
  headerRight?: ReactNode;
}

const CAMPAIGN_LIMIT_MAX = 500;

const defaultDispatchOptions: CampaignDispatchOptions = {
  leadDelaySeconds: 2,
  stopOnStepFailure: true,
  aiAssisted: false,
  evolutionInstanceId: null,
  templateStrategy: "single",
  templateVariantCount: 0,
  waitForReply: false,
  replyTimeoutSeconds: 60,
  replyPollIntervalSeconds: 5,
};

const darkFieldClass =
  "border-slate-200/90 bg-white text-slate-900 shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition-all placeholder:text-slate-400 focus-visible:border-primary/35 focus-visible:ring-2 focus-visible:ring-primary/15 focus-visible:ring-offset-0 dark:border-white/12 dark:bg-black/45 dark:text-white dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_30px_rgba(0,0,0,0.18)] dark:placeholder:text-white/30 dark:focus-visible:bg-black/60 dark:focus-visible:ring-1 dark:focus-visible:ring-primary/20";

export default function LeadImports({
  fixedClientId,
  fixedClientName,
  title = "Envios por Planilha",
  subtitle = "Importe contatos, configure mensagens em massa e acompanhe a fila",
  headerRight,
}: LeadImportsProps) {
  const { clientId, getIdToken } = useAuth();
  const { selectedClientId } = useOptionalCrmClient();
  const activeClientId = fixedClientId || selectedClientId || "";
  const isInternalUser = useAuth().isInternalUser;
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useLocalStorage<SheetTab>(`vexo_activeTab_${activeClientId}`, "campanha");

  // Lead spreadsheet upload states
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<Record<string, unknown>[]>([]);
  const [showNumbersModal, setShowNumbersModal] = useState(false);
  const [isImportingFile, setIsImportingFile] = useState(false);
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);

  const filteredRows = useMemo(() => {
    if (filterRules.length === 0) return parsedRows;
    return parsedRows.filter((row) => {
      return filterRules.every((rule) => {
        if (!rule.column) return true;
        const rawValue = row[rule.column];
        const valStr = String(rawValue ?? "").trim();
        const ruleVal = rule.value.trim();

        switch (rule.operator) {
          case "equals":
            return valStr.toLowerCase() === ruleVal.toLowerCase();
          case "contains":
            return valStr.toLowerCase().includes(ruleVal.toLowerCase());
          case "gt": {
            const num = parseFloat(valStr.replace(/[^\d\.,-]/g, "").replace(",", "."));
            const ruleNum = parseFloat(ruleVal);
            return !isNaN(num) && !isNaN(ruleNum) && num > ruleNum;
          }
          case "lt": {
            const num = parseFloat(valStr.replace(/[^\d\.,-]/g, "").replace(",", "."));
            const ruleNum = parseFloat(ruleVal);
            return !isNaN(num) && !isNaN(ruleNum) && num < ruleNum;
          }
          default:
            return true;
        }
      });
    });
  }, [parsedRows, filterRules]);

  const previewRows = useMemo(() => filteredRows.slice(0, 10), [filteredRows]);

  const spreadsheetColumns = useMemo(() => {
    if (parsedRows.length === 0) return [];
    return Object.keys(parsedRows[0]);
  }, [parsedRows]);

  const [parseError, setParseError] = useState<string | null>(null);
  const [selectedImportId, setSelectedImportId] = useState<string>(ALL_IMPORTS_VALUE);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDispatchId, setPreviewDispatchId] = useState<string | null>(null);

  // Campaign builder states
  const [editingCampaignId, setEditingCampaignId] = useLocalStorage<string | null>(`vexo_campaignId_${activeClientId}`, null);
  const [campaignName, setCampaignName] = useLocalStorage(`vexo_campaignName_${activeClientId}`, "");
  const [campaignLimitPerRun, setCampaignLimitPerRun] = useLocalStorage(`vexo_campaignLimit_${activeClientId}`, "50");
  const [campaignSequence, setCampaignSequence] = useLocalStorage<Array<CampaignSequenceStep & { buttons?: StepActionButton[] }>>(`vexo_campaignSequence_${activeClientId}`, [
    createCampaignStep("text", 1),
  ]);
  const [campaignTemplateStrategy, setCampaignTemplateStrategy] = useLocalStorage<CampaignTemplateStrategy>(`vexo_campaignStrategy_${activeClientId}`, "single");
  const [dispatchOptions, setDispatchOptions] = useLocalStorage<CampaignDispatchOptions>(`vexo_campaignDispatchOpts_${activeClientId}`, defaultDispatchOptions);

  // Scheduling & parameters states
  const [multiAgendaEnabled, setMultiAgendaEnabled] = useLocalStorage(`vexo_multiAgenda_${activeClientId}`, false);
  const [newConsultantName, setNewConsultantName] = useLocalStorage(`vexo_consultantName_${activeClientId}`, "");
  const [newConsultantLink, setNewConsultantLink] = useLocalStorage(`vexo_consultantLink_${activeClientId}`, "");
  const [newTriggerType, setNewTriggerType] = useLocalStorage<"manual" | "scheduled" | "draft">(`vexo_triggerType_${activeClientId}`, "manual");
  const [newScheduledAt, setNewScheduledAt] = useLocalStorage(`vexo_scheduledAt_${activeClientId}`, "");
  const [batchingEnabled, setBatchingEnabled] = useLocalStorage(`vexo_batching_${activeClientId}`, false);
  const [batchSize, setBatchSize] = useLocalStorage(`vexo_batchSize_${activeClientId}`, "100");
  const [batchIntervalHours, setBatchIntervalHours] = useLocalStorage(`vexo_batchInterval_${activeClientId}`, "1");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sequenceImageInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedImageStepId, setSelectedImageStepId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittingStatus, setSubmittingStatus] = useState<string | null>(null);

  // Hooks queries
  const { data: imports = [], refetch: refetchImports } = useLeadImports(activeClientId);
  const { data: campaigns = [], isLoading: loadingCampaigns, refetch: refetchCampaigns } = useCampanhas(activeClientId || undefined);
  const { data: dispatches = [], isLoading: loadingDispatches, refetch: refetchDispatches } = useAllDispatches(activeClientId || null);
  const { data: previewLeadsData, isLoading: loadingPreviewLeads } = useDispatchPreviewLeads(previewDispatchId);
  const { data: consultants = [], refetch: refetchConsultants } = useConsultantSchedules(activeClientId);
  const createConsultant = useCreateConsultantSchedule();
  const updateConsultant = useUpdateConsultantSchedule();
  const deleteConsultant = useDeleteConsultantSchedule();

  const { data: pendingData, refetch: refetchPending } = useLeadImportItems(
    activeClientId,
    selectedImportId === ALL_IMPORTS_VALUE ? undefined : selectedImportId,
    "pending"
  );

  // Mutations
  const createLeadImport = useCreateLeadImport();
  const deleteLeadImport = useDeleteLeadImport();
  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const deleteCampaign = useDeleteCampaign();
  const triggerCampaign = useTriggerCampaign();
  const generateTemplateVariants = useGenerateCampaignTemplateVariants();
  const createDispatch = useCreateDispatch(""); // campaign-specific instances are created dynamically
  const deleteDispatch = useDeleteDispatch("");
  const triggerDispatch = useTriggerDispatch("");
  const updateDispatch = useUpdateDispatch("");

  // Resolving tenant options
  const crmClient = useOptionalCrmClient();
  const selectedClient = crmClient?.selectedClient || null;
  const selectedLeadClient = selectedClient || crmClient?.clients.find((c) => c.id === activeClientId) || null;
  const evolutionInstanceOptions = useMemo(
    () =>
      (selectedLeadClient?.n8n_settings?.evolution_instances || [])
        .filter((inst) => inst.active && inst.dispatch_webhook_url)
        .map((inst) => ({
          id: inst.id,
          name: inst.name || "Evolution",
          isDefault: inst.is_default,
        })),
    [selectedLeadClient]
  );

  const resolvedClientName = fixedClientName || selectedClient?.name || activeClientId;

  // Initialize/refresh settings
  useEffect(() => {
    const defaultInstanceId =
      evolutionInstanceOptions.find((inst) => inst.isDefault)?.id ||
      evolutionInstanceOptions[0]?.id ||
      null;

    setDispatchOptions((current) => ({
      ...current,
      evolutionInstanceId: current.evolutionInstanceId && evolutionInstanceOptions.some(i => i.id === current.evolutionInstanceId)
        ? current.evolutionInstanceId
        : defaultInstanceId,
    }));
  }, [evolutionInstanceOptions]);

  // Statistics calculation for uploaded leads
  const parsedLeadsStats = useMemo(() => {
    if (filteredRows.length === 0) return { total: 0, valid: 0, invalid: 0 };
    let valid = 0;
    filteredRows.forEach((row) => {
      const phone = getLeadField(row, ["telefone", "celular", "phone", "number", "whatsapp"]);
      if (phone && phone.replace(/\D/g, "").length >= 8) {
        valid++;
      }
    });
    return {
      total: filteredRows.length,
      valid,
      invalid: filteredRows.length - valid,
    };
  }, [filteredRows]);

  // Handle excel/csv parsed rows
  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    if (file && file.name.endsWith(".numbers")) {
      setShowNumbersModal(true);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setSelectedFile(file);
    setParseError(null);
    setParsedRows([]);
    setFilterRules([]);

    if (!file) return;
    try {
      const rows = await parseSpreadsheetFile(file);
      const mapping = detectSpreadsheetColumns(rows);
      const normalizedRows = rows.map((row) => {
        const newRow = { ...row };
        if (mapping.telefone) {
          newRow.telefone = String(row[mapping.telefone] ?? "").trim();
          if (mapping.telefone !== "telefone") {
            delete newRow[mapping.telefone];
          }
        }
        if (mapping.nome) {
          newRow.nome = String(row[mapping.nome] ?? "").trim();
          if (mapping.nome !== "nome") {
            delete newRow[mapping.nome];
          }
        }
        return newRow;
      });
      const filteredNormalizedRows = normalizedRows.filter((row) => {
        const phoneVal = String(row.telefone ?? "").trim().toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "");
        const nameVal = String(row.nome ?? "").trim().toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "");

        // If phone value matches header keywords (like "telefone", "whatsapp", "phone") and name matches name keywords
        const isPhoneHeader = ["telefone", "celular", "phone", "fone", "whatsapp", "number", "numero"].some(alias => phoneVal.includes(alias));
        const isNameHeader = ["nome", "name", "cliente", "contato", "lead", "responsavel"].some(alias => nameVal.includes(alias));

        if (isPhoneHeader && isNameHeader) {
          return false;
        }

        // Also if phone contains only letters (e.g. "telefone" or "celular"), it is definitely a header and not a phone number
        if (phoneVal !== "" && /^[a-zA-Z_]+$/.test(phoneVal)) {
          return false;
        }

        // Also if name matches a header and phone is empty/invalid, it is likely a header
        if ((phoneVal === "" || phoneVal === "telefone") && ["nome", "name", "cliente", "contato", "lead", "responsavel"].includes(nameVal)) {
          return false;
        }

        return true;
      });
      setParsedRows(filteredNormalizedRows);
      setCampaignName(file.name.replace(/\.[^/.]+$/, ""));
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Falha ao analisar a planilha.");
    }
  }

  async function handleImportSpreadsheetOnly() {
    if (!selectedFile || parsedRows.length === 0) return;
    setIsImportingFile(true);
    try {
      const importRes = await createLeadImport.mutateAsync({
        clientId: activeClientId,
        sourceName: selectedFile.name,
        sourceType: selectedFile.name.split(".").pop()?.toLowerCase() || "spreadsheet",
        rows: parsedRows,
      });

      toast({
        title: "Planilha importada",
        description: `A base "${selectedFile.name}" foi importada com sucesso com ${parsedRows.length} contatos.`,
      });

      await refetchImports();
      setSelectedImportId(importRes.item.id);

      setSelectedFile(null);
      setParsedRows([]);
      setFilterRules([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      toast({
        title: "Erro ao importar planilha",
        description: err instanceof Error ? err.message : "Erro desconhecido.",
        variant: "destructive",
      });
    } finally {
      setIsImportingFile(false);
    }
  }

  // Handle sequence step modifications
  function updateCampaignStep(stepId: string, patch: Partial<CampaignSequenceStep & { buttons?: StepActionButton[] }>) {
    setCampaignSequence((current) =>
      current.map((step) => (step.id === stepId ? { ...step, ...patch } : step))
    );
  }

  function addCampaignStep(type: "text" | "image") {
    setCampaignSequence((current) => [
      ...current,
      createCampaignStep(type, current.length + 1),
    ]);
  }

  function removeCampaignStep(stepId: string) {
    setCampaignSequence((current) => {
      const filtered = current.filter((step) => step.id !== stepId);
      return filtered.length > 0
        ? filtered.map((step, idx) => ({ ...step, order: idx + 1 }))
        : [createCampaignStep("text", 1)];
    });
  }

  function moveCampaignStep(stepId: string, direction: -1 | 1) {
    setCampaignSequence((current) => {
      const index = current.findIndex((step) => step.id === stepId);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current;

      const next = [...current];
      const [step] = next.splice(index, 1);
      next.splice(targetIndex, 0, step);
      return next.map((s, idx) => ({ ...s, order: idx + 1 }));
    });
  }

  // Handle trigger sequence image change
  async function handleSequenceImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    const stepId = selectedImageStepId;
    if (!file || !stepId) return;

    if (!file.type.startsWith("image/")) {
      toast({ title: "Arquivo inválido", description: "Por favor, envie uma imagem.", variant: "destructive" });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "Imagem muito grande", description: "O tamanho máximo é de 2MB.", variant: "destructive" });
      return;
    }

    try {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        updateCampaignStep(stepId, {
          image: {
            name: file.name,
            type: file.type,
            size: file.size,
            dataUrl,
          },
        });
      };
      reader.readAsDataURL(file);
    } catch {
      toast({ title: "Erro", description: "Falha ao carregar a imagem.", variant: "destructive" });
    } finally {
      event.target.value = "";
      setSelectedImageStepId(null);
    }
  }

  // Generate AI Variations inline for a step
  const handleGenerateStepVariants = async (stepId: string, baseText: string) => {
    if (!activeClientId || !baseText.trim()) {
      toast({ title: "Campo de texto vazio", description: "Digite a mensagem base antes de gerar variações.", variant: "destructive" });
      return;
    }
    try {
      updateCampaignStep(stepId, { textVariants: [] });
      toast({ title: "Gerando variações...", description: "A IA está processando variações humanizadas." });
      const result = await generateTemplateVariants.mutateAsync({
        baseText: baseText.trim(),
      });
      updateCampaignStep(stepId, { textVariants: result.variants || [] });
      toast({ title: "Sucesso!", description: "3 variações humanizadas foram geradas." });
    } catch (err) {
      toast({
        title: "Erro ao gerar variações",
        description: err instanceof Error ? err.message : "Erro desconhecido.",
        variant: "destructive",
      });
    }
  };

  const handleCreateConsultant = () => {
    if (!newConsultantName.trim() || !newConsultantLink.trim()) {
      toast({ title: "Campos vazios", description: "Preencha o nome e o link de agendamento.", variant: "destructive" });
      return;
    }
    if (!newConsultantLink.trim().startsWith("http")) {
      toast({ title: "Link invalido", description: "O link de agendamento deve comecar com http:// ou https://.", variant: "destructive" });
      return;
    }
    createConsultant.mutate(
      {
        clientId: activeClientId,
        name: newConsultantName.trim(),
        scheduling_link: newConsultantLink.trim(),
      },
      {
        onSuccess: () => {
          setNewConsultantName("");
          setNewConsultantLink("");
          toast({ title: "Consultor adicionado com sucesso." });
        },
      }
    );
  };

  // Manage Action buttons inside step cards
  function handleAddStepButton(stepId: string) {
    const step = campaignSequence.find((s) => s.id === stepId);
    if (!step) return;
    const currentButtons = step.buttons || [];
    if (currentButtons.length >= 3) {
      toast({ title: "Limite atingido", description: "O limite máximo é de 3 botões por mensagem." });
      return;
    }
    const updated = [...currentButtons, { displayText: "Link de Acesso", type: "url" as const, url: "{{scheduling_link}}" }];
    updateCampaignStep(stepId, { buttons: updated });
  }

  function handleRemoveStepButton(stepId: string, btnIndex: number) {
    const step = campaignSequence.find((s) => s.id === stepId);
    if (!step) return;
    const currentButtons = step.buttons || [];
    const updated = currentButtons.filter((_, idx) => idx !== btnIndex);
    updateCampaignStep(stepId, { buttons: updated });
  }

  function handleUpdateStepButton(stepId: string, btnIndex: number, patch: Partial<StepActionButton>) {
    const step = campaignSequence.find((s) => s.id === stepId);
    if (!step) return;
    const currentButtons = step.buttons || [];
    const updated = currentButtons.map((btn, idx) => (idx === btnIndex ? { ...btn, ...patch } : btn));
    updateCampaignStep(stepId, { buttons: updated });
  }

  // Consolidated linear creation submit trigger
  async function handleCreateAndDispatch() {
    if (!activeClientId) {
      toast({ title: "Seção Inválida", description: "Selecione uma empresa no seletor.", variant: "destructive" });
      return;
    }
    if (!campaignName.trim()) {
      toast({ title: "Nome ausente", description: "Defina um nome de identificação para o envio.", variant: "destructive" });
      return;
    }
    if (!selectedFile && selectedImportId === ALL_IMPORTS_VALUE) {
      toast({ title: "Base de leads ausente", description: "Por favor, carregue uma planilha ou selecione uma base ativa (ou CRM).", variant: "destructive" });
      return;
    }

    const enabledSteps = campaignSequence.filter((s) => s.enabled);
    if (enabledSteps.length === 0) {
      toast({ title: "Mensagem vazia", description: "Adicione pelo menos um passo ativo na timeline de envio.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    setSubmittingStatus("Preparando importação de leads...");

    try {
      let finalImportId = selectedImportId;
      let finalRowsCount = 0;

      // 1. If upload a new file, run lead import first
      if (selectedFile && filteredRows.length > 0) {
        setSubmittingStatus("Processando planilha e aplicando round-robin...");
        const activeLinks = multiAgendaEnabled
          ? consultants.filter(c => c.active).map(c => c.scheduling_link)
          : [];

        // Apply Round-Robin directly on rows
        const finalRows = activeLinks.length > 0
          ? filteredRows.map((row, idx) => ({
              ...row,
              scheduling_link: activeLinks[idx % activeLinks.length],
            }))
          : filteredRows;

        finalRowsCount = finalRows.length;

        const importRes = await createLeadImport.mutateAsync({
          clientId: activeClientId,
          sourceName: selectedFile.name,
          sourceType: selectedFile.name.split(".").pop()?.toLowerCase() || "spreadsheet",
          rows: finalRows,
        });
        finalImportId = importRes.item.id;
      }

      setSubmittingStatus("Configurando campanha e timeline...");
      const limitPerRun = Number.parseInt(campaignLimitPerRun, 10) || 50;

      // Make sure template strategy matches variants state
      const hasVariants = campaignSequence.some(s => s.textVariants && s.textVariants.length > 0);
      const templateStrategy: "single" | "ai_variations" = hasVariants ? "ai_variations" : "single";

      const limitForCampaign = batchingEnabled ? (Number.parseInt(batchSize, 10) || 100) : limitPerRun;

      const campaignPayload = {
        name: campaignName.trim(),
        clientId: activeClientId,
        importId: finalImportId === ALL_IMPORTS_VALUE ? null : finalImportId,
        limitPerRun: limitForCampaign,
        mode: "disparo" as const,
        campaignPromptId: null,
        startsAt: null,
        endsAt: null,
        analyticsMeta: {
          // Segmentação unificada: as regras dinâmicas (coluna/operador/valor) viram o
          // filtro de disparo. Mesmo shape do catálogo da empresa e do matcher do backend.
          segmentation: {
            filters: filterRules
              .filter((rule) => rule.column && String(rule.value ?? "").trim() !== "")
              .map((rule) => ({ field: rule.column, operator: rule.operator, value: rule.value })),
          },
          message: campaignSequence.find(s => s.type === "text")?.text || "",
          image: campaignSequence.find(s => s.type === "image")?.image,
          sequence: campaignSequence,
          dispatchOptions: {
            ...dispatchOptions,
            aiAssisted: hasVariants,
            templateStrategy,
            templateVariantCount: hasVariants ? (campaignSequence.find(s => s.type === "text")?.textVariants?.length || 0) : 0,
          },
        },
      };

      let campaignId = "";
      if (editingCampaignId) {
        const updated = await updateCampaign.mutateAsync({
          id: editingCampaignId,
          ...campaignPayload,
        });
        campaignId = updated.id;
      } else {
        const created = await createCampaign.mutateAsync(campaignPayload);
        campaignId = created.id;
      }

      setSubmittingStatus("Registrando lote na fila de envios...");

      // 2. Register Dispatch Batch Execution
      const token = await getIdToken();
      const scheduledIso = newTriggerType === "scheduled" && newScheduledAt ? campaignLocalDateTimeToUtcIso(newScheduledAt) : null;

      let totalLeads = 0;
      if (selectedFile) {
        totalLeads = finalRowsCount;
      } else {
        const selectedImportRecord = imports.find(imp => imp.id === selectedImportId);
        totalLeads = selectedImportRecord ? selectedImportRecord.imported_rows : (pendingData?.total || 0);
      }

      if (batchingEnabled && totalLeads > 0) {
        const size = Number.parseInt(batchSize, 10) || 100;
        const interval = Number.parseFloat(batchIntervalHours) || 1;
        const numBatches = Math.ceil(totalLeads / size);

        let baseDate = newTriggerType === "scheduled" && newScheduledAt ? new Date(newScheduledAt) : new Date();

        for (let i = 0; i < numBatches; i++) {
          const offset = i * size;
          const batchDate = new Date(baseDate.getTime() + i * interval * 60 * 60 * 1000);
          const batchScheduledIso = batchDate.toISOString();
          let batchTriggerType = "scheduled";
          if (newTriggerType === "manual" && i === 0) batchTriggerType = "manual";
          if (newTriggerType === "draft") batchTriggerType = "draft";

          const dispatchRes = await fetch(`${API_BASE_URL}/api/campaigns/${campaignId}/dispatches`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              name: `${campaignName.trim()} — Lote ${i + 1}/${numBatches}`,
              steps: campaignSequence,
              triggerType: batchTriggerType,
              status: batchTriggerType === "draft" ? "draft" : undefined,
              scheduledAt: (batchTriggerType === "scheduled") ? batchScheduledIso : null,
              evolutionInstanceId: dispatchOptions.evolutionInstanceId,
              limitPerRun: size,
              offset: offset,
            }),
          });
          if (!dispatchRes.ok) throw new Error(`Erro ao registrar lote ${i + 1} de disparo.`);
          const dispatchData = await dispatchRes.json();
          const dispatchId = dispatchData.dispatch.id;

          // Se for manual e for o primeiro lote, dispara imediatamente
          if (i === 0 && newTriggerType === "manual") {
            setSubmittingStatus(`Disparando lote 1/${numBatches}...`);
            await fetch(`${API_BASE_URL}/api/campaigns/dispatches/${dispatchId}/trigger`, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` },
            });
          }
        }
        toast({ title: "Sucesso!", description: `${numBatches} lotes criados e enfileirados com sucesso.` });
      } else {
        const dispatchRes = await fetch(`${API_BASE_URL}/api/campaigns/${campaignId}/dispatches`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            name: `${campaignName.trim()} — Lote Principal`,
            steps: campaignSequence,
            triggerType: newTriggerType,
            status: newTriggerType === "draft" ? "draft" : undefined,
            scheduledAt: scheduledIso,
            evolutionInstanceId: dispatchOptions.evolutionInstanceId,
          }),
        });
        if (!dispatchRes.ok) throw new Error("Erro ao registrar lote de disparo.");
        const dispatchData = await dispatchRes.json();
        const dispatchId = dispatchData.dispatch.id;

        // 3. Trigger immediate execution if manual
        if (newTriggerType === "manual") {
          setSubmittingStatus("Disparando lote de envios...");
          await fetch(`${API_BASE_URL}/api/campaigns/dispatches/${dispatchId}/trigger`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          });
          toast({ title: "Sucesso!", description: "O lote de disparos foi iniciado com sucesso." });
        } else if (newTriggerType === "draft") {
          toast({ title: "Sucesso!", description: "Campanha salva como rascunho (Stand by)." });
        } else {
          toast({ title: "Sucesso!", description: "Lote de disparos agendado com sucesso." });
        }
      }

      // Reset form and view queue
      setSelectedFile(null);
      setParsedRows([]);
      setFilterRules([]);
      setBatchingEnabled(false);
      setBatchSize("100");
      setBatchIntervalHours("1");
      setCampaignName("");
      setEditingCampaignId(null);
      setCampaignSequence([createCampaignStep("text", 1)]);
      setNewConsultantName("");
      setNewConsultantLink("");
      setMultiAgendaEnabled(false);
      setNewScheduledAt("");
      setNewTriggerType("manual");

      await Promise.allSettled([refetchCampaigns(), refetchDispatches(), refetchImports(), refetchPending()]);
      setActiveTab("agendamentos");
    } catch (err) {
      toast({
        title: "Erro na operação",
        description: err instanceof Error ? err.message : "Erro desconhecido ao processar lote.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
      setSubmittingStatus(null);
    }
  }

  // Actions for existing dispatches (executions)
  const handleTriggerDispatchBatch = async (dispId: string) => {
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/campaigns/dispatches/${dispId}/trigger`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Erro ao iniciar lote.");
      toast({ title: "Lote iniciado", description: "Processamento de envios em andamento." });
      refetchDispatches();
    } catch (err) {
      toast({ title: "Erro", description: err instanceof Error ? err.message : "Não foi possível iniciar.", variant: "destructive" });
    }
  };

  const handlePauseDispatchBatch = async (dispId: string) => {
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/campaigns/dispatches/${dispId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paused" }),
      });
      if (!res.ok) throw new Error("Erro ao pausar lote.");
      toast({ title: "Lote pausado" });
      refetchDispatches();
    } catch (err) {
      toast({ title: "Erro", description: err instanceof Error ? err.message : "Não foi possível pausar.", variant: "destructive" });
    }
  };

  const handleDeleteDispatchBatch = async (dispId: string) => {
    if (!confirm("Excluir lote permanentemente do histórico?")) return;
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/campaigns/dispatches/${dispId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Erro ao excluir lote.");
      toast({ title: "Lote removido" });
      refetchDispatches();
    } catch (err) {
      toast({ title: "Erro", description: err instanceof Error ? err.message : "Não foi possível remover.", variant: "destructive" });
    }
  };

  const handleDownloadFailedCsv = async (disp: CampaignDispatch) => {
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/campaigns/dispatches/${disp.id}/failed?format=csv`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Falha ao gerar CSV.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `falhas-${disp.name.toLowerCase().replace(/\s+/g, "-")}-${disp.id}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ title: "Erro de download", description: "Não foi possível obter o CSV de falhas.", variant: "destructive" });
    }
  };

  const handleEditCampaign = (c: Campaign) => {
    const meta = c.analytics_meta || {};
    const seq = normalizeCampaignSequence(c.analytics_meta);
    setEditingCampaignId(c.id);
    setCampaignName(c.name || "");
    setCampaignLimitPerRun(String(c.limit_per_run || 50));
    setCampaignSequence(seq.length > 0 ? seq : [createCampaignStep("text", 1)]);
    setSelectedImportId(c.import_id || ALL_IMPORTS_VALUE);
    setDispatchOptions(meta.dispatchOptions || defaultDispatchOptions);
    setActiveTab("campanha");
    toast({ title: "Carregado para edição", description: `Edite a campanha "${c.name}" no formulário de Novo Disparo.` });
  };

  const handleDeleteCampaign = async (c: Campaign) => {
    if (!confirm(`Excluir a campanha "${c.name}" e todas as configurações permanentemente?`)) return;
    try {
      await deleteCampaign.mutateAsync(c.id);
      toast({ title: "Campanha excluída com sucesso." });
      refetchCampaigns();
    } catch (err) {
      toast({ title: "Erro", description: err instanceof Error ? err.message : "Erro ao excluir.", variant: "destructive" });
    }
  };

  return (
    <PageShell
      title={title}
      subtitle={subtitle}
      headerRight={headerRight}
      spacing="space-y-6"
      showGlobalClientSelector={!fixedClientId}
    >
      {/* Dynamic Overlay Loader */}
      {isSubmitting && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 backdrop-blur-md">
          <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
          <h3 className="text-lg font-bold text-white">Processando Operação</h3>
          <p className="text-sm text-slate-400 mt-1">{submittingStatus}</p>
        </div>
      )}

      {/* Tabs Navigation */}
      <div className="w-full flex justify-start rounded-xl border border-border bg-muted/30 p-1 dark:bg-muted/10">
        <button
          onClick={() => setActiveTab("campanha")}
          className={cn(
            "rounded-lg px-4 py-2 text-xs font-semibold flex items-center gap-1.5 transition-all",
            activeTab === "campanha" ? "bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          )}
        >
          <Megaphone className="h-3.5 w-3.5" />
          Novo Disparo
        </button>
        <button
          onClick={() => setActiveTab("enviadas")}
          className={cn(
            "rounded-lg px-4 py-2 text-xs font-semibold flex items-center gap-1.5 transition-all",
            activeTab === "enviadas" ? "bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          )}
        >
          <History className="h-3.5 w-3.5" />
          Campanhas
        </button>
        <button
          onClick={() => setActiveTab("agendamentos")}
          className={cn(
            "rounded-lg px-4 py-2 text-xs font-semibold flex items-center gap-1.5 transition-all",
            activeTab === "agendamentos" ? "bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          )}
        >
          <Zap className="h-3.5 w-3.5" />
          Fila de Envios
        </button>
        <button
          onClick={() => setActiveTab("relatorios")}
          className={cn(
            "rounded-lg px-4 py-2 text-xs font-semibold flex items-center gap-1.5 transition-all",
            activeTab === "relatorios" ? "bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          )}
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />
          Relatório & Auditoria
        </button>
      </div>

      {/* 🚀 TAB 1: NOVO DISPARO (Consolidated Linear Wizard) */}
      {activeTab === "campanha" && (
        <div className="grid gap-6 lg:grid-cols-3 items-start">
          {/* Main Wizard Form */}
          <div className="lg:col-span-2 space-y-6">
            <LeadSourceStep
              campaignName={campaignName}
              setCampaignName={setCampaignName}
              fileInputRef={fileInputRef}
              selectedFile={selectedFile}
              isImportingFile={isImportingFile}
              onFileChange={handleFileChange}
              onImportSpreadsheetOnly={handleImportSpreadsheetOnly}
              showNumbersModal={showNumbersModal}
              onCloseNumbersModal={() => setShowNumbersModal(false)}
              setSelectedFile={setSelectedFile}
              setParsedRows={setParsedRows}
              selectedImportId={selectedImportId}
              setSelectedImportId={setSelectedImportId}
              imports={imports}
              filterRules={filterRules}
              setFilterRules={setFilterRules}
              spreadsheetColumns={spreadsheetColumns}
              parsedRows={parsedRows}
              parsedLeadsStats={parsedLeadsStats}
              previewOpen={previewOpen}
              setPreviewOpen={setPreviewOpen}
              previewRows={previewRows}
            />

            <MessageSequenceStep
              sequenceImageInputRef={sequenceImageInputRef}
              onSequenceImageChange={handleSequenceImageChange}
              campaignSequence={campaignSequence}
              updateCampaignStep={updateCampaignStep}
              moveCampaignStep={moveCampaignStep}
              removeCampaignStep={removeCampaignStep}
              addCampaignStep={addCampaignStep}
              onSelectImageStep={setSelectedImageStepId}
              isGeneratingVariants={generateTemplateVariants.isPending}
              onGenerateVariants={handleGenerateStepVariants}
              onAddStepButton={handleAddStepButton}
              onRemoveStepButton={handleRemoveStepButton}
              onUpdateStepButton={handleUpdateStepButton}
            />

            <SchedulingStep
              dispatchOptions={dispatchOptions}
              setDispatchOptions={setDispatchOptions}
              evolutionInstanceOptions={evolutionInstanceOptions}
              batchingEnabled={batchingEnabled}
              setBatchingEnabled={setBatchingEnabled}
              batchSize={batchSize}
              setBatchSize={setBatchSize}
              batchIntervalHours={batchIntervalHours}
              setBatchIntervalHours={setBatchIntervalHours}
              multiAgendaEnabled={multiAgendaEnabled}
              setMultiAgendaEnabled={setMultiAgendaEnabled}
              consultants={consultants}
              updateConsultant={updateConsultant}
              deleteConsultant={deleteConsultant}
              activeClientId={activeClientId}
              newConsultantName={newConsultantName}
              setNewConsultantName={setNewConsultantName}
              newConsultantLink={newConsultantLink}
              setNewConsultantLink={setNewConsultantLink}
              onCreateConsultant={handleCreateConsultant}
              createConsultant={createConsultant}
              newTriggerType={newTriggerType}
              setNewTriggerType={setNewTriggerType}
              newScheduledAt={newScheduledAt}
              setNewScheduledAt={setNewScheduledAt}
              onSubmit={handleCreateAndDispatch}
              isSubmitting={isSubmitting}
              editingCampaignId={editingCampaignId}
              onCancelEdit={() => {
                setEditingCampaignId(null);
                setCampaignName("");
                setCampaignSequence([createCampaignStep("text", 1)]);
              }}
            />
          </div>

          {/* Interactive Phone Mockup Preview Panel (Right Side) */}
          <WhatsAppPreviewPanel campaignSequence={campaignSequence} multiAgendaEnabled={multiAgendaEnabled} />
        </div>
      )}

      {/* 📋 TAB 2: CAMPANHAS CRIADAS (Clean table list) */}
      {activeTab === "enviadas" && (
        <CampaignsTable
          campaigns={campaigns}
          loadingCampaigns={loadingCampaigns}
          onEditCampaign={handleEditCampaign}
          onDeleteCampaign={handleDeleteCampaign}
        />
      )}

      {/* ⚡ TAB 3: FILA DE ENVIOS (Cross-campaign dispatch executions) */}
      {activeTab === "agendamentos" && (
        <DispatchQueueTable
          dispatches={dispatches}
          loadingDispatches={loadingDispatches}
          refetchDispatches={refetchDispatches}
          onTriggerDispatchBatch={handleTriggerDispatchBatch}
          onPauseDispatchBatch={handlePauseDispatchBatch}
          onDownloadFailedCsv={handleDownloadFailedCsv}
          onDeleteDispatchBatch={handleDeleteDispatchBatch}
          onPreviewDispatch={(dispId) => setPreviewDispatchId(dispId)}
        />
      )}

      {/* 📊 TAB 4: AUDITORIA & RECAMPANHAS */}
      {activeTab === "relatorios" && (
        <LeadImportAuditReport
          activeClientId={activeClientId}
          imports={imports}
          onSelectImportForFollowup={(newImportId) => {
            setSelectedImportId(newImportId);
            setSelectedFile(null);
            setParsedRows([]);
            setFilterRules([]);
            setActiveTab("campanha");
          }}
        />
      )}

      {/* Preview Leads Modal */}
      <Dialog open={!!previewDispatchId} onOpenChange={(open) => !open && setPreviewDispatchId(null)}>
        <DialogContent className="max-w-2xl bg-white dark:bg-slate-900 border border-border shadow-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold font-display text-foreground">Leads Alvo do Disparo</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {loadingPreviewLeads
                ? "Carregando leads..."
                : previewLeadsData
                  ? `Mostrando ${previewLeadsData.leads.length} de ${previewLeadsData.total} leads encontrados para as regras desta campanha.`
                  : "Nenhum lead carregado."}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[400px] overflow-y-auto mt-4 rounded-lg border border-border bg-slate-50 dark:bg-slate-900/50 p-2">
            {loadingPreviewLeads ? (
              <div className="flex flex-col items-center justify-center h-32 gap-3 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
                <p className="text-xs font-medium">Buscando leads na base...</p>
              </div>
            ) : previewLeadsData?.leads && previewLeadsData.leads.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border/50 hover:bg-transparent">
                    <TableHead className="text-xs font-semibold uppercase">Nome</TableHead>
                    <TableHead className="text-xs font-semibold uppercase text-right">Telefone</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewLeadsData.leads.map((l, i) => (
                    <TableRow key={i} className="border-b border-border/20 last:border-0 hover:bg-slate-100 dark:hover:bg-slate-800">
                      <TableCell className="font-medium text-sm">{l.nome || "—"}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">{l.telefone}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="flex flex-col items-center justify-center h-32 gap-3 text-muted-foreground">
                <p className="text-sm font-medium">Nenhum lead encontrado para os filtros configurados.</p>
              </div>
            )}
          </div>

          <DialogFooter className="mt-2">
            <Button onClick={() => setPreviewDispatchId(null)} variant="outline" className="w-full sm:w-auto text-xs font-bold rounded-xl">
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
