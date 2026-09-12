import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { PageShell, PageShellContext } from "@/components/PageShell";
import { GeracaoDigitalTabs } from "@/components/GeracaoDigitalTabs";
import { toast } from "@/components/ui/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { calculateProposalValues, isCobrancaUnica, isCobrancaMensal, temPacote, isLinhaDePacote } from "@/lib/geracaoDigital/proposalCalculator";
import PlanoEditor from "@/components/geracaoDigital/PlanoEditor";
import { type Plano, type PeriodoKey, planoVazio, planoValido, planoDeProposta, vpMensalDoPrazo, PERIODOS } from "@/lib/geracaoDigital/plano";
import FormasPagamentoEditor from "@/components/geracaoDigital/FormasPagamentoEditor";
import { type FormasSelecionadas, formasVazias, formasParaTerms, termsParaFormas, termsLegados } from "@/lib/geracaoDigital/formasPagamento";
import { syncPlanoPackages } from "@/lib/geracaoDigital/planoSync";
import { buildContractInitialData } from "@/lib/geracaoDigital/contractFromProposal";
import { API_BASE_URL, fetchApi } from "@/lib/api";
import { isManagerOrAdmin } from "@/lib/access";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
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
  ExternalLink,
  Search,
  LayoutGrid,
  List as ListIcon,
  Layers,
  RotateCcw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PERIOD_LABELS as PKG_PERIOD_LABELS } from "@/lib/geracaoDigital/packagePricing";
import { Switch } from "@/components/ui/switch";
import {
  type PaymentTerm,
  type PaymentTermTipo,
  type PaymentTermConfig,
  type ProposalPaymentTerms,
  PAYMENT_TERM_TIPOS,
  CARTAO_RECORRENTE_PLANOS,
  computePaymentBreakdown,
  termAplicaA,
  APLICA_A_LABELS,
  SETUP_LABEL,
  SETUP_JUSTIFICATION
} from "@/lib/geracaoDigital/paymentTerms";
import { GenerateContractDialog } from "./GeracaoDigitalContracts/GenerateContractDialog";
import { ShareProposalDialog } from "./GeracaoDigitalProposals/ShareProposalDialog";
import { SlideEditorModal } from "@/components/presentation/SlideEditorModal";
import { PitchBriefingModal } from "@/components/presentation/PitchBriefingModal";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useProposalWizard } from "@/hooks/useProposalWizard";
import { ProposalWizard } from "@/components/geracaoDigital/ProposalWizard";

interface ProposalItem {
  product_id?: string | null;
  descricao: string;
  categoria: "gd" | "vexo";
  valor: number;
  valor_vp?: number | null;
  /** "mensal" | "unico" | "pontual" — usar isCobrancaUnica, nunca comparar string. */
  recorrencia: string;
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
  arquivada?: boolean;
  carencia_dias?: number | null;
  package_id?: string | null;
  package_vexo_id?: string | null;
  pacotes_ofertados?: string[] | null;
  segment_id?: string | null;
  presentation_slides?: any[] | null;
  meeting_notes?: string | null;
  esconder_valores?: boolean | null;
  condicoes_especiais?: string | null;
}

const PERIODO_OPTIONS = [
  { value: "", label: "— não definido —" },
  { value: "mensal", label: "Mensal" },
  { value: "trimestral", label: "Trimestral" },
  { value: "semestral", label: "Semestral" },
  { value: "anual", label: "Anual" },
];

interface GeracaoDigitalProposalsProps {
  isVexoCommercial?: boolean;
}

