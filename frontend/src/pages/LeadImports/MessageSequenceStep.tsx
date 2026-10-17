import { useRef, type ChangeEvent, type RefObject } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Info, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmojiPicker } from "./EmojiPicker";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CampaignSequenceStep } from "@/hooks/useCampanhas";
import type { StepActionButton } from "@/lib/leadImports/spreadsheet";

type SequenceStep = CampaignSequenceStep & { buttons?: StepActionButton[] };

function getStepChromaticStyle(order: number, type: "text" | "image") {
  if (order === 1) {
    return {
      container:
        "border-l-4 border-l-blue-600 dark:border-l-blue-400 bg-white dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 rounded-xl shadow-xs",
      badge:
        "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/80 dark:text-blue-300 dark:border-blue-800/70 border font-bold text-[10px] tracking-wide",
      badgeText: "⚡ PASSO 1 · DISPARO INICIAL",
      marker: "bg-blue-600 text-white dark:bg-blue-500",
    };
  }
  if (order === 2) {
    return {
      container:
        "border-l-4 border-l-emerald-600 dark:border-l-emerald-400 bg-white dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 rounded-xl shadow-xs",
      badge:
        "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800/70 border font-bold text-[10px] tracking-wide",
      badgeText: "💬 PASSO 2 · PÓS-RESPOSTA",
      marker: "bg-emerald-600 text-white dark:bg-emerald-500",
    };
  }
  if (order === 3 || type === "image") {
    const isImage = type === "image";
    return {
      container:
        "border-l-4 border-l-amber-500 dark:border-l-amber-400 bg-white dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 rounded-xl shadow-xs",
      badge:
        "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-800/70 border font-bold text-[10px] tracking-wide",
      badgeText: isImage ? `🖼️ PASSO ${order} · MÍDIA / IMAGEM` : "🖼️ PASSO 3 · MÍDIA / IMAGEM",
      marker: "bg-amber-500 text-white dark:bg-amber-400 dark:text-slate-950",
    };
  }
  // Passos subsequentes (4, 5...): alternar entre purple e rose
  const isPurple = order % 2 === 0;
  if (isPurple) {
    return {
      container:
        "border-l-4 border-l-purple-600 dark:border-l-purple-400 bg-white dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 rounded-xl shadow-xs",
      badge:
        "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/80 dark:text-purple-300 dark:border-purple-800/70 border font-bold text-[10px] tracking-wide",
      badgeText: `🔄 PASSO ${order} · SEQUÊNCIA`,
      marker: "bg-purple-600 text-white dark:bg-purple-500",
    };
  }
  return {
    container:
      "border-l-4 border-l-rose-600 dark:border-l-rose-400 bg-white dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 rounded-xl shadow-xs",
    badge:
      "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/80 dark:text-rose-300 dark:border-rose-800/70 border font-bold text-[10px] tracking-wide",
    badgeText: `🎯 PASSO ${order} · CONTINUAÇÃO`,
    marker: "bg-rose-600 text-white dark:bg-rose-500",
  };
}

interface MessageSequenceStepProps {
  sequenceImageInputRef: RefObject<HTMLInputElement>;
  onSequenceImageChange: (event: ChangeEvent<HTMLInputElement>) => void;
  campaignSequence: SequenceStep[];
  updateCampaignStep: (stepId: string, patch: Partial<SequenceStep>) => void;
  moveCampaignStep: (stepId: string, direction: -1 | 1) => void;
  removeCampaignStep: (stepId: string) => void;
  addCampaignStep: (type: "text" | "image") => void;
  onSelectImageStep: (stepId: string) => void;
  isGeneratingVariants: boolean;
  onGenerateVariants: (stepId: string, baseText: string) => void;
  variantCount: number;
  onVariantCountChange: (value: number | null) => void;
  suggestedVariantCount: number;
  dailyQuota: number;
  minVariantCount: number;
  maxVariantCount: number;
  onAddStepButton: (stepId: string) => void;
  onRemoveStepButton: (stepId: string, btnIndex: number) => void;
  onUpdateStepButton: (stepId: string, btnIndex: number, patch: Partial<StepActionButton>) => void;
}

