import { useMemo, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PERIOD_LABELS as PKG_PERIOD_LABELS } from "@/lib/geracaoDigital/packagePricing";
import {
  X,
  Sparkles,
  CheckCircle,
  ArrowRight,
  Clock,
  Lock
} from "lucide-react";
import {
  type PaymentTerm,
  type DescontoConcedido,
  computePaymentBreakdown,
  termAplicaA,
  APLICA_A_LABELS,
  SETUP_LABEL
} from "@/lib/geracaoDigital/paymentTerms";
import {
  type NegotiationLayers,
  type MeioPagamento,
  EMPTY_LAYERS,
  MEIO_PAGAMENTO_LABELS,
  computeNegotiation
} from "@/lib/geracaoDigital/negotiation";
import { SellerControlPanel } from "@/components/geracaoDigital/SellerControlPanel";
import { calculateProposalValues } from "@/lib/geracaoDigital/proposalCalculator";

interface BoardItem {
  descricao: string;
  categoria: "gd" | "vexo";
  valor: number;
  recorrencia: "mensal" | "unico";
  periodo?: string | null;
  meses?: number | null;
  total_periodo?: number | null;
  valor_tabela?: number | null;
}

export interface NegotiationFinalizeResult {
  descontos: DescontoConcedido[];
  valorSetupVexoFinal: number;
  meioPagamento: { setup: MeioPagamento; mensalidade: MeioPagamento };
  carenciaDias: number | null;
}

interface NegotiationBoardProps {
  prospectName: string;
  items: BoardItem[];
  setupItensTotal: number;
  recurringTotal: number;
  setupVexoValue: number;
  periodoPlano: string;
  validadeAte: string;
  offeredTerms: PaymentTerm[];
  onClose: () => void;
  onFinalize: (result: NegotiationFinalizeResult) => void;
  packageId?: string | null;
  packageVexoId?: string | null;
  availablePackages: any[];
}

