import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

export interface LibraryAudio {
  id: string;
  name: string;
  whenToUse: string | null;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  /** Passos de follow-up (de cadência não arquivada) que usam este áudio. */
  followupSteps?: number;
  /** Agentes de atendimento que podem enviar este áudio na conversa. */
  agentIds?: string[];
}

export interface AudioLibraryAgent {
  id: string;
  name: string;
  /** Quantos áudios este agente já tem ligados. */
  audioCount: number;
}

export interface AudioLibraryLimits {
  maxBytes: number;
  maxSeconds: number;
  nameMax: number;
  whenToUseMax: number;
  agentMaxAudios: number;
}

export interface AudioLibraryAccess {
  allowed: boolean;
  reason: string | null;
  message: string | null;
  limits: AudioLibraryLimits;
}

// Só valem até o backend responder em /access — os números de verdade são os dele.
export const AUDIO_LIBRARY_DEFAULT_LIMITS: AudioLibraryLimits = {
  maxBytes: 5 * 1024 * 1024,
  maxSeconds: 180,
  nameMax: 80,
  whenToUseMax: 140,
  agentMaxAudios: 10,
};

export function formatAudioDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// A tela obedece ao backend (mesma função que gateia as rotas, em
// audioLibrary/access.js): sem veredito positivo, nada de upload nem de lista.
export function useAudioLibraryAccess(clientId: string | undefined) {
  const { isAuthenticated, getIdToken } = useAuth();
  return useQuery({
    queryKey: ["audioLibraryAccess", clientId],
    enabled: isAuthenticated && Boolean(clientId),
    queryFn: async (): Promise<AudioLibraryAccess> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");
      const params = new URLSearchParams({ clientId: clientId as string });
      const res = await fetchApi(`/api/audio-library/access?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Não foi possível verificar o acesso à biblioteca de áudios"));
      }
      const data = await readApiJson<Partial<AudioLibraryAccess>>(res, "audio-library-access");
      return {
        allowed: data.allowed === true,
        reason: data.reason ?? null,
        message: data.message ?? null,
        limits: { ...AUDIO_LIBRARY_DEFAULT_LIMITS, ...(data.limits || {}) },
      };
    },
  });
}

export function useAudioLibrary(clientId: string | undefined) {
  const { isAuthenticated, getIdToken } = useAuth();
  return useQuery({
    queryKey: ["audioLibrary", clientId],
    enabled: isAuthenticated && Boolean(clientId),
    queryFn: async (): Promise<LibraryAudio[]> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");
      const params = new URLSearchParams({ clientId: clientId as string });
      const res = await fetchApi(`/api/audio-library?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao carregar a biblioteca de áudios"));
      }
      const data = await readApiJson<{ audios: LibraryAudio[] }>(res, "audio-library-list");
      return data.audios || [];
    },
  });
}

export function useUploadLibraryAudio(clientId: string | undefined) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<LibraryAudio> => {
      if (!clientId) throw new Error("Empresa não selecionada.");
      const token = await getIdToken();
      const params = new URLSearchParams({ clientId });
      const res = await fetchApi(`/api/audio-library?${params}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-file-name": encodeURIComponent(file.name),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: file,
        // Até 5 MB em rede de celular: o limite padrão de 15 s é curto.
        timeoutMs: 90_000,
      });
      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao enviar o áudio"));
      }
      const data = await readApiJson<{ audio: LibraryAudio }>(res, "audio-library-upload");
      return data.audio;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["audioLibrary", clientId] });
    },
  });
}

export function useUpdateLibraryAudio(clientId: string | undefined) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; name: string; whenToUse: string | null }): Promise<LibraryAudio> => {
      const token = await getIdToken();
      const res = await fetchApi(`/api/audio-library/${input.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ name: input.name, whenToUse: input.whenToUse }),
      });
      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao salvar o áudio"));
      }
      const data = await readApiJson<{ audio: LibraryAudio }>(res, "audio-library-update");
      return data.audio;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["audioLibrary", clientId] });
    },
  });
}

export function useArchiveLibraryAudio(clientId: string | undefined) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (audioId: string): Promise<void> => {
      const token = await getIdToken();
      const res = await fetchApi(`/api/audio-library/${audioId}/archive`, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Erro ao arquivar o áudio"));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["audioLibrary", clientId] });
    },
  });
}

// Não existe URL pública do arquivo: a tela baixa os bytes com o token e toca
// de um endereço local (blob). Quem chama é dono de liberar o endereço.
export function useFetchLibraryAudioFile() {
  const { getIdToken } = useAuth();
  return async (audioId: string): Promise<string> => {
    const token = await getIdToken();
    const res = await fetchApi(`/api/audio-library/${audioId}/file`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      timeoutMs: 60_000,
    });
    if (!res.ok) {
      throw new Error(await readApiErrorMessage(res, "Não foi possível carregar o áudio"));
    }
    return URL.createObjectURL(await res.blob());
  };
}

// ─── Fase 3: áudio ligado a agente de atendimento ────────────────────────────

/** Agentes de atendimento da empresa (os únicos que enviam áudio na conversa). */
export function useAudioLibraryAgents(clientId: string | undefined) {
  const { isAuthenticated, getIdToken } = useAuth();
  return useQuery({
    queryKey: ["audioLibraryAgents", clientId],
    enabled: isAuthenticated && Boolean(clientId),
    queryFn: async (): Promise<AudioLibraryAgent[]> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");
      const params = new URLSearchParams({ clientId: clientId as string });
      const res = await fetchApi(`/api/audio-library/agents?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao carregar os agentes"));
      const data = await readApiJson<{ agents: AudioLibraryAgent[] }>(res, "audio-library-agents");
      return data.agents || [];
    },
  });
}

/** Envios de cada áudio pelo agente (contados nas mensagens gravadas). Falha aqui não derruba a aba. */
export function useAudioLibraryUsage(clientId: string | undefined) {
  const { isAuthenticated, getIdToken } = useAuth();
  return useQuery({
    queryKey: ["audioLibraryUsage", clientId],
    enabled: isAuthenticated && Boolean(clientId),
    queryFn: async (): Promise<{ windowDays: number; sends: Record<string, number> }> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");
      const params = new URLSearchParams({ clientId: clientId as string });
      const res = await fetchApi(`/api/audio-library/usage?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao carregar os envios"));
      const data = await readApiJson<{ windowDays: number; sends: Record<string, number> }>(res, "audio-library-usage");
      return { windowDays: data.windowDays || 90, sends: data.sends || {} };
    },
  });
}

export function useSetLibraryAudioAgents(clientId: string | undefined) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; companyIds: string[] }): Promise<string[]> => {
      const token = await getIdToken();
      const res = await fetchApi(`/api/audio-library/${input.id}/agents`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ companyIds: input.companyIds }),
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao salvar os agentes do áudio"));
      const data = await readApiJson<{ agentIds: string[] }>(res, "audio-library-set-agents");
      return data.agentIds || [];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["audioLibrary", clientId] });
      queryClient.invalidateQueries({ queryKey: ["audioLibraryAgents", clientId] });
    },
  });
}
