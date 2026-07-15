import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { toast } from "@/components/ui/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { API_BASE_URL, fetchApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  FileText,
  CheckCircle,
  PenTool,
  Clock,
  Briefcase,
  DollarSign,
  Zap,
  Info,
  ExternalLink,
  Check,
  X,
  Lock
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  type ProposalPaymentTerms,
  type DescontoConcedido,
  DESCONTO_LABELS,
  termAplicaA,
  APLICA_A_LABELS,
  computePaymentBreakdown,
  SETUP_LABEL,
  SETUP_JUSTIFICATION
} from "@/lib/geracaoDigital/paymentTerms";
import { calculateProposalValues } from "@/lib/geracaoDigital/proposalCalculator";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import GeracaoDigitalNegotiationPage from "@/pages/GeracaoDigitalNegotiationPage";

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
  valor_vp?: number | null;
  valor_setup: number;
  valor_recorrente: number;
  condicoes: string;
  status: "rascunho" | "enviada" | "aceita" | "recusada";
  payment_link?: string;
  assinatura?: string;
  signer_name?: string;
  signed_at?: string;
  signer_ip?: string;
  created_at?: string;
  cobrar_setup?: boolean;
  valor_setup_vexo?: number | null;
  condicoes_pagamento?: ProposalPaymentTerms | null;
  periodo_plano?: string | null;
  validade_ate?: string | null;
  valor_apos_validade?: number | null;
  observacao_validade?: string | null;
  descontos_concedidos?: DescontoConcedido[] | null;
  meio_pagamento?: { setup?: string | string[]; mensalidade?: string | string[] } | null;
  carencia_dias?: number | null;
  package_vexo_id?: string | null;
  assinatura_metodo?: string | null;
  package_id?: string | null;
  packages?: any[];
}

const PERIODO_LABELS: Record<string, string> = {
  mensal: "Mensal",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
};

