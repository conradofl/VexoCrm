import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

export type RagDocumentStatus = "pending" | "processing" | "ready" | "failed";

export interface RagDocument {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: RagDocumentStatus;
  errorLog: string | null;
  chunkCount: number;
  companyId: string | null;
  createdAt: string;
  updatedAt: string;
  needsReindex: boolean;
}

export interface RagSearchChunk {
  documentId: string;
  filename: string | null;
  content: string;
  similarity: number;
  passesThreshold: boolean;
}

export interface RagSearchTestResult {
  applies: boolean;
  threshold: number;
  chunks: RagSearchChunk[];
  needsReindexDocumentIds: string[];
}

export function useRagDocuments(clientId: string | undefined) {
  const { isAuthenticated, getIdToken } = useAuth();
  return useQuery({
    queryKey: ["ragDocuments", clientId],
    enabled: isAuthenticated && Boolean(clientId),
    queryFn: async (): Promise<RagDocument[]> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");
      const params = new URLSearchParams({ clientId: clientId as string });
      const res = await fetchApi(`/api/rag/documents?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao carregar documentos da base de conhecimento"));
      }
      const data = await readApiJson<{ documents: RagDocument[] }>(res, "rag-documents");
      return data.documents;
    },
  });
}

export function useUploadRagDocument(clientId: string | undefined) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<void> => {
      if (!clientId) throw new Error("Cliente não selecionado.");
      const token = await getIdToken();
      const params = new URLSearchParams({ clientId });
      const res = await fetchApi(`/api/rag/documents?${params}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-file-name": encodeURIComponent(file.name),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: file,
      });
      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao enviar o documento"));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ragDocuments", clientId] });
    },
  });
}

export function useDeleteRagDocument(clientId: string | undefined) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: string): Promise<void> => {
      const token = await getIdToken();
      const res = await fetchApi(`/api/rag/documents/${documentId}`, {
        method: "DELETE",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao apagar o documento"));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ragDocuments", clientId] });
    },
  });
}

export function useReprocessRagDocument(clientId: string | undefined) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: string): Promise<void> => {
      const token = await getIdToken();
      const res = await fetchApi(`/api/rag/documents/${documentId}/reprocess`, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao reprocessar o documento"));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ragDocuments", clientId] });
    },
  });
}

export function useRagSearchTest(clientId: string | undefined) {
  const { getIdToken } = useAuth();
  return useMutation({
    mutationFn: async (question: string): Promise<RagSearchTestResult> => {
      if (!clientId) throw new Error("Cliente não selecionado.");
      const token = await getIdToken();
      const res = await fetchApi("/api/rag/search-test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ clientId, question }),
      });
      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao testar a busca"));
      }
      return readApiJson<RagSearchTestResult>(res, "rag-search-test");
    },
  });
}
