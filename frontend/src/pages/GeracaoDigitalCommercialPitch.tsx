import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL, fetchApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { computeRoi } from "@/lib/vexoPitch/helpers";
import { computePackagePricing, brlPkg } from "@/lib/geracaoDigital/packagePricing";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  Activity,
  Award,
  Zap,
  DollarSign,
  Calculator,
  ShieldCheck,
  CheckCircle,
  FileCheck,
  Info,
  Calendar,
  Layers,
  ChevronRight,
  ChevronLeft,
  X,
  Target,
  ArrowRight,
  Flame,
  Check,
  AlertTriangle
} from "lucide-react";

interface SelectedProduct {
  product_id: string;
  nome: string;
}

interface PackageOfertado {
  package_id: string;
  nome: string;
  valor: number;
  valor_tabela?: number | null;
  periodo?: string;
  produtos_incluidos?: { product_id: string; nome: string }[];
  destaque?: boolean;
}

interface ProductApi {
  id: string;
  nome: string;
}

interface GeracaoDigitalCommercialPitchProps {
  prospectName: string;
  prospectLogo: string | null;
  segmentName: string;
  mappedVexoSegment: any;
  vendaCasada: boolean;
  selectedProductsList: SelectedProduct[];
  packagesOfertados: PackageOfertado[];
  leadsCount: number;
  customTicket: number;
  customConv: number;
  onClose: () => void;
  presentationId?: string;
  vexoSelectedProducts?: any[];
}

// Micro-interaction: Animated number counter
function AnimatedCounter({ value, prefix = "", suffix = "" }: { value: number; prefix?: string; suffix?: string }) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    let start = 0;
    const duration = 800;
    const increment = Math.ceil(value / (duration / 16));
    const timer = setInterval(() => {
      start += increment;
      if (start >= value) {
        clearInterval(timer);
        setDisplayValue(value);
      } else {
        setDisplayValue(start);
      }
    }, 16);
    return () => clearInterval(timer);
  }, [value]);

  return (
    <span>{prefix}{displayValue.toLocaleString("pt-BR")}{suffix}</span>
  );
}

