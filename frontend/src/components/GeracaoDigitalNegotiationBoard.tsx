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
  Clock
} from "lucide-react";
import {
  type PaymentTerm,
  type DescontoConcedido,
  computePaymentBreakdown,
  SETUP_LABEL
} from "@/lib/geracaoDigital/paymentTerms";

interface BoardItem {
  descricao: string;
  categoria: "gd" | "vexo";
  valor: number;
  recorrencia: "mensal" | "unico";
  // Metadados de ancoragem do pacote (opcionais — presentes no item de pacote)
  periodo?: string | null;
  meses?: number | null;
  total_periodo?: number | null;
  valor_tabela?: number | null;
}

interface NegotiationBoardProps {
  prospectName: string;
  items: BoardItem[];
  setupItensTotal: number;      // itens de recorrência única (setup GD)
  recurringTotal: number;       // mensalidade
  setupVexoValue: number;       // taxa de implantação Vexo (0 se não cobrada)
  periodoPlano: string;
  validadeAte: string;          // yyyy-mm-dd ou ""
  offeredTerms: PaymentTerm[];
  onClose: () => void;
  onFinalize: (result: {
    descontos: DescontoConcedido[];
    valorSetupVexoFinal: number;
  }) => void;
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
  // Concessões ao vivo
  const [setupIsento, setSetupIsento] = useState(false);
  const [tipoDesconto, setTipoDesconto] = useState<'porcentagem' | 'valor'>('porcentagem');
  const [valorDesconto, setValorDesconto] = useState<number>(0);
  const [parcelas, setParcelas] = useState<number>(1);

  // Entrada = setup dos itens + taxa de implantação Vexo.
  // Parcelamento e descontos incidem SÓ sobre a entrada; a mensalidade é separada.
  const entradaOriginal = setupItensTotal + setupVexoValue;
  const entradaBase = setupItensTotal + (setupIsento ? 0 : setupVexoValue);

  const entradaFinal = useMemo(() => {
    if (tipoDesconto === 'porcentagem') {
      return entradaBase * (1 - (valorDesconto || 0) / 100);
    } else {
      return Math.max(0, entradaBase - (valorDesconto || 0));
    }
  }, [entradaBase, tipoDesconto, valorDesconto]);

  const valorParcela = parcelas > 1 ? entradaFinal / parcelas : entradaFinal;

  const descontos = useMemo<DescontoConcedido[]>(() => {
    const list: DescontoConcedido[] = [];
    if (setupIsento && setupVexoValue > 0) {
      list.push({
        tipo: "isencao_setup",
        valor_original: setupVexoValue,
        valor_final: 0,
        motivo: periodoPlano === "anual" ? "Isenção de setup — plano anual" : "Isenção de setup concedida na negociação"
      });
    }
    const valorDescontoAbs = entradaBase - entradaFinal;
    if (valorDescontoAbs > 0) {
      const pctEquiv = entradaBase > 0 ? Math.round((valorDescontoAbs / entradaBase) * 100) : 0;
      list.push({
        tipo: "desconto_avista",
        valor_original: entradaBase,
        valor_final: entradaFinal,
        motivo: tipoDesconto === "porcentagem"
          ? `Desconto de ${valorDesconto}% no pagamento à vista da entrada`
          : `Desconto de ${brl(valorDesconto)} (equivalente a ${pctEquiv}%) no pagamento à vista da entrada`
      });
    }
    if (parcelas > 1) {
      list.push({
        tipo: "parcelamento",
        valor_original: entradaFinal,
        valor_final: entradaFinal,
        motivo: `Entrada dividida em ${parcelas}x de ${brl(valorParcela)} (mensalidade à parte)`
      });
    }
    return list;
  }, [setupIsento, tipoDesconto, valorDesconto, parcelas, setupVexoValue, entradaBase, entradaFinal, valorParcela, periodoPlano]);

  const resetAll = () => {
    setSetupIsento(false);
    setTipoDesconto('porcentagem');
    setValorDesconto(0);
    setParcelas(1);
  };

