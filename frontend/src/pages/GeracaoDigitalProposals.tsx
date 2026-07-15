import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { GeracaoDigitalTabs } from "@/components/GeracaoDigitalTabs";
import { toast } from "@/components/ui/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { calculateProposalValues } from "@/lib/geracaoDigital/proposalCalculator";
import { API_BASE_URL, fetchApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  FileText,
  Plus,
  Trash2,
  CheckCircle,
  Share2,
  PenTool,
  ArrowRight,
  Info,
  Sparkles,
  X,
  Archive,
  Play,
  Edit,
  ExternalLink
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PERIOD_LABELS as PKG_PERIOD_LABELS } from "@/lib/geracaoDigital/packagePricing";
import { Switch } from "@/components/ui/switch";
import {
  type PaymentTerm,
  type PaymentTermTipo,
  type PaymentTermConfig,
  type ProposalPaymentTerms,
  type DescontoConcedido,
  PAYMENT_TERM_TIPOS,
  computePaymentBreakdown,
  termAplicaA,
  APLICA_A_LABELS,
  SETUP_LABEL,
  SETUP_JUSTIFICATION
} from "@/lib/geracaoDigital/paymentTerms";
import { GeracaoDigitalNegotiationBoard, type NegotiationFinalizeResult } from "@/components/GeracaoDigitalNegotiationBoard";
import { GenerateContractDialog } from "./GeracaoDigitalContracts/GenerateContractDialog";
import { ShareProposalDialog } from "./GeracaoDigitalProposals/ShareProposalDialog";
import { useProposalWizard } from "@/hooks/useProposalWizard";
import { ProposalWizard } from "@/components/geracaoDigital/ProposalWizard";

interface ProposalItem {
  product_id?: string | null;
  descricao: string;
  categoria: "gd" | "vexo";
  valor: number;
  valor_vp?: number | null;
  recorrencia: "mensal" | "unico";
  periodo?: string | null;
  meses?: number | null;
  total_periodo?: number | null;
  valor_tabela?: number | null;
}

interface Proposal {
  id: string;
  prospect_name: string;
  itens: ProposalItem[];
  valor_total: number;
  valor_vp?: number | null;
  valor_setup: number;
  valor_recorrente: number;
  condicoes: string;
  status: "rascunho" | "enviada" | "aceita";
  payment_link?: string;
  assinatura?: string;
  signer_name?: string;
  signed_at?: string;
  signer_ip?: string;
  termo_aceite?: string;
  created_at: string;
  cobrar_setup?: boolean;
  valor_setup_vexo?: number | null;
  condicoes_pagamento?: ProposalPaymentTerms | null;
  periodo_plano?: string | null;
  validade_ate?: string | null;
  valor_apos_validade?: number | null;
  observacao_validade?: string | null;
  descontos_concedidos?: DescontoConcedido[] | null;
  arquivada?: boolean;
  carencia_dias?: number | null;
  package_id?: string | null;
  package_vexo_id?: string | null;
  pacotes_ofertados?: string[] | null;
}

const PERIODO_OPTIONS = [
  { value: "", label: "— não definido —" },
  { value: "mensal", label: "Mensal" },
  { value: "trimestral", label: "Trimestral" },
  { value: "semestral", label: "Semestral" },
  { value: "anual", label: "Anual" },
];

