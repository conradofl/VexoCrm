import { ImagePlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CampaignSequenceStep } from "@/hooks/useCampanhas";
import type { StepActionButton } from "@/lib/leadImports/spreadsheet";

type SequenceStep = CampaignSequenceStep & { buttons?: StepActionButton[] };

interface WhatsAppPreviewPanelProps {
  campaignSequence: SequenceStep[];
  multiAgendaEnabled: boolean;
}

export function WhatsAppPreviewPanel({ campaignSequence, multiAgendaEnabled }: WhatsAppPreviewPanelProps) {
  return (
    <div className="lg:col-span-1 sticky top-6">
      <Card className="border-slate-200/80 bg-slate-900 shadow-[0_20px_50px_rgba(15,23,42,0.12)] rounded-3xl overflow-hidden text-slate-100">
        <CardHeader className="bg-slate-950/70 border-b border-white/5 py-4">
          <CardTitle className="text-xs uppercase font-bold tracking-wider text-slate-400">Simulador de WhatsApp</CardTitle>
        </CardHeader>
        <CardContent className="p-4 bg-slate-900/60 min-h-[440px] flex flex-col justify-between">
          {/* Chat window mockup */}
          <div className="space-y-4 flex-1">
            {campaignSequence.filter(s => s.enabled).map((step, idx) => {
              const sampleText = step.text || "(Escreva a mensagem no formulário...)";
              const resolvedText = sampleText
                .replace(/\{\{\s*nome\s*\}\}/gi, "Maria Silva")
                .replace(/\{\{\s*telefone\s*\}\}/gi, "5511999999999")
                .replace(/\{\{\s*scheduling_link\s*\}\}/gi, multiAgendaEnabled ? "https://calendly.com/consultor" : "(Link da Agenda)");

              return (
                <div key={idx} className="flex flex-col items-start gap-1 max-w-[85%] animate-fadeIn">
                  <div className="rounded-2xl rounded-tl-none bg-slate-800 border border-white/5 p-3 text-xs shadow space-y-2 text-slate-200">
                    {/* Image preview inside simulated balloon */}
                    {step.type === "image" && (
                      <div className="rounded-lg overflow-hidden border border-white/10 bg-slate-950/40">
                        {step.image ? (
                          <img src={step.image.dataUrl} alt="Preview" className="w-full max-h-[140px] object-cover" />
                        ) : (
                          <div className="h-28 w-full flex items-center justify-center text-slate-600 bg-slate-900"><ImagePlus className="h-6 w-6" /></div>
                        )}
                      </div>
                    )}

                    <p className="whitespace-pre-wrap leading-relaxed">{resolvedText}</p>
                  </div>

                  {/* Interactive WhatsApp buttons mockup */}
                  {step.type === "text" && step.buttons && step.buttons.length > 0 && (
                    <div className="grid gap-1 w-full pl-2 mt-1">
                      {step.buttons.map((btn, bIdx) => (
                        <div
                          key={bIdx}
                          className="w-full bg-slate-800 hover:bg-slate-700/80 border border-white/5 text-center text-[10px] font-bold text-indigo-400 py-1.5 rounded-xl shadow-sm cursor-pointer"
                        >
                          🔗 {btn.displayText}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="border-t border-white/5 pt-3 mt-4 text-[10px] text-slate-500 text-center">
            * Visualização simplificada das variáveis de lead.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
