import type { Dispatch, SetStateAction, ChangeEvent } from "react";
import { Sparkles, Maximize2, Building2, Upload, Award, Terminal, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CustomTheme } from "@/lib/geracaoDigital/types";

// Extraído de src/pages/GeracaoDigitalPitch.tsx (Onda 4 Run F5) — board de configuração exibido fora do modo apresentação, movimento puro.
interface ConfigBoardProps {
  theme: CustomTheme;
  setTheme: Dispatch<SetStateAction<CustomTheme>>;
  handleLogoUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  onStartPresenting: () => void;
  onOpenCustomizer: () => void;
}

export function ConfigBoard({ theme, setTheme, handleLogoUpload, onStartPresenting, onOpenCustomizer }: ConfigBoardProps) {
  return (
        <div className="space-y-6 animate-fade-in-up">
          
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-slate-50 dark:bg-white/[0.02] p-5 rounded-2xl border border-slate-200 dark:border-white/10 relative overflow-hidden">
            <div className="absolute top-0 left-0 h-1 w-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-purple-500" />
            <div className="space-y-1">
              <h2 className="text-xl font-bold flex items-center gap-2 text-slate-900 dark:text-white">
                <Sparkles className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                Módulo Comercial da {theme.agencyName}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl">
                Ferramenta comercial completa para reuniões com clientes. Permite apresentar a estrutura da agência, coletar dados com IA em tempo real e white-labelizar a plataforma.
              </p>
            </div>
            
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={onStartPresenting}
                className="gap-2 bg-indigo-600 hover:bg-indigo-500 font-extrabold shadow-lg shadow-indigo-600/20 px-5 text-white"
              >
                <Maximize2 className="h-4 w-4" />
                Iniciar Apresentação (Tela Cheia)
              </Button>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Quick Setup Client Card */}
            <Card className="border-slate-200 dark:border-white/10 bg-white/40 dark:bg-white/[0.02] backdrop-blur-md relative overflow-hidden flex flex-col justify-between group hover:border-slate-300 dark:hover:border-white/20 transition-all duration-300">
              <div className="p-6 space-y-4">
                <div className="h-10 w-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Prospect Vinculado</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    Altere o nome e o logotipo do cliente em tempo real para apresentar uma página totalmente personalizada para ele.
                  </p>
                </div>
              </div>
              <div className="p-6 pt-0 space-y-3">
                <div className="space-y-1">
                  <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-mono uppercase font-bold">Nome do Prospect</Label>
                  <Input
                    value={theme.prospectName}
                    onChange={(e) => {
                      const updated = { ...theme, prospectName: e.target.value };
                      setTheme(updated);
                      localStorage.setItem("vexo_gd_theme", JSON.stringify(updated));
                    }}
                    className="h-8 text-xs border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/60 focus:border-indigo-500/50 text-slate-900 dark:text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-mono uppercase font-bold">Logomarca do Prospect (PNG/JPG)</Label>
                  <div className="flex items-center gap-2">
                    {theme.prospectLogoUrl ? (
                      <div className="relative h-8 w-8 rounded border border-slate-200 dark:border-white/10 overflow-hidden bg-white dark:bg-slate-950 flex items-center justify-center shrink-0">
                        <img src={theme.prospectLogoUrl} alt="Logo Prospect" className="h-full w-full object-contain" />
                        <button
                          onClick={() => {
                            const updated = { ...theme, prospectLogoUrl: "" };
                            setTheme(updated);
                            localStorage.setItem("vexo_gd_theme", JSON.stringify(updated));
                          }}
                          className="absolute inset-0 bg-red-600/80 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-white" />
                        </button>
                      </div>
                    ) : (
                      <div className="h-8 w-8 rounded border border-dashed border-slate-200 dark:border-white/20 flex items-center justify-center text-slate-500 shrink-0">
                        <Building2 className="h-3.5 w-3.5" />
                      </div>
                    )}
                    <label className="flex-1">
                      <div className="h-8 border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 rounded flex items-center justify-center text-[10px] font-bold text-slate-600 dark:text-slate-300 cursor-pointer gap-1 bg-slate-50 dark:bg-slate-950/60">
                        <Upload className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                        Selecionar Imagem
                      </div>
                      <input
                        type="file"
                        accept="image/png, image/jpeg, image/jpg"
                        onChange={handleLogoUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              </div>
            </Card>

            {/* Productization Info Card */}
            <Card className="border-slate-200 dark:border-white/10 bg-white/40 dark:bg-white/[0.02] backdrop-blur-md relative overflow-hidden flex flex-col justify-between group hover:border-slate-300 dark:hover:border-white/20 transition-all duration-300">
              <div className="p-6 space-y-4">
                <div className="h-10 w-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                  <Award className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">White-Label & Revenda</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    Esta ferramenta comercial pode ser duplicada e vendida para outras agências. Configure a logo da agência parceira no painel lateral.
                  </p>
                </div>
              </div>
              <div className="p-6 pt-0">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={onOpenCustomizer}
                  className="w-full text-xs font-bold border-indigo-500/20 bg-indigo-500/5 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/10 dark:hover:bg-indigo-500/10"
                >
                  Configurar White-Label
                </Button>
              </div>
            </Card>
          </div>

          {/* Quick instructions on how the slides work */}
          <div className="bg-slate-50 dark:bg-slate-950/40 p-6 rounded-2xl border border-slate-200 dark:border-white/5 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Terminal className="h-4.5 w-4.5 text-indigo-600 dark:text-indigo-400" />
              Estrutura do Deck de Apresentação (6 Slides)
            </h3>
            
            <div className="grid gap-4 md:grid-cols-3 text-xs">
              <div className="p-3 bg-white dark:bg-slate-900/30 rounded-xl border border-slate-200 dark:border-white/5 space-y-1">
                <span className="font-bold text-indigo-600 dark:text-indigo-400">Slide 1: Capa</span>
                <p className="text-slate-500 dark:text-slate-400 leading-relaxed">Institucional com animação futurista de partículas e saudações dinâmicas.</p>
              </div>
              <div className="p-3 bg-white dark:bg-slate-900/30 rounded-xl border border-slate-200 dark:border-white/5 space-y-1">
                <span className="font-bold text-indigo-600 dark:text-indigo-400">Slide 2: Escopo</span>
                <p className="text-slate-500 dark:text-slate-400 leading-relaxed">Delineia o processo de tráfego, design criativo e relatórios de ROI.</p>
              </div>
              <div className="p-3 bg-white dark:bg-slate-900/30 rounded-xl border border-slate-200 dark:border-white/5 space-y-1">
                <span className="font-bold text-indigo-600 dark:text-indigo-400">Slide 3: Organograma</span>
                <p className="text-slate-500 dark:text-slate-400 leading-relaxed">Diagrama interativo com neon conectivo das equipes de Caio, Humberto, Jheyson etc.</p>
              </div>
              <div className="p-3 bg-white dark:bg-slate-900/30 rounded-xl border border-slate-200 dark:border-white/5 space-y-1">
                <span className="font-bold text-indigo-600 dark:text-indigo-400">Slide 4: Cronograma</span>
                <p className="text-slate-500 dark:text-slate-400 leading-relaxed">Timeline visual de 4 semanas até o lançamento das campanhas.</p>
              </div>
              <div className="p-3 bg-white dark:bg-slate-900/30 rounded-xl border border-slate-200 dark:border-white/5 space-y-1">
                <span className="font-bold text-indigo-600 dark:text-indigo-400">Slide 5: Briefing com IA</span>
                <p className="text-slate-500 dark:text-slate-400 leading-relaxed">Formulário inteligente que preenche 14 dados analisando texto transcrito.</p>
              </div>
              <div className="p-3 bg-white dark:bg-slate-900/30 rounded-xl border border-slate-200 dark:border-white/5 space-y-1">
                <span className="font-bold text-indigo-600 dark:text-indigo-400">Slide 6: Ativação</span>
                <p className="text-slate-500 dark:text-slate-400 leading-relaxed">Envio automatizado do briefing qualificado para os setores responsáveis.</p>
              </div>
            </div>
          </div>
          
        </div>
  );
}
