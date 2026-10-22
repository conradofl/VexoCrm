import React, { useState, useEffect } from "react";
import { Sparkles, Save, ArrowLeft, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { playChime } from "@/lib/geracaoDigital/helpers";
import {
  BrandIdentityBlocks,
  BrandIdentityFormState,
} from "./components/BrandIdentityBlocks";
import {
  BrandGuideView,
  GeneratedBrandGuideResult,
} from "./components/BrandGuideView";

const INITIAL_FORM_STATE: BrandIdentityFormState = {
  clientName: "",
  whatItSellsOneSentence: "",
  idealCustomer: "",
  threeCompetitors: "",
  competitiveDifferential: "",
  personalityScaleSeriousPlayful: 2,
  personalityScaleLuxuryAccessible: 2,
  personalityScaleModernTraditional: 2,
  personalityScaleTechnicalWelcoming: 4,
  brandArchetype: "",
  logoStatus: "ajustavel",
  logoDriveUrl: "",
  logoLikes: "",
  logoDislikes: "",
  untouchableColors: "",
  selectedColorPalettes: ["azul_corporativo"],
  forbiddenColors: "",
  backgroundPreference: "claro",
  selectedFontStyles: ["sem_serifa", "serifada"],
  artStyle: "minimalista",
  instagramInspirationProfiles: "",
  applicationPlaces: ["Feed & Stories Instagram", "Anúncios de Tráfego Pago"],
  imageSourceType: "hibrido",
  slogan: "",
  finalDecisionMaker: "",
  acceptedAntiIndecisionRule: false,
};

interface BrandIdentityWizardProps {
  initialClientName?: string;
  onBackToPortfolio?: () => void;
}

export default function BrandIdentityWizard({
  initialClientName,
  onBackToPortfolio,
}: BrandIdentityWizardProps) {
  const [formState, setFormState] = useState<BrandIdentityFormState>(() => {
    const saved = localStorage.getItem("vexo_gd_brand_wizard_state");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...INITIAL_FORM_STATE, ...parsed };
      } catch (e) {
        console.error(e);
      }
    }
    return {
      ...INITIAL_FORM_STATE,
      clientName: initialClientName || "",
    };
  });

  useEffect(() => {
    localStorage.setItem("vexo_gd_brand_wizard_state", JSON.stringify(formState));
  }, [formState]);

  useEffect(() => {
    if (initialClientName && !formState.clientName) {
      setFormState((prev) => ({ ...prev, clientName: initialClientName }));
    }
  }, [initialClientName]);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedGuide, setGeneratedGuide] = useState<GeneratedBrandGuideResult | null>(() => {
    const saved = localStorage.getItem("vexo_gd_generated_guide");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error(e);
      }
    }
    return null;
  });

  const handleSaveDraft = () => {
    localStorage.setItem("vexo_gd_brand_wizard_state", JSON.stringify(formState));
    toast({
      title: "Rascunho Salvo!",
      description: "As respostas do Wizard foram armazenadas com segurança.",
    });
  };

  const handleGenerateBrandGuide = async () => {
    if (!formState.acceptedAntiIndecisionRule) {
      toast({
        title: "Trava de Decisão Obrigatória",
        description: "É necessário marcar o aceite da regra inegociável de 2 caminhos (Bloco 7) para prosseguir.",
        variant: "destructive",
      });
      return;
    }

    if (!formState.whatItSellsOneSentence.trim()) {
      toast({
        title: "Bloco 1 incompleto",
        description: "Preencha ao menos o que a empresa vende em 1 frase.",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);

    // Simulação do processamento inteligente da IA com base nas respostas reais dos 7 blocos
    setTimeout(() => {
      const client = formState.clientName || "Cliente Parceiro";

      // Cartelas dinâmicas conforme as preferências
      const isDark = formState.backgroundPreference === "escuro";
      const isWarm = formState.selectedColorPalettes.includes("terrosa");
      const isVibrant = formState.selectedColorPalettes.includes("vibrante");

      const result: GeneratedBrandGuideResult = {
        clientName: client,
        generatedAt: new Date().toLocaleDateString("pt-BR"),
        pathwayA: {
          id: "caminho_a",
          title: "Caminho A · Autoridade Elegante & Confiança",
          conceptSentence: `${client} une sofisticação técnica e acolhimento humano para entregar resultados previsíveis de alto valor.`,
          palette: [
            { name: "Azul Profundo", role: "Principal", hex: isWarm ? "#2C3E50" : "#0D47A1" },
            { name: isWarm ? "Terracota Nobre" : "Cobalto Ativo", role: "Secundária", hex: isWarm ? "#A0522D" : "#1976D2" },
            { name: "Âmbar Solar", role: "Destaque / CTA", hex: "#F59E0B" },
            { name: "Off-White Gelo", role: "Neutra 1 (Fundo)", hex: "#F8FAFC" },
            { name: "Grafite Noturno", role: "Neutra 2 (Textos)", hex: "#1E293B" },
          ],
          typography: {
            headingFont: "Plus Jakarta Sans",
            headingSample: "Excelência e Precisão em Cada Detalhe",
            bodyFont: "Inter",
            bodySample: "Desenvolvemos soluções sólidas para clientes que exigem pontualidade e transparência.",
            googleFontsUrl: "https://fonts.google.com/share?selection.family=Inter:wght@400;600|Plus+Jakarta+Sans:wght@700;800",
          },
          rules: [
            "Usar o Azul Profundo em 60% da hierarquia e o Âmbar Solar estritamente para botões de conversão e elementos de chamada.",
            "Fotos devem priorizar enquadramento de meio-corpo e olhar no horizonte, transmitindo segurança e liderança.",
            "Em vídeos (Reels/Shorts), legendas amarelas com fundo translúcido para manter leitura instantânea.",
          ],
          toneOfVoice: [
            "Voz de autoridade segura: Sem gírias vazias nem clichês de internet.",
            "Direto ao ponto, empático e resolutivo.",
            "Frases curtas com verbos no presente indicativo.",
          ],
        },
        pathwayB: {
          id: "caminho_b",
          title: "Caminho B · Dinâmico, Contemporâneo & Tech",
          conceptSentence: `Uma estética de impacto imediato que projeta ${client} como vanguarda moderna do seu segmento.`,
          palette: [
            { name: "Índigo Elétrico", role: "Principal", hex: "#4F46E5" },
            { name: "Ciano Neon", role: "Secundária", hex: "#06B6D4" },
            { name: "Coral Vibrante", role: "Destaque / CTA", hex: "#FF5722" },
            { name: isDark ? "#0F172A" : "#FFFFFF", role: "Neutra 1 (Fundo)", hex: isDark ? "#0F172A" : "#FFFFFF" },
            { name: isDark ? "#F1F5F9" : "#334155", role: "Neutra 2 (Textos)", hex: isDark ? "#F1F5F9" : "#334155" },
          ],
          typography: {
            headingFont: "Cabinet Grotesk",
            headingSample: "O Próximo Nível da Sua Experiência",
            bodyFont: "DM Sans",
            bodySample: "Criatividade aliada à tecnologia para transformar presenças digitais em ativos comerciais.",
            googleFontsUrl: "https://fonts.google.com/share?selection.family=DM+Sans:wght@400;500;700",
          },
          rules: [
            "Tipografia bold com espaçamento negativo sutil em títulos para gerar impacto editorial moderno.",
            "Transições de vídeo com cortes em ritmo acelerado e grafismos em ciano neon contrastando com o fundo.",
            "Elementos 3D flutuantes e cartões com cantos arredondados (border-radius de 16px).",
          ],
          toneOfVoice: [
            "Tom provocativo e motivador, convidando o cliente à ação.",
            "Uso estratégico de dados, métricas e comprovações de performance.",
            "Ritmo dinâmico e otimista.",
          ],
        },
      };

      setGeneratedGuide(result);
      localStorage.setItem("vexo_gd_generated_guide", JSON.stringify(result));
      setIsGenerating(false);
      playChime();
      toast({
        title: "Caminhos A e B Gerados com Sucesso!",
        description: "O Guia de Marca de 1 Página está pronto para consumo da esteira.",
      });
    }, 1400);
  };

  return (
    <div className="w-full space-y-6 pb-12 animate-fade-in font-sans">
      {/* Se o guia já foi gerado, exibe a visualização */}
      {generatedGuide ? (
        <BrandGuideView
          guide={generatedGuide}
          onBackToWizard={() => setGeneratedGuide(null)}
        />
      ) : (
        /* Caso contrário, exibe o Wizard de 7 blocos */
        <div className="space-y-6">
          {/* Header do Wizard */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {onBackToPortfolio && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onBackToPortfolio}
                  className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 gap-1"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Voltar
                </Button>
              )}
              <div>
                <h1 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-600 animate-pulse" />
                  Wizard de Identidade Visual & Guia de Marca
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Os 7 blocos estratégicos da diretoria para geração automatizada dos Caminhos A e B com IA.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <Button
                type="button"
                variant="outline"
                onClick={handleSaveDraft}
                className="border-slate-200 dark:border-slate-800 text-xs font-bold gap-1.5 h-10 px-4"
              >
                <Save className="w-4 h-4 text-slate-500" />
                Salvar Rascunho
              </Button>

              <Button
                type="button"
                onClick={handleGenerateBrandGuide}
                disabled={isGenerating}
                className="bg-purple-650 hover:bg-purple-700 text-white text-xs font-bold gap-2 h-10 px-5 shadow-xs transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Gerando Caminhos A e B...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-purple-200" />
                    Gerar Caminhos A e B com IA
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Os 7 Blocos */}
          <BrandIdentityBlocks
            formState={formState}
            setFormState={setFormState}
          />
        </div>
      )}
    </div>
  );
}
