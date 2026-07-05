import type { Dispatch, SetStateAction } from "react";
import { Mic, RefreshCw, Bot } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { TRANSCRIPT_OPTIONS } from "@/lib/geracaoDigital/constants";

// Extraído de src/pages/GeracaoDigitalPitch.tsx (Onda 4 Run F5) — coluna esquerda do Slide 5 (transcrição + IA), movimento puro.
interface BriefingTranscriptPanelProps {
  transcriptText: string;
  setTranscriptText: Dispatch<SetStateAction<string>>;
  isProcessingAI: boolean;
  aiProgressText: string;
  selectTranscriptPreset: (presetId: string) => void;
  processBriefingWithGemini: () => void;
}

export function BriefingTranscriptPanel({
  transcriptText,
  setTranscriptText,
  isProcessingAI,
  aiProgressText,
  selectTranscriptPreset,
  processBriefingWithGemini,
}: BriefingTranscriptPanelProps) {
  return (
                  <div className="md:col-span-2 space-y-4">
                    <Card className="border-white/5 bg-slate-900/30 backdrop-blur-md">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                          <Mic className="h-4 w-4 text-indigo-400" />
                          Áudio Transcrito do Briefing
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        
                        {/* Select Presets */}
                        <div className="space-y-2">
                          <Label className="text-[10px] text-slate-400 uppercase font-mono font-bold">Modelos Rápidos (Demos Comerciais)</Label>
                          <div className="space-y-1.5">
                            {TRANSCRIPT_OPTIONS.map((o) => (
                              <button
                                key={o.id}
                                onClick={() => selectTranscriptPreset(o.id)}
                                className="w-full text-left text-xs p-2 rounded-lg border border-white/5 hover:bg-indigo-600/10 hover:border-indigo-500/30 bg-slate-950/40 text-slate-300 font-semibold block transition-all"
                              >
                                {o.title}
                                <span className="block text-[9px] text-slate-500 font-normal">{o.description}</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Textarea */}
                        <div className="space-y-1.5">
                          <Label className="text-[10px] text-slate-400 uppercase font-mono font-bold" htmlFor="transcript-area">Transcrição do briefing comercial</Label>
                          <textarea
                            id="transcript-area"
                            value={transcriptText}
                            onChange={(e) => setTranscriptText(e.target.value)}
                            placeholder="Cole aqui o texto da conversa transcrita..."
                            className="w-full h-44 p-3 text-xs bg-slate-950/80 border border-white/5 rounded-xl text-slate-300 font-sans focus:border-indigo-500/50 outline-none leading-relaxed resize-none"
                          />
                        </div>

                        {/* Run Button */}
                        <Button
                          onClick={processBriefingWithGemini}
                          disabled={isProcessingAI}
                          className="w-full bg-indigo-600 hover:bg-indigo-500 font-extrabold text-xs text-white h-10 gap-2 shadow-lg shadow-indigo-600/10"
                        >
                          {isProcessingAI ? (
                            <>
                              <RefreshCw className="h-4 w-4 animate-spin text-white" />
                              Processando Briefing...
                            </>
                          ) : (
                            <>
                              <Bot className="h-4 w-4 text-white" />
                              Qualificar com IA
                            </>
                          )}
                        </Button>
                      </CardContent>
                    </Card>

                    {/* Gemini Processing Console view */}
                    {isProcessingAI && (
                      <div className="p-3 bg-indigo-950/20 border border-indigo-500/30 rounded-xl space-y-1.5 animate-pulse">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-mono text-indigo-400 uppercase font-bold">Console do Processador de IA</span>
                          <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-ping" />
                        </div>
                        <p className="text-[10px] font-mono text-indigo-200/90 leading-normal">{aiProgressText}</p>
                      </div>
                    )}
                  </div>
  );
}
