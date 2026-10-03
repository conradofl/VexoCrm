import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi } from "@/lib/api";
import type { MassDeleteOptions, MassDeletePreview, MassDeleteReport } from "@/lib/leadMassDelete";

export interface MassDeleteCriterion {
  type: "tag" | "import";
  value: string;
}

export interface MassDeleteTag {
  tag: string;
  leads: number;
}

/** 409: a base mudou entre a prévia e a confirmação. Nada foi apagado. */
export class MassDeleteMismatchError extends Error {
  expected: number;
  actual: number;
  constructor(message: string, expected: number, actual: number) {
    super(message);
    this.name = "MassDeleteMismatchError";
    this.expected = expected;
    this.actual = actual;
  }
}

async function parseError(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  const code = body?.error?.code;
  const message = body?.error?.message || fallback;
  if (res.status === 409 && code === "MASS_DELETE_COUNT_MISMATCH") {
    return new MassDeleteMismatchError(message, Number(body.error.details?.expected), Number(body.error.details?.actual));
  }
  return new Error(message);
}

export function useAuthedPost() {
  const { getIdToken } = useAuth();
  return async (path: string, body: unknown) => {
    const token = await getIdToken();
    if (!token) throw new Error("Usuário não autenticado.");
    return fetchApi(path, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  };
}

export function useMassDeleteTags(clientId: string, enabled: boolean) {
  const { getIdToken } = useAuth();
  return useQuery({
    queryKey: ["lead-mass-delete-tags", clientId],
    enabled: enabled && !!clientId,
    gcTime: 0,
    queryFn: async (): Promise<MassDeleteTag[]> => {
      const token = await getIdToken();
      const res = await fetchApi(`/api/leads/mass-delete/tags?clientId=${encodeURIComponent(clientId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw await parseError(res, "Não foi possível listar as tags.");
      return (await res.json()).tags;
    },
  });
}

/** Prévia: só leitura. Nunca guardada em cache — o número tem que ser o de agora. */
export function useMassDeletePreview(
  clientId: string,
  criterion: MassDeleteCriterion | null,
  options: MassDeleteOptions
) {
  const post = useAuthedPost();
  return useQuery({
    queryKey: ["lead-mass-delete-preview", clientId, criterion, options],
    enabled: !!clientId && !!criterion,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    queryFn: async (): Promise<MassDeletePreview> => {
      const res = await post("/api/leads/mass-delete/preview", { clientId, criterion, options });
      if (!res.ok) throw await parseError(res, "Não foi possível calcular a prévia.");
      return (await res.json()).preview;
    },
  });
}

export function useExportMassDelete() {
  const post = useAuthedPost();
  return useMutation({
    mutationFn: async (input: { clientId: string; criterion: MassDeleteCriterion; options: MassDeleteOptions }) => {
      const res = await post("/api/leads/mass-delete/export", input);
      if (!res.ok) throw await parseError(res, "Não foi possível exportar.");
      const count = Number(res.headers.get("X-Exported-Count") ?? 0);
      return { blob: await res.blob(), count };
    },
  });
}

export function useExecuteMassDelete() {
  const post = useAuthedPost();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      clientId: string;
      criterion: MassDeleteCriterion;
      options: MassDeleteOptions;
      expectedCount: number;
      confirmation?: string;
    }): Promise<MassDeleteReport> => {
      const res = await post("/api/leads/mass-delete/execute", input);
      if (!res.ok) throw await parseError(res, "A exclusão falhou e nada foi apagado.");
      return (await res.json()).report;
    },
    onSettled: (_data, _err, vars) => {
      queryClient.invalidateQueries({ queryKey: ["leads", vars.clientId] });
      queryClient.invalidateQueries({ queryKey: ["lead-mass-delete-tags", vars.clientId] });
    },
  });
}