export default function GeracaoDigitalProposals({ isVexoCommercial = false }: GeracaoDigitalProposalsProps) {
  const { isAuthenticated, getIdToken, clientId, accessProfile } = useAuth();
  const navigate = useNavigate();

  // Proposals State
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  // Espelho em ref: loadProposals() é chamado de handlers com closure antiga,
  // então ler selectedProposal direto lá devolveria valor defasado.
  const selectedProposalRef = useRef<Proposal | null>(null);
  useEffect(() => {
    selectedProposalRef.current = selectedProposal;
  }, [selectedProposal]);
  // ?proposta=<id> — quem volta da proposta pública reabre a mesma proposta.
  const propostaIdUrl = new URLSearchParams(useLocation().search).get("proposta");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Reabertura de proposta aceita (ação de gestor)
  const [showReopenModal, setShowReopenModal] = useState<boolean>(false);
  const [reopenMotivo, setReopenMotivo] = useState<string>("");
  const [isReopening, setIsReopening] = useState<boolean>(false);

  // Modo condições especiais (esconder valores de planos na proposta pública/pitch)
  const [editEsconderValores, setEditEsconderValores] = useState<boolean>(false);

  // Proposal form editor state
  const [prospectName, setProspectName] = useState<string>("");
  const [condicoes, setCondicoes] = useState<string>("");
  const [items, setItems] = useState<ProposalItem[]>([]);
  const [paymentLink, setPaymentLink] = useState<string>("");
  const [editPackageId, setEditPackageId] = useState<string>("");
  const [editPackageVexoId, setEditPackageVexoId] = useState<string>("");
  const [editPacotesOfertados, setEditPacotesOfertados] = useState<string[]>([]);
  // Plano da proposta em edição (escopo × prazos) — mesmo editor do wizard.
  const [editPlano, setEditPlano] = useState<Plano>(planoVazio);
  const [planoSaving, setPlanoSaving] = useState<boolean>(false);

  // Regrava as linhas de preço desta proposta a partir do plano editado.
  const [editValorVp, setEditValorVp] = useState<number>(0);
  const [vpActive, setVpActive] = useState<boolean>(false);
  const [editCarencia, setEditCarencia] = useState<string>("");

  // Setup Vexo opcional
  const [cobrarSetup, setCobrarSetup] = useState<boolean>(false);
  const [valorSetupVexo, setValorSetupVexo] = useState<number>(0);
  // Fase 5a: alavancas que moravam na Mesa de Negociação agora são campos
  // editáveis da própria proposta. 0/vazio = usa o preço do pacote no catálogo.
  const [editMensalidadeNegociada, setEditMensalidadeNegociada] = useState<number>(0);

  // Condições de pagamento
  const [availableTerms, setAvailableTerms] = useState<PaymentTerm[]>([]);
  const [offeredTermIds, setOfferedTermIds] = useState<string[]>([]);
  // Formas fixas de pagamento (Pix/cartão) marcadas nesta proposta.
  const [formasPgto, setFormasPgto] = useState<FormasSelecionadas>(formasVazias);
  // Corpo do card: preview por padrão, formulário só quando pedido.
  const [showConfig, setShowConfig] = useState<boolean>(false);
  const [editSegmentId, setEditSegmentId] = useState<string>("");
  const [customEditSegment, setCustomEditSegment] = useState<string>("");
  const [editProspectLogo, setEditProspectLogo] = useState<string | null>(null);
  // Muda para forçar o iframe do preview a recarregar depois de salvar.
  const [previewNonce, setPreviewNonce] = useState<number>(0);

  // Mesa de negociação

  // Arquivadas
  const [showArchived, setShowArchived] = useState<boolean>(false);
  // Busca e modo de visualização da lista lateral de propostas.
  // A preferência de visualização persiste: antes voltava para cards toda vez
  // que se saía e voltava na aba.
  const [buscaProposta, setBuscaProposta] = useState<string>("");
  const [viewProposta, setViewProposta] = useLocalStorage<"cards" | "list">("gd_propostas_view", "cards");

  // Catalog catalogs (shared between wizard and proposal editor)
  const [availablePackages, setAvailablePackages] = useState<any[]>([]);
  const [segmentsList, setSegmentsList] = useState<any[]>([]);
  const [vexoProducts, setVexoProducts] = useState<any[]>([]);
  const [gdProducts, setGdProducts] = useState<any[]>([]);

  // Slide Editor & Pitch Generator State
  const [showSlideEditorModal, setShowSlideEditorModal] = useState<boolean>(false);
  const [showBriefingModal, setShowBriefingModal] = useState<boolean>(false);

  const handleOpenPitchGenerator = () => {
    setShowBriefingModal(true);
  };

  const handlePitchGenerated = (generatedSlides: any[], meetingNotes: string, customSegment?: string) => {
    if (!selectedProposal) return;
    const patch: any = { presentation_slides: generatedSlides, meeting_notes: meetingNotes };
    if (customSegment) {
      patch.segment_id = customSegment;
    }
    setSelectedProposal((prev) =>
      prev ? { ...prev, ...patch } : prev
    );
    setProposals((prev) =>
      prev.map((p) =>
        p.id === selectedProposal.id
          ? { ...p, ...patch }
          : p
      )
    );
    setShowSlideEditorModal(true);
  };

  // Hook customizado para gerenciar estado/ações do wizard de criação de proposta
  const wizardState = useProposalWizard({
    clientId,
    getIdToken,
    availablePackages,
    vexoProducts,
    gdProducts,
    availableTerms,
    loadProposals,
    toast,
    isVexoCommercial
  });

  const {
    showNewForm,
    setShowNewForm,
    newCondicoes,
    resetWizard,
    setNewProspect,
    setNewSegmentId,
    setNewProspectLogo,
    setNewPackageId,
    setNewPackageVexoId,
    setNewPacotesOfertados,
    setNewOfferedTermIds,
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

  // Auto-carrega dados do lead e abre o formulário de proposta quando navega de Ações Rápidas (Conversas)
  const location = useLocation();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const phone = params.get("phone");
    const nome = params.get("nome") || params.get("prospect");
    if (phone || nome) {
      setShowNewForm(true);
      setNewProspect(nome || phone || "");
    }
  }, [location.search, setShowNewForm, setNewProspect]);


  // Modal de compartilhamento da proposta
  const [showSendModal, setShowSendModal] = useState<boolean>(false);
  // Proposta alvo do compartilhamento, capturada no clique. Necessário porque
  // loadProposals() reseta selectedProposal para a primeira da lista logo depois
  // de abrir o modal — sem isso, o dialog pegava o link da proposta errada.
  const [shareTarget, setShareTarget] = useState<Proposal | null>(null);
  // Modal de geração de contrato jurídico
  const [showGenerateContract, setShowGenerateContract] = useState<boolean>(false);

  // Condição de pagamento criada na hora (sem ir na aba Condições)
  const [showInlineTerm, setShowInlineTerm] = useState<boolean>(false);
  const [inlineTerm, setInlineTerm] = useState<{ nome: string; tipo: PaymentTermTipo; config: PaymentTermConfig; aplica_a?: "setup" | "mensalidade"; salvarTemplate: boolean }>({
    nome: "", tipo: "avista_desconto", config: {}, salvarTemplate: false
  });
  const [adhocTerms, setAdhocTerms] = useState<PaymentTerm[]>([]);
  // Condições criadas antes das formas fixas. Vivem no jsonb da própria
  // proposta, não na biblioteca (que sempre esteve vazia) — por isso são
  // guardadas daqui, senão salvar a proposta as apagaria.
  const [legadosPgto, setLegadosPgto] = useState<any[]>([]);

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
      const [pkgRes, segRes] = await Promise.all([
        fetchApi(`/api/gd/packages?client_id=${clientId || ""}`, { headers }),
        fetchApi(`/api/gd/segments?client_id=${clientId || ""}`, { headers }),
      ]);
      if (pkgRes.ok) {
        const data = await pkgRes.json();
        if (data.success) setAvailablePackages(data.data || []);
      }
      if (segRes.ok) {
        const seg = await segRes.json();
        if (seg.success) setSegmentsList(seg.data || []);
      }
    } catch (err) {
      console.error("Erro ao carregar pacotes/segmentos:", err);
    }
  }

  // Ao editar uma proposta que usou um pacote ad_hoc (criado dentro dela), esse
  // pacote não vem no catálogo da biblioteca (loadPackagesCatalog filtra
  // ad_hoc=false). Aqui buscamos por id os pacotes referenciados pelas propostas
  // e mesclamos em availablePackages, para o wizard de edição reencontrá-los.
  async function loadReferencedPackages(props: any[]) {
    try {
      const ids = new Set<string>();
      (props || []).forEach((p: any) => {
        if (p?.package_id) ids.add(p.package_id);
        if (p?.package_vexo_id) ids.add(p.package_vexo_id);
        (Array.isArray(p?.pacotes_ofertados) ? p.pacotes_ofertados : []).forEach((id: string) => { if (id) ids.add(id); });
      });
      if (ids.size === 0) return [] as any[];
      const token = await getIdToken();
      const headers: HeadersInit = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetchApi(`/api/gd/packages?client_id=${clientId || ""}&ids=${Array.from(ids).join(",")}`, { headers });
      if (!res.ok) return [] as any[];
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setAvailablePackages((prev) => {
          const map = new Map(prev.map((p: any) => [p.id, p]));
          data.data.forEach((p: any) => map.set(p.id, p));
          return Array.from(map.values());
        });
        return data.data as any[];
      }
      return [] as any[];
    } catch (err) {
      console.error("Erro ao carregar pacotes referenciados:", err);
      return [] as any[];
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
          const isVexo = p.origem === "vexo";
          const desc = isVexo ? (String(p.nome).startsWith("Módulo:") ? p.nome : `Módulo: ${p.nome}`) : p.nome;
          finalItems.push({
            product_id: p.product_id || null,
            descricao: desc,
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
          const desc = String(p.nome).startsWith("Módulo:") ? p.nome : `Módulo: ${p.nome}`;
          if (!finalItems.some(it => it.descricao === desc)) {
            finalItems.push({
              product_id: p.product_id || null,
              descricao: desc,
              categoria: "vexo",
              valor: 0,
              recorrencia: "mensal"
            });
          }
        });
      }
    }

    // Não existe mais "avulso com valor". Um serviço está no plano (linha de
    // valor 0 vinda de produtos_incluidos, gerada acima) ou não está na
    // proposta. Antes este efeito regravava `GD: <nome> R$ X` a cada edição:
    // desde PACOTE FECHADO esse valor não somava em nada, mas continuava sendo
    // impresso com preço na proposta do cliente. Os itens legados já gravados
    // são absorvidos no escopo por planoDeProposta() ao abrir a proposta.

    const seenItemDescs = new Set<string>();
    const dedupedItems = finalItems.filter((i) => {
      const desc = String(i.descricao || "").trim();
      if (!desc) return false;
      if (Number(i.valor || 0) === 0) {
        if (seenItemDescs.has(desc)) return false;
        seenItemDescs.add(desc);
      }
      return true;
    });

    const serialize = (arr: any[]) => JSON.stringify(arr.map(i => ({ d: i.descricao, v: i.valor })));
    if (serialize(dedupedItems) !== serialize(items)) {
      setItems(dedupedItems);
    }
  }, [editPackageId, editPackageVexoId, availablePackages, vexoProducts, gdProducts, selectedProposal]);

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
      const ownerParam = isVexoCommercial ? "owner_company=vexo" : "owner_company=geracao-digital";
      const res = await fetchApi(`/api/gd/proposals?client_id=${clientId || ""}&${ownerParam}`, { headers });
      if (!res.ok) {
        throw new Error(`Falha ao buscar propostas comerciais (Status ${res.status}).`);
      }
      const data = await res.json();
      if (data.success) {
        setProposals(data.data);
        // AGUARDA: selectProposal hidrata o editor de plano a partir dos
        // pacotes referenciados. Sem o await, o editor abria vazio (escopo e
        // preços zerados) mesmo com a proposta íntegra no banco.
        const refPkgs = await loadReferencedPackages(data.data);
        if (data.data.length > 0) {
          // Mantém aberta a proposta em que o vendedor estava. Antes caía
          // sempre em data.data[0] — toda vez que loadProposals() rodava
          // (salvar, arquivar, voltar da proposta pública) a seleção pulava
          // para o primeiro cliente da lista.
          const alvoId = selectedProposalRef.current?.id || propostaIdUrl;
          const alvo = data.data.find((p: any) => p.id === alvoId) || data.data[0];
          selectProposal(alvo, refPkgs);
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

  // `pkgsRecemCarregados`: o state availablePackages ainda não refletiu o
  // fetch dos pacotes desta proposta (setState é assíncrono), então quem
  // chama passa a lista direto. Sem isso o editor de plano abria zerado.
  const selectProposal = (prop: Proposal, pkgsRecemCarregados: any[] = []) => {
    setSelectedProposal(prop);
    setProspectName(prop.prospect_name);
    setCondicoes(prop.condicoes);
    setNewCondicoes((prop as any).condicoes_especiais || (prop as any).condicao_especial || "");
    setEditEsconderValores((prop as any).esconder_valores === true);
    setItems(Array.isArray(prop.itens) ? prop.itens : []);
    setSignerName(prop.signer_name || "");
    setPaymentLink(prop.payment_link || "");
    setCobrarSetup(prop.cobrar_setup === true);
    setValorSetupVexo(Number(prop.valor_setup_vexo || 0));
    // Preço negociado só existe se a proposta gravou override no item do pacote.
    const pkgItem = (Array.isArray(prop.itens) ? prop.itens : []).find(
      (i: any) => i?.descricao?.startsWith("Pacote:") && i?.valor_override === true
    );
    setEditMensalidadeNegociada(pkgItem ? Number(pkgItem.valor || 0) : 0);
    setVpActive(!!prop.valor_vp);
    setEditValorVp(Number(prop.valor_vp || 0));
    setOfferedTermIds(
      Array.isArray(prop.condicoes_pagamento?.ofertadas)
        ? prop.condicoes_pagamento!.ofertadas.map((t) => t.id)
        : []
    );
    setFormasPgto(termsParaFormas(prop.condicoes_pagamento?.ofertadas || []));
    setLegadosPgto(termsLegados(prop.condicoes_pagamento?.ofertadas || []));
    const currentSeg = (prop as any).segment_id || "";
    const isKnownSeg = segmentsList.some((s) => s.id === currentSeg);
    if (currentSeg && !isKnownSeg) {
      setEditSegmentId("custom");
      setCustomEditSegment(currentSeg);
    } else {
      setEditSegmentId(currentSeg);
      setCustomEditSegment("");
    }
    setEditProspectLogo((prop as any).prospect_logo || null);
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
    const ofertados: string[] = Array.isArray((prop as any).pacotes_ofertados)
      ? (prop as any).pacotes_ofertados
      : ([prop.package_id, prop.package_vexo_id].filter(Boolean) as string[]);
    setEditPacotesOfertados(ofertados);
    // Reconstrói o plano (escopo × prazos) a partir das linhas de preço já
    // gravadas, para editar aqui com o mesmo editor do wizard.
    const catalogo = [...availablePackages, ...pkgsRecemCarregados];
    setEditPlano(
      planoDeProposta(
        ofertados
          .map((pid) => catalogo.find((p: any) => p.id === pid))
          .filter(Boolean),
        Array.isArray(prop.itens) ? prop.itens : [],
        prop
      )
    );
    // O escopo agora vive no plano (editPlano, acima). A hidratação antiga
    // marcava como "avulso" QUALQUER item vexo com product_id que não fosse a
    // linha do pacote — inclusive o conteúdo do próprio pacote, gravado a
    // valor 0. Era daí que saía a lista "Módulos Avulsos Extras" repetindo
    // CRM Vexo, Automação de WhatsApp, Chips, Follow-up... que já estavam
    // dentro do combo logo acima.
    setEditCarencia(
      prop.carencia_dias !== null && prop.carencia_dias !== undefined ? String(prop.carencia_dias) : ""
    );
  };

  // Live total calculations
  // Pacote fechado: o preço do pacote é o preço. Só o setup Vexo soma por fora.
  const pacoteFechado = temPacote(items);

  const setupTotal = pacoteFechado
    ? 0
    : items.filter(isCobrancaUnica).reduce((sum, i) => sum + Number(i.valor || 0), 0);

  const recurringTotal = pacoteFechado
    ? items.filter(isLinhaDePacote).reduce((sum, i) => sum + Number(i.valor || 0), 0)
    : items.filter(isCobrancaMensal).reduce((sum, i) => sum + Number(i.valor || 0), 0);

  const setupVexoValue = cobrarSetup ? Number(valorSetupVexo || 0) : 0;
  const grandTotal = setupTotal + recurringTotal + setupVexoValue;

  const offeredTerms = [...availableTerms, ...adhocTerms].filter((t) => offeredTermIds.includes(t.id));

  // Lista lateral: ativas/arquivadas + busca por empresa, status ou ID.
  const propostasFiltradas = useMemo(() => {
    const base = proposals.filter((p) => (showArchived ? p.arquivada === true : p.arquivada !== true));
    const q = buscaProposta.trim().toLowerCase();
    if (!q) return base;
    const statusLabel = (s: string) => (s === "aceita" ? "fechado" : s === "enviada" ? "enviada" : "rascunho");
    return base.filter((p) =>
      [p.prospect_name, p.status, statusLabel(p.status), p.id]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [proposals, showArchived, buscaProposta]);

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
  // Save proposal updates
  const handleSaveProposal = async () => {
    if (!selectedProposal) return;
    setPlanoSaving(true);
    try {
      const token = await getIdToken();
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      // Salvar = aplicar o plano + gravar a proposta, num clique só.
      // Antes eram DOIS botões: "Aplicar plano" gravava os preços por prazo e
      // "Salvar Configuração" gravava o resto — mas o save NÃO sincronizava o
      // plano. Quem digitava preços em Mensal/Trimestral/Semestral e clicava
      // direto em Salvar perdia os valores (ficavam só no estado do React).
      let catalogo = availablePackages;
      let pkgId = editPackageId;
      let pacotesOfertados = editPacotesOfertados;
      if (planoValido(editPlano)) {
        const r = await syncPlanoPackages({
          plano: editPlano,
          nomeBase: selectedProposal.prospect_name || "Plano",
          clientId,
          gdProducts,
          vexoProducts,
          existentes: availablePackages.filter(
            (p: any) => p?.ad_hoc && editPacotesOfertados.includes(p.id)
          ),
          getIdToken,
        });
        catalogo = [
          ...availablePackages.filter((p: any) => !r.pacotes.some((n: any) => n.id === p.id)),
          ...r.pacotes,
        ];
        pkgId = r.packageId;
        pacotesOfertados = r.pacotesOfertados;
        setAvailablePackages(catalogo);
        setEditPacotesOfertados(pacotesOfertados);
        setEditPackageId(pkgId);
      }

      // Construct finalItems array
      const finalItems: any[] = [];

      // Setup Vexo: extrai do plano em edição com fallback nos estados locais
      const setupDoPlano = Number((editPlano as any).valorSetupVexo ?? (editPlano as any).valor_setup_vexo ?? valorSetupVexo ?? 0);
      const cobrarSetupFinal = setupDoPlano > 0 ? true : (cobrarSetup || false);

      // 1. Add GD package item
      const selectedGdPkg = catalogo.find(p => p.id === pkgId && (p.tipo === "gd" || !p.tipo));
      // VP MENSAL do prazo selecionado (%, do plano). Alimenta o item (período)
      // e a coluna valor_vp da proposta (mensal). Com plano válido e % preenchido, o % manda;
      // senão, cai no VP manual antigo (editValorVp ou selectedProposal.valor_vp).
      const periodoSel = String(selectedGdPkg?.periodo || periodoPlano || selectedProposal.periodo_plano || "anual");
      const vpMensalPlano =
        Number(editPlano.vpPercent || 0) > 0 && (PERIODOS as readonly any[]).some((p) => p.key === periodoSel)
          ? vpMensalDoPrazo(editPlano, periodoSel as any)
          : (Number(editValorVp || 0) > 0 ? Number(editValorVp) : (Number(selectedProposal.valor_vp || 0) > 0 ? Number(selectedProposal.valor_vp) : 0));
      if (selectedGdPkg) {
        const val = Number(selectedGdPkg.valor || 0);
        const PERIOD_MONTHS: Record<string, number> = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };
        const meses = selectedGdPkg.periodo === "unico" ? null : (PERIOD_MONTHS[selectedGdPkg.periodo] ?? 1);
        const mensalidade = meses ? Math.round((val / meses) * 100) / 100 : val;
        const valorTabela = Number(selectedGdPkg.valor_tabela || 0);
        // Preço negociado desta proposta (fase 5a). Quando preenchido, vence o
        // pacote vivo do catálogo — é a alavanca de desconto que morava na Mesa.
        const negociada = Number(editMensalidadeNegociada || 0);
        const usaOverride = negociada > 0 && meses !== null;
        const mensalidadeFinalItem = usaOverride ? negociada : mensalidade;

        // VP do prazo selecionado, derivado do % do plano. O valor_vp do item
        // é o total do PERÍODO (o que computeVpFromItems soma no resumo). A
        // coluna valor_vp da proposta guarda o MENSAL (o que a página pública
        // usa para dividir a mensalidade).
        const vpItemPeriodo =
          meses && vpMensalPlano > 0 ? Math.round(vpMensalPlano * meses * 100) / 100 : null;

        finalItems.push({
          product_id: null,
          descricao: `Pacote: ${selectedGdPkg.nome} (${selectedGdPkg.periodo === "unico" ? "Setup" : "Recorrência"})`,
          categoria: "gd",
          valor: mensalidadeFinalItem,
          valor_vp: vpItemPeriodo,
          valor_override: usaOverride || undefined,
          recorrencia: meses ? "mensal" : "unico",
          periodo: selectedGdPkg.periodo,
          meses,
          total_periodo: meses ? (usaOverride ? mensalidadeFinalItem * meses : val) : null,
          valor_tabela: valorTabela > val ? valorTabela : null
        });

        if (Array.isArray(selectedGdPkg.produtos_incluidos)) {
          selectedGdPkg.produtos_incluidos.forEach((p: any) => {
            const isVexo = p.origem === "vexo";
            const desc = isVexo ? (String(p.nome).startsWith("Módulo:") ? p.nome : `Módulo: ${p.nome}`) : p.nome;
            finalItems.push({
              product_id: p.product_id || null,
              descricao: desc,
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
            const desc = String(p.nome).startsWith("Módulo:") ? p.nome : `Módulo: ${p.nome}`;
            if (!finalItems.some(it => it.descricao === desc)) {
              finalItems.push({
                product_id: p.product_id || null,
                descricao: desc,
                categoria: "vexo",
                valor: 0,
                recorrencia: "mensal"
              });
            }
          });
        }
      }

      // Deduplica itens por descrição (evita repetições de valor zero)
      const seenItens = new Set<string>();
      const dedupedFinalItems = finalItems.filter((i) => {
        const desc = String(i.descricao || "").trim();
        if (!desc) return false;
        if (Number(i.valor || 0) === 0) {
          if (seenItens.has(desc)) return false;
          seenItens.add(desc);
        }
        return true;
      });

      // Nada de avulso com valor: um serviço está no plano ou não está na
      // proposta. Ver o efeito de montagem de itens acima.

      let updatedSlides = Array.isArray(selectedProposal.presentation_slides) && selectedProposal.presentation_slides.length > 0
        ? JSON.parse(JSON.stringify(selectedProposal.presentation_slides))
        : null;

      if (updatedSlides) {
        const gdItems: string[] = [];
        const pkgItem = dedupedFinalItems.find((it: any) => {
          const desc = String(it.descricao || it.nome || "").trim();
          return desc.toLowerCase().startsWith("pacote:") && !desc.toLowerCase().includes("vexo");
        });
        if (pkgItem) {
          gdItems.push(pkgItem.descricao || pkgItem.nome);
        }

        dedupedFinalItems.forEach((it: any) => {
          const desc = String(it.descricao || it.nome || "").trim();
          const cat = String(it.categoria || "").toLowerCase();
          if (!desc) return;
          if (desc.toLowerCase().startsWith("pacote:") && !desc.toLowerCase().includes("vexo")) return;
          const isVexo = cat === "vexo" || desc.toLowerCase().includes("plano") || desc.toLowerCase().includes("vexo") || desc.toLowerCase().includes("chatbot");
          if (!isVexo) {
            if (!gdItems.includes(desc)) gdItems.push(desc);
          }
        });

        const vexoItems: string[] = [];
        dedupedFinalItems.forEach((it: any) => {
          const desc = String(it.descricao || it.nome || "").trim();
          const cat = String(it.categoria || "").toLowerCase();
          if (!desc) return;
          if (desc.toLowerCase().startsWith("pacote:") && !desc.toLowerCase().includes("vexo")) return;
          const isVexo = cat === "vexo" || desc.toLowerCase().includes("plano") || desc.toLowerCase().includes("vexo") || desc.toLowerCase().includes("chatbot");
          if (isVexo) {
            if (!vexoItems.includes(desc)) vexoItems.push(desc);
          }
        });
        if (vexoItems.length === 0) {
          vexoItems.push("Plano Avançado Vexo OS", "Chatbot IA de Qualificação", "Jornadas de Follow-up");
        }

        updatedSlides = updatedSlides.map((s: any) => {
          if (s.kind === "partnership" || s.id === 5) {
            return {
              ...s,
              fronts: [
                {
                  label: "Geração Digital",
                  tag: "Atração & Posicionamento",
                  items: gdItems.length > 0 ? gdItems : ["Gestão de Redes Sociais", "Tráfego Pago", "Posicionamento"],
                },
                {
                  label: "Vexo Atendimento",
                  tag: "IA & Automação Comercial",
                  items: vexoItems,
                },
              ],
            };
          }
          return s;
        });
      }

      const finalPeriodoPlano = (() => {
        const gdPkg = catalogo.find((p: any) => p.id === pkgId && (p.tipo === "gd" || !p.tipo));
        const vexoPkg = catalogo.find((p: any) => p.id === editPackageVexoId && p.tipo === "vexo");
        return gdPkg?.periodo || vexoPkg?.periodo || selectedProposal.periodo_plano || "mensal";
      })();

      const body = {
        client_id: clientId,
        prospect_name: prospectName,
        package_id: pkgId || null,
        // Reenvia a lista de prazos ofertados, agora derivada do próprio plano
        // na tela (pacotesOfertados). O clobber 3→1 do Dr. Diogo vinha de mandar
        // uma lista vazia quando o editor abria zerado — bug já corrigido. Com
        // a lista vindo do plano visível, reenviar é correto e necessário: é o
        // que faz os prazos novos (Mensal/Trimestral/Semestral) entrarem.
        pacotes_ofertados: pacotesOfertados,
        package_vexo_id: editPackageVexoId || null,
        itens: dedupedFinalItems,
        presentation_slides: updatedSlides || undefined,
        condicoes,
        payment_link: paymentLink,
        cobrar_setup: cobrarSetupFinal,
        // Mantém o valor gravado mesmo isentando, para exibir o riscado.
        valor_setup_vexo: setupDoPlano > 0 ? setupDoPlano : (cobrarSetupFinal && Number(valorSetupVexo || 0) > 0 ? Number(valorSetupVexo) : null),
        segment_id: editSegmentId === "custom" ? (customEditSegment.trim() || "custom") : (editSegmentId || null),
        custom_segment_name: editSegmentId === "custom" ? (customEditSegment.trim() || null) : null,
        prospect_logo: editProspectLogo || null,
        condicoes_pagamento: {
          // Formas fixas primeiro; condições legadas da biblioteca seguem
          // sendo gravadas enquanto estiverem marcadas.
          ofertadas: [...formasParaTerms(formasPgto, finalPeriodoPlano), ...legadosPgto],
          escolhida: selectedProposal.condicoes_pagamento?.escolhida ?? null
        },
        periodo_plano: finalPeriodoPlano,
        validade_ate: validadeAte ? new Date(`${validadeAte}T23:59:59`).toISOString() : null,
        valor_apos_validade: valorAposValidade !== "" ? Number(valorAposValidade) : null,
        observacao_validade: observacaoValidade || null,
        carencia_dias: editCarencia !== "" ? Number(editCarencia) : null,
        // Coluna valor_vp = VP MENSAL do prazo selecionado (a página pública
        // divide a mensalidade por ele). Vem do % do plano, com fallback no
        // VP manual antigo.
        valor_vp: vpMensalPlano > 0 ? vpMensalPlano : null,
        vp_percent: Number(editPlano.vpPercent || 0) > 0 ? Number(editPlano.vpPercent) : null,
        condicoes_especiais: newCondicoes || (editPlano as any).condicoesEspeciais || null,
        esconder_valores: editEsconderValores,
        desconto_setup_pct: (editPlano as any).descontoSetupPorcentagem ?? (editPlano as any).desconto_setup_pct ?? 0,
        descontos_por_periodo: editPlano.descontosPorPeriodo || null,
        desconto_mensal_pct: (() => {
          const p = (finalPeriodoPlano || "mensal") as PeriodoKey;
          if (editPlano.descontosPorPeriodo && editPlano.descontosPorPeriodo[p] !== undefined) {
            return Number(editPlano.descontosPorPeriodo[p] || 0);
          }
          return (editPlano as any).descontoMensalPorcentagem ?? (editPlano as any).desconto_mensal_pct ?? 0;
        })(),
        vexo_plan: (editPlano as any).vexoPlan || null,
        vexo_price: (editPlano as any).vexoPlan === "essencial" ? 397 : (editPlano as any).vexoPlan === "avancado" ? 897 : 0,
        owner_company: isVexoCommercial ? "vexo" : ((selectedProposal as any).owner_company || "geracao-digital")
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
        if (updatedSlides) {
          setSelectedProposal(prev => prev ? { ...prev, presentation_slides: updatedSlides } : prev);
        }
        loadProposals();
        // Recarrega o preview e volta para ele: salvar é o fim da edição.
        setPreviewNonce((n) => n + 1);
        setShowConfig(false);
      }
    } catch (err: any) {
      console.error(err);
      toast({
        title: "Erro ao Salvar",
        description: err.message || "Falha de comunicação com o servidor ao salvar proposta.",
        variant: "destructive"
      });
    } finally {
      setPlanoSaving(false);
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

  // Reabrir proposta aceita (ação restrita a gestores/admins)
  const handleReopenProposal = async () => {
    if (!selectedProposal) return;
    setIsReopening(true);
    try {
      const token = await getIdToken();
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetchApi(`/api/gd/proposals/${selectedProposal.id}/reopen`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          client_id: clientId,
          motivo: reopenMotivo.trim() || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Erro ao reabrir proposta.");
      }

      toast({
        title: "Proposta Reaberta",
        description: "Status retornado para rascunho. As evidências da assinatura anterior foram preservadas.",
      });

      setShowReopenModal(false);
      setReopenMotivo("");
      if (data.proposal) {
        setSelectedProposal(data.proposal);
      }
      loadProposals();
    } catch (err: any) {
      console.error(err);
      toast({
        title: "Erro ao Reabrir",
        description: err.message || "Falha ao reabrir proposta no servidor.",
        variant: "destructive",
      });
    } finally {
      setIsReopening(false);
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
      setShareTarget(selectedProposal);
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
    <PageShellContext.Provider value={isVexoCommercial}>
      <PageShell
        title={isVexoCommercial ? "Propostas Comerciais Vexo OS" : "Propostas Comerciais GD"}
        subtitle={isVexoCommercial ? "Editor de propostas, apresentações integradas e termos de aceite comercial do Vexo OS." : "Editor de itens, termos de aceite comercial e assinatura eletrônica para fechamento de contratos."}
        icon={FileText}
      >
        {!isVexoCommercial && <GeracaoDigitalTabs />}
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
          showNewForm ? (
            <div className="w-full relative z-10">
              <ProposalWizard
                onClose={() => { setShowNewForm(false); resetWizard(); }}
                availablePackages={availablePackages}
                vexoProducts={vexoProducts}
                gdProducts={gdProducts}
                availableTerms={availableTerms}
                wizardState={wizardState}
                toast={toast}
                clientId={clientId}
                getIdToken={getIdToken}
                onPackageCreated={(pkg) => setAvailablePackages((prev) => [...prev, pkg])}
                segmentsList={segmentsList}
                isVexoCommercial={isVexoCommercial}
              />
            </div>
          ) : (
            <Card className="bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-white/10 text-center max-w-lg mx-auto py-12 relative z-10 shadow-sm">
              <CardContent className="space-y-4">
                <FileText className="h-12 w-12 text-slate-400 mx-auto" />
                <h3 className="text-lg font-bold text-slate-800 dark:text-white">
                  {isVexoCommercial ? "Nenhuma Proposta Vexo OS Gerada" : "Nenhuma Proposta Gerada"}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {isVexoCommercial
                    ? "Crie sua primeira proposta comercial para apresentar o software Vexo OS e gerar slides sob medida com IA."
                    : "Inicie uma apresentação comercial a partir da aba \"Geração Digital\" e escolha um pacote — ou crie uma proposta direta abaixo."}
                </p>
                <Button
                  size="sm"
                  onClick={() => { setShowNewForm(true); resetWizard(); }}
                  className="bg-gradient-to-r from-purple-700 to-indigo-600 hover:opacity-90 text-white font-bold text-xs"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {isVexoCommercial ? "+ Nova Proposta Vexo OS" : "Nova Proposta"}
                </Button>
              </CardContent>
            </Card>
          )
        ) : (
          <div className="grid gap-6 lg:grid-cols-4 relative z-10">
            {showNewForm && (
              <div className="lg:col-span-4">
                <ProposalWizard
                  onClose={() => { setShowNewForm(false); resetWizard(); }}
                  availablePackages={availablePackages}
                  vexoProducts={vexoProducts}
                  gdProducts={gdProducts}
                  availableTerms={availableTerms}
                  wizardState={wizardState}
                  toast={toast}
                  clientId={clientId}
                  getIdToken={getIdToken}
                  onPackageCreated={(pkg) => setAvailablePackages((prev) => [...prev, pkg])}
                  segmentsList={segmentsList}
                  isVexoCommercial={isVexoCommercial}
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
              {/* Busca */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <Input
                  value={buscaProposta}
                  onChange={(e) => setBuscaProposta(e.target.value)}
                  placeholder="Buscar por empresa, status ou ID..."
                  className="pl-8 h-8 text-xs"
                />
              </div>

              {/* Ativos / Arquivados + visualização */}
              <div className="flex items-center gap-1.5">
                <div className="flex flex-1 rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden">
                  <button
                    onClick={() => { setShowArchived(false); setSelectedProposal(null); }}
                    className={cn("flex-1 px-2 py-1.5 text-[10px] font-bold transition-colors", !showArchived ? "bg-purple-650 text-white" : "text-slate-600 dark:text-slate-300")}
                  >
                    Ativas
                  </button>
                  <button
                    onClick={() => { setShowArchived(true); setSelectedProposal(null); }}
                    className={cn("flex-1 px-2 py-1.5 text-[10px] font-bold transition-colors", showArchived ? "bg-purple-650 text-white" : "text-slate-600 dark:text-slate-300")}
                  >
                    Arquivadas
                  </button>
                </div>
                <div className="flex rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden">
                  <button
                    onClick={() => setViewProposta("cards")}
                    aria-label="Visualizar em cards"
                    className={cn("px-2 py-1.5 transition-colors", viewProposta === "cards" ? "bg-purple-650 text-white" : "text-slate-600 dark:text-slate-300")}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setViewProposta("list")}
                    aria-label="Visualizar em lista"
                    className={cn("px-2 py-1.5 transition-colors", viewProposta === "list" ? "bg-purple-650 text-white" : "text-slate-600 dark:text-slate-300")}
                  >
                    <ListIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {propostasFiltradas.length === 0 && (
                <p className="text-[10px] text-slate-400 italic px-2">
                  {buscaProposta
                    ? "Nenhuma proposta encontrada."
                    : showArchived ? "Nenhuma proposta arquivada." : "Nenhuma proposta ativa."}
                </p>
              )}

              {/* Visualização compacta em lista */}
              {viewProposta === "list" && propostasFiltradas.map((prop) => (
                <button
                  key={prop.id}
                  onClick={() => selectProposal(prop)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-lg border transition-all flex items-center justify-between gap-2",
                    selectedProposal?.id === prop.id
                      ? "bg-slate-50 dark:bg-slate-850 border-purple-500/50"
                      : "bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10 hover:border-slate-350 dark:hover:border-white/20"
                  )}
                >
                  <div className="min-w-0">
                    <span className="text-[11px] font-black text-slate-800 dark:text-slate-100 truncate block">{prop.prospect_name}</span>
                    <span className="text-[9px] text-slate-500 font-mono dark:text-slate-400">
                      R$ {calculateProposalValues(prop, availablePackages).totalGeral.toLocaleString("pt-BR")}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "text-[8px] uppercase font-bold px-1.5 py-0.5 rounded shrink-0 text-white",
                      prop.status === "aceita" ? "bg-emerald-500" : prop.status === "enviada" ? "bg-blue-600" : "bg-amber-600"
                    )}
                  >
                    {prop.status === "aceita" ? "Fechado" : prop.status === "enviada" ? "Enviada" : "Rascunho"}
                  </span>
                </button>
              ))}

              {viewProposta === "cards" && propostasFiltradas.map((prop) => (
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
                      <span className="text-slate-850 dark:text-slate-100 font-bold">R$ {calculateProposalValues(prop, availablePackages).totalGeral.toLocaleString("pt-BR")}</span>
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
                          navigate(`/proposta/${prop.id}`);
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

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => setShowGenerateContract(true)}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold shrink-0"
                      title={selectedProposal.status !== "aceita" ? "Gerar contrato preliminar mesmo com proposta não aceita" : "Gerar contrato jurídico a partir desta proposta"}
                    >
                      <FileText className="h-4 w-4 mr-1.5" />
                      Gerar Contrato Jurídico
                    </Button>

                    {selectedProposal.status === "aceita" && isManagerOrAdmin(accessProfile) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowReopenModal(true)}
                        className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700/50 dark:text-amber-400 dark:hover:bg-amber-950/20 shrink-0 font-medium"
                      >
                        <RotateCcw className="h-4 w-4 mr-1.5" />
                        Reabrir Proposta
                      </Button>
                    )}

                    {/* Um único editor. O antigo "Gerar/Editar Proposta" abria o
                        wizard — que, desde que o painel de configuração ganhou o
                        PlanoEditor, fazia exatamente a mesma coisa em 4 passos.
                        O wizard ficou só para CRIAR. */}
                    {selectedProposal.status !== "aceita" && (
                      <Button
                        size="sm"
                        onClick={() => setShowConfig((v) => !v)}
                        className="bg-purple-600 hover:bg-purple-500 text-white font-bold shrink-0"
                      >
                        <Edit className="h-4 w-4 mr-1.5" />
                        {showConfig ? "Fechar edição" : "Editar Proposta"}
                      </Button>
                    )}
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

                {/* Alerta de Reabertura quando aplicável */}
                {((selectedProposal as any).condicoes_pagamento?.reabertura ||
                  (selectedProposal.status === "rascunho" && selectedProposal.signed_at)) && (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-3 shadow-sm">
                    <RotateCcw className="h-5 w-5 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
                    <div className="space-y-1">
                      <p className="font-bold text-sm text-amber-800 dark:text-amber-300">
                        Proposta reaberta após aceite original
                        {selectedProposal.signed_at && (
                          <span className="font-normal text-xs ml-1 opacity-90">
                            · Assinatura original em {new Date(selectedProposal.signed_at).toLocaleString("pt-BR")}
                            {selectedProposal.signer_name && ` por ${selectedProposal.signer_name}`}
                          </span>
                        )}
                      </p>
                      {(selectedProposal as any).condicoes_pagamento?.reabertura && (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          Reaberto em {new Date((selectedProposal as any).condicoes_pagamento.reabertura.reaberto_em).toLocaleString("pt-BR")}
                          {(selectedProposal as any).condicoes_pagamento.reabertura.reaberto_por && ` por ${(selectedProposal as any).condicoes_pagamento.reabertura.reaberto_por}`}
                          {(selectedProposal as any).condicoes_pagamento.reabertura.motivo && ` — Motivo: "${(selectedProposal as any).condicoes_pagamento.reabertura.motivo}"`}
                        </p>
                      )}
                      <p className="text-[11px] text-amber-600/90 dark:text-amber-500">
                        As evidências jurídicas da assinatura original (nome, data, IP e método de aceite) estão integralmente preservadas no histórico.
                      </p>
                    </div>
                  </div>
                )}

                {/* Visualização Consolidada da Proposta (Somente Leitura) */}
                <Card className="bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-white/10 shadow-sm">
                  <CardHeader className="pb-3 border-b border-slate-200 dark:border-white/5">
                    <CardTitle className="text-base font-bold text-slate-800 dark:text-slate-100">
                      Resumo da Proposta Comercial
                    </CardTitle>
                    <CardDescription className="text-[11px] text-slate-500 dark:text-slate-400">
                      Exatamente o que o cliente vê. Use "Editar Proposta" para ajustar valores, escopo e condições.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-6">
                    {/* Ações contextuais internas da Proposta */}
                    <div className="flex flex-wrap items-center gap-2 pb-4 border-b border-slate-150 dark:border-white/5">
                      <Button
                        size="sm"
                        onClick={() => navigate(`/crm/propostas-gd/${selectedProposal.id}/apresentacao`)}
                        className="bg-gradient-to-r from-purple-700 to-indigo-600 hover:opacity-90 text-white font-bold"
                      >
                        <Play className="h-4 w-4 mr-1.5" />
                        Iniciar Apresentação
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleOpenPitchGenerator}
                        className="border-purple-500/40 text-purple-700 hover:bg-purple-50 dark:border-purple-500/30 dark:text-purple-300 dark:hover:bg-purple-950/40 font-semibold"
                      >
                        <Sparkles className="h-4 w-4 mr-1.5 text-purple-600 dark:text-purple-400" />
                        Gerar Pitch com IA
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowSlideEditorModal(true)}
                        className="border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 font-semibold"
                      >
                        <Layers className="h-4 w-4 mr-1.5 text-purple-500" />
                        Editar Slides Visualmente
                      </Button>

                      {selectedProposal.status !== "aceita" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/proposta/${selectedProposal.id}`)}
                          className="border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 font-semibold"
                        >
                          <ExternalLink className="h-4 w-4 mr-1.5" />
                          Abrir Proposta
                        </Button>
                      )}

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleSendToClient}
                        className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-950/30 font-semibold"
                      >
                        <Share2 className="h-4 w-4 mr-1.5" />
                        Enviar ao Cliente
                      </Button>
                    </div>

                    {/* Preview: a MESMA página que o cliente recebe, embutida.
                        Evita um segundo render da proposta que divergiria com o
                        tempo — o preview não pode virar outra fonte de verdade. */}
                    {!showConfig && (
                      <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-white/10 bg-slate-950">
                        <iframe
                          key={`${selectedProposal.id}-${previewNonce}`}
                          src={`/proposta/${selectedProposal.id}?embed=1`}
                          title="Pré-visualização da proposta"
                          className="w-full h-[70vh] block"
                        />
                      </div>
                    )}

                    {/* Configuração da Proposta — interativa, editável ao vivo com o cliente */}
                    {showConfig && selectedProposal.status !== "aceita" && (
                      <div className="p-4 rounded-xl bg-white dark:bg-slate-800/40 border border-purple-200 dark:border-purple-900/30 space-y-4">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-black text-purple-700 dark:text-purple-300 uppercase tracking-wider">Configuração da Proposta</h4>
                        </div>

                        {/* Segmento e logo moraram só no wizard até agora. Com o
                            wizard restrito a criar, precisam existir aqui — senão
                            não haveria como trocar o roteiro da apresentação nem
                            a marca do cliente depois que a proposta existe. */}
                        <div className="flex flex-wrap items-end gap-4">
                          {/* Nome do prospect: o estado já era carregado e já ia
                              no corpo do save, mas não havia campo — depois de
                              criada a proposta não dava para corrigir o nome que
                              aparece na apresentação e no PDF. */}
                          <div className="space-y-1">
                            <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">Nome da empresa (aparece na apresentação)</Label>
                            <input
                              type="text"
                              value={prospectName}
                              onChange={(e) => setProspectName(e.target.value)}
                              placeholder="Ex.: Clínica Dr. Diogo Teodoro"
                              className="block w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-2 h-8 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">Segmento (roteiro da apresentação)</Label>
                            <select
                              value={editSegmentId}
                              onChange={(e) => {
                                setEditSegmentId(e.target.value);
                                if (e.target.value !== "custom") setCustomEditSegment("");
                              }}
                              className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-2 h-8 text-xs text-slate-800 dark:text-white focus:outline-none"
                            >
                              <option value="">Selecione o segmento…</option>
                              <option value="custom" className="font-bold text-purple-600 dark:text-purple-400">
                                ✨ Outro Segmento (Personalizado com IA)...
                              </option>
                              {(() => {
                                  const allSegs = [...segmentsList];
                                  if (!allSegs.some(s => String(s.nome).toLowerCase().includes("turismo"))) {
                                    allSegs.push({ id: "turismo", nome: "Agências de Turismo & Viagens" });
                                  }
                                  if (!allSegs.some(s => String(s.nome).toLowerCase().includes("cafeteria") || String(s.nome).toLowerCase().includes("café"))) {
                                    allSegs.push({ id: "cafeteria", nome: "Cafeterias, Bistrôs & Cafés Especiais" });
                                  }
                                  allSegs.sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
                                  return allSegs.map((sg: any) => (
                                    <option key={sg.id} value={sg.id}>{sg.nome}</option>
                                  ));
                                })()}
                            </select>
                            {editSegmentId === "custom" && (
                              <input
                                type="text"
                                value={customEditSegment}
                                onChange={(e) => setCustomEditSegment(e.target.value)}
                                placeholder="Digite o nicho livre..."
                                className="block w-64 bg-white dark:bg-slate-900 border border-purple-300 dark:border-purple-800 rounded-lg px-2 h-8 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-purple-500 mt-1"
                              />
                            )}
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">Logo do cliente</Label>
                            <div className="flex items-center gap-2">
                              {editProspectLogo && (
                                <img src={editProspectLogo} alt="logo" className="h-8 w-8 rounded object-contain border border-slate-200 dark:border-slate-700 bg-white" />
                              )}
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  const reader = new FileReader();
                                  reader.onload = () => setEditProspectLogo(reader.result as string);
                                  reader.readAsDataURL(file);
                                }}
                                className="text-[10px] text-slate-500 dark:text-slate-400 file:mr-2 file:rounded file:border-0 file:bg-indigo-50 file:px-2 file:py-0.5 file:text-indigo-600 file:text-[10px]"
                              />
                              {editProspectLogo && (
                                <button type="button" onClick={() => setEditProspectLogo(null)} className="text-[10px] text-slate-500 hover:underline">Remover</button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Alavancas de negociação — antes só existiam na Mesa (fase 5a). */}
                        <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-slate-100 dark:border-white/5">
                          <div className="space-y-1">
                            <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">Mensalidade negociada (R$)</Label>
                            <Input
                              type="number"
                              placeholder="usa o pacote"
                              value={editMensalidadeNegociada === 0 ? "" : editMensalidadeNegociada}
                              onChange={(e) => setEditMensalidadeNegociada(e.target.value === "" ? 0 : Number(e.target.value))}
                              className="bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10 text-xs h-8 w-44 font-mono"
                            />
                            <span className="block text-[9px] text-slate-450">
                              Vazio = usa o preço do pacote. Preenchido, vence o catálogo só nesta proposta.
                            </span>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">Carência do 1º vencimento</Label>
                            <select
                              value={editCarencia}
                              onChange={(e) => setEditCarencia(e.target.value)}
                              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded px-2 text-xs text-slate-850 dark:text-white h-8"
                            >
                              <option value="">Imediato (na contratação)</option>
                              <option value="15">15 dias</option>
                              <option value="20">20 dias</option>
                              <option value="30">30 dias</option>
                            </select>
                            <span className="block text-[9px] text-slate-450">Não altera valores — só a data.</span>
                          </div>
                        </div>

                        {/* Formas de pagamento fixas — o caminho principal.
                            A biblioteca de condições continua abaixo só para
                            casos que fujam dessas seis. */}
                        <div className="pt-3 border-t border-slate-100 dark:border-white/5">
                          {(() => {
                            const setupVal = Number((editPlano as any).valorSetupVexo ?? (editPlano as any).valor_setup_vexo ?? valorSetupVexo ?? 0);
                            const cobrar = setupVal > 0 || cobrarSetup;
                            const c = calculateProposalValues(
                              {
                                cobrar_setup: cobrar,
                                valor_setup_vexo: setupVal,
                                package_id: editPackageId || null,
                                package_vexo_id: editPackageVexoId || null,
                                periodo_plano: periodoPlano || "mensal",
                                itens: items,
                                desconto_setup_pct: (editPlano as any).descontoSetupPorcentagem ?? (editPlano as any).desconto_setup_pct ?? 0,
                                desconto_mensal_pct: (editPlano as any).descontoMensalPorcentagem ?? (editPlano as any).desconto_mensal_pct ?? 0,
                                descontos_por_periodo: editPlano.descontosPorPeriodo,
                                vp_percent: editPlano.vpPercent,
                              },
                              availablePackages
                            );
                            return (
                              <FormasPagamentoEditor
                                formas={formasPgto}
                                onChange={setFormasPgto}
                                totalSetup={c.setupFinal}
                                mensalidade={c.mensalidadeFinal}
                                meses={c.mesesPeriodo}
                                condicaoEspecialTexto={newCondicoes}
                                onCondicaoEspecialChange={setNewCondicoes}
                                esconderValores={editEsconderValores}
                                onEsconderValoresChange={setEditEsconderValores}
                              />
                            );
                          })()}
                        </div>

                        {/* A biblioteca de condições foi removida: a tabela
                            gd_payment_terms nunca teve uma linha e as seis
                            formas fixas acima cobrem todos os casos reais.
                            Condições legadas seguem gravadas na proposta
                            (legadosPgto) e são preservadas ao salvar. */}


                        {/* Plano: escopo × prazos, o mesmo editor do wizard.
                            Antes não dava para trocar o plano aqui — só os
                            valores —, o que obrigava a recriar a proposta. */}
                        <div className="pt-3 border-t border-slate-100 dark:border-white/5 space-y-3">
                          <PlanoEditor
                            plano={editPlano}
                            onChange={(novoPlano) => {
                              setEditPlano(novoPlano);
                              const setupVal = Number((novoPlano as any).valorSetupVexo ?? (novoPlano as any).valor_setup_vexo ?? 0);
                              setValorSetupVexo(setupVal);
                              setCobrarSetup(setupVal > 0);
                              if (novoPlano.vpPercent > 0) {
                                setVpActive(true);
                              }
                            }}
                            gdProducts={gdProducts}
                            vexoProducts={vexoProducts}
                            isVexoCommercial={isVexoCommercial}
                          />
                        </div>

                        {/* Um botão só: aplica o plano e grava a proposta. O
                            "Aplicar plano" separado foi removido — era o passo
                            que ninguém sabia que precisava dar. */}
                        <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-white/5">
                          <Button size="sm" disabled={planoSaving} onClick={handleSaveProposal} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs">
                            {planoSaving ? "Salvando..." : "Salvar Configuração"}
                          </Button>
                        </div>
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


      {/* Modal de Compartilhamento da Proposta — usa shareTarget (capturado no
          clique), não selectedProposal, que pode ter sido resetado por loadProposals. */}
      {shareTarget && (
        <ShareProposalDialog
          open={showSendModal}
          onOpenChange={(v) => { setShowSendModal(v); if (!v) setShareTarget(null); }}
          proposalId={shareTarget.id}
          prospectName={shareTarget.prospect_name}
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
          proposalStatus={selectedProposal.status}
          initialData={buildContractInitialData(selectedProposal, availablePackages)}
        />
      )}

      {/* Modal de confirmação para Reabrir Proposta Aceita */}
      {selectedProposal && showReopenModal && (
        <Dialog open={showReopenModal} onOpenChange={setShowReopenModal}>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <RotateCcw className="h-5 w-5" />
                Reabrir Proposta Aceita
              </DialogTitle>
              <DialogDescription className="text-slate-600 dark:text-slate-300 pt-2">
                Você está prestes a reabrir a proposta de <strong>{selectedProposal.prospect_name}</strong>.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-3">
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-800 dark:text-amber-300 space-y-1">
                <p className="font-semibold">O que acontece ao reabrir:</p>
                <ul className="list-disc list-inside space-y-0.5 opacity-90">
                  <li>O status volta para <strong>Rascunho</strong>, permitindo editar valores, escopo e prazos.</li>
                  <li>Todas as evidências da assinatura original (nome, IP, data) são <strong>preservadas</strong> no histórico.</li>
                  <li>Um registro de auditoria com data e usuário será gravado na proposta.</li>
                </ul>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="reopen-motivo" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Motivo da reabertura (opcional):
                </Label>
                <Textarea
                  id="reopen-motivo"
                  placeholder="Ex: Cliente solicitou upgrade de escopo / ajuste na forma de pagamento..."
                  value={reopenMotivo}
                  onChange={(e) => setReopenMotivo(e.target.value)}
                  className="text-xs resize-none h-20"
                />
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowReopenModal(false);
                  setReopenMotivo("");
                }}
                disabled={isReopening}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={handleReopenProposal}
                disabled={isReopening}
                className="bg-amber-600 hover:bg-amber-500 text-white font-bold"
              >
                {isReopening ? "Reabrindo..." : "Confirmar Reabertura"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Modal de Briefing Rápido da Reunião para Gerar Pitch com IA */}
      {selectedProposal && (
        <PitchBriefingModal
          open={showBriefingModal}
          onOpenChange={setShowBriefingModal}
          proposalId={selectedProposal.id}
          prospectName={selectedProposal.prospect_name}
          segmentName={
            selectedProposal.segment_id === "cafeteria"
              ? "Cafeterias, Bistrôs & Cafés Especiais"
              : selectedProposal.segment_id === "turismo"
              ? "Agências de Turismo & Viagens"
              : segmentsList.find((s) => s.id === selectedProposal.segment_id)?.nome ||
                selectedProposal.segment_id ||
                null
          }
          initialNotes={selectedProposal.meeting_notes}
          onPitchGenerated={handlePitchGenerated}
        />
      )}

      {/* Modal de Edição Visual de Slides do Pitch */}
      {selectedProposal && (
        <SlideEditorModal
          open={showSlideEditorModal}
          onOpenChange={setShowSlideEditorModal}
          proposalId={selectedProposal.id}
          proposalName={selectedProposal.prospect_name}
          segmentName={
            selectedProposal.segment_id === "cafeteria"
              ? "Cafeterias, Bistrôs & Cafés Especiais"
              : selectedProposal.segment_id === "turismo"
              ? "Agências de Turismo & Viagens"
              : segmentsList.find((s) => s.id === selectedProposal.segment_id)?.nome ||
                selectedProposal.segment_id ||
                null
          }
          meetingNotes={selectedProposal.meeting_notes}
          initialSlides={selectedProposal.presentation_slides}
          onSlidesSaved={(newSlides) => {
            setSelectedProposal((prev) => (prev ? { ...prev, presentation_slides: newSlides } : prev));
            setProposals((prev) =>
              prev.map((p) => (p.id === selectedProposal.id ? { ...p, presentation_slides: newSlides } : p))
            );
          }}
        />
      )}
    </PageShell>
    </PageShellContext.Provider>
  );
}