export default function GeracaoDigitalProposals() {
  const { isAuthenticated, getIdToken, clientId } = useAuth();
  const navigate = useNavigate();

  // Proposals State
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Proposal form editor state
  const [prospectName, setProspectName] = useState<string>("");
  const [condicoes, setCondicoes] = useState<string>("");
  const [items, setItems] = useState<ProposalItem[]>([]);
  const [paymentLink, setPaymentLink] = useState<string>("");
  const [editPackageId, setEditPackageId] = useState<string>("");
  const [editPackageVexoId, setEditPackageVexoId] = useState<string>("");
  const [editPacotesOfertados, setEditPacotesOfertados] = useState<string[]>([]);
  const [editValorVp, setEditValorVp] = useState<number>(0);
  const [vpActive, setVpActive] = useState<boolean>(false);
  const [editVexoAvulsoIds, setEditVexoAvulsoIds] = useState<Record<string, boolean>>({});
  const [editGdAvulsoIds, setEditGdAvulsoIds] = useState<Record<string, boolean>>({});
  const [editCarencia, setEditCarencia] = useState<string>("");

  // Setup Vexo opcional
  const [cobrarSetup, setCobrarSetup] = useState<boolean>(false);
  const [valorSetupVexo, setValorSetupVexo] = useState<number>(0);

  // Condições de pagamento
  const [availableTerms, setAvailableTerms] = useState<PaymentTerm[]>([]);
  const [offeredTermIds, setOfferedTermIds] = useState<string[]>([]);

  // Mesa de negociação
  const [isNegotiating, setIsNegotiating] = useState<boolean>(false);

  // Arquivadas
  const [showArchived, setShowArchived] = useState<boolean>(false);

  // Catalog catalogs (shared between wizard and proposal editor)
  const [availablePackages, setAvailablePackages] = useState<any[]>([]);
  const [vexoProducts, setVexoProducts] = useState<any[]>([]);
  const [gdProducts, setGdProducts] = useState<any[]>([]);

  // Hook customizado para gerenciar estado/ações do wizard de criação de proposta
  const wizardState = useProposalWizard({
    clientId,
    getIdToken,
    availablePackages,
    vexoProducts,
    gdProducts,
    loadProposals,
    toast
  });

  const {
    showNewForm,
    setShowNewForm,
    resetWizard,
    setNewProspect,
    setNewPackageId,
    setNewPackageVexoId,
    setNewPacotesOfertados,
    setNewVexoAvulsoIds,
    setNewGdAvulsoIds,
    setNewCarencia,
    setNewCobrarSetup,
    setNewValorSetup,
    setNewPeriodo,
    setNewValidade,
    setNewCondicoes,
    setNewPaymentLink,
    setEditingProposalId
  } = wizardState;

  const openWizardForEdit = (prop: any) => {
    resetWizard();
    setEditingProposalId(prop.id);
    setNewProspect(prop.prospect_name || "");
    setNewPackageId(prop.package_id || "");
    setNewPackageVexoId(prop.package_vexo_id || "");
    setNewPacotesOfertados(
      Array.isArray(prop.pacotes_ofertados)
        ? prop.pacotes_ofertados
        : [prop.package_id, prop.package_vexo_id].filter(Boolean)
    );
    setNewCarencia(prop.carencia_dias !== null && prop.carencia_dias !== undefined ? String(prop.carencia_dias) : "");
    setNewCobrarSetup(prop.cobrar_setup === true);
    setNewValorSetup(Number(prop.valor_setup_vexo || 0));
    setNewPeriodo(prop.periodo_plano || "mensal");
    setNewValidade(prop.validade_ate ? prop.validade_ate.split("T")[0] : "");
    setNewCondicoes(prop.condicoes || "");
    setNewPaymentLink(prop.payment_link || "");

    const vexoIds: Record<string, boolean> = {};
    const gdIds: Record<string, boolean> = {};

    if (Array.isArray(prop.itens)) {
      prop.itens.forEach((item: any) => {
        if (item.product_id) {
          if (item.categoria === "vexo") {
            vexoIds[item.product_id] = true;
          } else {
            gdIds[item.product_id] = true;
          }
        }
      });
    }
    setNewVexoAvulsoIds(vexoIds);
    setNewGdAvulsoIds(gdIds);
    setShowNewForm(true);
  };

  // Modal de compartilhamento da proposta
  const [showSendModal, setShowSendModal] = useState<boolean>(false);
  // Modal de geração de contrato jurídico
  const [showGenerateContract, setShowGenerateContract] = useState<boolean>(false);

  // Condição de pagamento criada na hora (sem ir na aba Condições)
  const [showInlineTerm, setShowInlineTerm] = useState<boolean>(false);
  const [inlineTerm, setInlineTerm] = useState<{ nome: string; tipo: PaymentTermTipo; config: PaymentTermConfig; aplica_a?: "setup" | "mensalidade"; salvarTemplate: boolean }>({
    nome: "", tipo: "avista_desconto", config: {}, salvarTemplate: false
  });
  const [adhocTerms, setAdhocTerms] = useState<PaymentTerm[]>([]);

  // Período do plano e validade da proposta
  const [periodoPlano, setPeriodoPlano] = useState<string>("");
  const [validadeAte, setValidadeAte] = useState<string>("");
  const [valorAposValidade, setValorAposValidade] = useState<string>("");
  const [observacaoValidade, setObservacaoValidade] = useState<string>("");

  // Signature form state
  const [signerName, setSignerName] = useState<string>("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Load proposals
  useEffect(() => {
    if (isAuthenticated) {
      loadProposals();
      loadPaymentTerms();
      loadPackagesCatalog();
      loadVexoProductsCatalog();
      loadGdProductsCatalog();
    }
  }, [isAuthenticated, clientId]);

  async function loadPackagesCatalog() {
    try {
      const token = await getIdToken();
      const headers: HeadersInit = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetchApi(`/api/gd/packages?client_id=${clientId || ""}`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.success) setAvailablePackages(data.data || []);
      }
    } catch (err) {
      console.error("Erro ao carregar pacotes:", err);
    }
  }

  async function loadGdProductsCatalog() {
    try {
      const token = await getIdToken();
      const headers: HeadersInit = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetchApi(`/api/gd/products?client_id=${clientId || ""}`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.success) setGdProducts(data.data || []);
      }
    } catch (err) {
      console.error("Erro ao carregar módulos GD:", err);
    }
  }

  async function loadVexoProductsCatalog() {
    try {
      const token = await getIdToken();
      const headers: HeadersInit = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetchApi(`/api/gd/vexo-products?client_id=${clientId || ""}`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.success) setVexoProducts(data.data || []);
      }
    } catch (err) {
      console.error("Erro ao carregar módulos Vexo:", err);
    }
  }

  // Sync combos/avulsos selections to items list reactively
  useEffect(() => {
    if (!selectedProposal) return;

    const finalItems: ProposalItem[] = [];

    // 1. Add GD package item
    const selectedGdPkg = availablePackages.find(p => p.id === editPackageId && (p.tipo === "gd" || !p.tipo));
    if (selectedGdPkg) {
      const val = Number(selectedGdPkg.valor || 0);
      const PERIOD_MONTHS: Record<string, number> = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };
      const meses = selectedGdPkg.periodo === "unico" ? null : (PERIOD_MONTHS[selectedGdPkg.periodo] ?? 1);
      const mensalidade = meses ? Math.round((val / meses) * 100) / 100 : val;
      const valorTabela = Number(selectedGdPkg.valor_tabela || 0);

      finalItems.push({
        product_id: null,
        descricao: `Pacote: ${selectedGdPkg.nome} (${selectedGdPkg.periodo === "unico" ? "Setup" : "Recorrência"})`,
        categoria: "gd",
        valor: mensalidade,
        recorrencia: meses ? "mensal" : "unico",
        periodo: selectedGdPkg.periodo,
        meses,
        total_periodo: meses ? val : null,
        valor_tabela: valorTabela > val ? valorTabela : null
      });

      if (Array.isArray(selectedGdPkg.produtos_incluidos)) {
        selectedGdPkg.produtos_incluidos.forEach((p: any) => {
          finalItems.push({
            product_id: p.product_id || null,
            descricao: p.nome,
            categoria: "gd",
            valor: 0,
            recorrencia: "mensal"
          });
        });
      }
    }

    // 2. Add Vexo package item
    const selectedVexoPkg = availablePackages.find(p => p.id === editPackageVexoId && p.tipo === "vexo");
    if (selectedVexoPkg) {
      const val = Number(selectedVexoPkg.valor || 0);
      const PERIOD_MONTHS: Record<string, number> = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };
      const meses = selectedVexoPkg.periodo === "unico" ? null : (PERIOD_MONTHS[selectedVexoPkg.periodo] ?? 1);
      const mensalidade = meses ? Math.round((val / meses) * 100) / 100 : val;
      const valorTabela = Number(selectedVexoPkg.valor_tabela || 0);

      finalItems.push({
        product_id: null,
        descricao: `Pacote Vexo: ${selectedVexoPkg.nome} (${selectedVexoPkg.periodo === "unico" ? "Setup" : "Recorrência"})`,
        categoria: "vexo",
        valor: mensalidade,
        recorrencia: meses ? "mensal" : "unico",
        periodo: selectedVexoPkg.periodo,
        meses,
        total_periodo: meses ? val : null,
        valor_tabela: valorTabela > val ? valorTabela : null
      });

      if (Array.isArray(selectedVexoPkg.produtos_incluidos)) {
        selectedVexoPkg.produtos_incluidos.forEach((p: any) => {
          finalItems.push({
            product_id: p.product_id || null,
            descricao: `Módulo: ${p.nome}`,
            categoria: "vexo",
            valor: 0,
            recorrencia: "mensal"
          });
        });
      }
    }

    // 3. Add Vexo avulso modules
    Object.entries(editVexoAvulsoIds).forEach(([id, checked]) => {
      if (checked) {
        const prod = vexoProducts.find(p => p.id === id);
        if (prod) {
          finalItems.push({
            product_id: prod.id,
            descricao: `Vexo OS: ${prod.nome}`,
            categoria: "vexo",
            valor: Number(prod.valor || 0),
            recorrencia: prod.recorrencia || "mensal"
          });
        }
      }
    });


    // 3b. Add GD avulso modules
    Object.entries(editGdAvulsoIds).forEach(([id, checked]) => {
      if (checked) {
        const prod = gdProducts.find(p => p.id === id);
        if (prod) {
          finalItems.push({
            product_id: prod.id,
            descricao: `GD: ${prod.nome}`,
            categoria: "gd",
            valor: Number(prod.valor_padrao || 0),
            recorrencia: prod.recorrencia || "mensal"
          });
        }
      }
    });
    // 4. Keep legacy items (manually edited items with valor > 0 that are not packages)
    const legacyItems = items.filter(item => {
      return (item.categoria === "gd" && Number(item.valor || 0) > 0 && !item.descricao?.startsWith("Pacote:") && !item.descricao?.startsWith("GD:")) ||
             (item.categoria === "vexo" && Number(item.valor || 0) > 0 && item.product_id === null && !item.descricao?.startsWith("Pacote Vexo:"));
    });
    finalItems.push(...legacyItems);

    const serialize = (arr: any[]) => JSON.stringify(arr.map(i => ({ d: i.descricao, v: i.valor })));
    if (serialize(finalItems) !== serialize(items)) {
      setItems(finalItems);
    }
  }, [editPackageId, editPackageVexoId, editVexoAvulsoIds, editGdAvulsoIds, availablePackages, vexoProducts, gdProducts, selectedProposal]);

  async function loadPaymentTerms() {
    try {
      const token = await getIdToken();
      const headers: HeadersInit = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetchApi(`/api/gd/payment-terms?client_id=${clientId || ""}`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setAvailableTerms((data.data || []).filter((t: PaymentTerm) => t.ativo));
        }
      }
    } catch (err) {
      console.error("Erro ao carregar condições de pagamento:", err);
    }
  }

  async function loadProposals() {
    try {
      setIsLoading(true);
      setError(null);
      const token = await getIdToken();
      const headers: HeadersInit = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetchApi(`/api/gd/proposals?client_id=${clientId || ""}`, { headers });
      if (!res.ok) {
        throw new Error(`Falha ao buscar propostas comerciais (Status ${res.status}).`);
      }
      const data = await res.json();
      if (data.success) {
        setProposals(data.data);
        if (data.data.length > 0) {
          selectProposal(data.data[0]);
        }
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Erro desconhecido ao carregar propostas.");
      toast({
        title: "Erro ao Carregar",
        description: "Não foi possível carregar as propostas de pré-vendas.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  }

  const selectProposal = (prop: Proposal) => {
    setSelectedProposal(prop);
    setProspectName(prop.prospect_name);
    setCondicoes(prop.condicoes);
    setItems(Array.isArray(prop.itens) ? prop.itens : []);
    setSignerName(prop.signer_name || "");
    setPaymentLink(prop.payment_link || "");
    setCobrarSetup(prop.cobrar_setup === true);
    setValorSetupVexo(Number(prop.valor_setup_vexo || 0));
    setVpActive(!!prop.valor_vp);
    setEditValorVp(Number(prop.valor_vp || 0));
    setOfferedTermIds(
      Array.isArray(prop.condicoes_pagamento?.ofertadas)
        ? prop.condicoes_pagamento!.ofertadas.map((t) => t.id)
        : []
    );
    setAdhocTerms(
      Array.isArray(prop.condicoes_pagamento?.ofertadas)
        ? prop.condicoes_pagamento!.ofertadas.filter((t) => String(t.id).startsWith("adhoc-"))
        : []
    );
    setPeriodoPlano(prop.periodo_plano || "");
    setValidadeAte(prop.validade_ate ? prop.validade_ate.slice(0, 10) : "");
    setValorAposValidade(
      prop.valor_apos_validade !== null && prop.valor_apos_validade !== undefined
        ? String(prop.valor_apos_validade)
        : ""
    );
    setObservacaoValidade(prop.observacao_validade || "");

    setEditPackageId(prop.package_id || "");
    setEditPackageVexoId(prop.package_vexo_id || "");
    setEditPacotesOfertados(
      Array.isArray((prop as any).pacotes_ofertados)
        ? (prop as any).pacotes_ofertados
        : [prop.package_id, prop.package_vexo_id].filter(Boolean) as string[]
    );
    const avulsosMap: Record<string, boolean> = {};
    if (Array.isArray(prop.itens)) {
      prop.itens.forEach((item) => {
        if (item.categoria === "vexo" && item.product_id && !item.descricao?.startsWith("Pacote Vexo")) {
          avulsosMap[item.product_id] = true;
        }
      });
    }
    setEditVexoAvulsoIds(avulsosMap);
    const gdAvulsosMap: Record<string, boolean> = {};
    if (Array.isArray(prop.itens)) {
      prop.itens.forEach((item) => {
        if (item.categoria === "gd" && item.product_id && item.descricao?.startsWith("GD:")) {
          gdAvulsosMap[item.product_id] = true;
        }
      });
    }
    setEditGdAvulsoIds(gdAvulsosMap);
    setEditCarencia(
      prop.carencia_dias !== null && prop.carencia_dias !== undefined ? String(prop.carencia_dias) : ""
    );
  };

  // Live total calculations
  const setupTotal = items
    .filter((i) => i.recorrencia === "unico")
    .reduce((sum, i) => sum + Number(i.valor || 0), 0);

  const recurringTotal = items
    .filter((i) => i.recorrencia === "mensal")
    .reduce((sum, i) => sum + Number(i.valor || 0), 0);

  const setupVexoValue = cobrarSetup ? Number(valorSetupVexo || 0) : 0;
  const grandTotal = setupTotal + recurringTotal + setupVexoValue;

  const offeredTerms = [...availableTerms, ...adhocTerms].filter((t) => offeredTermIds.includes(t.id));

  const toggleOfferedTerm = (termId: string) => {
    setOfferedTermIds((prev) =>
      prev.includes(termId) ? prev.filter((id) => id !== termId) : [...prev, termId]
    );
  };

  // Add Item to editor
  const handleAddItem = () => {
    const newItem: ProposalItem = {
      descricao: "Novo Serviço Comercial",
      categoria: "gd",
      valor: 1000.0,
      recorrencia: "mensal"
    };
    setItems((prev) => [...prev, newItem]);
  };

  // Remove Item from editor
  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  // Update item field
  const handleUpdateItemField = (index: number, field: keyof ProposalItem, value: any) => {
    setItems((prev) =>
      prev.map((item, idx) => {
        if (idx === index) {
          return { ...item, [field]: value };
        }
        return item;
      })
    );
  };

  // Cria condição na hora: aplica na proposta; salvar como template é opcional
  const handleCreateInlineTerm = async () => {
    if (!inlineTerm.nome.trim()) {
      toast({ title: "Nome obrigatório", description: "Dê um nome à condição.", variant: "destructive" });
      return;
    }
    let created: PaymentTerm | null = null;
    if (inlineTerm.salvarTemplate) {
      try {
        const token = await getIdToken();
        const headers: HeadersInit = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetchApi(`/api/gd/payment-terms`, {
          method: "POST",
          headers,
          body: JSON.stringify({ client_id: clientId, nome: inlineTerm.nome, tipo: inlineTerm.tipo, config: inlineTerm.config, aplica_a: inlineTerm.aplica_a || "setup" })
        });
        if (!res.ok) throw new Error("Erro ao salvar condição como template.");
        const data = await res.json();
        created = data.data;
        setAvailableTerms((prev) => [...prev, created!]);
      } catch (err: any) {
        console.error(err);
        toast({ title: "Erro", description: err.message, variant: "destructive" });
        return;
      }
    } else {
      created = {
        id: `adhoc-${Date.now()}`,
        nome: inlineTerm.nome.trim(),
        tipo: inlineTerm.tipo,
        config: inlineTerm.config,
        aplica_a: inlineTerm.aplica_a || "setup",
        ativo: true
      };
      setAdhocTerms((prev) => [...prev, created!]);
    }
    setOfferedTermIds((prev) => [...prev, created!.id]);
    setShowInlineTerm(false);
    setInlineTerm({ nome: "", tipo: "avista_desconto", config: {}, aplica_a: "setup", salvarTemplate: false });
    toast({ title: "Condição aplicada", description: created.nome });
  };

  const updateInlineConfig = (field: keyof PaymentTermConfig, value: any) => {
    setInlineTerm((prev) => ({ ...prev, config: { ...prev.config, [field]: value } }));
  };

  // Fecha a negociação: grava concessões e abre a proposta pública final
  const handleFinalizeNegotiation = async (result: NegotiationFinalizeResult) => {
    if (!selectedProposal) return;
    try {
      const token = await getIdToken();
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const isento = result.descontos.some((d) => d.tipo === "isencao_setup");
      // Payload completo: inclui os campos editados na tela (condicoes, prospect,
      // período, validade) para a negociação não descartar edições pendentes.
      const body = {
        client_id: clientId,
        prospect_name: prospectName,
        itens: items,
        condicoes,
        payment_link: paymentLink,
        cobrar_setup: cobrarSetup,
        valor_setup_vexo: isento ? 0 : (cobrarSetup ? Number(valorSetupVexo || 0) : null),
        descontos_concedidos: result.descontos,
        meio_pagamento: result.meioPagamento,
        periodo_plano: (() => {
          const gdPkg = availablePackages.find((p: any) => p.id === editPackageId && (p.tipo === "gd" || !p.tipo));
          const vexoPkg = availablePackages.find((p: any) => p.id === editPackageVexoId && p.tipo === "vexo");
          return gdPkg?.periodo || vexoPkg?.periodo || selectedProposal.periodo_plano || "mensal";
        })(),
        validade_ate: validadeAte ? new Date(`${validadeAte}T23:59:59`).toISOString() : null,
        valor_apos_validade: valorAposValidade !== "" ? Number(valorAposValidade) : null,
        observacao_validade: observacaoValidade || null,
        carencia_dias: editCarencia !== "" ? Number(editCarencia) : null,
        condicoes_pagamento: {
          ofertadas: offeredTerms,
          escolhida: selectedProposal.condicoes_pagamento?.escolhida ?? null
        }
      };
      const res = await fetchApi(`/api/gd/proposals/${selectedProposal.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error("Erro ao gravar as concessões da negociação.");

      setIsNegotiating(false);
      if (isento) setValorSetupVexo(0);
      if (result.carenciaDias) setEditCarencia(String(result.carenciaDias));
      toast({ title: "Negociação registrada", description: "Concessões gravadas — compartilhe o link com o cliente." });
      setShowSendModal(true);
      loadProposals();
    } catch (err: any) {
      console.error(err);
      toast({ title: "Erro", description: err.message || "Falha ao fechar a negociação.", variant: "destructive" });
    }
  };

  // Save proposal updates
  const handleSaveProposal = async () => {
    if (!selectedProposal) return;
    try {
      const token = await getIdToken();
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      // Construct finalItems array
      const finalItems: any[] = [];

      // 1. Add GD package item
      const selectedGdPkg = availablePackages.find(p => p.id === editPackageId && (p.tipo === "gd" || !p.tipo));
      if (selectedGdPkg) {
        const val = Number(selectedGdPkg.valor || 0);
        const PERIOD_MONTHS: Record<string, number> = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };
        const meses = selectedGdPkg.periodo === "unico" ? null : (PERIOD_MONTHS[selectedGdPkg.periodo] ?? 1);
        const mensalidade = meses ? Math.round((val / meses) * 100) / 100 : val;
        const valorTabela = Number(selectedGdPkg.valor_tabela || 0);

        finalItems.push({
          product_id: null,
          descricao: `Pacote: ${selectedGdPkg.nome} (${selectedGdPkg.periodo === "unico" ? "Setup" : "Recorrência"})`,
          categoria: "gd",
          valor: mensalidade,
          recorrencia: meses ? "mensal" : "unico",
          periodo: selectedGdPkg.periodo,
          meses,
          total_periodo: meses ? val : null,
          valor_tabela: valorTabela > val ? valorTabela : null
        });

        if (Array.isArray(selectedGdPkg.produtos_incluidos)) {
          selectedGdPkg.produtos_incluidos.forEach((p: any) => {
            const isVexo = p.origem === "vexo";
            finalItems.push({
              product_id: p.product_id || null,
              descricao: isVexo ? `Módulo: ${p.nome}` : p.nome,
              categoria: isVexo ? "vexo" : "gd",
              valor: 0,
              recorrencia: "mensal"
            });
          });
        }
      }

      // 2. Add Vexo package item
      const selectedVexoPkg = availablePackages.find(p => p.id === editPackageVexoId && p.tipo === "vexo");
      if (selectedVexoPkg) {
        const val = Number(selectedVexoPkg.valor || 0);
        const PERIOD_MONTHS: Record<string, number> = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };
        const meses = selectedVexoPkg.periodo === "unico" ? null : (PERIOD_MONTHS[selectedVexoPkg.periodo] ?? 1);
        const mensalidade = meses ? Math.round((val / meses) * 100) / 100 : val;
        const valorTabela = Number(selectedVexoPkg.valor_tabela || 0);

        finalItems.push({
          product_id: null,
          descricao: `Pacote Vexo: ${selectedVexoPkg.nome} (${selectedVexoPkg.periodo === "unico" ? "Setup" : "Recorrência"})`,
          categoria: "vexo",
          valor: mensalidade,
          recorrencia: meses ? "mensal" : "unico",
          periodo: selectedVexoPkg.periodo,
          meses,
          total_periodo: meses ? val : null,
          valor_tabela: valorTabela > val ? valorTabela : null
        });

        if (Array.isArray(selectedVexoPkg.produtos_incluidos)) {
          selectedVexoPkg.produtos_incluidos.forEach((p: any) => {
            finalItems.push({
              product_id: p.product_id || null,
              descricao: `Módulo: ${p.nome}`,
              categoria: "vexo",
              valor: 0,
              recorrencia: "mensal"
            });
          });
        }
      }

      // 3. Add Vexo avulso modules
      Object.entries(editVexoAvulsoIds).forEach(([id, checked]) => {
        if (checked) {
          const prod = vexoProducts.find(p => p.id === id);
          if (prod) {
            finalItems.push({
              product_id: prod.id,
              descricao: `Vexo OS: ${prod.nome}`,
              categoria: "vexo",
              valor: Number(prod.valor || 0),
              recorrencia: prod.recorrencia || "mensal"
            });
          }
        }
      });


      // 3b. Add GD avulso modules
      Object.entries(editGdAvulsoIds).forEach(([id, checked]) => {
        if (checked) {
          const prod = gdProducts.find(p => p.id === id);
          if (prod) {
            finalItems.push({
              product_id: prod.id,
              descricao: `GD: ${prod.nome}`,
              categoria: "gd",
              valor: Number(prod.valor_padrao || 0),
              recorrencia: prod.recorrencia || "mensal"
            });
          }
        }
      });
      // 4. Keep legacy items (manually edited items with valor > 0 that are not packages)
      const legacyItems = items.filter(item => {
        return (item.categoria === "gd" && Number(item.valor || 0) > 0 && !item.descricao?.startsWith("Pacote:") && !item.descricao?.startsWith("GD:")) ||
               (item.categoria === "vexo" && Number(item.valor || 0) > 0 && item.product_id === null && !item.descricao?.startsWith("Pacote Vexo:"));
      });
      finalItems.push(...legacyItems);

      const body = {
        client_id: clientId,
        prospect_name: prospectName,
        package_id: editPackageId || null,
        pacotes_ofertados: editPacotesOfertados,
        package_vexo_id: editPackageVexoId || null,
        itens: finalItems,
        condicoes,
        payment_link: paymentLink,
        cobrar_setup: cobrarSetup,
        valor_setup_vexo: cobrarSetup ? Number(valorSetupVexo || 0) : selectedProposal.valor_setup_vexo ?? null,
        condicoes_pagamento: {
          ofertadas: offeredTerms,
          escolhida: selectedProposal.condicoes_pagamento?.escolhida ?? null
        },
        periodo_plano: (() => {
          const gdPkg = availablePackages.find((p: any) => p.id === editPackageId && (p.tipo === "gd" || !p.tipo));
          const vexoPkg = availablePackages.find((p: any) => p.id === editPackageVexoId && p.tipo === "vexo");
          return gdPkg?.periodo || vexoPkg?.periodo || selectedProposal.periodo_plano || "mensal";
        })(),
        validade_ate: validadeAte ? new Date(`${validadeAte}T23:59:59`).toISOString() : null,
        valor_apos_validade: valorAposValidade !== "" ? Number(valorAposValidade) : null,
        observacao_validade: observacaoValidade || null,
        carencia_dias: editCarencia !== "" ? Number(editCarencia) : null,
        valor_vp: vpActive ? Number(editValorVp || 0) : null
      };

      const res = await fetchApi(`/api/gd/proposals/${selectedProposal.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Erro ao atualizar proposta comercial no servidor.");
      }

      const data = await res.json();
      if (data.success) {
        toast({
          title: "Proposta Salva",
          description: "Os itens e condições foram atualizados e o faturamento recalculado."
        });
        loadProposals();
      }
    } catch (err: any) {
      console.error(err);
      toast({
        title: "Erro ao Salvar",
        description: err.message || "Falha de comunicação com o servidor ao salvar proposta.",
        variant: "destructive"
      });
    }
  };

  // Arquivar / desarquivar (qualquer status — preserva o histórico)
  const handleArchiveProposal = async (arquivar: boolean) => {
    if (!selectedProposal) return;
    try {
      const token = await getIdToken();
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetchApi(`/api/gd/proposals/${selectedProposal.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ client_id: clientId, itens: items, arquivada: arquivar })
      });
      if (!res.ok) throw new Error("Erro ao arquivar proposta.");
      toast({
        title: arquivar ? "Proposta Arquivada" : "Proposta Restaurada",
        description: arquivar ? "Ela saiu da lista principal — use 'mostrar arquivadas' para recuperar." : "De volta à lista principal."
      });
      setSelectedProposal(null);
      loadProposals();
    } catch (err: any) {
      console.error(err);
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };



  // Delete proposal
  const handleDeleteProposal = async () => {
    if (!selectedProposal) return;
    if (!window.confirm("Tem certeza que deseja excluir este rascunho de proposta comercial? Esta ação não pode ser desfeita.")) {
      return;
    }
    try {
      const token = await getIdToken();
      const headers: HeadersInit = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetchApi(`/api/gd/proposals/${selectedProposal.id}?client_id=${clientId || ""}`, {
        method: "DELETE",
        headers
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Erro ao excluir proposta comercial no servidor.");
      }

      const data = await res.json();
      if (data.success) {
        toast({
          title: "Proposta Excluída",
          description: "A proposta comercial foi deletada com sucesso."
        });
        setSelectedProposal(null);
        loadProposals();
      }
    } catch (err: any) {
      console.error(err);
      toast({
        title: "Erro ao Excluir",
        description: err.message || "Falha de comunicação com o servidor ao excluir proposta.",
        variant: "destructive"
      });
    }
  };

  // Canvas drawing handlers
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "#ec4899"; // pink-500
    ctx.lineWidth = 3;
    ctx.lineCap = "round";

    const rect = canvas.getBoundingClientRect();
    const x = ('touches' in e) ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = ('touches' in e) ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = ('touches' in e) ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = ('touches' in e) ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  // Submit Signature/Aceite
  const handleSignProposal = async () => {
    if (!selectedProposal) return;
    if (!signerName.trim()) {
      toast({
        title: "Nome Obrigatório",
        description: "Por favor, preencha o nome do assinante responsável.",
        variant: "destructive"
      });
      return;
    }

    let signatureBase64 = "";
    const canvas = canvasRef.current;
    if (canvas) {
      signatureBase64 = canvas.toDataURL("image/png");
    }

    try {
      const token = await getIdToken();
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const body = {
        assinatura: signatureBase64 || signerName,
        signer_name: signerName
      };

      const res = await fetchApi(`/api/gd/proposals/${selectedProposal.id}/assinar`, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        throw new Error("Erro ao registrar assinatura no servidor.");
      }

      const data = await res.json();
      if (data.success) {
        toast({
          title: "Proposta Assinada",
          description: "O aceite comercial foi registrado e a proposta foi fechada com sucesso!"
        });
        loadProposals();
      }
    } catch (err) {
      console.error(err);
      toast({
        title: "Erro ao Assinar",
        description: "Falha de comunicação com o servidor ao assinar a proposta.",
        variant: "destructive"
      });
    }
  };

  // Send to client actual trigger
  const handleSendToClient = async () => {
    if (!selectedProposal) return;
    try {
      const token = await getIdToken();
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetchApi(`/api/gd/proposals/${selectedProposal.id}/enviar`, {
        method: "POST",
        headers,
        body: JSON.stringify({ client_id: clientId })
      });

      if (!res.ok) {
        throw new Error("Erro ao marcar proposta como enviada.");
      }

      const shareLink = `${window.location.origin}/proposta/${selectedProposal.id}`;
      navigator.clipboard.writeText(shareLink);

      toast({
        title: "Enviada & Link Copiado",
        description: "Proposta marcada como 'enviada' e link de acesso copiado!"
      });
      setShowSendModal(true);
      loadProposals();
    } catch (err) {
      console.error(err);
      toast({
        title: "Erro ao Enviar",
        description: "Falha ao registrar envio no servidor.",
        variant: "destructive"
      });
    }
  };
  return (
    <PageShell
      title="Propostas Comerciais GD"
      subtitle="Editor de itens, termos de aceite comercial e assinatura eletrônica para fechamento de contratos."
      icon={FileText}
    >
      <GeracaoDigitalTabs />
      <div className="w-full min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 rounded-3xl p-6 border border-slate-200 dark:border-white/10 shadow-sm relative overflow-hidden">

        {/* Glow Effects */}
        <div className="absolute top-0 right-0 h-96 w-96 bg-purple-50 dark:bg-purple-950/20 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 h-96 w-96 bg-pink-50 dark:bg-pink-950/20 rounded-full blur-[100px] pointer-events-none" />

        {/* Loading / Error states */}
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <span className="animate-spin h-8 w-8 border-4 border-purple-600 border-t-transparent rounded-full" />
          </div>
        ) : error ? (
          <Card className="bg-red-50 border-red-200 text-center max-w-lg mx-auto py-12 relative z-10 shadow-sm">
            <CardContent className="space-y-4">
              <Info className="h-12 w-12 text-red-500 mx-auto" />
              <h3 className="text-lg font-bold text-slate-850 dark:text-white">Falha na Conexão</h3>
              <p className="text-xs text-slate-650 dark:text-slate-200">
                {error}
              </p>
              <Button onClick={loadProposals} className="bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs px-6 py-2 rounded-xl">
                Tentar Novamente
              </Button>
            </CardContent>
          </Card>
        ) : proposals.length === 0 ? (
          <Card className="bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-white/10 text-center max-w-lg mx-auto py-12 relative z-10 shadow-sm">
            <CardContent className="space-y-4">
              <FileText className="h-12 w-12 text-slate-400 mx-auto" />
              <h3 className="text-lg font-bold text-slate-800 dark:text-white">Nenhuma Proposta Gerada</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Inicie uma apresentação comercial a partir da aba "Geração Digital" e escolha um pacote — ou crie uma proposta direta abaixo.
              </p>
              <Button
                size="sm"
                onClick={() => { setShowNewForm(true); resetWizard(); setProposals([]); }}
                className="bg-gradient-to-r from-purple-700 to-indigo-600 hover:opacity-90 text-white font-bold text-xs"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Nova Proposta
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-4 relative z-10">
            {showNewForm && (
              <div className="lg:col-span-4">
                <ProposalWizard
                  onClose={() => { setShowNewForm(false); resetWizard(); }}
                  availablePackages={availablePackages}
                  vexoProducts={vexoProducts}
                  gdProducts={gdProducts}
                  wizardState={wizardState}
                  toast={toast}
                />
              </div>
            )}

            {/* Sidebar proposals list */}
            <div className="space-y-3 lg:col-span-1">
              <div className="flex items-center justify-between px-2 mb-2">
                <h3 className="text-xs font-mono font-bold text-purple-600 uppercase tracking-widest">Simulações Recentes</h3>
              </div>
              <Button
                size="sm"
                onClick={() => { setShowNewForm(true); resetWizard(); }}
                className="w-full bg-gradient-to-r from-purple-700 to-indigo-600 hover:opacity-90 text-white font-bold text-xs mb-1"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Nova Proposta
              </Button>
              <label className="flex items-center gap-2 px-2 pb-1 text-[10px] text-slate-500 font-medium cursor-pointer dark:text-slate-400">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => { setShowArchived(e.target.checked); setSelectedProposal(null); }}
                  className="accent-purple-600"
                />
                mostrar arquivadas
              </label>
              {proposals.filter((p) => (showArchived ? p.arquivada === true : p.arquivada !== true)).length === 0 && (
                <p className="text-[10px] text-slate-400 italic px-2">
                  {showArchived ? "Nenhuma proposta arquivada." : "Nenhuma proposta ativa."}
                </p>
              )}
              {proposals.filter((p) => (showArchived ? p.arquivada === true : p.arquivada !== true)).map((prop) => (
                <div
                  key={prop.id}
                  className={cn(
                    "w-full text-left p-4 rounded-xl border transition-all space-y-2 group shadow-sm flex flex-col justify-between",
                    selectedProposal?.id === prop.id
                      ? "bg-slate-50 dark:bg-slate-850 border-purple-500/50 dark:border-purple-550/50 shadow-md shadow-purple-600/5"
                      : "bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-white/10 hover:border-slate-350 dark:hover:border-white/20"
                  )}
                >
                  <div className="cursor-pointer" onClick={() => selectProposal(prop)}>
                    <div className="flex justify-between items-start">
                      <span className="text-xs font-black text-slate-800 dark:text-slate-100 group-hover:text-purple-600 transition-colors leading-tight">
                        {prop.prospect_name}
                      </span>
                      <Badge
                        className={cn(
                          "text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 border-none",
                          prop.status === "aceita"
                            ? "bg-emerald-500 text-white"
                            : prop.status === "enviada"
                            ? "bg-blue-600 text-white"
                            : "bg-amber-600 text-white"
                        )}
                      >
                        {prop.status === "aceita" ? "Fechado" : prop.status === "enviada" ? "Enviada" : "Rascunho"}
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center text-[10px] text-slate-550 dark:text-slate-400 font-mono mt-1">
                      <span>Total Geral</span>
                      <span className="text-slate-850 dark:text-slate-100 font-bold">R$ {prop.valor_total.toLocaleString("pt-BR")}</span>
                    </div>
                  </div>

                  {prop.status !== "aceita" && (
                    <div className="pt-2 border-t border-slate-100 dark:border-white/5 flex gap-1.5">
                      <Button
                        size={"xs" as "sm"}
                        variant="outline"
                        className="w-full text-[10px] border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800 font-semibold"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(`/proposta/${prop.id}`, "_blank");
                        }}
                      >
                        <ExternalLink className="h-3 w-3 mr-1.5" />
                        Abrir Proposta
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Proposal Detail & Editor */}
            {selectedProposal ? (
              <div className="space-y-6 lg:col-span-3">

                {/* Header overview */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-black text-slate-800 dark:text-white">{prospectName}</h2>
                      {selectedProposal.status === "aceita" && (
                        <Badge className="bg-emerald-500 text-white font-bold flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" />
                          Fechado ✔
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 font-mono dark:text-slate-400">ID: {selectedProposal.id}</p>
                  </div>

                  <div className="flex gap-2">
                    {selectedProposal.status === "aceita" && (
                      <Button
                        size="sm"
                        onClick={() => setShowGenerateContract(true)}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold shrink-0"
                      >
                        <FileText className="h-4 w-4 mr-1.5" />
                        Gerar Contrato Jurídico
                      </Button>
                    )}
                    {selectedProposal.status !== "aceita" && (
                      <Button
                        size="sm"
                        onClick={() => openWizardForEdit(selectedProposal)}
                        className="bg-purple-600 hover:bg-purple-500 text-white font-bold shrink-0"
                      >
                        <Edit className="h-4 w-4 mr-1.5" />
                        Gerar/Editar Proposta
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSendToClient}
                      className="border-slate-200 text-slate-700 hover:bg-slate-50 shrink-0 dark:text-slate-200"
                    >
                      <Share2 className="h-4 w-4 mr-1.5" />
                      Enviar ao Cliente
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleArchiveProposal(selectedProposal.arquivada !== true)}
                      className="border-slate-200 text-slate-700 hover:bg-slate-50 shrink-0 dark:text-slate-200"
                    >
                      <Archive className="h-4 w-4 mr-1.5" />
                      {selectedProposal.arquivada === true ? "Desarquivar" : "Arquivar"}
                    </Button>
                    {selectedProposal.status !== "aceita" && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleDeleteProposal}
                        className="bg-rose-600 hover:bg-rose-500 text-white font-bold shrink-0"
                      >
                        <Trash2 className="h-4 w-4 mr-1.5" />
                        Excluir Rascunho
                      </Button>
                    )}
                  </div>
                </div>

                {/* Visualização Consolidada da Proposta (Somente Leitura) */}
                <Card className="bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-white/10 shadow-sm">
                  <CardHeader className="pb-3 border-b border-slate-200 dark:border-white/5">
                    <CardTitle className="text-base font-bold text-slate-800 dark:text-slate-100">
                      Resumo da Proposta Comercial
                    </CardTitle>
                    <CardDescription className="text-[11px] text-slate-500 dark:text-slate-400">
                      Esta é uma visualização consolidada dos itens, valores e condições acordadas. Edições e negociações devem ser feitas na Mesa de Negociação separada.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-6">
                    {/* Ações contextuais internas da Proposta */}
                    <div className="flex gap-2 pb-4 border-b border-slate-150 dark:border-white/5">
                      {selectedProposal.status !== "aceita" && (
                        <Button
                          size="sm"
                          onClick={() => window.open(`/proposta/${selectedProposal.id}`, "_blank")}
                          className="bg-gradient-to-r from-purple-700 to-indigo-600 hover:opacity-90 text-white font-bold"
                        >
                          <ExternalLink className="h-4 w-4 mr-1.5" />
                          Abrir Proposta
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/crm/apresentacao-gd?proposalId=${selectedProposal.id}`)}
                        className="border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 font-semibold"
                      >
                        <Play className="h-4 w-4 mr-1.5 text-purple-650" />
                        Iniciar Apresentação
                      </Button>
                    </div>

                    {/* Configuração da Proposta — interativa, editável ao vivo com o cliente */}
                    {selectedProposal.status !== "aceita" && (
                      <div className="p-4 rounded-xl bg-white dark:bg-slate-800/40 border border-purple-200 dark:border-purple-900/30 space-y-4">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-black text-purple-700 dark:text-purple-300 uppercase tracking-wider">Configuração da Proposta</h4>
                          <Button
                            size="sm"
                            onClick={() => setIsNegotiating(true)}
                            className="bg-gradient-to-r from-purple-700 to-indigo-600 hover:opacity-90 text-white font-bold text-xs"
                          >
                            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                            Abrir Mesa de Negociação
                          </Button>
                        </div>

                        {/* 2/3. Venda Casada / Setup de implantação */}
                        <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-slate-100 dark:border-white/5">
                          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
                            <Switch checked={cobrarSetup} onCheckedChange={setCobrarSetup} />
                            Cobrar setup de implantação?
                          </label>
                          {cobrarSetup && (
                            <div className="space-y-1">
                              <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">Valor do Setup (R$)</Label>
                              <Input
                                type="number"
                                value={valorSetupVexo}
                                onChange={(e) => setValorSetupVexo(Number(e.target.value) || 0)}
                                className="bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10 text-xs h-8 w-40 font-mono"
                              />
                            </div>
                          )}
                        </div>

                        {/* 4. Condições de Pagamento (selecionar + criar na hora) */}
                        <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-white/5">
                          <div className="flex items-center justify-between">
                            <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">Condições de Pagamento a Ofertar</Label>
                            <button
                              type="button"
                              onClick={() => setShowInlineTerm((v) => !v)}
                              className="text-[10px] font-bold text-purple-650 dark:text-purple-300 hover:underline"
                            >
                              {showInlineTerm ? "Cancelar" : "+ Criar condição na hora"}
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {[...availableTerms, ...adhocTerms].map((term) => {
                              const isOn = offeredTermIds.includes(term.id);
                              return (
                                <button
                                  key={term.id}
                                  type="button"
                                  onClick={() => toggleOfferedTerm(term.id)}
                                  className={cn(
                                    "px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all",
                                    isOn
                                      ? "bg-purple-600 text-white border-purple-500"
                                      : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:border-purple-300"
                                  )}
                                >
                                  {term.nome} · {APLICA_A_LABELS[termAplicaA(term)]}{isOn ? " ✓" : ""}
                                </button>
                              );
                            })}
                            {availableTerms.length === 0 && adhocTerms.length === 0 && (
                              <span className="text-[10px] text-slate-400 italic">Nenhuma condição salva. Crie na hora ou na aba Condições.</span>
                            )}
                          </div>

                          {showInlineTerm && (
                            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-purple-200 dark:border-purple-900/30 space-y-2">
                              <div className="grid gap-2 sm:grid-cols-3">
                                <Input
                                  value={inlineTerm.nome}
                                  onChange={(e) => setInlineTerm((p) => ({ ...p, nome: e.target.value }))}
                                  placeholder='Nome (ex: "Setup 2x boleto")'
                                  className="bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10 text-xs h-8"
                                />
                                <select
                                  value={inlineTerm.tipo}
                                  onChange={(e) => setInlineTerm((p) => ({ ...p, tipo: e.target.value as PaymentTermTipo, config: {} }))}
                                  className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded px-2 text-xs text-slate-850 dark:text-white h-8"
                                >
                                  {PAYMENT_TERM_TIPOS.map((t) => (
                                    <option key={t.value} value={t.value}>{t.label}</option>
                                  ))}
                                </select>
                                <select
                                  value={(inlineTerm as any).aplica_a || "setup"}
                                  onChange={(e) => setInlineTerm((p) => ({ ...(p as any), aplica_a: e.target.value }))}
                                  className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded px-2 text-xs text-slate-850 dark:text-white h-8"
                                >
                                  <option value="setup">Aplica ao Setup</option>
                                  <option value="mensalidade">Aplica à Mensalidade</option>
                                </select>
                              </div>
                              <div className="grid gap-2 sm:grid-cols-3">
                                {inlineTerm.tipo === "avista_desconto" && (
                                  <Input type="number" placeholder="% desconto" value={inlineTerm.config.percentual_desconto ?? ""} onChange={(e) => updateInlineConfig("percentual_desconto", Number(e.target.value) || 0)} className="bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10 text-xs h-8" />
                                )}
                                {(inlineTerm.tipo === "entrada_parcelas" || inlineTerm.tipo === "parcelado_cartao" || inlineTerm.tipo === "boleto_recorrente" || inlineTerm.tipo === "semanal") && (
                                  <Input type="number" placeholder="Nº de parcelas" value={inlineTerm.config.num_parcelas ?? ""} onChange={(e) => updateInlineConfig("num_parcelas", Number(e.target.value) || 1)} className="bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10 text-xs h-8" />
                                )}
                                {inlineTerm.tipo === "entrada_parcelas" && (
                                  <Input type="number" placeholder="Entrada (R$)" value={inlineTerm.config.valor_entrada ?? ""} onChange={(e) => updateInlineConfig("valor_entrada", Number(e.target.value) || 0)} className="bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10 text-xs h-8" />
                                )}
                                {(inlineTerm.tipo === "avista_desconto" || inlineTerm.tipo === "entrada_parcelas") && (
                                  <select value={inlineTerm.config.meio ?? ""} onChange={(e) => updateInlineConfig("meio", e.target.value || undefined)} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded px-2 text-xs text-slate-850 dark:text-white h-8">
                                    <option value="">Meio (opcional)</option>
                                    <option value="pix">PIX</option>
                                    <option value="cartao">Cartão</option>
                                    <option value="boleto">Boleto</option>
                                  </select>
                                )}
                                {inlineTerm.tipo === "custom" && (
                                  <Input value={inlineTerm.config.descricao ?? ""} onChange={(e) => updateInlineConfig("descricao", e.target.value)} placeholder="Descrição livre" className="bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10 text-xs h-8 sm:col-span-2" />
                                )}
                              </div>
                              <div className="flex items-center justify-between">
                                <label className="flex items-center gap-1.5 text-[10px] text-slate-600 dark:text-slate-300 cursor-pointer">
                                  <input type="checkbox" checked={inlineTerm.salvarTemplate} onChange={(e) => setInlineTerm((p) => ({ ...p, salvarTemplate: e.target.checked }))} className="accent-purple-600" />
                                  Salvar como template reutilizável
                                </label>
                                <Button size="sm" onClick={handleCreateInlineTerm} className="bg-purple-600 hover:bg-purple-500 text-white text-xs h-8">Criar e aplicar</Button>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-white/5">
                          <Button size="sm" onClick={handleSaveProposal} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs">
                            Salvar Configuração
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Resumo Financeiro */}
                    {(() => {
                      const tempProposal = {
                        cobrar_setup: cobrarSetup,
                        valor_setup_vexo: valorSetupVexo,
                        package_id: editPackageId || null,
                        package_vexo_id: editPackageVexoId || null,
                        periodo_plano: periodoPlano || "mensal",
                        descontos_concedidos: selectedProposal?.descontos_concedidos || [],
                        itens: items
                      };
                      const calc = calculateProposalValues(tempProposal, availablePackages);

                      return (
                        <div className="grid gap-4 sm:grid-cols-3 bg-slate-50 dark:bg-slate-800 p-4 rounded-xl border border-slate-150 dark:border-slate-700">
                          <div className="space-y-1">
                            <span className="text-[10px] text-slate-500 uppercase font-black tracking-wider block dark:text-slate-400">Taxa de Setup</span>
                            <h4 className="text-lg font-black text-slate-800 dark:text-slate-100 font-mono">
                              {calc.setupFinal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                            </h4>
                          </div>

                          <div className="space-y-1">
                            <span className="text-[10px] text-slate-550 uppercase font-black tracking-wider block dark:text-slate-400">Mensalidade</span>
                            <h4 className="text-lg font-black text-pink-650 font-mono">
                              {calc.mensalidadeFinal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/mês
                            </h4>
                          </div>

                          {(!periodoPlano || periodoPlano === "1") ? (
                            <div className="space-y-1">
                              <span className="text-[10px] text-slate-550 uppercase font-black tracking-wider block dark:text-slate-400">Plano Mensal (Sem fidelidade)</span>
                              <h4 className="text-lg font-black text-indigo-600 font-mono">-</h4>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <span className="text-[10px] text-slate-550 uppercase font-black tracking-wider block dark:text-slate-400">Compromisso do Período</span>
                              <h4 className="text-lg font-black text-indigo-600 font-mono">
                                {calc.compromissoFinal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                              </h4>
                              <span className="text-[9px] text-slate-450 block">Soma recorrente por {calc.mesesPeriodo} meses</span>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Escopo da Proposta */}
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider block">Itens e Serviços Incluídos</h4>
                      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-150 dark:border-slate-700 space-y-3">
                        {(() => {
                          const activeGdPkg = availablePackages.find(p => p.id === editPackageId && (p.tipo === "gd" || !p.tipo));
                          const activeVexoPkg = availablePackages.find(p => p.id === editPackageVexoId && p.tipo === "vexo");
                          const activeAvulsos = Object.entries(editVexoAvulsoIds)
                            .filter(([_, checked]) => checked)
                            .map(([id]) => vexoProducts.find(vp => vp.id === id))
                            .filter(Boolean);

                          if (!activeGdPkg && !activeVexoPkg && activeAvulsos.length === 0) {
                            return <p className="text-xs text-slate-450 italic">Nenhum combo ou módulo selecionado para esta proposta.</p>;
                          }

                          return (
                            <div className="space-y-3">
                              {activeGdPkg && (
                                <div className="space-y-1">
                                  <div className="flex justify-between items-center text-xs font-bold text-slate-850 dark:text-slate-200">
                                    <span>Combo GD: {activeGdPkg.nome}</span>
                                  </div>
                                  <div className="flex flex-wrap gap-1 pl-3 border-l-2 border-purple-300">
                                    {(activeGdPkg.produtos_incluidos || []).map((p: any, idx: number) => (
                                      <Badge key={idx} variant="outline" className="bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-750 text-slate-650 dark:text-slate-350 text-[9px] py-0">{p.nome}</Badge>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {activeVexoPkg && (
                                <div className="space-y-1">
                                  <div className="flex justify-between items-center text-xs font-bold text-slate-850 dark:text-slate-200">
                                    <span>Combo Vexo OS: {activeVexoPkg.nome}</span>
                                  </div>
                                  <div className="flex flex-wrap gap-1 pl-3 border-l-2 border-indigo-300">
                                    {(activeVexoPkg.produtos_incluidos || []).map((p: any, idx: number) => (
                                      <Badge key={idx} variant="outline" className="bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-750 text-slate-650 dark:text-slate-350 text-[9px] py-0">{p.nome}</Badge>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {activeAvulsos.length > 0 && (
                                <div className="space-y-1">
                                  <span className="text-xs font-bold text-slate-855 dark:text-slate-200 block">Módulos Avulsos Extras:</span>
                                  <div className="grid gap-2 pl-3 border-l-2 border-slate-300 dark:border-slate-750">
                                    {activeAvulsos.map((p: any) => (
                                      <div key={p.id} className="flex justify-between items-center text-xs text-slate-650 dark:text-slate-350">
                                        <span>• {p.nome}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Informações Comerciais */}
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider block">Prazos e Validade</h4>
                        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-150 dark:border-slate-700 text-xs space-y-2 text-slate-700 dark:text-slate-300">
                          <p><span className="font-bold text-slate-900 dark:text-slate-200">Período Contratual:</span> {periodoPlano ? periodoPlano.toUpperCase() : "Mensal"}</p>
                          <p><span className="font-bold text-slate-900 dark:text-slate-200">Validade da Proposta:</span> {validadeAte ? new Date(`${validadeAte}T23:59:59`).toLocaleDateString("pt-BR") : "Sem validade definida"}</p>
                          <p><span className="font-bold text-slate-900 dark:text-slate-200">Carência de Pagamento:</span> {editCarencia ? `${editCarencia} dias` : "Imediato na contratação"}</p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider block">Condições de Pagamento Oferecidas</h4>
                        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-150 dark:border-slate-700 text-xs space-y-2 text-slate-700 dark:text-slate-300">
                          {offeredTerms.length === 0 ? (
                            <p className="text-slate-450 italic">Nenhuma condição de pagamento especial oferecida.</p>
                          ) : (
                            <div className="space-y-1">
                              {offeredTerms.map((term) => (
                                <p key={term.id} className="font-semibold">• {term.nome}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                                  {/* Electronic Signature Card */}
                  <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm flex flex-col h-full">
                    <CardHeader>
                      <CardTitle className="text-base font-bold text-slate-800 dark:text-slate-100">Assinatura de Aceite Comercial</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4 flex-grow flex flex-col justify-between">

                      {selectedProposal.status === "aceita" ? (
                        <div className="space-y-4 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 text-center flex-grow flex flex-col justify-center">
                          <CheckCircle className="h-10 w-10 text-emerald-600 mx-auto" />
                          <div className="space-y-1">
                            <h4 className="text-sm font-bold text-slate-800 dark:text-white">Contrato Fechado com Sucesso!</h4>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">Proposta assinada comercialmente por:</p>
                            <span className="text-xs font-mono font-bold text-emerald-600 block">{selectedProposal.signer_name}</span>
                          </div>

                          {selectedProposal.assinatura && selectedProposal.assinatura.startsWith("data:image") && (
                            <div className="h-20 w-full max-w-[200px] bg-slate-100 dark:bg-slate-800 rounded-lg p-1.5 mx-auto flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-700">
                              <img src={selectedProposal.assinatura} alt="Assinatura" className="max-h-full max-w-full object-contain" />
                            </div>
                          )}

                          <div className="text-[9px] text-slate-500 font-mono space-y-0.5 mt-2 dark:text-slate-400">
                            <div>Data/Hora: {selectedProposal.signed_at ? new Date(selectedProposal.signed_at).toLocaleString("pt-BR") : ""}</div>
                            <div>IP do Assinante: {selectedProposal.signer_ip || "Registrado"}</div>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4 flex-grow flex flex-col justify-between">
                          <div className="space-y-4">
                            <div className="text-[10px] text-slate-600 dark:text-slate-350 leading-relaxed bg-slate-50 dark:bg-slate-800/40 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                              <span className="font-bold text-slate-800 block mb-1 uppercase font-mono tracking-wider dark:text-white">Termo de Aceite:</span>
                              "Declaro estar de acordo com os services, valores e condições desta proposta e autorizo o início dos trabalhos."
                            </div>

                            <div className="space-y-2">
                              <Label className="text-[10px] text-slate-500 font-mono dark:text-slate-400">Nome Completo do Assinante</Label>
                              <Input
                                value={signerName}
                                onChange={(e) => setSignerName(e.target.value)}
                                placeholder="Nome do Responsável Legal"
                                className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-100 focus:outline-none"
                              />
                            </div>

                            <div className="space-y-2">
                              <div className="flex justify-between items-center">
                                <Label className="text-[10px] text-slate-500 font-mono dark:text-slate-400">Assine com o Mouse ou Dedo</Label>
                                <button onClick={clearCanvas} className="text-[10px] text-pink-600 hover:text-pink-500 font-semibold font-mono">
                                  Limpar
                                </button>
                              </div>

                              <canvas
                                ref={canvasRef}
                                width={320}
                                height={120}
                                onMouseDown={startDrawing}
                                onMouseMove={draw}
                                onMouseUp={stopDrawing}
                                onMouseLeave={stopDrawing}
                                onTouchStart={startDrawing}
                                onTouchMove={draw}
                                onTouchEnd={stopDrawing}
                                style={{ touchAction: "none" }}
                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl cursor-crosshair h-[120px]"
                              />
                            </div>
                          </div>

                          <Button
                            onClick={handleSignProposal}
                            className="w-full bg-gradient-to-r from-purple-700 to-indigo-600 hover:opacity-90 font-extrabold text-white py-3 rounded-xl text-xs mt-auto"
                          >
                            <PenTool className="h-4 w-4 mr-1.5" />
                            Registrar Assinatura de Aceite
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
              </div>
            ) : (
              <div className="lg:col-span-3 flex items-center justify-center min-h-[400px] w-full">
                <EmptyState
                  icon={FileText}
                  title="Nenhuma proposta selecionada"
                  description="Selecione um rascunho ou simulação comercial na barra lateral ou clique em 'Nova Proposta' para começar."
                  className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>
            )}
          </div>
        )}

      </div>

      {/* Mesa de Negociação (tela cheia, compartilhável com o cliente) */}
      {isNegotiating && selectedProposal && (
        <GeracaoDigitalNegotiationBoard
          prospectName={prospectName}
          items={items}
          setupItensTotal={setupTotal}
          recurringTotal={recurringTotal}
          setupVexoValue={setupVexoValue}
          periodoPlano={periodoPlano}
          validadeAte={validadeAte}
          offeredTerms={offeredTerms}
          onClose={() => setIsNegotiating(false)}
          onFinalize={handleFinalizeNegotiation}
          packageId={editPackageId}
          packageVexoId={editPackageVexoId}
          availablePackages={availablePackages}
        />
      )}

      {/* Modal de Compartilhamento da Proposta */}
      {selectedProposal && (
        <ShareProposalDialog
          open={showSendModal}
          onOpenChange={setShowSendModal}
          proposalId={selectedProposal.id}
          prospectName={selectedProposal.prospect_name}
          clientId={clientId}
          getIdToken={getIdToken}
        />
      )}
      {/* Modal de geração de contrato jurídico */}
      {selectedProposal && showGenerateContract && (
        <GenerateContractDialog
          open={showGenerateContract}
          onOpenChange={setShowGenerateContract}
          proposalId={selectedProposal.id}
          initialData={{
            razao_social: selectedProposal.prospect_name,
            produtos: selectedProposal.itens.map(i => `- ${i.descricao} (R$ ${i.valor})`).join("\n"),
            condicoes_pagamento: selectedProposal.condicoes_pagamento?.escolhida?.nome || "",
          }}
        />
      )}
    </PageShell>
  );
}
