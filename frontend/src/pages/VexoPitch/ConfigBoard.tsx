import type { Dispatch, SetStateAction, ChangeEvent } from "react";
import { Bot, Calculator, Maximize2, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { SEGMENTS, type SegmentScenario } from "@/pages/demoSegments";

// Extraído de src/pages/VexoPitch.tsx (Onda 4 Run F9) — board de configuração exibido fora do modo apresentação, movimento puro.
interface ConfigBoardProps {
  selectedSegmentKey: string;
  setSelectedSegmentKey: Dispatch<SetStateAction<string>>;
  segment: SegmentScenario;
  prospectName: string;
  setProspectName: Dispatch<SetStateAction<string>>;
  prospectLogo: string | null;
  setProspectLogo: Dispatch<SetStateAction<string | null>>;
  handleLogoUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  leadsCount: number;
  setLeadsCount: Dispatch<SetStateAction<number>>;
  customTicket: number;
  setCustomTicket: Dispatch<SetStateAction<number>>;
  customConv: number;
  setCustomConv: Dispatch<SetStateAction<number>>;
  additionalRevenue: number;
  onStartPresentation: () => void;
}

export function ConfigBoard({
  selectedSegmentKey,
  setSelectedSegmentKey,
  segment,
  prospectName,
  setProspectName,
  prospectLogo,
  setProspectLogo,
  handleLogoUpload,
  leadsCount,
  setLeadsCount,
  customTicket,
  setCustomTicket,
  customConv,
  setCustomConv,
  additionalRevenue,
  onStartPresentation,
}: ConfigBoardProps) {
  return (
      <div className="space-y-6">

        {/* Painel Normal de Configurações do Prospect */}
        <Card className="border-slate-200/80 bg-white/80 dark:border-white/10 dark:bg-slate-900/40 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4">
            <Button
              onClick={onStartPresentation}
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
                    placeholder="0"
                    value={customTicket || ""}
                    onChange={(e) => setCustomTicket(e.target.value === "" ? 0 : Number(e.target.value))}
                    className="h-8.5 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-slate-400 font-mono">Conversão Atual (%)</Label>
                  <Input
                    type="number"
                    step="0.5"
                    placeholder="0"
                    value={customConv || ""}
                    onChange={(e) => setCustomConv(e.target.value === "" ? 0 : Number(e.target.value))}
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
  );
}