export default function GeracaoDigitalPublicProposal() {
  const { id } = useParams<{ id: string }>();
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [chosenTermId, setChosenTermId] = useState<string | null>(null);
  const [showMesa, setShowMesa] = useState(false);

  // Signature state
  const [signerName, setSignerName] = useState<string>("");
  const [signMethod, setSignMethod] = useState<'desenho' | 'digitado'>('desenho');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  const { isAuthenticated } = useAuth();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key.toLowerCase() === 'n') {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
        setShowMesa((v) => !v);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [id]);

  useEffect(() => {
    if (id) {
      loadPublicProposal();
    }
  }, [id]);

  useEffect(() => {
    if (!id || !supabase) return;

    const channel = supabase
      .channel(`public-proposal-${id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "gd_proposals",
          filter: `id=eq.${id}`
        },
        (payload) => {
          console.log("Realtime update received:", payload);
          reloadPublicProposalSilent();
        }
      )
      .subscribe((status) => {
        console.log(`Supabase Realtime subscription status for proposal ${id}:`, status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  async function reloadPublicProposalSilent() {
    try {
      const res = await fetchApi(`/api/gd/public/proposals/${id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          setProposal(data.data);
        }
      }
    } catch (err) {
      console.error("Silent reload error:", err);
    }
  }

  async function loadPublicProposal() {
    try {
      setIsLoading(true);
      setErrorMsg(null);
      const res = await fetchApi(`/api/gd/public/proposals/${id}`);
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error("Proposta comercial não encontrada.");
        }
        throw new Error("Erro ao carregar proposta do servidor.");
      }
      const data = await res.json();
      if (data.success) {
        setProposal(data.data);
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Erro desconhecido ao carregar proposta.");
    } finally {
      setIsLoading(false);
    }
  }

  const handleSelectPackage = async (packageId: string) => {
    if (!id || !proposal || proposal.status === "aceita") return;
    try {
      const res = await fetchApi(`/api/gd/public/proposals/${id}/select-package`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package_id: packageId })
      });
      if (!res.ok) {
        throw new Error("Erro ao alterar o pacote.");
      }
      toast({
        title: "Plano Alterado",
        description: "Os valores e itens da proposta foram atualizados com sucesso."
      });
      loadPublicProposal();
    } catch (err: any) {
      console.error(err);
      toast({
        title: "Erro ao Alterar Plano",
        description: err.message || "Não foi possível alterar seu plano.",
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
    ctx.strokeStyle = "#000000"; // Always black stroke since bg is white
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
    if (!id || !proposal) return;
    if (!signerName.trim()) {
      toast({
        title: "Nome Obrigatório",
        description: "Por favor, insira o seu nome completo para assinar.",
        variant: "destructive"
      });
      return;
    }

    let signatureValue = "";
    if (signMethod === 'desenho') {
      const canvas = canvasRef.current;
      if (canvas) {
        signatureValue = canvas.toDataURL("image/png");
      }
    } else {
      signatureValue = signerName;
    }

    try {
      const body = {
        assinatura: signatureValue,
        signer_name: signerName,
        condicao_escolhida_id: chosenTermId,
        assinatura_metodo: signMethod
      };

      const res = await fetchApi(`/api/gd/public/proposals/${id}/assinar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        throw new Error("Erro ao registrar a assinatura.");
      }

      const data = await res.json();
      if (data.success) {
        toast({
          title: "Aceite Registrado",
          description: "Obrigado! A proposta comercial foi aceita e assinada com sucesso!"
        });
        loadPublicProposal();
      }
    } catch (err) {
      console.error(err);
      toast({
        title: "Erro ao Assinar",
        description: "Não foi possível registrar seu aceite comercial no sistema.",
        variant: "destructive"
      });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white">
        <span className="animate-spin h-8 w-8 border-4 border-purple-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (errorMsg || !proposal) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white p-6">
        <Card className="bg-slate-900 border-slate-800 text-center max-w-md w-full p-6">
          <CardContent className="space-y-4">
            <Info className="h-12 w-12 text-red-400 mx-auto" />
            <h3 className="text-lg font-bold text-white">Link Inválido</h3>
            <p className="text-xs text-slate-400">
              {errorMsg || "A proposta procurada não existe ou está inacessível."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Remove o módulo Vexo fantasma legado (R$ 980, sem product_id) do escopo exibido.
  const items = (Array.isArray(proposal.itens) ? proposal.itens : []).filter(
    (it) => !(!it.product_id && String(it.descricao || "").includes("Inteligência de Atendimento"))
  );
  const packages = Array.isArray(proposal.packages) ? proposal.packages : [];
  const setupVexoValue = proposal.cobrar_setup ? Number(proposal.valor_setup_vexo || 0) : 0;
  const grandTotal = Number(proposal.valor_setup || 0) + Number(proposal.valor_recorrente || 0) + setupVexoValue;
  const offeredTerms = Array.isArray(proposal.condicoes_pagamento?.ofertadas)
    ? proposal.condicoes_pagamento!.ofertadas
    : [];
  const chosenTerm = proposal.condicoes_pagamento?.escolhida || null;
  const validadeDate = proposal.validade_ate ? new Date(proposal.validade_ate) : null;
  const validadeExpirada = validadeDate ? validadeDate.getTime() < Date.now() : false;
  const descontosConcedidos = Array.isArray(proposal.descontos_concedidos) ? proposal.descontos_concedidos : [];

  const calc = calculateProposalValues(proposal, []);

  const setupBaseVal = calc.setupOriginal;
  const setupFinalVal = calc.setupFinal;
  const setupIsento = calc.setupFinal === 0;

  const mensalBaseVal = calc.mensalidadeOriginal;
  const mensalFinalVal = calc.mensalidadeFinal;

  const MEIO_LABELS_PUB: Record<string, string> = { cartao: "Cartão", boleto: "Boleto", pix: "PIX" };
  // meio_pagamento pode ser string (legado) ou array (multi-seleção).
  const meiosAsArray = (v: string | string[] | undefined | null): string[] =>
    Array.isArray(v) ? v.filter(Boolean) : v ? [v] : [];
  const meiosPubLabel = (v: string | string[] | undefined | null): string | null => {
    const arr = meiosAsArray(v).map((m) => MEIO_LABELS_PUB[m] || m);
    return arr.length > 0 ? arr.join(" · ") : null;
  };
  const meioSetupArr = meiosAsArray(proposal.meio_pagamento?.setup);
  const meioMensalArr = meiosAsArray(proposal.meio_pagamento?.mensalidade);
  const meioSetupPub = meiosPubLabel(proposal.meio_pagamento?.setup);
  const meioMensalPub = meiosPubLabel(proposal.meio_pagamento?.mensalidade);

  // Resumo "Como você vai pagar" por trilha (meio + parcelamento + condição)
  const parcelamentoConc = descontosConcedidos.find((d) => d.tipo === "parcelamento");
  const parcelasEntradaMatch = parcelamentoConc?.motivo?.match(/(\d+)x de (R\$\s?[\d.,]+)/);
  const condSetupEscolhida = chosenTerm && termAplicaA(chosenTerm) === "setup" ? chosenTerm : null;
  const condMensalEscolhida = chosenTerm && termAplicaA(chosenTerm) === "mensalidade" ? chosenTerm : null;
  const pagamentoEntrada = [
    condSetupEscolhida ? computePaymentBreakdown(condSetupEscolhida, setupFinalVal).linhas[0] : null,
    !condSetupEscolhida && parcelasEntradaMatch ? `${parcelasEntradaMatch[1]}x de ${parcelasEntradaMatch[2]}` : null,
    !condSetupEscolhida && !parcelasEntradaMatch ? "à vista" : null,
    meioSetupPub ? `no ${meioSetupPub}` : null,
  ].filter(Boolean).join(" · ");
  const pagamentoMensalidade = [
    condMensalEscolhida ? computePaymentBreakdown(condMensalEscolhida, mensalFinalVal).linhas[0] : "faturamento mensal recorrente",
    meioMensalPub ? `no ${meioMensalPub}` : null,
  ].filter(Boolean).join(" · ");
  const temResumoPagamento = !!(meioSetupPub || meioMensalPub || parcelasEntradaMatch || chosenTerm);

  // Carência do 1º vencimento: informativo, não altera valores.
  const carenciaDias = Number(proposal.carencia_dias || 0);
  const primeiraMensalidadeDate = carenciaDias > 0
    ? new Date(Date.now() + carenciaDias * 24 * 60 * 60 * 1000)
    : null;

  return (
    <div className="dark min-h-screen bg-slate-950 text-white font-sans selection:bg-purple-500/35 pb-16">

      {/* Background decoration */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-0 right-0 h-[400px] w-[400px] rounded-full bg-purple-600/5 blur-[100px]" />
        <div className="absolute bottom-0 left-0 h-[400px] w-[400px] rounded-full bg-pink-600/5 blur-[100px]" />
      </div>

      <header className="relative z-10 max-w-7xl mx-auto px-6 lg:px-10 py-8 flex justify-between items-center border-b border-slate-900">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 flex items-center justify-center text-white font-black text-lg">
            GD
          </div>
          <div>
            <h2 className="text-base font-black text-white leading-tight">Geração Digital</h2>
            <span className="text-[10px] text-slate-400 uppercase font-mono">Proposta Comercial</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <Badge
            className={cn(
              "text-xs font-extrabold px-3 py-1 border-none",
              proposal.status === "aceita" ? "bg-emerald-500 text-white" : "bg-purple-600 text-white animate-pulse"
            )}
          >
            {proposal.status === "aceita" ? "Fechado ✔" : "Aguardando Assinatura"}
          </Badge>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-6 lg:px-10 mt-12 grid gap-10 lg:grid-cols-5">

        {/* Left/Middle area: content of proposal */}
        <div className="lg:col-span-3 space-y-8">

          <div className="space-y-2">
            <span className="text-[10px] text-purple-400 font-mono font-bold uppercase tracking-wider">Apresentado para</span>
            <h1 className="text-4xl md:text-5xl font-black text-white">{proposal.prospect_name}</h1>
            <p className="text-sm text-slate-400 font-mono">Proposta comercial emitida em {new Date(proposal.created_at).toLocaleDateString("pt-BR")}</p>
          </div>

          {/* Validade da proposta (gatilho de urgência) */}
          {validadeDate && proposal.status !== "aceita" && (
            <Card
              className={cn(
                "p-4 space-y-1 border",
                validadeExpirada
                  ? "bg-red-950/40 border-red-900/60"
                  : "bg-amber-950/30 border-amber-800/50"
              )}
            >
              <div className="flex items-center gap-2">
                <Clock className={cn("h-4 w-4 shrink-0", validadeExpirada ? "text-red-400" : "text-amber-400")} />
                <span className={cn("text-sm font-black", validadeExpirada ? "text-red-300" : "text-amber-300")}>
                  {validadeExpirada
                    ? `Proposta expirada em ${validadeDate.toLocaleDateString("pt-BR")}`
                    : `Proposta válida até ${validadeDate.toLocaleDateString("pt-BR")}`}
                </span>
              </div>
              {(proposal.observacao_validade || proposal.valor_apos_validade) && (
                <p className="text-[11px] text-slate-300 leading-relaxed pl-6">
                  {proposal.observacao_validade
                    ? proposal.observacao_validade
                    : `Após esta data o valor retorna a R$ ${Number(proposal.valor_apos_validade || 0).toLocaleString("pt-BR")}.`}
                  {proposal.observacao_validade && proposal.valor_apos_validade
                    ? ` Após o prazo: R$ ${Number(proposal.valor_apos_validade || 0).toLocaleString("pt-BR")}.`
                    : ""}
                </p>
              )}
            </Card>
          )}

          {/* Carência do primeiro vencimento */}
          {primeiraMensalidadeDate && proposal.status !== "aceita" && (
            <Card className="p-5 border bg-emerald-950/25 border-emerald-900/50 flex items-center gap-3">
              <Clock className="h-5 w-5 text-emerald-400 shrink-0" />
              <div>
                <span className="text-base font-black text-emerald-300 block">
                  Primeira mensalidade em {primeiraMensalidadeDate.toLocaleDateString("pt-BR")} (carência de {carenciaDias} dias)
                </span>
                <span className="text-xs text-slate-400">A entrada é paga na contratação; a mensalidade só começa após a carência.</span>
              </div>
            </Card>
          )}

           {/* Seletor de Pacotes Comerciais (Grid Unificado) */}
          {proposal.status !== "aceita" && packages.length > 0 && (
            <div className="space-y-4">
              <span className="text-[10px] text-purple-400 font-mono font-bold uppercase tracking-wider block">Escolha seu Plano</span>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {packages.map((pkg: any) => {
                  const isSelected = proposal.package_id === pkg.id || proposal.package_vexo_id === pkg.id;
                  const periodoLabel = pkg.periodo ? (PERIODO_LABELS[pkg.periodo] || pkg.periodo) : null;
                  const meses = pkg.periodo === 'anual' ? 12 : pkg.periodo === 'semestral' ? 6 : pkg.periodo === 'trimestral' ? 3 : 1;
                  const valorMensal = meses > 1 ? Number(pkg.valor || 0) / meses : Number(pkg.valor || 0);
                  return (
                    <button
                      key={pkg.id}
                      onClick={() => handleSelectPackage(pkg.id)}
                      className={cn(
                        "text-left p-5 rounded-2xl border transition-all duration-300 relative flex flex-col justify-between min-h-[140px]",
                        isSelected
                          ? "bg-purple-650/15 border-purple-500 shadow-lg shadow-purple-600/10"
                          : "bg-slate-900/40 border-slate-900 hover:border-slate-800"
                      )}
                    >
                      <div className="space-y-1">
                        <span className="text-[8px] text-purple-400 font-bold uppercase tracking-wider">Plano</span>
                        <h4 className="text-sm font-black text-white leading-snug">{pkg.nome}</h4>
                        {periodoLabel && (
                          <span className="text-[9px] text-slate-400 font-mono">{periodoLabel}</span>
                        )}
                      </div>
                      <div className="mt-4 pt-3 border-t border-slate-950/60 w-full">
                        <span className="text-lg font-black text-pink-500 font-mono">
                          R$ {valorMensal.toLocaleString("pt-BR")}<span className="text-xs font-bold text-slate-400">/mês</span>
                        </span>
                        {meses > 1 && (
                          <span className="text-[9px] text-slate-500 block font-mono">
                            Total: R$ {Number(pkg.valor || 0).toLocaleString("pt-BR")} ({meses} meses)
                          </span>
                        )}
                      </div>
                      {isSelected && (
                        <div className="absolute top-3 right-3 h-5 w-5 bg-purple-650 rounded-full flex items-center justify-center text-white">
                          <Check className="h-3 w-3" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* List of items */}
          <Card className="bg-slate-900/40 border-slate-900 overflow-hidden shadow-2xl">
            <CardHeader className="border-b border-slate-900 bg-slate-900/60">
              <CardTitle className="text-xl font-bold text-white">Escopo Geral de Serviços</CardTitle>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-slate-900">
              {(["gd", "vexo"] as const).map(cat => {
                // Desduplicação: o mesmo serviço/módulo pode chegar em várias
                // variantes (plano "Google Ads", avulso "GD: Google Ads",
                // "Vexo OS: Google Ads") compartilhando o mesmo product_id.
                // Chave = product_id (quando existe) ou nome sem prefixo.
                const dedupKey = (it: ProposalItem) => {
                  if (it.product_id) return `pid:${it.product_id}`;
                  const nome = String(it.descricao || "")
                    .replace(/^(GD:|Vexo OS:|Módulo:|Pacote Vexo:|Pacote:)\s*/, "")
                    .trim()
                    .toLowerCase();
                  return `nome:${nome}`;
                };
                const uniqueItems = items.filter(
                  (item, index, self) => index === self.findIndex(t => dedupKey(t) === dedupKey(item))
                );
                const catItems = uniqueItems.filter(i => i.categoria === cat).sort((a, b) => Number(b.valor || 0) - Number(a.valor || 0));
                if (catItems.length === 0) return null;
                return catItems.map((item, idx) => {
                  const isGdPkg = cat === "gd" && proposal.package_id && packages.find(p => p.id === proposal.package_id && p.nome === item.descricao);
                  const isVexoPkg = cat === "vexo" && proposal.package_vexo_id && packages.find(p => p.id === proposal.package_vexo_id && p.nome === item.descricao);
                  const pkgRef = isGdPkg || isVexoPkg;
                  
                  return (
                    <div key={`${cat}-${idx}`} className="p-6 flex flex-col gap-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1.5">
                          <h4 className="text-base font-bold text-white leading-tight">{item.descricao}</h4>
                          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-800">
                            {item.categoria === "vexo" ? "Vexo OS" : "Geração Digital"}
                          </span>
                        </div>
                        <div className="text-right">
                          {Number(item.valor || 0) === 0 ? (
                            <span className="text-emerald-400 font-medium text-sm">Incluso no pacote</span>
                          ) : (
                            <>
                              {Number(item.valor_tabela || 0) > 0 && Number(item.total_periodo || 0) > 0 && (
                                <span className="text-[10px] text-slate-500 line-through font-mono block">
                                  De R$ {Number(item.valor_tabela || 0).toLocaleString("pt-BR")}
                                </span>
                              )}
                              <span className="text-lg font-black text-white font-mono">
                                R$ {Number(item.valor || 0).toFixed(2)}
                                {Number(item.valor_tabela || 0) > 0 && Number(item.total_periodo || 0) > 0 && (
                                  <span className="text-[10px] text-emerald-400 font-bold ml-1">
                                    ({Math.round((1 - Number(item.total_periodo || 0) / Number(item.valor_tabela || 1)) * 100)}% off)
                                  </span>
                                )}
                              </span>
                              <span className="text-[9px] text-slate-400 block uppercase tracking-wider font-mono">
                                {item.recorrencia === "mensal" ? "recorrente" : "setup único"}
                              </span>
                              {Number(item.total_periodo || 0) > 0 && Number(item.meses || 0) > 1 && (
                                <span className="text-[9px] text-slate-500 block font-mono">
                                  total do período: R$ {Number(item.total_periodo || 0).toLocaleString("pt-BR")} ({item.meses} meses)
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      
                      {pkgRef && pkgRef.produtos_incluidos && pkgRef.produtos_incluidos.length > 0 && (
                        <div className="pt-3 border-t border-slate-800/50 mt-1">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">Módulos Incluídos neste pacote:</span>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {pkgRef.produtos_incluidos.map((p: any, pIdx: number) => (
                              <div key={pIdx} className="flex items-center gap-2 text-xs text-slate-300">
                                <div className="h-1.5 w-1.5 rounded-full bg-purple-500/50 shrink-0" />
                                <span>{p.nome}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                });
              })}
            </CardContent>
          </Card>

          {/* Setup / Implantação Vexo OS (só quando cobrado) */}
          {proposal.cobrar_setup && (
            <Card className="bg-slate-900/40 border-slate-900 p-6 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <h3 className="font-bold text-white text-base">Taxa de Implantação (Setup)</h3>
                <span className="text-sm font-black text-purple-300 font-mono shrink-0">
                  R$ {setupVexoValue.toLocaleString("pt-BR")}
                </span>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line font-light">
                {SETUP_JUSTIFICATION}
              </p>
            </Card>
          )}

          {/* Como você vai pagar — resumo por trilha */}
          {temResumoPagamento && (
            <Card className="bg-slate-900/40 border-slate-900 p-6 space-y-4">
              <h3 className="font-bold text-white text-xl">Como você vai pagar</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="p-4 rounded-xl bg-slate-950 border border-purple-900/40 space-y-1">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-purple-400 block">Entrada (Setup)</span>
                  <span className="text-sm font-bold text-white block">
                    {setupIsento ? "Isenta nesta proposta" : pagamentoEntrada || "à vista"}
                  </span>
                </div>
                <div className="p-4 rounded-xl bg-slate-950 border border-blue-900/40 space-y-1">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-blue-400 block">Mensalidade</span>
                  <span className="text-sm font-bold text-white block">{pagamentoMensalidade}</span>
                  {primeiraMensalidadeDate && (
                    <span className="text-xs font-bold text-amber-300 block">
                      1º vencimento em {primeiraMensalidadeDate.toLocaleDateString("pt-BR")} (carência de {carenciaDias} dias)
                    </span>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* Condições de pagamento ofertadas */}
          {offeredTerms.length > 0 && (
            <Card className="bg-slate-900/40 border-slate-900 p-6 space-y-4">
              <h3 className="font-bold text-white text-base">Condições de Pagamento</h3>
              <p className="text-[11px] text-slate-400">
                {proposal.status === "aceita"
                  ? "Condições ofertadas nesta proposta:"
                  : "Escolha a condição de pagamento de sua preferência antes de assinar:"}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {offeredTerms.map((term) => {
                  const aplicaA = termAplicaA(term);
                  const breakdown = computePaymentBreakdown(term, aplicaA === "mensalidade" ? Number(proposal.valor_recorrente || 0) : setupFinalVal);
                  const isChosen = proposal.status === "aceita"
                    ? chosenTerm?.id === term.id
                    : chosenTermId === term.id;
                  return (
                    <button
                      key={term.id}
                      type="button"
                      disabled={proposal.status === "aceita"}
                      onClick={() => setChosenTermId(term.id)}
                      className={cn(
                        "text-left p-4 rounded-xl border transition-all space-y-1.5",
                        isChosen
                          ? "bg-purple-600/15 border-purple-500/60"
                          : "bg-slate-950 border-slate-900 hover:border-slate-700",
                        proposal.status === "aceita" && "cursor-default"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-white leading-tight">
                          {term.nome}
                          <span className={aplicaA === "mensalidade" ? "text-[8px] font-black uppercase text-blue-400 ml-1.5" : "text-[8px] font-black uppercase text-purple-400 ml-1.5"}>
                            · {APLICA_A_LABELS[aplicaA]}
                          </span>
                        </span>
                        {isChosen && <CheckCircle className="h-4 w-4 text-purple-400 shrink-0" />}
                      </div>
                      {breakdown.linhas.map((linha, idx) => (
                        <p key={idx} className="text-[10px] text-slate-300 font-medium">{linha}</p>
                      ))}
                    </button>
                  );
                })}
              </div>
              {proposal.status === "aceita" && chosenTerm && (
                <p className="text-[10px] text-emerald-400 font-bold">
                  Condição escolhida: {chosenTerm.nome}
                </p>
              )}
            </Card>
          )}

          {/* Condições negociadas na mesa */}
          {descontosConcedidos.length > 0 && (
            <Card className="bg-emerald-950/20 border-emerald-900/50 p-6 space-y-3">
              <h3 className="font-bold text-white text-base">Condições Negociadas</h3>
              <div className="space-y-2">
                {descontosConcedidos.map((d, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-4 text-xs">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      <span className="text-slate-200 font-medium">{d.motivo || DESCONTO_LABELS[d.tipo] || d.tipo}</span>
                    </div>
                    {d.tipo !== "parcelamento" && Number(d.valor_original) !== Number(d.valor_final) && (
                      <span className="font-mono shrink-0">
                        <span className="text-slate-500 line-through mr-2 dark:text-slate-400">R$ {Number(d.valor_original || 0).toLocaleString("pt-BR")}</span>
                        <span className="text-emerald-400 font-bold">R$ {Number(d.valor_final || 0).toLocaleString("pt-BR")}</span>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Contract details and conditions */}
          <Card className="bg-slate-900/40 border-slate-900 p-6 space-y-4">
            <h3 className="font-bold text-white text-base">Condições de Implantação e Contrato</h3>
            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line font-light">
              {proposal.condicoes}
            </p>
          </Card>
        </div>

        {/* Right area: investment, payment link and sign pad */}
        <div className="lg:col-span-2 space-y-6">

          {/* Investment Totals Card */}
          <Card className="bg-slate-900/60 border-slate-900 p-8 space-y-6 shadow-2xl">
            <h3 className="font-bold text-white text-xl">Valores Propostos</h3>

            <div className="space-y-5">
              <div className="pb-4 border-b border-slate-800 space-y-1 transition-all duration-500 ease-in-out">
                <span className="text-[11px] text-slate-400 font-mono font-bold uppercase tracking-widest block transition-colors duration-500">Investimento único (Setup)</span>
                <span className="text-purple-300 font-black text-3xl block transition-all duration-500 ease-in-out">
                  {setupIsento ? (
                    <span className="text-emerald-400 transition-colors duration-500">Isento</span>
                  ) : (
                    <>
                      {setupFinalVal < setupBaseVal && (
                        <span className="text-slate-500 line-through mr-2 font-bold text-lg transition-all duration-500 dark:text-slate-400">
                          R$ {setupBaseVal.toLocaleString("pt-BR")}
                        </span>
                      )}
                      R$ {setupFinalVal.toLocaleString("pt-BR")}
                    </>
                  )}
                </span>
              </div>
              <div className="pb-4 border-b border-slate-800 space-y-1 transition-all duration-500 ease-in-out">
                <span className="text-[11px] text-slate-400 font-mono font-bold uppercase tracking-widest block transition-colors duration-500">Mensalidade</span>
                {(() => {
                  const vpMensal = Number(proposal.valor_vp || 0);
                  const temVp = vpMensal > 0 && vpMensal < mensalFinalVal;
                  const dinheiroMensal = temVp ? mensalFinalVal - vpMensal : mensalFinalVal;
                  return (
                    <>
                      <span className="text-pink-400 font-black text-3xl block transition-all duration-500 ease-in-out">
                        {(mensalFinalVal < mensalBaseVal || temVp) && (
                          <span className="text-slate-500 line-through mr-2 font-bold text-lg transition-all duration-500 dark:text-slate-400">
                            R$ {(temVp ? mensalFinalVal : mensalBaseVal).toLocaleString("pt-BR")}
                          </span>
                        )}
                        R$ {(temVp ? dinheiroMensal : mensalFinalVal).toLocaleString("pt-BR")}<span className="text-base font-bold text-slate-400 transition-colors duration-500">/mês</span>
                      </span>
                      {temVp && (
                        <div className="mt-2 space-y-1">
                          <div className="flex items-center justify-between py-1.5 px-3 bg-pink-500/10 border border-pink-500/20 rounded-md">
                            <span className="text-[11px] text-slate-300 font-bold uppercase tracking-wider">Em reais</span>
                            <span className="text-pink-300 text-sm font-black">R$ {dinheiroMensal.toLocaleString("pt-BR")}/mês</span>
                          </div>
                          <div className="flex items-center justify-between py-1.5 px-3 bg-emerald-500/10 border border-emerald-500/20 rounded-md">
                            <span className="text-[11px] text-emerald-300 font-bold uppercase tracking-wider">Em VP (permuta)</span>
                            <span className="text-emerald-400 text-sm font-black">R$ {vpMensal.toLocaleString("pt-BR")}/mês</span>
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
                {primeiraMensalidadeDate && (
                  <span className="text-xs font-bold text-amber-300 block pt-1 transition-colors duration-500">
                    Primeira mensalidade em {primeiraMensalidadeDate.toLocaleDateString("pt-BR")} (carência de {carenciaDias} dias)
                  </span>
                )}
              </div>
              {calc.mesesPeriodo > 1 && (
                <div className="pb-4 border-b border-slate-800 space-y-1 transition-all duration-500 ease-in-out">
                  <span className="text-[11px] text-slate-400 font-mono font-bold uppercase tracking-widest block transition-colors duration-500 font-semibold">Compromisso do Período</span>
                  <span className="text-indigo-400 font-black text-3xl block transition-all duration-500 ease-in-out">
                    {calc.compromissoFinal < calc.compromissoOriginal && (
                      <span className="text-slate-500 line-through mr-2 font-bold text-lg transition-all duration-500">
                        R$ {calc.compromissoOriginal.toLocaleString("pt-BR")}
                      </span>
                    )}
                    R$ {calc.compromissoFinal.toLocaleString("pt-BR")}
                  </span>
                  <span className="text-[10px] text-slate-400 block pt-1 transition-colors duration-500">
                    Soma total das mensalidades por {calc.mesesPeriodo} meses.
                  </span>
                </div>
              )}
              {proposal.valor_vp !== null && Number(proposal.valor_vp) > 0 && (
                <div className="pb-4 border-b border-slate-800 space-y-1 animate-fade-in transition-all duration-500 ease-in-out">
                  <span className="text-[11px] text-slate-400 font-mono font-bold uppercase tracking-widest block transition-colors duration-500">Permuta Comercial (VP)</span>
                  <span className="text-purple-400 font-black text-3xl block transition-all duration-500 ease-in-out">
                    R$ {Number(proposal.valor_vp).toLocaleString("pt-BR")}
                  </span>
                  <span className="text-[10px] text-purple-300 block font-light leading-snug">
                    Acordo realizado via permuta comercial física ou de serviços.
                  </span>
                </div>
              )}
              {(meioSetupPub || meioMensalPub) && (
                <div className="flex justify-between items-center text-sm font-mono pb-2 border-b border-slate-900">
                  <span className="text-slate-400">Meio de pagamento:</span>
                  <span className="text-white font-bold">
                    {[meioSetupPub && `Setup: ${meioSetupPub}`, meioMensalPub && `Mensalidade: ${meioMensalPub}`].filter(Boolean).join(" · ")}
                  </span>
                </div>
              )}
              <div className="pt-1 space-y-2">
                <span className="text-[11px] text-slate-400 font-mono font-bold uppercase tracking-widest block">Formas de pagamento aceitas</span>
                <div className="flex flex-wrap gap-2">
                  {([["pix", "PIX"], ["cartao", "Cartão de Crédito"], ["boleto", "Boleto"]] as const).map(([key, label]) => {
                    const selecionado = meioSetupArr.includes(key) || meioMensalArr.includes(key);
                    return (
                      <span
                        key={key}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-bold border",
                          selecionado
                            ? "bg-purple-600 text-white border-purple-500"
                            : "bg-slate-950 text-slate-200 border-slate-700"
                        )}
                      >
                        {label}
                        {selecionado && " ✓"}
                      </span>
                    );
                  })}
                </div>
                {(meioSetupPub || meioMensalPub) && (
                  <span className="text-xs text-slate-300 font-medium block">
                    {[meioSetupPub && `Entrada: ${meioSetupPub}`, meioMensalPub && `Mensalidade: ${meioMensalPub}`].filter(Boolean).join(" · ")}
                  </span>
                )}
              </div>

              {proposal.periodo_plano && PERIODO_LABELS[proposal.periodo_plano] && (
                <div className="flex justify-between items-center text-sm font-mono">
                  <span className="text-slate-400">Período do Plano:</span>
                  <span className="text-white font-bold">{PERIODO_LABELS[proposal.periodo_plano]}</span>
                </div>
              )}
            </div>

            {/* Pay Now Button (if link exists) */}
            {proposal.payment_link && (
              <Button
                asChild
                className="w-full bg-gradient-to-r from-purple-700 to-indigo-600 hover:opacity-90 font-extrabold text-white py-6 rounded-xl text-xs shadow-lg shadow-indigo-600/15 flex items-center justify-center gap-1.5"
              >
                <a href={proposal.payment_link} target="_blank" rel="noopener noreferrer">
                  Pagar agora
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            )}
          </Card>

          {/* Signature or Confirmation card */}
          <Card className="bg-slate-900/40 border-slate-900 p-6 space-y-5">

            {proposal.status === "aceita" ? (
              <div className="space-y-4 text-center">
                <div className="h-10 w-10 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-white">Proposta Aceita!</h4>
                  <p className="text-[10px] text-slate-400">Assinado legalmente por:</p>
                  <span className="text-xs font-mono font-bold text-emerald-400 block">{proposal.signer_name}</span>
                </div>

                {proposal.assinatura && (
                  proposal.assinatura.startsWith("data:image") ? (
                    <div className="h-20 w-full max-w-[200px] bg-white rounded-lg p-1.5 mx-auto flex items-center justify-center overflow-hidden">
                      <img src={proposal.assinatura} alt="Assinatura" className="max-h-full max-w-full object-contain" />
                    </div>
                  ) : (
                    <div className="py-3 text-center">
                      <span className="font-mono text-lg italic font-bold text-slate-800 bg-white border border-slate-200 rounded-lg px-4 py-1.5 inline-block max-w-xs mx-auto shadow-sm tracking-wider dark:text-white">
                        {proposal.assinatura}
                      </span>
                      <span className="text-[9px] text-slate-500 block mt-1 font-mono uppercase dark:text-slate-400">Assinatura Digitada</span>
                    </div>
                  )
                )}

                <div className="text-[9px] text-slate-550 font-mono space-y-0.5 pt-1.5 border-t border-slate-800 dark:text-slate-400">
                  <div>Assinado em: {proposal.signed_at ? new Date(proposal.signed_at).toLocaleString("pt-BR") : ""}</div>
                  {proposal.assinatura_metodo && (
                    <div>Método de Aceite: {proposal.assinatura_metodo === "digitado" ? "Nome Digitado" : "Desenho Livre"}</div>
                  )}
                  <div>IP registrado: {proposal.signer_ip || "Registrado"}</div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-[10px] text-slate-700 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-950 p-3 rounded-lg border border-slate-200 dark:border-slate-800 transition-colors duration-500">
                  <span className="font-bold text-slate-900 dark:text-white block mb-1 uppercase font-mono tracking-wider">Termo de Aceite:</span>
                  "Declaro estar de acordo com os serviços, valores e condições desta proposta e autorizo o início dos trabalhos."
                </div>

                <div className="space-y-2">
                  <Label className="text-[10px] text-slate-400 font-mono">Nome Completo do Assinante</Label>
                  <Input
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    placeholder="Nome do Responsável Legal"
                    className="bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-xs text-slate-900 dark:text-white placeholder:text-slate-500 focus-visible:ring-purple-500/50 h-9"
                  />
                </div>

                {/* Seleção do Método de Assinatura */}
                <div className="space-y-3">
                  <Label className="text-[10px] text-slate-400 font-mono block">Escolha a Forma de Aceite</Label>
                  <div className="flex bg-slate-900/50 p-1 rounded-lg border border-slate-850 gap-1">
                    <button
                      type="button"
                      onClick={() => setSignMethod('desenho')}
                      className={cn(
                        "flex-1 py-1 text-[10px] font-extrabold rounded-md transition-all font-mono",
                        signMethod === 'desenho' ? "bg-gradient-to-r from-purple-700 to-indigo-600 text-white" : "text-slate-400 hover:text-white"
                      )}
                    >
                      Desenhar Assinatura
                    </button>
                    <button
                      type="button"
                      onClick={() => setSignMethod('digitado')}
                      className={cn(
                        "flex-1 py-1 text-[10px] font-extrabold rounded-md transition-all font-mono",
                        signMethod === 'digitado' ? "bg-gradient-to-r from-purple-700 to-indigo-600 text-white" : "text-slate-400 hover:text-white"
                      )}
                    >
                      Digitar Nome
                    </button>
                  </div>
                </div>

                {signMethod === 'desenho' ? (
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label className="text-[10px] text-slate-400 font-mono">Assine com o Mouse ou Dedo</Label>
                      <button onClick={clearCanvas} className="text-[10px] text-pink-400 hover:text-pink-300 font-semibold font-mono">
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
                      className="w-full bg-white border border-slate-300 dark:border-slate-700 rounded-xl cursor-crosshair h-[120px]"
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label className="text-[10px] text-slate-400 font-mono">Visualização da Assinatura Digitada</Label>
                    <div className="h-[120px] w-full bg-slate-950 border border-slate-900 rounded-xl flex items-center justify-center p-4">
                      {signerName.trim() ? (
                        <span className="font-mono text-xl italic text-pink-500 font-extrabold border-b border-dashed border-pink-500/50 pb-1 px-4 tracking-wider select-none">
                          {signerName}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-500 italic font-mono dark:text-slate-400">Digite seu nome completo acima para pré-visualizar...</span>
                      )}
                    </div>
                  </div>
                )}

                <Button
                  onClick={handleSignProposal}
                  className="w-full bg-gradient-to-r from-purple-700 to-indigo-600 hover:opacity-90 font-extrabold text-white py-3 rounded-xl text-xs"
                >
                  <PenTool className="h-4 w-4 mr-1.5" />
                  Registrar Assinatura de Aceite
                </Button>
              </div>
            )}
          </Card>
        </div>
      </main>

      <div className="fixed bottom-4 right-4 z-40 opacity-0 hover:opacity-100 transition-opacity">
        <Button variant="ghost" size="icon" onClick={() => setShowMesa(true)} className="text-slate-800 hover:text-white hover:bg-slate-800 rounded-full w-8 h-8 dark:text-white">
           <Lock className="w-3 h-3 opacity-20 hover:opacity-100" />
        </Button>
      </div>

      {/* Mesa de Negociação — overlay na MESMA tela (gatilho: cadeado ou Shift+N) */}
      {showMesa && id && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-50 dark:bg-slate-950">
          <GeracaoDigitalNegotiationPage
            proposalId={id}
            onExit={() => {
              setShowMesa(false);
              reloadPublicProposalSilent();
            }}
          />
        </div>
      )}
    </div>
  );
}
