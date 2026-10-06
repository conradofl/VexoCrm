import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useLocalStorage } from "../hooks/useLocalStorage";
import {
  Building2,
  ChevronLeft,
  Database,
  ChevronRight,
  FileSpreadsheet,
  History,
  Loader2,
  Megaphone,
  Trash2,
  Eye,
  Zap,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { MassDeleteDialog } from "@/components/leads/MassDeleteDialog";
import { canMassDeleteLeads } from "@/lib/leadMassDelete";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import {
  ALL_IMPORTS_VALUE,
  CRM_BASE_VALUE,
  useCreateLeadImport,
  useDeleteLeadImport,
  useLeadImports,
  useResumeLeadImport,
  useLeadImportItems,
  useLeadCustomFields,
  type LeadImportItem,
  type LeadImportPreviewItem,
} from "@/hooks/useLeadImports";
import {
  saveCampaignWithSelfHeal,
  useCampanhas,
  useCampaignAiStatus,
  useCreateCampaign,
  useDeleteCampaign,
  useGenerateCampaignTemplateVariants,
  useUpdateCampaign,
  useCampaignDispatches,
  useCreateDispatch,
  useDeleteDispatch,
  useTriggerDispatch,
  useUpdateDispatch,
  useAllDispatches,
  type Campaign,
  type CampaignDispatch,
  type CampaignStatus,
  type CampaignDispatchOptions,
  type CampaignImageAsset,
  type CampaignSequenceStep,
} from "@/hooks/useCampanhas";
import { DispatchRecipientsDialog } from "./LeadImports/DispatchRecipientsDialog";
import { DuplicateDispatchWarningDialog } from "./LeadImports/DuplicateDispatchWarningDialog";
import { SavedSheetsCards } from "./LeadImports/SavedSheetsCards";
import {
  useConsultantSchedules,
  useCreateConsultantSchedule,
  useUpdateConsultantSchedule,
  useDeleteConsultantSchedule,
} from "@/hooks/useConsultantSchedules";
import { PageShell } from "@/components/PageShell";
import { ErrorMessage } from "@/components/ErrorMessage";
import { UpsellCard } from "@/components/UpsellCard";
import { hasFeatureUnlocked } from "@/lib/planTier";
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
  proposeColumnMappings,
  validateColumnMappings,
  findMatchingRememberedMapping,
  applyColumnMappingsToRow,
  auditMessageVariablesAgainstLeads,
  extractCustomFieldsFromRows,
  getCommonCustomFields,
  getMissingFieldCount,
  evaluateLeadFilterRule,
  type CustomFieldDefinition,
  type ColumnMappingItem,
  type FilterRule,
  type StepActionButton,
} from "@/lib/leadImports/spreadsheet";

import { LeadSourceStep, type PhoneAuditStats } from "./LeadImports/LeadSourceStep";
import { classifyPhoneAudit } from "@/lib/leadImports/phoneAudit";
import { ImportBatchError, ImportFileMismatchError, type ImportProgress } from "@/lib/leadImports/batchedImport";
import { describeImportProgress, isImportIncomplete } from "@/lib/leadImports/importStatus";
import { ImportProgressBanner } from "./LeadImports/ImportProgressBanner";
import { MessageSequenceStep } from "./LeadImports/MessageSequenceStep";
import { SchedulingStep } from "./LeadImports/SchedulingStep";
import { WhatsAppPreviewPanel } from "./LeadImports/WhatsAppPreviewPanel";
import { CampaignsTable } from "./LeadImports/CampaignsTable";
import { DispatchCampaignTracker } from "./LeadImports/DispatchCampaignTracker";
import { LeadImportAuditReport } from "./LeadImports/LeadImportAuditReport";
import { ImportViewerDialog } from "./LeadImports/ImportViewerDialog";
import { DispatchPromptDialog } from "./LeadImports/DispatchPromptDialog";

type SheetTab = "campanha" | "enviadas" | "agendamentos" | "planilhas" | "relatorios";
type CampaignTemplateStrategy = "single" | "ai_variations";

export interface BancoAudienceInfo {
  description: string;
  count: number;
}

export function resolveEffectiveAudienceSource(params: {
  selectedFile: File | null;
  bancoAudience: BancoAudienceInfo | null;
  selectedImportId: string;
  selectedImportIds: string[];
  parsedRows: Record<string, unknown>[];
  importedRows: Record<string, unknown>[];
}): {
  sourceType: "file" | "banco" | "imported";
  rows: Record<string, unknown>[];
  activeImportIdParam: string | null;
} {
  if (params.selectedFile) {
    return { sourceType: "file", rows: params.parsedRows, activeImportIdParam: null };
  }
  if (params.bancoAudience) {
    return { sourceType: "banco", rows: params.parsedRows, activeImportIdParam: null };
  }
  let activeParam: string | null = null;
  if (params.selectedImportIds.length > 0) activeParam = params.selectedImportIds.join(",");
  else if (params.selectedImportId) activeParam = params.selectedImportId;

  return { sourceType: "imported", rows: params.importedRows, activeImportIdParam: activeParam };
}

export function validateCampaignSubmission(params: {
  activeClientId?: string | null;
  campaignName?: string;
  hasFile: boolean;
  hasBancoAudience: boolean;
  selectedImportIds: string[];
  selectedImportId: string;
  enabledStepsCount: number;
  filteredRowsCount: number;
}): { isValid: boolean; errorMessage?: string } {
  if (!params.activeClientId) {
    return { isValid: false, errorMessage: "Selecione uma empresa no seletor." };
  }
  if (!params.campaignName || !params.campaignName.trim()) {
    return { isValid: false, errorMessage: "Defina um nome de identificação para o envio." };
  }
  if (!params.hasFile && !params.hasBancoAudience && params.selectedImportIds.length === 0 && (!params.selectedImportId || params.selectedImportId === "all")) {
    return { isValid: false, errorMessage: "Por favor, carregue uma planilha ou selecione uma base ativa (ou CRM)." };
  }
  if (params.enabledStepsCount === 0) {
    return { isValid: false, errorMessage: "Adicione pelo menos um passo ativo na timeline de envio." };
  }
  if (params.filteredRowsCount === 0) {
    return { isValid: false, errorMessage: "Não é possível disparar uma campanha sem nenhum lead selecionado." };
  }
  return { isValid: true };
}

interface LeadImportsProps {
  fixedClientId?: string;
  fixedClientName?: string;
  title?: string;
  subtitle?: string;
  headerRight?: ReactNode;
}

const CAMPAIGN_LIMIT_MAX = 500;

// Cotas default por estado do chip — mesmos valores do backend
// (EVOLUTION_CHIP_DAILY_QUOTA_DEFAULTS em domains/campaigns/routes.js).
const COLD_CHIP_DAILY_QUOTA = 50;
const WARM_CHIP_DAILY_QUOTA = 500;
// Quantas vezes a MESMA mensagem pode se repetir num chip por dia. Serve so
// para SUGERIR o numero de variacoes — nao valida e nao trava nada.
const REPETICOES_MAX = 20;
const MIN_TEMPLATE_VARIANTS = 12;
const MAX_TEMPLATE_VARIANTS = 30;

