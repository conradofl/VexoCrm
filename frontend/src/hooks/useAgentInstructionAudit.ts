import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

export interface AgentInstructionField {
  name: string;
  label?: string;
  required: boolean;
}

export interface AgentInstructionConflict {
  field: string;
  emAgente: boolean;
  emTemplate: boolean;
  origemTemplate: string | null;
  motivo: string;
}

export interface AgentInstructionAudit {
  prompt: {
    source: "agente" | "tenant" | "nenhum";
    value: string | null;
    tenantPromptText: string | null;
  };
  collection: {
    agentFields: AgentInstructionField[];
    templateFields: AgentInstructionField[];
    templateKey: string | null;
    conflicts: AgentInstructionConflict[];
  };
  model: {
    source: "agente" | "padrão do sistema";
    value: string | null;
  };
}

export interface AgentInstructionAuditResponse {
  agentId: string;
  templateKeyEmUso: string;
  consolidated: boolean;
  consolidatedAt: string | null;
  audit: AgentInstructionAudit;
}

export interface ConsolidateAgentResponse {
  agentId: string;
  consolidatedAt: string;
  prompt: string;
  collectionFields: AgentInstructionField[];
}

export function useAgentInstructionAudit(agentId: string | undefined) {
  const { isAuthenticated, getIdToken } = useAuth();
  return useQuery({
    queryKey: ["agentInstructionAudit", agentId],
    enabled: isAuthenticated && Boolean(agentId),
    queryFn: async (): Promise<AgentInstructionAuditResponse> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");
      const res = await fetchApi(`/api/followup/companies/${agentId}/instruction-audit`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao carregar diagnóstico do agente"));
      }
      return readApiJson<AgentInstructionAuditResponse>(res, "agent-instruction-audit");
    },
  });
}

// "Um agente, um dono para cada texto" — Commit 2. Ação de mão única: depois
// de consolidado, o agente ignora template e prompt padrão do tenant. O
// backend recusa (409) se já estiver consolidado — não existe "desconsolidar".
export function useConsolidateAgent(agentId: string | undefined) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<ConsolidateAgentResponse> => {
      if (!agentId) throw new Error("Agente não selecionado.");
      const token = await getIdToken();
      const res = await fetchApi(`/api/followup/companies/${agentId}/consolidate`, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao consolidar o agente"));
      }
      return readApiJson<ConsolidateAgentResponse>(res, "consolidate-agent");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agentInstructionAudit", agentId] });
      queryClient.invalidateQueries({ queryKey: ["fup-companies"] });
    },
  });
}
