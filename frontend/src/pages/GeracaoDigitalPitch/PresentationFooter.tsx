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
          <footer className="relative z-10 border-t border-white/5 bg-slate-950/60 backdrop-blur-md px-8 py-4 shrink-0 flex items-center justify-between">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "h-8 text-[11px] font-bold transition-all duration-200 border-white/10 hover:bg-white/5 bg-slate-900/60",
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
                    "h-2 w-8 rounded-full cursor-pointer transition-all duration-300",
                    activeSlide === num ? "bg-indigo-500" : "bg-white/10 hover:bg-white/20"
                  )}
                />
              ))}
            </div>

            <div className="flex gap-2">
              {activeSlide < 6 ? (
                <Button
                  size="sm"
                  className="h-8 bg-indigo-600 hover:bg-indigo-500 text-[11px] font-bold text-white px-5"
                  onClick={() => setActiveSlide(activeSlide + 1)}
                >
                  Próximo Slide
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="h-8 bg-emerald-600 hover:bg-emerald-500 text-[11px] font-bold text-white px-5"
                  onClick={onEndPresenting}
                >
                  Encerrar Reunião
                </Button>
              )}
            </div>
          </footer>
  );
}
