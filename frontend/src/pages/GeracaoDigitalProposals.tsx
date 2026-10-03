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
import { planoValido } from "@/lib/geracaoDigital/plano";
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
  Layers,
  RotateCcw,
  ChevronDown,
  Calendar,
} from "lucide-react";
import { getStableColor } from "@/lib/stableColor";
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
import { useViewMode } from "@/hooks/useViewMode";
import { ViewModeToggle } from "@/components/ViewModeToggle";
import { RecordView, type RecordCardState, type RecordField } from "@/components/records/RecordView";
import { useProposalEditor } from "@/hooks/useProposalEditor";
import { ProposalEditor } from "@/components/geracaoDigital/ProposalEditor";
import {
  type EditorMode,
  PROPOSTA_BASE_VAZIA,
  buildProposalBody,
  emptyProposalEditorValues,
  proposalEditorValuesFromProposal,
  validateProposalEditor,
} from "@/lib/geracaoDigital/proposalEditorModel";

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

  // O formulário único de proposta (criar e editar). Um objeto só — ver proposalEditorModel.ts.
  const editor = useProposalEditor();
  const ev = editor.values;
  // true = o formulário está em modo "Nova Proposta" (a proposta ainda não existe). O ref espelha o
  // estado para os handlers com closure antiga: uma carga de propostas que termina DEPOIS de abrir
  // "Nova Proposta" (atalho por URL) não pode apagar o que o vendedor já começou a preencher.
  const [isCreating, setIsCreatingState] = useState<boolean>(false);
  const isCreatingRef = useRef<boolean>(false);
  const setIsCreating = (v: boolean) => {
    isCreatingRef.current = v;
    setIsCreatingState(v);
  };
  // Itens derivados do pacote escolhido (a lista que o efeito abaixo mantém em sincronia)
  const [items, setItems] = useState<ProposalItem[]>([]);
  const [planoSaving, setPlanoSaving] = useState<boolean>(false);

  // Condições de pagamento
  const [availableTerms, setAvailableTerms] = useState<PaymentTerm[]>([]);
  const [offeredTermIds, setOfferedTermIds] = useState<string[]>([]);
  // Formas fixas de pagamento (Pix/cartão) marcadas nesta proposta.
  // Corpo do card: preview por padrão, formulário só quando pedido.
  const [showConfig, setShowConfig] = useState<boolean>(false);
  // Muda para forçar o iframe do preview a recarregar depois de salvar.
  const [previewNonce, setPreviewNonce] = useState<number>(0);

  // Mesa de negociação

  // Arquivadas
  const [showArchived, setShowArchived] = useState<boolean>(false);
  // Busca e modo de visualização da lista lateral de propostas.
  // A preferência de visualização persiste: antes voltava para cards toda vez
  // que se saía e voltava na aba.
  const [buscaProposta, setBuscaProposta] = useState<string>("");
  // Modo cartão/lista: o mesmo alternador das outras abas, lembrado por aba (e herda a escolha antiga, se houver).
  const view = useViewMode("propostas", {
    key: "gd_propostas_view",
    map: (raw) => (raw === "list" ? "list" : raw === "cards" ? "card" : null),
  });

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

  // "Nova Proposta": abre o MESMO formulário da edição, com os campos vazios.
  const startNewProposal = (prefillName = "") => {
    editor.reset(emptyProposalEditorValues({ prospectName: prefillName }));
    setIsCreating(true);
    setShowConfig(false);
  };

  // Auto-carrega dados do lead e abre o formulário de proposta quando navega de Ações Rápidas (Conversas)
  const location = useLocation();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const phone = params.get("phone");
    const nome = params.get("nome") || params.get("prospect");
    if (phone || nome) {
      startNewProposal(nome || phone || "");
    }
  }, [location.search]);


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
    const selectedGdPkg = availablePackages.find(p => p.id === ev.packageId && (p.tipo === "gd" || !p.tipo));
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
    const selectedVexoPkg = availablePackages.find(p => p.id === ev.packageVexoId && p.tipo === "vexo");
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
  }, [ev.packageId, ev.packageVexoId, availablePackages, vexoProducts, gdProducts, selectedProposal]);

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

  async function loadProposals(selectId?: string) {
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
          const alvoId = selectId || selectedProposalRef.current?.id || propostaIdUrl;
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
    setItems(Array.isArray(prop.itens) ? prop.itens : []);
    setSignerName(prop.signer_name || "");
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
    // Todo o resto do formulário vem do modelo: o MESMO que cria e que edita. O plano
    // (escopo × prazos) é reconstruído das linhas de preço já gravadas — por isso o catálogo
    // recém-carregado entra na conta (o setState de availablePackages ainda não refletiu).
    // Enquanto o vendedor está criando, o formulário é o rascunho dele: não se sobrescreve.
    if (!isCreatingRef.current) {
      editor.reset(
        proposalEditorValuesFromProposal(prop, {
          catalogo: [...availablePackages, ...pkgsRecemCarregados],
          segmentsList,
        })
      );
    }
  };

  // Escolha do usuário na lista: abrir outra proposta cancela a criação em andamento.
  const handlePickProposal = (prop: Proposal) => {
    setIsCreating(false);
    selectProposal(prop);
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

  const setupVexoValue = ev.cobrarSetup ? Number(ev.valorSetupVexo || 0) : 0;
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

  // Campos do cartão fechado — e, na lista, as colunas. O cartão e a linha mostram exatamente estes.
  const proposalFields = useMemo<RecordField<any>[]>(
    () => [
      { key: "name", label: "Proposta", render: (prop) => prop.prospect_name },
      { key: "status", label: "Estado", render: (prop) => (prop.status === "aceita" ? "Fechado" : prop.status === "enviada" ? "Enviada" : "Rascunho") },
      { key: "value", label: "Valor", render: (prop) => `R$ ${calculateProposalValues(prop, availablePackages).totalGeral.toLocaleString("pt-BR")}` },
      { key: "date", label: "Criada em", render: (prop) => (prop.created_at ? new Date(prop.created_at).toLocaleDateString("pt-BR") : "—") },
    ],
    [availablePackages]
  );
  const proposalField = (key: string) => proposalFields.find((f) => f.key === key)!;

  const renderProposalDetails = (prop: any, emLista = false) => (
    <>
      <div className="text-[11px] space-y-1 text-muted-foreground bg-muted/30 p-2 rounded-lg">
        <div className="flex justify-between">
          <span>Itens ofertados:</span>
          <span className="font-semibold text-foreground">{prop.itens?.length || 0}</span>
        </div>
        {prop.periodo_plano && (
          <div className="flex justify-between">
            <span>Período:</span>
            <span className="font-semibold text-foreground uppercase text-[10px]">{prop.periodo_plano}</span>
          </div>
        )}
      </div>

      {/* Na lista, "Abrir Proposta" já está na própria linha (ação de uso diário): aqui só o resto. */}
    {!emLista && prop.status !== "aceita" && (
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
      )}

    </>
  );

  const renderProposalCard = (prop: any, { expanded: isExpanded, toggle }: RecordCardState) => {
    const color = getStableColor(prop.id);
    const isSelected = selectedProposal?.id === prop.id;

    const toggleExpand = (e: React.MouseEvent) => {
      e.stopPropagation();
      toggle();
  };

  return (
    <div
      data-testid={`proposal-card-${prop.id}`}
      className={cn(
        "rounded-xl border transition-all overflow-hidden flex flex-col justify-between bg-card text-card-foreground shadow-sm",
        isSelected
          ? "border-purple-500/50 dark:border-purple-550/50 shadow-md shadow-purple-600/5 ring-1 ring-purple-500/20"
          : "border-border/70 hover:border-border hover:shadow-xs",
        isExpanded && "ring-1 ring-border shadow-md"
      )}
    >
      <div className="flex items-stretch min-w-0 flex-1">
        {/* Faixa lateral com cor estável */}
        <div
          data-testid={`proposal-card-stripe-${prop.id}`}
          className={cn("w-1.5 self-stretch shrink-0 transition-opacity", color.stripe)}
          aria-hidden="true"
        />

        <div className="p-3 flex flex-col justify-between flex-1 min-w-0 gap-1.5">
          {/* Linha 1: ponto de cor, cliente ocupando espaço disponível, seta de abrir encostada à direita */}
          <div
            data-testid={`proposal-line-1-${prop.id}`}
            className="flex items-center justify-between gap-2 min-w-0"
          >
            <div
              className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer"
              onClick={() => handlePickProposal(prop)}
            >
              <span
                data-testid={`proposal-color-dot-${prop.id}`}
                className={cn("h-2.5 w-2.5 rounded-full shrink-0", color.dot)}
                title={`Cor: ${color.name}`}
                aria-hidden="true"
              />
              <span
                data-field="name"
                data-testid={`proposal-name-${prop.id}`}
                className="truncate font-display font-semibold text-foreground text-xs min-w-0 flex-1 hover:text-purple-600 transition-colors"
                title={prop.prospect_name}
              >
                {proposalField("name").render(prop)}
              </span>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-slate-100 dark:hover:bg-white/5 shrink-0 ml-auto"
              onClick={toggleExpand}
              aria-expanded={isExpanded}
              aria-label={
                isExpanded
                  ? `Recolher detalhes de ${prop.prospect_name}`
                  : `Ver detalhes de ${prop.prospect_name}`
              }
              title={isExpanded ? "Recolher detalhes" : "Ver detalhes"}
            >
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-200",
                  isExpanded && "rotate-180 text-foreground"
                )}
              />
            </Button>
          </div>

          {/* Linha 2: selo de estado primeiro e valor lado a lado */}
          <div
            data-testid={`proposal-line-2-${prop.id}`}
            className="flex items-center justify-between gap-2 min-w-0"
          >
            <Badge
              data-field="status"
              data-testid={`proposal-status-${prop.id}`}
              className={cn(
                "text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 border-none shrink-0",
                prop.status === "aceita"
                  ? "bg-emerald-500 text-white"
                  : prop.status === "enviada"
                  ? "bg-blue-600 text-white"
                  : "bg-amber-600 text-white"
              )}
            >
              {proposalField("status").render(prop)}
            </Badge>

            <span
              data-field="value"
              data-testid={`proposal-value-${prop.id}`}
              className="text-xs font-mono font-bold text-foreground truncate"
            >
              {proposalField("value").render(prop)}
            </span>
          </div>

          {/* Linha 3: data à esquerda/direita */}
          <div
            data-testid={`proposal-line-3-${prop.id}`}
            className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground pt-0.5 min-w-0"
          >
            <div className="flex items-center gap-1 min-w-0">
              <Calendar className="h-3 w-3 shrink-0" />
              <span data-field="date" data-testid={`proposal-date-${prop.id}`}>{proposalField("date").render(prop)}</span>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[10px] text-purple-650 hover:text-purple-700 dark:text-purple-400 font-semibold"
              onClick={(e) => {
                e.stopPropagation();
                handlePickProposal(prop);
              }}
            >
              {isSelected ? "Selecionada" : "Selecionar"}
            </Button>
          </div>

          {/* O resto abre dentro do próprio cartão */}
          {isExpanded && (
            <div
              data-testid={`proposal-expanded-content-${prop.id}`}
              className="pt-2 mt-1 border-t border-border/60 space-y-2 animate-in fade-in-50 duration-150"
            >
              {renderProposalDetails(prop)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
  };


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

  // Grava o formulário único. Criar e editar passam por AQUI: mesma validação, mesma montagem do
  // corpo (buildProposalBody), mesma gravação (PUT). Criar só acrescenta, antes, um POST que cria a
  // linha da proposta (nome + dono) para dar o id — o POST não grava link de pagamento, carência,
  // preço negociado nem a escada de descontos, e duas rotas gravando campos é o mesmo problema dos
  // dois formulários. Quem grava os campos é sempre o PUT.
  const handleSaveProposal = async () => {
    const mode: EditorMode = isCreating ? "new" : "edit";
    if (mode === "edit" && !selectedProposal) return;

    const verdict = validateProposalEditor(ev, mode);
    if (!verdict.ok) {
      toast({ title: verdict.title || "Dados inválidos", description: verdict.message || "", variant: "destructive" });
      return;
    }

    const base: any = mode === "new" ? PROPOSTA_BASE_VAZIA : selectedProposal;
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
      let pkgId = ev.packageId;
      let pacotesOfertados = ev.pacotesOfertados;
      if (planoValido(ev.plano)) {
        const r = await syncPlanoPackages({
          plano: ev.plano,
          nomeBase: base.prospect_name || ev.prospectName || "Plano",
          clientId,
          gdProducts,
          vexoProducts,
          existentes: availablePackages.filter(
            (p: any) => p?.ad_hoc && ev.pacotesOfertados.includes(p.id)
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
        editor.patch({ pacotesOfertados, packageId: pkgId });
      }

      const built = buildProposalBody({
        values: ev,
        base,
        catalogo,
        pkgId,
        pacotesOfertados,
        clientId,
        isVexoCommercial,
        mode,
      });

      // Criar: primeiro a linha da proposta (para ter o id). Daqui em diante o formulário já é o
      // de uma proposta existente — se o PUT falhar, o "Salvar" seguinte edita ESTA proposta em vez
      // de criar outra.
      let proposalId: string = base.id;
      if (mode === "new") {
        const createRes = await fetchApi(`/api/gd/proposals`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            client_id: clientId,
            prospect_name: ev.prospectName.trim(),
            owner_company: isVexoCommercial ? "vexo" : "geracao-digital",
          }),
        });
        if (!createRes.ok) {
          const errorData = await createRes.json().catch(() => ({}));
          throw new Error(errorData.error || "Erro ao criar proposta.");
        }
        const createdBody = await createRes.json();
        const created = createdBody?.data;
        if (!created?.id) throw new Error("O servidor não devolveu o id da proposta criada.");
        proposalId = created.id;
        setProposals((prev) => [created as Proposal, ...prev]);
        setSelectedProposal(created as Proposal);
        setIsCreating(false);
        setShowConfig(true);
      }

      const res = await fetchApi(`/api/gd/proposals/${proposalId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(built.body)
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(
          mode === "new"
            ? `A proposta foi criada, mas os detalhes não foram gravados: ${errorData.error || "erro no servidor"}. Clique em Salvar para tentar de novo.`
            : errorData.error || "Erro ao atualizar proposta comercial no servidor."
        );
      }

      const data = await res.json();
      if (data.success) {
        toast({
          title: mode === "new" ? "Proposta Criada" : "Proposta Salva",
          description:
            mode === "new"
              ? `Rascunho para ${ev.prospectName} pronto para edição e negociação.`
              : "Os itens e condições foram atualizados e o faturamento recalculado."
        });
        if (built.slides) {
          setSelectedProposal(prev => prev ? { ...prev, presentation_slides: built.slides } : prev);
        }
        loadProposals(proposalId);
        // Recarrega o preview e volta para ele: salvar é o fim da edição.
        setPreviewNonce((n) => n + 1);
        setShowConfig(false);
      }
    } catch (err: any) {
      console.error(err);
      toast({
        title: mode === "new" ? "Erro ao Criar" : "Erro ao Salvar",
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
              <Button onClick={() => loadProposals()} className="bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs px-6 py-2 rounded-xl">
                Tentar Novamente
              </Button>
            </CardContent>
          </Card>
        ) : proposals.length === 0 ? (
          isCreating ? (
            <div className="w-full relative z-10">
              <ProposalEditor
                mode="new"
                values={ev}
                onChange={editor.patch}
                segmentsList={segmentsList}
                gdProducts={gdProducts}
                vexoProducts={vexoProducts}
                isVexoCommercial={isVexoCommercial}
                saving={planoSaving}
                onSave={handleSaveProposal}
                onCancel={() => setIsCreating(false)}
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
                  onClick={() => startNewProposal()}
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
            {isCreating && (
              <div className="lg:col-span-4">
                <ProposalEditor
                  mode="new"
                  values={ev}
                  onChange={editor.patch}
                  segmentsList={segmentsList}
                  gdProducts={gdProducts}
                  vexoProducts={vexoProducts}
                  isVexoCommercial={isVexoCommercial}
                  saving={planoSaving}
                  onSave={handleSaveProposal}
                  onCancel={() => setIsCreating(false)}
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
                onClick={() => startNewProposal()}
                className="w-full bg-gradient-to-r from-purple-700 to-indigo-600 hover:opacity-90 text-white font-bold text-xs mb-1"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Nova Proposta
              </Button>
              {/* Busca */}
              <div className="flex items-center gap-1.5">
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <Input
                    value={buscaProposta}
                    onChange={(e) => setBuscaProposta(e.target.value)}
                    placeholder="Buscar por empresa, status ou ID..."
                    className="pl-8 h-8 text-xs"
                  />
                </div>
                <ViewModeToggle view={view} />
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
              </div>

              {propostasFiltradas.length === 0 && (
                <p className="text-[10px] text-slate-400 italic px-2">
                  {buscaProposta
                    ? "Nenhuma proposta encontrada."
                    : showArchived ? "Nenhuma proposta arquivada." : "Nenhuma proposta ativa."}
                </p>
              )}

              <RecordView
                mode={view.mode}
                items={propostasFiltradas}
                getId={(prop: any) => prop.id}
                fields={proposalFields}
                stripeClass={(id) => getStableColor(id).stripe}
                testIdPrefix="proposal"
                labelOf={(prop: any) => prop.prospect_name}
                compact
                cardsClassName="space-y-3"
                isSelected={(prop: any) => selectedProposal?.id === prop.id}
                renderRowActions={(prop: any) => (
                  <>
                    {prop.status !== "aceita" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="Abrir Proposta"
                        title="Abrir Proposta"
                        className="h-6 w-6 shrink-0"
                        onClick={() => navigate(`/proposta/${prop.id}`)}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-[10px] text-purple-650 hover:text-purple-700 dark:text-purple-400 font-semibold shrink-0"
                      onClick={() => handlePickProposal(prop)}
                    >
                      {selectedProposal?.id === prop.id ? "Selecionada" : "Selecionar"}
                    </Button>
                  </>
                )}
                renderCard={renderProposalCard}
                renderExpanded={(prop: any) => renderProposalDetails(prop, true)}
              />
            </div>

            {/* Proposal Detail & Editor */}
            {selectedProposal ? (
              <div className="space-y-6 lg:col-span-3">

                {/* Header overview */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-black text-slate-800 dark:text-white">{ev.prospectName}</h2>
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

                    {/* Um único formulário: "Nova Proposta" e "Editar Proposta" abrem o
                        mesmo ProposalEditor (o assistente de 4 passos foi removido). */}
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

                    {/* Configuração da Proposta — o MESMO formulário de "Nova Proposta" */}
                    {showConfig && selectedProposal.status !== "aceita" && (
                      <ProposalEditor
                        mode="edit"
                        values={ev}
                        onChange={editor.patch}
                        segmentsList={segmentsList}
                        gdProducts={gdProducts}
                        vexoProducts={vexoProducts}
                        isVexoCommercial={isVexoCommercial}
                        saving={planoSaving}
                        onSave={handleSaveProposal}
                      />
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
