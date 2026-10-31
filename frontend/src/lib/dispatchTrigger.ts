import { API_BASE_URL, readApiErrorMessage } from "@/lib/api";

/** O que a rota devolve em error.details quando recusa o "Disparar Agora" fora da janela de envio do tenant. */
export type OutsideSendWindowDetails = {
  localTime: string;
  start: string;
  end: string;
  days: string[];
  timezone: string;
  sendWindow: string;
  nextOpening: string;
  nextOpeningLocal: string;
};

/**
 * 422 OUTSIDE_SEND_WINDOW: o botão "Agora" obedece a janela do tenant desde 30/10/2026. Quem chama mostra o diálogo
 * (useOutsideSendWindowConfirm) e só repete com forceOutsideWindow: true se a pessoa confirmar.
 */
export class OutsideSendWindowError extends Error {
  details: OutsideSendWindowDetails;
  constructor(message: string, details: OutsideSendWindowDetails) {
    super(message);
    this.name = "OutsideSendWindowError";
    this.details = details;
  }
}

/** POST /api/campaigns/dispatches/:id/trigger. Lança OutsideSendWindowError no 422 da janela e Error nos outros. */
export async function postDispatchTrigger(
  token: string | null | undefined,
  dispatchId: string,
  { forceOutsideWindow = false }: { forceOutsideWindow?: boolean } = {}
) {
  const res = await fetch(`${API_BASE_URL}/api/campaigns/dispatches/${dispatchId}/trigger`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(forceOutsideWindow ? { forceOutsideWindow: true } : {}),
  });
  if (res.status === 422) {
    const data = await res.clone().json().catch(() => null);
    if (data?.error?.code === "OUTSIDE_SEND_WINDOW" && data.error.details) {
      throw new OutsideSendWindowError(data.error.message || "Fora da janela de envio", data.error.details);
    }
  }
  if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao disparar"));
  return res.json();
}

export type DispatchTriggerOutcome =
  | { kind: "started"; forced: boolean }
  | { kind: "declined"; details: OutsideSendWindowDetails }
  | { kind: "failed"; message: string };

/**
 * Dispara o lote; fora da janela pergunta (askToForce abre o diálogo) e só repete com forceOutsideWindow se confirmado.
 * Não lança: no fluxo de criação o lote já foi gravado, e falha aqui não pode virar "Sucesso!" nem desfazer a campanha.
 */
export async function triggerDispatchWithWindowConfirm(
  token: string | null | undefined,
  dispatchId: string,
  askToForce: (details: OutsideSendWindowDetails) => Promise<boolean>
): Promise<DispatchTriggerOutcome> {
  try {
    await postDispatchTrigger(token, dispatchId);
    return { kind: "started", forced: false };
  } catch (err) {
    if (!(err instanceof OutsideSendWindowError)) {
      return { kind: "failed", message: err instanceof Error ? err.message : "Erro ao disparar" };
    }
    if (!(await askToForce(err.details))) return { kind: "declined", details: err.details };
    try {
      await postDispatchTrigger(token, dispatchId, { forceOutsideWindow: true });
      return { kind: "started", forced: true };
    } catch (forcedErr) {
      return { kind: "failed", message: forcedErr instanceof Error ? forcedErr.message : "Erro ao disparar" };
    }
  }
}
