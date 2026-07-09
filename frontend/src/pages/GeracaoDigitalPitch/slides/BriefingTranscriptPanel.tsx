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
                  <div className="md:col-span-2 space-y-6">
                    <Card className="border-slate-200 bg-white shadow-lg shadow-slate-200/50 rounded-3xl overflow-hidden">
                      <CardHeader className="pb-4 bg-slate-50 border-b border-slate-100">
                        <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                          <Mic className="h-5 w-5 text-indigo-600" />
                          Áudio Transcrito do Briefing
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-6 pt-6">
                        
                        {/* Textarea */}
                        <div className="space-y-3">
                          <Label className="text-sm text-slate-600 uppercase font-mono font-bold" htmlFor="transcript-area">Cole a Transcrição da Reunião Aqui</Label>
                          <textarea
                            id="transcript-area"
                            value={transcriptText}
                            onChange={(e) => setTranscriptText(e.target.value)}
                            placeholder="Exemplo: 'O cliente disse que o orçamento é de 5 mil reais mensais para Google Ads...'"
                            className="w-full h-[500px] p-5 text-base bg-white border border-slate-200 rounded-2xl text-slate-900 font-sans focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none leading-relaxed resize-none shadow-sm transition-all"
                          />
                        </div>

                        {/* Run Button */}
                        <Button
                          onClick={processBriefingWithGemini}
                          disabled={isProcessingAI || !transcriptText.trim()}
                          className="w-full bg-indigo-600 hover:bg-indigo-700 font-black text-base text-white h-14 rounded-2xl gap-3 shadow-lg shadow-indigo-600/20 mt-2 transition-all"
                        >
                          {isProcessingAI ? (
                            <>
                              <RefreshCw className="h-6 w-6 animate-spin text-white" />
                              Extraindo Dados com Gemini...
                            </>
                          ) : (
                            <>
                              <Bot className="h-6 w-6 text-white" />
                              Gerar Automação do Briefing
                            </>
                          )}
                        </Button>
                      </CardContent>
                    </Card>

                    {/* Gemini Processing Console view */}
                    {isProcessingAI && (
                      <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-2xl space-y-2 animate-pulse shadow-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-mono text-indigo-700 uppercase font-bold">Console do Processador de IA</span>
                          <span className="h-2 w-2 rounded-full bg-indigo-600 animate-ping" />
                        </div>
                        <p className="text-sm font-mono text-indigo-900 leading-normal">{aiProgressText}</p>
                      </div>
                    )}
                  </div>
  );
}
