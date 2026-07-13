import { useState, useEffect, useRef } from "react";
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
  Archive
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

  const { showNewForm, setShowNewForm, resetWizard } = wizardState;

  // Modal de compartilhamento da proposta
  const [showSendModal, setShowSendModal] = useState<boolean>(false);

  // Condição de pagamento criada na hora (sem ir na aba Condições)
  const [showInlineTerm, setShowInlineTerm] = useState<boolean>(false);
  const [inlineTerm, setInlineTerm] = useState<{ nome: string; tipo: PaymentTermTipo; config: PaymentTermConfig; salvarTemplate: boolean }>({
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
      return (item.categoria === "gd" && Number(item.valor || 0) > 0 && !item.descricao.startsWith("Pacote:") && !item.descricao.startsWith("GD:")) ||
             (item.categoria === "vexo" && Number(item.valor || 0) > 0 && item.product_id === null && !item.descricao.startsWith("Pacote Vexo:"));
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
    const avulsosMap: Record<string, boolean> = {};
    if (Array.isArray(prop.itens)) {
      prop.itens.forEach((item) => {
        if (item.categoria === "vexo" && item.product_id && !item.descricao.startsWith("Pacote Vexo")) {
          avulsosMap[item.product_id] = true;
        }
      });
    }
    setEditVexoAvulsoIds(avulsosMap);
    const gdAvulsosMap: Record<string, boolean> = {};
    if (Array.isArray(prop.itens)) {
      prop.itens.forEach((item) => {
        if (item.categoria === "gd" && item.product_id && item.descricao.startsWith("GD:")) {
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
          body: JSON.stringify({ client_id: clientId, nome: inlineTerm.nome, tipo: inlineTerm.tipo, config: inlineTerm.config })
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
        ativo: true
      };
      setAdhocTerms((prev) => [...prev, created!]);
    }
    setOfferedTermIds((prev) => [...prev, created!.id]);
    setShowInlineTerm(false);
    setInlineTerm({ nome: "", tipo: "avista_desconto", config: {}, salvarTemplate: false });
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
        periodo_plano: periodoPlano || null,
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
        return (item.categoria === "gd" && Number(item.valor || 0) > 0 && !item.descricao.startsWith("Pacote:") && !item.descricao.startsWith("GD:")) ||
               (item.categoria === "vexo" && Number(item.valor || 0) > 0 && item.product_id === null && !item.descricao.startsWith("Pacote Vexo:"));
      });
      finalItems.push(...legacyItems);

      const body = {
        client_id: clientId,
        prospect_name: prospectName,
        package_id: editPackageId || null,
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
        periodo_plano: periodoPlano || null,
        validade_ate: validadeAte ? new Date(`${validadeAte}T23:59:59`).toISOString() : null,
        valor_apos_validade: valorAposValidade !== "" ? Number(valorAposValidade) : null,
        observacao_validade: observacaoValidade || null,
        carencia_dias: result.carenciaDias ?? (editCarencia !== "" ? Number(editCarencia) : null),
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
      <div className="w-full min-h-screen bg-white text-slate-800 rounded-3xl p-6 border border-slate-200 shadow-sm relative overflow-hidden">

        {/* Glow Effects */}
        <div className="absolute top-0 right-0 h-96 w-96 bg-purple-50 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 h-96 w-96 bg-pink-50 rounded-full blur-[100px] pointer-events-none" />

        {/* Loading / Error states */}
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <span className="animate-spin h-8 w-8 border-4 border-purple-600 border-t-transparent rounded-full" />
          </div>
        ) : error ? (
          <Card className="bg-red-50 border-red-200 text-center max-w-lg mx-auto py-12 relative z-10 shadow-sm">
            <CardContent className="space-y-4">
              <Info className="h-12 w-12 text-red-500 mx-auto" />
              <h3 className="text-lg font-bold text-slate-850">Falha na Conexão</h3>
              <p className="text-xs text-slate-650">
                {error}
              </p>
              <Button onClick={loadProposals} className="bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs px-6 py-2 rounded-xl">
                Tentar Novamente
              </Button>
            </CardContent>
          </Card>
        ) : proposals.length === 0 ? (
          <Card className="bg-white border-slate-200 text-center max-w-lg mx-auto py-12 relative z-10 shadow-sm">
            <CardContent className="space-y-4">
              <FileText className="h-12 w-12 text-slate-400 mx-auto" />
              <h3 className="text-lg font-bold text-slate-800">Nenhuma Proposta Gerada</h3>
              <p className="text-xs text-slate-500">
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
              <label className="flex items-center gap-2 px-2 pb-1 text-[10px] text-slate-500 font-medium cursor-pointer">
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
                <button
                  key={prop.id}
                  onClick={() => selectProposal(prop)}
                  className={cn(
                    "w-full text-left p-4 rounded-xl border transition-all space-y-2 group shadow-sm",
                    selectedProposal?.id === prop.id
                      ? "bg-slate-50 border-purple-500/50 shadow-md shadow-purple-600/5"
                      : "bg-white border-slate-200 hover:border-slate-350"
                  )}
                >
                  <div className="flex justify-between items-start">
                    <span className="text-xs font-black text-slate-800 group-hover:text-purple-600 transition-colors leading-tight">
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
                  <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono">
                    <span>Total Geral</span>
                    <span className="text-slate-800 font-bold">R$ {prop.valor_total.toLocaleString("pt-BR")}</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Proposal Detail & Editor */}
            {selectedProposal ? (
              <div className="space-y-6 lg:col-span-3">

                {/* Header overview */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-6 rounded-2xl bg-white border border-slate-200 shadow-sm">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-black text-slate-800">{prospectName}</h2>
                      {selectedProposal.status === "aceita" && (
                        <Badge className="bg-emerald-500 text-white font-bold flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" />
                          Fechado ✔
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 font-mono">ID: {selectedProposal.id}</p>
                  </div>

                  <div className="flex gap-2">
                    {selectedProposal.status !== "aceita" && (
                      <Button
                        size="sm"
                        onClick={() => setIsNegotiating(true)}
                        className="bg-gradient-to-r from-purple-700 to-indigo-600 hover:opacity-90 text-white font-bold shrink-0"
                      >
                        <Sparkles className="h-4 w-4 mr-1.5" />
                        Abrir Mesa de Negociação
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSendToClient}
                      className="border-slate-200 text-slate-700 hover:bg-slate-50 shrink-0"
                    >
                      <Share2 className="h-4 w-4 mr-1.5" />
                      Enviar ao Cliente
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleArchiveProposal(selectedProposal.arquivada !== true)}
                      className="border-slate-200 text-slate-700 hover:bg-slate-50 shrink-0"
                    >
                      <Archive className="h-4 w-4 mr-1.5" />
                      {selectedProposal.arquivada === true ? "Desarquivar" : "Arquivar"}
                    </Button>
                    {selectedProposal.status !== "aceita" && (
                      <>
                              <Button
                          variant="destructive"
                          size="sm"
                          onClick={handleDeleteProposal}
                          className="bg-rose-600 hover:bg-rose-500 text-white font-bold shrink-0"
                        >
                          <Trash2 className="h-4 w-4 mr-1.5" />
                          Excluir Rascunho
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleSaveProposal}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold"
                        >
                          Salvar Alterações
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Pacotes & Módulos da Proposta */}
                <Card className="bg-white border-slate-200 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-base font-bold text-slate-800">Escopo & Combos Comerciais</CardTitle>
                    <CardDescription className="text-[11px] text-slate-500">Configure os pacotes e módulos integrados nesta proposta comercial.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Pacote selects */}
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-bold text-slate-700">Combo Geração Digital (Marketing/Vendas)</Label>
                        <select
                          value={editPackageId}
                          disabled={selectedProposal.status === "aceita"}
                          onChange={(e) => setEditPackageId(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-850 h-10 focus:outline-none focus:border-indigo-500"
                        >
                          <option value="">— Sem Pacote GD —</option>
                          {availablePackages.filter(p => p.tipo === "gd" || !p.tipo).map((pk: any) => (
                            <option key={pk.id} value={pk.id}>
                              {pk.nome} ({(pk.valor / (pk.periodo === "anual" ? 12 : pk.periodo === "semestral" ? 6 : pk.periodo === "trimestral" ? 3 : 1)).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/mês)
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs font-bold text-slate-700">Combo Vexo OS (Software/ERP)</Label>
                        <select
                          value={editPackageVexoId}
                          disabled={selectedProposal.status === "aceita"}
                          onChange={(e) => setEditPackageVexoId(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-855 h-10 focus:outline-none focus:border-indigo-500"
                        >
                          <option value="">— Sem Combo Vexo OS —</option>
                          {availablePackages.filter(p => p.tipo === "vexo").map((pk: any) => (
                            <option key={pk.id} value={pk.id}>
                              {pk.nome} ({(pk.valor / (pk.periodo === "anual" ? 12 : pk.periodo === "semestral" ? 6 : pk.periodo === "trimestral" ? 3 : 1)).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/mês)
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Vexo Extras */}
                    <div className="space-y-2">
                      <Label className="text-xs font-bold text-slate-850">Módulos Extras Vexo OS (Avulsos)</Label>
                      <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 max-h-[160px] overflow-y-auto pr-1">
                        {vexoProducts.map((p) => {
                          const isIncluded = !!editVexoAvulsoIds[p.id];
                          return (
                            <div
                              key={p.id}
                              onClick={() => {
                                if (selectedProposal.status === "aceita") return;
                                setEditVexoAvulsoIds(prev => ({
                                  ...prev,
                                  [p.id]: !isIncluded
                                }));
                              }}
                              className={cn(
                                "p-2 rounded-lg border transition-all flex items-center justify-between cursor-pointer text-left shadow-sm",
                                isIncluded
                                  ? "bg-indigo-50 border-indigo-300"
                                  : "bg-white border-slate-200 hover:border-slate-350",
                                selectedProposal.status === "aceita" && "cursor-default opacity-85"
                              )}
                            >
                              <div className="space-y-0.5">
                                <span className="text-[11px] font-bold text-slate-800 block leading-tight">{p.nome}</span>
                                <span className="text-[9px] font-mono font-bold text-purple-650">
                                  {Number(p.valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/mês
                                </span>
                              </div>
                              {isIncluded && (
                                <div className="h-3.5 w-3.5 rounded-full bg-indigo-600 flex items-center justify-center shrink-0">
                                  <CheckCircle className="h-2 w-2 text-white" />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* GD Extras (avulsos) */}
                    <div className="space-y-2">
                      <Label className="text-xs font-bold text-slate-850">Módulos Extras Geração Digital (Avulsos)</Label>
                      <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 max-h-[160px] overflow-y-auto pr-1">
                        {gdProducts.map((p) => {
                          const isIncluded = !!editGdAvulsoIds[p.id];
                          return (
                            <div
                              key={p.id}
                              onClick={() => {
                                if (selectedProposal.status === "aceita") return;
                                setEditGdAvulsoIds(prev => ({ ...prev, [p.id]: !isIncluded }));
                              }}
                              className={cn(
                                "p-2 rounded-lg border transition-all flex items-center justify-between cursor-pointer text-left shadow-sm",
                                isIncluded ? "bg-pink-50 border-pink-300" : "bg-white border-slate-200 hover:border-slate-350",
                                selectedProposal.status === "aceita" && "cursor-default opacity-85"
                              )}
                            >
                              <div className="space-y-0.5">
                                <span className="text-[11px] font-bold text-slate-800 block leading-tight">{p.nome}</span>
                                <span className="text-[9px] font-mono font-bold text-pink-600">
                                  {Number(p.valor_padrao || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/{p.recorrencia === "unico" ? "único" : "mês"}
                                </span>
                              </div>
                              {isIncluded && (
                                <div className="h-3.5 w-3.5 rounded-full bg-pink-600 flex items-center justify-center shrink-0">
                                  <CheckCircle className="h-2 w-2 text-white" />
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {gdProducts.length === 0 && (
                          <p className="text-[10px] text-slate-450 italic col-span-3">Nenhum módulo GD no catálogo.</p>
                        )}
                      </div>
                    </div>

                    {/* Escopo Incluso (Read-only list of items) */}
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                        <span className="text-xs font-black text-slate-800 uppercase tracking-wider">Escopo Incluso na Proposta</span>
                      </div>
                      <div className="space-y-2">
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
                                  <div className="flex justify-between items-center text-xs font-bold text-slate-850">
                                    <span>Combo GD: {activeGdPkg.nome}</span>
                                    <span>{(activeGdPkg.valor / (activeGdPkg.periodo === "anual" ? 12 : activeGdPkg.periodo === "semestral" ? 6 : activeGdPkg.periodo === "trimestral" ? 3 : 1)).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/mês</span>
                                  </div>
                                  <div className="flex flex-wrap gap-1 pl-3 border-l-2 border-purple-300">
                                    {(activeGdPkg.produtos_incluidos || []).map((p: any, idx: number) => (
                                      <Badge key={idx} variant="outline" className="bg-white text-slate-650 text-[9px] py-0">{p.nome}</Badge>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {activeVexoPkg && (
                                <div className="space-y-1">
                                  <div className="flex justify-between items-center text-xs font-bold text-slate-850">
                                    <span>Combo Vexo OS: {activeVexoPkg.nome}</span>
                                    <span>{(activeVexoPkg.valor / (activeVexoPkg.periodo === "anual" ? 12 : activeVexoPkg.periodo === "semestral" ? 6 : activeVexoPkg.periodo === "trimestral" ? 3 : 1)).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/mês</span>
                                  </div>
                                  <div className="flex flex-wrap gap-1 pl-3 border-l-2 border-indigo-300">
                                    {(activeVexoPkg.produtos_incluidos || []).map((p: any, idx: number) => (
                                      <Badge key={idx} variant="outline" className="bg-white text-slate-650 text-[9px] py-0">{p.nome}</Badge>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {activeAvulsos.length > 0 && (
                                <div className="space-y-1">
                                  <span className="text-xs font-bold text-slate-855 block">Módulos Avulsos Extras:</span>
                                  <div className="grid gap-2 pl-3 border-l-2 border-slate-300">
                                    {activeAvulsos.map((p: any) => (
                                      <div key={p.id} className="flex justify-between items-center text-xs text-slate-650">
                                        <span>• {p.nome}</span>
                                        <span className="font-mono text-slate-500">{Number(p.valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/mês</span>
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

                    {/* Legacy items (if any exist) */}
                    {(() => {
                      const legacyItems = items.filter(item => {
                        return (item.categoria === "gd" && Number(item.valor || 0) > 0 && !item.descricao.startsWith("Pacote:")) ||
                               (item.categoria === "vexo" && Number(item.valor || 0) > 0 && item.product_id === null && !item.descricao.startsWith("Pacote Vexo:"));
                      });
                      if (legacyItems.length === 0) return null;
                      return (
                        <div className="p-4 rounded-xl bg-orange-50/50 border border-orange-200 space-y-2">
                          <Label className="text-xs font-bold text-orange-850 uppercase block">Itens Adicionais (Legado)</Label>
                          <p className="text-[10px] text-orange-700 font-medium">Esses itens foram cadastrados no modelo antigo e possuem precificação customizada manual.</p>
                          <div className="space-y-2 mt-2">
                            {legacyItems.map((item, idx) => {
                              const globalIdx = items.findIndex(it => it.descricao === item.descricao && it.valor === item.valor);
                              return (
                                <div key={idx} className="flex justify-between items-center p-2 rounded bg-white border border-orange-100 text-xs">
                                  <div>
                                    <span className="font-semibold text-slate-800">{item.descricao}</span>
                                    <span className="text-[9px] text-slate-450 block uppercase font-mono">{item.categoria} · {item.recorrencia}</span>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <span className="font-mono font-bold text-slate-700">{Number(item.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>
                                    {selectedProposal.status !== "aceita" && (
                                      <Button variant="ghost" size="icon" onClick={() => handleRemoveItem(globalIdx)} className="h-6 w-6 text-red-500 hover:text-red-750 hover:bg-red-50">
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Consolidated Financial Summary Card */}
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
                        <div className={cn(
                          "grid gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200",
                          vpActive ? "sm:grid-cols-4" : "sm:grid-cols-3"
                        )}>
                          <div className="space-y-1">
                            <span className="text-[10px] text-slate-500 uppercase font-black tracking-wider block">1. Taxa de Setup</span>
                            <h4 className="text-lg font-black text-slate-800 font-mono">
                              {calc.setupFinal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                            </h4>
                            {cobrarSetup && calc.setupFinal < calc.setupOriginal && (
                              <span className="text-[9px] text-emerald-600 font-bold block">
                                Desconto de {(calc.setupOriginal - calc.setupFinal).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} aplicado
                              </span>
                            )}
                          </div>

                          <div className="space-y-1">
                            <span className="text-[10px] text-slate-550 uppercase font-black tracking-wider block">2. Valor Recorrente (Mensalidade)</span>
                            <h4 className="text-lg font-black text-pink-650 font-mono">
                              {calc.mensalidadeFinal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/mês
                            </h4>
                            {calc.mensalidadeFinal < calc.mensalidadeOriginal && (
                              <span className="text-[9px] text-emerald-600 font-bold block">
                                Desconto de {(calc.mensalidadeOriginal - calc.mensalidadeFinal).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/mês aplicado
                              </span>
                            )}
                          </div>

                          <div className="space-y-1">
                            <span className="text-[10px] text-slate-550 uppercase font-black tracking-wider block">3. Compromisso do Período</span>
                            <h4 className="text-lg font-black text-indigo-600 font-mono">
                              {calc.compromissoFinal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                            </h4>
                            <span className="text-[9px] text-slate-450 block">Soma recorrente por {calc.mesesPeriodo} meses</span>
                          </div>

                          {vpActive && (
                            <div className="space-y-1 border-l border-purple-100 pl-3">
                              <span className="text-[10px] text-purple-650 uppercase font-black tracking-wider block">4. Permuta Comercial (VP)</span>
                              <h4 className="text-lg font-black text-purple-700 font-mono">
                                {editValorVp.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                              </h4>
                              <span className="text-[9px] text-purple-500 block">Acordado em troca de permuta</span>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>

                {/* Setup Vexo (taxa de implantação opcional) */}
                <Card className="bg-white border-slate-200 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-base font-bold text-slate-800">Taxa de Implantação (Setup Vexo OS)</CardTitle>
                    <CardDescription className="text-[11px] text-slate-500">
                      Investimento único e opcional de implantação, discriminado no total de entrada da proposta.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-bold text-slate-700">Cobrar setup de implantação?</Label>
                      <Switch
                        checked={cobrarSetup}
                        disabled={selectedProposal.status === "aceita"}
                        onCheckedChange={setCobrarSetup}
                      />
                    </div>
                    {cobrarSetup && (
                      <div className="space-y-3 border-t border-slate-100 pt-3">
                        <div className="w-full md:w-48 space-y-1">
                          <Label className="text-[10px] text-slate-500 font-mono">Valor do Setup (R$)</Label>
                          <div className="relative">
                            <span className="absolute left-2.5 top-2 text-[10px] text-slate-500 font-mono">R$</span>
                            <Input
                              type="number"
                              value={valorSetupVexo}
                              disabled={selectedProposal.status === "aceita"}
                              onChange={(e) => setValorSetupVexo(Number(e.target.value) || 0)}
                              className="bg-white border-slate-200 text-xs text-slate-800 pl-7 h-8 font-mono"
                            />
                          </div>
                        </div>
                        <div className="text-[10px] text-slate-600 leading-relaxed bg-purple-50/60 p-3 rounded-lg border border-purple-100 whitespace-pre-line">
                          <span className="font-bold text-slate-800 block mb-1">{SETUP_LABEL}</span>
                          {SETUP_JUSTIFICATION}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Período do Plano e Validade da Proposta */}
                <Card className="bg-white border-slate-200 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-base font-bold text-slate-800">Período do Plano & Validade da Proposta</CardTitle>
                    <CardDescription className="text-[11px] text-slate-500">
                      O período registra o plano fechado (sem desconto automático). A validade cria urgência na proposta pública.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-slate-500 font-mono">Período do plano</Label>
                        <select
                          value={periodoPlano}
                          disabled={selectedProposal.status === "aceita"}
                          onChange={(e) => setPeriodoPlano(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-850 focus:outline-none focus:border-indigo-500/50 h-8"
                        >
                          {PERIODO_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-slate-500 font-mono">Proposta válida até</Label>
                        <Input
                          type="date"
                          value={validadeAte}
                          disabled={selectedProposal.status === "aceita"}
                          onChange={(e) => setValidadeAte(e.target.value)}
                          className="bg-white border-slate-200 text-xs text-slate-800 h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-slate-500 font-mono">1º vencimento da mensalidade (carência)</Label>
                        <select
                          value={editCarencia}
                          disabled={selectedProposal.status === "aceita"}
                          onChange={(e) => setEditCarencia(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-850 focus:outline-none h-8"
                        >
                          <option value="">Imediato (na contratação)</option>
                          <option value="15">15 dias após a contratação</option>
                          <option value="20">20 dias após a contratação</option>
                          <option value="30">30 dias após a contratação</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-slate-500 font-mono">Valor após a validade (R$, opcional)</Label>
                        <div className="relative">
                          <span className="absolute left-2.5 top-2 text-[10px] text-slate-500 font-mono">R$</span>
                          <Input
                            type="number"
                            value={valorAposValidade}
                            disabled={selectedProposal.status === "aceita"}
                            onChange={(e) => setValorAposValidade(e.target.value)}
                            className="bg-white border-slate-200 text-xs text-slate-800 pl-7 h-8 font-mono"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-500 font-mono">Observação após o prazo (opcional)</Label>
                      <Input
                        value={observacaoValidade}
                        disabled={selectedProposal.status === "aceita"}
                        onChange={(e) => setObservacaoValidade(e.target.value)}
                        placeholder='Ex: "Após esta data o valor retorna ao preço de tabela" ou "condições sujeitas a reajuste"'
                        className="bg-white border-slate-200 text-xs text-slate-800 h-8"
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Condições de Pagamento ofertadas */}
                <Card className="bg-white border-slate-200 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-base font-bold text-slate-800">Condições de Pagamento Ofertadas</CardTitle>
                    <CardDescription className="text-[11px] text-slate-500 font-light">
                      Selecione as condições salvas que o cliente poderá escolher. O desdobramento é calculado sobre o investimento único de setup (R$ {(setupTotal + setupVexoValue).toLocaleString("pt-BR")}).
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {availableTerms.length === 0 ? (
                      <p className="text-[10px] text-slate-400 italic">
                        Nenhuma condição de pagamento ativa. Cadastre na aba "Condições" do módulo Geração Digital.
                      </p>
                    ) : (
                      <div className="grid gap-2 md:grid-cols-2">
                        {availableTerms.map((term) => {
                          const isOffered = offeredTermIds.includes(term.id);
                          const aplicaA = termAplicaA(term);
                          const base = aplicaA === "mensalidade" ? recurringTotal : setupTotal + setupVexoValue;
                          const breakdown = computePaymentBreakdown(term, base);
                          return (
                            <div
                              key={term.id}
                              className={cn(
                                "p-3 rounded-xl border transition-all space-y-1.5",
                                isOffered ? "bg-purple-50/50 border-purple-200" : "bg-white border-slate-200"
                              )}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-slate-800 leading-tight">
                                  {term.nome}
                                  <Badge className={cn(
                                    "text-[8px] font-bold border-none px-1.5 py-0 ml-1.5",
                                    aplicaA === "mensalidade" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                                  )}>
                                    {APLICA_A_LABELS[aplicaA]}
                                  </Badge>
                                </span>
                                <Switch
                                  checked={isOffered}
                                  disabled={selectedProposal.status === "aceita"}
                                  onCheckedChange={() => toggleOfferedTerm(term.id)}
                                  className="scale-90"
                                />
                              </div>
                              {isOffered && breakdown.linhas.map((linha, idx) => (
                                <p key={idx} className="text-[10px] text-purple-700 font-medium">{linha}</p>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {selectedProposal.status !== "aceita" && (
                      showInlineTerm ? (
                        <div className="p-4 rounded-xl bg-slate-50 border border-purple-200 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-800">Nova condição (aplicar nesta proposta)</span>
                            <button onClick={() => setShowInlineTerm(false)} className="text-slate-400 hover:text-slate-600">
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="space-y-1">
                              <Label className="text-[10px] text-slate-500 font-mono">Nome</Label>
                              <Input
                                value={inlineTerm.nome}
                                onChange={(e) => setInlineTerm((p) => ({ ...p, nome: e.target.value }))}
                                placeholder='Ex: "Entrada + 6x sem juros"'
                                className="bg-white border-slate-200 text-xs h-8"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] text-slate-500 font-mono">Tipo</Label>
                              <select
                                value={inlineTerm.tipo}
                                onChange={(e) => setInlineTerm((p) => ({ ...p, tipo: e.target.value as PaymentTermTipo, config: {} }))}
                                className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-850 h-8"
                              >
                                {PAYMENT_TERM_TIPOS.map((t) => (
                                  <option key={t.value} value={t.value}>{t.label}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div className="grid gap-3 md:grid-cols-3">
                            {inlineTerm.tipo === "avista_desconto" && (
                              <div className="space-y-1">
                                <Label className="text-[10px] text-slate-500 font-mono">% de desconto</Label>
                                <Input
                                  type="number"
                                  value={inlineTerm.config.percentual_desconto ?? ""}
                                  onChange={(e) => updateInlineConfig("percentual_desconto", Number(e.target.value) || 0)}
                                  className="bg-white border-slate-200 text-xs h-8"
                                />
                              </div>
                            )}
                            {inlineTerm.tipo === "entrada_parcelas" && (
                              <>
                                <div className="space-y-1">
                                  <Label className="text-[10px] text-slate-500 font-mono">Entrada (R$)</Label>
                                  <Input
                                    type="number"
                                    value={inlineTerm.config.valor_entrada ?? ""}
                                    onChange={(e) => updateInlineConfig("valor_entrada", Number(e.target.value) || 0)}
                                    className="bg-white border-slate-200 text-xs h-8"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px] text-slate-500 font-mono">Nº parcelas</Label>
                                  <Input
                                    type="number"
                                    value={inlineTerm.config.num_parcelas ?? ""}
                                    onChange={(e) => updateInlineConfig("num_parcelas", Number(e.target.value) || 1)}
                                    className="bg-white border-slate-200 text-xs h-8"
                                  />
                                </div>
                              </>
                            )}
                            {(inlineTerm.tipo === "parcelado_cartao" || inlineTerm.tipo === "boleto_recorrente" || inlineTerm.tipo === "semanal") && (
                              <div className="space-y-1">
                                <Label className="text-[10px] text-slate-500 font-mono">Nº parcelas</Label>
                                <Input
                                  type="number"
                                  value={inlineTerm.config.num_parcelas ?? ""}
                                  onChange={(e) => updateInlineConfig("num_parcelas", Number(e.target.value) || 1)}
                                  className="bg-white border-slate-200 text-xs h-8"
                                />
                              </div>
                            )}
                            {inlineTerm.tipo === "custom" && (
                              <div className="space-y-1 md:col-span-3">
                                <Label className="text-[10px] text-slate-500 font-mono">Descrição</Label>
                                <Input
                                  value={inlineTerm.config.descricao ?? ""}
                                  onChange={(e) => updateInlineConfig("descricao", e.target.value)}
                                  className="bg-white border-slate-200 text-xs h-8"
                                />
                              </div>
                            )}
                          </div>
                          <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 text-[10px] text-slate-600 font-medium cursor-pointer">
                              <input
                                type="checkbox"
                                checked={inlineTerm.salvarTemplate}
                                onChange={(e) => setInlineTerm((p) => ({ ...p, salvarTemplate: e.target.checked }))}
                                className="accent-purple-600"
                              />
                              Salvar como template reutilizável (aba Condições)
                            </label>
                            <Button size="xs" onClick={handleCreateInlineTerm} className="bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold">
                              Criar e aplicar
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => setShowInlineTerm(true)}
                          className="border-purple-200 text-purple-650 hover:bg-purple-50 text-xs font-bold"
                        >
                          <Plus className="h-3.5 w-3.5 mr-1" />
                          Criar condição na hora
                        </Button>
                      )
                    )}
                    {selectedProposal.condicoes_pagamento?.escolhida && (
                      <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200">
                        <span className="text-[10px] font-bold text-emerald-700">
                          Condição escolhida pelo cliente: {selectedProposal.condicoes_pagamento.escolhida.nome}
                        </span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Conditions & Signatures */}
                <div className="grid gap-6 md:grid-cols-2 items-stretch">

                  {/* Conditions Card */}
                  <Card className="bg-white border-slate-200 shadow-sm flex flex-col h-full">
                    <CardHeader>
                      <CardTitle className="text-base font-bold text-slate-800">Condições Contratuais</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4 flex-grow flex flex-col justify-between">
                      <div className="space-y-4 flex-grow">
                        <div className="space-y-2">
                          <Label className="text-[10px] text-slate-500 font-mono">Condições e Regras Comerciais</Label>
                          <textarea
                            value={condicoes}
                            disabled={selectedProposal.status === "aceita"}
                            onChange={(e) => setCondicoes(e.target.value)}
                            className="w-full min-h-[140px] bg-white border border-slate-200 rounded-lg p-3 text-xs text-slate-800 focus:outline-none focus:border-indigo-500/50"
                          />
                        </div>

                        <div className="space-y-2 pt-2">
                          <Label className="text-[10px] text-slate-500 font-mono">Link de Pagamento (Checkout)</Label>
                          <Input
                            value={paymentLink}
                            disabled={selectedProposal.status === "aceita"}
                            onChange={(e) => setPaymentLink(e.target.value)}
                            placeholder="https://checkout.exemplo.com/..."
                            className="bg-white border-slate-200 text-xs text-slate-800 focus:outline-none"
                          />
                          <span className="text-[9px] text-slate-450 block font-light leading-snug">
                            Deixe vazio para herdar o link de checkout padrão da Geração Digital configurado no tenant.
                          </span>
                        </div>

                        <div className="space-y-2 pt-2 border-t border-slate-100 mt-2">
                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <Label className="text-[10px] text-slate-500 font-mono">Ativar VP (Permuta)</Label>
                              <span className="text-[9px] text-slate-450 block leading-snug">Esta proposta possui permuta associada</span>
                            </div>
                            <Switch
                              checked={vpActive}
                              disabled={selectedProposal.status === "aceita"}
                              onCheckedChange={(checked) => {
                                setVpActive(checked);
                                if (!checked) setEditValorVp(0);
                              }}
                            />
                          </div>

                          {vpActive && (
                            <div className="space-y-1.5 pt-1 animate-fade-in">
                              <Label className="text-xs text-slate-550 font-medium">Valor em VP (R$)</Label>
                              <Input
                                type="number"
                                value={editValorVp || ""}
                                disabled={selectedProposal.status === "aceita"}
                                onChange={(e) => setEditValorVp(Number(e.target.value) || 0)}
                                placeholder="Valor total para permuta"
                                className="bg-white border-slate-200 text-xs text-slate-850 font-mono focus:outline-none h-10"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Electronic Signature Card */}
                  <Card className="bg-white border-slate-200 shadow-sm flex flex-col h-full">
                    <CardHeader>
                      <CardTitle className="text-base font-bold text-slate-800">Assinatura de Aceite Comercial</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4 flex-grow flex flex-col justify-between">

                      {selectedProposal.status === "aceita" ? (
                        <div className="space-y-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-center flex-grow flex flex-col justify-center">
                          <CheckCircle className="h-10 w-10 text-emerald-600 mx-auto" />
                          <div className="space-y-1">
                            <h4 className="text-sm font-bold text-slate-800">Contrato Fechado com Sucesso!</h4>
                            <p className="text-[11px] text-slate-500">Proposta assinada comercialmente por:</p>
                            <span className="text-xs font-mono font-bold text-emerald-600 block">{selectedProposal.signer_name}</span>
                          </div>

                          {selectedProposal.assinatura && selectedProposal.assinatura.startsWith("data:image") && (
                            <div className="h-20 w-full max-w-[200px] bg-white rounded-lg p-1.5 mx-auto flex items-center justify-center overflow-hidden border border-slate-100">
                              <img src={selectedProposal.assinatura} alt="Assinatura" className="max-h-full max-w-full object-contain" />
                            </div>
                          )}

                          <div className="text-[9px] text-slate-500 font-mono space-y-0.5 mt-2">
                            <div>Data/Hora: {selectedProposal.signed_at ? new Date(selectedProposal.signed_at).toLocaleString("pt-BR") : ""}</div>
                            <div>IP do Assinante: {selectedProposal.signer_ip || "Registrado"}</div>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4 flex-grow flex flex-col justify-between">
                          <div className="space-y-4">
                            <div className="text-[10px] text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-200">
                              <span className="font-bold text-slate-800 block mb-1 uppercase font-mono tracking-wider">Termo de Aceite:</span>
                              "Declaro estar de acordo com os services, valores e condições desta proposta e autorizo o início dos trabalhos."
                            </div>

                            <div className="space-y-2">
                              <Label className="text-[10px] text-slate-500 font-mono">Nome Completo do Assinante</Label>
                              <Input
                                value={signerName}
                                onChange={(e) => setSignerName(e.target.value)}
                                placeholder="Nome do Responsável Legal"
                                className="bg-white border-slate-200 text-xs text-slate-800 focus:outline-none"
                              />
                            </div>

                            <div className="space-y-2">
                              <div className="flex justify-between items-center">
                                <Label className="text-[10px] text-slate-500 font-mono">Assine com o Mouse ou Dedo</Label>
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
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl cursor-crosshair h-[120px]"
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
              </div>
            ) : (
              <div className="lg:col-span-3 flex items-center justify-center min-h-[400px] w-full">
                <EmptyState
                  icon={FileText}
                  title="Nenhuma proposta selecionada"
                  description="Selecione um rascunho ou simulação comercial na barra lateral ou clique em 'Nova Proposta' para começar."
                  className="max-w-md w-full bg-white border border-slate-200"
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
    </PageShell>
  );
}