const defaultDispatchOptions: CampaignDispatchOptions = {
  leadDelaySeconds: 2,
  stopOnStepFailure: true,
  aiAssisted: false,
  evolutionInstanceId: null,
  templateStrategy: "single",
  templateVariantCount: 0,
  waitForReply: false,
  replyTimeoutSeconds: 60,
  minWaitSeconds: 15,
  maxWaitSeconds: 45,
  dailyQuotaPerChip: 200,
  maxRepetitionsPerTemplate: 5,
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
  const { clientId, getIdToken, isAdminUser, canAccessInternalPage, approvalLevel } = useAuth();
  // Mesma regra do servidor (isManagerOrAdmin) para excluir leads em massa.
  const canMassDelete = canMassDeleteLeads({ isAdminUser, approvalLevel, canAccessUsersPage: canAccessInternalPage("usuarios") });
  const [isMassDeleteOpen, setIsMassDeleteOpen] = useState(false);
  const crmClient = useOptionalCrmClient();
  const selectedClientId = crmClient?.selectedClientId;
  const activeClientId = fixedClientId || selectedClientId || "";
  const isInternalUser = useAuth().isInternalUser;
  const queryClient = useQueryClient();

  const isCampanhasUnlocked = hasFeatureUnlocked(crmClient?.selectedClient, "disparador_campanhas");

  const [searchParams, setSearchParams] = useSearchParams();

  const normalizeSheetTab = (rawTab: string | null): SheetTab | null => {
    if (!rawTab) return null;
    const t = rawTab.toLowerCase().trim();
    if (["relatorios", "relatorio", "auditoria"].includes(t)) return "relatorios";
    if (["campanha", "novo-disparo", "disparo"].includes(t)) return "campanha";
    if (["enviadas", "campanhas", "historico"].includes(t)) return "enviadas";
    if (["agendamentos", "fila", "fila-de-envios"].includes(t)) return "agendamentos";
    if (["planilhas", "salvas", "planilhas-salvas"].includes(t)) return "planilhas";
    return null;
  };

  const [activeTab, setActiveTab] = useLocalStorage<SheetTab>(
    `vexo_activeTab_${activeClientId}`,
    normalizeSheetTab(searchParams.get("tab")) || "campanha"
  );

  useEffect(() => {
    const urlTab = searchParams.get("tab");
    const matched = normalizeSheetTab(urlTab);
    if (matched) {
      setActiveTab(matched);
    }
  }, [searchParams, setActiveTab]);

  // Lead spreadsheet upload states
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [bancoAudience, setBancoAudience] = useState<BancoAudienceInfo | null>(null);
  const [defaultDdd, setDefaultDdd] = useState<string>("34");
  const [parsedRows, setParsedRows] = useState<Record<string, unknown>[]>([]);
  const [rawUploadedRows, setRawUploadedRows] = useState<Record<string, unknown>[]>([]);
  const [uploadedColumns, setUploadedColumns] = useState<string[]>([]);
  const [columnMappings, setColumnMappings] = useState<ColumnMappingItem[]>([]);
  const [showNumbersModal, setShowNumbersModal] = useState(false);
  const [isImportingFile, setIsImportingFile] = useState(false);
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [selectedImportId, setSelectedImportId] = useState<string>(ALL_IMPORTS_VALUE);
  // Selecao de VARIAS planilhas. Quando tem item aqui, manda no disparo;
  // selectedImportId cobre so os dois modos especiais (todas / CRM).
  const [selectedImportIds, setSelectedImportIds] = useState<string[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDispatchId, setPreviewDispatchId] = useState<string | null>(null);
  const [viewingImport, setViewingImport] = useState<LeadImportItem | null>(null);
  const [promptDispatchId, setPromptDispatchId] = useState<string | null>(null);

  // Hooks queries
  const { data: allImports = [], refetch: refetchImports } = useLeadImports(activeClientId);
  // Planilha INCOMPLETA (importação em lotes interrompida) nunca entra nos seletores de campanha, na auditoria nem na
  // lembrança de mapeamento: só aparece em "Planilhas Salvas", com o que entrou e o botão de retomar.
  const imports = useMemo(() => allImports.filter((imp) => !isImportIncomplete(imp)), [allImports]);
  const { data: knownCustomFields = [] } = useLeadCustomFields(activeClientId);

  // Parâmetro de importação ativo resolvido pela função única de verdade
  const activeImportIdParam = useMemo(() => {
    return resolveEffectiveAudienceSource({
      selectedFile,
      bancoAudience,
      selectedImportId,
      selectedImportIds,
      parsedRows: [],
      importedRows: [],
    }).activeImportIdParam;
  }, [selectedFile, bancoAudience, selectedImportIds, selectedImportId]);

  const { data: importedItemsData, isLoading: isLoadingImportedItems } = useLeadImportItems(
    activeClientId,
    activeImportIdParam || undefined,
    undefined,
    {
      status: "imported",
      enabled: !selectedFile && !bancoAudience && !!activeImportIdParam && activeTab === "campanha",
    }
  );

  const rawImportedRows = useMemo(() => {
    if (!importedItemsData?.items) return [];
    return importedItemsData.items.map((item) => {
      const importRecord = imports.find((imp) => imp.id === item.import_id);
      const sourceName =
        item.import_id === CRM_BASE_VALUE ? "Leads do CRM" : (importRecord?.source_name || "Planilha");
      return {
        ...(item.raw_data ?? {}),
        ...(item.normalized_data ?? {}),
        id: item.id,
        import_id: item.import_id,
        __importName: sourceName,
        nome:
          item.normalized_data?.nome ||
          (item.raw_data as any)?.nome ||
          (item.raw_data as any)?.Nome ||
          (item.raw_data as any)?.name ||
          "Sem nome",
        telefone:
          item.telefone ||
          (item.raw_data as any)?.telefone ||
          (item.raw_data as any)?.Telefone ||
          "",
      };
    });
  }, [importedItemsData, imports]);

  const audienceSource = useMemo(() => {
    return resolveEffectiveAudienceSource({
      selectedFile,
      bancoAudience,
      selectedImportId,
      selectedImportIds,
      parsedRows,
      importedRows: rawImportedRows,
    });
  }, [selectedFile, bancoAudience, selectedImportId, selectedImportIds, parsedRows, rawImportedRows]);

  const sourceRows = audienceSource.rows;
  const isMultiSpreadsheet = selectedImportIds.length > 1 || selectedImportId === ALL_IMPORTS_VALUE;

  const basesCustomFields = useMemo(() => {
    if (sourceRows.length === 0) {
      return {
        commonFields: [] as CustomFieldDefinition[],
        excludedFields: [] as Array<{ key: string; label: string; missingInBaseNames: string[]; count: number }>,
        isMultiBase: false,
      };
    }
    if (!isMultiSpreadsheet) {
      const fields = extractCustomFieldsFromRows(sourceRows);
      return {
        commonFields: fields,
        excludedFields: [],
        isMultiBase: false,
      };
    }
    // Multi-planilha: agrupa por import_id ou __importName
    const basesMap = new Map<string, { baseId: string; baseName: string; rows: Record<string, unknown>[] }>();
    for (const r of sourceRows) {
      const bId = String(r.import_id || r.__importName || "default");
      const imp = imports.find((i) => i.id === bId);
      const bName = imp?.source_name || (r.__importName as string) || bId;
      if (!basesMap.has(bId)) {
        basesMap.set(bId, { baseId: bId, baseName: bName, rows: [] });
      }
      basesMap.get(bId)!.rows.push(r);
    }
    const basesList = Array.from(basesMap.values()).map((b) => ({
      baseId: b.baseId,
      baseName: b.baseName,
      fields: extractCustomFieldsFromRows(b.rows),
    }));
    const result = getCommonCustomFields(basesList);
    return {
      commonFields: result.commonFields,
      excludedFields: result.excludedFields,
      isMultiBase: true,
    };
  }, [sourceRows, isMultiSpreadsheet, imports]);

  const spreadsheetColumns = useMemo(() => {
    if (basesCustomFields.commonFields.length > 0) {
      return basesCustomFields.commonFields.map((f) => f.key);
    }
    if (sourceRows.length === 0) return [];
    const keys = new Set<string>();
    const reserved = new Set([
      "id",
      "import_id",
      "client_id",
      "created_at",
      "__importName",
      "dispatched",
      "imported",
      "row_number",
      "skip_reason",
      "raw_data",
      "normalized_data",
    ]);
    for (const row of sourceRows) {
      for (const k of Object.keys(row)) {
        if (!reserved.has(k) && !k.startsWith("__")) keys.add(k);
      }
    }
    return Array.from(keys);
  }, [basesCustomFields.commonFields, sourceRows]);

  const missingColumnWarnings = useMemo(() => {
    if (filterRules.length === 0 || sourceRows.length === 0) return [];
    const warnings: Array<{
      column: string;
      missingSpreadsheetNames: string[];
      count: number;
      includeMissing: boolean;
    }> = [];

    const uniqueImports = Array.from(
      new Set(sourceRows.map((r) => String(r.import_id || r.__importName || "default")))
    );

    for (const rule of filterRules) {
      if (!rule.column) continue;
      const missingImportNames = new Set<string>();
      let missingLeadsCount = 0;

      for (const importId of uniqueImports) {
        const rowsOfImport = sourceRows.filter(
          (r) => String(r.import_id || r.__importName || "default") === importId
        );
        const hasColumnInImport = rowsOfImport.some(
          (r) =>
            rule.column in r &&
            r[rule.column] !== undefined &&
            r[rule.column] !== null &&
            String(r[rule.column]).trim() !== ""
        );

        if (!hasColumnInImport) {
          const importName = String(rowsOfImport[0]?.__importName || "Planilha");
          missingImportNames.add(importName);
          missingLeadsCount += rowsOfImport.length;
        }
      }

      if (missingImportNames.size > 0 && missingLeadsCount > 0) {
        warnings.push({
          column: rule.column,
          missingSpreadsheetNames: Array.from(missingImportNames),
          count: missingLeadsCount,
          includeMissing: !!rule.includeMissing,
        });
      }
    }

    return warnings;
  }, [filterRules, sourceRows]);

  const handleToggleIncludeMissing = (column: string) => {
    setFilterRules((current) =>
      current.map((rule) =>
        rule.column === column ? { ...rule, includeMissing: !rule.includeMissing } : rule
      )
    );
  };

  const filteredRows = useMemo(() => {
    if (filterRules.length === 0) return sourceRows;
    return sourceRows.filter((row) => {
      return filterRules.every((rule) => {
        const fieldDef = basesCustomFields.commonFields.find((f) => f.key === rule.column);
        return evaluateLeadFilterRule(row, rule, fieldDef);
      });
    });
  }, [sourceRows, filterRules, basesCustomFields.commonFields]);

  const getMissingCountForField = (fieldKey: string) => {
    return getMissingFieldCount(sourceRows, fieldKey);
  };
  const previewRows = useMemo(() => filteredRows.slice(0, 15), [filteredRows]);

  const phoneAuditStats: PhoneAuditStats = useMemo(() => {
    if (filteredRows.length === 0) {
      return {
        total: 0,
        valid: 0,
        intactCount: 0,
        completedCount: 0,
        incompleteCount: 0,
        completedList: [],
        incompleteList: [],
      };
    }

    let intactCount = 0;
    let completedCount = 0;
    let incompleteCount = 0;
    const completedList: Array<{ original: string; result: string }> = [];
    const incompleteList: Array<{ original: string; reason: string }> = [];

    const cleanDdd = defaultDdd ? defaultDdd.replace(/\D/g, "").slice(0, 2) : null;

    filteredRows.forEach((row) => {
      const rawPhone =
        getLeadField(row, ["telefone", "celular", "phone", "number", "whatsapp"]) ||
        String(row.telefone || "");
      const result = classifyPhoneAudit(rawPhone, cleanDdd);

      if (result.kind === "intact") {
        intactCount++;
      } else if (result.kind === "completed") {
        completedCount++;
        if (completedList.length < 500) {
          completedList.push({ original: result.original, result: result.sanitized as string });
        }
      } else {
        incompleteCount++;
        if (incompleteList.length < 500) {
          incompleteList.push({ original: result.original || "(vazio)", reason: result.reason as string });
        }
      }
    });

    return {
      total: filteredRows.length,
      valid: intactCount + completedCount,
      intactCount,
      completedCount,
      incompleteCount,
      completedList,
      incompleteList,
    };
  }, [filteredRows, defaultDdd]);

  const parsedLeadsStats = useMemo(() => {
    return {
      total: phoneAuditStats.total,
      valid: phoneAuditStats.valid,
      invalid: phoneAuditStats.incompleteCount,
    };
  }, [phoneAuditStats]);

  // Campaign builder states
  const [editingCampaignId, setEditingCampaignId] = useLocalStorage<string | null>(`vexo_campaignId_${activeClientId}`, null);
  const [campaignName, setCampaignName] = useLocalStorage(`vexo_campaignName_${activeClientId}`, "");
  const [campaignLimitPerRun, setCampaignLimitPerRun] = useLocalStorage(`vexo_campaignLimit_${activeClientId}`, "50");
  const [campaignSequence, setCampaignSequence] = useLocalStorage<Array<CampaignSequenceStep & { buttons?: StepActionButton[] }>>(`vexo_campaignSequence_${activeClientId}`, [
    createCampaignStep("text", 1),
  ]);
  const [campaignTemplateStrategy, setCampaignTemplateStrategy] = useLocalStorage<CampaignTemplateStrategy>(`vexo_campaignStrategy_${activeClientId}`, "single");
  const [dispatchOptions, setDispatchOptions] = useLocalStorage<CampaignDispatchOptions>(`vexo_campaignDispatchOpts_${activeClientId}`, defaultDispatchOptions);

  const preDispatchAudit = useMemo(() => {
    const messages = campaignSequence
      .filter((s) => s.enabled !== false)
      .map((s) => s.text || "");
    return auditMessageVariablesAgainstLeads(messages, filteredRows);
  }, [campaignSequence, filteredRows]);

  // Scheduling & parameters states
  const [multiAgendaEnabled, setMultiAgendaEnabled] = useLocalStorage(`vexo_multiAgenda_${activeClientId}`, false);
  const [newConsultantName, setNewConsultantName] = useLocalStorage(`vexo_consultantName_${activeClientId}`, "");
  const [newConsultantLink, setNewConsultantLink] = useLocalStorage(`vexo_consultantLink_${activeClientId}`, "");
  const [newTriggerType, setNewTriggerType] = useLocalStorage<"manual" | "scheduled" | "draft">(`vexo_triggerType_${activeClientId}`, "manual");
  const [newScheduledAt, setNewScheduledAt] = useLocalStorage(`vexo_scheduledAt_${activeClientId}`, "");
  const [batchingEnabled, setBatchingEnabled] = useLocalStorage(`vexo_batching_${activeClientId}`, false);
  const [batchSize, setBatchSize] = useLocalStorage(`vexo_batchSize_${activeClientId}`, "100");
  const [batchIntervalHours, setBatchIntervalHours] = useLocalStorage(`vexo_batchInterval_${activeClientId}`, "1");
  // Qual cerebro atende quem responder. Default "atendimento" = comportamento de
  // hoje (waitForReply false, mode disparo): campanha existente nao muda.
  const [replyAgent, setReplyAgent] = useLocalStorage<"passos" | "campanha" | "atendimento">(`vexo_replyAgent_${activeClientId}`, "atendimento");
  const [campaignAgentPrompt, setCampaignAgentPrompt] = useLocalStorage(`vexo_replyAgentPrompt_${activeClientId}`, "");

  const [duplicateWarningState, setDuplicateWarningState] = useState<{
    open: boolean;
    campaignName: string;
    pendingBatches: CampaignDispatch[];
    pendingRecipientsCount: number;
    isProcessing?: boolean;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sequenceImageInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedImageStepId, setSelectedImageStepId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittingStatus, setSubmittingStatus] = useState<string | null>(null);

  // Hooks queries
  const { data: campaigns = [], isLoading: loadingCampaigns, refetch: refetchCampaigns } = useCampanhas(activeClientId || undefined);
  const { data: dispatches = [], isLoading: loadingDispatches, refetch: refetchDispatches } = useAllDispatches(activeClientId || null);
  const {
    data: consultants = [],
    error: consultantsError,
    isLoading: loadingConsultants,
    refetch: refetchConsultants,
  } = useConsultantSchedules(activeClientId);
  const createConsultant = useCreateConsultantSchedule();
  const updateConsultant = useUpdateConsultantSchedule();
  const deleteConsultant = useDeleteConsultantSchedule();

  // ── Limpeza de estado e seleções ao trocar de empresa (tenant) ───────────
  useEffect(() => {
    setSelectedImportId(ALL_IMPORTS_VALUE);
    setSelectedImportIds([]);
    setSelectedFile(null);
    setParsedRows([]);
    setFilterRules([]);
    setParseError(null);
    setPreviewDispatchId(null);
    setPreviewOpen(false);
    setViewingImport(null);
    setPromptDispatchId(null);
    setSelectedImageStepId(null);
  }, [activeClientId]);

  // Se o editingCampaignId pertencer a outro tenant ou não existir na lista, reseta
  useEffect(() => {
    if (editingCampaignId && campaigns.length > 0 && !campaigns.some((c) => c.id === editingCampaignId)) {
      setEditingCampaignId(null);
    }
  }, [campaigns, editingCampaignId, setEditingCampaignId]);

  // Se selectedImportId apontar para uma planilha que não existe na lista do tenant, reseta para ALL_IMPORTS_VALUE
  useEffect(() => {
    if (
      selectedImportId !== ALL_IMPORTS_VALUE &&
      selectedImportId !== CRM_BASE_VALUE &&
      imports.length > 0 &&
      !imports.some((imp) => imp.id === selectedImportId)
    ) {
      setSelectedImportId(ALL_IMPORTS_VALUE);
    }
  }, [imports, selectedImportId]);

  // Limpa IDs de planilhas selecionadas que não pertencem ao tenant ativo
  useEffect(() => {
    if (selectedImportIds.length > 0 && imports.length > 0) {
      const validIds = selectedImportIds.filter((id) => imports.some((imp) => imp.id === id));
      if (validIds.length !== selectedImportIds.length) {
        setSelectedImportIds(validIds);
      }
    }
  }, [imports, selectedImportIds]);

  const { data: pendingData, refetch: refetchPending } = useLeadImportItems(
    activeClientId,
    selectedImportId === ALL_IMPORTS_VALUE ? undefined : selectedImportId,
    "pending"
  );

  // Mutations
  const createLeadImport = useCreateLeadImport();
  const resumeLeadImport = useResumeLeadImport();
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [resumingImportId, setResumingImportId] = useState<string | null>(null);
  const deleteLeadImport = useDeleteLeadImport();
  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const deleteCampaign = useDeleteCampaign();
  const generateTemplateVariants = useGenerateCampaignTemplateVariants();
  const saveCampaignPrompt = useSaveCampaignPrompt();
  // Usado ao duplicar: a copia leva o TEXTO do roteiro, nao o id, para nascer com
  // roteiro proprio em vez de compartilhar a linha da origem.
  const { data: campaignPrompts = [] } = useCampaignPrompts(activeClientId || null);
  const campaignPromptsById = useMemo(
    () => Object.fromEntries(campaignPrompts.map((p) => [p.id, p.content])),
    [campaignPrompts]
  );
  const createDispatch = useCreateDispatch(""); // campaign-specific instances are created dynamically
  const deleteDispatch = useDeleteDispatch("");
  const triggerDispatch = useTriggerDispatch("");
  const updateDispatch = useUpdateDispatch("");

  // Resolving tenant options
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
          chipState: inst.chip_state,
          dailyLimitOverride: inst.daily_limit_override,
        })),
    [selectedLeadClient]
  );

  // Precedencia identica a resolveEvolutionInstanceDailyLimit no backend
  // (domains/campaigns/routes.js). Se divergir, a tela mente sobre a cota.
  const campaignDailyQuota = useMemo(() => {
    const limitOf = (inst: (typeof evolutionInstanceOptions)[number]) =>
      inst.dailyLimitOverride && inst.dailyLimitOverride > 0
        ? inst.dailyLimitOverride
        : inst.chipState === "warm"
          ? WARM_CHIP_DAILY_QUOTA
          : COLD_CHIP_DAILY_QUOTA;

    const selected = dispatchOptions.evolutionInstanceId
      ? evolutionInstanceOptions.find((inst) => inst.id === dispatchOptions.evolutionInstanceId)
      : null;
    if (selected) return limitOf(selected);
    if (evolutionInstanceOptions.length === 0) return COLD_CHIP_DAILY_QUOTA;
    return Math.max(...evolutionInstanceOptions.map(limitOf));
  }, [evolutionInstanceOptions, dispatchOptions.evolutionInstanceId]);

  const suggestedVariantCount = useMemo(
    () =>
      Math.min(
        MAX_TEMPLATE_VARIANTS,
        Math.max(MIN_TEMPLATE_VARIANTS, Math.ceil(campaignDailyQuota / REPETICOES_MAX))
      ),
    [campaignDailyQuota]
  );

  // null = seguir o sugerido. Assim mudar de chip reflete na tela ate o usuario
  // digitar um valor proprio.
  const [variantCountOverride, setVariantCountOverride] = useState<number | null>(null);
  const variantCount = variantCountOverride ?? suggestedVariantCount;

  // Variaveis que o disparo sabe substituir: nome/telefone sempre
  // (campaign-outbound.js), colunas da planilha, e scheduling_link so com
  // multi-agenda ligada (injetado em domains/campaigns/routes.js).
  const availableVariables = useMemo(() => {
    const names = new Set<string>(["nome", "telefone"]);
    spreadsheetColumns.forEach((column) => {
      const normalized = column.trim().toLowerCase();
      if (normalized) names.add(normalized);
    });
    if (multiAgendaEnabled) names.add("scheduling_link");
    return Array.from(names);
  }, [spreadsheetColumns, multiAgendaEnabled]);

  const resolvedClientName = fixedClientName || selectedClient?.name || activeClientId;

  // Initialize/refresh settings
  useEffect(() => {
    if (editingCampaignId) {
      return;
    }
    const defaultInstanceId =
      evolutionInstanceOptions.find((inst) => inst.isDefault)?.id ||
      evolutionInstanceOptions[0]?.id ||
      null;

    setDispatchOptions((current) => ({
      ...current,
      evolutionInstanceId: current.evolutionInstanceId ?? defaultInstanceId,
    }));
  }, [evolutionInstanceOptions, editingCampaignId]);

  // Carregar público-alvo vindo do Banco de Dados Inteligente
  useEffect(() => {
    try {
      const raw = localStorage.getItem("vexo_pending_campaign_audience");
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data.rows) && data.rows.length > 0) {
          setParsedRows(data.rows);
          if (Array.isArray(data.filterRules)) {
            setFilterRules(data.filterRules);
          }
          if (data.campaignName) {
            setCampaignName(data.campaignName);
          }
          const desc =
            data.sourceDescription ||
            `${data.rows.length} contatos vindos do Banco de Dados, filtrados por tag`;
          setBancoAudience({
            description: desc,
            count: data.rows.length,
          });
          setSelectedImportId("");
          setSelectedImportIds([]);
          setSelectedFile(null);
          setActiveTab("campanha");
          toast({
            title: "Público-Alvo Carregado! 🎯",
            description: desc,
          });
        }
        localStorage.removeItem("vexo_pending_campaign_audience");
      }
    } catch (e) {
      console.warn("Failed to load pending campaign audience:", e);
    }
  }, []);

  // Handle excel/csv parsed rows
  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    if (file && file.name.endsWith(".numbers")) {
      setShowNumbersModal(true);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setBancoAudience(null);
    setSelectedFile(file);
    setParseError(null);
    setParsedRows([]);
    setRawUploadedRows([]);
    setUploadedColumns([]);
    setColumnMappings([]);
    setFilterRules([]);

    if (!file) return;
    try {
      const rows = await parseSpreadsheetFile(file);
      const cols = rows.length > 0 ? Object.keys(rows[0]) : [];
      const remembered = findMatchingRememberedMapping(cols, imports);
      const initialMappings = proposeColumnMappings({
        columns: cols,
        sampleRows: rows,
        rememberedMapping: remembered,
        knownCustomFields,
      });

      setRawUploadedRows(rows);
      setUploadedColumns(cols);
      setColumnMappings(initialMappings);

      const mappedRows = rows.map((row) => {
        const mapped = applyColumnMappingsToRow(row, initialMappings);
        return {
          ...row,
          telefone: mapped.telefone,
          nome: mapped.nome,
          dados: mapped.dados,
        };
      });

      setParsedRows(mappedRows);
      setCampaignName(file.name.replace(/\.[^/.]+$/, ""));
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Falha ao analisar a planilha.");
    }
  }

  function handleColumnMappingsChange(newMappings: ColumnMappingItem[]) {
    setColumnMappings(newMappings);
    if (rawUploadedRows.length > 0) {
      const updatedMappedRows = rawUploadedRows.map((row) => {
        const mapped = applyColumnMappingsToRow(row, newMappings);
        return {
          ...row,
          telefone: mapped.telefone,
          nome: mapped.nome,
          dados: mapped.dados,
        };
      });
      setParsedRows(updatedMappedRows);
    }
  }

  /** Texto do erro de importação: se a planilha ficou incompleta, diz quanto entrou e onde retomar. */
  function explainImportError(err: unknown): string {
    if (err instanceof ImportFileMismatchError) return err.message;
    if (err instanceof ImportBatchError && err.importId) {
      const entered = err.receivedOffset ?? 0;
      return `${err.message} A planilha ficou INCOMPLETA: entraram ${entered.toLocaleString("pt-BR")} de ${err.totalRows.toLocaleString("pt-BR")} linhas. Abra "Planilhas Salvas" e use "Retomar" com o mesmo arquivo — o envio continua de onde parou, sem duplicar.`;
    }
    return err instanceof Error ? err.message : "Erro desconhecido.";
  }

  async function handleResumeImport(imp: LeadImportItem, file: File) {
    setResumingImportId(imp.id);
    setImportProgress({ phase: "opening", sentRows: imp.received_offset ?? 0, totalRows: imp.expected_rows ?? 0, batch: 0, batches: 0 });
    try {
      const rows = await parseSpreadsheetFile(file);
      const result = await resumeLeadImport.mutateAsync({ clientId: activeClientId, importId: imp.id, rows, onProgress: setImportProgress });
      toast({
        title: "Importação concluída",
        description: `"${imp.source_name}" foi completada: ${result.totals.total.toLocaleString("pt-BR")} linhas, ${result.totals.valid.toLocaleString("pt-BR")} com telefone válido.`,
      });
      await refetchImports();
    } catch (err) {
      toast({ title: "Não foi possível retomar a importação", description: explainImportError(err), variant: "destructive" });
      await refetchImports();
    } finally {
      setImportProgress(null);
      setResumingImportId(null);
    }
  }

  async function handleImportSpreadsheetOnly() {
    if (!selectedFile || rawUploadedRows.length === 0) return;

    const validation = validateColumnMappings(columnMappings, uploadedColumns, rawUploadedRows);
    if (!validation.isValid) {
      toast({
        title: "Mapeamento inválido",
        description: validation.errorMessage || "Verifique o mapeamento das colunas.",
        variant: "destructive",
      });
      return;
    }

    setIsImportingFile(true);
    try {
      const importRes = await createLeadImport.mutateAsync({
        clientId: activeClientId,
        sourceName: selectedFile.name,
        sourceType: selectedFile.name.split(".").pop()?.toLowerCase() || "spreadsheet",
        rows: rawUploadedRows,
        columnMapping: {
          columns: uploadedColumns,
          mapping: columnMappings,
        },
        defaultDdd: defaultDdd || undefined,
        onProgress: setImportProgress,
      });

      if (importRes.warnings && importRes.warnings.length > 0) {
        for (const w of importRes.warnings) {
          toast({
            title: "Aviso de tipo de campo",
            description: w.message,
          });
        }
      }

      toast({
        title: "Planilha importada",
        description: `A base "${selectedFile.name}" foi importada com sucesso com ${importRes.item.imported_rows} contatos.`,
      });

      await refetchImports();
      setSelectedImportId(importRes.item.id);

      setSelectedFile(null);
      setParsedRows([]);
      setRawUploadedRows([]);
      setUploadedColumns([]);
      setColumnMappings([]);
      setFilterRules([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      toast({
        title: "Erro ao importar planilha",
        description: explainImportError(err),
        variant: "destructive",
      });
    } finally {
      setIsImportingFile(false);
      setImportProgress(null);
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
        count: variantCount,
        availableVariables,
      });
      const variants = Array.isArray(result.variants) ? result.variants : [];
      updateCampaignStep(stepId, { textVariants: variants });
      if (variants.length === 0) {
        toast({
          title: "Nenhuma variação gerada",
          description: "A IA não devolveu variações. Tente de novo ou ajuste a mensagem base.",
          variant: "destructive",
        });
        return;
      }
      // Antes o texto dizia "3 variações" fixo, independente do que voltava —
      // por isso 8 pedidas apareciam como 3 na tela.
      const pedidas = result.requested ?? variants.length;
      // Descarte visível: o backend joga fora variação que perde o pedido da
      // mensagem (virou manchete, sumiu um número, deixou de perguntar). Sem
      // isto o usuário só via o resultado e não sabia que metade caiu fora.
      const descartadas = result.discardedCount ?? 0;
      const motivos = Array.from(new Set((result.discarded ?? []).map((d) => d.motivo.split(" (")[0])));
      toast({
        title: descartadas > 0 ? "Variações geradas (com descarte)" : "Sucesso!",
        description: [
          variants.length < pedidas
            ? `${variants.length} de ${pedidas} variações geradas.`
            : `${variants.length} variações humanizadas foram geradas.`,
          descartadas > 0
            ? `${descartadas} descartada(s) por não preservar a mensagem: ${motivos.slice(0, 3).join("; ")}.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      });
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
  // Editar uma campanha deixava o formulario preenchido sem como limpar: so restava
  // cancelar a edicao (que zerava nome e passos, mas nao o resto) ou sobrescrever a
  // campanha aberta sem perceber. Este handler zera TUDO e volta ao estado de campanha
  // nova — inclusive base selecionada, agendamento, lotes e agente de resposta.
  function formularioTemAlteracao() {
    if (campaignName.trim()) return true;
    if (campaignAgentPrompt.trim()) return true;
    if (selectedFile) return true;
    if (selectedImportIds.length > 0) return true;
    const passosComConteudo = campaignSequence.filter(
      (step) => (step.text || "").trim() || step.image || (step.buttons || []).length > 0
    );
    return passosComConteudo.length > 0;
  }

  function handleNovaCampanha() {
    if (
      formularioTemAlteracao() &&
      !window.confirm(
        editingCampaignId
          ? "Você está editando uma campanha. Começar uma nova descarta as alterações não salvas. Continuar?"
          : "Há conteúdo preenchido neste formulário. Começar uma nova campanha descarta o que não foi salvo. Continuar?"
      )
    ) {
      return;
    }

    setEditingCampaignId(null);
    setCampaignName("");
    setCampaignSequence([createCampaignStep("text", 1)]);
    setCampaignTemplateStrategy("single");
    setCampaignLimitPerRun("50");
    setDispatchOptions(defaultDispatchOptions);
    setReplyAgent("atendimento");
    setCampaignAgentPrompt("");
    setNewTriggerType("manual");
    setNewScheduledAt("");
    setBatchingEnabled(false);
    setBatchSize("100");
    setBatchIntervalHours("1");
    setMultiAgendaEnabled(false);
    setSelectedImportIds([]);
    setSelectedImportId(ALL_IMPORTS_VALUE);
    setSelectedFile(null);
    setBancoAudience(null);
    setParsedRows([]);
    setFilterRules([]);
    setParseError(null);
    setSelectedImageStepId(null);

    toast({ title: "Formulário limpo", description: "Pronto para uma nova campanha." });
  }

  async function handleCreateAndDispatch() {
    const enabledSteps = campaignSequence.filter((s) => s.enabled);
    const validation = validateCampaignSubmission({
      activeClientId,
      campaignName,
      hasFile: !!selectedFile,
      hasBancoAudience: !!bancoAudience,
      selectedImportIds,
      selectedImportId,
      enabledStepsCount: enabledSteps.length,
      filteredRowsCount: filteredRows.length,
    });
    if (!validation.isValid) {
      toast({
        title: "Atenção",
        description: validation.errorMessage || "Verifique os dados da campanha.",
        variant: "destructive",
      });
      return;
    }

    // ⚡ ITEM 1: Checa se a campanha alvo já tem lotes pendentes ("scheduled", "running", "paused")
    const targetCampaign = editingCampaignId
      ? campaigns.find((c) => c.id === editingCampaignId)
      : campaigns.find((c) => c.name?.trim().toLowerCase() === campaignName.trim().toLowerCase());
    const targetCampaignId = targetCampaign?.id;

    const pendingBatches = targetCampaignId
      ? dispatches.filter(
          (d) =>
            d.campaign_id === targetCampaignId &&
            (d.status === "scheduled" || d.status === "running" || d.status === "paused")
        )
      : [];

    if (pendingBatches.length > 0) {
      const pendingRecipients = pendingBatches.reduce((acc, d) => acc + (d.target_count ?? 0), 0);
      setDuplicateWarningState({
        open: true,
        campaignName: targetCampaign?.name || campaignName.trim(),
        pendingBatches,
        pendingRecipientsCount: pendingRecipients,
        isProcessing: false,
      });
      return;
    }

    await executeCreateAndDispatch();
  }

  async function handleCancelPreviousAndCreate() {
    if (!duplicateWarningState) return;
    setDuplicateWarningState((prev) => (prev ? { ...prev, isProcessing: true } : null));

    try {
      const token = await getIdToken();
      // TRAVA: apenas lotes que não estejam "running" são cancelados
      const batchesToCancel = duplicateWarningState.pendingBatches.filter((b) => b.status !== "running");

      for (const batch of batchesToCancel) {
        await fetch(`${API_BASE_URL}/api/campaigns/dispatches/${batch.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
      }

      setDuplicateWarningState(null);
      await executeCreateAndDispatch();
    } catch (err) {
      toast({
        title: "Erro ao cancelar lotes anteriores",
        description: err instanceof Error ? err.message : "Não foi possível cancelar as filas antigas.",
        variant: "destructive",
      });
      setDuplicateWarningState(null);
    }
  }

  async function handleCreateAnyway() {
    setDuplicateWarningState(null);
    await executeCreateAndDispatch();
  }

  async function executeCreateAndDispatch() {
    if (filteredRows.length === 0) {
      toast({
        title: "Nenhum lead selecionado",
        description: "Não é possível disparar uma campanha sem nenhum lead selecionado.",
        variant: "destructive",
      });
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
          onProgress: (p) => setSubmittingStatus(describeImportProgress(p)),
        });
        finalImportId = importRes.item.id;
      } else if (bancoAudience && filteredRows.length > 0) {
        setSubmittingStatus("Registrando público do Banco de Dados...");
        finalRowsCount = filteredRows.length;
        const importRes = await createLeadImport.mutateAsync({
          clientId: activeClientId,
          sourceName: bancoAudience.description || `Banco de Dados (${filteredRows.length} leads)`,
          sourceType: "banco",
          rows: filteredRows,
          onProgress: (p) => setSubmittingStatus(describeImportProgress(p)),
        });
        finalImportId = importRes.item.id;
      }

      setSubmittingStatus("Configurando campanha e timeline...");
      const limitPerRun = Number.parseInt(campaignLimitPerRun, 10) || 50;

      // Make sure template strategy matches variants state
      const hasVariants = campaignSequence.some(s => s.textVariants && s.textVariants.length > 0);
      const templateStrategy: "single" | "ai_variations" = hasVariants ? "ai_variations" : "single";

      const limitForCampaign = batchingEnabled ? (Number.parseInt(batchSize, 10) || 100) : limitPerRun;

      // Quem responde o lead que reagir a este disparo. O backend escolhe o
      // cerebro pelo ROTEIRO existir (campaign_prompt_id), nao pelo mode — entao
      // campanha sem roteiro continua caindo no agente de atendimento, que e o
      // comportamento de hoje.
      let campaignMode: "disparo" | "agente" = "disparo";
      let campaignPromptId: string | null = null;
      if (replyAgent === "campanha" && campaignAgentPrompt.trim()) {
        setSubmittingStatus("Salvando o roteiro da campanha...");
        const promptSalvo = await saveCampaignPrompt.mutateAsync({
          clientId: activeClientId,
          name: `Roteiro — ${campaignName.trim()}`,
          content: campaignAgentPrompt.trim(),
        });
        campaignMode = "agente";
        campaignPromptId = promptSalvo.id;
      }

      const campaignPayload = {
        name: campaignName.trim(),
        clientId: activeClientId,
        importId: finalImportId === ALL_IMPORTS_VALUE ? null : finalImportId,
        importIds: (selectedFile || bancoAudience) ? [] : selectedImportIds,
        limitPerRun: limitForCampaign,
        mode: campaignMode,
        campaignPromptId,
        startsAt: null,
        endsAt: null,
        analyticsMeta: {
          // Segmentação unificada: as regras dinâmicas (coluna/operador/valor) viram o
          // filtro de disparo. Mesmo shape do catálogo da empresa e do matcher do backend.
          segmentation: {
            filters: filterRules
              .filter((rule) => rule.column && String(rule.value ?? "").trim() !== "")
              .map((rule) => ({
                field: rule.column,
                operator: rule.operator,
                value: rule.value,
                includeMissing: !!rule.includeMissing,
              })),
          },
          message: campaignSequence.find(s => s.type === "text")?.text || "",
          image: campaignSequence.find(s => s.type === "image")?.image,
          sequence: campaignSequence,
          dispatchOptions: {
            ...dispatchOptions,
            replyAgent,
            // "Só enviar os passos" silencia o chatbot: e o waitForReply que faz
            // o roteamento parar em skipped_disparo_only. Nas outras duas opcoes
            // o lead segue para um agente.
            waitForReply: replyAgent === "passos" ? true : dispatchOptions.waitForReply,
            aiAssisted: hasVariants,
            templateStrategy,
            templateVariantCount: hasVariants ? (campaignSequence.find(s => s.type === "text")?.textVariants?.length || 0) : 0,
          },
        },
      };

      const savedCampaign = await saveCampaignWithSelfHeal({
        editingCampaignId,
        payload: campaignPayload,
        updateCampaign: updateCampaign.mutateAsync,
        createCampaign: createCampaign.mutateAsync,
        onOrphanRecovered: () => {
          setEditingCampaignId(null);
          toast({
            title: "A campanha anterior nao existe mais",
            description: "Criando uma nova campanha com os dados atuais.",
          });
        },
      });
      const campaignId = savedCampaign.id;

      setSubmittingStatus("Registrando lote na fila de envios...");

      // 2. Register Dispatch Batch Execution
      const token = await getIdToken();
      const scheduledIso = newTriggerType === "scheduled" && newScheduledAt ? campaignLocalDateTimeToUtcIso(newScheduledAt) : null;

      let totalLeads = 0;
      if (selectedFile || bancoAudience) {
        totalLeads = finalRowsCount;
      } else {
        totalLeads = filteredRows.length;
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
        const hasConnectedChips = evolutionInstanceOptions.length > 0 || Boolean(selectedLeadClient?.n8n_settings?.dispatch_webhook_url);
        toast({
          title: "Sucesso!",
          description: hasConnectedChips
            ? `${numBatches} lotes criados e enfileirados com sucesso.`
            : `${numBatches} lotes criados, mas não vão disparar até conectar um chip.`,
        });
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

        const hasConnectedChips = evolutionInstanceOptions.length > 0 || Boolean(selectedLeadClient?.n8n_settings?.dispatch_webhook_url);

        // 3. Trigger immediate execution if manual
        if (newTriggerType === "manual") {
          setSubmittingStatus("Disparando lote de envios...");
          await fetch(`${API_BASE_URL}/api/campaigns/dispatches/${dispatchId}/trigger`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          });
          toast({ title: "Sucesso!", description: "O lote de disparos foi iniciado com sucesso." });
        } else if (newTriggerType === "draft") {
          toast({
            title: "Campanha salva!",
            description: hasConnectedChips
              ? "Campanha salva como rascunho (Stand by)."
              : "Campanha salva, mas não vai disparar até conectar um chip.",
          });
        } else {
          toast({
            title: "Sucesso!",
            description: hasConnectedChips
              ? "Lote de disparos agendado com sucesso."
              : "Campanha agendada, mas não vai disparar até conectar um chip.",
          });
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
        description: err instanceof ImportBatchError || err instanceof ImportFileMismatchError ? explainImportError(err) : err instanceof Error ? err.message : "Erro desconhecido ao processar lote.",
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

  const handleDeleteMultipleDispatches = async (dispIds: string[]) => {
    if (dispIds.length === 0) return;
    try {
      const token = await getIdToken();
      let successCount = 0;
      for (const id of dispIds) {
        const res = await fetch(`${API_BASE_URL}/api/campaigns/dispatches/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) successCount++;
      }
      toast({
        title: "Lotes removidos",
        description: `${successCount} ${successCount === 1 ? "lote removido" : "lotes removidos"} com sucesso.`,
      });
      refetchDispatches();
    } catch (err) {
      toast({
        title: "Erro",
        description: err instanceof Error ? err.message : "Não foi possível remover.",
        variant: "destructive",
      });
    }
  };

  const handleDeleteDispatchBatch = async (dispId: string) => {
    // Quantos leads ficam sem receber. Excluir um lote pausado com milhares de
    // leads pendentes e irreversivel, e o numero e a unica coisa que deixa o
    // tamanho da decisao visivel antes do clique.
    const lote = dispatches.find((d) => d.id === dispId);
    const enviados = lote?.sent_count ?? 0;
    const alvo = lote?.target_count ?? null;
    const pendentes = alvo != null ? Math.max(0, alvo - enviados - (lote?.failed_count ?? 0)) : null;

    const enviadosAviso = enviados > 0 ? `\n\nℹ️ ${enviados} destinatários já receberam mensagem deste lote. O histórico permanecerá preservado no Inbox.` : "";

    const aviso =
      pendentes != null && pendentes > 0
        ? `Excluir o lote "${lote?.name || dispId}" permanentemente?\n\n${pendentes} ${pendentes === 1 ? "lead ficará" : "leads ficarão"} sem receber.${enviadosAviso}\n\nEsta ação não pode ser desfeita.`
        : `Excluir o lote "${lote?.name || dispId}" permanentemente do histórico?${enviadosAviso}\n\nEsta ação não pode ser desfeita.`;

    if (!confirm(aviso)) return;
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
    if (!c || !c.id) {
      toast({
        title: "Erro ao carregar",
        description: "Não foi possível carregar os dados desta campanha.",
        variant: "destructive",
      });
      return;
    }

    const meta = c.analytics_meta || {};
    const seq = normalizeCampaignSequence(c.analytics_meta);
    const limitPerRun = c.limit_per_run || 50;

    setBancoAudience(null);
    setEditingCampaignId(c.id);
    setCampaignName(c.name || "");
    setCampaignLimitPerRun(String(limitPerRun));
    setCampaignSequence(seq.length > 0 ? seq : [createCampaignStep("text", 1)]);
    setSelectedImportId(c.import_id || ALL_IMPORTS_VALUE);
    setSelectedImportIds(Array.isArray(meta.importIds) ? meta.importIds : (c.import_id ? [c.import_id] : []));

    // Restaura Loteamento / Batches
    const hasBatchConfig = Boolean(c.limit_per_run && c.limit_per_run > 0);
    setBatchingEnabled(hasBatchConfig);
    setBatchSize(String(c.limit_per_run || (meta.dispatchOptions as any)?.batchSize || 100));
    setBatchIntervalHours(String((meta.dispatchOptions as any)?.batchIntervalHours || (meta as any).batchIntervalHours || "1"));

    // Restaura Estratégia de Variações
    const hasVariants = seq.some(s => s.textVariants && s.textVariants.length > 0);
    const templateStrategy = meta.dispatchOptions?.templateStrategy || (hasVariants ? "ai_variations" : "single");
    setCampaignTemplateStrategy(templateStrategy === "ai_variations" ? "ai_variations" : "single");
    setVariantCountOverride(meta.dispatchOptions?.templateVariantCount || null);

    // Restaura Multi-Agenda se houver
    const hasSchedulingLink = seq.some(s => {
      const texts = [s.text, ...(Array.isArray(s.textVariants) ? s.textVariants : [])].filter(Boolean);
      return texts.some(t => /\{\{\s*scheduling_link\s*\}\}/i.test(t));
    });
    setMultiAgendaEnabled(Boolean((meta.dispatchOptions as any)?.multiAgendaEnabled || hasSchedulingLink));

    // Restaura Opções de Disparo (incluindo instance do WhatsApp)
    const savedDispatchOptions = (meta.dispatchOptions as any) || {};
    setDispatchOptions({
      ...defaultDispatchOptions,
      ...savedDispatchOptions,
      evolutionInstanceId: savedDispatchOptions.evolutionInstanceId ?? (c as any).evolution_instance_id ?? null,
    });

    // Restaura Cérebro que atende
    if (meta.dispatchOptions?.replyAgent) {
      setReplyAgent(meta.dispatchOptions.replyAgent);
      if (meta.dispatchOptions.replyAgent === "campanha") {
        setCampaignAgentPrompt(c.campaign_prompt_id ? (campaignPromptsById[c.campaign_prompt_id] || "") : "");
      } else {
        setCampaignAgentPrompt("");
      }
    } else if (c.campaign_prompt_id && campaignPromptsById[c.campaign_prompt_id]) {
      setReplyAgent("campanha");
      setCampaignAgentPrompt(campaignPromptsById[c.campaign_prompt_id]);
    } else if (c.mode === "agente") {
      setReplyAgent("campanha");
      setCampaignAgentPrompt(c.campaign_prompt_id ? (campaignPromptsById[c.campaign_prompt_id] || "") : "");
    } else {
      setReplyAgent("atendimento");
      setCampaignAgentPrompt("");
    }
    setActiveTab("campanha");
    toast({ title: "Carregado para edição", description: `Edite a campanha "${c.name}" no formulário de Novo Disparo.` });
  };

  // Duplicar: carrega a campanha no formulario como NOVA (editingCampaignId nulo),
  // com "(cópia)" no nome. Existe para o dono nao ter de editar campanha em
  // andamento por falta de alternativa barata — copia, ajusta, dispara a copia, e a
  // original segue intacta. A copia nasce sem disparo: so vira campanha de verdade
  // quando ele salvar.
  const handleDuplicateCampaign = (c: Campaign) => {
    if (
      formularioTemAlteracao() &&
      !window.confirm(
        "O formulário será substituído pelos dados desta campanha, e o que está preenchido nele agora será descartado.\n\n" +
          "A campanha original NÃO é alterada — você vai editar uma cópia nova.\n\nContinuar?"
      )
    ) {
      return;
    }

    const meta = c.analytics_meta || {};
    const seq = normalizeCampaignSequence(c.analytics_meta);

    // Passos ganham ids novos: reaproveitar os da origem faria as duas campanhas
    // compartilharem identidade de passo, e um id de passo repetido atrapalha o
    // rastreio de envio (campaign_dispatch_runs guarda stepId).
    const passosCopiados = (seq.length > 0 ? seq : [createCampaignStep("text", 1)]).map((step, idx) => ({
      ...step,
      id: `${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
      order: idx + 1,
    }));

    setBancoAudience(null);
    setEditingCampaignId(null);
    setCampaignName(`${c.name || "Campanha"} (cópia)`);
    setCampaignLimitPerRun(String(c.limit_per_run || 50));
    setCampaignSequence(passosCopiados);
    setCampaignTemplateStrategy(
      meta.dispatchOptions?.templateStrategy === "ai_variations" ? "ai_variations" : "single"
    );
    setSelectedImportId(c.import_id || ALL_IMPORTS_VALUE);
    setSelectedImportIds(Array.isArray(meta.importIds) ? meta.importIds : (c.import_id ? [c.import_id] : []));
    setDispatchOptions(meta.dispatchOptions || defaultDispatchOptions);
    // Roteiro do agente: a copia leva o TEXTO, nao o id. Salvar cria um
    // campaign_prompt proprio, entao editar o roteiro da copia nao mexe no original.
    if (meta.dispatchOptions?.replyAgent) {
      setReplyAgent(meta.dispatchOptions.replyAgent);
      if (meta.dispatchOptions.replyAgent === "campanha") {
        setCampaignAgentPrompt(c.campaign_prompt_id ? (campaignPromptsById[c.campaign_prompt_id] || "") : "");
      } else {
        setCampaignAgentPrompt("");
      }
    } else if (c.campaign_prompt_id && campaignPromptsById[c.campaign_prompt_id]) {
      setReplyAgent("campanha");
      setCampaignAgentPrompt(campaignPromptsById[c.campaign_prompt_id]);
    } else {
      setReplyAgent(c.mode === "agente" ? "campanha" : "atendimento");
      setCampaignAgentPrompt("");
    }
    // Agendamento nao e copiado de proposito: data antiga dispararia na hora.
    setNewTriggerType("manual");
    setNewScheduledAt("");
    setActiveTab("campanha");

    toast({
      title: "Campanha duplicada",
      description: "Ajuste o que precisar e salve. A campanha original não foi alterada.",
    });
  };

  // Exclui a planilha importada e as linhas dela (lead_import_items). Campanhas
  // antigas que apontavam para ela ficam sem base — por isso o aviso no confirm.
  const handleDeleteImport = async (importId: string, sourceName: string) => {
    if (!confirm(`Remover o registro da planilha "${sourceName}"?\n\nOs leads dela continuam no Banco de Dados — para apagá-los, use "Excluir os leads desta planilha".\nCampanhas que usam esta base ficarão sem leads. Esta ação não pode ser desfeita.`)) return;
    try {
      await deleteLeadImport.mutateAsync(importId);
      setSelectedImportIds((current) => current.filter((id) => id !== importId));
      if (selectedImportId === importId) setSelectedImportId(ALL_IMPORTS_VALUE);
      toast({ title: "Registro da planilha removido", description: `${sourceName} — os leads continuam no Banco.` });
    } catch (err) {
      toast({
        title: "Erro ao excluir",
        description: err instanceof Error ? err.message : "Não foi possível excluir a planilha.",
        variant: "destructive",
      });
    }
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

  if (!isCampanhasUnlocked) {
    return (
      <PageShell
        title={title}
        subtitle={subtitle}
        headerRight={headerRight}
        spacing="space-y-6"
        showGlobalClientSelector={!fixedClientId}
      >
        <div className="max-w-2xl mx-auto py-8">
          <UpsellCard
            title="Disparador & Campanhas em Massa"
            subtitle="Módulo Não Contratado no Plano Modular"
            description="Crie campanhas de disparo em massa com intervalos humanizados, variações antiban com IA e rotação automática de chips WhatsApp."
            moduleName="Disparador & Campanhas"
            benefits={[
              "Importação de planilhas Excel e CSV",
              "Disparo inteligente em massa com cadência segura",
              "Variações automáticas anti-bloqueio",
              "Relatórios de entrega e respostas em tempo real",
            ]}
          />
        </div>
      </PageShell>
    );
  }

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
          onClick={() => setActiveTab("planilhas")}
          className={cn(
            "rounded-lg px-4 py-2 text-xs font-semibold flex items-center gap-1.5 transition-all",
            activeTab === "planilhas" ? "bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          )}
        >
          <Database className="h-3.5 w-3.5" />
          Planilhas Salvas
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
            <ImportProgressBanner progress={importProgress} fileName={selectedFile?.name ?? null} />
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
              defaultDdd={defaultDdd}
              onDefaultDddChange={setDefaultDdd}
              phoneAuditStats={phoneAuditStats}
              setSelectedFile={setSelectedFile}
              setParsedRows={setParsedRows}
              selectedImportId={selectedImportId}
              selectedImportIds={selectedImportIds}
              setSelectedImportIds={setSelectedImportIds}
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
              hasSourceRows={sourceRows.length > 0}
              isLoadingSourceRows={isLoadingImportedItems}
              isMultiSpreadsheet={isMultiSpreadsheet}
              missingColumnWarnings={missingColumnWarnings}
              onToggleIncludeMissing={handleToggleIncludeMissing}
              bancoAudience={bancoAudience}
              onDiscardBancoAudience={() => {
                setBancoAudience(null);
                setParsedRows([]);
                setFilterRules([]);
              }}
              uploadedColumns={uploadedColumns}
              rawUploadedRows={rawUploadedRows}
              columnMappings={columnMappings}
              setColumnMappings={handleColumnMappingsChange}
              knownCustomFields={knownCustomFields}
              availableCustomFields={basesCustomFields.commonFields}
              excludedCustomFields={basesCustomFields.excludedFields}
              isMultiBaseCustomFields={basesCustomFields.isMultiBase}
              getMissingCountForField={getMissingCountForField}
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
              variantCount={variantCount}
              onVariantCountChange={setVariantCountOverride}
              suggestedVariantCount={suggestedVariantCount}
              dailyQuota={campaignDailyQuota}
              minVariantCount={2}
              maxVariantCount={MAX_TEMPLATE_VARIANTS}
              onAddStepButton={handleAddStepButton}
              onRemoveStepButton={handleRemoveStepButton}
              onUpdateStepButton={handleUpdateStepButton}
            />

            <SchedulingStep
              dispatchOptions={dispatchOptions}
              setDispatchOptions={setDispatchOptions}
              evolutionInstanceOptions={evolutionInstanceOptions}
              totalLeads={selectedFile ? previewRows.length : filteredRows.length}
              batchingEnabled={batchingEnabled}
              setBatchingEnabled={setBatchingEnabled}
              batchSize={batchSize}
              setBatchSize={setBatchSize}
              batchIntervalHours={batchIntervalHours}
              setBatchIntervalHours={setBatchIntervalHours}
              replyAgent={replyAgent}
              setReplyAgent={setReplyAgent}
              campaignAgentPrompt={campaignAgentPrompt}
              setCampaignAgentPrompt={setCampaignAgentPrompt}
              passosAposResposta={
                campaignSequence.filter((s) => s.enabled !== false && s.triggerMode === "after_reply").length
              }
              multiAgendaEnabled={multiAgendaEnabled}
              setMultiAgendaEnabled={setMultiAgendaEnabled}
              consultants={consultants}
              consultantsError={consultantsError}
              loadingConsultants={loadingConsultants}
              onRetryConsultants={refetchConsultants}
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
              onNovaCampanha={handleNovaCampanha}
              preDispatchAudit={preDispatchAudit}
            />
          </div>

          {/* Interactive Phone Mockup Preview Panel (Right Side) */}
          <WhatsAppPreviewPanel campaignSequence={campaignSequence} multiAgendaEnabled={multiAgendaEnabled} />
        </div>
      )}

      {/* 📋 TAB 2: CAMPANHAS CRIADAS (Clean table list) */}
      {activeTab === "enviadas" && (
        <CampaignsTable
          clientId={activeClientId || null}
          campaigns={campaigns}
          loadingCampaigns={loadingCampaigns}
          onEditCampaign={handleEditCampaign}
          onDuplicateCampaign={handleDuplicateCampaign}
          onDeleteCampaign={handleDeleteCampaign}
        />
      )}

      {/* ⚡ TAB 3: ACOMPANHAR DISPAROS (uma linha por campanha, lote vira quadrado) */}
      {activeTab === "agendamentos" && (
        <DispatchCampaignTracker
          clientId={activeClientId || null}
          onOpenDispatch={(dispId) => setPreviewDispatchId(dispId)}
        />
      )}

      {/* 📊 TAB 4: AUDITORIA & RECAMPANHAS */}
      {activeTab === "planilhas" && (
        <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div>
            <h3 className="text-sm font-black text-slate-800 dark:text-white">Planilhas Salvas</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Bases importadas deste cliente. Use a aba "Novo Disparo" para selecionar uma ou mais na campanha.
            </p>
          </div>

          <ImportProgressBanner progress={importProgress} />
          <SavedSheetsCards
            imports={allImports}
            onResumeImport={handleResumeImport}
            resumingImportId={resumingImportId}
            isDeleting={deleteLeadImport.isPending}
            onViewImport={(imp) => setViewingImport(imp)}
            onDeleteImport={(id, name) => handleDeleteImport(id, name)}
            onDeleteLeads={canMassDelete ? () => setIsMassDeleteOpen(true) : undefined}
          />
          {canMassDelete && (
            <MassDeleteDialog open={isMassDeleteOpen} onOpenChange={setIsMassDeleteOpen} clientId={activeClientId} />
          )}
        </div>
      )}

      <DispatchPromptDialog
        dispatchId={promptDispatchId}
        onOpenChange={(open) => !open && setPromptDispatchId(null)}
      />

      <ImportViewerDialog
        open={!!viewingImport}
        onOpenChange={(open) => !open && setViewingImport(null)}
        clientId={activeClientId}
        importRecord={viewingImport}
      />

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

      {/* Modal Detalhado de Destinatários do Lote */}
      <DispatchRecipientsDialog
        dispatchId={previewDispatchId}
        onClose={() => setPreviewDispatchId(null)}
        onDeleted={() => {
          refetchDispatches();
          queryClient.invalidateQueries({ queryKey: ["dispatch-summary"] });
        }}
      />

      {/* Modal de Aviso de Disparos em Aberto / Duplicados */}
      {duplicateWarningState && (
        <DuplicateDispatchWarningDialog
          open={duplicateWarningState.open}
          onOpenChange={(open) => {
            if (!open) setDuplicateWarningState(null);
          }}
          campaignName={duplicateWarningState.campaignName}
          pendingDispatchesCount={duplicateWarningState.pendingBatches.length}
          pendingRecipientsCount={duplicateWarningState.pendingRecipientsCount}
          onCancelPreviousAndCreate={handleCancelPreviousAndCreate}
          onCreateAnyway={handleCreateAnyway}
          isProcessing={duplicateWarningState.isProcessing}
        />
      )}
    </PageShell>
  );
}
