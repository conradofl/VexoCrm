import { Sliders, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CustomTheme } from "@/lib/geracaoDigital/types";

// Extraído de src/pages/GeracaoDigitalPitch.tsx (Onda 4 Run F5) — header do modo apresentação, movimento puro.
interface PresentationHeaderProps {
  theme: CustomTheme;
  onOpenCustomizer: () => void;
  onClosePresenting: () => void;
}

export function PresentationHeader({ theme, onOpenCustomizer, onClosePresenting }: PresentationHeaderProps) {
  return (
          <header className="relative z-10 border-b border-white/5 bg-slate-950/60 backdrop-blur-md px-8 py-4 shrink-0 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Interactive Initials Avatar or uploaded Logo */}
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-600 to-cyan-500 p-px flex items-center justify-center font-bold text-sm tracking-tight text-white shadow-lg shadow-indigo-500/20">
                <div className="h-full w-full bg-slate-950 rounded-[11px] flex items-center justify-center">
                  {theme.agencyName.substring(0, 2).toUpperCase()}
                </div>
              </div>
              <div>
                <span className="text-sm font-black text-white tracking-tight uppercase">{theme.agencyName}</span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] text-slate-400 font-medium">Briefing Comercial · {theme.prospectName}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenCustomizer}
                className="h-8 text-[11px] font-bold border-white/10 hover:bg-white/5 bg-slate-900/60 text-slate-300"
              >
                <Sliders className="h-3.5 w-3.5 mr-1.5 text-indigo-400" />
                Painel Customizador
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onClosePresenting}
                className="h-8 text-[11px] font-bold border-white/10 hover:bg-white/5 bg-slate-900/60 text-red-400 hover:text-red-300"
              >
                <X className="h-3.5 w-3.5 mr-1.5" />
                Fechar Pitch
              </Button>
            </div>
          </header>
  );
}
