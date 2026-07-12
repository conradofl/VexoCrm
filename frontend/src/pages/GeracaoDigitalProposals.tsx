import { useState, useEffect, useRef } from "react";
import { PageShell } from "@/components/PageShell";
import { GeracaoDigitalTabs } from "@/components/GeracaoDigitalTabs";
import { toast } from "@/components/ui/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
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
  Copy,
  MessageSquare,
  Mail,
  Archive
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PERIOD_LABELS as PKG_PERIOD_LABELS } from "@/lib/geracaoDigital/packagePricing";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
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
import { GeracaoDigitalNegotiationBoard } from "@/components/GeracaoDigitalNegotiationBoard";
import { GenerateContractDialog } from "./GeracaoDigitalContracts/GenerateContractDialog";

interface ProposalItem {
  product_id?: string | null;
  descricao: string;
  categoria: "gd" | "vexo";
  valor: number;
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

  // Nova proposta direta (sem apresentação)
  const [showNewForm, setShowNewForm] = useState<boolean>(false);
  const [availablePackages, setAvailablePackages] = useState<any[]>([]);
  const [newProspect, setNewProspect] = useState<string>("");
  const [newPackageId, setNewPackageId] = useState<string>("");
  const [newCobrarSetup, setNewCobrarSetup] = useState<boolean>(false);
  const [newValorSetup, setNewValorSetup] = useState<number>(0);
  const [newPeriodo, setNewPeriodo] = useState<string>("");
  const [newValidade, setNewValidade] = useState<string>("");
  const [newCondicoes, setNewCondicoes] = useState<string>("");

  // Modal de compartilhamento da proposta
  const [showSendModal, setShowSendModal] = useState<boolean>(false);
  const [whatsappNumber, setWhatsappNumber] = useState<string>("");
  