export function MessageSequenceStep({
  sequenceImageInputRef,
  onSequenceImageChange,
  campaignSequence,
  updateCampaignStep,
  moveCampaignStep,
  removeCampaignStep,
  addCampaignStep,
  onSelectImageStep,
  isGeneratingVariants,
  onGenerateVariants,
  variantCount,
  onVariantCountChange,
  suggestedVariantCount,
  dailyQuota,
  minVariantCount,
  maxVariantCount,
  onAddStepButton,
  onRemoveStepButton,
  onUpdateStepButton,
}: MessageSequenceStepProps) {
  // Insere o emoji na POSICAO DO CURSOR, nao no fim: escrever no meio do texto e o
  // uso normal, e concatenar quebraria a frase. Sem cursor (campo nunca focado),
  // cai para o fim. So texto entra, entao {{nome}} e a contagem de caracteres do
  // proprio campo seguem valendo.
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  function inserirNoCursor(stepId: string, textoAtual: string, trecho: string) {
    const campo = textareaRefs.current[stepId];
    const base = textoAtual || "";
    const inicio = campo?.selectionStart ?? base.length;
    const fim = campo?.selectionEnd ?? base.length;
    const novoTexto = base.slice(0, inicio) + trecho + base.slice(fim);
    updateCampaignStep(stepId, { text: novoTexto });
    // Reposiciona o cursor depois do que foi inserido, para continuar digitando.
    requestAnimationFrame(() => {
      const alvo = textareaRefs.current[stepId];
      if (!alvo) return;
      const posicao = inicio + trecho.length;
      alvo.focus();
      alvo.setSelectionRange(posicao, posicao);
    });
  }

  const repeticoesPorDia = variantCount > 0 ? Math.ceil(dailyQuota / variantCount) : dailyQuota;
  const riscoAlto = repeticoesPorDia > 40;
  const riscoMedio = !riscoAlto && repeticoesPorDia > 20;

  return (
    <Card className="border-border bg-card shadow-sm text-card-foreground rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500 text-[10px] text-white">2</span>
          Timeline de Envio
        </CardTitle>
        <CardDescription>Escreva a mensagem. Adicione mais passos de texto ou imagem para criar uma sequência</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <input ref={sequenceImageInputRef} type="file" accept="image/*" className="sr-only" onChange={onSequenceImageChange} />

        {/* Vertical Step cards */}
        <div className="space-y-4 relative border-l border-slate-200/80 dark:border-white/10 ml-3.5 pl-5">
          {campaignSequence.map((step, index) => {
            const chromatic = getStepChromaticStyle(step.order, step.type);
            return (
              <div key={step.id} className={cn("relative space-y-3 p-4", chromatic.container)}>
                {/* Left icon marker */}
                <span className={cn("absolute -left-[30px] top-4 flex h-5 w-5 items-center justify-center rounded-full font-mono text-[9px] font-bold shadow-xs", chromatic.marker)}>
                  {step.order}
                </span>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={cn("px-2.5 py-0.5 rounded-full inline-flex items-center", chromatic.badge)}>
                      {chromatic.badgeText}
                    </span>

                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Gatilho:</span>
                    <Select
                      value={step.triggerMode || "immediate"}
                      onValueChange={(val) => updateCampaignStep(step.id, { triggerMode: val as "immediate" | "after_reply" | "with_previous" })}
                    >
                      <SelectTrigger className="h-7 text-[11px] font-semibold bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 w-[230px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="immediate">⚡ Enviar na hora (Imediato)</SelectItem>
                        <SelectItem value="after_reply">🚪 Enviar após resposta do lead</SelectItem>
                        <SelectItem value="with_previous">➕ Enviar junto com a anterior</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => moveCampaignStep(step.id, -1)} disabled={index === 0}>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => moveCampaignStep(step.id, 1)} disabled={index === campaignSequence.length - 1}>
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-rose-500" onClick={() => removeCampaignStep(step.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {step.triggerMode === "after_reply" && (
                <div className="flex items-center gap-1.5 text-[10px] font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2 rounded-lg border border-amber-200/80 dark:border-amber-900/40">
                  <span className="font-bold">🚪 Porta de Parada:</span> O envio pausa aqui e aguarda uma nova resposta do lead para disparar esta mensagem (e qualquer passo &quot;junto com a anterior&quot; abaixo dela).
                </div>
              )}

              {step.triggerMode === "with_previous" && (
                <div className="flex items-center gap-1.5 text-[10px] font-medium text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/30 p-2 rounded-lg border border-sky-200/80 dark:border-sky-900/40">
                  <span className="font-bold">➕ Envio em Lote:</span> Esta mensagem é enviada no mesmo lote do passo anterior (com intervalo de segurança anti-ban entre elas).
                </div>
              )}

              {/* Message editor */}
              <div className="space-y-2">
                <Textarea
                  ref={(el) => { textareaRefs.current[step.id] = el; }}
                  placeholder={step.type === "image" ? "Legenda opcional para a imagem" : "Olá {{nome}}, tudo bem? Escreva a mensagem de envio..."}
                  className="min-h-[96px] text-xs font-sans"
                  value={step.text}
                  onChange={(e) => updateCampaignStep(step.id, { text: e.target.value })}
                />

                {/* Variables helper */}
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                  <EmojiPicker onSelect={(emoji) => inserirNoCursor(step.id, step.text, emoji)} />
                  <span>Variáveis:</span>
                  <button type="button" onClick={() => updateCampaignStep(step.id, { text: step.text + " {{nome}}" })} className="rounded-full bg-slate-100 hover:bg-slate-200 px-2 py-0.5 dark:bg-slate-800 dark:hover:bg-slate-700">{"{{nome}}"}</button>
                  <button type="button" onClick={() => updateCampaignStep(step.id, { text: step.text + " {{telefone}}" })} className="rounded-full bg-slate-100 hover:bg-slate-200 px-2 py-0.5 dark:bg-slate-800 dark:hover:bg-slate-700">{"{{telefone}}"}</button>
                  <button type="button" onClick={() => updateCampaignStep(step.id, { text: step.text + " {{scheduling_link}}" })} className="rounded-full bg-slate-100 hover:bg-slate-200 px-2 py-0.5 dark:bg-slate-800 dark:hover:bg-slate-700">{"{{scheduling_link}}"}</button>
                </div>
              </div>

              {/* Image selector */}
              {step.type === "image" && (
                <div className="space-y-2">
                  {step.image ? (
                    <div className="flex items-center gap-3 rounded-lg border border-slate-200/80 bg-slate-50 p-2 dark:border-white/5 dark:bg-slate-900/40">
                      <img src={step.image.dataUrl} alt={step.image.name} className="h-12 w-12 rounded object-cover" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{step.image.name}</p>
                        <p className="text-[10px] text-slate-500">{Math.round(step.image.size / 1024)} KB</p>
                      </div>
                      <Button type="button" variant="ghost" size="sm" onClick={() => updateCampaignStep(step.id, { image: null })} className="text-xs text-rose-500 h-8">Remover</Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full justify-center gap-1.5 h-9"
                      onClick={() => {
                        onSelectImageStep(step.id);
                        sequenceImageInputRef.current?.click();
                      }}
                    >
                      <ImagePlus className="h-4 w-4" />
                      Carregar Imagem do Computador
                    </Button>
                  )}
                </div>
              )}

              {/* AI Variations inline trigger */}
              {step.type === "text" && (
                <div className="border-t border-slate-100 dark:border-white/5 pt-2 space-y-2">
                  {step.triggerMode === "after_reply" && (
                    <div className="flex items-start gap-1.5 text-[10px] text-amber-700 dark:text-amber-300 bg-amber-50/70 dark:bg-amber-950/20 p-2 rounded-lg border border-amber-200/60 dark:border-amber-900/30">
                      <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>
                        Variações têm pouco efeito aqui: esta etapa sai uma por vez, só para quem respondeu. Elas valem no disparo inicial, que sai para muita gente na mesma janela.
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        disabled={isGeneratingVariants}
                        onClick={() => onGenerateVariants(step.id, step.text)}
                        className="text-[11px] font-bold text-violet-500 hover:text-violet-600 flex items-center gap-1 bg-violet-50 dark:bg-violet-950/20 px-2 py-1 rounded-md"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        {isGeneratingVariants ? "Processando..." : "🤖 Gerar Variações Humanizadas (Evitar Spam)"}
                      </button>

                      {step.textVariants && step.textVariants.length > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const count = step.textVariants?.length || 0;
                            if (count === 0) return;
                            const msg = count === 1 ? "Remover a variação?" : `Remover as ${count} variações?`;
                            if (window.confirm(msg)) {
                              updateCampaignStep(step.id, { textVariants: [] });
                            }
                          }}
                          className="h-7 text-[11px] text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 gap-1 px-2"
                          title="Limpar todas as variações desta etapa"
                        >
                          <Trash2 className="h-3 w-3" />
                          Limpar todas
                        </Button>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <label className="text-[10px] font-bold uppercase text-slate-500">Quantidade</label>
                      <Input
                        type="number"
                        min={minVariantCount}
                        max={maxVariantCount}
                        value={variantCount}
                        onChange={(e) => {
                          const raw = Number.parseInt(e.target.value, 10);
                          if (Number.isNaN(raw)) {
                            onVariantCountChange(null);
                            return;
                          }
                          onVariantCountChange(Math.min(maxVariantCount, Math.max(minVariantCount, raw)));
                        }}
                        className="h-8 w-16 text-xs"
                      />
                    </div>
                  </div>

                  {/* Consequencia da escolha, em numero — o sistema sugere a partir
                      da cota ja configurada e mostra o efeito, sem decidir pelo usuario. */}
                  <p
                    className={
                      riscoAlto
                        ? "text-[10px] font-semibold text-red-600 dark:text-red-400"
                        : riscoMedio
                          ? "text-[10px] font-semibold text-amber-600 dark:text-amber-400"
                          : "text-[10px] text-muted-foreground"
                    }
                  >
                    Com {variantCount} variações e cota de {dailyQuota}/dia, cada mensagem se repete ~
                    {repeticoesPorDia} vezes por dia por chip.
                    {riscoAlto
                      ? " Repetição muito alta — risco elevado de bloqueio."
                      : riscoMedio
                        ? " Repetição alta para operação contínua."
                        : ""}
                    {variantCount !== suggestedVariantCount
                      ? ` Sugerido para esta cota: ${suggestedVariantCount}.`
                      : ""}
                  </p>

                  {step.textVariants && step.textVariants.length > 0 && (
                    <div className="rounded-lg border border-violet-100 bg-violet-50/20 p-2.5 dark:border-violet-900/10 dark:bg-violet-950/5 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-bold text-violet-600 dark:text-violet-400">
                          Variações Alternativas Ativas ({step.textVariants.length}):
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            const count = step.textVariants?.length || 0;
                            if (count === 0) return;
                            const msg = count === 1 ? "Remover a variação?" : `Remover as ${count} variações?`;
                            if (window.confirm(msg)) {
                              updateCampaignStep(step.id, { textVariants: [] });
                            }
                          }}
                          className="text-[10px] font-semibold text-rose-500 hover:text-rose-600 hover:underline flex items-center gap-1"
                        >
                          <Trash2 className="h-3 w-3" />
                          Limpar todas ({step.textVariants.length})
                        </button>
                      </div>
                      <div className="grid gap-2">
                        {step.textVariants.map((variant, vIdx) => (
                          <div key={vIdx} className="flex items-start gap-1.5 group">
                            <span className="text-[9px] font-mono text-slate-400 dark:text-slate-500 pt-2 shrink-0 w-4 text-right">
                              {vIdx + 1}.
                            </span>
                            <textarea
                              value={variant}
                              onChange={(e) => {
                                const updatedVariants = [...(step.textVariants || [])];
                                updatedVariants[vIdx] = e.target.value;
                                updateCampaignStep(step.id, { textVariants: updatedVariants });
                              }}
                              className="w-full rounded border border-slate-200 bg-white/80 p-2 text-[10px] dark:border-white/5 dark:bg-black/30 font-sans min-h-[44px] resize-y focus:border-violet-400 focus:outline-none"
                              placeholder={`Variação ${vIdx + 1}...`}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                const updatedVariants = (step.textVariants || []).filter((_, idx) => idx !== vIdx);
                                updateCampaignStep(step.id, { textVariants: updatedVariants });
                              }}
                              className="h-8 w-8 p-0 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 shrink-0"
                              title={`Remover variação ${vIdx + 1}`}
                              aria-label={`Remover variação ${vIdx + 1}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* WhatsApp Actions buttons */}
              {step.type === "text" && (
                <div className="border-t border-slate-100 dark:border-white/5 pt-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-500">Links e opções de resposta (Max 3)</span>
                    <button
                      type="button"
                      onClick={() => onAddStepButton(step.id)}
                      className="text-[10px] font-bold text-indigo-500 hover:text-indigo-600 flex items-center gap-1"
                    >
                      <Plus className="h-3 w-3" /> Adicionar
                    </button>
                  </div>

                  {/* O WhatsApp descontinuou botao interativo para conexoes nao-oficiais,
                      entao links e opcoes vao ESCRITOS no corpo. Opcao em texto ainda
                      cumpre o papel: oferece caminhos para o lead nao ter que formular a
                      resposta sozinho, e o agente reconhece a escolha. */}
                  <p className="text-[10px] rounded-md border border-slate-200 bg-slate-50 p-2 text-slate-600 dark:border-white/10 dark:bg-slate-900/30 dark:text-slate-300">
                    Links e opções são <strong>escritos no final da mensagem</strong>, numerados. O
                    WhatsApp deixa a URL clicável, e o agente da campanha reconhece a opção que o
                    lead escolher — por número ou por texto.
                  </p>

                  {step.buttons && step.buttons.length > 0 && (
                    <div className="grid gap-2 pt-1">
                      {step.buttons.map((btn, btnIdx) => (
                        <div key={btnIdx} className="space-y-1 bg-slate-50 dark:bg-slate-900/40 p-2 rounded-lg border border-slate-200/60 dark:border-white/5">
                          <div className="flex gap-2 items-center">
                            {/* "Opção de resposta" tem UM campo só. Com dois, o
                                usuário preenchia um deles, a opção ficava sem
                                rótulo e era descartada no envio — as opções
                                simplesmente sumiam da mensagem. Link continua
                                com dois, porque texto e URL são coisas
                                diferentes. */}
                            {btn.type === "url" && (
                              <Input
                                value={btn.displayText}
                                placeholder="Nome do Botão (Ex: Agendar)"
                                className="h-8 text-[11px] max-w-[130px]"
                                onChange={(e) => onUpdateStepButton(step.id, btnIdx, { displayText: e.target.value })}
                              />
                            )}
                            <Select
                              value={btn.type}
                              onValueChange={(val) =>
                                onUpdateStepButton(step.id, btnIdx, {
                                  type: val as "url" | "reply",
                                  ...(val === "reply" ? { url: "" } : {}),
                                })
                              }
                            >
                              <SelectTrigger className="h-8 text-[11px] max-w-[125px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="url">Link / URL</SelectItem>
                                <SelectItem value="reply">Opção de resposta</SelectItem>
                              </SelectContent>
                            </Select>

                            {btn.type === "url" ? (
                              <Input
                                value={btn.url || ""}
                                placeholder="Link (Ex: {{scheduling_link}})"
                                className="h-8 text-[11px] flex-1 font-mono"
                                onChange={(e) => onUpdateStepButton(step.id, btnIdx, { url: e.target.value })}
                              />
                            ) : (
                              <Input
                                // Compatibilidade: quem ja tem os dois campos
                                // preenchidos nao perde nada — usa o rotulo se
                                // existir, senao o valor. E a escrita alimenta
                                // os tres para o envio nao depender de qual foi.
                                value={btn.displayText || btn.replyText || btn.url || ""}
                                placeholder="Texto da opção (Ex: Quero agendar)"
                                className="h-8 text-[11px] flex-1"
                                onChange={(e) =>
                                  onUpdateStepButton(step.id, btnIdx, {
                                    displayText: e.target.value,
                                    replyText: e.target.value,
                                    url: "",
                                  })
                                }
                              />
                            )}

                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => onRemoveStepButton(step.id, btnIdx)}
                              className="h-8 w-8 p-0 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>

                          <p className="text-[10px] text-slate-500 pl-1">
                            {btn.type === "url"
                              ? "🔗 Link externo: vai anexado ao final da mensagem, clicável."
                              : "💬 Opção de resposta: aparece escrita e numerada no final da mensagem. O agente reconhece a escolha do lead — pelo número ou pelo texto."}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            );
          })}
        </div>

        <div className="flex gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => addCampaignStep("text")}>
            <Plus className="h-3.5 w-3.5" /> Envio de Texto
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => addCampaignStep("image")}>
            <Plus className="h-3.5 w-3.5" /> Envio de Imagem
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
