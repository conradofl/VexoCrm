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
          <header className="relative z-10 border-b border-slate-200 bg-white/80 backdrop-blur-md px-8 py-4 shrink-0 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-3">
              {/* Interactive Initials Avatar or uploaded Logo */}
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-600 to-cyan-500 p-px flex items-center justify-center font-bold text-sm tracking-tight text-white shadow-md">
                <div className="h-full w-full bg-white rounded-[11px] flex items-center justify-center text-indigo-700">
                  {theme.agencyName.substring(0, 2).toUpperCase()}
                </div>
              </div>
              <div>
                <span className="text-base font-black text-slate-900 tracking-tight uppercase">{theme.agencyName}</span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs text-slate-500 font-medium">Briefing Comercial · {theme.prospectName}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenCustomizer}
                className="h-9 px-4 text-xs font-bold border-slate-200 hover:bg-slate-50 bg-white text-slate-600 shadow-sm"
              >
                <Sliders className="h-4 w-4 mr-2 text-indigo-500" />
                Painel Customizador
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onClosePresenting}
                className="h-9 px-4 text-xs font-bold border-slate-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200 bg-white text-slate-600 shadow-sm transition-colors"
              >
                <X className="h-4 w-4 mr-2" />
                Fechar Pitch
              </Button>
            </div>
          </header>
  );
}
