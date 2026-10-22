import React, { useState } from "react";
import {
  Sparkles,
  Copy,
  Check,
  Printer,
  Share2,
  Palette,
  Type,
  FileText,
  Volume2,
  ArrowLeft,
  Download,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";

export interface GeneratedBrandPathway {
  id: "caminho_a" | "caminho_b";
  title: string;
  conceptSentence: string;
  palette: {
    name: string;
    role: string; // "Principal", "Secundária", "Destaque / CTA", "Neutra 1", "Neutra 2"
    hex: string;
  }[];
  typography: {
    headingFont: string;
    headingSample: string;
    bodyFont: string;
    bodySample: string;
    googleFontsUrl: string;
  };
  rules: string[];
  toneOfVoice: string[];
}

export interface GeneratedBrandGuideResult {
  clientName: string;
  generatedAt: string;
  pathwayA: GeneratedBrandPathway;
  pathwayB: GeneratedBrandPathway;
}

interface BrandGuideViewProps {
  guide: GeneratedBrandGuideResult;
  onBackToWizard: () => void;
}

export function BrandGuideView({ guide, onBackToWizard }: BrandGuideViewProps) {
  const [selectedPathway, setSelectedPathway] = useState<"a" | "b">("a");
  const [copiedHex, setCopiedHex] = useState<string | null>(null);

  const activePathway = selectedPathway === "a" ? guide.pathwayA : guide.pathwayB;

  const handleCopyHex = (hex: string) => {
    navigator.clipboard.writeText(hex);
    setCopiedHex(hex);
    toast({
      title: "Cor copiada!",
      description: `${hex} copiado para a área de transferência.`,
    });
    setTimeout(() => setCopiedHex(null), 2000);
  };

  const handleCopySpecForSlack = () => {
    const p = activePathway;
    const text = `🎨 *GUIA DE MARCA · ${guide.clientName.toUpperCase()}*
*${p.title.toUpperCase()}*
> _"${p.conceptSentence}"_

*PALETA DE CORES:*
${p.palette.map((c) => `• *${c.role}*: ${c.hex} (${c.name})`).join("\n")}

*TIPOGRAFIA GOOGLE FONTS:*
• *Títulos*: ${p.typography.headingFont}
• *Textos*: ${p.typography.bodyFont}

*REGRAS DE APLICAÇÃO (DESIGN & VÍDEO):*
${p.rules.map((r) => `✓ ${r}`).join("\n")}

*TOM DE VOZ:*
${p.toneOfVoice.map((t) => `• ${t}`).join("\n")}`;

    navigator.clipboard.writeText(text);
    toast({
      title: "Especificação Copiada!",
      description: "Cole no canal do Slack da equipe de design e audiovisual.",
    });
  };

  return (
    <div className="space-y-6 animate-fade-in font-sans">
      {/* Barra de Ações Superiores */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onBackToWizard}
            className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 gap-1.5"
          >
            <ArrowLeft className="w-4 h-4" />
            Editar Questionário
          </Button>
          <div className="h-4 w-px bg-slate-200 dark:bg-slate-800" />
          <div>
            <h2 className="text-base font-black text-slate-900 dark:text-white">
              Guia de Marca de 1 Página · {guide.clientName}
            </h2>
            <p className="text-[11px] text-slate-400">
              Gerado com IA Gemini para a esteira de Design (Santana) e Vídeo (Eflen / Carlos)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleCopySpecForSlack}
            className="border-slate-200 dark:border-slate-800 text-xs font-bold gap-1.5 h-9"
          >
            <Share2 className="w-3.5 h-3.5 text-purple-600" />
            Copiar para Slack
          </Button>

          <Button
            type="button"
            onClick={() => window.print()}
            className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold gap-1.5 h-9 shadow-xs"
          >
            <Printer className="w-3.5 h-3.5" />
            Imprimir / Salvar PDF
          </Button>
        </div>
      </div>

      {/* Seletor de Caminho A vs Caminho B */}
      <div className="grid grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => setSelectedPathway("a")}
          className={`p-4 rounded-2xl border text-left transition-all ${
            selectedPathway === "a"
              ? "bg-purple-50/60 dark:bg-purple-950/30 border-purple-300 dark:border-purple-800 shadow-sm ring-2 ring-purple-400/20"
              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 opacity-70 hover:opacity-100"
          }`}
        >
          <div className="flex items-center justify-between">
            <Badge className="bg-purple-600 text-white font-bold text-[10px]">
              CAMINHO A
            </Badge>
            <span className="text-[11px] font-bold text-purple-600 dark:text-purple-400">
              Recomendado
            </span>
          </div>
          <p className="font-black text-sm text-slate-900 dark:text-white mt-1.5">
            {guide.pathwayA.title}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
            "{guide.pathwayA.conceptSentence}"
          </p>
        </button>

        <button
          type="button"
          onClick={() => setSelectedPathway("b")}
          className={`p-4 rounded-2xl border text-left transition-all ${
            selectedPathway === "b"
              ? "bg-indigo-50/60 dark:bg-indigo-950/30 border-indigo-300 dark:border-indigo-800 shadow-sm ring-2 ring-indigo-400/20"
              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 opacity-70 hover:opacity-100"
          }`}
        >
          <div className="flex items-center justify-between">
            <Badge className="bg-indigo-600 text-white font-bold text-[10px]">
              CAMINHO B
            </Badge>
            <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400">
              Alternativo
            </span>
          </div>
          <p className="font-black text-sm text-slate-900 dark:text-white mt-1.5">
            {guide.pathwayB.title}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
            "{guide.pathwayB.conceptSentence}"
          </p>
        </button>
      </div>

      {/* ─── O GUIA DE MARCA DE 1 PÁGINA (DETALHADO) ─────────────────────────── */}
      <div className="space-y-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 md:p-8 shadow-xs">
        {/* Conceito Central */}
        <div className="p-5 rounded-2xl bg-gradient-to-r from-purple-500/10 via-indigo-500/10 to-transparent border border-purple-200/50 dark:border-purple-800/30">
          <Badge className="bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 text-[10px] font-bold mb-2">
            CONCEITO DA MARCA ({activePathway.title.toUpperCase()})
          </Badge>
          <p className="text-base md:text-lg font-bold text-slate-900 dark:text-white leading-relaxed">
            "{activePathway.conceptSentence}"
          </p>
        </div>

        {/* 1. Paleta de Cores (5 Cores Oficiais em HEX) */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Palette className="w-4 h-4 text-purple-600" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Paleta Oficial de 5 Cores (Clique para copiar HEX)
            </h3>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {activePathway.palette.map((c, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleCopyHex(c.hex)}
                className="group p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 text-left hover:scale-[1.02] active:scale-[0.98] transition-all shadow-2xs"
              >
                <div
                  className="w-full h-16 rounded-xl shadow-inner mb-2.5 relative flex items-center justify-center border border-black/10"
                  style={{ backgroundColor: c.hex }}
                >
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 text-white font-mono text-[10px] px-2 py-0.5 rounded-md">
                    {copiedHex === c.hex ? "Copiado!" : "Copiar"}
                  </span>
                </div>
                <p className="text-[10px] font-bold uppercase text-purple-600 dark:text-purple-400">
                  {c.role}
                </p>
                <p className="text-xs font-bold text-slate-900 dark:text-white mt-0.5">{c.name}</p>
                <p className="text-[11px] font-mono text-slate-400 mt-0.5 flex items-center justify-between">
                  <span>{c.hex}</span>
                  {copiedHex === c.hex ? (
                    <Check className="w-3 h-3 text-emerald-500" />
                  ) : (
                    <Copy className="w-3 h-3 opacity-40 group-hover:opacity-100" />
                  )}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* 2. Tipografia Oficial (Google Fonts) */}
        <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Type className="w-4 h-4 text-indigo-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Tipografia Oficial (Google Fonts)
              </h3>
            </div>
            <a
              href={activePathway.typography.googleFontsUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-bold"
            >
              Baixar Fontes no Google Fonts →
            </a>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 space-y-1">
              <p className="text-[10px] font-bold uppercase text-slate-400">
                Fonte de Títulos & Destaques
              </p>
              <p className="text-lg font-black text-slate-900 dark:text-white">
                {activePathway.typography.headingFont}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-300 italic pt-1">
                "{activePathway.typography.headingSample}"
              </p>
            </div>

            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 space-y-1">
              <p className="text-[10px] font-bold uppercase text-slate-400">
                Fonte de Textos & Legendas
              </p>
              <p className="text-lg font-black text-slate-900 dark:text-white">
                {activePathway.typography.bodyFont}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed pt-1">
                "{activePathway.typography.bodySample}"
              </p>
            </div>
          </div>
        </div>

        {/* 3. Regras de Aplicação & Tom de Voz */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-slate-100 dark:border-slate-800">
          {/* Regras para Santana e Eflen */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-emerald-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Regras de Aplicação (Design & Audiovisual)
              </h3>
            </div>
            <ul className="space-y-2">
              {activePathway.rules.map((rule, idx) => (
                <li
                  key={idx}
                  className="text-xs text-slate-700 dark:text-slate-300 flex items-start gap-2 bg-slate-50 dark:bg-slate-950/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/80"
                >
                  <span className="text-emerald-500 font-bold">✓</span>
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Tom de Voz */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-amber-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Tom de Voz & Estilo de Comunicação
              </h3>
            </div>
            <ul className="space-y-2">
              {activePathway.toneOfVoice.map((tone, idx) => (
                <li
                  key={idx}
                  className="text-xs text-slate-700 dark:text-slate-300 flex items-start gap-2 bg-slate-50 dark:bg-slate-950/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/80"
                >
                  <span className="text-amber-500 font-bold">•</span>
                  <span>{tone}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
