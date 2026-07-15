import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { Gift, Percent, Layers, Wallet, CheckCircle, Save, Trash2, Zap } from "lucide-react";
import {
  type PaymentTerm,
  computePaymentBreakdown,
  termAplicaA,
  APLICA_A_LABELS
} from "@/lib/geracaoDigital/paymentTerms";
import {
  type NegotiationLayers,
  type NegotiationResult,
  EMPTY_LAYERS,
  computeNegotiation
} from "@/lib/geracaoDigital/negotiation";
import { MeioPills, DescontoLivreInput } from "@/components/geracaoDigital/NegotiationControls";
import { ConcessionsPanel } from "@/components/geracaoDigital/ConcessionsPanel";
import { useNegotiationScenarios } from "@/hooks/useNegotiationScenarios";

// Painel de controle do VENDEDOR na Mesa de Negociação — nunca visível ao
// cliente. Abre por atalho (Ctrl+Shift+M) ou pelo ícone discreto do header.
// Todas as alavancas de concessão vivem aqui; a tela do cliente mostra só o
// resultado.
//
// >>> Ponto de encaixe do CONTROLE DE MARGEM (fase futura): quando existirem
// dados de custo/breakeven, o piso de desconto entra aqui — comparando
// result.totalConcedidoSetup / result.totalConcedidoMensalidade (já calculados
// pelo motor em lib/geracaoDigital/negotiation.ts) com o limite permitido, e
// bloqueando/alertando antes do onLayersChange. Nenhum recálculo da mesa é
// necessário: o motor já expõe os totais concedidos por trilha.

interface SellerControlPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layers: NegotiationLayers;
  onLayersChange: (layers: NegotiationLayers) => void;
  result: NegotiationResult;
  offeredTerms: PaymentTerm[];
  setupVexoValue: number;
}

