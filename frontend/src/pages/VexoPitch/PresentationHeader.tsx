import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

// Extraído de src/pages/VexoPitch.tsx (Onda 4 Run F9) — header do modo apresentação, movimento puro.
interface PresentationHeaderProps {
  prospectName: string;
  prospectLogo: string | null;
  segmentName: string;
  onClosePresenting: () => void;
}

export function PresentationHeader({ prospectName, prospectLogo, segmentName, onClosePresenting }: PresentationHeaderProps) {
  return (
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
                <p className="text-[10px] text-indigo-400 font-mono tracking-wider uppercase">{segmentName}</p>
              </div>
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-slate-400 hover:text-white hover:bg-white/5 gap-1.5"
              onClick={onClosePresenting}
            >
              <X className="h-4 w-4" />
              Sair da Apresentação
            </Button>
          </header>
  );
}
