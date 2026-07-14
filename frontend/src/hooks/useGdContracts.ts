import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";

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
  status: "rascunho" | "enviado" | "assinado";
  created_at: string;
}

export function useGdContractTemplates() {
  return useQuery({
    queryKey: ["gdContractTemplates"],
    queryFn: () => fetchApi<GdContractTemplate[]>("/api/gd/contract-templates"),
  });
}

export function useGdContracts(proposalId?: string) {
  return useQuery({
    queryKey: ["gdContracts", proposalId],
    queryFn: () => {
      let url = "/api/gd/contracts";
      if (proposalId) url += `?proposal_id=${proposalId}`;
      return fetchApi<GdContract[]>(url);
    },
  });
}

export function useCreateGdContract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { proposal_id: string; template_id?: string; dados: GdContractFormData }) =>
      fetchApi<GdContract>("/api/gd/contracts", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["gdContracts"] });
      queryClient.invalidateQueries({ queryKey: ["gdContracts", variables.proposal_id] });
    },
  });
}

export function useUpdateGdContract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<GdContract> }) =>
      fetchApi<GdContract>(`/api/gd/contracts/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["gdContracts"] });
      queryClient.invalidateQueries({ queryKey: ["gdContracts", data.proposal_id] });
    },
  });
}

export function useDeleteGdContract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchApi(`/api/gd/contracts/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gdContracts"] });
    },
  });
}
