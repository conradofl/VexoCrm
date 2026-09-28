import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";

export interface ContactWithoutChannel {
  id: string;
  nome: string;
  perfil: string;
  resumo: string | null;
  origem: string;
  askedWhatsappAt: string | null;
  becameLeadAt: string | null;
  createdAt: string;
}

export interface ContactsWithoutChannelResponse {
  contacts: ContactWithoutChannel[];
}

export interface ImportInstagramPayload {
  clientId: string;
  contacts: Array<{
    name: string;
    perfil: string;
    phone: string | null;
    resumo: string;
  }>;
}

export interface ImportInstagramResponse {
  success: boolean;
  leadsCreated: number;
  contactsWithoutChannelCreated: number;
  insertErrors: number;
}

export function useContactsWithoutChannel(clientId: string) {
  const { isAuthenticated, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["contacts-without-channel", clientId],
    enabled: isAuthenticated && !!clientId,
    queryFn: async (): Promise<ContactWithoutChannel[]> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado");

      const res = await fetchApi(`/api/contacts-without-channel?clientId=${encodeURIComponent(clientId)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const errorMsg = await readApiErrorMessage(res, "Falha ao carregar contatos sem canal");
        throw new Error(errorMsg);
      }

      const data = await readApiJson<ContactsWithoutChannelResponse>(res, "list_contacts_without_channel");
      return Array.isArray(data.contacts) ? data.contacts : [];
    },
    staleTime: 30 * 1000,
  });
}

export function useUpdateContactWithoutChannel() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      clientId,
      contactId,
      field,
      value,
    }: {
      clientId: string;
      contactId: string;
      field: "asked_whatsapp" | "became_lead";
      value: boolean;
    }) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado");

      const res = await fetchApi(`/api/contacts-without-channel/${encodeURIComponent(contactId)}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId,
          field,
          value,
        }),
      });

      if (!res.ok) {
        const errorMsg = await readApiErrorMessage(res, "Falha ao atualizar contato");
        throw new Error(errorMsg);
      }

      return readApiJson<{ success: boolean }>(res, "update_contact_without_channel");
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["contacts-without-channel", vars.clientId] });
      queryClient.invalidateQueries({ queryKey: ["leads", vars.clientId] });
    },
  });
}

export function useImportInstagram() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: ImportInstagramPayload): Promise<ImportInstagramResponse> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado");

      const res = await fetchApi("/api/leads/import-instagram", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorMsg = await readApiErrorMessage(res, "Falha ao importar contatos do Instagram");
        throw new Error(errorMsg);
      }

      return readApiJson<ImportInstagramResponse>(res, "import_instagram");
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["contacts-without-channel", vars.clientId] });
      queryClient.invalidateQueries({ queryKey: ["leads", vars.clientId] });
    },
  });
}
