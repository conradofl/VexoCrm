import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthedPost } from "@/hooks/useLeadMassDelete";
import type { OriginFixPreview, OriginFixReport } from "@/lib/leadOriginFix";

/** 409: a base mudou entre a prévia e a confirmação. Nada foi alterado. */
export class OriginFixMismatchError extends Error {
  expected: number;
  actual: number;
  constructor(message: string, expected: number, actual: number) {
    super(message);
    this.name = "OriginFixMismatchError";
    this.expected = expected;
    this.actual = actual;
  }
}

async function parseError(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  const message = body?.error?.message || fallback;
  if (res.status === 409 && body?.error?.code === "ORIGIN_FIX_COUNT_MISMATCH") {
    return new OriginFixMismatchError(message, Number(body.error.details?.expected), Number(body.error.details?.actual));
  }
  return new Error(message);
}

/** Prévia: só leitura. Nunca guardada em cache — o número tem que ser o de agora. */
export function useOriginFixPreview(clientId: string, enabled: boolean) {
  const post = useAuthedPost();
  return useQuery({
    queryKey: ["lead-origin-fix-preview", clientId],
    enabled: enabled && !!clientId,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    queryFn: async (): Promise<OriginFixPreview> => {
      const res = await post("/api/leads/origin-fix/preview", { clientId });
      if (!res.ok) throw await parseError(res, "Não foi possível calcular a prévia.");
      return (await res.json()).preview;
    },
  });
}

export function useExecuteOriginFix() {
  const post = useAuthedPost();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; expectedCount: number; confirmation?: string }): Promise<OriginFixReport> => {
      const res = await post("/api/leads/origin-fix/execute", input);
      if (!res.ok) throw await parseError(res, "A correção falhou e nada foi alterado.");
      return (await res.json()).report;
    },
    onSettled: (_data, _err, vars) => {
      queryClient.invalidateQueries({ queryKey: ["leads", vars.clientId] });
      queryClient.invalidateQueries({ queryKey: ["lead-mass-delete-tags", vars.clientId] });
    },
  });
}
