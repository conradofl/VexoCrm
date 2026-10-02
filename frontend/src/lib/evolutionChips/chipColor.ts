/**
 * Reexportação retrocompatível a partir de @/lib/stableColor.
 * A função de cor agora reside em local neutro para uso compartilhado por chips,
 * campanhas, fila de envio e planilhas salvas.
 */
export {
  getStableColor as getChipColor,
  getStableColor,
  getEntityColor,
  STABLE_COLOR_PALETTE as CHIP_COLOR_PALETTE,
  STABLE_COLOR_PALETTE,
  hashIdentifier as hashChipIdentifier,
  hashIdentifier,
  type StableColor as ChipColor,
  type StableColor,
} from "@/lib/stableColor";
