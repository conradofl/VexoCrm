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
                        


                        {/* Textarea */}
                        <div className="space-y-2">
                          <Label className="text-xs text-slate-400 uppercase font-mono font-bold" htmlFor="transcript-area">Cole a Transcrição da Reunião Aqui</Label>
                          <textarea
                            id="transcript-area"
                            value={transcriptText}
                            onChange={(e) => setTranscriptText(e.target.value)}
                            placeholder="Exemplo: 'O cliente disse que o orçamento é de 5 mil reais mensais para Google Ads...'"
                            className="w-full h-[400px] p-4 text-sm bg-slate-950/80 border border-white/10 rounded-xl text-slate-200 font-sans focus:border-indigo-500/50 outline-none leading-relaxed resize-none shadow-inner"
                          />
                        </div>

                        {/* Run Button */}
                        <Button
                          onClick={processBriefingWithGemini}
                          disabled={isProcessingAI || !transcriptText.trim()}
                          className="w-full bg-indigo-600 hover:bg-indigo-500 font-black text-sm text-white h-12 gap-2 shadow-lg shadow-indigo-600/20 mt-2"
                        >
                          {isProcessingAI ? (
                            <>
                              <RefreshCw className="h-5 w-5 animate-spin text-white" />
                              Extraindo Dados com Gemini...
                            </>
                          ) : (
                            <>
                              <Bot className="h-5 w-5 text-white" />
                              Gerar Automação do Briefing
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
