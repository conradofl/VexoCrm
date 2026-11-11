import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import type { CampoEditavel, GdCliente, GdEstado, GdEvento } from "@/lib/gdClientes";
import { CAMPOS_EDITAVEIS } from "@/lib/gdClientes";

// Erro da API com o code de sendError ({ error: { code, message, details } }): a tela decide pelo
// code (ESTADO_MUDOU, TELEFONE_INVALIDO...), não pelo texto.
export class GdApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: { estado_atual?: string; [chave: string]: unknown }) {
    super(message);
  }
}

async function lerErro(res: Response): Promise<GdApiError> {
  const data = await res.json().catch(() => null);
  const e = data?.error;
  return new GdApiError(
    res.status,
    typeof e?.code === "string" ? e.code : `HTTP_${res.status}`,
    typeof e?.message === "string" ? e.message : `Erro ${res.status} nos clientes da GD.`,
    e?.details
  );
}

function useChamar() {
  const { getIdToken } = useAuth();
  return async <T,>(caminho: string, init: RequestInit = {}): Promise<T> => {
    const token = await getIdToken();
    if (!token) throw new GdApiError(401, "UNAUTHENTICATED", "Usuário não autenticado.");
    const res = await fetchApi(caminho, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    });
    if (!res.ok) throw await lerErro(res);
    return res.json() as Promise<T>;
  };
}

export const CHAVE_CLIENTES = ["gdClientes"] as const;

export function useGdEstados() {
  const chamar = useChamar();
  return useQuery({
    queryKey: ["gdEstados"],
    queryFn: async () => (await chamar<{ estados: GdEstado[] }>("/api/gd/estados")).estados,
    staleTime: 5 * 60_000,
  });
}

export function useGdClientes(filtros: { estado?: string; fase?: string } = {}) {
  const chamar = useChamar();
  return useQuery({
    queryKey: [...CHAVE_CLIENTES, "lista", filtros.estado || "", filtros.fase || ""],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (filtros.estado) qs.set("estado", filtros.estado);
      if (filtros.fase) qs.set("fase", filtros.fase);
      const sufixo = qs.toString() ? `?${qs}` : "";
      return (await chamar<{ clientes: GdCliente[] }>(`/api/gd/clientes${sufixo}`)).clientes;
    },
    retry: (n, err) => !(err instanceof GdApiError && err.status < 500) && n < 2,
  });
}

export function useGdCliente(id: string | null) {
  const chamar = useChamar();
  return useQuery({
    queryKey: [...CHAVE_CLIENTES, "detalhe", id],
    enabled: Boolean(id),
    queryFn: async () => chamar<{ cliente: GdCliente; eventos: GdEvento[] }>(`/api/gd/clientes/${id}`),
  });
}

export type NovoGdCliente = { nome: string; estado: string } & Partial<Record<Exclude<CampoEditavel, "nome">, unknown>>;

export function useCriarGdCliente() {
  const chamar = useChamar();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dados: NovoGdCliente) =>
      chamar<{ cliente: GdCliente }>("/api/gd/clientes", { method: "POST", body: JSON.stringify(dados) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE_CLIENTES }),
  });
}

// Só campos da lista branca chegam ao corpo; qualquer outra chave (estado_atual, estado...) é
// descartada aqui antes de sair do navegador.
export function corpoDoPatch(mudancas: Record<string, unknown>): Partial<Record<CampoEditavel, unknown>> {
  const corpo: Partial<Record<CampoEditavel, unknown>> = {};
  for (const campo of CAMPOS_EDITAVEIS) {
    if (campo in mudancas) corpo[campo] = mudancas[campo];
  }
  return corpo;
}

export function useEditarGdCliente() {
  const chamar = useChamar();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, mudancas }: { id: string; mudancas: Record<string, unknown> }) =>
      chamar<{ cliente: GdCliente }>(`/api/gd/clientes/${id}`, { method: "PATCH", body: JSON.stringify(corpoDoPatch(mudancas)) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE_CLIENTES }),
  });
}

export function useMoverGdCliente() {
  const chamar = useChamar();
  const qc = useQueryClient();
  return useMutation({
    // estado_esperado vai sempre: é o estado que a tela estava mostrando. Se outra pessoa moveu
    // antes, a API responde 409 ESTADO_MUDOU e nada é gravado.
    mutationFn: ({ id, estado, estadoEsperado, motivo }: { id: string; estado: string; estadoEsperado: string | null; motivo?: string }) =>
      chamar<{ cliente: GdCliente }>(`/api/gd/clientes/${id}/eventos`, {
        method: "POST",
        body: JSON.stringify({ estado, estado_esperado: estadoEsperado, ...(motivo ? { motivo } : {}) }),
      }),
    onSettled: (_data, err) => {
      if (!err || (err instanceof GdApiError && err.code === "ESTADO_MUDOU")) {
        qc.invalidateQueries({ queryKey: CHAVE_CLIENTES });
      }
    },
  });
}

export function useEmitirGdPortalToken() {
  const chamar = useChamar();
  return useMutation({
    mutationFn: (clienteId: string) =>
      chamar<{ token: string; url: string; criado_em: string }>(
        `/api/gd/clientes/${clienteId}/portal-token`,
        { method: "POST" }
      ),
  });
}

export function useCriarGruposWhatsapp() {
  const chamar = useChamar();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      clienteId,
      instanceName,
      force,
    }: {
      clienteId: string;
      instanceName?: string;
      force?: boolean;
    }) =>
      chamar<{
        success: boolean;
        status?: string;
        message?: string;
        cliente: GdCliente;
        grupos: {
          interno: { jid: string | null; url: string | null };
          cliente: { jid: string | null; url: string | null };
        };
      }>(`/api/gd/clientes/${clienteId}/onboarding/whatsapp-groups`, {
        method: "POST",
        body: JSON.stringify({
          ...(instanceName ? { instance_name: instanceName } : {}),
          ...(force ? { force: true } : {}),
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE_CLIENTES }),
  });
}