export function SellerControlPanel({
  open,
  onOpenChange,
  layers,
  onLayersChange,
  result,
  offeredTerms,
  setupVexoValue
}: SellerControlPanelProps) {
  const patch = (p: Partial<NegotiationLayers>) => onLayersChange({ ...layers, ...p });
  const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const { scenarios, createScenario, deleteScenario } = useNegotiationScenarios();
  const [scenarioName, setScenarioName] = useState("");

  const toggleTerm = (term: PaymentTerm) => {
    if (termAplicaA(term) === "mensalidade") {
      patch({ condicaoMensalidadeId: layers.condicaoMensalidadeId === term.id ? null : term.id });
    } else {
      patch({ condicaoSetupId: layers.condicaoSetupId === term.id ? null : term.id });
    }
  };

  const applyScenario = (config: Partial<NegotiationLayers>, nome: string) => {
    onLayersChange({ ...EMPTY_LAYERS, ...config });
    toast({ title: "Cenário aplicado", description: nome });
  };

  const handleSaveScenario = () => {
    if (!scenarioName.trim()) {
      toast({ title: "Nome obrigatório", description: "Dê um nome ao cenário (ex: Fechamento anual).", variant: "destructive" });
      return;
    }
    createScenario.mutate(
      { nome: scenarioName.trim(), config: layers },
      {
        onSuccess: () => {
          toast({ title: "Cenário salvo", description: scenarioName.trim() });
          setScenarioName("");
        },
        onError: (err: Error) => toast({ title: "Erro", description: err.message, variant: "destructive" })
      }
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto bg-white border-l border-slate-200 p-5 space-y-5">
        <SheetHeader className="space-y-1">
          <SheetTitle className="text-base font-black text-slate-800">Painel do Vendedor</SheetTitle>
          <SheetDescription className="text-[11px] text-slate-500">
            Invisível para o cliente. Ajuste as alavancas — a tela atualiza ao vivo. Atalho: Ctrl+Shift+M.
          </SheetDescription>
        </SheetHeader>

        {/* Cenários pré-configurados */}
        <div className="space-y-2 p-4 rounded-2xl bg-purple-50/60 border border-purple-100">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-purple-600" />
            <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">Cenários</h4>
          </div>
          {scenarios.length === 0 && (
            <p className="text-[10px] text-slate-500 italic">Nenhum cenário salvo. Configure as alavancas e salve abaixo.</p>
          )}
          {scenarios.map((sc) => (
            <div key={sc.id} className="flex items-center gap-1.5">
              <button
                onClick={() => applyScenario(sc.config, sc.nome)}
                className="flex-1 text-left px-3 py-2 rounded-xl bg-white border border-purple-200 text-xs font-bold text-slate-700 hover:border-purple-400 transition-all"
              >
                {sc.nome}
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-400 hover:text-red-500"
                onClick={() => deleteScenario.mutate(sc.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <div className="flex gap-1.5 pt-1">
            <Input
              value={scenarioName}
              onChange={(e) => setScenarioName(e.target.value)}
              placeholder='Salvar alavancas atuais como... (ex: "Máximo autorizado")'
              className="bg-white border-purple-200 text-xs h-8 flex-1"
            />
            <Button size="sm" onClick={handleSaveScenario} className="bg-purple-600 hover:bg-purple-500 text-white h-8">
              <Save className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Alavancas */}
        <div className="space-y-3">
          <button
            onClick={() => patch({ isencaoSetup: !layers.isencaoSetup })}
            disabled={setupVexoValue <= 0}
            className={cn(
              "w-full flex items-center gap-3 p-3 rounded-2xl border-2 text-left transition-all",
              setupVexoValue <= 0 && "opacity-40 cursor-not-allowed",
              layers.isencaoSetup ? "border-emerald-400 bg-emerald-50/50" : "border-slate-200 bg-white hover:border-purple-300"
            )}
          >
            <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center shrink-0", layers.isencaoSetup ? "bg-emerald-100 text-emerald-600" : "bg-purple-100 text-purple-600")}>
              <Gift className="h-4 w-4" />
            </div>
            <div>
              <span className="text-xs font-black text-slate-800 block">Isentar Setup</span>
              <span className="text-[10px] text-slate-500">{layers.isencaoSetup ? "isento ✔" : "cortesia de implantação"}</span>
            </div>
          </button>

          <div className={cn("p-3 rounded-2xl border-2 space-y-2", layers.descontoSetup.valor > 0 ? "border-pink-300 bg-pink-50/40" : "border-slate-200 bg-white")}>
            <div className="flex items-center gap-2">
              <Percent className="h-3.5 w-3.5 text-pink-500" />
              <span className="text-xs font-black text-slate-800">Desconto na Entrada</span>
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

          <div className={cn("p-3 rounded-2xl border-2 space-y-2", layers.descontoMensalidade.valor > 0 ? "border-blue-300 bg-blue-50/40" : "border-slate-200 bg-white")}>
            <div className="flex items-center gap-2">
              <Percent className="h-3.5 w-3.5 text-blue-500" />
              <span className="text-xs font-black text-slate-800">Desconto na Mensalidade</span>
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

          <div className="p-3 rounded-2xl border-2 border-slate-200 bg-white space-y-3">
            <div className="flex items-center gap-2">
              <Layers className="h-3.5 w-3.5 text-purple-500" />
              <span className="text-xs font-black text-slate-800">Parcelamento Setup</span>
            </div>
            {/* Número livre de parcelas + forma (cartão/boleto). */}
            <div className="space-y-1.5">
              <span className="text-[9px] font-bold uppercase text-slate-400">Nº de parcelas</span>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  value={layers.parcelas || 1}
                  onChange={(e) => {
                    const n = Math.max(1, Math.floor(Number(e.target.value) || 1));
                    patch({ parcelas: n });
                  }}
                  className="bg-slate-50 border-slate-200 text-xs h-8 w-24 font-mono text-right"
                />
                <span className="text-[11px] font-bold text-slate-500">
                  {layers.parcelas > 1 ? `${layers.parcelas}x de ${brl(result.valorParcela)}` : "à vista"}
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <span className="text-[9px] font-bold uppercase text-slate-400">Forma da entrada</span>
              <div className="flex gap-1.5">
                {(["cartao", "boleto"] as const).map((m) => {
                  const on = layers.meioSetup.includes(m);
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => patch({ meioSetup: on ? layers.meioSetup.filter((x) => x !== m) : [...layers.meioSetup, m] })}
                      className={cn(
                        "flex-1 rounded-lg py-1.5 text-[11px] font-bold border transition-all",
                        on
                          ? "bg-gradient-to-r from-purple-700 to-indigo-600 text-white border-transparent"
                          : "bg-white text-slate-600 border-slate-200 hover:border-purple-300"
                      )}
                    >
                      {m === "cartao" ? "Cartão" : "Boleto"}{on ? " ✓" : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="p-3 rounded-2xl border-2 border-slate-200 bg-white space-y-3">
            <div className="flex items-center gap-2">
              <Wallet className="h-3.5 w-3.5 text-purple-500" />
              <span className="text-xs font-black text-slate-800">Meio de Pagamento</span>
            </div>
            <div className="space-y-1">
              <span className="text-[9px] font-bold uppercase text-slate-400">Mensalidade</span>
              <MeioPills
                value={layers.meioMensalidade}
                onToggle={(m) => patch({ meioMensalidade: layers.meioMensalidade.includes(m) ? layers.meioMensalidade.filter((x) => x !== m) : [...layers.meioMensalidade, m] })}
                disabled={result.mensalidadeOriginal <= 0}
              />
            </div>
          </div>

          <div className="p-3 rounded-2xl border-2 border-slate-200 bg-white space-y-2">
            <span className="text-xs font-black text-slate-800 block">1º Vencimento da Mensalidade (carência)</span>
            <select
              value={layers.carenciaDias ?? ""}
              onChange={(e) => patch({ carenciaDias: e.target.value ? Number(e.target.value) : null })}
              className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-purple-500"
            >
              <option value="">Imediato (na contratação)</option>
              <option value="15">15 dias após a contratação</option>
              <option value="20">20 dias após a contratação</option>
              <option value="30">30 dias após a contratação</option>
            </select>
            <p className="text-[10px] text-slate-500 leading-snug">carência: não altera valores — só a data do 1º vencimento</p>
          </div>

          {/* Condições de pagamento aplicáveis */}
          {offeredTerms.length > 0 && (
            <div className="p-3 rounded-2xl border-2 border-slate-200 bg-white space-y-2">
              <span className="text-xs font-black text-slate-800 block">Condições de Pagamento</span>
              {offeredTerms.map((term) => {
                const aplicaA = termAplicaA(term);
                const selecionada = layers.condicaoSetupId === term.id || layers.condicaoMensalidadeId === term.id;
                const base = aplicaA === "mensalidade" ? result.mensalidadeOriginal : result.entradaOriginal;
                const b = computePaymentBreakdown(term, base);
                return (
                  <button
                    key={term.id}
                    onClick={() => toggleTerm(term)}
                    className={cn(
                      "w-full text-left p-2.5 rounded-xl border space-y-0.5 transition-all",
                      selecionada ? "bg-purple-100/80 border-purple-400" : "bg-purple-50/40 border-purple-100 hover:border-purple-300"
                    )}
                  >
                    <span className="text-[11px] font-bold text-slate-800 flex items-center justify-between">
                      <span>
                        {term.nome}
                        <span className={aplicaA === "mensalidade" ? "text-[8px] font-black uppercase text-blue-600 ml-1" : "text-[8px] font-black uppercase text-purple-500 ml-1"}>
                          · {APLICA_A_LABELS[aplicaA]}
                        </span>
                      </span>
                      {selecionada && <CheckCircle className="h-3.5 w-3.5 text-purple-600 shrink-0" />}
                    </span>
                    {b.linhas.map((l, i) => (
                      <span key={i} className="text-[9px] text-purple-700 font-medium block">{l}</span>
                    ))}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Concessões acumuladas — visão interna do vendedor */}
        <ConcessionsPanel result={result} parcelas={layers.parcelas} onReset={() => onLayersChange(EMPTY_LAYERS)} />
      </SheetContent>
    </Sheet>
  );
}