const PERIODO_LABELS: Record<string, string> = {
  mensal: "Plano Mensal",
  trimestral: "Plano Trimestral",
  semestral: "Plano Semestral",
  anual: "Plano Anual",
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function GeracaoDigitalNegotiationBoard({
  prospectName,
  items,
  setupItensTotal,
  recurringTotal,
  setupVexoValue,
  periodoPlano,
  validadeAte,
  offeredTerms,
  onClose,
  onFinalize,
  packageId,
  packageVexoId,
  availablePackages
}: NegotiationBoardProps) {
  const [layers, setLayers] = useState<NegotiationLayers>(EMPTY_LAYERS);
  const [showSellerPanel, setShowSellerPanel] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        setShowSellerPanel((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const result = useMemo(
    () => computeNegotiation({ setupItensTotal, setupVexoValue, recurringTotal, periodoPlano }, layers, offeredTerms),
    [setupItensTotal, setupVexoValue, recurringTotal, periodoPlano, layers, offeredTerms]
  );

  const calc = useMemo(() => {
    return calculateProposalValues({
      cobrar_setup: setupVexoValue > 0,
      valor_setup_vexo: setupVexoValue,
      package_id: packageId,
      package_vexo_id: packageVexoId,
      periodo_plano: periodoPlano,
      descontos_concedidos: result.descontos,
      itens: items
    }, availablePackages);
  }, [setupVexoValue, packageId, packageVexoId, periodoPlano, result.descontos, items, availablePackages]);

  const anchorItem = items.find((i) => Number(i.total_periodo || 0) > 0) || null;
  const anchorTabela = anchorItem ? Number(anchorItem.valor_tabela || 0) : 0;
  const anchorTotal = anchorItem ? Number(anchorItem.total_periodo || 0) : 0;
  const anchorDescontoPct = anchorItem && anchorTabela > anchorTotal && anchorTotal > 0
    ? Math.round((1 - anchorTotal / anchorTabela) * 100)
    : null;

  const gdItems = items.filter((i) => i.categoria !== "vexo");
  const vexoItems = items.filter((i) => i.categoria === "vexo");
  const validadeDate = validadeAte ? new Date(`${validadeAte}T23:59:59`) : null;

  const condSetupActive = useMemo(() => offeredTerms.find((t) => t.id === layers.condicaoSetupId), [offeredTerms, layers.condicaoSetupId]);
  const condMensalActive = useMemo(() => offeredTerms.find((t) => t.id === layers.condicaoMensalidadeId), [offeredTerms, layers.condicaoMensalidadeId]);

  const condicaoVigenteEl = useMemo(() => {
    const hasSetupCond = !!condSetupActive;
    const hasMensalCond = !!condMensalActive;
    const hasParcelamento = layers.parcelas > 1;
    const hasMeioSetup = !!layers.meioSetup;
    const hasMeioMensal = !!layers.meioMensalidade;

    if (!hasSetupCond && !hasMensalCond && !hasParcelamento && !hasMeioSetup && !hasMeioMensal) {
      return (
        <div className="rounded-3xl bg-white/85 backdrop-blur border border-purple-100 shadow-xl shadow-purple-100/50 p-6 space-y-3">
          <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-purple-600">Condição Comercial</h3>
          <p className="text-xs text-slate-500 font-medium">Condições padrão de faturamento (à vista/mensal).</p>
        </div>
      );
    }

    return (
      <div className="rounded-3xl bg-white/85 backdrop-blur border border-purple-100 shadow-xl shadow-purple-100/50 p-6 space-y-4">
        <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-purple-600">Condição Comercial Vigente</h3>
        <div className="space-y-3">
          {(condSetupActive || hasParcelamento || hasMeioSetup) && (
            <div className="space-y-1">
              <span className="text-[9px] font-black uppercase text-purple-500 block">Setup / Entrada</span>
              <div className="p-3 rounded-xl bg-purple-50/50 border border-purple-100 text-xs font-semibold text-slate-700 space-y-1">
                {condSetupActive ? (
                  <>
                    <span className="text-xs font-bold text-slate-800 block">{condSetupActive.nome}</span>
                    {computePaymentBreakdown(condSetupActive, result.entradaOriginal).linhas.map((l, i) => (
                      <span key={i} className="text-[10px] text-purple-700 font-medium block">{l}</span>
                    ))}
                  </>
                ) : (
                  <div>{hasParcelamento ? `Parcelado em ${layers.parcelas}x de ${brl(result.valorParcela)}` : "À vista"}</div>
                )}
                {hasMeioSetup && (
                  <div className="text-[10px] text-purple-600 font-bold">Meio: {MEIO_PAGAMENTO_LABELS[layers.meioSetup]}</div>
                )}
              </div>
            </div>
          )}

          {(condMensalActive || hasMeioMensal) && (
            <div className="space-y-1">
              <span className="text-[9px] font-black uppercase text-blue-500 block">Mensalidade</span>
              <div className="p-3 rounded-xl bg-blue-50/50 border border-blue-100 text-xs font-semibold text-slate-700 space-y-1">
                {condMensalActive ? (
                  <>
                    <span className="text-xs font-bold text-slate-800 block">{condMensalActive.nome}</span>
                    {computePaymentBreakdown(condMensalActive, result.mensalidadeOriginal).linhas.map((l, i) => (
                      <span key={i} className="text-[10px] text-blue-700 font-medium block">{l}</span>
                    ))}
                  </>
                ) : (
                  <div>Faturamento recorrente</div>
                )}
                {hasMeioMensal && (
                  <div className="text-[10px] text-blue-600 font-bold">Meio: {MEIO_PAGAMENTO_LABELS[layers.meioMensalidade]}</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }, [condSetupActive, condMensalActive, layers, result, result.entradaOriginal, result.mensalidadeOriginal]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-gradient-to-br from-purple-50 via-white to-pink-50">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-[420px] w-[420px] rounded-full bg-purple-200/40 blur-[120px]" />
        <div className="absolute -bottom-32 -left-32 h-[420px] w-[420px] rounded-full bg-pink-200/40 blur-[120px]" />
      </div>

      {/* Header */}
      <header className="relative z-10 max-w-6xl mx-auto px-8 pt-8 flex items-start justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <span className="text-[10px] font-mono font-bold uppercase tracking-[0.25em] text-purple-600 flex items-center gap-1.5">
              Mesa de Negociação
              <button
                type="button"
                onClick={() => setShowSellerPanel(true)}
                className="opacity-20 hover:opacity-100 transition-opacity p-1 text-slate-400 hover:text-slate-650 rounded"
                title="Painel do Vendedor (Ctrl+Shift+M)"
              >
                <Lock className="h-3 w-3" />
              </button>
            </span>
          </div>
          <h1 className="text-3xl md:text-4xl font-black text-slate-900 leading-tight">{prospectName}</h1>
          <div className="flex items-center gap-2">
            {periodoPlano && PERIODO_LABELS[periodoPlano] && (
              <Badge className="bg-purple-100 text-purple-700 border-none font-bold text-[10px] px-3 py-1">
                {PERIODO_LABELS[periodoPlano]}
              </Badge>
            )}
            {validadeDate && (
              <Badge className="bg-amber-100 text-amber-700 border-none font-bold text-[10px] px-3 py-1 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Válida até {validadeDate.toLocaleDateString("pt-BR")}
              </Badge>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="h-10 w-10 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-500 hover:text-slate-800 transition-colors"
          aria-label="Fechar mesa de negociação"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <main className="relative z-10 max-w-6xl mx-auto px-8 py-8 grid gap-8 lg:grid-cols-5">
        {/* Escopo + condição contratual vigente */}
        <section className="lg:col-span-2 space-y-5">
          <div className="rounded-3xl bg-white/85 backdrop-blur border border-purple-100 shadow-xl shadow-purple-100/50 p-6 space-y-4">
            <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-purple-600">Escopo Contratado</h3>
            <div className="space-y-2">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">Geração Digital</span>
              {gdItems.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <CheckCircle className="h-3.5 w-3.5 text-pink-500 shrink-0" />
                  <span className="text-xs font-semibold text-slate-700">{item.descricao}</span>
                </div>
              ))}
              {gdItems.length === 0 && <p className="text-[10px] text-slate-400 italic">Nenhum item GD.</p>}
            </div>
            {vexoItems.length > 0 && (
              <div className="space-y-2 pt-3 border-t border-dashed border-purple-100">
                <span className="text-[9px] font-bold uppercase tracking-wider text-purple-500 block">Módulos Vexo OS</span>
                {vexoItems.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <CheckCircle className="h-3.5 w-3.5 text-purple-500 shrink-0" />
                    <span className="text-xs font-semibold text-slate-700">{item.descricao}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {condicaoVigenteEl}
        </section>

        {/* Valores */}
        <section className="lg:col-span-3 space-y-5">
          <div className="rounded-3xl bg-white/85 backdrop-blur border border-pink-200 shadow-xl shadow-pink-100/50 p-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-pink-500 w-full">
              Compromisso Total do Período Contratual
            </span>
            {calc.compromissoFinal < calc.compromissoOriginal && (
              <span className="text-xl font-bold text-slate-400 line-through">De {brl(calc.compromissoOriginal)}</span>
            )}
            <span className="text-3xl font-black bg-gradient-to-r from-purple-600 to-pink-500 bg-clip-text text-transparent">
              {calc.compromissoFinal < calc.compromissoOriginal ? "por " : ""}{brl(calc.compromissoFinal)}
            </span>
            {calc.compromissoFinal < calc.compromissoOriginal && (
              <Badge className="bg-emerald-100 text-emerald-700 border-none font-black text-xs px-2.5 py-0.5">
                {Math.round((1 - calc.compromissoFinal / calc.compromissoOriginal) * 100)}% OFF
              </Badge>
            )}
            <span className="text-xs font-bold text-slate-500 w-full">
              diluído em {calc.mesesPeriodo} meses → {brl(calc.mensalidadeFinal)}/mês (mensalidade abaixo)
            </span>
          </div>

          {/* Painel de valores — trilhas separadas */}
          <div className="rounded-3xl bg-gradient-to-r from-purple-600 to-pink-500 p-[2px] shadow-2xl shadow-purple-300/40">
            <div className="rounded-[calc(1.5rem-2px)] bg-white p-8 grid gap-6 sm:grid-cols-2">
              <div className="space-y-1">
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-400">
                  Entrada (Setup)
                </span>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h2 className="text-4xl font-black bg-gradient-to-r from-purple-600 to-pink-500 bg-clip-text text-transparent">
                    {layers.parcelas > 1 ? `${layers.parcelas}x ${brl(calc.setupFinal / layers.parcelas)}` : brl(calc.setupFinal)}
                  </h2>
                  {calc.setupFinal < calc.setupOriginal && (
                    <span className="text-sm font-bold text-slate-400 line-through">{brl(calc.setupOriginal)}</span>
                  )}
                </div>
                {setupVexoValue > 0 && (
                  <span className="text-[10px] text-slate-500 block">
                    {SETUP_LABEL}: {layers.isencaoSetup ? <b className="text-emerald-600">isento</b> : brl(setupVexoValue)}
                  </span>
                )}
                {layers.meioSetup && (
                  <span className="text-[10px] text-purple-600 font-bold block">
                    via {MEIO_PAGAMENTO_LABELS[layers.meioSetup]}
                  </span>
                )}
              </div>
              <div className="space-y-1 sm:text-right">
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-400">
                  Mensalidade
                </span>
                <div className="flex items-baseline gap-2 flex-wrap sm:justify-end">
                  <h2 className="text-4xl font-black text-slate-900">
                    {brl(calc.mensalidadeFinal)}<span className="text-base font-bold text-slate-400">/mês</span>
                  </h2>
                  {calc.mensalidadeFinal < calc.mensalidadeOriginal && (
                    <span className="text-sm font-bold text-slate-400 line-through">{brl(calc.mensalidadeOriginal)}</span>
                  )}
                </div>
                <span className="text-[10px] text-slate-500 block">faturamento recorrente, à parte da entrada</span>
                {layers.meioMensalidade && (
                  <span className="text-[10px] text-blue-600 font-bold block">
                    via {MEIO_PAGAMENTO_LABELS[layers.meioMensalidade]}
                  </span>
                )}
              </div>
            </div>
          </div>

          <Button
            onClick={() => onFinalize({
              descontos: result.descontos,
              valorSetupVexoFinal: layers.isencaoSetup ? 0 : setupVexoValue,
              meioPagamento: { setup: layers.meioSetup, mensalidade: layers.meioMensalidade },
              carenciaDias: layers.carenciaDias
            })}
            className="w-full bg-gradient-to-r from-purple-600 to-pink-500 hover:opacity-90 text-white font-black py-7 rounded-3xl text-sm shadow-2xl shadow-purple-300/50"
          >
            Gerar / Fechar Proposta
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </section>
      </main>

      {/* Painel do Vendedor (Drawer oculto) */}
      <SellerControlPanel
        open={showSellerPanel}
        onOpenChange={setShowSellerPanel}
        layers={layers}
        onLayersChange={setLayers}
        result={result}
        offeredTerms={offeredTerms}
        setupVexoValue={setupVexoValue}
      />
    </div>
  );
}
