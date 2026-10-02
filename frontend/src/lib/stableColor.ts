/**
 * Paleta estável e contrastante para identificação visual de entidades (chips, campanhas, planilhas).
 * As cores são derivadas deterministicamente do identificador (ID) para garantir que
 * a mesma entidade tenha sempre a mesma cor em qualquer tela e após recarregar.
 *
 * Funciona com contraste adequado nos modos claro e escuro, usando tokens
 * e classes do Tailwind que harmonizam com o tema do Vexo OS.
 */

export interface StableColor {
  key: string;
  name: string;
  dot: string;
  stripe: string;
  borderLeft: string;
  border: string;
  text: string;
  badge: string;
  hsl: {
    light: string;
    dark: string;
  };
}

export const STABLE_COLOR_PALETTE: readonly StableColor[] = [
  {
    key: "indigo",
    name: "Índigo",
    dot: "bg-indigo-500 dark:bg-indigo-400",
    stripe: "bg-indigo-500 dark:bg-indigo-400",
    borderLeft: "border-l-indigo-500 dark:border-l-indigo-400",
    border: "border-indigo-500/30 dark:border-indigo-400/30",
    text: "text-indigo-600 dark:text-indigo-400",
    badge: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800/60 dark:bg-indigo-950/40 dark:text-indigo-300",
    hsl: { light: "240 68% 58%", dark: "238 100% 79%" },
  },
  {
    key: "cyan",
    name: "Ciano",
    dot: "bg-cyan-500 dark:bg-cyan-400",
    stripe: "bg-cyan-500 dark:bg-cyan-400",
    borderLeft: "border-l-cyan-500 dark:border-l-cyan-400",
    border: "border-cyan-500/30 dark:border-cyan-400/30",
    text: "text-cyan-600 dark:text-cyan-400",
    badge: "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-800/60 dark:bg-cyan-950/40 dark:text-cyan-300",
    hsl: { light: "190 90% 45%", dark: "190 95% 65%" },
  },
  {
    key: "violet",
    name: "Violeta",
    dot: "bg-violet-500 dark:bg-violet-400",
    stripe: "bg-violet-500 dark:bg-violet-400",
    borderLeft: "border-l-violet-500 dark:border-l-violet-400",
    border: "border-violet-500/30 dark:border-violet-400/30",
    text: "text-violet-600 dark:text-violet-400",
    badge: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800/60 dark:bg-violet-950/40 dark:text-violet-300",
    hsl: { light: "262 83% 58%", dark: "263 70% 68%" },
  },
  {
    key: "amber",
    name: "Âmbar",
    dot: "bg-amber-500 dark:bg-amber-400",
    stripe: "bg-amber-500 dark:bg-amber-400",
    borderLeft: "border-l-amber-500 dark:border-l-amber-400",
    border: "border-amber-500/30 dark:border-amber-400/30",
    text: "text-amber-700 dark:text-amber-300",
    badge: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-300",
    hsl: { light: "38 92% 50%", dark: "43 96% 56%" },
  },
  {
    key: "teal",
    name: "Verde-azulado",
    dot: "bg-teal-500 dark:bg-teal-400",
    stripe: "bg-teal-500 dark:bg-teal-400",
    borderLeft: "border-l-teal-500 dark:border-l-teal-400",
    border: "border-teal-500/30 dark:border-teal-400/30",
    text: "text-teal-600 dark:text-teal-400",
    badge: "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800/60 dark:bg-teal-950/40 dark:text-teal-300",
    hsl: { light: "173 80% 40%", dark: "171 77% 64%" },
  },
  {
    key: "rose",
    name: "Rosa",
    dot: "bg-rose-500 dark:bg-rose-400",
    stripe: "bg-rose-500 dark:bg-rose-400",
    borderLeft: "border-l-rose-500 dark:border-l-rose-400",
    border: "border-rose-500/30 dark:border-rose-400/30",
    text: "text-rose-600 dark:text-rose-400",
    badge: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-300",
    hsl: { light: "349 89% 60%", dark: "351 95% 71%" },
  },
  {
    key: "sky",
    name: "Azul Céu",
    dot: "bg-sky-500 dark:bg-sky-400",
    stripe: "bg-sky-500 dark:bg-sky-400",
    borderLeft: "border-l-sky-500 dark:border-l-sky-400",
    border: "border-sky-500/30 dark:border-sky-400/30",
    text: "text-sky-600 dark:text-sky-400",
    badge: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800/60 dark:bg-sky-950/40 dark:text-sky-300",
    hsl: { light: "199 89% 48%", dark: "199 92% 65%" },
  },
  {
    key: "orange",
    name: "Laranja",
    dot: "bg-orange-500 dark:bg-orange-400",
    stripe: "bg-orange-500 dark:bg-orange-400",
    borderLeft: "border-l-orange-500 dark:border-l-orange-400",
    border: "border-orange-500/30 dark:border-orange-400/30",
    text: "text-orange-600 dark:text-orange-400",
    badge: "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-800/60 dark:bg-orange-950/40 dark:text-orange-300",
    hsl: { light: "24 95% 53%", dark: "27 96% 61%" },
  },
] as const;

/**
 * Função de hash determinística FNV-1a de 32 bits.
 * Garante excelente dispersão de identificadores curtos ou sequenciais.
 */
export function hashIdentifier(identifier: string): number {
  let hash = 2166136261;
  for (let i = 0; i < identifier.length; i++) {
    hash ^= identifier.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Retorna uma cor fixa e estável da paleta a partir do identificador informado.
 *
 * Características essenciais:
 * 1. Estável: duas chamadas com o mesmo identificador retornam sempre a mesma cor.
 * 2. Independente de ordem da lista: reordenar ou filtrar não altera as cores.
 * 3. Contraste nos modos claro e escuro: usa tokens derivados da paleta com suporte dark mode.
 * 4. Não substitui estado: a cor é meramente distintiva de identidade visual.
 */
export function getStableColor(identifier: string | null | undefined): StableColor {
  const cleanId = (identifier || "").trim();
  if (!cleanId) {
    return STABLE_COLOR_PALETTE[0];
  }
  const hash = hashIdentifier(cleanId);
  const index = hash % STABLE_COLOR_PALETTE.length;
  return STABLE_COLOR_PALETTE[index];
}

// Aliases para compatibilidade e semântica de chips
export const getChipColor = getStableColor;
export const getEntityColor = getStableColor;
export const hashChipIdentifier = hashIdentifier;
export const CHIP_COLOR_PALETTE = STABLE_COLOR_PALETTE;
export type ChipColor = StableColor;
