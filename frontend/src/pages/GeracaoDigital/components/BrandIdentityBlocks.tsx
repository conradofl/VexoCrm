import React, { useState } from "react";
import {
  Building2,
  Sparkles,
  Image,
  Palette,
  Type,
  FileCheck2,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Sliders,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface BrandIdentityFormState {
  // Bloco 1: O Negócio
  clientName: string;
  whatItSellsOneSentence: string;
  idealCustomer: string;
  threeCompetitors: string;
  competitiveDifferential: string;

  // Bloco 2: Personalidade da Marca (Escalas 1 a 5)
  personalityScaleSeriousPlayful: number; // 1 (Sério) a 5 (Descontraído)
  personalityScaleLuxuryAccessible: number; // 1 (Luxo) a 5 (Acessível)
  personalityScaleModernTraditional: number; // 1 (Moderno) a 5 (Tradicional)
  personalityScaleTechnicalWelcoming: number; // 1 (Técnico) a 5 (Acolhedor)
  brandArchetype: string;

  // Bloco 3: Logo Atual
  logoStatus: "intocavel" | "ajustavel" | "criar_do_zero";
  logoDriveUrl: string;
  logoLikes: string;
  logoDislikes: string;

  // Bloco 4: Cores
  untouchableColors: string;
  selectedColorPalettes: string[]; // max 2
  forbiddenColors: string;
  backgroundPreference: "claro" | "escuro" | "hibrido";

  // Bloco 5: Tipografia & Estilo
  selectedFontStyles: string[];
  artStyle: "minimalista" | "cheio_informativo" | "foto_destaque" | "ilustracao";
  instagramInspirationProfiles: string;

  // Bloco 6: Conteúdo e Uso
  applicationPlaces: string[];
  imageSourceType: "proprio" | "estoque" | "hibrido";
  slogan: string;

  // Bloco 7: Decisão (A Trava Anti-Indecisão)
  finalDecisionMaker: string;
  acceptedAntiIndecisionRule: boolean;
}

interface BrandIdentityBlocksProps {
  formState: BrandIdentityFormState;
  setFormState: React.Dispatch<React.SetStateAction<BrandIdentityFormState>>;
}

export function BrandIdentityBlocks({ formState, setFormState }: BrandIdentityBlocksProps) {
  const [openSections, setOpenSections] = useState({
    b1: true,
    b2: true,
    b3: true,
    b4: true,
    b5: true,
    b6: true,
    b7: true,
  });

  const toggleSection = (key: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const updateField = <K extends keyof BrandIdentityFormState>(
    field: K,
    value: BrandIdentityFormState[K]
  ) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const colorPalettesOptions = [
    {
      id: "terrosa",
      label: "🍂 Terrosa",
      desc: "Tons quentes de marrom, terracota e bege",
      colors: ["#795548", "#A1887F", "#D7CCC8", "#8D6E63", "#4E342E"],
    },
    {
      id: "vibrante",
      label: "⚡ Vibrante",
      desc: "Laranja, azul elétrico e amarelo enérgico",
      colors: ["#FF6D00", "#2979FF", "#FFD600", "#FF1744", "#00E676"],
    },
    {
      id: "pastel",
      label: "🌸 Pastel",
      desc: "Suavidade com lavanda, menta e pêssego",
      colors: ["#E1BEE7", "#C8E6C9", "#FFE0B2", "#B3E5FC", "#F8BBD0"],
    },
    {
      id: "escura_elegante",
      label: "🖤 Escura & Elegante",
      desc: "Preto, grafite, dourado e off-white",
      colors: ["#121212", "#212121", "#D4AF37", "#424242", "#F5F5F5"],
    },
    {
      id: "azul_corporativo",
      label: "💼 Azul Corporativo",
      desc: "Azul marinho, ciano, cinza e branco",
      colors: ["#0D47A1", "#1976D2", "#00BCD4", "#ECEFF1", "#263238"],
    },
    {
      id: "verde_natural",
      label: "🌿 Verde Natural",
      desc: "Musgo, folha, verde oliva e areia",
      colors: ["#2E7D32", "#4CAF50", "#81C784", "#F1F8E9", "#33691E"],
    },
  ];

  const fontStylesList = [
    { id: "serifada", label: "Serifada", desc: "Elegante, clássica, editorial (ex: Playfair)" },
    { id: "sem_serifa", label: "Sem Serifa Moderna", desc: "Clean, tech, minimalista (ex: Inter)" },
    { id: "arredondada", label: "Arredondada", desc: "Amigável, jovem, suave (ex: Poppins)" },
    { id: "manuscrita", label: "Manuscrita / Script", desc: "Artesanal, pessoal, assinatura (ex: Caveat)" },
  ];

  const appPlacesList = [
    "Feed & Stories Instagram",
    "Anúncios de Tráfego Pago",
    "Materiais Impressos",
    "Fachada Comercial",
    "Uniformes & Camisetas",
    "Site / Landing Page",
  ];

  return (
    <div className="space-y-5">
      {/* ─── BLOCO 1: O NEGÓCIO ──────────────────────────────────────────────── */}
      <Card className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl shadow-xs overflow-hidden">
        <CardHeader
          onClick={() => toggleSection("b1")}
          className="p-5 flex flex-row items-center justify-between cursor-pointer select-none bg-slate-50/60 dark:bg-slate-800/40 hover:bg-slate-100/60 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center justify-center font-bold">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold text-slate-900 dark:text-white">
                Bloco 1 · O Negócio
              </CardTitle>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                O que a empresa vende em 1 frase, cliente ideal e diferencial.
              </p>
            </div>
          </div>
          {openSections.b1 ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
        </CardHeader>

        {openSections.b1 && (
          <CardContent className="p-6 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                O que você vende em exatamente 1 frase? *
              </Label>
              <Input
                value={formState.whatItSellsOneSentence}
                onChange={(e) => updateField("whatItSellsOneSentence", e.target.value)}
                placeholder="Ex: Fabricamos e vendemos colchões ortopédicos de alto suporte para quem sofre com dores nas costas."
                className="h-10 text-xs border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Quem é o seu Cliente Ideal?
                </Label>
                <textarea
                  value={formState.idealCustomer}
                  onChange={(e) => updateField("idealCustomer", e.target.value)}
                  placeholder="Ex: Famílias de classe B/A, homens e mulheres entre 35 e 60 anos que valorizam saúde e sono reparador."
                  className="w-full h-20 p-3 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl outline-none resize-none"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Qual é o seu Grande Diferencial Competitivo?
                </Label>
                <textarea
                  value={formState.competitiveDifferential}
                  onChange={(e) => updateField("competitiveDifferential", e.target.value)}
                  placeholder="Ex: 100 noites de teste grátis com garantia total de troca e densidade progressiva patenteada."
                  className="w-full h-20 p-3 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl outline-none resize-none"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                3 Principais Concorrentes Diretos
              </Label>
              <Input
                value={formState.threeCompetitors}
                onChange={(e) => updateField("threeCompetitors", e.target.value)}
                placeholder="Ex: Concorrente Alpha, Loja Beta, Marca Gamma"
                className="h-10 text-xs border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
          </CardContent>
        )}
      </Card>

      {/* ─── BLOCO 2: PERSONALIDADE DA MARCA ─────────────────────────────────── */}
      <Card className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl shadow-xs overflow-hidden">
        <CardHeader
          onClick={() => toggleSection("b2")}
          className="p-5 flex flex-row items-center justify-between cursor-pointer select-none bg-slate-50/60 dark:bg-slate-800/40 hover:bg-slate-100/60 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 flex items-center justify-center font-bold">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold text-slate-900 dark:text-white">
                Bloco 2 · Personalidade da Marca (Escalas)
              </CardTitle>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Equilíbrio do tom de voz e arquétipo humano da empresa.
              </p>
            </div>
          </div>
          {openSections.b2 ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
        </CardHeader>

        {openSections.b2 && (
          <CardContent className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Escala 1 */}
              <div className="space-y-2 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/30">
                <div className="flex justify-between items-center text-xs font-bold text-slate-700 dark:text-slate-300">
                  <span>🏛️ Sério & Corporativo</span>
                  <span>Descontraído & Pop 🎉</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={formState.personalityScaleSeriousPlayful}
                  onChange={(e) => updateField("personalityScaleSeriousPlayful", Number(e.target.value))}
                  className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
                <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                  <span>1</span>
                  <span>2</span>
                  <span>3</span>
                  <span>4</span>
                  <span>5</span>
                </div>
              </div>

              {/* Escala 2 */}
              <div className="space-y-2 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/30">
                <div className="flex justify-between items-center text-xs font-bold text-slate-700 dark:text-slate-300">
                  <span>👑 Luxo & Exclusivo</span>
                  <span>Acessível & Popular 🏷️</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={formState.personalityScaleLuxuryAccessible}
                  onChange={(e) => updateField("personalityScaleLuxuryAccessible", Number(e.target.value))}
                  className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
                <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                  <span>1</span>
                  <span>2</span>
                  <span>3</span>
                  <span>4</span>
                  <span>5</span>
                </div>
              </div>

              {/* Escala 3 */}
              <div className="space-y-2 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/30">
                <div className="flex justify-between items-center text-xs font-bold text-slate-700 dark:text-slate-300">
                  <span>🚀 Moderno & Tech</span>
                  <span>Tradicional & Raiz 📜</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={formState.personalityScaleModernTraditional}
                  onChange={(e) => updateField("personalityScaleModernTraditional", Number(e.target.value))}
                  className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
                <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                  <span>1</span>
                  <span>2</span>
                  <span>3</span>
                  <span>4</span>
                  <span>5</span>
                </div>
              </div>

              {/* Escala 4 */}
              <div className="space-y-2 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/30">
                <div className="flex justify-between items-center text-xs font-bold text-slate-700 dark:text-slate-300">
                  <span>🔬 Técnico & Especialista</span>
                  <span>Acolhedor & Humano ☕</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={formState.personalityScaleTechnicalWelcoming}
                  onChange={(e) => updateField("personalityScaleTechnicalWelcoming", Number(e.target.value))}
                  className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
                <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                  <span>1</span>
                  <span>2</span>
                  <span>3</span>
                  <span>4</span>
                  <span>5</span>
                </div>
              </div>
            </div>

            <div className="space-y-1.5 pt-2">
              <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Se a sua marca fosse uma pessoa, quem ela seria? (Arquétipo)
              </Label>
              <Input
                value={formState.brandArchetype}
                onChange={(e) => updateField("brandArchetype", e.target.value)}
                placeholder="Ex: Um médico especialista atencioso que explica tudo com calma / Um consultor dinâmico e direto ao ponto."
                className="h-10 text-xs border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
          </CardContent>
        )}
      </Card>

      {/* ─── BLOCO 3: LOGO ATUAL ─────────────────────────────────────────────── */}
      <Card className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl shadow-xs overflow-hidden">
        <CardHeader
          onClick={() => toggleSection("b3")}
          className="p-5 flex flex-row items-center justify-between cursor-pointer select-none bg-slate-50/60 dark:bg-slate-800/40 hover:bg-slate-100/60 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 flex items-center justify-center font-bold">
              <Image className="w-4 h-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold text-slate-900 dark:text-white">
                Bloco 3 · Logo Atual
              </CardTitle>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Status da marca, arquivos originais e diagnósticos.
              </p>
            </div>
          </div>
          {openSections.b3 ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
        </CardHeader>

        {openSections.b3 && (
          <CardContent className="p-6 space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Status da Logomarca
              </Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  { id: "intocavel", label: "🔒 Intocável", desc: "Não mexer no símbolo nem na tipografia da logo" },
                  { id: "ajustavel", label: "✨ Ajustável / Modernizar", desc: "Pode rejuvenescer cores e proporções" },
                  { id: "criar_do_zero", label: "🚀 Criar do Zero", desc: "Redesign completo da identidade" },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => updateField("logoStatus", opt.id as any)}
                    className={cn(
                      "p-3 rounded-xl border text-left transition-all",
                      formState.logoStatus === opt.id
                        ? "bg-purple-50 dark:bg-purple-950/40 border-purple-300 dark:border-purple-800 shadow-xs"
                        : "bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800"
                    )}
                  >
                    <p className="font-bold text-xs text-slate-800 dark:text-slate-200">{opt.label}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Link do Arquivo Original / Drive da Logo
              </Label>
              <Input
                value={formState.logoDriveUrl}
                onChange={(e) => updateField("logoDriveUrl", e.target.value)}
                placeholder="https://drive.google.com/..."
                className="h-10 text-xs border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  O que você MAIS gosta na sua logo ou identidade atual?
                </Label>
                <textarea
                  value={formState.logoLikes}
                  onChange={(e) => updateField("logoLikes", e.target.value)}
                  placeholder="Ex: O tom de azul marinho e a força do símbolo que já é conhecido."
                  className="w-full h-20 p-3 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl outline-none resize-none"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  O que você DESGOSTA ou acha ultrapassado?
                </Label>
                <textarea
                  value={formState.logoDislikes}
                  onChange={(e) => updateField("logoDislikes", e.target.value)}
                  placeholder="Ex: Os degradês antigos e a fonte muito fina que some no celular."
                  className="w-full h-20 p-3 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl outline-none resize-none"
                />
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ─── BLOCO 4: CORES ─────────────────────────────────────────────────── */}
      <Card className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl shadow-xs overflow-hidden">
        <CardHeader
          onClick={() => toggleSection("b4")}
          className="p-5 flex flex-row items-center justify-between cursor-pointer select-none bg-slate-50/60 dark:bg-slate-800/40 hover:bg-slate-100/60 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center justify-center font-bold">
              <Palette className="w-4 h-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold text-slate-900 dark:text-white">
                Bloco 4 · Cores & Cartelas Prontas
              </CardTitle>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Cores intocáveis, seleção de até 2 cartelas prontas e cores proibidas.
              </p>
            </div>
          </div>
          {openSections.b4 ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
        </CardHeader>

        {openSections.b4 && (
          <CardContent className="p-6 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Cores Intocáveis (obrigatórias)
                </Label>
                <Input
                  value={formState.untouchableColors}
                  onChange={(e) => updateField("untouchableColors", e.target.value)}
                  placeholder="Ex: #0D47A1 (Azul Marinho) / Laranja da fachada"
                  className="h-10 text-xs border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Cores Proibidas (que NUNCA devem aparecer nos posts)
                </Label>
                <Input
                  value={formState.forbiddenColors}
                  onChange={(e) => updateField("forbiddenColors", e.target.value)}
                  placeholder="Ex: Rosa choque, vermelho, amarelo neon"
                  className="h-10 text-xs border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            {/* Seleção de até 2 cartelas */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Selecione até 2 Cartelas de Referência para a IA
                </Label>
                <Badge variant="outline" className="text-[10px]">
                  {formState.selectedColorPalettes.length}/2 selecionadas
                </Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {colorPalettesOptions.map((palette) => {
                  const isSelected = formState.selectedColorPalettes.includes(palette.id);
                  return (
                    <button
                      key={palette.id}
                      type="button"
                      onClick={() => {
                        let list = [...formState.selectedColorPalettes];
                        if (list.includes(palette.id)) {
                          list = list.filter((p) => p !== palette.id);
                        } else if (list.length < 2) {
                          list.push(palette.id);
                        }
                        updateField("selectedColorPalettes", list);
                      }}
                      className={cn(
                        "p-3 rounded-xl border text-left transition-all",
                        isSelected
                          ? "bg-amber-50/50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700 shadow-xs ring-2 ring-amber-400/20"
                          : "bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 hover:border-slate-300"
                      )}
                    >
                      <p className="font-bold text-xs text-slate-900 dark:text-white">{palette.label}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{palette.desc}</p>
                      <div className="flex gap-1 mt-2.5">
                        {palette.colors.map((c, idx) => (
                          <div key={idx} className="w-5 h-5 rounded-md shadow-2xs border border-white/20" style={{ backgroundColor: c }} />
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Preferência de fundo */}
            <div className="space-y-2 pt-1">
              <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Preferência de Fundo para Artes e Vídeos
              </Label>
              <div className="flex gap-2">
                {[
                  { id: "claro", label: "☀️ Fundo Claro (Clean, Luminoso)" },
                  { id: "escuro", label: "🌙 Fundo Escuro (Dark, Sofisticado)" },
                  { id: "hibrido", label: "⚖️ Híbrido (Equilíbrio dos dois)" },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => updateField("backgroundPreference", f.id as any)}
                    className={cn(
                      "flex-1 text-xs font-semibold py-2 px-3 rounded-xl border transition-all",
                      formState.backgroundPreference === f.id
                        ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-xs"
                        : "bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400"
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ─── BLOCO 5: TIPOGRAFIA & ESTILO ────────────────────────────────────── */}
      <Card className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl shadow-xs overflow-hidden">
        <CardHeader
          onClick={() => toggleSection("b5")}
          className="p-5 flex flex-row items-center justify-between cursor-pointer select-none bg-slate-50/60 dark:bg-slate-800/40 hover:bg-slate-100/60 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-pink-500/10 text-pink-600 dark:text-pink-400 border border-pink-500/20 flex items-center justify-center font-bold">
              <Type className="w-4 h-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold text-slate-900 dark:text-white">
                Bloco 5 · Tipografia & Estilo Visual
              </CardTitle>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Famílias de fonte, estilo de composição e referências do Instagram.
              </p>
            </div>
          </div>
          {openSections.b5 ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
        </CardHeader>

        {openSections.b5 && (
          <CardContent className="p-6 space-y-5">
            {/* 4 Estilos de Fontes */}
            <div className="space-y-2">
              <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Selecione até 2 Estilos de Fontes Desejados
              </Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {fontStylesList.map((st) => {
                  const isSelected = formState.selectedFontStyles.includes(st.id);
                  return (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => {
                        let list = [...formState.selectedFontStyles];
                        if (list.includes(st.id)) list = list.filter((x) => x !== st.id);
                        else if (list.length < 2) list.push(st.id);
                        updateField("selectedFontStyles", list);
                      }}
                      className={cn(
                        "p-3 rounded-xl border text-left transition-all",
                        isSelected
                          ? "bg-pink-50 dark:bg-pink-950/40 border-pink-300 dark:border-pink-800 shadow-xs"
                          : "bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800"
                      )}
                    >
                      <p className="font-bold text-xs text-slate-900 dark:text-white">{st.label}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{st.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Estilo de Arte */}
            <div className="space-y-2">
              <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Estilo de Arte Preferido para Peças e Criativos
              </Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {[
                  { id: "minimalista", label: "Minimalista", desc: "Espaço em branco, poucos elementos, elegância" },
                  { id: "cheio_informativo", label: "Cheio / Informativo", desc: "Listas, dados, cards explicativos" },
                  { id: "foto_destaque", label: "Foto em Destaque", desc: "Imagens reais da equipe e produto em foco" },
                  { id: "ilustracao", label: "Ilustração & Ícones", desc: "Elementos gráficos e 3D estilizados" },
                ].map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => updateField("artStyle", a.id as any)}
                    className={cn(
                      "p-3 rounded-xl border text-left transition-all",
                      formState.artStyle === a.id
                        ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-xs"
                        : "bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400"
                    )}
                  >
                    <p className="font-bold text-xs">{a.label}</p>
                    <p className="text-[10px] opacity-75 mt-0.5">{a.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Inspirações Instagram */}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                3 Perfis de Inspiração no Instagram (@ da referência)
              </Label>
              <Input
                value={formState.instagramInspirationProfiles}
                onChange={(e) => updateField("instagramInspirationProfiles", e.target.value)}
                placeholder="Ex: @apple, @nubank, @lojadosonho"
                className="h-10 text-xs border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
          </CardContent>
        )}
      </Card>

      {/* ─── BLOCO 6: CONTEÚDO E USO ─────────────────────────────────────────── */}
      <Card className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl shadow-xs overflow-hidden">
        <CardHeader
          onClick={() => toggleSection("b6")}
          className="p-5 flex flex-row items-center justify-between cursor-pointer select-none bg-slate-50/60 dark:bg-slate-800/40 hover:bg-slate-100/60 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center justify-center font-bold">
              <FileCheck2 className="w-4 h-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold text-slate-900 dark:text-white">
                Bloco 6 · Conteúdo, Aplicação e Slogan
              </CardTitle>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Pontos de contato da marca e diretrizes de acervo visual.
              </p>
            </div>
          </div>
          {openSections.b6 ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
        </CardHeader>

        {openSections.b6 && (
          <CardContent className="p-6 space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Onde esta Identidade Visual será aplicada?
              </Label>
              <div className="flex flex-wrap gap-2">
                {appPlacesList.map((place) => {
                  const isSelected = formState.applicationPlaces.includes(place);
                  return (
                    <button
                      key={place}
                      type="button"
                      onClick={() => {
                        let list = [...formState.applicationPlaces];
                        if (list.includes(place)) list = list.filter((p) => p !== place);
                        else list.push(place);
                        updateField("applicationPlaces", list);
                      }}
                      className={cn(
                        "text-xs font-semibold px-3 py-1.5 rounded-xl border transition-all",
                        isSelected
                          ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                          : "bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300"
                      )}
                    >
                      {place}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Tipo de Acervo Visual
                </Label>
                <div className="flex gap-2">
                  {[
                    { id: "proprio", label: "📸 Fotos Próprias / Gravação" },
                    { id: "estoque", label: "🖼️ Imagens de Estoque" },
                    { id: "hibrido", label: "⚖️ Híbrido" },
                  ].map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => updateField("imageSourceType", s.id as any)}
                      className={cn(
                        "flex-1 text-xs font-semibold py-2 px-2.5 rounded-xl border transition-all",
                        formState.imageSourceType === s.id
                          ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                          : "bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400"
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Slogan ou Frase Institucional (opcional)
                </Label>
                <Input
                  value={formState.slogan}
                  onChange={(e) => updateField("slogan", e.target.value)}
                  placeholder="Ex: Seu sono de alta performance todos os dias."
                  className="h-10 text-xs border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ─── BLOCO 7: DECISÃO (A TRAVA ANTI-INDECISÃO) ───────────────────────── */}
      <Card className="border border-purple-300 dark:border-purple-800/60 bg-purple-50/30 dark:bg-purple-950/20 rounded-2xl shadow-xs overflow-hidden">
        <CardHeader
          onClick={() => toggleSection("b7")}
          className="p-5 flex flex-row items-center justify-between cursor-pointer select-none bg-purple-100/40 dark:bg-purple-900/20 hover:bg-purple-100/60 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-purple-600 text-white flex items-center justify-center font-bold">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                Bloco 7 · Decisão (A Trava Anti-Indecisão da Diretoria)
              </CardTitle>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Pacto de aprovação e cláusula de esteira militar.
              </p>
            </div>
          </div>
          {openSections.b7 ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
        </CardHeader>

        {openSections.b7 && (
          <CardContent className="p-6 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Nome do Responsável Único pela Palavra Final na Empresa do Cliente *
              </Label>
              <Input
                value={formState.finalDecisionMaker}
                onChange={(e) => updateField("finalDecisionMaker", e.target.value)}
                placeholder="Ex: Carlos Arantes (Diretor Geral)"
                className="h-10 text-xs border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
              <p className="text-[11px] text-slate-400">
                Apenas esta pessoa terá autoridade para aprovar os caminhos visuais, evitando comitês que travam o prazo da esteira.
              </p>
            </div>

            {/* Checkbox de Aceite Obrigatório */}
            <label className="flex items-start gap-3 p-4 rounded-xl border border-purple-200 dark:border-purple-800/50 bg-white dark:bg-slate-900 cursor-pointer shadow-2xs">
              <input
                type="checkbox"
                checked={formState.acceptedAntiIndecisionRule}
                onChange={(e) => updateField("acceptedAntiIndecisionRule", e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-purple-600 focus:ring-purple-500 h-4 w-4"
              />
              <div className="text-left space-y-0.5">
                <p className="text-xs font-bold text-slate-900 dark:text-white">
                  Declaro ciência da regra inegociável de produção da Geração Digital:
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  "Serão apresentados <strong>2 caminhos visuais completos (Caminho A e Caminho B)</strong>. A empresa escolherá 1 único caminho definitivo e terá direito a <strong>1 rodada consolidada de ajustes pontuais</strong> antes da liberação para produção dos vídeos e criativos."
                </p>
              </div>
            </label>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
