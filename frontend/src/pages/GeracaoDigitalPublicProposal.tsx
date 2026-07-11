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
  ExternalLink
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  type ProposalPaymentTerms,
  type DescontoConcedido,
  DESCONTO_LABELS,
  computePaymentBreakdown,
  SETUP_LABEL,
  SETUP_JUSTIFICATION
} from "@/lib/geracaoDigital/paymentTerms";

interface ProposalItem {
  product_id?: string | null;
  descricao: string;
  categoria: "gd" | "vexo";
  valor: number;
  recorrencia: "mensal" | "unico";
}

interface Proposal {
  id: string;
  prospect_name: string;
  itens: ProposalItem[];
  valor_total: number;
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
  assinatura_metodo?: string | null;
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

  // Signature state
  const [signerName, setSignerName] = useState<string>("");
  const [signMethod, setSignMethod] = useState<'desenho' | 'digitado'>('desenho');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  useEffect(() => {
    if (id) {
      loadPublicProposal();
    }
  }, [id]);

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

  const items = Array.isArray(proposal.itens) ? proposal.itens : [];
  const setupVexoValue = proposal.cobrar_setup ? Number(proposal.valor_setup_vexo || 0) : 0;
  const grandTotal = Number(proposal.valor_setup || 0) + Number(proposal.valor_recorrente || 0) + setupVexoValue;
  const offeredTerms = Array.isArray(proposal.condicoes_pagamento?.ofertadas)
    ? proposal.condicoes_pagamento!.ofertadas
    : [];
  const chosenTerm = proposal.condicoes_pagamento?.escolhida || null;
  const validadeDate = proposal.validade_ate ? new Date(proposal.validade_ate) : null;
  const validadeExpirada = validadeDate ? validadeDate.getTime() < Date.now() : false;
  const descontosConcedidos = Array.isArray(proposal.descontos_concedidos) ? proposal.descontos_concedidos : [];

  const setupBaseVal = Number(proposal.valor_setup || 0) + setupVexoValue;
  const discountConcession = descontosConcedidos.find(d => d.tipo === "desconto_avista");
  const isentoConcession = descontosConcedidos.find(d => d.tipo === "isencao_setup");
  const setupIsento = (setupBaseVal === 0) || (isentoConcession && setupBaseVal === setupVexoValue);

  let setupFinalVal = setupIsento ? 0 : setupBaseVal;
  if (discountConcession && !setupIsento) {
    setupFinalVal = Number(discountConcession.valor_final);
  }

