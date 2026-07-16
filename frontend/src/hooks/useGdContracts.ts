import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

export interface GdContractTemplate {
  id: string;
  tenant_id: string;
  nome: string;
  conteudo: string;
  ativo: boolean;
  created_at: string;
}

export interface GdContractFormData {
  razao_social: string;
  cnpj: string;
  telefone: string;
  email: string;
  representante: string;
  endereco: string;
  produtos: string;
  condicoes_pagamento: string;
  vigencia: string;
  [key: string]: any;
}

export interface GdContract {
  id: string;
  tenant_id: string;
  proposal_id: string;
  dados: GdContractFormData;
  pdf_url: string | null;
  sign_url?: string | null;
  status: "rascunho" | "gerado" | "enviado" | "assinado";
  arquivado?: boolean;
  created_at: string;
}

export function useGdContractTemplates() {
  const { isAuthenticated, getIdToken } = useAuth();
  return useQuery({
    queryKey: ["gdContractTemplates"],
    enabled: isAuthenticated,
    queryFn: async (): Promise<GdContractTemplate[]> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");
      const res = await fetchApi("/api/gd/contract-templates", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao carregar templates de contratos"));
      }
      return readApiJson<GdContractTemplate[]>(res, "contract-templates");
    },
  });
}

export function useGdContracts(proposalId?: string, arquivado = false) {
  const { isAuthenticated, getIdToken } = useAuth();
  return useQuery({
    queryKey: ["gdContracts", proposalId, arquivado],
    enabled: isAuthenticated,
    queryFn: async (): Promise<GdContract[]> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");
      const params = new URLSearchParams();
      if (proposalId) params.set("proposal_id", proposalId);
      if (arquivado) params.set("arquivado", "true");
      const url = `/api/gd/contracts${params.toString() ? `?${params}` : ""}`;
      const res = await fetchApi(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao carregar contratos"));
      }
      return readApiJson<GdContract[]>(res, "contracts");
    },
  });
}

export function useCreateGdContract() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { proposal_id: string; template_id?: string; dados: GdContractFormData }): Promise<GdContract> => {
      const token = await getIdToken();
      const res = await fetchApi("/api/gd/contracts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao criar contrato"));
      }
      return readApiJson<GdContract>(res, "create-contract");
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["gdContracts"] });
      queryClient.invalidateQueries({ queryKey: ["gdContracts", variables.proposal_id] });
    },
  });
}

// Preenchimento assistido por IA: manda o texto colado, recebe os campos.
// Não grava nada — o retorno só preenche o formulário para revisão.
export function useExtractContractData() {
  const { getIdToken } = useAuth();
  return useMutation({
    mutationFn: async (texto: string): Promise<Partial<GdContractFormData>> => {
      const token = await getIdToken();
      const res = await fetchApi("/api/gd/contracts/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ texto }),
      });
      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao extrair os dados com a IA"));
      }
      const json = await res.json();
      return json.data as Partial<GdContractFormData>;
    },
  });
}

export function useUpdateGdContract() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<GdContract> }): Promise<GdContract> => {
      const token = await getIdToken();
      const res = await fetchApi(`/api/gd/contracts/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao atualizar contrato"));
      }
      return readApiJson<GdContract>(res, "update-contract");
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["gdContracts"] });
      queryClient.invalidateQueries({ queryKey: ["gdContracts", data.proposal_id] });
    },
  });
}

export function useDeleteGdContract() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const token = await getIdToken();
      const res = await fetchApi(`/api/gd/contracts/${id}`, {
        method: "DELETE",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao excluir contrato"));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gdContracts"] });
    },
  });
}
