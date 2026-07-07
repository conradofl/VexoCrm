import { useState } from "react";
import { SPIN_STEPS, FASE_COLORS } from "@/lib/chatbotDocs/constants";

// Extraído de src/pages/ChatbotDocs.tsx (Onda 4 Run F8) — movimento puro, sem alteração de forma.

export function SpinFlowDiagram() {
  const [activeStep, setActiveStep] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 pb-2">
        {Object.entries(FASE_COLORS).map(([fase, cls]) => (
          <span key={fase} className={`rounded-full border px-3 py-1 text-xs font-semibold ${cls}`}>
            {fase}
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-0">
        {SPIN_STEPS.map((step, i) => (
          <div key={step.id} className="flex items-stretch gap-3">
            {/* Linha vertical */}
            <div className="flex flex-col items-center">
              <div
                className={`flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 text-xs font-bold transition-all ${
                  activeStep === step.id
                    ? "border-cyan-500 bg-cyan-500 text-white"
                    : "border-slate-300 bg-white text-slate-500 dark:border-white/20 dark:bg-white/5 dark:text-slate-400"
                }`}
                onClick={() => setActiveStep(activeStep === step.id ? null : step.id)}
              >
                {i + 1}
              </div>
              {i < SPIN_STEPS.length - 1 && (
                <div className="w-px flex-1 bg-slate-200 dark:bg-white/10" style={{ minHeight: 20 }} />
              )}
            </div>

            {/* Conteúdo */}
            <div
              className={`mb-2 flex-1 cursor-pointer rounded-xl border px-4 py-3 transition-all ${
                activeStep === step.id
                  ? "border-cyan-300 bg-cyan-50 dark:border-cyan-500/30 dark:bg-cyan-500/10"
                  : "border-slate-100 bg-white hover:border-slate-200 dark:border-white/8 dark:bg-white/[0.02]"
              }`}
              onClick={() => setActiveStep(activeStep === step.id ? null : step.id)}
            >
              <div className="flex items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${FASE_COLORS[step.fase]}`}>
                  {step.fase}
                </span>
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{step.label}</span>
                <span className="ml-auto font-mono text-[10px] text-slate-400">{step.id}</span>
              </div>
              {activeStep === step.id && (
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{step.pergunta}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
