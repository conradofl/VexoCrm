import type { Dispatch, SetStateAction } from "react";
import { Badge } from "@/components/ui/badge";
import { BriefingTranscriptPanel } from "./BriefingTranscriptPanel";
import { BriefingFormFields } from "./BriefingFormFields";
import { BriefingSuccessModal } from "./BriefingSuccessModal";
import type { BriefingField, CustomTheme } from "@/lib/geracaoDigital/types";

// Extraído de src/pages/GeracaoDigitalPitch.tsx (Onda 4 Run F5) — Slide 5 (questionário de briefing com IA), movimento puro.
interface Slide5BriefingProps {
  transcriptText: string;
  setTranscriptText: Dispatch<SetStateAction<string>>;
  isProcessingAI: boolean;
  aiProgressText: string;
  selectTranscriptPreset: (presetId: string) => void;
  processBriefingWithGemini: () => void;
  briefingFields: BriefingField[];
  setBriefingFields: Dispatch<SetStateAction<BriefingField[]>>;
  handleSendBriefing: () => void;
  successModalOpen: boolean;
  theme: CustomTheme;
  onGoToClosing: () => void;
}

export function Slide5Briefing({
  transcriptText,
  setTranscriptText,
  isProcessingAI,
  aiProgressText,
  selectTranscriptPreset,
  processBriefingWithGemini,
  briefingFields,
  setBriefingFields,
  handleSendBriefing,
  successModalOpen,
  theme,
  onGoToClosing,
}: Slide5BriefingProps) {
  return (
    <div className="max-w-6xl w-full space-y-4 animate-fade-in-up">
      <div className="text-center space-y-2">
        <Badge className="bg-indigo-500/10 border-indigo-500/20 text-indigo-400 text-xs px-4 py-1.5 uppercase tracking-wider font-mono">
          Slide 05 · Onboarding Inteligente (Integração com IA)
        </Badge>
        <h2 className="text-3xl md:text-5xl font-black text-white">Questionário Automatizado por IA</h2>
        <p className="text-xs md:text-sm text-slate-400 max-w-2xl mx-auto">
          Insira a conversa de briefing no campo esquerdo. A IA processará a transcrição de voz/texto, preencherá os 14 requisitos operacionais e preparará o handoff técnico.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-5 mt-4 items-start">
        <BriefingTranscriptPanel
          transcriptText={transcriptText}
          setTranscriptText={setTranscriptText}
          isProcessingAI={isProcessingAI}
          aiProgressText={aiProgressText}
          selectTranscriptPreset={selectTranscriptPreset}
          processBriefingWithGemini={processBriefingWithGemini}
        />

        <BriefingFormFields
          briefingFields={briefingFields}
          setBriefingFields={setBriefingFields}
          handleSendBriefing={handleSendBriefing}
        />
      </div>

      {/* Handoff Success Modal */}
      {successModalOpen && <BriefingSuccessModal theme={theme} onGoToClosing={onGoToClosing} />}
    </div>
  );
}
