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
    <div className="max-w-7xl w-full space-y-8 animate-fade-in-up">
      <div className="text-center space-y-4">
        <Badge className="bg-indigo-50 border-indigo-200 text-indigo-700 text-sm px-5 py-2 uppercase tracking-widest font-mono shadow-sm">
          Slide 05 · Onboarding Inteligente (Integração com IA)
        </Badge>
        <h2 className="text-4xl md:text-6xl font-black text-slate-900">Questionário Automatizado por IA</h2>
        <p className="text-base md:text-lg text-slate-600 max-w-3xl mx-auto">
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