  return (
    <div className="dark min-h-screen bg-slate-950 text-white font-sans selection:bg-purple-500/35 pb-16">

      {/* Background decoration */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-0 right-0 h-[400px] w-[400px] rounded-full bg-purple-600/5 blur-[100px]" />
        <div className="absolute bottom-0 left-0 h-[400px] w-[400px] rounded-full bg-pink-600/5 blur-[100px]" />
      </div>

      <header className="relative z-10 max-w-5xl mx-auto px-6 py-8 flex justify-between items-center border-b border-slate-900">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center text-white font-black text-lg">
            GD
          </div>
          <div>
            <h2 className="text-base font-black text-white leading-tight">Geração Digital</h2>
            <span className="text-[10px] text-slate-400 uppercase font-mono">Proposta Comercial</span>
          </div>
        </div>

        <Badge
          className={cn(
            "text-xs font-extrabold px-3 py-1 border-none",
            proposal.status === "aceita" ? "bg-emerald-500 text-white" : "bg-purple-600 text-white animate-pulse"
          )}
        >
          {proposal.status === "aceita" ? "Fechado ✔" : "Aguardando Assinatura"}
        </Badge>
      </header>

      <main className="relative z-10 max-w-5xl mx-auto px-6 mt-12 grid gap-8 md:grid-cols-3">

        {/* Left/Middle area: content of proposal */}
        <div className="md:col-span-2 space-y-8">

          <div className="space-y-2">
            <span className="text-[10px] text-purple-400 font-mono font-bold uppercase tracking-wider">Apresentado para</span>
            <h1 className="text-3xl md:text-4xl font-black text-white">{proposal.prospect_name}</h1>
            <p className="text-xs text-slate-400 font-mono">Proposta comercial emitida em {new Date(proposal.created_at).toLocaleDateString("pt-BR")}</p>
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

          {/* List of items */}
          <Card className="bg-slate-900/40 border-slate-900 overflow-hidden shadow-2xl">
            <CardHeader className="border-b border-slate-900 bg-slate-900/60">
              <CardTitle className="text-base font-bold text-white">Escopo Geral de Serviços</CardTitle>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-slate-900">
              {items.map((item, idx) => (
                <div key={idx} className="p-5 flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-white leading-tight">{item.descricao}</h4>
                    <span className="text-[9px] uppercase font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-800">
                      {item.categoria === "vexo" ? "Vexo OS" : "Geração Digital"}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-black text-white font-mono">R$ {item.valor.toFixed(2)}</span>
                    <span className="text-[9px] text-slate-400 block uppercase tracking-wider font-mono">
                      {item.recorrencia === "mensal" ? "recorrente" : "setup único"}
                    </span>
                  </div>
                </div>
              ))}
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
              <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line font-light">
                {SETUP_JUSTIFICATION}
              </p>
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
                  const breakdown = computePaymentBreakdown(term, setupFinalVal);
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
                        <span className="text-xs font-bold text-white leading-tight">{term.nome}</span>
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
                        <span className="text-slate-500 line-through mr-2">R$ {Number(d.valor_original || 0).toLocaleString("pt-BR")}</span>
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
            <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line font-light">
              {proposal.condicoes}
            </p>
          </Card>
        </div>

        {/* Right area: investment, payment link and sign pad */}
        <div className="space-y-6">

          {/* Investment Totals Card */}
          <Card className="bg-slate-900/60 border-slate-900 p-6 space-y-5 shadow-2xl">
            <h3 className="font-bold text-white text-base">Valores Propostos</h3>

            <div className="space-y-3">
              <div className="flex justify-between items-center text-xs font-mono pb-2 border-b border-slate-900">
                <span className="text-slate-400">Investimento único (Setup):</span>
                <span className="text-purple-300 font-extrabold text-sm">
                  {setupIsento ? (
                    <span className="text-emerald-400 font-bold">Isento</span>
                  ) : (
                    <>
                      {setupFinalVal < setupBaseVal && (
                        <span className="text-slate-500 line-through mr-2 font-normal text-xs">
                          R$ {setupBaseVal.toLocaleString("pt-BR")}
                        </span>
                      )}
                      R$ {setupFinalVal.toLocaleString("pt-BR")}
                    </>
                  )}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs font-mono pb-2 border-b border-slate-900">
                <span className="text-slate-400">Mensalidade:</span>
                <span className="text-pink-400 font-extrabold text-sm">
                  R$ {proposal.valor_recorrente?.toLocaleString("pt-BR") || "0,00"}/mês
                </span>
              </div>
              {proposal.periodo_plano && PERIODO_LABELS[proposal.periodo_plano] && (
                <div className="flex justify-between items-center text-xs font-mono">
                  <span className="text-slate-400">Período do Plano:</span>
                  <span className="text-white font-bold">{PERIODO_LABELS[proposal.periodo_plano]}</span>
                </div>
              )}
            </div>

            {/* Pay Now Button (if link exists) */}
            {proposal.payment_link && (
              <Button
                asChild
                className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:opacity-90 font-extrabold text-white py-6 rounded-xl text-xs shadow-lg shadow-purple-600/15 flex items-center justify-center gap-1.5"
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
                      <span className="font-mono text-lg italic font-bold text-slate-800 bg-white border border-slate-200 rounded-lg px-4 py-1.5 inline-block max-w-xs mx-auto shadow-sm tracking-wider">
                        {proposal.assinatura}
                      </span>
                      <span className="text-[9px] text-slate-500 block mt-1 font-mono uppercase">Assinatura Digitada</span>
                    </div>
                  )
                )}

                <div className="text-[9px] text-slate-550 font-mono space-y-0.5 pt-1.5 border-t border-slate-800">
                  <div>Assinado em: {proposal.signed_at ? new Date(proposal.signed_at).toLocaleString("pt-BR") : ""}</div>
                  {proposal.assinatura_metodo && (
                    <div>Método de Aceite: {proposal.assinatura_metodo === "digitado" ? "Nome Digitado" : "Desenho Livre"}</div>
                  )}
                  <div>IP registrado: {proposal.signer_ip || "Registrado"}</div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-[10px] text-slate-400 leading-relaxed bg-slate-950 p-3 rounded-lg border border-slate-900">
                  <span className="font-bold text-white block mb-1 uppercase font-mono tracking-wider">Termo de Aceite:</span>
                  "Declaro estar de acordo com os serviços, valores e condições desta proposta e autorizo o início dos trabalhos."
                </div>

                <div className="space-y-2">
                  <Label className="text-[10px] text-slate-400 font-mono">Nome Completo do Assinante</Label>
                  <Input
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    placeholder="Nome do Responsável Legal"
                    className="bg-slate-900 border-slate-800 text-xs text-white placeholder:text-slate-500 focus-visible:ring-purple-500/50 h-9"
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
                        signMethod === 'desenho' ? "bg-gradient-to-r from-purple-600 to-pink-500 text-white" : "text-slate-400 hover:text-white"
                      )}
                    >
                      Desenhar Assinatura
                    </button>
                    <button
                      type="button"
                      onClick={() => setSignMethod('digitado')}
                      className={cn(
                        "flex-1 py-1 text-[10px] font-extrabold rounded-md transition-all font-mono",
                        signMethod === 'digitado' ? "bg-gradient-to-r from-purple-600 to-pink-500 text-white" : "text-slate-400 hover:text-white"
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
                      className="w-full bg-slate-950 border border-slate-900 rounded-xl cursor-crosshair h-[120px]"
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
                        <span className="text-[10px] text-slate-500 italic font-mono">Digite seu nome completo acima para pré-visualizar...</span>
                      )}
                    </div>
                  </div>
                )}

                <Button
                  onClick={handleSignProposal}
                  className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:opacity-90 font-extrabold text-white py-3 rounded-xl text-xs"
                >
                  <PenTool className="h-4 w-4 mr-1.5" />
                  Registrar Assinatura de Aceite
                </Button>
              </div>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}