  // Modal de geração de contrato jurídico
  const [showGenerateContract, setShowGenerateContract] = useState<boolean>(false);

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
  const handleFinalizeNegotiation = async (result: { descontos: DescontoConcedido[]; valorSetupVexoFinal: number }) => {
    if (!selectedProposal) return;
    try {
      const token = await getIdToken();
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const isento = result.descontos.some((d) => d.tipo === "isencao_setup");
      const body = {
        client_id: clientId,
        itens: items,
        cobrar_setup: cobrarSetup,
        valor_setup_vexo: isento ? 0 : (cobrarSetup ? Number(valorSetupVexo || 0) : null),
        descontos_concedidos: result.descontos,
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
      toast({ title: "Negociação registrada", description: "Concessões gravadas. Abrindo a proposta final..." });
      window.open(`/proposta/${selectedProposal.id}`, "_blank");
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

      const body = {
        client_id: clientId,
        prospect_name: prospectName,
        itens: items,
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
        observacao_validade: observacaoValidade || null
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

  // Criar proposta direta, sem passar pela apresentação (presentation_id = null)
  const handleCreateDirectProposal = async () => {
    if (!newProspect.trim()) {
      toast({ title: "Nome obrigatório", description: "Informe o nome do prospect.", variant: "destructive" });
      return;
    }
    try {
      const token = await getIdToken();
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const body: any = {
        client_id: clientId,
        prospect_name: newProspect.trim(),
        package_id: newPackageId || null,
        cobrar_setup: newCobrarSetup,
        valor_setup_vexo: newCobrarSetup ? Number(newValorSetup || 0) : null,
        periodo_plano: newPeriodo || null,
        validade_ate: newValidade ? new Date(`${newValidade}T23:59:59`).toISOString() : null,
        condicoes: newCondicoes || undefined
      };
      const res = await fetchApi(`/api/gd/proposals`, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Erro ao criar proposta.");
      }
      toast({ title: "Proposta Criada", description: `Rascunho para ${newProspect} pronto para edição e negociação.` });
      setShowNewForm(false);
      setNewProspect(""); setNewPackageId(""); setNewCobrarSetup(false);
      setNewValorSetup(0); setNewPeriodo(""); setNewValidade(""); setNewCondicoes("");
      loadProposals();
    } catch (err: any) {
      console.error(err);
      toast({ title: "Erro ao Criar", description: err.message, variant: "destructive" });
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
                onClick={() => { setShowNewForm(true); setProposals([]); }}
                className="bg-gradient-to-r from-purple-600 to-pink-500 hover:opacity-90 text-white font-bold text-xs"
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
                <Card className="bg-white border-purple-200 shadow-md">
                  <CardHeader className="flex flex-row justify-between items-center space-y-0">
                    <div>
                      <CardTitle className="text-base font-bold text-slate-800">Nova Proposta (direta)</CardTitle>
                      <CardDescription className="text-[11px] text-slate-500">
                        Cria uma proposta do zero, sem passar pela apresentação. Itens e módulos podem ser ajustados no editor depois.
                      </CardDescription>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => setShowNewForm(false)} className="h-7 w-7 text-slate-500">
                      <X className="h-4 w-4" />
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-slate-500 font-mono">Nome do Prospect *</Label>
                        <Input
                          value={newProspect}
                          onChange={(e) => setNewProspect(e.target.value)}
                          placeholder="Ex: Nome da Empresa"
                          className="bg-white border-slate-200 text-xs h-9"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-slate-500 font-mono">Pacote (opcional)</Label>
                        <select
                          value={newPackageId}
                          onChange={(e) => setNewPackageId(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-850 h-9"
                        >
                          <option value="">— sem pacote (itens manuais) —</option>
                          {availablePackages.map((pk: any) => (
                            <option key={pk.id} value={pk.id}>
                              {pk.nome} ({PKG_PERIOD_LABELS[pk.periodo] || pk.periodo})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-slate-500 font-mono">Período do plano</Label>
                        <select
                          value={newPeriodo}
                          onChange={(e) => setNewPeriodo(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-850 h-9"
                        >
                          {PERIODO_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-3 items-end">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-slate-500 font-mono">Proposta válida até</Label>
                        <Input
                          type="date"
                          value={newValidade}
                          onChange={(e) => setNewValidade(e.target.value)}
                          className="bg-white border-slate-200 text-xs h-9"
                        />
                      </div>
                      <div className="flex items-center gap-3 pb-1">
                        <Switch checked={newCobrarSetup} onCheckedChange={setNewCobrarSetup} />
                        <Label className="text-[10px] text-slate-600 font-bold">Cobrar setup de implantação?</Label>
                      </div>
                      {newCobrarSetup && (
                        <div className="space-y-1">
                          <Label className="text-[10px] text-slate-500 font-mono">Valor do Setup (R$)</Label>
                          <div className="relative">
                            <span className="absolute left-2.5 top-2.5 text-[10px] text-slate-500 font-mono">R$</span>
                            <Input
                              type="number"
                              value={newValorSetup}
                              onChange={(e) => setNewValorSetup(Number(e.target.value) || 0)}
                              className="bg-white border-slate-200 text-xs pl-7 h-9 font-mono"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-500 font-mono">Condições contratuais (opcional)</Label>
                      <Input
                        value={newCondicoes}
                        onChange={(e) => setNewCondicoes(e.target.value)}
                        placeholder="Ex: Contrato de 6 meses. Faturamento recorrente mensal."
                        className="bg-white border-slate-200 text-xs h-9"
                      />
                    </div>
                    <Button onClick={handleCreateDirectProposal} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs">
                      Criar Proposta
                    </Button>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Sidebar proposals list */}
            <div className="space-y-3 lg:col-span-1">
              <div className="flex items-center justify-between px-2 mb-2">
                <h3 className="text-xs font-mono font-bold text-purple-600 uppercase tracking-widest">Simulações Recentes</h3>
              </div>
              <Button
                size="sm"
                onClick={() => setShowNewForm(true)}
                className="w-full bg-gradient-to-r from-purple-600 to-pink-500 hover:opacity-90 text-white font-bold text-xs mb-1"
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
            {selectedProposal && (
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
                        onClick={() => setIsNegotiating(true)}
                        className="bg-gradient-to-r from-purple-600 to-pink-500 hover:opacity-90 text-white font-bold shrink-0"
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

                {/* Items Editor */}
                <Card className="bg-white border-slate-200 shadow-sm">
                  <CardHeader className="flex flex-row justify-between items-center space-y-0">
                    <div>
                      <CardTitle className="text-base font-bold text-slate-800">Escopo & Valores dos Serviços</CardTitle>
                      <CardDescription className="text-[11px] text-slate-500">Produtos incluídos no pacote de fechamento.</CardDescription>
                    </div>
                    {selectedProposal.status !== "aceita" && (
                      <Button size="xs" onClick={handleAddItem} className="bg-purple-600 hover:bg-purple-500 text-xs font-bold text-white">
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Adicionar Item
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-3">
                      {items.map((item, index) => (
                        <div key={index} className="flex flex-col md:flex-row gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200 items-start md:items-center justify-between">
                          <div className="flex-1 w-full space-y-1">
                            <Label className="text-[10px] text-slate-500 font-mono">Descrição do Serviço / Pacote</Label>
                            <Input
                              value={item.descricao}
                              disabled={selectedProposal.status === "aceita"}
                              onChange={(e) => handleUpdateItemField(index, "descricao", e.target.value)}
                              className="bg-white border-slate-200 text-xs text-slate-800 focus:outline-none h-8"
                            />
                          </div>
                               <div className="w-full md:w-32 space-y-1">
                            <Label className="text-[10px] text-slate-500 font-mono">Categoria</Label>
                            <select
                              value={item.categoria}
                              disabled={selectedProposal.status === "aceita"}
                              onChange={(e) => handleUpdateItemField(index, "categoria", e.target.value)}
                              className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-850 focus:outline-none focus:border-indigo-500/50 h-8"
                            >
                              <option value="gd">Geração Digital</option>
                              <option value="vexo">Vexo OS</option>
                            </select>
                          </div>

                          <div className="w-full md:w-32 space-y-1">
                            <Label className="text-[10px] text-slate-500 font-mono">Recorrência</Label>
                            <select
                              value={item.recorrencia}
                              disabled={selectedProposal.status === "aceita"}
                              onChange={(e) => handleUpdateItemField(index, "recorrencia", e.target.value)}
                              className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-850 focus:outline-none focus:border-indigo-500/50 h-8"
                            >
                              <option value="mensal">Mensal</option>
                              <option value="unico">Único (Setup)</option>
                            </select>
                          </div>

                          <div className="w-full md:w-32 space-y-1">
                            <Label className="text-[10px] text-slate-500 font-mono">Valor</Label>
                            <div className="relative">
                              <span className="absolute left-2.5 top-2 text-[10px] text-slate-500 font-mono">R$</span>
                              <Input
                                type="number"
                                value={item.valor}
                                disabled={selectedProposal.status === "aceita"}
                                onChange={(e) => handleUpdateItemField(index, "valor", Number(e.target.value) || 0)}
                                className="bg-white border-slate-200 text-xs text-slate-800 pl-7 h-8 font-mono"
                              />
                            </div>
                          </div>

                          {selectedProposal.status !== "aceita" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemoveItem(index)}
                              className="text-red-500 hover:text-red-650 hover:bg-red-50 h-8 w-8 mt-4 md:mt-0 shrink-0"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Totals Summary */}
                    <div className="grid gap-4 sm:grid-cols-2 p-4 rounded-xl bg-slate-50 border border-slate-200 mt-4">
                      <div className="space-y-1">
                        <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Total Setup (Investimento Único)</span>
                        <h4 className="text-xl font-black text-slate-800">R$ {setupTotal.toLocaleString("pt-BR")}</h4>
                        {cobrarSetup && (
                          <span className="text-[10px] text-purple-650 font-bold block">
                            + R$ {setupVexoValue.toLocaleString("pt-BR")} ({SETUP_LABEL})
                          </span>
                        )}
                      </div>
                      <div className="space-y-1">
                        <span className="text-[10px] text-slate-550 uppercase font-bold tracking-wider">Total Recorrência (Faturamento Mensal)</span>
                        <h4 className="text-xl font-black text-pink-600">R$ {recurringTotal.toLocaleString("pt-BR")}/mês</h4>
                      </div>
                    </div>
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
                <div className="grid gap-6 md:grid-cols-2">

                  {/* Conditions Card */}
                  <Card className="bg-white border-slate-200 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-base font-bold text-slate-800">Condições Contratuais</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
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
                    </CardContent>
                  </Card>

                  {/* Electronic Signature Card */}
                  <Card className="bg-white border-slate-200 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-base font-bold text-slate-800">Assinatura de Aceite Comercial</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">

                      {selectedProposal.status === "aceita" ? (
                        <div className="space-y-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-center">
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

                          <div className="text-[9px] text-slate-500 font-mono space-y-0.5">
                            <div>Data/Hora: {selectedProposal.signed_at ? new Date(selectedProposal.signed_at).toLocaleString("pt-BR") : ""}</div>
                            <div>IP do Assinante: {selectedProposal.signer_ip || "Registrado"}</div>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="text-[10px] text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-200">
                            <span className="font-bold text-slate-800 block mb-1 uppercase font-mono tracking-wider">Termo de Aceite:</span>
                            "Declaro estar de acordo com os serviços, valores e condições desta proposta e autorizo o início dos trabalhos."
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
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl cursor-crosshair h-[120px]"
                            />
                          </div>

                          <Button
                            onClick={handleSignProposal}
                            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:opacity-90 font-extrabold text-white py-3 rounded-xl text-xs"
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
        />
      )}

      {/* Modal de Compartilhamento da Proposta */}
      {selectedProposal && (
        <Dialog open={showSendModal} onOpenChange={setShowSendModal}>
          <DialogContent className="max-w-md bg-white border border-slate-200 shadow-2xl rounded-2xl p-6 space-y-4">
            <DialogHeader>
              <DialogTitle className="text-lg font-black text-slate-800 flex items-center gap-2">
                <Share2 className="h-5 w-5 text-indigo-600" />
                Compartilhar Proposta Comercial
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-505 font-light">
                A proposta de <strong>{selectedProposal.prospect_name}</strong> foi marcada como enviada. Use os canais abaixo para entregar o link de acesso público.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Link Input & Copy Button */}
              <div className="space-y-1.5">
                <Label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider block">Link Público da Proposta</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={`${window.location.origin}/proposta/${selectedProposal.id}`}
                    className="bg-slate-50 border-slate-200 text-xs font-mono text-slate-700 h-9 flex-1"
                  />
                  <Button
                    size="sm"
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 h-9 border border-slate-200"
                    onClick={() => {
                      const shareLink = `${window.location.origin}/proposta/${selectedProposal.id}`;
                      navigator.clipboard.writeText(shareLink);
                      toast({
                        title: "Link Copiado",
                        description: "O link da proposta foi copiado para a área de transferência."
                      });
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* WhatsApp Share Section */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <Label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider block">Enviar por WhatsApp</Label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    placeholder="Ex: 5511999999999 (com DDI + DDD)"
                    value={whatsappNumber}
                    onChange={(e) => setWhatsappNumber(e.target.value)}
                    className="bg-white border-slate-200 text-xs text-slate-700 h-9 flex-1"
                  />
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-9 gap-1.5"
                    onClick={() => {
                      const numberClean = whatsappNumber.replace(/\D/g, "");
                      if (!numberClean) {
                        toast({
                          title: "Número inválido",
                          description: "Por favor, digite o número com DDI (ex: 55 para Brasil) e DDD.",
                          variant: "destructive"
                        });
                        return;
                      }
                      const shareLink = `${window.location.origin}/proposta/${selectedProposal.id}`;
                      const msg = `Olá! Segue o link para visualizar a sua proposta comercial da Geração Digital: ${shareLink}`;
                      window.open(`https://wa.me/${numberClean}?text=${encodeURIComponent(msg)}`, "_blank");
                    }}
                  >
                    <MessageSquare className="h-4 w-4" />
                    Enviar
                  </Button>
                </div>
              </div>

              {/* Email Infrastructure Warning */}
              <div className="space-y-1.5 pt-2 border-t border-slate-100">
                <Label className="text-[10px] text-slate-450 font-mono uppercase tracking-wider flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5 text-slate-400" />
                  Enviar por E-mail
                </Label>
                <div className="p-3 bg-slate-50 border border-slate-150 rounded-lg">
                  <p className="text-[10.5px] text-slate-500 leading-normal">
                    ⚠️ <strong>Infraestrutura Indisponível:</strong> O envio automático por e-mail depende de uma infraestrutura de correio de saída (servidor SMTP ou AWS SES) inexistente no sistema Vexo OS neste momento. Por favor, copie o link público acima e envie manualmente por e-mail.
                  </p>
                </div>
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button
                variant="outline"
                className="w-full border-slate-200 text-slate-600 hover:bg-slate-50 h-9 font-bold"
                onClick={() => setShowSendModal(false)}
              >
                Fechar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
