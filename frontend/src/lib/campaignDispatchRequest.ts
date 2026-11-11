import type { CampaignDispatchOptions } from "@/hooks/useCampanhas";

type DispatchChipOption = { id: string; isDefault?: boolean };

/**
 * Fonte unica dos chips de envio: o que a tela pinta e o que o POST leva saem daqui.
 * Id que nao esta entre os chips da empresa e descartado; sem nenhum valido, vale o
 * chip padrao. Lista vazia so acontece quando a empresa nao tem chip na tela.
 */
export function resolveDispatchChipIds(
  options: Pick<CampaignDispatchOptions, "dispatchChipIds" | "evolutionInstanceId">,
  chips: DispatchChipOption[]
): string[] {
  const saved =
    Array.isArray(options.dispatchChipIds) && options.dispatchChipIds.length > 0
      ? options.dispatchChipIds
      : options.evolutionInstanceId
        ? [options.evolutionInstanceId]
        : [];
  const valid = [...new Set(saved)].filter((id) => chips.some((chip) => chip.id === id));
  if (valid.length > 0) return valid;

  const fallback = chips.find((chip) => chip.isDefault) || chips[0];
  return fallback ? [fallback.id] : [];
}

/** Opcoes com o singular derivado da lista: ele nunca tem valor proprio. */
export function withResolvedDispatchChips<T extends CampaignDispatchOptions>(options: T, chips: DispatchChipOption[]) {
  const dispatchChipIds = resolveDispatchChipIds(options, chips);
  return { ...options, dispatchChipIds, evolutionInstanceId: dispatchChipIds[0] ?? null };
}

export type DispatchRequestInput = {
  name: string;
  steps: unknown[];
  triggerType: string;
  scheduledAt: string | null;
  dispatchOptions: CampaignDispatchOptions;
  chips: DispatchChipOption[];
  limitPerRun?: number | null;
  offset?: number;
};

/** Corpo do POST /api/campaigns/:id/dispatches. */
export function buildDispatchRequestBody(input: DispatchRequestInput) {
  const dispatchOptions = withResolvedDispatchChips(input.dispatchOptions, input.chips);
  return {
    name: input.name,
    ...(input.limitPerRun ? { limitPerRun: input.limitPerRun } : {}),
    ...(input.offset !== undefined ? { offset: input.offset } : {}),
    steps: input.steps,
    triggerType: input.triggerType,
    status: input.triggerType === "draft" ? "draft" : undefined,
    scheduledAt: input.scheduledAt,
    evolutionInstanceId: dispatchOptions.evolutionInstanceId,
    dispatch_options: dispatchOptions,
  };
}
