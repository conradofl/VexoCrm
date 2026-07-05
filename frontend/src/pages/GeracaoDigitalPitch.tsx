import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Briefcase } from "lucide-react";

import { ConfigBoard } from "./GeracaoDigitalPitch/ConfigBoard";
import { PresentationHeader } from "./GeracaoDigitalPitch/PresentationHeader";
import { PresentationFooter } from "./GeracaoDigitalPitch/PresentationFooter";
import { ThemeCustomizerDrawer } from "./GeracaoDigitalPitch/ThemeCustomizerDrawer";
import { Slide1Welcome } from "./GeracaoDigitalPitch/slides/Slide1Welcome";
import { Slide2Methodology } from "./GeracaoDigitalPitch/slides/Slide2Methodology";
import { Slide3OrgChart } from "./GeracaoDigitalPitch/slides/Slide3OrgChart";
import { Slide4Timeline } from "./GeracaoDigitalPitch/slides/Slide4Timeline";
import { Slide5Briefing } from "./GeracaoDigitalPitch/slides/Slide5Briefing";
import { Slide6Dispatch } from "./GeracaoDigitalPitch/slides/Slide6Dispatch";

import { ACCENT_PRESETS, AI_PROCESSING_STEPS, TRANSCRIPT_OPTIONS } from "@/lib/geracaoDigital/constants";
import { DEFAULT_BRIEFING_FIELDS, DEFAULT_TEAM, DEFAULT_THEME } from "@/lib/geracaoDigital/defaults";
import { playChime } from "@/lib/geracaoDigital/helpers";
import { deriveExtractedValues } from "@/lib/geracaoDigital/briefingParser";
import type { BriefingField, CustomTheme, TeamMember } from "@/lib/geracaoDigital/types";

