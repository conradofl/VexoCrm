// Extraído de src/pages/ChatbotDocs.tsx (Onda 4 Run F8) — movimento puro, sem alteração de forma.

export function FlowNode({
  label,
  sublabel,
  variant = "default",
  icon: Icon,
}: {
  label: string;
  sublabel?: string;
  variant?: "default" | "decision" | "action" | "end" | "start";
  icon?: React.ElementType;
}) {
  const base =
    "flex flex-col items-center justify-center gap-1 rounded-xl border px-4 py-3 text-center text-sm font-medium shadow-sm min-w-[120px]";
  const variants: Record<string, string> = {
    default:
      "border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200",
    decision:
      "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300",
    action:
      "border-cyan-300 bg-cyan-50 text-cyan-800 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-300",
    end: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300",
    start:
      "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300",
  };

  return (
    <div className={`${base} ${variants[variant]}`}>
      {Icon && <Icon className="h-4 w-4 opacity-70" />}
      <span>{label}</span>
      {sublabel && <span className="text-[10px] font-normal opacity-60">{sublabel}</span>}
    </div>
  );
}
