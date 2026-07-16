import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi, readApiErrorMessage } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

export interface JuridicoSettings {
  slack_channel_id: string;
  whatsapp_number: string;
  evolution_instance: string;
}

export interface EvolutionInstance {
  name: string;
  client_id: string;
}

async function authHeaders(getIdToken: () => Promise<string | null>, json = false) {
  const token = await getIdToken();
  const headers: HeadersInit = json ? { "Content-Type": "application/json" } : {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export function useJuridicoSettings() {
  const { isAuthenticated, getIdToken, clientId } = useAuth();
  return useQuery({
    queryKey: ["juridicoSettings", clientId],
    enabled: isAuthenticated,
    queryFn: async (): Promise<JuridicoSettings> => {
      const res = await fetchApi(`/api/gd/juridico-settings?client_id=${clientId || ""}`, {
        headers: await authHeaders(getIdToken),
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao carregar as configurações do jurídico"));
      const json = await res.json();
      return json.data as JuridicoSettings;
    },
  });
}

export function useSaveJuridicoSettings() {
  const { getIdToken, clientId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: JuridicoSettings) => {
      const res = await fetchApi(`/api/gd/juridico-settings`, {
        method: "PUT",
        headers: await authHeaders(getIdToken, true),
        body: JSON.stringify({ ...data, client_id: clientId }),
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao salvar as configurações"));
      return (await res.json()).data as JuridicoSettings;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["juridicoSettings"] }),
  });
}

// Instâncias de WhatsApp já conectadas — reaproveitadas no dropdown.
export function useEvolutionInstances() {
  const { isAuthenticated, getIdToken, clientId } = useAuth();
  return useQuery({
    queryKey: ["evolutionInstances", clientId],
    enabled: isAuthenticated,
    queryFn: async (): Promise<EvolutionInstance[]> => {
      const res = await fetchApi(`/api/gd/evolution-instances?client_id=${clientId || ""}`, {
        headers: await authHeaders(getIdToken),
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao listar instâncias"));
      const json = await res.json();
      return (json.data || []) as EvolutionInstance[];
    },
  });
}

export function useSendContractToJuridico() {
  const { getIdToken, clientId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (contractId: string) => {
      const res = await fetchApi(`/api/gd/contracts/${contractId}/enviar-juridico`, {
        method: "POST",
        headers: await authHeaders(getIdToken, true),
        body: JSON.stringify({ client_id: clientId }),
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao enviar ao jurídico"));
      return await res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gdContracts"] }),
  });
}