export default function GeracaoDigitalCommercialPitch({
  prospectName,
  prospectLogo,
  segmentName,
  vendaCasada,
  selectedProductsList,
  packagesOfertados = [],
  leadsCount,
  customTicket,
  customConv,
  onClose,
  presentationId,
  vexoSelectedProducts = []
}: GeracaoDigitalCommercialPitchProps) {
  const navigate = useNavigate();
  const { isAuthenticated, getIdToken, clientId } = useAuth();

  const [activeSlide, setActiveSlide] = useState<number>(1);
  const [customPain, setCustomPain] = useState<string>("");

  const vexoSubtotal = useMemo(() => {
    return (vexoSelectedProducts || []).reduce((sum, p) => sum + Number(p.valor || 0), 0);
  }, [vexoSelectedProducts]);

  // Live products catalog and selection state
  const [productsCatalog, setProductsCatalog] = useState<ProductApi[]>([]);
  const [liveSelectedProducts, setLiveSelectedProducts] = useState<SelectedProduct[]>(selectedProductsList);

  // Load all products on mount
  useEffect(() => {
    async function loadProducts() {
      try {
        const token = await getIdToken();
        const headers: HeadersInit = {};
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }
        const res = await fetchApi(`/api/gd/products?client_id=${clientId || ""}`, { headers });
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setProductsCatalog(data.data);
          }
        }
      } catch (err) {
        console.error("Erro ao buscar catálogo de produtos no pitch:", err);
      }
    }
    if (isAuthenticated) {
      loadProducts();
    }
  }, [isAuthenticated, clientId]);

  // SPIN Selling Slides List
  const slidesList = useMemo(() => {
    const list = [
      { type: "welcome" },      // 1. Situação / Abertura
      { type: "problem" },      // 2. Diagnóstico / Problemas
      { type: "implication" },  // 3. Implicação / Custo de Oportunidade
      { type: "needPayoff" },    // 4. Need-payoff / A Virada
      { type: "methodology" }   // 5. Metodologia / Engrenagem GD
    ];

    if (vendaCasada && vexoSelectedProducts && vexoSelectedProducts.length > 0) {
      list.push({ type: "vexoAI" }); // 7. IA Layer (Opcional Vexo OS)
    }

    list.push({ type: "timeline" });  // 8. Jornada / Primeiros 30 dias
    list.push({ type: "proof" });     // 9. Prova e resultados (Cases)
    list.push({ type: "investment" }); // 10. Investimento / Fechamento

    return list;
  }, [vendaCasada, vexoSelectedProducts]);

  const totalSlides = slidesList.length;
  const currentSlideType = slidesList[activeSlide - 1]?.type;

  const handleNext = () => {
    if (activeSlide < totalSlides) {
      setActiveSlide(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (activeSlide > 1) {
      setActiveSlide(prev => prev - 1);
    }
  };

  // Toggle product selection live and save in background
  const handleToggleProductLive = async (product: { id: string; nome: string }) => {
    const isSelected = liveSelectedProducts.some((p) => p.product_id === product.id);
    let updatedList: SelectedProduct[];

    if (isSelected) {
      updatedList = liveSelectedProducts.filter((p) => p.product_id !== product.id);
    } else {
      updatedList = [...liveSelectedProducts, { product_id: product.id, nome: product.nome }];
    }

    setLiveSelectedProducts(updatedList);

    // Save in background if presentationId exists
    if (presentationId) {
      try {
        const token = await getIdToken();
        const headers: HeadersInit = {
          "Content-Type": "application/json"
        };
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }
        await fetchApi(`/api/gd/presentations/${presentationId}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({
            client_id: clientId,
            produtos_selecionados: updatedList
          })
        });
      } catch (err) {
        console.error("Falha ao salvar seleção ao vivo de produtos:", err);
      }
    }
  };

  // Math Calculations for SPIN
  const unconvertedLeads = useMemo(() => {
    return Math.round(leadsCount * (1 - (customConv / 100)));
  }, [leadsCount, customConv]);

  const lostRevenueMonthly = useMemo(() => {
    return Math.round(unconvertedLeads * customTicket);
  }, [unconvertedLeads, customTicket]);

  const reclaimedLeads = useMemo(() => {
    return Math.round(unconvertedLeads * 0.40);
  }, [unconvertedLeads]);

  const vexoRoi = useMemo(() => {
    return computeRoi(leadsCount, customTicket, customConv);
  }, [leadsCount, customTicket, customConv]);

  const reclaimedRevenueMonthly = useMemo(() => {
    const gdReclaimed = Math.round(reclaimedLeads * customTicket);
    if (vendaCasada) {
      return gdReclaimed + vexoRoi.additionalRevenue;
    }
    return gdReclaimed;
  }, [reclaimedLeads, customTicket, vendaCasada, vexoRoi.additionalRevenue]);

  const newConversionRate = useMemo(() => {
    const baseOptimized = customConv + ((100 - customConv) * 0.40 * (customConv / 100));
    const optimizedConv = vendaCasada ? baseOptimized * 1.30 : baseOptimized;
    return Math.min(100, Number(optimizedConv.toFixed(1)));
  }, [customConv, vendaCasada]);

  // Generate proposal handler
  const handleGenerateProposal = async (packageId: string | null = null) => {
    try {
      const token = await getIdToken();
      const headers: HeadersInit = {
        "Content-Type": "application/json"
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const body = {
        client_id: clientId || "00000000-0000-0000-0000-000000000000",
        presentation_id: presentationId || null,
        package_id: packageId,
        prospect_name: prospectName,
        status: "rascunho",
        itens: liveSelectedProducts.map((p) => ({
          product_id: p.product_id || p.id,
          descricao: p.nome,
          categoria: "gd",
          valor: 0,
          recorrencia: "mensal"
        }))
      };

      const res = await fetchApi("/api/gd/proposals", {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        throw new Error("Erro ao criar proposta comercial no servidor.");
      }

      toast({
        title: "Proposta Criada",
        description: "Proposta de Pré-Venda gerada como rascunho com sucesso!"
      });

      onClose();
      navigate("/crm/propostas-gd");

    } catch (err) {
      console.error(err);
      toast({
        title: "Erro ao Gerar Proposta",
        description: "Falha de comunicação com o servidor ao gerar proposta comercial.",
        variant: "destructive"
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-50 text-slate-800 overflow-y-auto flex flex-col justify-between font-sans transition-all duration-300">

      {/* Light background gradients */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-60 -right-60 h-[500px] w-[500px] rounded-full bg-purple-100/50 blur-[120px]" />
        <div className="absolute -bottom-60 -left-60 h-[500px] w-[500px] rounded-full bg-pink-100/50 blur-[120px]" />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between border-b border-slate-200/80 dark:border-white/10 px-8 py-4 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md shadow-sm">
        <div className="flex items-center gap-3">
          {currentSlideType !== "welcome" ? (
            <>
              {prospectLogo ? (
                <div className="h-9 w-9 rounded-lg bg-white dark:bg-slate-800 p-1 flex items-center justify-center border border-slate-200 dark:border-white/10 shrink-0 shadow-sm">
                  <img src={prospectLogo} alt="Logo" className="h-full w-full object-contain" />
                </div>
              ) : (
                <div className="h-9 w-9 rounded-lg bg-slate-100 flex items-center justify-center border border-slate-200 shrink-0">
                  <span className="text-sm font-bold text-purple-600">{prospectName[0]?.toUpperCase() || "P"}</span>
                </div>
              )}
              <div>
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Apresentação Comercial</span>
                <h3 className="text-sm font-extrabold text-slate-850 leading-tight">{prospectName}</h3>
              </div>
            </>
          ) : (
            <div>
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Apresentação Comercial</span>
              <h3 className="text-sm font-extrabold text-slate-850 leading-tight">Vexo OS</h3>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          <Badge className="bg-gradient-to-r from-purple-700 to-indigo-600 text-white border-none font-bold uppercase tracking-wider text-[10px] px-3.5 py-1.5 shadow-md shadow-indigo-600/10">
            Geração Digital
          </Badge>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-655 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Main Slides Content Area */}
      <main className="relative z-10 flex-1 flex items-center justify-center p-6 md:p-12 min-h-[500px]">

        {currentSlideType === "welcome" && (
          <div className="max-w-4xl text-center space-y-8 animate-fade-in px-4 flex flex-col items-center justify-center">
            <Badge className="bg-purple-100 hover:bg-purple-100 text-purple-600 border border-purple-200 px-3 py-1 uppercase text-[10px] font-mono tracking-widest font-extrabold mb-2">
              Slide 01 · A Oportunidade
            </Badge>

            {prospectLogo ? (
              <div className="mx-auto h-36 w-36 md:h-44 md:w-44 rounded-3xl bg-white dark:bg-slate-900 p-4 border-2 border-purple-200 dark:border-purple-900/50 shadow-2xl flex items-center justify-center overflow-hidden animate-bounce-slow mb-6">
                <img src={prospectLogo} alt="Logo Prospect" className="h-full w-full object-contain" />
              </div>
            ) : (
              <div className="mx-auto h-36 w-36 md:h-44 md:w-44 rounded-3xl bg-gradient-to-br from-purple-600 to-indigo-700 flex items-center justify-center shadow-2xl text-white font-black text-6xl mb-6">
                {prospectName[0]?.toUpperCase() || "P"}
              </div>
            )}

            <h1 className="text-4xl md:text-6xl font-black tracking-tight text-slate-900 leading-tight">
              Aceleração Digital para
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-700 to-indigo-650 text-6xl md:text-8xl block mt-4 font-black tracking-tighter">
                {prospectName}
              </span>
            </h1>
            <p className="text-slate-655 text-base md:text-lg max-w-xl mx-auto font-medium leading-relaxed">
              Como construir uma máquina de geração de leads e conversão de vendas desenhada especificamente para o segmento de <span className="text-purple-600 font-extrabold">{segmentName}</span>.
            </p>
            <div className="pt-6 flex items-center justify-center gap-2 text-slate-500 text-xs">
              <Target className="h-4 w-4 text-purple-600" />
              <span className="font-semibold uppercase tracking-wider text-[9px] text-slate-400 font-mono">Diagnóstico Comercial GD</span>
            </div>
          </div>
        )}

        {/* SLIDE 2: PROBLEM (DIAGNÓSTICO) */}
        {currentSlideType === "problem" && (
          <div className="max-w-4xl w-full text-center space-y-6 animate-fade-in px-4">
            <Badge className="bg-red-50 hover:bg-red-50 text-red-650 border border-red-100 px-3 py-1 uppercase text-[10px] font-mono tracking-widest font-extrabold">
              Slide 02 · Diagnóstico
            </Badge>
            <h2 className="text-3xl md:text-5xl font-black text-slate-900 leading-tight">
              Os Gargalos de Vendas no Setor de <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-700 to-indigo-600">{segmentName}</span>
            </h2>
            <p className="text-slate-600 text-sm max-w-xl mx-auto font-light">
              Mapeamos os 3 principais pontos de vazamento de faturamento que ocorrem frequentemente na jornada de clientes do seu setor:
            </p>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 text-left pt-6">
              <Card className="bg-white dark:bg-slate-900 border-slate-100/80 dark:border-white/10 shadow-md shadow-slate-100 dark:shadow-none hover:shadow-lg hover:-translate-y-1 transition-all duration-300 p-6 space-y-3 flex flex-col justify-between">
                <div>
                  <div className="h-10 w-10 rounded-xl bg-red-50 flex items-center justify-center text-red-500 mb-2">
                    <Flame className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-850">Desperdiçar cliques pagos</h3>
                  <p className="text-slate-600 text-[11px] leading-relaxed mt-1">
                    Investimentos em tráfego que geram cliques curiosos e leads desqualificados sem intenção de compra.
                  </p>
                </div>
              </Card>

              <Card className="bg-white dark:bg-slate-900 border-slate-100/80 dark:border-white/10 shadow-md shadow-slate-100 dark:shadow-none hover:shadow-lg hover:-translate-y-1 transition-all duration-300 p-6 space-y-3 flex flex-col justify-between">
                <div>
                  <div className="h-10 w-10 rounded-xl bg-red-50 flex items-center justify-center text-red-500 mb-2">
                    <Zap className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-850">Lentidão no atendimento</h3>
                  <p className="text-slate-600 text-[11px] leading-relaxed mt-1">
                    Perder o momento de interesse: responder um lead horas após o cadastro reduz as chances de conversão em até 8x.
                  </p>
                </div>
              </Card>

              <Card className="bg-white dark:bg-slate-900 border-slate-100/80 dark:border-white/10 shadow-md shadow-slate-100 dark:shadow-none hover:shadow-lg hover:-translate-y-1 transition-all duration-300 p-6 space-y-3 flex flex-col justify-between">
                <div>
                  <div className="h-10 w-10 rounded-xl bg-red-50 flex items-center justify-center text-red-500 mb-2">
                    <Layers className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-850">Funil desestruturado</h3>
                  <p className="text-slate-600 text-[11px] leading-relaxed mt-1">
                    Ausência de sequências automáticas de acompanhamento e nutrição que reaquecem os contatos antigos.
                  </p>
                </div>
              </Card>

              <Card className="bg-white dark:bg-slate-900 border-slate-100/80 dark:border-white/10 shadow-md shadow-slate-100 dark:shadow-none hover:shadow-lg hover:-translate-y-1 transition-all duration-300 p-6 flex flex-col justify-between">
                <div>
                  <div className="h-10 w-10 rounded-xl bg-red-50 flex items-center justify-center text-red-550 mb-2">
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-850">Outras Dores Mapeadas</h3>
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* SLIDE 3: IMPLICATION (CUSTO DA DOR) */}
        {currentSlideType === "implication" && (
          <div className="max-w-4xl w-full text-center space-y-6 animate-fade-in px-4">
            <Badge className="bg-red-50 hover:bg-red-50 text-red-650 border border-red-100 px-3 py-1 uppercase text-[10px] font-mono tracking-widest font-extrabold">
              Slide 03 · Custo da Oportunidade Perdida
            </Badge>
            <h2 className="text-3xl md:text-5xl font-black text-slate-900 leading-tight">
              O Custo Oculto do Funil Comercial
            </h2>
            <p className="text-slate-600 text-sm max-w-xl mx-auto font-light">
              Considerando seu volume atual de **{leadsCount} contatos/mês** e uma conversão média estimada em **{customConv}%**:
            </p>

            <div className="grid gap-6 md:grid-cols-2 pt-6 max-w-2xl mx-auto">
              <Card className="bg-white dark:bg-slate-900 border-slate-100/80 dark:border-white/10 shadow-md shadow-slate-100 dark:shadow-none p-6 flex flex-col justify-center items-center space-y-2 text-center">
                <span className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Leads perdidos por ano</span>
                <span className="text-4xl font-black text-slate-800 font-mono">
                  <AnimatedCounter value={unconvertedLeads * 12} />
                </span>
                <span className="text-[10px] text-slate-400">Pessoas interessadas sem fechar negócio</span>
              </Card>
              <Card className="bg-red-50/40 border-red-100 shadow-md shadow-red-100/10 p-6 flex flex-col justify-center items-center space-y-2 text-center">
                <span className="text-[11px] text-red-600 font-bold uppercase tracking-wider flex items-center gap-1">
                  <TrendingDown className="h-4 w-4" />
                  Deixado na Mesa (Anual)
                </span>
                <span className="text-3xl md:text-4xl font-black text-red-600 font-mono">
                  <AnimatedCounter value={lostRevenueMonthly * 12} prefix="R$ " />
                </span>
                <span className="text-[10px] text-red-500/70 font-semibold">Valor potencial não aproveitado no funil</span>
              </Card>
            </div>

            <p className="text-[10px] text-slate-400 italic max-w-lg mx-auto pt-2">
              * O cálculo considera o faturamento bruto perdido correspondente aos leads que saem do funil de vendas sem comprar.
            </p>
          </div>
        )}

        {/* SLIDE 4: NEED-PAYOFF (A VIRADA DE CHAVE) */}
        {currentSlideType === "needPayoff" && (
          <div className="max-w-4xl w-full text-center space-y-6 animate-fade-in px-4">
            <Badge className="bg-emerald-50 hover:bg-emerald-50 text-emerald-600 border border-emerald-100 px-3 py-1 uppercase text-[10px] font-mono tracking-widest font-extrabold">
              Slide 04 · Recuperação de Receita
            </Badge>
            <h2 className="text-3xl md:text-5xl font-black text-slate-900 leading-tight">
              A Aceleração Comercial
            </h2>
            <p className="text-slate-600 text-sm max-w-xl mx-auto font-light">
              Nossa estratégia inicial foca em blindar seu funil para recuperar e converter **40% dessas perdas atuais**:
            </p>

            <div className="grid gap-6 md:grid-cols-2 pt-6 max-w-2xl mx-auto">
              <Card className="bg-white dark:bg-slate-900 border-slate-100/80 dark:border-white/10 shadow-md shadow-slate-100 dark:shadow-none p-6 flex flex-col justify-center items-center space-y-2 text-center">
                <span className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Nova Conversão Alvo</span>
                <span className="text-4xl font-black text-purple-600 font-mono">
                  {newConversionRate}%
                </span>
                <span className="text-[10px] text-slate-400">Atualmente em {customConv}%</span>
              </Card>
              <Card className="bg-gradient-to-br from-emerald-500 to-teal-600 border-none shadow-xl shadow-emerald-500/20 p-6 flex flex-col justify-center items-center space-y-2 text-center text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full blur-xl pointer-events-none" />
                <span className="text-[11px] text-emerald-100 font-bold uppercase tracking-wider flex items-center gap-1.5 font-mono">
                  <TrendingUp className="h-4 w-4 text-emerald-100" />
                  Receita Extra Anual Projetada
                </span>
                <span className="text-4xl font-black text-white font-mono leading-none tracking-tighter drop-shadow-sm">
                  <AnimatedCounter value={reclaimedRevenueMonthly * 12} prefix="+ R$ " />
                </span>
                <span className="text-base text-white/85 font-semibold">
                  Estimativa de R$ {reclaimedRevenueMonthly.toLocaleString("pt-BR")}/mês
                </span>
              </Card>
            </div>
          </div>
        )}

        {/* SLIDE 5: METHODOLOGY (METODOLOGIA) */}
        {currentSlideType === "methodology" && (
          <div className="max-w-5xl w-full text-center space-y-6 animate-fade-in px-4">
            <Badge className="bg-purple-100 hover:bg-purple-100 text-purple-650 border border-purple-200 px-3 py-1 uppercase text-[10px] font-mono tracking-widest font-extrabold">
              Slide 05 · A Engrenagem
            </Badge>
            <h2 className="text-3xl md:text-4xl font-black text-slate-900 leading-tight">
              A Engrenagem de Geração & Conversão
            </h2>
            <p className="text-slate-655 text-lg max-w-2xl mx-auto font-light">
              Como aplicamos nossa infraestrutura para obter a aceleração de receita vista no diagnóstico:
            </p>

            <div className="grid gap-8 md:grid-cols-3 text-left pt-10">
              <Card className="bg-white dark:bg-slate-900 border-slate-100/85 dark:border-white/10 shadow-md shadow-slate-100 dark:shadow-none hover:shadow-lg hover:-translate-y-1 transition-all duration-300 p-8 space-y-5 min-h-[260px]">
                <div className="h-14 w-14 rounded-2xl bg-purple-50 flex items-center justify-center text-purple-600 font-black text-lg">
                  01
                </div>
                <h3 className="text-xl font-bold text-slate-850">Atração Segmentada</h3>
                <p className="text-slate-655 text-base leading-relaxed">
                  Campanhas de tráfego focado construídas com base no perfil ideal de cliente do segmento de {segmentName.toLowerCase()}.
                </p>
              </Card>
              <Card className="bg-white dark:bg-slate-900 border-slate-100/85 dark:border-white/10 shadow-md shadow-slate-100 dark:shadow-none hover:shadow-lg hover:-translate-y-1 transition-all duration-300 p-8 space-y-5 min-h-[260px]">
                <div className="h-14 w-14 rounded-2xl bg-pink-50 flex items-center justify-center text-pink-600 font-black text-lg">
                  02
                </div>
                <h3 className="text-xl font-bold text-slate-850">Captura e Engajamento</h3>
                <p className="text-slate-655 text-base leading-relaxed">
                  Landing Pages de alta velocidade integradas a formulários inteligentes que qualificam o lead em tempo real.
                </p>
              </Card>
              <Card className="bg-white dark:bg-slate-900 border-slate-100/85 dark:border-white/10 shadow-md shadow-slate-100 dark:shadow-none hover:shadow-lg hover:-translate-y-1 transition-all duration-300 p-8 space-y-5 min-h-[260px]">
                <div className="h-14 w-14 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600 font-black text-lg">
                  03
                </div>
                <h3 className="text-xl font-bold text-slate-850">Régua de Relacionamento</h3>
                <p className="text-slate-655 text-base leading-relaxed">
                  Follow-ups automáticos no WhatsApp e campanhas de remarketing recorrentes para converter oportunidades.
                </p>
              </Card>
            </div>
          </div>
        )}

        {/* SLIDE 6: SCOPE (SOLUÇÃO PERSONALIZADA AO VIVO) */}
        {currentSlideType === "scope" && (
          <div className="max-w-5xl w-full grid gap-8 md:grid-cols-3 items-start animate-fade-in px-4">

            {/* Left/Middle: Interactive products catalog grid */}
            <div className="md:col-span-2 space-y-4 text-left">
              <div className="space-y-1">
                <Badge className="bg-purple-100 hover:bg-purple-100 text-purple-650 border border-purple-200 px-3 py-1 uppercase text-[10px] font-mono tracking-widest font-extrabold">
                  Slide 06 · Solução sob Medida
                </Badge>
                <h2 className="text-2xl md:text-3xl font-black text-slate-900 leading-tight">
                  Construa a Solução ao Vivo
                </h2>
                <p className="text-slate-600 text-xs">
                  Clique nos blocos estratégicos abaixo para desenhar o escopo ideal para o cliente (sem exibição de valores):
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 max-h-[360px] overflow-y-auto pr-1">
                {(productsCatalog.length > 0 ? productsCatalog : [
                  { id: "prod-gmn", nome: "Google Meu Negócio" },
                  { id: "prod-gads", nome: "Google Ads" },
                  { id: "prod-ig", nome: "Gestão de redes sociais - Instagram" },
                  { id: "prod-fb", nome: "Gestão de redes sociais - Facebook" },
                  { id: "prod-li", nome: "Gestão de redes sociais - LinkedIn" },
                  { id: "prod-tt", nome: "Gestão de redes sociais - TikTok" },
                  { id: "prod-gt", nome: "Gestão de tráfego google/meta ads" },
                  { id: "prod-logo", nome: "Logomarca" },
                  { id: "prod-brand", nome: "Branding" },
                  { id: "prod-cv", nome: "Cartão de visitas" },
                  { id: "prod-aa", nome: "Arte avulsa" },
                  { id: "prod-panf", nome: "Panfletos" },
                  { id: "prod-card", nome: "Cardápios" },
                  { id: "prod-fach", nome: "Fachadas" },
                  { id: "prod-lp", nome: "Landing Page/site" },
                  { id: "prod-ecom", nome: "E-commerce" },
                  { id: "prod-ce", nome: "Cobertura de eventos" },
                  { id: "prod-va", nome: "Vídeo avulso" },
                  { id: "prod-out", nome: "Outros" }
                ]).map((prod) => {
                  const isSelected = liveSelectedProducts.some((p) => p.product_id === prod.id);
                  return (
                    <div
                      key={prod.id}
                      onClick={() => handleToggleProductLive({ id: prod.id, nome: prod.nome })}
                      className={cn(
                        "p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between hover:shadow-md hover:-translate-y-0.5 select-none",
                        isSelected
                          ? "bg-purple-600/10 border-purple-500 shadow-sm"
                          : "bg-white dark:bg-slate-900 border-slate-200/80 dark:border-white/10 hover:border-slate-350 dark:hover:border-white/20"
                      )}
                    >
                      <span className="text-xs font-bold text-slate-800 leading-tight">{prod.nome}</span>
                      {isSelected ? (
                        <div className="h-4 w-4 rounded-full bg-gradient-to-r from-purple-700 to-indigo-600 flex items-center justify-center shrink-0">
                          <Check className="h-2.5 w-2.5 text-white" />
                        </div>
                      ) : (
                        <div className="h-4 w-4 rounded-full border border-slate-300 shrink-0" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: Live Tailored Proposal view */}
            <Card className="md:col-span-1 bg-white dark:bg-slate-900 border-purple-200/60 dark:border-purple-900/55 shadow-lg shadow-purple-500/5 p-6 space-y-4 self-stretch flex flex-col">
              <div className="border-b border-slate-100 pb-3">
                <span className="text-[10px] text-pink-500 font-bold uppercase tracking-wider block">Construindo Plano</span>
                <h3 className="text-sm font-black text-slate-850">Sua Solução sob Medida</h3>
              </div>

              <div className="flex-1 overflow-y-auto max-h-[280px] space-y-3 pr-1">
                {/* Geração Digital Group */}
                <div className="space-y-1.5">
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">Escopo Geração Digital</span>
                  {liveSelectedProducts.map((p, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-1.5 rounded bg-slate-50 border border-slate-100 text-left animate-fade-in">
                      <Check className="h-3 w-3 text-pink-500 shrink-0" />
                      <span className="text-[10px] font-bold text-slate-700 leading-tight">{p.nome}</span>
                    </div>
                  ))}
                  {liveSelectedProducts.length === 0 && (
                    <p className="text-[10px] text-slate-400 italic py-2 text-center">Clique nas soluções ao lado para incluir no plano.</p>
                  )}
                </div>

                {/* Vexo OS Group */}
                {vendaCasada && (
                  <div className="space-y-1.5 pt-2 border-t border-dashed border-slate-200">
                    <span className="text-[9px] text-purple-600 font-bold uppercase tracking-wider block">Módulos Vexo OS</span>
                    {(vexoSelectedProducts || []).map((p, idx) => (
                      <div key={idx} className="flex items-center gap-2 p-1.5 rounded bg-purple-50/40 border border-purple-150 text-left animate-fade-in">
                        <Check className="h-3 w-3 text-purple-600 shrink-0" />
                        <div className="flex-1 flex justify-between items-center text-[10px]">
                          <span className="font-bold text-purple-900 leading-tight">{p.nome}</span>
                        </div>
                      </div>
                    ))}
                    {(vexoSelectedProducts || []).length === 0 && (
                      <p className="text-[10px] text-slate-450 italic py-2 text-center">Nenhum módulo Vexo OS selecionado no Setup.</p>
                    )}
                  </div>
                )}
              </div>

              <div className="pt-2 text-center border-t border-slate-100">
                <span className="text-[9px] text-slate-400 font-mono">Status: Pronto para Fechamento</span>
              </div>
            </Card>

          </div>
        )}

        {/* SLIDE 7: VEXO AI (OPCIONAL) */}
        {currentSlideType === "vexoAI" && (
          <div className="max-w-5xl w-full text-center space-y-6 animate-fade-in px-4">
            <Badge className="bg-purple-100 hover:bg-purple-100 text-purple-650 border border-purple-200 px-3 py-1 uppercase text-[10px] font-mono tracking-widest font-extrabold">
              Slide 07 · Módulos Vexo OS
            </Badge>
            <h2 className="text-3xl md:text-5xl font-black text-slate-900 leading-tight">
              Módulos Vexo OS Selecionados
            </h2>
            <p className="text-slate-600 text-lg max-w-2xl mx-auto font-light">
              Potencialize sua captação unindo a Inteligência Artificial e automações do Vexo OS ao marketing da Geração Digital:
            </p>

            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3 text-left pt-10 max-h-[480px] overflow-y-auto pr-1">
              {(vexoSelectedProducts || []).map((vm, vmIdx) => (
                <Card key={vmIdx} className="bg-white dark:bg-slate-900 border-slate-100/85 dark:border-white/10 shadow-md shadow-slate-100 dark:shadow-none hover:shadow-lg hover:-translate-y-1 transition-all duration-300 p-8 space-y-4 min-h-[220px] flex flex-col justify-between">
                  <div className="space-y-4">
                    <div className="h-14 w-14 rounded-2xl bg-purple-50 flex items-center justify-center text-purple-600 font-extrabold text-lg">
                      V
                    </div>
                    <h3 className="text-xl font-bold text-slate-850">{vm.nome}</h3>
                    {vm.descricao && (
                      <p className="text-slate-660 text-base leading-relaxed">
                        {vm.descricao}
                      </p>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* SLIDE 8: TIMELINE (JORNADA / PRIMEIROS 30 DIAS) */}
        {currentSlideType === "timeline" && (
          <div className="max-w-6xl w-full text-center space-y-6 animate-fade-in px-4">
            <Badge className="bg-purple-100 hover:bg-purple-100 text-purple-650 border border-purple-200 px-3 py-1 uppercase text-[10px] font-mono tracking-widest font-extrabold">
              Slide 08 · Implantação e Cronograma
            </Badge>
            <h2 className="text-3xl font-black text-slate-900 leading-tight">O que acontece após o aceite</h2>
            <p className="text-slate-600 text-lg max-w-2xl mx-auto">
              Nossa operação de onboarding reduz seu risco de tempo de espera com um plano ágil de 4 semanas:
            </p>

            <div className="grid gap-8 md:grid-cols-4 text-left pt-10 max-w-6xl mx-auto">
              <Card className="bg-white dark:bg-slate-900 border-slate-100/80 dark:border-white/10 shadow-md shadow-slate-100 dark:shadow-none hover:shadow-lg hover:-translate-y-1 transition-all duration-300 p-7 space-y-4 min-h-[220px]">
                <Badge className="bg-purple-100 text-purple-700 border-none font-bold text-xs uppercase px-3 py-1">Semana 1</Badge>
                <h4 className="text-lg font-bold text-slate-800">Diagnóstico & Setup</h4>
                <p className="text-slate-600 text-sm leading-relaxed">Auditoria técnica de pixels, integrações e design de landing page.</p>
              </Card>
              <Card className="bg-white dark:bg-slate-900 border-slate-100/80 dark:border-white/10 shadow-md shadow-slate-100 dark:shadow-none hover:shadow-lg hover:-translate-y-1 transition-all duration-300 p-7 space-y-4 min-h-[220px]">
                <Badge className="bg-purple-100 text-purple-700 border-none font-bold text-xs uppercase px-3 py-1">Semana 2</Badge>
                <h4 className="text-lg font-bold text-slate-800">Páginas de Captura</h4>
                <p className="text-slate-600 text-sm leading-relaxed">Publicação das LPs de alta performance voltadas para conversão ativa.</p>
              </Card>
              <Card className="bg-white dark:bg-slate-900 border-slate-100/80 dark:border-white/10 shadow-md shadow-slate-100 dark:shadow-none hover:shadow-lg hover:-translate-y-1 transition-all duration-300 p-7 space-y-4 min-h-[220px]">
                <Badge className="bg-purple-100 text-purple-700 border-none font-bold text-xs uppercase px-3 py-1">Semana 3</Badge>
                <h4 className="text-lg font-bold text-slate-800">Campanhas no Ar</h4>
                <p className="text-slate-600 text-sm leading-relaxed">Ativação dos criativos e segmentação qualificada de tráfego pago.</p>
              </Card>
              <Card className="bg-white dark:bg-slate-900 border-slate-100/80 dark:border-white/10 shadow-md shadow-slate-100 dark:shadow-none hover:shadow-lg hover:-translate-y-1 transition-all duration-300 p-7 space-y-4 min-h-[220px]">
                <Badge className="bg-purple-100 text-purple-700 border-none font-bold text-xs uppercase px-3 py-1">Semana 4</Badge>
                <h4 className="text-lg font-bold text-slate-800">Entrega de Resultados</h4>
                <p className="text-slate-600 text-sm leading-relaxed">Acompanhamento das primeiras conversões e reuniões de otimização.</p>
              </Card>
            </div>
          </div>
        )}

        {/* SLIDE 9: SOCIAL PROOF (PROVAS E RESULTADOS) */}
        {currentSlideType === "proof" && (
          <div className="max-w-5xl w-full text-center space-y-6 animate-fade-in px-4">
            <Badge className="bg-purple-100 hover:bg-purple-100 text-purple-650 border border-purple-200 px-3 py-1 uppercase text-[10px] font-mono tracking-widest font-extrabold">
              Slide 09 · Prova de Performance
            </Badge>
            <h2 className="text-3xl font-black text-slate-900 leading-tight">Resultados Comerciais Reais</h2>
            <p className="text-slate-600 text-lg max-w-2xl mx-auto">
              Casos práticos de empresas parceiras que escalaram receita utilizando a metodologia GD:
            </p>

            <div className="grid gap-8 md:grid-cols-2 text-left pt-10 max-w-5xl mx-auto">
              <Card className="bg-white dark:bg-slate-900 border-slate-100/80 dark:border-white/10 shadow-md shadow-slate-100 dark:shadow-none hover:shadow-lg hover:-translate-y-1 transition-all duration-300 p-8 space-y-4 min-h-[240px]">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-purple-600 font-bold uppercase font-mono tracking-wider">Performance · {segmentName}</span>
                  <Badge className="bg-emerald-50 text-emerald-600 border-none font-bold text-sm px-3 py-1">+145% Conversão</Badge>
                </div>
                <h3 className="text-xl font-bold text-slate-850 leading-snug">Vendas dobradas no primeiro trimestre</h3>
                <p className="text-slate-600 text-base leading-relaxed">
                  "Conseguimos gerar um fluxo estável de 450 contatos quentes e otimizar nosso funil de atendimento, fechando 18 contratos novos."
                </p>
              </Card>
              <Card className="bg-white dark:bg-slate-900 border-slate-100/80 dark:border-white/10 shadow-md shadow-slate-100 dark:shadow-none hover:shadow-lg hover:-translate-y-1 transition-all duration-300 p-8 space-y-4 min-h-[240px]">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-purple-600 font-bold uppercase font-mono tracking-wider">Automação · {segmentName}</span>
                  <Badge className="bg-emerald-50 text-emerald-600 border-none font-bold text-sm px-3 py-1">-70% Tempo Resposta</Badge>
                </div>
                <h3 className="text-xl font-bold text-slate-850 leading-snug">Atendimento em segundos no WhatsApp</h3>
                <p className="text-slate-600 text-base leading-relaxed">
                  "Eliminamos a perda de leads fora do horário comercial integrando respostas autônomas de IA, gerando 35% mais agendamentos."
                </p>
              </Card>
            </div>
          </div>
        )}

        {/* SLIDE 10: INVESTMENT (INVESTIMENTO) */}
        {currentSlideType === "investment" && (
          <div className="max-w-5xl w-full space-y-6 text-center animate-fade-in px-4 overflow-y-auto max-h-[calc(100vh-180px)] pb-32 scrollbar-thin flex flex-col items-center justify-center">
            <div className="space-y-2">
              <Badge className="bg-gradient-to-r from-purple-700 to-indigo-600 text-white border-none text-xs px-4 py-1.5 uppercase font-mono tracking-wider shadow-md shadow-indigo-600/10">
                Slide 10 · Encerramento & Proposta
              </Badge>
              <h2 className="text-3xl md:text-4xl font-black text-slate-900 dark:text-white">Apresentação Comercial Concluída</h2>
              <p className="text-slate-600 dark:text-slate-400 text-xs max-w-md mx-auto">
                Próximos passos para iniciarmos a aceleração das suas vendas digitais.
              </p>
            </div>

            <div className="max-w-xl w-full bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 p-8 md:p-10 rounded-3xl space-y-6 shadow-xl mt-6 text-center">
              <CheckCircle className="h-16 w-16 text-emerald-500 mx-auto" />
              <div className="space-y-3">
                <h3 className="text-xl font-bold text-slate-850 dark:text-slate-100">Proposta Pronta para Avaliação</h3>
                <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed">
                  O escopo e os planos comerciais correspondentes foram compilados. O cliente poderá revisar a especificação e escolher o plano desejado diretamente na tela da proposta pública.
                </p>
              </div>
              <div className="pt-2">
                <Button
                  onClick={() => handleGenerateProposal(null)}
                  className="bg-gradient-to-r from-purple-700 to-indigo-600 hover:opacity-95 text-white font-extrabold text-xs px-8 py-5 rounded-2xl flex items-center justify-center gap-2 mx-auto shadow-lg shadow-indigo-600/20"
                >
                  <FileCheck className="h-4.5 w-4.5" />
                  Ir para Proposta
                </Button>
              </div>
            </div>
          </div>
        )}

      </main>

      {/* Footer controls */}
      <footer className="relative z-10 flex items-center justify-between border-t border-slate-200/80 dark:border-white/10 px-8 py-4 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md shadow-sm">
        <div className="flex items-center gap-1.5 text-xs font-mono text-slate-500 font-semibold">
          <span>SLIDE {String(activeSlide).padStart(2, "0")} / {String(totalSlides).padStart(2, "0")}</span>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrev}
            disabled={activeSlide === 1}
            className="border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 h-8 font-mono text-xs font-bold"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            ANTERIOR
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleNext}
            disabled={activeSlide === totalSlides}
            className="border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 h-8 font-mono text-xs font-bold"
          >
            PRÓXIMO
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </footer>
    </div>
  );
}
