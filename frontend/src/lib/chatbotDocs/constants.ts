import { Flame, Thermometer, Snowflake } from "lucide-react";

// Extraído de src/pages/ChatbotDocs.tsx (Onda 4 Run F8) — movimento puro, sem alteração de forma.

export const SPIN_STEPS = [
  { id: "situation_interest", label: "Interesse", fase: "Situação", pergunta: "Você tem interesse em adquirir um imóvel?" },
  { id: "situation_objective", label: "Objetivo", fase: "Situação", pergunta: "Qual o objetivo: moradia ou investimento?" },
  { id: "situation_state", label: "Estado", fase: "Situação", pergunta: "Em qual estado deseja o imóvel?" },
  { id: "situation_city", label: "Cidade", fase: "Situação", pergunta: "Em qual cidade?" },
  { id: "problem_credit", label: "Crédito", fase: "Problema", pergunta: "Como está seu crédito? (Excelente/Bom/Regular/Ruim)" },
  { id: "implication_parcels", label: "Parcelas", fase: "Implicação", pergunta: "Qual valor de parcela cabe no seu bolso?" },
  { id: "implication_timeline", label: "Prazo", fase: "Implicação", pergunta: "Em quanto tempo precisa do imóvel?" },
  { id: "implication_fgts", label: "FGTS", fase: "Implicação", pergunta: "Possui FGTS disponível?" },
  { id: "necessity_best_time", label: "Horário", fase: "Necessidade", pergunta: "Qual o melhor horário para um consultor ligar?" },
];

export const FASE_COLORS: Record<string, string> = {
  Situação: "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/30",
  Problema: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30",
  Implicação: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-500/30",
  Necessidade: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30",
};

export const TRIGGER_MODE_LABELS: Record<string, string> = {
  immediate: "Imediato",
  after_reply: "Após resposta",
};

export const TEMP_CONFIG = {
  QUENTE: { label: "Quente", color: "text-red-600 dark:text-red-400", bg: "bg-red-100 dark:bg-red-900/30", icon: Flame },
  MORNO: { label: "Morno", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-100 dark:bg-amber-900/30", icon: Thermometer },
  FRIO: { label: "Frio", color: "text-sky-600 dark:text-sky-400", bg: "bg-sky-100 dark:bg-sky-900/30", icon: Snowflake },
} as const;
