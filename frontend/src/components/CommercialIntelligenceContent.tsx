import { useEffect, useMemo, useState } from "react";
import { CircleSlash, Download, Filter, Loader2, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { DashboardPanel } from "@/components/DashboardPanel";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import {
  type CampaignPerformanceItem,
  type CommercialIntelligenceFilters,
  type CommercialIntelligencePayload,
  type CommercialMetricRow,
  type CommercialRankingCampaign,
  type CommercialRankingCity,
  type CommercialRankingConsultant,
  type CommercialIntelligenceSettings,
  type ConsultantItem,
  type ConsultantPayload,
  type DistributionQueueRow,
  type DistributionRuleItem,
  type DistributionRulePayload,
  type InsightItem,
  useAssignmentAction,
  useCommercialIntelligence,
  useCreateConsultant,
  useCreateDistributionRule,
  useDeleteConsultant,
  useSaveCommercialIntelligenceSettings,
  useUpdateConsultant,
  useUpdateDistributionRule,
  useUpdateInsightStatus,
} from "@/hooks/useCommercialIntelligence";
import {
  compareValues,
  DEFAULT_FILTERS,
  DEFAULT_SETTINGS,
  deltaLabel,
  exportRows,
  formatCurrency,
  formatHours,
  formatPercent,
  paginate,
  parseAvailableHours,
  PERIOD_OPTIONS,
  serializeAvailableHours,
  type SortOrder,
  type TabId,
} from "@/lib/commercialIntelligence/helpers";
import { AssignmentDialog } from "@/components/commercialIntelligence/AssignmentDialog";
import { CampaignDetailDialog } from "@/components/commercialIntelligence/CampaignDetailDialog";
import { ConsultantDetailDialog } from "@/components/commercialIntelligence/ConsultantDetailDialog";
import { ConsultantFormDialog } from "@/components/commercialIntelligence/ConsultantFormDialog";
import { DistributionRuleDialog } from "@/components/commercialIntelligence/DistributionRuleDialog";
import { EquipeTab } from "@/components/commercialIntelligence/EquipeTab";
import { FilterField } from "@/components/commercialIntelligence/FilterField";
import { IaConfigTab } from "@/components/commercialIntelligence/IaConfigTab";
import { LoadingState } from "@/components/commercialIntelligence/LoadingState";
import { PerformanceTab } from "@/components/commercialIntelligence/PerformanceTab";
import { RankingDetailDialog } from "@/components/commercialIntelligence/RankingDetailDialog";

export function CommercialIntelligenceContent({ clientId }: { clientId: string }) {
  const crmClient = useOptionalCrmClient();
  const selectedCrmClient = crmClient?.selectedClient;
  const allowedTabs = selectedCrmClient?.n8n_settings?.allowed_tabs;

  const isSubTabAllowed = (subTabKey: string) => {
    if (!allowedTabs || !Array.isArray(allowedTabs)) return true;

    // Check consolidated key
    if (allowedTabs.includes(`inteligencia:${subTabKey}`)) return true;

    // Fallback mappings for backwards compatibility
    if (subTabKey === "performance") {
      return (
        allowedTabs.includes("inteligencia:visao-geral") ||
        allowedTabs.includes("inteligencia:metricas") ||
        allowedTabs.includes("inteligencia:rankings") ||
        allowedTabs.includes("inteligencia:campanhas")
      );
    }
    if (subTabKey === "equipe") {
      return (
        allowedTabs.includes("inteligencia:distribuicao") ||
        allowedTabs.includes("inteligencia:consultores")
      );
    }
    if (subTabKey === "ia-config") {
      return (
        allowedTabs.includes("inteligencia:insights") ||
        allowedTabs.includes("inteligencia:configuracoes")
      );
    }

    return false;
  };

  const intelligenceSubTabs = ["performance", "equipe", "ia-config"] as const;
  const allowedIntelligenceSubTabs = intelligenceSubTabs.filter(isSubTabAllowed);

  const [activeTab, setActiveTab] = useState<TabId>("performance");
  const [showDetailedMetrics, setShowDetailedMetrics] = useState(false);
  const [showCampaignsPanel, setShowCampaignsPanel] = useState(false);

  useEffect(() => {
    if (allowedIntelligenceSubTabs.length > 0) {
      const isCurrentAllowed = allowedIntelligenceSubTabs.includes(activeTab);
      if (!isCurrentAllowed) {
        setActiveTab(allowedIntelligenceSubTabs[0] as TabId);
      }
    }
  }, [activeTab, allowedIntelligenceSubTabs]);

  const [draftFilters, setDraftFilters] = useState<CommercialIntelligenceFilters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<CommercialIntelligenceFilters>(DEFAULT_FILTERS);
  const [metricSort, setMetricSort] = useState<{ key: keyof CommercialMetricRow; order: SortOrder }>({
    key: "current",
    order: "desc",
  });
  const [consultantSearch, setConsultantSearch] = useState("");
  const [consultantPage, setConsultantPage] = useState(1);
  const [consultantDialogOpen, setConsultantDialogOpen] = useState(false);
  const [consultantDetail, setConsultantDetail] = useState<ConsultantItem | null>(null);
  const [editingConsultantId, setEditingConsultantId] = useState<string | null>(null);
  const [consultantForm, setConsultantForm] = useState<ConsultantPayload & { availableHoursLabel?: string }>({
    clientId,
    name: "",
    phone: "",
    email: "",
    city: "",
    state: "",
    territoryCities: [],
    territoryStates: [],
    territoryRegions: [],
    contractValueMin: 0,
    contractValueMax: 0,
    leadTypes: [],
    dailyCapacity: 20,
    openLeadLimit: 30,
    assignmentWeight: 1,
    priorityRank: 1,
    available: true,
    active: true,
    position: "",
    availableHours: {},
    acceptsAutoAssign: true,
    notes: "",
    availableHoursLabel: "",
  });
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState<DistributionRulePayload & { city?: string; state?: string; region?: string; leadType?: string; campaignOrigin?: string; availabilityRequired?: boolean; dailyCapacity?: number; slaMinutes?: number; minContract?: number; maxContract?: number; }>({
    clientId,
    name: "",
    distributionMode: "round_robin",
    prioritizeRegion: false,
    prioritizeContractValue: false,
    prioritizeLeadType: false,
    maxOpenLeadsPerConsultant: 30,
    reassignAfterMinutes: 30,
    fairnessFloor: 1,
    active: true,
    config: {},
    city: "",
    state: "",
    region: "",
    leadType: "",
    campaignOrigin: "",
    availabilityRequired: true,
    dailyCapacity: 30,
    slaMinutes: 30,
    minContract: 0,
    maxContract: 0,
  });
  const [queuePage, setQueuePage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [campaignSearch, setCampaignSearch] = useState("");
  const [campaignPage, setCampaignPage] = useState(1);
  const [campaignDetail, setCampaignDetail] = useState<CampaignPerformanceItem | null>(null);
  const [compareCampaignA, setCompareCampaignA] = useState("");
  const [compareCampaignB, setCompareCampaignB] = useState("");
  const [settingsDraft, setSettingsDraft] = useState<CommercialIntelligenceSettings>(DEFAULT_SETTINGS);
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
  const [selectedAssignmentRow, setSelectedAssignmentRow] = useState<DistributionQueueRow | null>(null);
  const [assignmentConsultantId, setAssignmentConsultantId] = useState("");
  const [assignmentReason, setAssignmentReason] = useState("");
  const [rankingCityCriterion, setRankingCityCriterion] = useState<keyof CommercialRankingCity>("qualificationRate");
  const [rankingCityOrder, setRankingCityOrder] = useState<SortOrder>("desc");
  const [rankingCampaignCriterion, setRankingCampaignCriterion] = useState<keyof CommercialRankingCampaign>("qualificationRate");
  const [rankingCampaignOrder, setRankingCampaignOrder] = useState<SortOrder>("desc");
  const [rankingConsultantCriterion, setRankingConsultantCriterion] = useState<keyof CommercialRankingConsultant>("conversionRate");
  const [rankingConsultantOrder, setRankingConsultantOrder] = useState<SortOrder>("desc");
  const [rankingDetailRows, setRankingDetailRows] = useState<Array<{ label: string; value: string }>>([]);
  const [rankingDetailTitle, setRankingDetailTitle] = useState("");
  const [rankingDetailOpen, setRankingDetailOpen] = useState(false);
  const [insightSeverity, setInsightSeverity] = useState("all");
  const [insightType, setInsightType] = useState("all");
  const [insightCampaign, setInsightCampaign] = useState("all");
  const [insightCity, setInsightCity] = useState("all");

  const { data, isLoading, error, refetch, isFetching } = useCommercialIntelligence(clientId, appliedFilters);
  const createConsultant = useCreateConsultant();
  const updateConsultant = useUpdateConsultant();
  const deleteConsultant = useDeleteConsultant();
  const createRule = useCreateDistributionRule();
  const updateRule = useUpdateDistributionRule();
  const assignmentAction = useAssignmentAction();
  const saveSettings = useSaveCommercialIntelligenceSettings();
  const updateInsightStatus = useUpdateInsightStatus();

  useEffect(() => {
    setDraftFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    setConsultantForm((current) => ({ ...current, clientId }));
    setRuleForm((current) => ({ ...current, clientId }));
  }, [clientId]);

  useEffect(() => {
    if (!data) return;
    setSettingsDraft(data.settings || DEFAULT_SETTINGS);
  }, [data]);

  const options = data?.filters.options;
  const consultants = useMemo(() => data?.consultants.items ?? [], [data?.consultants.items]);
  const campaigns = useMemo(() => data?.campaigns.items ?? [], [data?.campaigns.items]);
  const insights = useMemo(() => data?.insights.items ?? [], [data?.insights.items]);
  const distributionRules = useMemo(() => data?.distribution.rules ?? [], [data?.distribution.rules]);
  const distributionQueue = useMemo(() => data?.distribution.queue ?? [], [data?.distribution.queue]);
  const distributionHistory = useMemo(() => data?.distribution.history ?? [], [data?.distribution.history]);

  const metricsSorted = useMemo(() => {
    if (!data) return [];
    return [...data.metrics.items].sort((a, b) => compareValues(a[metricSort.key], b[metricSort.key], metricSort.order));
  }, [data, metricSort]);

  const consultantsFiltered = useMemo(() => {
    return consultants.filter((consultant) => {
      const haystack = [
        consultant.name,
        consultant.email,
        consultant.phone,
        consultant.city,
        consultant.state,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(consultantSearch.toLowerCase());
    });
  }, [consultants, consultantSearch]);

  const campaignsFiltered = useMemo(() => {
    return campaigns.filter((campaign) => campaign.name.toLowerCase().includes(campaignSearch.toLowerCase()));
  }, [campaigns, campaignSearch]);

  const insightsFiltered = useMemo(() => {
    return insights.filter((insight) => {
      if (insightSeverity !== "all" && insight.severity !== insightSeverity) return false;
      if (insightType !== "all" && insight.scope !== insightType) return false;
      if (insightCampaign !== "all") {
        const option = options?.campaigns.find((item) => item.id === insightCampaign || item.value === insightCampaign);
        const name = option?.label || option?.name || "";
        if (![insight.title, insight.message, insight.actionTargetName].join(" ").toLowerCase().includes(name.toLowerCase())) return false;
      }
      if (insightCity !== "all" && ![insight.title, insight.message, insight.actionTargetName].join(" ").toLowerCase().includes(insightCity.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [insightCampaign, insightCity, insightSeverity, insightType, insights, options?.campaigns]);

  const sortedCities = useMemo(() => {
    const items = [...(data?.rankings.cities || [])];
    items.sort((a, b) => compareValues(a[rankingCityCriterion], b[rankingCityCriterion], rankingCityOrder));
    return items;
  }, [data?.rankings.cities, rankingCityCriterion, rankingCityOrder]);

  const sortedCampaigns = useMemo(() => {
    const items = [...(data?.rankings.campaigns || [])];
    items.sort((a, b) => compareValues(a[rankingCampaignCriterion], b[rankingCampaignCriterion], rankingCampaignOrder));
    return items;
  }, [data?.rankings.campaigns, rankingCampaignCriterion, rankingCampaignOrder]);

  const sortedConsultants = useMemo(() => {
    const items = [...(data?.rankings.consultants || [])];
    items.sort((a, b) => compareValues(a[rankingConsultantCriterion], b[rankingConsultantCriterion], rankingConsultantOrder));
    return items;
  }, [data?.rankings.consultants, rankingConsultantCriterion, rankingConsultantOrder]);

  const pagedConsultants = paginate(consultantsFiltered, consultantPage, 8);
  const pagedCampaigns = paginate(campaignsFiltered, campaignPage, 8);
  const pagedQueue = paginate(distributionQueue, queuePage, 8);
  const pagedHistory = paginate(distributionHistory, historyPage, 8);

  const compareCampaignRows = useMemo(() => {
    return campaigns.filter((campaign) => [compareCampaignA, compareCampaignB].includes(campaign.id));
  }, [campaigns, compareCampaignA, compareCampaignB]);

  const consultantSummary = useMemo(() => {
    const active = consultants.filter((item) => item.status === "ativo").length;
    const available = consultants.filter((item) => item.available).length;
    const revenue = consultants.reduce((sum, item) => sum + Number(item.revenue || 0), 0);
    return { active, available, revenue };
  }, [consultants]);

  const handleApplyFilters = () => {
    setAppliedFilters(draftFilters);
    toast.success("Filtros aplicados na inteligencia comercial.");
  };

  const handleClearFilters = () => {
    setDraftFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    toast.success("Filtros limpos.");
  };

  const handleExport = () => {
    if (!data) return;

    if (activeTab === "performance") {
      exportRows("inteligencia-comercial-performance.csv", [
        ...data.overview.kpis.map((item) => ({
          tipo: "KPI",
          nome: item.title,
          valor: item.valueLabel,
          delta: item.delta === null ? "—" : deltaLabel(item.delta, item.kind),
          extra: item.kind,
        })),
        ...metricsSorted.map((metric) => ({
          tipo: "Metrica Detalhada",
          nome: metric.name,
          valor: metric.currentLabel,
          delta: metric.deltaLabel,
          extra: metric.direction,
        })),
        ...campaignsFiltered.map((campaign) => ({
          tipo: "Campanha",
          nome: campaign.name,
          valor: formatPercent(campaign.qualificationRate),
          delta: campaign.roiEstimated === null ? "—" : `${campaign.roiEstimated.toFixed(2)}x`,
          extra: campaign.status,
        })),
      ]);
      return;
    }

    if (activeTab === "equipe") {
      exportRows("inteligencia-comercial-equipe.csv", [
        ...consultantsFiltered.map((consultant) => ({
          tipo: "Consultor",
          nome: consultant.name,
          status: consultant.status,
          disponivel: consultant.available ? "Sim" : "Nao",
          conversao: formatPercent(consultant.conversionRate),
          tempo_resposta: formatHours(consultant.responseTimeHours),
          leads: `${consultant.leadsReceived}/${consultant.dailyCapacity}`,
          receita: formatCurrency(consultant.revenue),
        })),
        ...distributionQueue.map((row) => ({
          tipo: "Fila Ativa",
          nome: row.leadName,
          status: row.status,
          disponivel: row.slaStatus,
          conversao: row.ruleApplied,
          tempo_resposta: row.city,
          leads: row.campaignName,
          receita: formatCurrency(row.potentialValue),
        })),
      ]);
      return;
    }

    if (activeTab === "ia-config") {
      exportRows("inteligencia-comercial-ia-config.csv", [
        ...insightsFiltered.map((insight) => ({
          tipo: "Insight Brain",
          titulo: insight.title,
          severidade: insight.severity,
          impacto: insight.impact,
          recomendacao: insight.recommendation,
        })),
        {
          tipo: "Ajustes",
          titulo: "Limiar de qualificacao",
          severidade: String(settingsDraft.qualificationThreshold),
          impacto: `SLA Padrao: ${settingsDraft.slaMinutes} min`,
          recomendacao: `Estrategia: ${settingsDraft.distributionStrategy}`,
        },
      ]);
      return;
    }
  };

  const resetConsultantForm = () => {
    setConsultantForm({
      clientId,
      name: "",
      phone: "",
      email: "",
      city: "",
      state: "",
      territoryCities: [],
      territoryStates: [],
      territoryRegions: [],
      contractValueMin: 0,
      contractValueMax: 0,
      leadTypes: [],
      dailyCapacity: 20,
      openLeadLimit: 30,
      assignmentWeight: 1,
      priorityRank: 1,
      available: true,
      active: true,
      position: "",
      availableHours: {},
      acceptsAutoAssign: true,
      notes: "",
      availableHoursLabel: "",
    });
    setEditingConsultantId(null);
  };

  const openConsultantForEdit = (consultant: ConsultantItem) => {
    setEditingConsultantId(consultant.id);
    setConsultantForm({
      clientId,
      name: consultant.name,
      phone: consultant.phone,
      email: consultant.email,
      city: consultant.city,
      state: consultant.state,
      territoryCities: consultant.territoryCities,
      territoryStates: consultant.territoryStates,
      territoryRegions: consultant.territoryRegions,
      contractValueMin: consultant.contractValueMin,
      contractValueMax: consultant.contractValueMax,
      leadTypes: consultant.leadTypes,
      dailyCapacity: consultant.dailyCapacity,
      openLeadLimit: consultant.openLeadLimit,
      assignmentWeight: consultant.assignmentWeight,
      priorityRank: consultant.priorityRank,
      available: consultant.available,
      active: consultant.status === "ativo",
      position: consultant.position,
      availableHours: consultant.availableHours,
      acceptsAutoAssign: consultant.acceptsAutoAssign,
      notes: consultant.notes,
      availableHoursLabel: serializeAvailableHours(consultant.availableHours),
    });
    setConsultantDialogOpen(true);
  };

  const handleConsultantSubmit = async () => {
    try {
      const payload: ConsultantPayload = {
        ...consultantForm,
        clientId,
        availableHours: parseAvailableHours(consultantForm.availableHoursLabel || ""),
      };

      if (editingConsultantId) {
        await updateConsultant.mutateAsync({ id: editingConsultantId, ...payload });
        toast.success("Consultor atualizado com sucesso.");
      } else {
        await createConsultant.mutateAsync(payload);
        toast.success("Consultor cadastrado com sucesso.");
      }

      setConsultantDialogOpen(false);
      resetConsultantForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar consultor.");
    }
  };

  const handleDeleteConsultant = async (consultant: ConsultantItem) => {
    if (!window.confirm(`Remover ${consultant.name}? Esta acao nao pode ser desfeita.`)) return;
    try {
      await deleteConsultant.mutateAsync(consultant.id);
      toast.success("Consultor removido com sucesso.");
      if (consultantDetail?.id === consultant.id) setConsultantDetail(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao remover consultor.");
    }
  };

  const handleConsultantStatusToggle = async (consultant: ConsultantItem, nextActive: boolean) => {
    try {
      await updateConsultant.mutateAsync({
        id: consultant.id,
        clientId,
        name: consultant.name,
        phone: consultant.phone,
        email: consultant.email,
        city: consultant.city,
        state: consultant.state,
        territoryCities: consultant.territoryCities,
        territoryStates: consultant.territoryStates,
        territoryRegions: consultant.territoryRegions,
        contractValueMin: consultant.contractValueMin,
        contractValueMax: consultant.contractValueMax,
        leadTypes: consultant.leadTypes,
        dailyCapacity: consultant.dailyCapacity,
        openLeadLimit: consultant.openLeadLimit,
        assignmentWeight: consultant.assignmentWeight,
        priorityRank: consultant.priorityRank,
        available: nextActive,
        active: nextActive,
        position: consultant.position,
        availableHours: consultant.availableHours,
        acceptsAutoAssign: consultant.acceptsAutoAssign,
        notes: consultant.notes,
      });
      toast.success(nextActive ? "Consultor ativado." : "Consultor desativado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao atualizar status do consultor.");
    }
  };

  const handleEligibilityTest = (consultant: ConsultantItem) => {
    const matchesCity = !draftFilters.city || consultant.territoryCities.length === 0 || consultant.territoryCities.includes(draftFilters.city);
    const hasCapacity = consultant.dailyCapacity > consultant.leadsReceived;
    const acceptsStatus = consultant.available && consultant.acceptsAutoAssign;

    const reasons = [
      matchesCity ? "territorio compativel" : "fora do territorio",
      hasCapacity ? "capacidade disponivel" : "sem capacidade diaria",
      acceptsStatus ? "recebimento automatico ativo" : "recebimento automatico bloqueado",
    ];

    toast.message(`Elegibilidade de ${consultant.name}`, {
      description: reasons.join(" • "),
    });
  };

  const resetRuleForm = () => {
    setRuleForm({
      clientId,
      name: "",
      distributionMode: "round_robin",
      prioritizeRegion: false,
      prioritizeContractValue: false,
      prioritizeLeadType: false,
      maxOpenLeadsPerConsultant: 30,
      reassignAfterMinutes: 30,
      fairnessFloor: 1,
      active: true,
      config: {},
      city: "",
      state: "",
      region: "",
      leadType: "",
      campaignOrigin: "",
      availabilityRequired: true,
      dailyCapacity: 30,
      slaMinutes: 30,
      minContract: 0,
      maxContract: 0,
    });
    setEditingRuleId(null);
  };

  const openRuleForEdit = (rule: DistributionRuleItem) => {
    setEditingRuleId(rule.id);
    const config = (rule.config || {}) as Record<string, unknown>;
    setRuleForm({
      clientId,
      name: rule.name,
      distributionMode: rule.distributionMode,
      prioritizeRegion: rule.prioritizeRegion,
      prioritizeContractValue: rule.prioritizeContractValue,
      prioritizeLeadType: rule.prioritizeLeadType,
      maxOpenLeadsPerConsultant: rule.maxOpenLeadsPerConsultant,
      reassignAfterMinutes: rule.reassignAfterMinutes,
      fairnessFloor: rule.fairnessFloor,
      active: rule.active,
      config,
      city: typeof config.city === "string" ? config.city : "",
      state: typeof config.state === "string" ? config.state : "",
      region: typeof config.region === "string" ? config.region : "",
      leadType: typeof config.leadType === "string" ? config.leadType : "",
      campaignOrigin: typeof config.campaignOrigin === "string" ? config.campaignOrigin : "",
      availabilityRequired: typeof config.availabilityRequired === "boolean" ? config.availabilityRequired : true,
      dailyCapacity: typeof config.dailyCapacity === "number" ? config.dailyCapacity : 30,
      slaMinutes: typeof config.slaMinutes === "number" ? config.slaMinutes : rule.reassignAfterMinutes,
      minContract: typeof config.minContract === "number" ? config.minContract : 0,
      maxContract: typeof config.maxContract === "number" ? config.maxContract : 0,
    });
    setRuleDialogOpen(true);
  };

  const handleRuleSubmit = async () => {
    try {
      const payload: DistributionRulePayload = {
        clientId,
        name: ruleForm.name,
        distributionMode: ruleForm.distributionMode,
        prioritizeRegion: ruleForm.prioritizeRegion,
        prioritizeContractValue: ruleForm.prioritizeContractValue,
        prioritizeLeadType: ruleForm.prioritizeLeadType,
        maxOpenLeadsPerConsultant: ruleForm.maxOpenLeadsPerConsultant,
        reassignAfterMinutes: ruleForm.reassignAfterMinutes,
        fairnessFloor: ruleForm.fairnessFloor,
        active: ruleForm.active,
        config: {
          city: ruleForm.city || null,
          state: ruleForm.state || null,
          region: ruleForm.region || null,
          leadType: ruleForm.leadType || null,
          campaignOrigin: ruleForm.campaignOrigin || null,
          availabilityRequired: ruleForm.availabilityRequired ?? true,
          dailyCapacity: ruleForm.dailyCapacity ?? 30,
          slaMinutes: ruleForm.slaMinutes ?? ruleForm.reassignAfterMinutes,
          minContract: ruleForm.minContract ?? 0,
          maxContract: ruleForm.maxContract ?? 0,
        },
      };

      if (editingRuleId) {
        await updateRule.mutateAsync({ id: editingRuleId, ...payload });
        toast.success("Regra de distribuicao atualizada.");
      } else {
        await createRule.mutateAsync(payload);
        toast.success("Regra de distribuicao criada.");
      }

      setRuleDialogOpen(false);
      resetRuleForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar regra.");
    }
  };

  const openAssignmentDialog = (row: DistributionQueueRow) => {
    setSelectedAssignmentRow(row);
    setAssignmentConsultantId(row.consultantId || "");
    setAssignmentReason("");
    setAssignmentDialogOpen(true);
  };

  const handleAssignmentMutation = async (payload: { id: string; action: string; consultantId?: string; reason?: string }, successMessage: string) => {
    try {
      await assignmentAction.mutateAsync(payload);
      toast.success(successMessage);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao executar acao na fila.");
    }
  };

  const handleAssignmentSubmit = async () => {
    if (!selectedAssignmentRow || !assignmentConsultantId) return;
    await handleAssignmentMutation(
      {
        id: selectedAssignmentRow.id,
        action: "reatribuir",
        consultantId: assignmentConsultantId,
        reason: assignmentReason,
      },
      "Lead reatribuido com sucesso.",
    );
    setAssignmentDialogOpen(false);
  };

  const handleStrategyToggle = async (strategy: string, enabled: boolean) => {
    if (!enabled && settingsDraft.distributionStrategy === strategy) {
      toast.info("Mantenha uma estrategia principal ativa antes de desativar esta.");
      return;
    }

    const nextStrategy = enabled ? strategy : settingsDraft.distributionStrategy;
    const next = { ...settingsDraft, distributionStrategy: nextStrategy };
    setSettingsDraft(next);
    try {
      await saveSettings.mutateAsync({ ...next, clientId });
      toast.success("Estrategia principal de distribuicao atualizada.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao atualizar estrategia.");
      setSettingsDraft(data?.settings || DEFAULT_SETTINGS);
    }
  };

  const handleSaveSettings = async () => {
    try {
      await saveSettings.mutateAsync({ ...settingsDraft, clientId });
      toast.success("Configuracoes salvas com sucesso.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar configuracoes.");
    }
  };

  const handleRestoreSettings = () => {
    setSettingsDraft(DEFAULT_SETTINGS);
    toast.info("Valores padrao carregados. Clique em salvar para persistir.");
  };

  const openRankingDetails = (title: string, rows: Array<{ label: string; value: string }>) => {
    setRankingDetailTitle(title);
    setRankingDetailRows(rows);
    setRankingDetailOpen(true);
  };

  const handleInsightAction = async (insight: InsightItem) => {
    if (insight.actionType === "open_campaign") {
      const campaign = campaigns.find((item) => item.id === insight.actionTargetId) || campaigns.find((item) => item.name === insight.actionTargetName);
      setActiveTab("performance");
      if (campaign) setCampaignDetail(campaign);
    } else if (insight.actionType === "open_consultant") {
      const consultant = consultants.find((item) => item.id === insight.actionTargetId) || consultants.find((item) => item.name === insight.actionTargetName);
      setActiveTab("equipe");
      if (consultant) setConsultantDetail(consultant);
    } else if (insight.actionType === "adjust_rule" || insight.actionType === "redistribute") {
      setActiveTab("equipe");
    } else if (insight.actionType === "export_report") {
      handleExport();
    }

    if (insight.id) {
      try {
        await updateInsightStatus.mutateAsync({ id: insight.id, status: "read" });
      } catch {
        // noop
      }
    }
  };

  if (isLoading) {
    return <LoadingState />;
  }

  if (error) {
    return (
      <div className="space-y-3">
        <ErrorMessage message={(error as Error).message} variant="dashboard" />
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCcw className="h-4 w-4" />
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (!data) {
    return <EmptyState title="Inteligencia comercial indisponivel" description="Nao foi possivel carregar dados operacionais para esta empresa." />;
  }

  if (allowedIntelligenceSubTabs.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-border bg-card p-6">
        <p className="text-sm text-slate-400 text-center">Você não tem permissão para acessar nenhuma sub-aba da Inteligência Comercial.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DashboardPanel
        title="Operacao em tempo real"
        subtitle="Filtros, exportacao e recarga para governar a camada comercial sem sair do CRM."
        className="p-4"
      >
        <div className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-6">
            <FilterField label="Periodo">
              <Select value={draftFilters.period || "30d"} onValueChange={(value) => setDraftFilters((current) => ({ ...current, period: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Periodo" />
                </SelectTrigger>
                <SelectContent>
                  {PERIOD_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Campanha">
              <Select value={draftFilters.campaignId || "all"} onValueChange={(value) => setDraftFilters((current) => ({ ...current, campaignId: value === "all" ? "" : value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas as campanhas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as campanhas</SelectItem>
                  {(options?.campaigns || []).map((option) => (
                    <SelectItem key={option.id || option.value || option.name} value={option.id || option.value || option.name || ""}>
                      {option.label || option.name || option.value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Cidade">
              <Select value={draftFilters.city || "all"} onValueChange={(value) => setDraftFilters((current) => ({ ...current, city: value === "all" ? "" : value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas as cidades" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as cidades</SelectItem>
                  {(options?.cities || []).map((option) => {
                    const value = option.value || option.name || option.label || "";
                    return (
                      <SelectItem key={value} value={value}>
                        {option.label || option.name || value}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Consultor">
              <Select value={draftFilters.consultantId || "all"} onValueChange={(value) => setDraftFilters((current) => ({ ...current, consultantId: value === "all" ? "" : value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos os consultores" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os consultores</SelectItem>
                  {(options?.consultants || []).map((option) => (
                    <SelectItem key={option.id || option.value || option.name} value={option.id || option.value || option.name || ""}>
                      {option.label || option.name || option.value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Status do lead">
              <Select value={draftFilters.status || "all"} onValueChange={(value) => setDraftFilters((current) => ({ ...current, status: value === "all" ? "" : value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos os status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os status</SelectItem>
                  {(options?.statuses || []).map((option) => {
                    const value = option.value || option.name || option.label || "";
                    return (
                      <SelectItem key={value} value={value}>
                        {option.label || option.name || value}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Atualizacao">
              <div className="flex items-center gap-2">
                <Button onClick={handleApplyFilters} className="flex-1">
                  <Filter className="h-4 w-4" />
                  Aplicar
                </Button>
                <Button variant="outline" size="icon" onClick={handleClearFilters} title="Limpar filtros">
                  <CircleSlash className="h-4 w-4" />
                </Button>
              </div>
            </FilterField>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              Atualizar dados
            </Button>
            <Button variant="outline" onClick={handleExport}>
              <Download className="h-4 w-4" />
              Exportar visao
            </Button>
            <Badge variant="outline" className="border-cyan-400/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200">
              {data.client.name}
            </Badge>
            <Badge variant="outline">{PERIOD_OPTIONS.find((option) => option.value === appliedFilters.period)?.label || "30 dias"}</Badge>
            <span className="text-xs text-muted-foreground">Atualizado em {new Date(data.generatedAt).toLocaleString("pt-BR")}</span>
          </div>
        </div>
      </DashboardPanel>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TabId)} className="space-y-4">
        <div className="rounded-[1.5rem] border border-border bg-card/60 p-2 backdrop-blur-md">
          <TabsList className="grid h-auto w-full gap-2 bg-transparent p-0" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(110px, 1fr))` }}>
            {isSubTabAllowed("performance") && (
              <TabsTrigger value="performance" className="rounded-2xl px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em]">
                Performance Comercial
              </TabsTrigger>
            )}
            {isSubTabAllowed("equipe") && (
              <TabsTrigger value="equipe" className="rounded-2xl px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em]">
                Equipe & Roteamento
              </TabsTrigger>
            )}
            {isSubTabAllowed("ia-config") && (
              <TabsTrigger value="ia-config" className="rounded-2xl px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em]">
                Ajustes & Diagnósticos
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <TabsContent value="performance" className="space-y-4">
          <PerformanceTab
            data={data}
            metricsSorted={metricsSorted}
            campaignsFiltered={campaignsFiltered}
            pagedCampaigns={pagedCampaigns}
            setCampaignPage={setCampaignPage}
            compareCampaignA={compareCampaignA}
            compareCampaignB={compareCampaignB}
            setCompareCampaignA={setCompareCampaignA}
            setCompareCampaignB={setCompareCampaignB}
            compareCampaignRows={compareCampaignRows}
            campaigns={campaigns}
            showCampaignsPanel={showCampaignsPanel}
            setShowCampaignsPanel={setShowCampaignsPanel}
            showDetailedMetrics={showDetailedMetrics}
            setShowDetailedMetrics={setShowDetailedMetrics}
            setActiveTab={setActiveTab}
            setCampaignDetail={setCampaignDetail}
            setConsultantDetail={setConsultantDetail}
            handleInsightAction={handleInsightAction}
            openRankingDetails={openRankingDetails}
            metricSort={metricSort}
            setMetricSort={setMetricSort}
          />
        </TabsContent>

        <TabsContent value="equipe" className="space-y-4">
          <EquipeTab
            consultantSearch={consultantSearch}
            setConsultantSearch={setConsultantSearch}
            consultantsFiltered={consultantsFiltered}
            pagedConsultants={pagedConsultants}
            setConsultantPage={setConsultantPage}
            resetConsultantForm={resetConsultantForm}
            setConsultantDialogOpen={setConsultantDialogOpen}
            openConsultantForEdit={openConsultantForEdit}
            setConsultantDetail={setConsultantDetail}
            handleConsultantStatusToggle={handleConsultantStatusToggle}
            handleDeleteConsultant={handleDeleteConsultant}
            consultantSummary={consultantSummary}
            consultants={consultants}
            data={data}
            settingsDraft={settingsDraft}
            handleStrategyToggle={handleStrategyToggle}
            distributionRules={distributionRules}
            resetRuleForm={resetRuleForm}
            setRuleDialogOpen={setRuleDialogOpen}
            openRuleForEdit={openRuleForEdit}
            openRankingDetails={openRankingDetails}
            distributionQueue={distributionQueue}
            pagedQueue={pagedQueue}
            setQueuePage={setQueuePage}
            openAssignmentDialog={openAssignmentDialog}
            handleAssignmentMutation={handleAssignmentMutation}
            distributionHistory={distributionHistory}
            pagedHistory={pagedHistory}
            setHistoryPage={setHistoryPage}
          />
        </TabsContent>

        <TabsContent value="ia-config" className="space-y-4">
          <IaConfigTab
            insightSeverity={insightSeverity}
            setInsightSeverity={setInsightSeverity}
            insightType={insightType}
            setInsightType={setInsightType}
            insightCampaign={insightCampaign}
            setInsightCampaign={setInsightCampaign}
            insightCity={insightCity}
            setInsightCity={setInsightCity}
            options={options}
            appliedFilters={appliedFilters}
            insightsFiltered={insightsFiltered}
            handleInsightAction={handleInsightAction}
            updateInsightStatus={updateInsightStatus}
            settingsDraft={settingsDraft}
            setSettingsDraft={setSettingsDraft}
            handleRestoreSettings={handleRestoreSettings}
            handleSaveSettings={handleSaveSettings}
            saveSettings={saveSettings}
          />
        </TabsContent>
      </Tabs>

      <ConsultantFormDialog
        open={consultantDialogOpen}
        onOpenChange={setConsultantDialogOpen}
        title={editingConsultantId ? "Editar consultor" : "Novo consultor"}
        form={consultantForm}
        onChange={setConsultantForm}
        onSubmit={() => void handleConsultantSubmit()}
        isSaving={createConsultant.isPending || updateConsultant.isPending}
      />

      <DistributionRuleDialog
        open={ruleDialogOpen}
        onOpenChange={setRuleDialogOpen}
        form={ruleForm}
        onChange={setRuleForm}
        onSubmit={() => void handleRuleSubmit()}
        isSaving={createRule.isPending || updateRule.isPending}
      />

      <AssignmentDialog
        open={assignmentDialogOpen}
        onOpenChange={setAssignmentDialogOpen}
        row={selectedAssignmentRow}
        consultants={consultants}
        consultantId={assignmentConsultantId}
        reason={assignmentReason}
        onConsultantChange={setAssignmentConsultantId}
        onReasonChange={setAssignmentReason}
        onSubmit={() => void handleAssignmentSubmit()}
        isSaving={assignmentAction.isPending}
      />

      <RankingDetailDialog title={rankingDetailTitle} open={rankingDetailOpen} onOpenChange={setRankingDetailOpen} rows={rankingDetailRows} />

      <ConsultantDetailDialog consultantDetail={consultantDetail} onOpenChange={(open) => !open && setConsultantDetail(null)} />

      <CampaignDetailDialog campaignDetail={campaignDetail} onOpenChange={(open) => !open && setCampaignDetail(null)} />
    </div>
  );
}
