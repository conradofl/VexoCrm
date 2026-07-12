import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PERIOD_LABELS as PKG_PERIOD_LABELS } from "@/lib/geracaoDigital/packagePricing";
import {
  X,
  Sparkles,
  Gift,
  Percent,
  Layers,
  CheckCircle,
  ArrowRight,
  RotateCcw,
  Clock,
  Wallet
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
import { MeioPills, DescontoLivreInput } from "@/components/geracaoDigital/NegotiationControls";
import { ConcessionsPanel } from "@/components/geracaoDigital/ConcessionsPanel";

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
  onFinalize
}: NegotiationBoardProps) {
  const [layers, setLayers] = useState<NegotiationLayers>(EMPTY_LAYERS);
  const patch = (p: Partial<NegotiationLayers>) => setLayers((prev) => ({ ...prev, ...p }));

  const result = useMemo(
    () => computeNegotiation({ setupItensTotal, setupVexoValue, recurringTotal, periodoPlano }, layers, offeredTerms),
    [setupItensTotal, setupVexoValue, recurringTotal, periodoPlano, layers, offeredTerms]
  );

  const anchorItem = items.find((i) => Number(i.total_periodo || 0) > 0) || null;
  const anchorTabela = anchorItem ? Number(anchorItem.valor_tabela || 0) : 0;
  const anchorTotal = anchorItem ? Number(anchorItem.total_periodo || 0) : 0;
  const anchorDescontoPct = anchorItem && anchorTabela > anchorTotal && anchorTotal > 0
    ? Math.round((1 - anchorTotal / anchorTabela) * 100)
    : null;

  const gdItems = items.filter((i) => i.categoria !== "vexo");
  const vexoItems = items.filter((i) => i.categoria === "vexo");
  const validadeDate = validadeAte ? new Date(`${validadeAte}T23:59:59`) : null;
  const temCamadas = result.camadasSetup.length > 0 || result.camadasMensalidade.length > 0 || layers.parcelas > 1;

  const toggleTerm = (term: PaymentTerm) => {
    if (termAplicaA(term) === "mensalidade") {
      patch({ condicaoMensalidadeId: layers.condicaoMensalidadeId === term.id ? null : term.id });
    } else {
      patch({ condicaoSetupId: layers.condicaoSetupId === term.id ? null : term.id });
    }
  };

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
            <span className="text-[10px] font-mono font-bold uppercase tracking-[0.25em] text-purple-600">
              Mesa de Negociação
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
        {/* Escopo + condições selecionáveis */}
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

          {offeredTerms.length > 0 && (
            <div className="rounded-3xl bg-white/85 backdrop-blur border border-purple-100 shadow-xl shadow-purple-100/50 p-6 space-y-3">
              <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-purple-600">Condições Disponíveis</h3>
              <p className="text-[10px] text-slate-500">Clique para aplicar à negociação — o efeito entra nas concessões.</p>
              {offeredTerms.map((term) => {
                const aplicaA = termAplicaA(term);
                const selecionada = layers.condicaoSetupId === term.id || layers.condicaoMensalidadeId === term.id;
                const base = aplicaA === "mensalidade" ? result.mensalidadeOriginal : result.entradaOriginal;
                const b = computePaymentBreakdown(term, base);
                return (
                  <button
                    key={term.id}
                    type="button"
                    onClick={() => toggleTerm(term)}
                    className={cn(
                      "w-full text-left p-3 rounded-2xl border space-y-0.5 transition-all",
                      selecionada
                        ? "bg-purple-100/80 border-purple-400 shadow-md"
                        : "bg-purple-50/60 border-purple-100 hover:border-purple-300"
                    )}
                  >
                    <span className="text-xs font-bold text-slate-800 flex items-center justify-between">
                      <span>
                        {term.nome}
                        <span className={aplicaA === "mensalidade" ? "text-[9px] font-black uppercase text-blue-600 ml-1.5" : "text-[9px] font-black uppercase text-purple-500 ml-1.5"}>
                          · {APLICA_A_LABELS[aplicaA]}
                        </span>
                      </span>
                      {selecionada && <CheckCircle className="h-4 w-4 text-purple-600 shrink-0" />}
                    </span>
                    {b.linhas.map((l, i) => (
                      <span key={i} className="text-[10px] text-purple-700 font-medium block">{l}</span>
                    ))}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Valores + alavancas */}
        <section className="lg:col-span-3 space-y-5">
          {anchorItem && (
            <div className="rounded-3xl bg-white/85 backdrop-blur border border-pink-200 shadow-xl shadow-pink-100/50 p-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-pink-500 w-full">
                {anchorItem.periodo && PKG_PERIOD_LABELS[anchorItem.periodo]
                  ? `Compromisso do Período — Plano ${PKG_PERIOD_LABELS[anchorItem.periodo]}`
                  : "Compromisso do Período"}
              </span>
              {anchorDescontoPct !== null && (
                <span className="text-xl font-bold text-slate-400 line-through">De {brl(anchorTabela)}</span>
              )}
              <span className="text-3xl font-black bg-gradient-to-r from-purple-600 to-pink-500 bg-clip-text text-transparent">
                {anchorDescontoPct !== null ? "por " : ""}{brl(anchorTotal)}
              </span>
              {anchorDescontoPct !== null && (
                <Badge className="bg-emerald-100 text-emerald-700 border-none font-black text-xs px-2.5 py-0.5">
                  {anchorDescontoPct}% OFF
                </Badge>
              )}
              <span className="text-xs font-bold text-slate-500 w-full">
                diluído em {Number(anchorItem.meses || 1)}x → {brl(Number(anchorItem.valor || 0))}/mês (mensalidade abaixo)
              </span>
            </div>
          )}

          {/* Painel de valores — trilhas separadas */}
          <div className="rounded-3xl bg-gradient-to-r from-purple-600 to-pink-500 p-[2px] shadow-2xl shadow-purple-300/40">
            <div className="rounded-[calc(1.5rem-2px)] bg-white p-8 grid gap-6 sm:grid-cols-2">
              <div className="space-y-1">
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-400">
                  Entrada (Setup)
                </span>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h2 className="text-4xl font-black bg-gradient-to-r from-purple-600 to-pink-500 bg-clip-text text-transparent">
                    {layers.parcelas > 1 ? `${layers.parcelas}x ${brl(result.valorParcela)}` : brl(result.entradaFinal)}
                  </h2>
                  {result.entradaFinal < result.entradaOriginal && (
                    <span className="text-sm font-bold text-slate-400 line-through">{brl(result.entradaOriginal)}</span>
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
                    {brl(result.mensalidadeFinal)}<span className="text-base font-bold text-slate-400">/mês</span>
                  </h2>
                  {result.mensalidadeFinal < result.mensalidadeOriginal && (
                    <span className="text-sm font-bold text-slate-400 line-through">{brl(result.mensalidadeOriginal)}</span>
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

          {/* Alavancas */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <button
              onClick={() => patch({ isencaoSetup: !layers.isencaoSetup })}
              disabled={setupVexoValue <= 0}
              className={cn(
                "rounded-3xl p-5 text-left border-2 transition-all space-y-2 bg-white shadow-lg",
                setupVexoValue <= 0 && "opacity-40 cursor-not-allowed",
                layers.isencaoSetup ? "border-emerald-400 shadow-emerald-100" : "border-transparent hover:border-purple-200 shadow-purple-100/60"
              )}
            >
              <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center", layers.isencaoSetup ? "bg-emerald-100 text-emerald-600" : "bg-purple-100 text-purple-600")}>
                <Gift className="h-4 w-4" />
              </div>
              <h4 className="text-sm font-black text-slate-800">Isentar Setup</h4>
              <p className="text-[10px] text-slate-500 leading-snug">
                {layers.isencaoSetup ? "Setup isento nesta negociação ✔" : "Cortesia de implantação (ex: plano anual)."}
              </p>
            </button>

            <div className={cn(
              "rounded-3xl p-5 border-2 bg-white shadow-lg space-y-2 transition-all",
              layers.descontoSetup.valor > 0 ? "border-pink-400 shadow-pink-100" : "border-transparent shadow-purple-100/60"
            )}>
              <div className="flex items-center gap-2">
                <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0", layers.descontoSetup.valor > 0 ? "bg-pink-100 text-pink-600" : "bg-purple-100 text-purple-600")}>
                  <Percent className="h-4 w-4" />
                </div>
                <h4 className="text-sm font-black text-slate-800">Desconto na Entrada</h4>
              </div>
              <DescontoLivreInput
                modo={layers.descontoSetup.modo}
                valor={layers.descontoSetup.valor}
                max={result.entradaOriginal}
                onModo={(m) => patch({ descontoSetup: { modo: m, valor: 0 } })}
                onValor={(v) => patch({ descontoSetup: { ...layers.descontoSetup, valor: v } })}
                alvo="a entrada (setup)"
              />
            </div>

            <div className={cn(
              "rounded-3xl p-5 border-2 bg-white shadow-lg space-y-2 transition-all",
              layers.descontoMensalidade.valor > 0 ? "border-blue-400 shadow-blue-100" : "border-transparent shadow-purple-100/60"
            )}>
              <div className="flex items-center gap-2">
                <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0", layers.descontoMensalidade.valor > 0 ? "bg-blue-100 text-blue-600" : "bg-purple-100 text-purple-600")}>
                  <Percent className="h-4 w-4" />
                </div>
                <h4 className="text-sm font-black text-slate-800">Desconto na Mensalidade</h4>
              </div>
              <DescontoLivreInput
                modo={layers.descontoMensalidade.modo}
                valor={layers.descontoMensalidade.valor}
                max={result.mensalidadeOriginal}
                onModo={(m) => patch({ descontoMensalidade: { modo: m, valor: 0 } })}
                onValor={(v) => patch({ descontoMensalidade: { ...layers.descontoMensalidade, valor: v } })}
                alvo="a mensalidade"
              />
            </div>

            <div className={cn(
              "rounded-3xl p-5 border-2 bg-white shadow-lg space-y-2 transition-all",
              layers.parcelas > 1 ? "border-purple-400 shadow-purple-100" : "border-transparent shadow-purple-100/60"
            )}>
              <div className="h-9 w-9 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center">
                <Layers className="h-4 w-4" />
              </div>
              <h4 className="text-sm font-black text-slate-800">Dividir / Parcelar</h4>
              <div className="flex gap-1.5">
                {[1, 3, 6, 12].map((n) => (
                  <button
                    key={n}
                    onClick={() => patch({ parcelas: n })}
                    className={cn(
                      "flex-1 rounded-lg py-1.5 text-[11px] font-bold border transition-all",
                      layers.parcelas === n
                        ? "bg-gradient-to-r from-purple-600 to-pink-500 text-white border-transparent"
                        : "bg-white text-slate-600 border-slate-200 hover:border-purple-300"
                    )}
                  >
                    {n === 1 ? "1x" : `${n}x`}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 leading-snug">parcela só a entrada — mensalidade à parte</p>
            </div>
          </div>

          {/* Meio de pagamento */}
          <div className="rounded-3xl bg-white/85 backdrop-blur border border-purple-100 shadow-lg p-5 grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-purple-600" />
                <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">Meio de pagamento — Entrada</h4>
              </div>
              <MeioPills value={layers.meioSetup} onChange={(m) => patch({ meioSetup: m })} disabled={result.entradaOriginal <= 0} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-blue-600" />
                <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">Meio de pagamento — Mensalidade</h4>
              </div>
              <MeioPills value={layers.meioMensalidade} onChange={(m) => patch({ meioMensalidade: m })} disabled={result.mensalidadeOriginal <= 0} />
            </div>
          </div>

          {/* Concessões acumuladas */}
          {temCamadas && (
            <ConcessionsPanel
              result={result}
              parcelas={layers.parcelas}
              onReset={() => setLayers(EMPTY_LAYERS)}
            />
          )}

          <Button
            onClick={() => onFinalize({
              descontos: result.descontos,
              valorSetupVexoFinal: layers.isencaoSetup ? 0 : setupVexoValue,
              meioPagamento: { setup: layers.meioSetup, mensalidade: layers.meioMensalidade }
            })}
            className="w-full bg-gradient-to-r from-purple-600 to-pink-500 hover:opacity-90 text-white font-black py-7 rounded-3xl text-sm shadow-2xl shadow-purple-300/50"
          >
            Gerar / Fechar Proposta
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </section>
      </main>
    </div>
  );
}
