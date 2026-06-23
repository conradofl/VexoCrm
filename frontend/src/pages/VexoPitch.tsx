import { useState, useMemo } from "react";
import {
  Sparkles,
  TrendingUp,
  MessageSquare,
  Bot,
  Layers,
  Calculator,
  RefreshCw,
  HelpCircle,
  Play,
  Upload,
  X,
  ChevronLeft,
  ChevronRight,
  Flame,
  CheckCircle2,
  AlertTriangle,
  Building2,
  DollarSign,
  Maximize2,
  Clock,
  Briefcase,
  Users,
  Calendar,
  ArrowRight,
  Bell,
  UserCheck,
  Smartphone,
  Check,
} from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

import { SEGMENTS } from "./demoSegments";

type Message = {
  sender: "bot" | "lead" | "system";
  text: string;
  time: string;
};

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

  // Play synthetic double-chime ding sound for Step 5
  const playNotificationSound = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      oscillator.type = "sine";
      // Double chime
      oscillator.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      oscillator.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.1); // A5
      
      gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
      
      oscillator.start(audioCtx.currentTime);
      oscillator.stop(audioCtx.currentTime + 0.35);
    } catch (e) {
      console.warn("Could not play notification sound", e);
    }
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
    const list: Message[] = [];
    
    // Step 1 Greeting (always show)
    list.push({ sender: "system", text: segment.steps.step1.action, time: "14:00" });
    list.push({ sender: "bot", text: segment.steps.step1.botMsg, time: "14:01" });
    
    // Step 2 Objection Contortion
    if (simStep >= 2 && selectedObjection) {
      const s2 = segment.steps.step2[selectedObjection];
      if (s2) {
        list.push({ sender: "lead", text: s2.leadMsg || "", time: "14:03" });
        list.push({ sender: "bot", text: s2.botMsg, time: "14:04" });
      }
    }
    
    // Step 3 Qualification
    if (simStep >= 3 && selectedQualification) {
      const s3 = segment.steps.step3[selectedQualification];
      if (s3) {
        list.push({ sender: "lead", text: s3.leadMsg || "", time: "14:06" });
        list.push({ sender: "bot", text: s3.botMsg, time: "14:07" });
      }
    }
    
    // Step 4 Calendar Period Selection
    if (simStep >= 4 && selectedPeriod) {
      const s4 = segment.steps.step4[selectedPeriod];
      if (s4) {
        list.push({ sender: "lead", text: s4.leadMsg || "", time: "14:09" });
        list.push({ sender: "bot", text: s4.botMsg, time: "14:10" });
      }
    }
    
    // Step 5 Handoff Confirm
    if (simStep >= 5 && selectedSlot) {
      const s5 = segment.steps.step5[selectedSlot];
      if (s5) {
        list.push({ sender: "lead", text: s5.leadMsg || "", time: "14:12" });
        list.push({ sender: "bot", text: s5.botMsg, time: "14:13" });
        list.push({ sender: "system", text: s5.action, time: "14:14" });
      }
    }
    
    return list;
  }, [segment, simStep, selectedObjection, selectedQualification, selectedPeriod, selectedSlot]);

  // AI thoughts and configuration instructions panel data
  const currentStepData = useMemo(() => {
    if (simStep === 1) {
      return {
        title: "Passo 1/5: Abordagem Automática",
        reasoning: segment.steps.step1.reasoning,
        training: segment.steps.step1.training,
        action: "Vexo Engine disparou o gatilho da campanha.",
      };
    }
    if (simStep === 2 && selectedObjection) {
      const s2 = segment.steps.step2[selectedObjection];
      return {
        title: "Passo 2/5: Contorno de Objeção",
        reasoning: s2.reasoning,
        training: s2.training,
        action: s2.action,
      };
    }
    if (simStep === 3 && selectedQualification) {
      const s3 = segment.steps.step3[selectedQualification];
      return {
        title: "Passo 3/5: Qualificação Ativa",
        reasoning: s3.reasoning,
        training: s3.training,
        action: s3.action,
      };
    }
    if (simStep === 4 && selectedPeriod) {
      const s4 = segment.steps.step4[selectedPeriod];
      return {
        title: "Passo 4/5: Proposta de Agenda",
        reasoning: s4.reasoning,
        training: s4.training,
        action: s4.action,
      };
    }
    if (simStep === 5 && selectedSlot) {
      const s5 = segment.steps.step5[selectedSlot];
      return {
        title: "Passo 5/5: Agendado & Handoff Closer",
        reasoning: s5.reasoning,
        training: s5.training,
        action: s5.action,
      };
    }
    return {
      title: "Vexo AI Simulator",
      reasoning: "Aguardando interação...",
      training: "Configuração de IA ativa.",
      action: "Nenhuma ação ativa.",
    };
  }, [segment, simStep, selectedObjection, selectedQualification, selectedPeriod, selectedSlot]);

  // Calculations for ROI slide (aligned with math tests)
  const qualifiedLeads = Math.round(leadsCount * 0.8);
  const operatorHoursSaved = Math.round((qualifiedLeads * 12) / 60);
  const currentSales = Math.round(leadsCount * (customConv / 100));
  const estimatedVexoSales = Math.round(currentSales * 1.30);
  const extraSales = Math.max(1, estimatedVexoSales - currentSales);
  const additionalRevenue = extraSales * customTicket;

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

  const formatText = (text?: string) => {
    if (!text) return "";
    return text.replace(/\{\{prospectName\}\}/g, prospectName || segment.defaultProspectName);
  };

  return (
    <PageShell
      title="Demonstração Comercial"
      subtitle="Apresentação interativa do Vexo OS personalizada para prospects, com simulação em tela cheia."
      icon={Sparkles}
    >
      <div className="space-y-6">
        
        {/* Painel Normal de Configurações do Prospect */}
        <Card className="border-slate-200/80 bg-white/80 dark:border-white/10 dark:bg-slate-900/40 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4">
            <Button
              onClick={handleStartPresentation}
              className="gap-2 bg-indigo-600 hover:bg-indigo-500 font-extrabold shadow-lg shadow-indigo-600/10 px-5"
            >
              <Maximize2 className="h-4 w-4" />
              Iniciar Apresentação (Tela Cheia)
            </Button>
          </div>
          <CardHeader>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Bot className="h-5 w-5 text-indigo-600" />
              Configurar Marca do Prospect
            </CardTitle>
            <CardDescription>
              Personalize o nome e o logotipo do seu potencial cliente antes de projetar a tela inteira.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Seletor Segmento */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-slate-500">Segmento do Prospect</Label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                {Object.entries(SEGMENTS).map(([key, data]) => (
                  <button
                    key={key}
                    onClick={() => setSelectedSegmentKey(key)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-bold transition-smooth",
                      selectedSegmentKey === key
                        ? "bg-indigo-600/10 border-indigo-500 text-indigo-700 dark:text-indigo-400"
                        : "bg-white border-slate-200 hover:bg-slate-50 dark:bg-slate-900/40 dark:border-white/5"
                    )}
                  >
                    <span>{data.emoji}</span>
                    <span>{data.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {/* Nome do lead/empresa */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-500" htmlFor="prospect-name">Nome da Empresa do Prospect</Label>
                <Input
                  id="prospect-name"
                  value={prospectName}
                  onChange={(e) => setProspectName(e.target.value)}
                  placeholder="Nome do cliente (ex: SmartFit)"
                  className="h-9.5 text-xs"
                />
              </div>

              {/* Logo Uploader */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-500">Logotipo do Prospect (Opcional)</Label>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 shrink-0 border border-slate-200 dark:border-white/5 rounded-xl bg-slate-50 dark:bg-white/[0.02] flex items-center justify-center overflow-hidden">
                    {prospectLogo ? (
                      <img src={prospectLogo} alt="Logo" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-sm font-bold text-slate-400">{prospectName[0]?.toUpperCase() || "V"}</span>
                    )}
                  </div>
                  <div className="flex-1 flex gap-2">
                    <input
                      type="file"
                      id="prospect-logo-file"
                      accept="image/png, image/jpeg"
                      onChange={handleLogoUpload}
                      className="hidden"
                    />
                    <Label
                      htmlFor="prospect-logo-file"
                      className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                    >
                      <Upload className="h-3.5 w-3.5 mr-1.5" />
                      Fazer Upload
                    </Label>
                    {prospectLogo && (
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20" onClick={() => setProspectLogo(null)}>
                        Remover
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Parâmetros ROI e Preview Rápido */}
        <div className="grid gap-6 md:grid-cols-2">
          
          <Card className="border-slate-200/80 bg-white/80 dark:border-white/10 dark:bg-slate-900/40">
            <CardHeader>
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Calculator className="h-4.5 w-4.5 text-indigo-600" />
                Métricas Financeiras para o Slide de ROI
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <Label>Volume de Leads Mensais</Label>
                  <span className="font-bold text-indigo-600">{leadsCount} contatos</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="2000"
                  step="50"
                  value={leadsCount}
                  onChange={(e) => setLeadsCount(Number(e.target.value))}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-indigo-600 dark:bg-white/10"
                />
              </div>

              <div className="grid gap-3 grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-[10px] text-slate-400 font-mono">Ticket Médio (R$)</Label>
                  <Input
                    type="number"
                    value={customTicket}
                    onChange={(e) => setCustomTicket(Number(e.target.value) || 0)}
                    className="h-8.5 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-slate-400 font-mono">Conversão Atual (%)</Label>
                  <Input
                    type="number"
                    step="0.5"
                    value={customConv}
                    onChange={(e) => setCustomConv(Number(e.target.value) || 0)}
                    className="h-8.5 text-xs"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-indigo-100 bg-indigo-50/10 dark:border-indigo-950/20 dark:bg-indigo-950/5 flex flex-col justify-between">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-indigo-700 dark:text-indigo-400">Resumo da Demonstração</CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-2 flex-1 flex flex-col justify-center">
              <div className="flex justify-between">
                <span className="text-slate-500">Empresa Simulação:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{prospectName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Segmento Ativo:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{segment.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Produto Promovido:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{segment.productName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Faturamento Extra Projetado:</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">R$ {additionalRevenue.toLocaleString("pt-BR")} / mês</span>
              </div>
            </CardContent>
          </Card>

        </div>

      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          MODO APRESENTAÇÃO FULLSCREEN (SPA SLIDES DECK)
          ═══════════════════════════════════════════════════════════════════════ */}
      {isPresenting && (
        <div className="fixed inset-0 z-50 bg-slate-950 text-white overflow-y-auto flex flex-col justify-between font-sans transition-all duration-300">
          
          {/* Animação Estelar Background */}
          <div className="stars-layer">
            <div className="stars-1" />
            <div className="stars-2" />
          </div>

          {/* Header Fullscreen */}
          <header className="relative z-10 shrink-0 border-b border-white/5 bg-slate-950/60 backdrop-blur-md px-8 py-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 border border-white/10 rounded-xl bg-white/5 flex items-center justify-center overflow-hidden shadow-lg shadow-indigo-500/10">
                {prospectLogo ? (
                  <img src={prospectLogo} alt="Logo" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-sm font-bold text-indigo-400">{prospectName[0]?.toUpperCase()}</span>
                )}
              </div>
              <div>
                <h2 className="text-base font-black tracking-tight text-white flex items-center gap-1.5">
                  {prospectName} <span className="text-slate-500 font-normal">| Demo Vexo OS</span>
                </h2>
                <p className="text-[10px] text-indigo-400 font-mono tracking-wider uppercase">{segment.name}</p>
              </div>
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-slate-400 hover:text-white hover:bg-white/5 gap-1.5"
              onClick={() => setIsPresenting(false)}
            >
              <X className="h-4 w-4" />
              Sair da Apresentação
            </Button>
          </header>

          {/* Área Principal de Slides */}
          <main className="relative z-10 flex-1 flex items-center justify-center px-8 py-6">
            
            {/* SLIDE 1: O PROBLEMA */}
            {activeSlide === 1 && (
              <div className="max-w-5xl w-full space-y-8 animate-fade-in-up">
                <div className="text-center space-y-4">
                  <Badge className="bg-red-500/10 border-red-500/20 text-red-400 text-sm px-4 py-1.5 uppercase tracking-wider font-mono">
                    {segment.slide1.badge}
                  </Badge>
                  <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-white leading-tight">
                    {segment.slide1.title}
                  </h1>
                  <p className="text-lg md:text-xl text-slate-300 max-w-4xl mx-auto">
                    {segment.slide1.subtitle}
                  </p>
                </div>

                <div className="grid gap-6 md:grid-cols-2 mt-4">
                  {/* Card Dor 1 */}
                  <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 space-y-4 relative overflow-hidden group hover:border-red-500/30 transition-all duration-300 shadow-2xl">
                    <div className="absolute top-0 right-0 h-32 w-32 bg-red-500/5 rounded-full blur-2xl" />
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10 text-red-400">
                      <AlertTriangle className="h-7 w-7" />
                    </div>
                    <h3 className="text-xl font-bold text-red-400">{segment.slide1.dor1Title}</h3>
                    <p className="text-base text-slate-300 leading-relaxed">
                      ⚠️ <strong>Dor específica:</strong> {segment.painPoint}
                    </p>
                    <p className="text-sm text-slate-400 leading-relaxed">
                      {segment.slide1.dor1Desc}
                    </p>
                  </div>

                  {/* Card Dor 2 */}
                  <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 space-y-4 relative overflow-hidden group hover:border-red-500/30 transition-all duration-300 shadow-2xl">
                    <div className="absolute top-0 right-0 h-32 w-32 bg-red-500/5 rounded-full blur-2xl" />
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10 text-red-400">
                      <Flame className="h-7 w-7" />
                    </div>
                    <h3 className="text-xl font-bold text-red-400">{segment.slide1.dor2Title}</h3>
                    <p className="text-base text-slate-300 leading-relaxed">
                      {segment.slide1.dor2Desc}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* SLIDE 2: A SOLUÇÃO */}
            {activeSlide === 2 && (
              <div className="max-w-5xl w-full space-y-8 animate-fade-in-up">
                <div className="text-center space-y-4">
                  <Badge className="bg-indigo-500/10 border-indigo-500/20 text-indigo-400 text-sm px-4 py-1.5 uppercase tracking-wider font-mono">
                    {segment.slide2.badge}
                  </Badge>
                  <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-white leading-tight">
                    {segment.slide2.title}
                  </h1>
                  <p className="text-lg md:text-xl text-slate-300 max-w-4xl mx-auto">
                    {segment.slide2.subtitle}
                  </p>
                </div>

                <div className="grid gap-6 md:grid-cols-2 mt-4">
                  {/* Máquina de Vendas */}
                  <div className="rounded-2xl border border-indigo-500/30 bg-indigo-950/10 p-8 space-y-5 relative overflow-hidden group shadow-[inset_0_0_30px_rgba(99,102,241,0.15)]">
                    <div className="absolute -right-16 -top-16 h-36 w-36 bg-indigo-500/10 rounded-full blur-2xl" />
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400">
                      <TrendingUp className="h-7 w-7" />
                    </div>
                    <h3 className="text-2xl font-black text-indigo-400">{segment.slide2.motor1Title}</h3>
                    <ul className="space-y-3.5 text-sm text-slate-300">
                      {segment.slide2.motor1Features.map((f, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <CheckCircle2 className="h-5 w-5 shrink-0 text-indigo-400 mt-0.5" />
                          <span><strong>{f.title}</strong>: {f.desc}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Máquina de Disparos */}
                  <div className="rounded-2xl border border-orange-500/30 bg-orange-950/10 p-8 space-y-5 relative overflow-hidden group shadow-[inset_0_0_30px_rgba(249,115,22,0.15)]">
                    <div className="absolute -right-16 -top-16 h-36 w-36 bg-orange-500/10 rounded-full blur-2xl" />
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500/20 text-orange-400">
                      <Flame className="h-7 w-7" />
                    </div>
                    <h3 className="text-2xl font-black text-orange-400">{segment.slide2.motor2Title}</h3>
                    <ul className="space-y-3.5 text-sm text-slate-300">
                      {segment.slide2.motor2Features.map((f, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <CheckCircle2 className="h-5 w-5 shrink-0 text-orange-400 mt-0.5" />
                          <span><strong>{f.title}</strong>: {f.desc}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* SLIDE 3: FOLLOW-UPS E REENGAJAMENTO */}
            {activeSlide === 3 && (
              <div className="max-w-5xl w-full space-y-8 animate-fade-in-up">
                <div className="text-center space-y-4">
                  <Badge className="bg-orange-500/10 border-orange-500/20 text-orange-400 text-sm px-4 py-1.5 uppercase tracking-wider font-mono">
                    {segment.slide3.badge}
                  </Badge>
                  <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-white leading-tight">
                    {segment.slide3.title}
                  </h1>
                  <p className="text-lg md:text-xl text-slate-300 max-w-4xl mx-auto">
                    {segment.slide3.subtitle}
                  </p>
                </div>

                <div className="grid gap-6 md:grid-cols-3 mt-4">
                  <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 space-y-4 relative overflow-hidden group hover:border-orange-500/30 transition-all duration-300 shadow-2xl">
                    <div className="absolute top-0 right-0 h-32 w-32 bg-orange-500/5 rounded-full blur-2xl" />
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500/10 text-orange-400">
                      <Clock className="h-7 w-7" />
                    </div>
                    <h3 className="text-xl font-bold text-orange-400">{segment.slide3.feature1Title}</h3>
                    <ul className="space-y-2.5 text-xs text-slate-300">
                      {segment.slide3.feature1Items.map((f, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <Check className="h-4 w-4 shrink-0 text-orange-400 mt-0.5" />
                          <span><strong>{f.title}</strong>: {f.desc}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-2xl border border-indigo-500/30 bg-indigo-950/10 p-6 space-y-4 relative overflow-hidden group shadow-[inset_0_0_30px_rgba(99,102,241,0.15)] md:col-span-2">
                    <div className="absolute -right-16 -top-16 h-36 w-36 bg-indigo-500/10 rounded-full blur-2xl" />
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400">
                      <Bot className="h-7 w-7" />
                    </div>
                    <h3 className="text-xl font-bold text-indigo-400">{segment.slide3.feature2Title}</h3>
                    <p className="text-sm text-slate-300 leading-relaxed">
                      {segment.slide3.feature2Desc}
                    </p>
                    <div className="rounded-xl bg-slate-950/50 p-4 border border-white/5 space-y-2">
                      <p className="text-xs text-slate-400 flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        <strong>Detecção em tempo real:</strong>
                      </p>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        {segment.slide3.feature2Highlight}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SLIDE 4: INTELIGÊNCIA COMERCIAL & ROTEAMENTO */}
            {activeSlide === 4 && (
              <div className="max-w-5xl w-full space-y-8 animate-fade-in-up">
                <div className="text-center space-y-4">
                  <Badge className="bg-emerald-500/10 border-emerald-500/20 text-emerald-400 text-sm px-4 py-1.5 uppercase tracking-wider font-mono">
                    {segment.slide4.badge}
                  </Badge>
                  <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-white leading-tight">
                    {segment.slide4.title}
                  </h1>
                  <p className="text-lg md:text-xl text-slate-300 max-w-4xl mx-auto">
                    {segment.slide4.subtitle}
                  </p>
                </div>

                <div className="grid gap-6 md:grid-cols-3 mt-4">
                  {segment.slide4.cards.map((card, i) => (
                    <div key={i} className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 space-y-4 hover:border-emerald-500/30 transition-all duration-300 relative overflow-hidden group shadow-2xl">
                      <div className="absolute top-0 right-0 h-32 w-32 bg-emerald-500/5 rounded-full blur-2xl" />
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                        {card.icon === 'users' && <Users className="h-7 w-7" />}
                        {card.icon === 'bell' && <Bell className="h-7 w-7" />}
                        {card.icon === 'sparkles' && <Sparkles className="h-7 w-7" />}
                        {card.icon === 'check' && <CheckCircle2 className="h-7 w-7" />}
                        {card.icon === 'clock' && <Clock className="h-7 w-7" />}
                      </div>
                      <h3 className="text-xl font-bold text-emerald-400">{card.title}</h3>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        {card.desc}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* SLIDE 5: O SIMULADOR LIVE MULTITURNO */}
            {activeSlide === 5 && (
              <div className="max-w-[1400px] w-full space-y-6 animate-fade-in-up">
                <div className="text-center space-y-1">
                  <Badge className="bg-indigo-500/10 border-indigo-500/20 text-indigo-400 text-xs px-3 py-1 uppercase tracking-wider font-mono">
                    SLIDE 05 · SIMULADOR LIVE VEXO OS
                  </Badge>
                  <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white">
                    Simulação Interativa de Atendimento Automático
                  </h1>
                  <p className="text-sm text-slate-400">
                    Acompanhe como a inteligência artificial qualifica o lead, contorna as dores e move o card no funil de vendas em tempo real.
                  </p>
                </div>

                <div className="grid gap-6 lg:grid-cols-12 items-stretch">
                  
                  {/* Coluna Esquerda (5/12): WhatsApp Simulator */}
                  <div className="lg:col-span-5 flex flex-col justify-between bg-slate-900/60 border border-white/5 rounded-2xl p-4 space-y-4">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-white/5 pb-2">
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 border border-white/10 rounded-full overflow-hidden shrink-0">
                            {prospectLogo ? (
                              <img src={prospectLogo} alt="Prospect Logo" className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-[10px] font-bold text-indigo-400 text-center block leading-7 bg-white/5">{prospectName[0]}</span>
                            )}
                          </div>
                          <div>
                            <p className="text-xs font-bold text-white leading-none">{prospectName}</p>
                            <span className="text-[8px] text-emerald-400 font-mono flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> online
                            </span>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" className="h-7 text-[10px] text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/10 px-2.5 py-0" onClick={handleResetSimulator}>
                          <RefreshCw className="h-3 w-3 mr-1" /> Reiniciar Simulação
                        </Button>
                      </div>

                      {/* Caixa de Mensagens */}
                      <div className="bg-slate-950/70 border border-white/5 rounded-xl p-3.5 h-[280px] overflow-y-auto flex flex-col gap-3">
                        {chatHistory.map((msg, i) => (
                          <div
                            key={i}
                            className={cn(
                              "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs flex flex-col animate-fade-in-up leading-relaxed shadow-md",
                              msg.sender === "bot"
                                ? "bg-slate-800 text-slate-100 self-start border border-white/5"
                                : msg.sender === "lead"
                                ? "bg-indigo-600 text-white self-end"
                                : "bg-white/[0.02] text-slate-400 self-center text-[9px] py-1 border border-transparent font-mono rounded-lg"
                            )}
                          >
                            {msg.sender === "bot" && (
                              <span className="text-[8px] font-mono font-bold text-indigo-400 uppercase tracking-wider mb-1 block">Atendente IA ({prospectName})</span>
                            )}
                            {msg.sender === "lead" && (
                              <span className="text-[8px] font-mono font-bold text-indigo-300 uppercase tracking-wider mb-1 block">Lead: Felipe Melo / Mariana</span>
                            )}
                            <span>{formatText(msg.text)}</span>
                            {msg.sender !== "system" && (
                              <span className="text-[7px] opacity-60 self-end mt-0.5">{msg.time}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Controles de Ação do Lead */}
                    <div className="border-t border-white/5 pt-3.5">
                      {simStep <= 3 && (
                        <div className="space-y-2">
                          <p className="text-[10px] font-bold text-slate-400 font-mono uppercase tracking-wider flex items-center gap-1.5">
                            <Smartphone className="h-3.5 w-3.5 text-indigo-400" />
                            Escolha a resposta do lead (Cliente):
                          </p>
                          <div className="grid grid-cols-1 gap-2">
                            {simStep === 1 && segment.steps.step1.options?.map((opt, i) => (
                              <button
                                key={i}
                                className="w-full rounded-xl border border-white/10 bg-white/5 hover:bg-indigo-600/20 hover:border-indigo-500 text-xs font-bold py-2.5 px-3.5 text-left transition-smooth text-slate-200"
                                onClick={() => handleSelectOption(opt.value)}
                              >
                                {opt.label}
                              </button>
                            ))}
                            {simStep === 2 && selectedObjection && segment.steps.step2[selectedObjection]?.options?.map((opt, i) => (
                              <button
                                key={i}
                                className="w-full rounded-xl border border-white/10 bg-white/5 hover:bg-indigo-600/20 hover:border-indigo-500 text-xs font-bold py-2.5 px-3.5 text-left transition-smooth text-slate-200"
                                onClick={() => handleSelectOption(opt.value)}
                              >
                                {opt.label}
                              </button>
                            ))}
                            {simStep === 3 && selectedQualification && segment.steps.step3[selectedQualification]?.options?.map((opt, i) => (
                              <button
                                key={i}
                                className="w-full rounded-xl border border-white/10 bg-white/5 hover:bg-indigo-600/20 hover:border-indigo-500 text-xs font-bold py-2.5 px-3.5 text-left transition-smooth text-slate-200"
                                onClick={() => handleSelectOption(opt.value)}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Passo 4: Grid interativo de Slots de Horários */}
                      {simStep === 4 && selectedPeriod && (
                        <div className="space-y-2.5">
                          <p className="text-[10px] font-bold text-slate-400 font-mono uppercase tracking-wider flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5 text-emerald-400" />
                            Selecione um horário na Agenda para confirmar:
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            {segment.steps.step4[selectedPeriod]?.slots?.map((slot, i) => (
                              <button
                                key={i}
                                className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 hover:bg-emerald-600 text-white text-xs font-black py-3 px-2 text-center transition-smooth"
                                onClick={() => handleSelectSlot(slot)}
                              >
                                {slot}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Passo 5: Sucesso Completo */}
                      {simStep === 5 && (
                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/15 p-3 flex items-center gap-3">
                          <div className="h-8 w-8 bg-emerald-500/20 rounded-full flex items-center justify-center text-emerald-400 animate-pulse">
                            <Check className="h-4.5 w-4.5" />
                          </div>
                          <div>
                            <p className="text-xs font-black text-emerald-400 leading-none">Agendamento Realizado!</p>
                            <p className="text-[10px] text-slate-400 mt-1">A IA qualificou o lead, bloqueou a agenda e enviou o alerta ao Closer.</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Coluna Direita (7/12): Vexo OS Brain & CRM Dashboard */}
                  <div className="lg:col-span-7 flex flex-col justify-between space-y-4">
                    
                    {/* CRM Kanban Board */}
                    <div className="bg-slate-900/40 border border-white/5 rounded-2xl p-4.5 space-y-2">
                      <p className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        <Layers className="h-3.5 w-3.5 text-indigo-400" />
                        Status do CRM Integrado em Tempo Real
                      </p>
                      
                      <div className="grid grid-cols-4 gap-2.5 h-[100px] bg-slate-950/50 rounded-xl p-2">
                        {/* Coluna Novo */}
                        <div className="rounded-lg bg-white/[0.01] p-1 flex flex-col gap-1 overflow-hidden">
                          <span className="text-[8px] font-bold text-slate-500 uppercase text-center block">Novo</span>
                          {simStep === 1 && (
                            <div className="rounded bg-indigo-500/10 border border-indigo-500/30 p-1.5 animate-pulse text-center">
                              <p className="text-[9px] font-black text-white truncate">{prospectName[0] || "L"}</p>
                              <span className="text-[7px] text-indigo-400 block font-semibold leading-none mt-0.5">Triagem IA</span>
                            </div>
                          )}
                        </div>

                        {/* Coluna Qualificando */}
                        <div className="rounded-lg bg-white/[0.01] p-1 flex flex-col gap-1 overflow-hidden">
                          <span className="text-[8px] font-bold text-slate-500 uppercase text-center block">Qualificando</span>
                          {(simStep === 2 || simStep === 3) && (
                            <div className="rounded bg-amber-500/10 border border-amber-500/30 p-1.5 text-center">
                              <p className="text-[9px] font-black text-white truncate">{prospectName[0] || "L"}</p>
                              <span className="text-[7px] text-amber-500 block font-semibold leading-none mt-0.5">Qualificando</span>
                            </div>
                          )}
                        </div>

                        {/* Coluna Agendado */}
                        <div className="rounded-lg bg-white/[0.01] p-1 flex flex-col gap-1 overflow-hidden">
                          <span className="text-[8px] font-bold text-slate-500 uppercase text-center block">Agendado</span>
                          {simStep >= 4 && (
                            <div className={cn(
                              "rounded bg-emerald-500/20 border border-emerald-500 p-1.5 text-center shadow-lg shadow-emerald-500/10",
                              simStep === 5 ? "animate-bounce" : ""
                            )}>
                              <p className="text-[9px] font-black text-white truncate">{prospectName[0] || "L"}</p>
                              <span className="text-[7px] text-emerald-400 block font-black leading-none mt-0.5">✓ {segment.goalAction.split(" ")[1]}</span>
                            </div>
                          )}
                        </div>

                        {/* Coluna Arquivado */}
                        <div className="rounded-lg bg-white/[0.01] p-1 flex flex-col gap-1 overflow-hidden">
                          <span className="text-[8px] font-bold text-slate-500 uppercase text-center block">Perdidos</span>
                        </div>
                      </div>
                    </div>

                    {/* AI Reasoning Console (Vexo Brain) */}
                    <div className="bg-slate-900/40 border border-white/5 rounded-2xl p-4.5 space-y-3.5 flex-1 flex flex-col justify-between">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Bot className="h-4 w-4 text-indigo-400" />
                            Painel de Inteligência Vexo OS
                          </p>
                          <Badge variant="outline" className="text-[9px] px-2 py-0.5 border-indigo-500/30 text-indigo-400 font-mono bg-indigo-500/5">
                            {currentStepData.title}
                          </Badge>
                        </div>

                        {/* Detalhes do Turno */}
                        <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
                          <div className="rounded-xl border border-indigo-500/10 bg-indigo-950/20 p-4 relative overflow-hidden group">
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-indigo-500/5 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]" />
                            <p className="text-sm text-indigo-300 font-medium leading-relaxed relative z-10">
                              {formatText(currentStepData.reasoning)}
                            </p>
                          </div>
                          <div className="rounded-xl border border-emerald-500/10 bg-emerald-950/20 p-4 relative overflow-hidden group">
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-emerald-500/5 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]" />
                            <p className="text-sm text-emerald-300 font-medium leading-relaxed relative z-10">
                              "{formatText(currentStepData.training)}"
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Explicador de Ações em Background e Handoff do Closer no Passo 5 */}
                      <div className="border-t border-white/5 pt-3.5">
                        {simStep < 5 ? (
                          <div className="flex items-center gap-3 w-full bg-slate-900/60 p-3 rounded-xl border border-white/5">
                            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-orange-500/10">
                              <Bot className="h-4 w-4 text-orange-400" />
                            </div>
                            <span className="text-[11px] font-bold text-slate-200 truncate max-w-md">{formatText(currentStepData.action)}</span>
                          </div>
                        ) : (
                          // Passo 5: Card de Handoff Completo e Relatório de Qualificação para Closer
                          <div className="rounded-xl border border-indigo-500/40 bg-indigo-950/30 p-4 shadow-xl space-y-3 relative overflow-hidden animate-pulse">
                            <div className="absolute top-0 right-0 p-3 text-indigo-400">
                              <Bell className="h-5 w-5 animate-bounce" />
                            </div>
                            
                            <div className="flex items-center gap-2">
                              <UserCheck className="h-4.5 w-4.5 text-indigo-400" />
                              <span className="text-xs font-black text-indigo-300 uppercase font-mono tracking-wider">
                                Card de Qualificação Comercial Criado (Handoff)
                              </span>
                            </div>

                            {segment.steps.step5[selectedSlot]?.handoff && (
                              <div className="grid gap-2 grid-cols-2 text-xs">
                                <div className="space-y-0.5">
                                  <span className="text-[9px] text-slate-500 uppercase font-mono block">Nome do Lead</span>
                                  <p className="font-bold text-white truncate">{formatText(segment.steps.step5[selectedSlot].handoff.lead)}</p>
                                </div>
                                <div className="space-y-0.5">
                                  <p className="text-[10px] text-slate-400 uppercase tracking-widest font-mono font-bold mb-1">Responsável</p>
                                  <p className="text-white font-medium">{formatText(segment.steps.step5[selectedSlot].handoff.closer)}</p>
                                </div>
                                <div className="col-span-2 space-y-0.5 border-t border-white/5 pt-1.5">
                                  <span className="text-[9px] text-slate-500 uppercase font-mono block">Dados da Triagem da IA</span>
                                  <p className="text-slate-300 leading-relaxed text-[11px]">{formatText(segment.steps.step5[selectedSlot].handoff.meta)}</p>
                                </div>
                                <div className="col-span-2 space-y-0.5 border-t border-white/5 pt-1.5">
                                  <span className="text-[9px] text-slate-500 uppercase font-mono block">Horário Reservado</span>
                                  <p className="text-emerald-400 font-extrabold">{formatText(segment.steps.step5[selectedSlot].handoff.action)}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                    </div>

                  </div>

                </div>
              </div>
            )}

            {/* SLIDE 6: ROI E RESULTADOS */}
            {activeSlide === 6 && (
              <div className="max-w-5xl w-full space-y-8 animate-fade-in-up">
                <div className="text-center space-y-4">
                  <Badge className="bg-emerald-500/10 border-emerald-500/20 text-emerald-400 text-sm px-4 py-1.5 uppercase tracking-wider font-mono">
                    SLIDE 06 · PROJEÇÃO DE RETORNO DO INVESTIMENTO (R.O.I.)
                  </Badge>
                  <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-white leading-tight">
                    Resultados Esperados para {prospectName}
                  </h1>
                  <p className="text-lg md:text-xl text-slate-300 max-w-4xl mx-auto">
                    Demonstrativo financeiro simulado baseado nas métricas de conversão e ticket médio do seu nicho.
                  </p>
                </div>

                <div className="grid gap-6 md:grid-cols-3 mt-4">
                  {/* ROI Card 1 */}
                  <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 space-y-3 text-center shadow-[0_8px_30px_rgba(0,0,0,0.3)]">
                    <p className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">Tempo Comercial Salvo</p>
                    <p className="text-5xl md:text-6xl font-black text-indigo-400 tracking-tight">{operatorHoursSaved}h</p>
                    <p className="text-sm text-slate-500 leading-relaxed">de trabalho de recepção e triagem manual economizados por mês para sua equipe focar apenas no fechamento presencial.</p>
                  </div>

                  {/* ROI Card 2 */}
                  <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 space-y-3 text-center shadow-[0_8px_30px_rgba(0,0,0,0.3)]">
                    <p className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">Novas Vendas Adicionais</p>
                    <p className="text-5xl md:text-6xl font-black text-orange-400 tracking-tight">+{extraSales}</p>
                    <p className="text-sm text-slate-500 leading-relaxed">fechamentos mensais conquistados devido à qualificação em menos de 60 segundos e follow-ups automáticos persistentes.</p>
                  </div>

                  {/* ROI Card 3 */}
                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/5 p-8 space-y-3 text-center shadow-[0_8px_30px_rgba(16,185,129,0.08)]">
                    <p className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-wider">Faturamento Extra Estimado</p>
                    <p className="text-3xl md:text-4xl font-black text-emerald-400 tracking-tight pt-2">
                      R$ {additionalRevenue.toLocaleString("pt-BR")}
                    </p>
                    <p className="text-sm text-slate-500 leading-relaxed pt-2">de faturamento recorrente extra recuperado de leads que simplesmente sumiriam e esfriariam na base fria.</p>
                  </div>
                </div>

                <div className="rounded-2xl bg-indigo-600 p-5 text-center font-black text-base tracking-tight text-white max-w-lg mx-auto shadow-2xl shadow-indigo-600/30 mt-6">
                  ⚡ Recupere o investimento da plataforma no primeiro mês de uso!
                </div>
              </div>
            )}

          </main>

          {/* Rodapé de Navegação Fullscreen */}
          <footer className="relative z-10 shrink-0 border-t border-white/5 bg-slate-950/60 backdrop-blur-md px-8 py-5 flex items-center justify-between">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "h-9 text-xs font-bold transition-all duration-200",
                  activeSlide === 1
                    ? "border-white/5 bg-transparent text-white/20 cursor-not-allowed opacity-30"
                    : "border-white/20 text-white bg-slate-900/60 hover:bg-white/10 hover:text-white"
                )}
                disabled={activeSlide === 1}
                onClick={() => setActiveSlide(activeSlide - 1)}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Voltar Slide
              </Button>
            </div>

            {/* Indicadores de slides */}
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5, 6].map((slideNum) => (
                <div
                  key={slideNum}
                  onClick={() => setActiveSlide(slideNum)}
                  className={cn(
                    "h-2.5 w-10 rounded-full cursor-pointer transition-smooth",
                    activeSlide === slideNum ? "bg-indigo-500" : "bg-white/10 hover:bg-white/20"
                  )}
                />
              ))}
            </div>

            <div className="flex gap-2">
              {activeSlide < 6 ? (
                <Button
                  size="sm"
                  className="h-9 bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white px-5"
                  onClick={() => setActiveSlide(activeSlide + 1)}
                >
                  Avançar Slide
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="h-9 bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white px-5"
                  onClick={() => setIsPresenting(false)}
                >
                  Encerrar Demonstração
                </Button>
              )}
            </div>
          </footer>

        </div>
      )}

    </PageShell>
  );
}
