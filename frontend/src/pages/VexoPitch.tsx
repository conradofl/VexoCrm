import { useState, useMemo, useEffect } from "react";
import { Sparkles } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { toast } from "@/components/ui/use-toast";

import { SEGMENTS } from "./demoSegments";
import { ConfigBoard } from "./VexoPitch/ConfigBoard";
import { PresentationHeader } from "./VexoPitch/PresentationHeader";
import { PresentationFooter } from "./VexoPitch/PresentationFooter";
import { Slide1Problem } from "./VexoPitch/slides/Slide1Problem";
import { Slide2Solution } from "./VexoPitch/slides/Slide2Solution";
import { Slide3Followups } from "./VexoPitch/slides/Slide3Followups";
import { Slide4Intelligence } from "./VexoPitch/slides/Slide4Intelligence";
import { Slide5Simulator } from "./VexoPitch/slides/Slide5Simulator";
import { Slide6Roi } from "./VexoPitch/slides/Slide6Roi";

import { buildChatHistory, buildCurrentStepData, computeRoi, playNotificationSound } from "@/lib/vexoPitch/helpers";
import type { Message } from "@/lib/vexoPitch/types";

export default function VexoPitch() {
  const [selectedSegmentKey, setSelectedSegmentKey] = useState<string>("academia");
  const segment = SEGMENTS[selectedSegmentKey];

  // Configurações do Prospect
  const [prospectName, setProspectName] = useState<string>(segment.defaultProspectName);
  const [prospectLogo, setProspectLogo] = useState<string | null>(null);

  // ROI Calculator Parameters
  const [leadsCount, setLeadsCount] = useState<number>(500);
  const [customTicket, setCustomTicket] = useState<number>(0);
  const [customConv, setCustomConv] = useState<number>(0);

  // Sync inputs on segment change
  useMemo(() => {
    setProspectName(segment.defaultProspectName);
    setLeadsCount(segment.leadsCountDefault);
    setCustomTicket(segment.averageTicket);
    setCustomConv(segment.conversionRateDefault);
  }, [selectedSegmentKey]);

  // Fullscreen Presentation State
  const [isPresenting, setIsPresenting] = useState<boolean>(false);

  // Espelho do pitch da GD: esta apresentação é desenhada só em ESCURO e não
  // tem variantes claras. Com o CRM em tema claro, componentes base saíam
  // brancos dentro da tela preta. Força escuro enquanto apresenta e restaura
  // ao sair, sem tocar na preferência salva do usuário.
  useEffect(() => {
    if (!isPresenting) return;
    const el = document.documentElement;
    const tinhaLight = el.classList.contains("light");
    el.classList.remove("light");
    el.classList.add("dark");
    return () => {
      if (!tinhaLight) return;
      el.classList.remove("dark");
      el.classList.add("light");
    };
  }, [isPresenting]);
  const [activeSlide, setActiveSlide] = useState<number>(1);

  // Guided Chat Simulator State
  const [simStep, setSimStep] = useState<number>(1); // 1 to 5
  const [selectedObjection, setSelectedObjection] = useState<string>("");
  const [selectedQualification, setSelectedQualification] = useState<string>("");
  const [selectedPeriod, setSelectedPeriod] = useState<string>("");
  const [selectedSlot, setSelectedSlot] = useState<string>("");

  const handleStartPresentation = () => {
    setActiveSlide(1);
    setIsPresenting(true);
    handleResetSimulator();
  };

  const handleResetSimulator = () => {
    setSimStep(1);
    setSelectedObjection("");
    setSelectedQualification("");
    setSelectedPeriod("");
    setSelectedSlot("");
  };

  const handleSelectOption = (value: string) => {
    if (simStep === 1) {
      setSelectedObjection(value);
      setSimStep(2);
    } else if (simStep === 2) {
      setSelectedQualification(value);
      setSimStep(3);
    } else if (simStep === 3) {
      setSelectedPeriod(value);
      setSimStep(4);
    }
  };

  const handleSelectSlot = (slot: string) => {
    setSelectedSlot(slot);
    setSimStep(5);
    playNotificationSound();
  };

  // Chat History generation
  const chatHistory = useMemo((): Message[] => {
    return buildChatHistory(segment, simStep, selectedObjection, selectedQualification, selectedPeriod, selectedSlot);
  }, [segment, simStep, selectedObjection, selectedQualification, selectedPeriod, selectedSlot]);

  // AI thoughts and configuration instructions panel data
  const currentStepData = useMemo(() => {
    return buildCurrentStepData(segment, simStep, selectedObjection, selectedQualification, selectedPeriod, selectedSlot);
  }, [segment, simStep, selectedObjection, selectedQualification, selectedPeriod, selectedSlot]);

  // Calculations for ROI slide (aligned with math tests)
  const { operatorHoursSaved, extraSales, additionalRevenue } = computeRoi(leadsCount, customTicket, customConv);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setProspectLogo(reader.result as string);
      toast({ title: "Sucesso", description: "Logotipo do prospect importado com sucesso!" });
    };
    reader.readAsDataURL(file);
  };

  return (
    <PageShell
      title="Demonstração Comercial"
      subtitle="Apresentação interativa do Vexo OS personalizada para prospects, com simulação em tela cheia."
      icon={Sparkles}
    >
      <ConfigBoard
        selectedSegmentKey={selectedSegmentKey}
        setSelectedSegmentKey={setSelectedSegmentKey}
        segment={segment}
        prospectName={prospectName}
        setProspectName={setProspectName}
        prospectLogo={prospectLogo}
        setProspectLogo={setProspectLogo}
        handleLogoUpload={handleLogoUpload}
        leadsCount={leadsCount}
        setLeadsCount={setLeadsCount}
        customTicket={customTicket}
        setCustomTicket={setCustomTicket}
        customConv={customConv}
        setCustomConv={setCustomConv}
        additionalRevenue={additionalRevenue}
        onStartPresentation={handleStartPresentation}
      />

      {/* ═══════════════════════════════════════════════════════════════════════
          MODO APRESENTAÇÃO FULLSCREEN (SPA SLIDES DECK)
          ═══════════════════════════════════════════════════════════════════════ */}
      {isPresenting && (
        // Espelho do pitch da GD: esta apresentação é desenhada só em ESCURO
        // (bg-slate-950/text-white, sem variantes). Escopar `dark` mantém as
        // variáveis do shadcn coerentes mesmo com o CRM em tema claro, senão
        // inputs e painéis saem brancos dentro de uma tela preta.
        <div className="dark fixed inset-0 z-50 bg-slate-950 text-white overflow-y-auto flex flex-col justify-between font-sans transition-all duration-300">

          {/* Animação Estelar Background */}
          <div className="stars-layer">
            <div className="stars-1" />
            <div className="stars-2" />
          </div>

          <PresentationHeader
            prospectName={prospectName}
            prospectLogo={prospectLogo}
            segmentName={segment.name}
            onClosePresenting={() => setIsPresenting(false)}
          />

          {/* Área Principal de Slides */}
          <main className="relative z-10 flex-1 flex items-center justify-center px-8 py-6">

            {activeSlide === 1 && <Slide1Problem segment={segment} />}

            {activeSlide === 2 && <Slide2Solution segment={segment} />}

            {activeSlide === 3 && <Slide3Followups segment={segment} />}

            {activeSlide === 4 && <Slide4Intelligence segment={segment} />}

            {activeSlide === 5 && (
              <Slide5Simulator
                segment={segment}
                prospectName={prospectName}
                prospectLogo={prospectLogo}
                simStep={simStep}
                selectedObjection={selectedObjection}
                selectedQualification={selectedQualification}
                selectedPeriod={selectedPeriod}
                selectedSlot={selectedSlot}
                chatHistory={chatHistory}
                currentStepData={currentStepData}
                handleSelectOption={handleSelectOption}
                handleSelectSlot={handleSelectSlot}
                handleResetSimulator={handleResetSimulator}
              />
            )}

            {activeSlide === 6 && (
              <Slide6Roi
                prospectName={prospectName}
                operatorHoursSaved={operatorHoursSaved}
                extraSales={extraSales}
                additionalRevenue={additionalRevenue}
              />
            )}

          </main>

          {/* Rodapé de Navegação Fullscreen */}
          <PresentationFooter
            activeSlide={activeSlide}
            setActiveSlide={setActiveSlide}
            onEndPresenting={() => setIsPresenting(false)}
          />

        </div>
      )}

    </PageShell>
  );
}
