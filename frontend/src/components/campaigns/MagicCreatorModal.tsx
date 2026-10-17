import { useState, useId } from "react";
import {
  Wand2,
  Sparkles,
  Loader2,
  Check,
  Bot,
  ExternalLink,
  Building2,
  Stethoscope,
  Dumbbell,
  Car,
  ShoppingBag,
  Pencil,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useMagicCreateCampaign, type MagicCampaignResult } from "@/hooks/useCampanhas";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface MagicCreatorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (result: MagicCampaignResult) => void;
  clientId?: string;
}

interface NicheOption {
  id: string;
  label: string;
  icon: typeof Building2;
  placeholder: string;
}

const NICHE_OPTIONS: NicheOption[] = [
  {
    id: "imobiliaria",
    label: "🏢 Imobiliária",
    icon: Building2,
    placeholder: "Ex: Lançamento de apartamentos na planta com entrada facilitada para investidores...",
  },
  {
    id: "estetica",
    label: "🩺 Estética & Saúde",
    icon: Stethoscope,
    placeholder: "Ex: Campanha de Botox Day com avaliação gratuita e condição especial para as primeiras 15 clientes...",
  },
  {
    id: "academia",
    label: "🏋️ Academia",
    icon: Dumbbell,
    placeholder: "Ex: Retomada de treinos para ex-alunos com isenção total de matrícula e passe livre...",
  },
  {
    id: "veiculos",
    label: "🚗 Veículos",
    icon: Car,
    placeholder: "Ex: Supervalorização do seminovo na troca e taxa zero de financiamento para modelos selecionados...",
  },
  {
    id: "varejo",
    label: "🛍️ Comércio",
    icon: ShoppingBag,
    placeholder: "Ex: Queima de estoque de coleção com cupom de 25% de desconto para compras acima de R$ 199...",
  },
];

const TONE_OPTIONS = [
  { id: "consultivo", label: "🤝 Consultivo", desc: "Profissional, acolhedor e focado em diagnóstico" },
  { id: "persuasivo", label: "🎯 Persuasivo", desc: "Focado em benefícios, escassez e exclusividade" },
  { id: "descontraido", label: "😄 Descontraído", desc: "Linguagem leve, amigável e próxima" },
] as const;

