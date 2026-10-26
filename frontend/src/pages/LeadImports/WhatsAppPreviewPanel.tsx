import { AlertTriangle, ExternalLink, ImagePlus, Link2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CampaignSequenceStep } from "@/hooks/useCampanhas";
import type { StepActionButton } from "@/lib/leadImports/spreadsheet";

type SequenceStep = CampaignSequenceStep & { buttons?: StepActionButton[] };

interface WhatsAppPreviewPanelProps {
  campaignSequence: SequenceStep[];
  multiAgendaEnabled: boolean;
}

interface StepGroup {
  id: string;
  title: string;
  type: "immediate" | "reply";
  doorNumber?: number;
  steps: SequenceStep[];
}

export function WhatsAppPreviewPanel({ campaignSequence, multiAgendaEnabled }: WhatsAppPreviewPanelProps) {
  const enabledSteps = campaignSequence.filter((s) => s.enabled);

  const groups: StepGroup[] = [];
  let currentGroup: StepGroup | null = null;
  let doorIndex = 0;

  enabledSteps.forEach((step, idx) => {
    const isDoor = idx > 0 && step.triggerMode === "after_reply";

    if (idx === 0 || isDoor || !currentGroup) {
      if (isDoor) {
        doorIndex += 1;
        currentGroup = {
          id: `group-reply-${doorIndex}`,
          title: `🚪 Resposta ${doorIndex}`,
          type: "reply",
          doorNumber: doorIndex,
          steps: [step],
        };
      } else {
        currentGroup = {
          id: "group-initial",
          title: "⚡ Disparo Inicial",
          type: "immediate",
          steps: [step],
        };
      }
      groups.push(currentGroup);
    } else {
      currentGroup.steps.push(step);
    }
  });

  return (
    <div className="lg:col-span-1 sticky top-6">
      <Card className="border-slate-200/80 bg-slate-900 shadow-[0_20px_50px_rgba(15,23,42,0.12)] rounded-3xl overflow-hidden text-slate-100">
        <CardHeader className="bg-slate-950/70 border-b border-white/5 py-3 px-4 flex flex-row items-center justify-between">
          <CardTitle className="text-xs uppercase font-bold tracking-wider text-slate-400">Simulador de WhatsApp</CardTitle>
          {doorIndex > 0 && (
            <span className="text-[10px] font-mono text-amber-400 bg-amber-950/60 border border-amber-500/30 px-2 py-0.5 rounded-full">
              {doorIndex} {doorIndex === 1 ? "porta" : "portas"}
            </span>
          )}
        </CardHeader>
        <CardContent className="p-4 bg-slate-900/60 min-h-[440px] flex flex-col justify-between">
          <div className="space-y-4 flex-1">
            {groups.length === 0 ? (
              <div className="text-center py-10 text-xs text-slate-500">
                Nenhum passo ativo na sequência.
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.id} className="space-y-3">
                  {group.type === "reply" && (
                    <div className="flex items-center gap-2 my-4">
                      <div className="h-px bg-amber-500/30 flex-1" />
                      <span className="text-[10px] font-mono font-bold text-amber-300 bg-amber-950/80 border border-amber-500/50 px-2.5 py-1 rounded-full flex items-center gap-1 shadow-sm">
                        <span>💬</span> Lead responde (Porta {group.doorNumber})
                      </span>
                      <div className="h-px bg-amber-500/30 flex-1" />
                    </div>
                  )}

                  <div className="space-y-2">
                    {group.steps.map((step, sIdx) => {
                      const sampleText = step.text || "(Escreva a mensagem no formulário...)";
                      const resolvedText = sampleText
                        .replace(/\{\{\s*nome\s*\}\}/gi, "Maria Silva")
                        .replace(/\{\{\s*telefone\s*\}\}/gi, "5511999999999")
                        .replace(/\{\{\s*scheduling_link\s*\}\}/gi, multiAgendaEnabled ? "https://calendly.com/consultor" : "(Link da Agenda)");

                      const isLink = step.type === "link";
                      const rawLink = step.linkUrl || "";
                      const defaultSchedLink = multiAgendaEnabled ? "https://calendly.com/consultor" : "https://suaempresa.com.br/apresentacao";
                      let resolvedLink = rawLink
                        .replace(/\{\{\s*nome\s*\}\}/gi, "Maria Silva")
                        .replace(/\{\{\s*telefone\s*\}\}/gi, "5511999999999")
                        .replace(/https?:\/\/\s*\{\{\s*scheduling_link\s*\}\}/gi, defaultSchedLink)
                        .replace(/\{\{\s*scheduling_link\s*\}\}/gi, defaultSchedLink);

                      let displayHost = "suaempresa.com.br";
                      let isInvalidHost = false;
                      if (resolvedLink) {
                        const cleanLink = resolvedLink.trim();
                        try {
                          const urlToParse = cleanLink.startsWith("http://") || cleanLink.startsWith("https://")
                            ? cleanLink
                            : `https://${cleanLink}`;
                          const parsed = new URL(urlToParse);
                          const host = (parsed.hostname || "").trim().toLowerCase();
                          // Host corrompido: se for 'https', 'http', sem ponto, ou TLD ausente
                          if (!host || !host.includes(".") || host === "https" || host === "http") {
                            isInvalidHost = true;
                            displayHost = "suaempresa.com.br";
                          } else {
                            displayHost = host;
                          }
                        } catch {
                          const match = cleanLink.match(/(?:https?:\/\/)?([^\/\s?#]+)/i);
                          const matchedHost = (match ? match[1] : "").trim().toLowerCase();
                          if (!matchedHost || !matchedHost.includes(".") || matchedHost === "https" || matchedHost === "http") {
                            isInvalidHost = true;
                            displayHost = "suaempresa.com.br";
                          } else {
                            displayHost = matchedHost;
                          }
                        }
                      }

                      const botoes = step.type === "text" ? (step.buttons || []) : [];
                      const linhasOpcoes = botoes
                        .filter((b) => b && (b.type === "reply" || (b.type !== "url" && !b.url)))
                        .map((b) => (b.displayText || b.replyText || "").trim())
                        .filter(Boolean)
                        .map((rotulo, i) => `${i + 1}. ${rotulo}`);
                      const linhasLinks = botoes
                        .filter((b) => b.type === "url" && (b.url || "").trim())
                        .map((b) => {
                          const url = (b.url || "").trim()
                            .replace(/\{\{\s*scheduling_link\s*\}\}/gi, multiAgendaEnabled ? "https://calendly.com/consultor" : "");
                          if (!url || /\{\{.*?\}\}/.test(url)) return null;
                          return `👉 ${b.displayText || "Acessar Link"}: ${url}`;
                        })
                        .filter(Boolean) as string[];
                      const textoFinal = [resolvedText, ...(linhasOpcoes.length ? ["", ...linhasOpcoes] : []), ...(linhasLinks.length ? ["", ...linhasLinks] : [])].join("\n");

                      const isWithPrevious = sIdx > 0 || step.triggerMode === "with_previous";

                      return (
                        <div key={step.id || sIdx} className="flex flex-col items-start gap-1 max-w-[88%] animate-fadeIn">
                          <div className="rounded-2xl rounded-tl-none bg-slate-800 border border-white/5 p-3 text-xs shadow space-y-2 text-slate-200 w-full">
                            {step.type === "image" && (
                              <div className="rounded-lg overflow-hidden border border-white/10 bg-slate-950/40">
                                {step.image ? (
                                  <img src={step.image.dataUrl} alt="Preview" className="w-full max-h-[140px] object-cover" />
                                ) : (
                                  <div className="h-28 w-full flex items-center justify-center text-slate-600 bg-slate-900"><ImagePlus className="h-6 w-6" /></div>
                                )}
                              </div>
                            )}

                            {isLink && (
                              <div className="rounded-xl overflow-hidden border border-cyan-500/20 bg-slate-950/70 p-2.5 space-y-2 shadow-inner">
                                {isInvalidHost && (
                                  <div
                                    data-testid="invalid-link-warning"
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] font-medium"
                                  >
                                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                                    <span>Link corrompido ou formato inválido: exibindo fallback</span>
                                  </div>
                                )}
                                <div className="h-24 w-full bg-gradient-to-br from-cyan-950/80 via-slate-800 to-slate-900 rounded-lg flex flex-col items-center justify-center text-cyan-300 gap-1.5 border border-white/5">
                                  <div className="h-8 w-8 rounded-full bg-cyan-500/20 flex items-center justify-center">
                                    <Link2 className="h-4 w-4 text-cyan-300" />
                                  </div>
                                  <span className="text-[10px] font-semibold tracking-wide text-cyan-200">
                                    {displayHost.toLowerCase()}
                                  </span>
                                </div>
                                <div className="space-y-1">
                                  <p className="text-[11px] font-bold text-slate-100 truncate">
                                    {displayHost.replace(/^www\./i, "").toLowerCase()} · Prévia Rich Open Graph
                                  </p>
                                  <p className="text-[10px] text-slate-400 line-clamp-2 leading-tight">
                                    O WhatsApp e a Evolution API carregarão automaticamente a imagem de capa (og:image) e o título oficial desta página.
                                  </p>
                                  <div className="flex items-center gap-1 text-[10px] text-cyan-400 font-mono truncate pt-0.5">
                                    <ExternalLink className="h-3 w-3 shrink-0" />
                                    <span className="truncate">{resolvedLink || "https://..."}</span>
                                  </div>
                                </div>
                              </div>
                            )}

                            {step.type !== "link" ? (
                              <p className="whitespace-pre-wrap leading-relaxed">{textoFinal}</p>
                            ) : (
                              <div className="space-y-1 whitespace-pre-wrap leading-relaxed">
                                {resolvedText && <p>{resolvedText}</p>}
                                {resolvedLink && !resolvedText?.includes(resolvedLink) && (
                                  <p className="text-cyan-400 underline break-all">{resolvedLink}</p>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 pl-2 text-[9px] font-mono">
                            {isWithPrevious && step.triggerMode === "with_previous" ? (
                              <span className="text-sky-400 flex items-center gap-0.5">
                                <span>➕</span> junto com anterior (+{step.delayAfterSeconds || 2}s)
                              </span>
                            ) : group.type === "reply" && sIdx === 0 ? (
                              <span className="text-amber-400/90 flex items-center gap-0.5">
                                <span>🚪</span> enviado após resposta {group.doorNumber}
                              </span>
                            ) : (
                              <span className="text-emerald-400/90 flex items-center gap-0.5">
                                <span>⚡</span> disparo inicial
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-white/5 pt-3 mt-4 text-[10px] text-slate-500 text-center">
            * Grupos separados pelas portas de resposta do lead.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
