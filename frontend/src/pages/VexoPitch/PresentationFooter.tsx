import type { Dispatch, SetStateAction } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Extraído de src/pages/VexoPitch.tsx (Onda 4 Run F9) — footer navegador de slides, movimento puro.
interface PresentationFooterProps {
  activeSlide: number;
  setActiveSlide: Dispatch<SetStateAction<number>>;
  onEndPresenting: () => void;
}

export function PresentationFooter({ activeSlide, setActiveSlide, onEndPresenting }: PresentationFooterProps) {
  return (
          <footer className="relative z-10 shrink-0 border-t border-white/5 bg-slate-950/60 backdrop-blur-md px-8 py-5 flex items-center justify-between">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "h-9 text-xs font-bold transition-all duration-200",
                  activeSlide === 1
                    ? "border-white/5 bg-transparent text-white/20 cursor-not-allowed opacity-30"
                    : "border-white/20 text-white bg-slate-900/60 hover:bg-white/10 hover:text-white"
                )}
                disabled={activeSlide === 1}
                onClick={() => setActiveSlide(activeSlide - 1)}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Voltar Slide
              </Button>
            </div>

            {/* Indicadores de slides */}
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5, 6].map((slideNum) => (
                <div
                  key={slideNum}
                  onClick={() => setActiveSlide(slideNum)}
                  className={cn(
                    "h-2.5 w-10 rounded-full cursor-pointer transition-smooth",
                    activeSlide === slideNum ? "bg-indigo-500" : "bg-white/10 hover:bg-white/20"
                  )}
                />
              ))}
            </div>

            <div className="flex gap-2">
              {activeSlide < 6 ? (
                <Button
                  size="sm"
                  className="h-9 bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white px-5"
                  onClick={() => setActiveSlide(activeSlide + 1)}
                >
                  Avançar Slide
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="h-9 bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white px-5"
                  onClick={onEndPresenting}
                >
                  Encerrar Demonstração
                </Button>
              )}
            </div>
          </footer>
  );
}