export function MagicCreatorModal({
  open,
  onOpenChange,
  onApply,
  clientId,
}: MagicCreatorModalProps) {
  const [prompt, setPrompt] = useState("");
  const [selectedNiche, setSelectedNiche] = useState<string | null>(null);
  const [isCustomNiche, setIsCustomNiche] = useState(false);
  const [customNicheText, setCustomNicheText] = useState("");
  const [selectedTone, setSelectedTone] = useState<"consultivo" | "persuasivo" | "descontraido">("consultivo");
  const [generatedResult, setGeneratedResult] = useState<MagicCampaignResult | null>(null);

  const customNicheInputId = useId();
  const magicMutation = useMagicCreateCampaign();

  // Determina placeholder dinâmico baseado no nicho selecionado
  const currentPlaceholder = selectedNiche
    ? (NICHE_OPTIONS.find((n) => n.id === selectedNiche)?.placeholder || "Ex: Descreva o objetivo da campanha...")
    : isCustomNiche
    ? "Ex: Campanha personalizada para o seu segmento..."
    : "Ex: Lançamento de apartamentos na planta com entrada facilitada para investidores...";

  const handleToggleNiche = (nicheId: string) => {
    setIsCustomNiche(false);
    if (selectedNiche === nicheId) {
      setSelectedNiche(null);
    } else {
      setSelectedNiche(nicheId);
    }
  };

  const handleToggleCustomNiche = () => {
    setSelectedNiche(null);
    setIsCustomNiche((prev) => !prev);
  };

  const effectiveNicheValue = isCustomNiche
    ? (customNicheText.trim() || "geral")
    : (selectedNiche || "geral");

  const handleGenerate = async () => {
    try {
      const result = await magicMutation.mutateAsync({
        prompt: prompt.trim(),
        niche: effectiveNicheValue,
        tone: selectedTone,
        clientId,
      });
      setGeneratedResult(result);
      toast.success("Campanha gerada com sucesso! Confira a prévia abaixo.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao gerar campanha com IA");
    }
  };

  const handleApply = () => {
    if (!generatedResult) return;
    onApply(generatedResult);
    onOpenChange(false);
  };

  const handleReset = () => {
    setGeneratedResult(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-0 gap-0 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl rounded-2xl">
        {/* Header Elegante com Gradiente */}
        <div className="relative overflow-hidden p-6 pb-5 border-b border-slate-200/80 dark:border-slate-800 bg-gradient-to-br from-indigo-50/50 via-purple-50/30 to-white dark:from-indigo-950/30 dark:via-purple-950/20 dark:to-slate-900">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-violet-600 via-indigo-600 to-purple-500 text-white shadow-md shadow-indigo-500/25">
                <Wand2 className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  Vexo Magic Creator
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/60">
                    <Sparkles className="h-3 w-3" />
                    Copiloto Criativo
                  </span>
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Crie campanhas completas de alta conversão para WhatsApp em 1 clique
                </DialogDescription>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {!generatedResult ? (
            /* Formulário de Criação */
            <div className="space-y-5">
              {/* Textarea do Prompt */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                  <span>Descrição da Oferta ou Campanha</span>
                  <span className="text-[10px] text-slate-400 font-normal">Linguagem natural</span>
                </label>
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={currentPlaceholder}
                  rows={3}
                  className="resize-none rounded-xl border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 focus-visible:ring-indigo-500 text-sm leading-relaxed"
                />
              </div>

              {/* Pílulas de Nicho Opcionais com Estado Toggle */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Segmento / Nicho <span className="text-slate-400 font-normal">(Opcional)</span>
                  </label>
                  {!selectedNiche && !isCustomNiche && (
                    <span className="text-[11px] text-indigo-600 dark:text-indigo-400 font-medium">
                      IA deduzirá do texto
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {NICHE_OPTIONS.map((niche) => {
                    const isSelected = selectedNiche === niche.id;
                    return (
                      <button
                        key={niche.id}
                        type="button"
                        onClick={() => handleToggleNiche(niche.id)}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all active:scale-95 flex items-center gap-1.5",
                          isSelected
                            ? "bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-500/25"
                            : "bg-white dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700/80 hover:bg-slate-50 dark:hover:bg-slate-800"
                        )}
                      >
                        {niche.label}
                        {isSelected && <Check className="h-3 w-3 stroke-[2.5]" />}
                      </button>
                    );
                  })}

                  {/* Pílula Outro Nicho */}
                  <button
                    type="button"
                    onClick={handleToggleCustomNiche}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all active:scale-95 flex items-center gap-1.5",
                      isCustomNiche
                        ? "bg-purple-600 text-white border-purple-600 shadow-sm shadow-purple-500/25"
                        : "bg-white dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700/80 hover:bg-slate-50 dark:hover:bg-slate-800"
                    )}
                  >
                    <Pencil className="h-3 w-3" />
                    <span>Outro...</span>
                    {isCustomNiche && <Check className="h-3 w-3 stroke-[2.5]" />}
                  </button>
                </div>

                {/* Input Inline para Nicho Customizado */}
                {isCustomNiche && (
                  <div className="pt-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <label htmlFor={customNicheInputId} className="sr-only">
                      Digite seu segmento
                    </label>
                    <Input
                      id={customNicheInputId}
                      value={customNicheText}
                      onChange={(e) => setCustomNicheText(e.target.value)}
                      placeholder="Digite seu segmento (ex: Pet Shop, Energia Solar, Consultoria...)"
                      className="h-9 text-xs rounded-lg border-purple-300 dark:border-purple-800 bg-purple-50/20 dark:bg-purple-950/20 focus-visible:ring-purple-500"
                      autoFocus
                    />
                  </div>
                )}
              </div>

              {/* Seletor de Tom */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Tom de Voz da Campanha
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {TONE_OPTIONS.map((tone) => {
                    const isSelected = selectedTone === tone.id;
                    return (
                      <button
                        key={tone.id}
                        type="button"
                        onClick={() => setSelectedTone(tone.id)}
                        className={cn(
                          "p-2.5 rounded-xl border text-left transition-all active:scale-98 flex flex-col gap-0.5",
                          isSelected
                            ? "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-400 dark:border-indigo-600 ring-1 ring-indigo-400 dark:ring-indigo-600"
                            : "bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800"
                        )}
                      >
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center justify-between">
                          {tone.label}
                          {isSelected && <Check className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 stroke-[2.5]" />}
                        </span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
                          {tone.desc}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Botão de Ação Primária */}
              <div className="pt-2">
                <Button
                  type="button"
                  onClick={handleGenerate}
                  disabled={magicMutation.isPending}
                  className="w-full h-11 bg-gradient-to-r from-violet-600 via-indigo-600 to-purple-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold text-sm shadow-md shadow-indigo-500/25 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-98"
                >
                  {magicMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Criando Estratégia de Alta Conversão...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      <span>⚡ Gerar Campanha Completa</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          ) : (
            /* Visualização da Prévia Gerada com Bordas Cromáticas */
            <div className="space-y-5 animate-in fade-in duration-200">
              {/* Cabeçalho do Resultado */}
              <div className="p-4 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/30 dark:bg-indigo-950/20 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-extrabold text-indigo-950 dark:text-indigo-200 flex items-center gap-1.5">
                    <span>📢</span> {generatedResult.campaignName}
                  </h3>
                  <Badge variant="outline" className="border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold">
                    3 Passos Estratégicos
                  </Badge>
                </div>
                {generatedResult.rationale && (
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Estratégia:</span> {generatedResult.rationale}
                  </p>
                )}
              </div>

              {/* Grid dos 3 Passos com Diferenciação Cromática Bi-Tema */}
              <div className="space-y-3">
                {generatedResult.steps.map((step) => {
                  if (step.order === 1) {
                    return (
                      <div
                        key={step.order}
                        className="border-l-4 border-l-blue-600 dark:border-l-blue-400 bg-white dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 rounded-xl p-3.5 shadow-xs space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/80 dark:text-blue-300 dark:border-blue-800/70">
                            ⚡ Passo 1 · Disparo Inicial (Imediato)
                          </span>
                          <span className="text-[10px] text-slate-400 font-medium">Texto Direto</span>
                        </div>
                        <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-sans bg-slate-50/50 dark:bg-slate-950/40 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800/50">
                          {step.text}
                        </p>
                      </div>
                    );
                  }

                  if (step.order === 2) {
                    return (
                      <div
                        key={step.order}
                        className="border-l-4 border-l-emerald-600 dark:border-l-emerald-400 bg-white dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 rounded-xl p-3.5 shadow-xs space-y-2.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800/70">
                            💬 Passo 2 · Pós-Resposta com Botões
                          </span>
                          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">Interativo</span>
                        </div>
                        <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-sans bg-slate-50/50 dark:bg-slate-950/40 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800/50">
                          {step.text}
                        </p>
                        {step.buttons && step.buttons.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-0.5">
                            {step.buttons.map((btn, i) => (
                              <span
                                key={i}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-100/70 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300/70 dark:border-emerald-800 flex items-center gap-1"
                              >
                                <span>🔘</span> {btn.displayText}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  }

                  return (
                    <div
                      key={step.order}
                      className="border-l-4 border-l-cyan-600 dark:border-l-cyan-400 bg-white dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 rounded-xl p-3.5 shadow-xs space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-cyan-50 text-cyan-700 border border-cyan-200 dark:bg-cyan-950/80 dark:text-cyan-300 dark:border-cyan-800/70">
                          🔗 Passo 3 · Envio de Link Oficial
                        </span>
                        <span className="text-[10px] text-cyan-600 dark:text-cyan-400 font-medium">Conversão</span>
                      </div>
                      <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-sans bg-slate-50/50 dark:bg-slate-950/40 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800/50">
                        {step.text}
                      </p>
                      {step.linkUrl && (
                        <div className="flex items-center gap-1.5 text-xs text-cyan-700 dark:text-cyan-300 font-mono bg-cyan-500/10 dark:bg-cyan-950/50 px-2.5 py-1.5 rounded-lg border border-cyan-300/60 dark:border-cyan-800">
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{step.linkUrl}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Roteiro do Robô / Agente IA */}
              <div className="rounded-xl border border-purple-200/80 dark:border-purple-900/50 bg-purple-50/20 dark:bg-purple-950/15 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                  <span className="text-xs font-bold text-purple-950 dark:text-purple-200">
                    Instruções para o Agente IA (Roteiro da Campanha)
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-sans bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-purple-100 dark:border-purple-900/40">
                  {generatedResult.agentPrompt}
                </p>
              </div>

              {/* Ações Finais: Aplicar em 1-Clique ou Recriar */}
              <div className="flex items-center justify-between gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleReset}
                  className="h-10 text-xs font-semibold rounded-xl border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Ajustar Parâmetros</span>
                </Button>

                <Button
                  type="button"
                  onClick={handleApply}
                  className="h-10 bg-gradient-to-r from-violet-600 via-indigo-600 to-purple-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-xs shadow-md shadow-indigo-500/25 rounded-xl px-5 flex items-center gap-2 transition-all active:scale-98"
                >
                  <Sparkles className="h-4 w-4" />
                  <span>🪄 Aplicar na Campanha</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
