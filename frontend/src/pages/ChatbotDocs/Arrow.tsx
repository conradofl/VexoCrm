import { ArrowRight, ArrowDown } from "lucide-react";

// Extraído de src/pages/ChatbotDocs.tsx (Onda 4 Run F8) — movimento puro, sem alteração de forma.

export function Arrow({ label, direction = "down" }: { label?: string; direction?: "down" | "right" }) {
  if (direction === "right") {
    return (
      <div className="flex items-center gap-1 text-slate-400">
        <ArrowRight className="h-4 w-4" />
        {label && <span className="text-[11px]">{label}</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-0.5 text-slate-400">
      <ArrowDown className="h-4 w-4" />
      {label && <span className="text-[10px]">{label}</span>}
    </div>
  );
}
