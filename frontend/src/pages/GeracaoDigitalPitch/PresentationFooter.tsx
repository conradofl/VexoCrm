import type { Dispatch, SetStateAction } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Extraído de src/pages/GeracaoDigitalPitch.tsx (Onda 4 Run F5) — footer navegador de slides, movimento puro.
interface PresentationFooterProps {
  activeSlide: number;
  setActiveSlide: Dispatch<SetStateAction<number>>;
  onEndPresenting: () => void;
}

export function PresentationFooter({ activeSlide, setActiveSlide, onEndPresenting }: PresentationFooterProps) {
  return (
          <footer className="relative z-10 border-t border-slate-200 bg-white/80 backdrop-blur-md px-8 py-4 shrink-0 flex items-center justify-between shadow-[0_-2px_10px_rgba(0,0,0,0.02)]">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "h-10 px-4 text-xs font-bold transition-all duration-200 border-slate-200 hover:bg-slate-50 bg-white text-slate-600 shadow-sm",
                  activeSlide === 1 && "opacity-30 cursor-not-allowed"
                )}
                disabled={activeSlide === 1}
                onClick={() => setActiveSlide(activeSlide - 1)}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Slide Anterior
              </Button>
            </div>

            {/* Slide Index dots */}
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5, 6].map((num) => (
                <div
                  key={num}
                  onClick={() => setActiveSlide(num)}
                  className={cn(
                    "h-2 w-10 rounded-full cursor-pointer transition-all duration-300",
                    activeSlide === num ? "bg-indigo-600" : "bg-slate-200 hover:bg-slate-300"
                  )}
                />
              ))}
            </div>

            <div className="flex gap-2">
              {activeSlide < 6 ? (
                <Button
                  size="sm"
                  className="h-10 bg-indigo-600 hover:bg-indigo-700 text-xs font-bold text-white px-6 shadow-md"
                  onClick={() => setActiveSlide(activeSlide + 1)}
                >
                  Próximo Slide
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="h-10 bg-emerald-600 hover:bg-emerald-700 text-xs font-bold text-white px-6 shadow-md"
                  onClick={onEndPresenting}
                >
                  Encerrar Reunião
                </Button>
              )}
            </div>
          </footer>
  );
}