  const anchorItem = items.find((i) => Number(i.total_periodo || 0) > 0) || null;
  const anchorTabela = anchorItem ? Number(anchorItem.valor_tabela || 0) : 0;
  const anchorTotal = anchorItem ? Number(anchorItem.total_periodo || 0) : 0;
  const anchorDescontoPct = anchorItem && anchorTabela > anchorTotal && anchorTotal > 0
    ? Math.round((1 - anchorTotal / anchorTabela) * 100)
    : null;

  const gdItems = items.filter((i) => i.categoria !== "vexo");
  const vexoItems = items.filter((i) => i.categoria === "vexo");
  const validadeDate = validadeAte ? new Date(`${validadeAte}T23:59:59`) : null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-gradient-to-br from-purple-50 via-white to-pink-50">
      {/* Glow decorativo */}
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
        {/* Escopo */}
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
              {offeredTerms.map((term) => {
                const b = computePaymentBreakdown(term, entradaFinal);
                return (
                  <div key={term.id} className="p-3 rounded-2xl bg-purple-50/60 border border-purple-100 space-y-0.5">
                    <span className="text-xs font-bold text-slate-800 block">{term.nome}</span>
                    {b.linhas.map((l, i) => (
                      <span key={i} className="text-[10px] text-purple-700 font-medium block">{l}</span>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Valores + ações ao vivo */}
        <section className="lg:col-span-3 space-y-5">
          {/* Ancoragem: compromisso do período com valor de tabela riscado */}
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

          {/* Painel de valores */}
          <div className="rounded-3xl bg-gradient-to-r from-purple-600 to-pink-500 p-[2px] shadow-2xl shadow-purple-300/40">
            <div className="rounded-[calc(1.5rem-2px)] bg-white p-8 grid gap-6 sm:grid-cols-2">
              <div className="space-y-1">
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-400">
                  Entrada (Setup)
                </span>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h2 className="text-4xl font-black bg-gradient-to-r from-purple-600 to-pink-500 bg-clip-text text-transparent">
                    {parcelas > 1 ? `${parcelas}x ${brl(valorParcela)}` : brl(entradaFinal)}
                  </h2>
                  {entradaFinal < entradaOriginal && (
                    <span className="text-sm font-bold text-slate-400 line-through">{brl(entradaOriginal)}</span>
                  )}
                </div>
                {setupVexoValue > 0 && (
                  <span className="text-[10px] text-slate-500 block">
                    {SETUP_LABEL}: {setupIsento ? (
                      <b className="text-emerald-600">isento</b>
                    ) : (
                      brl(setupVexoValue)
                    )}
                  </span>
                )}
              </div>
              <div className="space-y-1 sm:text-right">
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-400">
                  Mensalidade
                </span>
                <h2 className="text-4xl font-black text-slate-900">
                  {brl(recurringTotal)}<span className="text-base font-bold text-slate-400">/mês</span>
                </h2>
                <span className="text-[10px] text-slate-500 block">faturamento recorrente, à parte da entrada</span>
              </div>
            </div>
          </div>

          {/* Ações interativas */}
          <div className="grid gap-4 sm:grid-cols-3">
            <button
              onClick={() => setSetupIsento((v) => !v)}
              disabled={setupVexoValue <= 0}
              className={cn(
                "rounded-3xl p-5 text-left border-2 transition-all space-y-2 bg-white shadow-lg",
                setupVexoValue <= 0 && "opacity-40 cursor-not-allowed",
                setupIsento
                  ? "border-emerald-400 shadow-emerald-100"
                  : "border-transparent hover:border-purple-200 shadow-purple-100/60"
              )}
            >
              <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center", setupIsento ? "bg-emerald-100 text-emerald-600" : "bg-purple-100 text-purple-600")}>
                <Gift className="h-4 w-4" />
              </div>
              <h4 className="text-sm font-black text-slate-800">Isentar Setup</h4>
              <p className="text-[10px] text-slate-500 leading-snug">
                {setupIsento ? "Setup isento nesta negociação ✔" : "Cortesia de implantação (ex: plano anual)."}
              </p>
            </button>

            <div className={cn(
              "rounded-3xl p-5 border-2 bg-white shadow-lg space-y-2.5 transition-all",
              valorDesconto > 0 ? "border-pink-400 shadow-pink-100" : "border-transparent shadow-purple-100/60"
            )}>
              <div className="flex justify-between items-center">
                <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0", valorDesconto > 0 ? "bg-pink-100 text-pink-600" : "bg-purple-100 text-purple-600")}>
                  <Percent className="h-4 w-4" />
                </div>
                {/* Tipo de desconto switcher */}
                <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                  <button
                    type="button"
                    onClick={() => { setTipoDesconto('porcentagem'); setValorDesconto(0); }}
                    className={cn(
                      "px-2 py-0.5 text-[9px] font-extrabold rounded-md transition-all",
                      tipoDesconto === 'porcentagem' ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-800"
                    )}
                  >
                    %
                  </button>
                  <button
                    type="button"
                    onClick={() => { setTipoDesconto('valor'); setValorDesconto(0); }}
                    className={cn(
                      "px-2 py-0.5 text-[9px] font-extrabold rounded-md transition-all",
                      tipoDesconto === 'valor' ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-800"
                    )}
                  >
                    R$
                  </button>
                </div>
              </div>
              <h4 className="text-sm font-black text-slate-800">Desconto Livre</h4>

              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max={tipoDesconto === 'porcentagem' ? 100 : undefined}
                  placeholder={tipoDesconto === 'porcentagem' ? "Ex: 10" : "Ex: 500"}
                  value={valorDesconto || ""}
                  onChange={(e) => {
                    const val = Number(e.target.value) || 0;
                    if (tipoDesconto === 'porcentagem') {
                      setValorDesconto(Math.min(100, Math.max(0, val)));
                    } else {
                      setValorDesconto(Math.min(entradaBase, Math.max(0, val)));
                    }
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-800 font-mono focus:outline-none focus:border-purple-500 text-right pr-6"
                />
                <span className="absolute right-2 top-2 text-[10px] font-mono text-slate-400">
                  {tipoDesconto === 'porcentagem' ? '%' : 'R$'}
                </span>
              </div>
              <p className="text-[10px] text-slate-500 leading-snug font-light">desconto aplicado sobre a entrada (setup)</p>
            </div>

            <div className={cn(
              "rounded-3xl p-5 border-2 bg-white shadow-lg space-y-2 transition-all",
              parcelas > 1 ? "border-purple-400 shadow-purple-100" : "border-transparent shadow-purple-100/60"
            )}>
              <div className="h-9 w-9 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center">
                <Layers className="h-4 w-4" />
              </div>
              <h4 className="text-sm font-black text-slate-800">Dividir / Parcelar</h4>
              <div className="flex gap-1.5">
                {[1, 3, 6, 12].map((n) => (
                  <button
                    key={n}
                    onClick={() => setParcelas(n)}
                    className={cn(
                      "flex-1 rounded-lg py-1.5 text-[11px] font-bold border transition-all",
                      parcelas === n
                        ? "bg-gradient-to-r from-purple-600 to-pink-500 text-white border-transparent"
                        : "bg-white text-slate-600 border-slate-200 hover:border-purple-300"
                    )}
                  >
                    {n === 1 ? "1x" : `${n}x`}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 leading-snug">
                parcela só a entrada — mensalidade segue à parte
              </p>
            </div>
          </div>

          {/* Concessões registradas */}
          {descontos.length > 0 && (
            <div className="rounded-3xl bg-white/85 backdrop-blur border border-emerald-200 shadow-lg p-5 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-emerald-600">
                  Concessões desta negociação
                </h3>
                <button onClick={resetAll} className="text-[10px] font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1">
                  <RotateCcw className="h-3 w-3" /> limpar
                </button>
              </div>
              {descontos.map((d, idx) => (
                <div key={idx} className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-700 font-medium">{d.motivo}</span>
                  {d.tipo !== "parcelamento" && (
                    <span className="font-mono font-bold text-emerald-600">
                      {brl(d.valor_original)} → {brl(d.valor_final)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Fechar proposta */}
          <Button
            onClick={() => onFinalize({ descontos, valorSetupVexoFinal: setupIsento ? 0 : setupVexoValue })}
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
