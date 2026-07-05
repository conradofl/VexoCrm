import type { ChangeEvent } from "react";
import { Palette, X, Building2, Upload, Trash2, Save, Undo2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ACCENT_PRESETS } from "@/lib/geracaoDigital/constants";
import { DEFAULT_THEME } from "@/lib/geracaoDigital/defaults";
import type { CustomTheme } from "@/lib/geracaoDigital/types";

// Extraído de src/pages/GeracaoDigitalPitch.tsx (Onda 4 Run F5) — drawer customizador de marca (white-label), movimento puro.
interface ThemeCustomizerDrawerProps {
  theme: CustomTheme;
  setTheme: (theme: CustomTheme) => void;
  handleLogoUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  handleSaveTheme: (theme: CustomTheme) => void;
  onClose: () => void;
}

export function ThemeCustomizerDrawer({ theme, setTheme, handleLogoUpload, handleSaveTheme, onClose }: ThemeCustomizerDrawerProps) {
  return (
        <div className="fixed inset-y-0 right-0 z-50 w-80 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-white/10 shadow-2xl p-6 flex flex-col justify-between text-slate-900 dark:text-white font-sans animate-fade-in-up">
          <div className="space-y-6">
            
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/5 pb-4">
              <div className="flex items-center gap-2">
                <Palette className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                <h3 className="text-sm font-black uppercase text-slate-900 dark:text-white">Personalizar Marca</h3>
              </div>
              <button 
                onClick={onClose}
                className="text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs overflow-y-auto max-h-[70vh] pr-1">
              
              {/* Agency Settings */}
              <div className="space-y-3">
                <span className="font-bold text-[9px] uppercase tracking-widest text-slate-500 dark:text-slate-400 font-mono">Agência (White-Label)</span>
                
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-slate-500 uppercase font-bold">Nome da Agência</Label>
                  <Input
                    value={theme.agencyName}
                    onChange={(e) => setTheme({ ...theme, agencyName: e.target.value })}
                    className="h-8 border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/60 focus:border-indigo-500/50 text-slate-900 dark:text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] text-slate-500 uppercase font-bold">Subtítulo da Agência</Label>
                  <Input
                    value={theme.agencySubtitle}
                    onChange={(e) => setTheme({ ...theme, agencySubtitle: e.target.value })}
                    className="h-8 border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/60 focus:border-indigo-500/50 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              {/* Accent Color Preset Selector */}
              <div className="space-y-3">
                <span className="font-bold text-[9px] uppercase tracking-widest text-slate-500 dark:text-slate-400 font-mono">Tema de Cores</span>
                <div className="grid grid-cols-5 gap-2">
                  {Object.entries(ACCENT_PRESETS).map(([key, value]) => (
                    <button
                      key={key}
                      onClick={() => setTheme({ ...theme, themePreset: key as any })}
                      style={{ backgroundColor: value.colorHex }}
                      className={cn(
                        "h-8 rounded-lg relative hover:scale-105 transition-transform",
                        theme.themePreset === key && "ring-2 ring-indigo-500 dark:ring-white ring-offset-2 ring-offset-white dark:ring-offset-slate-950"
                      )}
                    />
                  ))}
                </div>
              </div>

              {/* Client Settings */}
              <div className="space-y-3">
                <span className="font-bold text-[9px] uppercase tracking-widest text-slate-500 dark:text-slate-400 font-mono">Cliente Ativo</span>
                
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-slate-500 uppercase font-bold">Nome do Prospect</Label>
                  <Input
                    value={theme.prospectName}
                    onChange={(e) => setTheme({ ...theme, prospectName: e.target.value })}
                    className="h-8 border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/60 focus:border-indigo-500/50 text-slate-900 dark:text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] text-slate-500 uppercase font-bold">Logomarca do Prospect (PNG/JPG)</Label>
                  <div className="flex items-center gap-2">
                    {theme.prospectLogoUrl ? (
                      <div className="relative h-8 w-8 rounded border border-slate-200 dark:border-white/10 overflow-hidden bg-white dark:bg-slate-950 flex items-center justify-center shrink-0">
                        <img src={theme.prospectLogoUrl} alt="Logo Prospect" className="h-full w-full object-contain" />
                        <button
                          onClick={() => setTheme({ ...theme, prospectLogoUrl: "" })}
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

            </div>

          </div>

          <div className="border-t border-slate-100 dark:border-white/5 pt-4 space-y-2">
            <Button
              onClick={() => handleSaveTheme(theme)}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold h-9 gap-1.5"
            >
              <Save className="h-4 w-4" />
              Aplicar e Salvar
            </Button>
            <Button
              variant="outline"
              onClick={() => handleSaveTheme(DEFAULT_THEME)}
              className="w-full border-slate-200 dark:border-white/5 bg-transparent text-xs hover:bg-slate-100 dark:hover:bg-white/5 text-slate-500 dark:text-slate-400"
            >
              <Undo2 className="h-4 w-4 mr-1.5" />
              Restaurar Padrão
            </Button>
          </div>

        </div>
  );
}
