// frontend/src/hooks/useAcademy.ts
//
// Medição da Vexo Academy — sem isso não há como saber qual receita serve.

import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";

export type AcademyRecipeUsageAction = "opened" | "copied" | "installed";

export interface AcademyDiagnosticLine {
  id: string;
  text: string;
  recipeId: string;
}

// "O que falta neste tenant" — no máximo três linhas, lidas do estado real.
// Sem nada a apontar, a lista vem vazia e a faixa some.
export function useAcademyDiagnostics(clientId: string | null) {
  const { getIdToken } = useAuth();
  return useQuery({
    queryKey: ["academy-diagnostics", clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async (): Promise<AcademyDiagnosticLine[]> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");
      const res = await fetchApi(`/api/academy/diagnostics?clientId=${encodeURIComponent(clientId!)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao carregar diagnóstico"));
      const body = await readApiJson<{ lines: AcademyDiagnosticLine[] }>(res, "academy-diagnostics");
      return body.lines || [];
    },
  });
}

export function useLogAcademyRecipeUsage() {
  const { getIdToken } = useAuth();

  return useMutation({
    mutationFn: async ({
      clientId,
      recipeId,
      action,
    }: {
      clientId: string;
      recipeId: string;
      action: AcademyRecipeUsageAction;
    }) => {
      const token = await getIdToken();
      if (!token) return; // medição não pode travar a navegação por sessão instável
      await fetchApi("/api/academy/recipe-usage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ clientId, recipeId, action }),
      }).catch(() => {
        // medição é best-effort — falhar aqui nunca pode impedir a pessoa
        // de copiar o conteúdo ou instalar a receita
      });
    },
  });
}
