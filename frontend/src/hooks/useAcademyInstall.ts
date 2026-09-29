// frontend/src/hooks/useAcademyInstall.ts
//
// Vexo Academy — instalar usa os endpoints que já existem (followup
// companies/campaigns/templates), com três regras: nunca liga nada sozinho
// (o backend já cria campaign com status "draft" — não tem flag pra mudar
// isso aqui, de propósito), nunca sobrescreve (nome repetido ganha sufixo),
// e quem chama precisa já ter resolvido companyId — "pede o que falta" é
// escolher o agente, e isso é responsabilidade de quem usa este hook (a
// tela), não deste hook.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";
import type { AcademyRecipe } from "@/data/academyRecipes";

export interface AcademyInstallResult {
  campaignId: string;
  campaignName: string;
  /** true quando o nome já existia e ganhou sufixo — a tela usa isso pra avisar. */
  renamed: boolean;
}

export function useInstallAcademyRecipe() {
  const { getIdToken } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      recipe,
      companyId,
      clientId,
      stepDates,
    }: {
      recipe: AcademyRecipe;
      companyId: string;
      clientId: string;
      stepDates?: Record<number, string>;
    }): Promise<AcademyInstallResult> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");
      const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

      // Nunca sobrescreve — olha os nomes já existentes NESTE agente antes
      // de criar. Nome repetido ganha sufixo " (2)", " (3)"...
      const existingRes = await fetchApi(`/api/followup/campaigns?companyId=${encodeURIComponent(companyId)}`, {
        headers: authHeaders,
      });
      if (!existingRes.ok) {
        throw new Error(await readApiErrorMessage(existingRes, "Erro ao verificar cadências existentes"));
      }
      const existing = await readApiJson<{ campaigns: { name: string }[] }>(existingRes, "fup-campaigns");
      const existingNames = new Set((existing.campaigns || []).map((c) => c.name));

      let finalName = recipe.cadenceName;
      const renamed = existingNames.has(finalName);
      let suffix = 1;
      while (existingNames.has(finalName)) {
        suffix += 1;
        finalName = `${recipe.cadenceName} (${suffix})`;
      }

      // Cria a cadência. O backend grava status "draft" incondicionalmente
      // — não existe campo aqui pra pedir "ativado", de propósito: nunca
      // liga nada sozinho.
      const createRes = await fetchApi("/api/followup/campaigns", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          company_id: companyId,
          name: finalName,
          description: recipe.cadenceDescription,
        }),
      });
      if (!createRes.ok) {
        throw new Error(await readApiErrorMessage(createRes, "Erro ao criar cadência"));
      }
      const created = await readApiJson<{ campaign: { id: string } }>(createRes, "fup-campaign-create");
      const campaignId = created.campaign.id;

      // O conteúdo de verdade da receita — as mensagens, na ordem declarada.
      for (let i = 0; i < recipe.templates.length; i += 1) {
        const tpl = recipe.templates[i];
        const finalScheduledDate = stepDates?.[i] || tpl.scheduled_date;
        const templateRes = await fetchApi("/api/followup/templates", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            campaign_id: campaignId,
            name: tpl.label,
            message: tpl.message,
            trigger_type: tpl.trigger_type,
            trigger_value: tpl.trigger_value,
            trigger_unit: tpl.trigger_unit,
            trigger_direction: tpl.trigger_direction,
            anchor_field: tpl.anchor_field,
            scheduled_time: tpl.scheduled_time,
            scheduled_date: finalScheduledDate,
            order_index: i,
          }),
        });
        if (!templateRes.ok) {
          throw new Error(await readApiErrorMessage(templateRes, `Erro ao criar a mensagem "${tpl.label}"`));
        }
      }

      // Medição — best-effort, não pode derrubar uma instalação que já deu certo.
      await fetchApi("/api/academy/recipe-usage", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ clientId, recipeId: recipe.id, action: "installed" }),
      }).catch(() => {});

      return { campaignId, campaignName: finalName, renamed };
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["fup-campaigns", vars.companyId] });
    },
  });
}