export default function GeracaoDigitalPitch() {
  const { user } = useAuth();
  // ─── STATE INITIALIZATION ──────────────────────────────────────────────────
  const [isPresenting, setIsPresenting] = useState<boolean>(false);
  const [activeSlide, setActiveSlide] = useState<number>(1);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);

  // Theme settings (persist in localStorage)
  const [theme, setTheme] = useState<CustomTheme>(() => {
    const saved = localStorage.getItem("vexo_gd_theme");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error(e);
      }
    }
    return DEFAULT_THEME;
  });

  // Save theme helper
  const handleSaveTheme = (newTheme: CustomTheme) => {
    setTheme(newTheme);
    localStorage.setItem("vexo_gd_theme", JSON.stringify(newTheme));
    toast({
      title: "Design Salvo",
      description: "As configurações de marca e white-label foram aplicadas com sucesso!",
    });
  };

  const presetStyle = ACCENT_PRESETS[theme.themePreset] || ACCENT_PRESETS.indigo;

  // State of customizer panel
  const [isCustomizerOpen, setIsCustomizerOpen] = useState<boolean>(false);

  // Briefing Form State (Updated fields)
  const [briefingFields, setBriefingFields] = useState<BriefingField[]>(DEFAULT_BRIEFING_FIELDS);

  // AI Briefing Simulator State
  const [transcriptText, setTranscriptText] = useState<string>("");
  const [isProcessingAI, setIsProcessingAI] = useState<boolean>(false);
  const [aiProgressText, setAiProgressText] = useState<string>("");
  const [successModalOpen, setSuccessModalOpen] = useState<boolean>(false);

  // Dispatch States for Slide 6
  const [sendToProspectWhatsapp, setSendToProspectWhatsapp] = useState<boolean>(true);
  const [sendToProspectEmail, setSendToProspectEmail] = useState<boolean>(true);
  const [sendToSectors, setSendToSectors] = useState<boolean>(true);
  const [prospectEmail, setProspectEmail] = useState<string>("contato@empresa.com.br");
  const [sectorsWhatsapp, setSectorsWhatsapp] = useState<string>("(11) 98888-7777");
  const [sectorsEmail, setSectorsEmail] = useState<string>("operacoes@geracaodigital.com.br");
  const [isDispatching, setIsDispatching] = useState<boolean>(false);
  const [dispatchSuccess, setDispatchSuccess] = useState<boolean>(false);
  const [dispatchResult, setDispatchResult] = useState<any>(null);

  // Team Members list (loaded from localStorage or default)
  const [team, setTeam] = useState<TeamMember[]>(DEFAULT_TEAM);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        toast({
          title: "Arquivo Inválido",
          description: "Por favor, selecione uma imagem PNG ou JPEG.",
          variant: "destructive"
        });
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          const updated = {
            ...theme,
            prospectLogoUrl: event.target.result as string
          };
          setTheme(updated);
          localStorage.setItem("vexo_gd_theme", JSON.stringify(updated));
          toast({
            title: "Logo Carregada",
            description: "A logomarca do prospect foi carregada com sucesso!",
          });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // ─── BRIEFING IA MOCK PARSER ──────────────────────────────────────────────
  const selectTranscriptPreset = (presetId: string) => {
    const preset = TRANSCRIPT_OPTIONS.find((t) => t.id === presetId);
    if (!preset) return;
    setTranscriptText(preset.text);
    toast({
      title: "Transcrição Carregada",
      description: "Carregado o áudio transcrito do cliente. Pronto para análise com IA.",
    });
  };

  const processBriefingWithGemini = () => {
    if (!transcriptText.trim()) {
      toast({
        title: "Transcrição vazia",
        description: "Por favor, cole um áudio transcrito ou selecione um dos modelos acima.",
        variant: "destructive"
      });
      return;
    }

    setIsProcessingAI(true);
    // Reset fields
    setBriefingFields((prev) =>
      prev.map((f) => ({ ...f, status: "pending", value: "", confidence: 0 }))
    );

    const extractedValues = deriveExtractedValues(transcriptText);

    let currentStepIndex = 0;

    const interval = setInterval(() => {
      if (currentStepIndex >= AI_PROCESSING_STEPS.length) {
        clearInterval(interval);
        setIsProcessingAI(false);
        playChime();
        toast({
          title: "Análise da IA Concluída!",
          description: "Os 14 campos do briefing foram qualificados e preenchidos em tempo real.",
        });
        return;
      }

      const step = AI_PROCESSING_STEPS[currentStepIndex];
      setAiProgressText(step.t);

      if (step.fId) {
        const fieldId = step.fId;
        // Simulate typing for this field
        setBriefingFields((prev) =>
          prev.map((f) => {
            if (f.id === fieldId) {
              const val = extractedValues[fieldId] || "Preenchido com base nas respostas do briefing comercial.";
              return {
                ...f,
                status: "completed",
                value: val,
                confidence: Math.round(85 + Math.random() * 14)
              };
            }
            return f;
          })
        );
      }

      currentStepIndex++;
    }, 1200);
  };

  const handleSendBriefing = () => {
    // Check if fields are filled
    const filledCount = briefingFields.filter((f) => f.value).length;
    if (filledCount < 5) {
      toast({
        title: "Briefing Incompleto",
        description: "Por favor, execute o processamento com Gemini para preencher o briefing antes de enviar.",
        variant: "destructive"
      });
      return;
    }

    setSuccessModalOpen(true);
  };

  // ─── BRIEFING DISPATCH LOGIC ────────────────────────────────────────────────
  const handleWhatsappDispatch = async () => {
    try {
      setIsDispatching(true);

      const payload = {
        prospectName: theme.prospectName,
        whatsappNumber: theme.whatsappNumber,
        agencyName: theme.agencyName,
        themePreset: theme.themePreset,
        briefingData: briefingFields.reduce((acc, f) => ({ ...acc, [f.id]: f.value }), {})
      };

      const token = (await user?.getIdToken()) || "";
      const response = await fetch("/api/geracao-digital/briefing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error("Erro ao salvar e disparar o briefing.");
      }

      toast({
        title: "WhatsApp Disparado!",
        description: `Dossiê técnico do briefing enviado para o WhatsApp de ${theme.prospectName} (${theme.whatsappNumber || "número cadastrado"}).`,
      });
      playChime();
    } catch (error: any) {
      toast({
        title: "Erro no Disparo",
        description: error.message || "Ocorreu um erro ao disparar o briefing.",
        variant: "destructive"
      });
    } finally {
      setIsDispatching(false);
    }
  };

  const handleEmailDispatch = () => {
    toast({
      title: "E-mail de Boas-Vindas!",
      description: `E-mail com o cronograma e cópia do briefing disparado para ${theme.prospectName} com sucesso.`,
    });
    playChime();
  };

  const handlePdfExport = () => {
    toast({
      title: "PDF Gerado!",
      description: `O arquivo PDF do briefing foi gerado e salvo nos anexos da conta no CRM.`,
    });
    playChime();
  };

  const handleSectorsDispatch = () => {
    toast({
      title: "Handoff Operacional Ativado!",
      description: `Setores de tráfego, design e contratos foram notificados no Slack e Vexo OS.`,
    });
    playChime();
  };

  return (
    <PageShell
      title="Apresentação & Onboarding On-Demand"
      subtitle="Pitch premium interativo da Geração Digital e ferramenta inteligente de briefing com IA, integrados ao motor da Vexo."
      icon={Briefcase}
    >

      {/* ─── MAIN CONFIGURATION BOARD (WHEN NOT IN PRESENTATION MODE) ────────── */}
      {!isPresenting && (
        <ConfigBoard
          theme={theme}
          setTheme={setTheme}
          handleLogoUpload={handleLogoUpload}
          onStartPresenting={() => {
            setActiveSlide(1);
            setIsPresenting(true);
          }}
          onOpenCustomizer={() => setIsCustomizerOpen(true)}
        />
      )}

      {/* ─── FULLSCREEN PRESENTATION MODE (THE PITCH & BRIEFING SPA) ───────── */}
      {isPresenting && (
        <div className="fixed inset-0 z-50 bg-slate-950 text-white overflow-y-auto flex flex-col justify-between font-sans transition-all duration-300">

          {/* Neon Grid Overlay Backdrop */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none z-0" />
          <div className="absolute top-0 left-0 w-full h-[500px] bg-gradient-to-b from-indigo-500/5 to-transparent pointer-events-none z-0" />

          {/* Dynamic Floating stars backgound */}
          <div className="stars-layer absolute inset-0 pointer-events-none z-0">
            <div className="stars-1 opacity-50" />
            <div className="stars-2 opacity-30" />
          </div>

          <PresentationHeader
            theme={theme}
            onOpenCustomizer={() => setIsCustomizerOpen(true)}
            onClosePresenting={() => setIsPresenting(false)}
          />

          {/* Main Slide Deck Canvas */}
          <main className="flex-1 relative z-10 flex items-center justify-center p-6 md:p-12 overflow-y-auto">

            {/* SLIDE 1: WELCOME & COVER */}
            {activeSlide === 1 && <Slide1Welcome theme={theme} onNext={() => setActiveSlide(2)} />}

            {/* SLIDE 2: METHODOLOGY & SCOPE */}
            {activeSlide === 2 && <Slide2Methodology />}

            {/* SLIDE 3: INTERACTIVE ORG CHART */}
            {activeSlide === 3 && (
              <Slide3OrgChart
                team={team}
                selectedMember={selectedMember}
                onSelectMember={setSelectedMember}
                onCloseMemberDetail={() => setSelectedMember(null)}
              />
            )}

            {/* SLIDE 5: THE AI BRIEFING QUESTIONNAIRE */}
            {activeSlide === 5 && (
              <Slide5Briefing
                transcriptText={transcriptText}
                setTranscriptText={setTranscriptText}
                isProcessingAI={isProcessingAI}
                aiProgressText={aiProgressText}
                selectTranscriptPreset={selectTranscriptPreset}
                processBriefingWithGemini={processBriefingWithGemini}
                briefingFields={briefingFields}
                setBriefingFields={setBriefingFields}
                handleSendBriefing={handleSendBriefing}
                successModalOpen={successModalOpen}
                theme={theme}
                onGoToClosing={() => {
                  setSuccessModalOpen(false);
                  setActiveSlide(6);
                }}
              />
            )}

            {/* SLIDE 4: ONBOARDING TIMELINE */}
            {activeSlide === 4 && <Slide4Timeline />}

            {/* SLIDE 6: SUMMARY REVIEW & DISPATCH */}
            {activeSlide === 6 && (
              <Slide6Dispatch
                theme={theme}
                setTheme={setTheme}
                briefingFields={briefingFields}
                sendToProspectWhatsapp={sendToProspectWhatsapp}
                setSendToProspectWhatsapp={setSendToProspectWhatsapp}
                sendToProspectEmail={sendToProspectEmail}
                setSendToProspectEmail={setSendToProspectEmail}
                sendToSectors={sendToSectors}
                setSendToSectors={setSendToSectors}
                prospectEmail={prospectEmail}
                setProspectEmail={setProspectEmail}
                sectorsWhatsapp={sectorsWhatsapp}
                setSectorsWhatsapp={setSectorsWhatsapp}
                sectorsEmail={sectorsEmail}
                setSectorsEmail={setSectorsEmail}
                isDispatching={isDispatching}
                setIsDispatching={setIsDispatching}
                dispatchSuccess={dispatchSuccess}
                setDispatchSuccess={setDispatchSuccess}
                dispatchResult={dispatchResult}
                setDispatchResult={setDispatchResult}
                setIsPresenting={setIsPresenting}
                user={user}
              />
            )}

          </main>

          {/* Slide Deck Bottom Navigator Footer */}
          <PresentationFooter
            activeSlide={activeSlide}
            setActiveSlide={setActiveSlide}
            onEndPresenting={() => setIsPresenting(false)}
          />

        </div>
      )}

      {/* ─── SLIDE THEME CUSTOMIZER DRAWER (WHITE-LABEL BUILDER) ─────────────── */}
      {isCustomizerOpen && (
        <ThemeCustomizerDrawer
          theme={theme}
          setTheme={setTheme}
          handleLogoUpload={handleLogoUpload}
          handleSaveTheme={handleSaveTheme}
          onClose={() => setIsCustomizerOpen(false)}
        />
      )}

    </PageShell>
  );
}
