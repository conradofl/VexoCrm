import { API_BASE_URL } from "@/lib/api";

export interface WaExtractionTargetGroup {
  id: string;
  name: string;
}

export interface WaExtractionPlan {
  clientId: string;
  instanceId?: string;
  groupsInstanceId?: string;
  isAdvancedPlan: boolean;
  sources: {
    conversas: boolean;
    agenda: boolean;
    grupos: boolean;
  };
  selectedGroups: WaExtractionTargetGroup[];
}

export interface WaGroupExtractionFailure {
  groupId: string;
  groupName: string;
  error: string;
}

export interface WaExtractionProgress {
  phase: "connecting" | "conversas" | "agenda" | "grupos" | "done" | "cancelled";
  currentGroupIndex: number;
  totalGroups: number;
  currentGroupName?: string;
  totalExtracted: number;
  remainingGroups: number;
  failedGroups: WaGroupExtractionFailure[];
  statusMessage: string;
}

export interface WaExtractionResult {
  success: boolean;
  totalExtracted: number;
  fromChats: number;
  fromAddressBook: number;
  fromGroups: number;
  failedGroups: WaGroupExtractionFailure[];
  cancelled: boolean;
}

/**
 * Trava de paywall: plano que não permite ilimitado usa o maior valor permitido (500),
 * enquanto o Plano Avançado utiliza "all".
 */
export function resolveEffectiveChatLimit(isAdvancedPlan: boolean): number | "all" {
  return isAdvancedPlan ? "all" : 500;
}

export function enforcePlanChatLimit(
  chatLimit: number | "all",
  isAdvancedPlan: boolean
): { limit: number | "all"; clamped: boolean } {
  if (chatLimit === "all" && !isAdvancedPlan) {
    return { limit: 500, clamped: true };
  }
  return { limit: chatLimit, clamped: false };
}

/**
 * Não é possível disparar importação com grupos de uma instância quando a instância atual for outra.
 */
export function validateExtractionInstance(
  currentInstanceId: string,
  groupsInstanceId?: string,
  hasGroups?: boolean
): { valid: boolean; error?: string } {
  if (hasGroups && groupsInstanceId && groupsInstanceId !== currentInstanceId) {
    return {
      valid: false,
      error: "Instância selecionada foi alterada. Recarregue os grupos antes de iniciar a extração.",
    };
  }
  return { valid: true };
}

export function createTimeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  return undefined;
}

export interface RunWaExtractionOptions {
  fetchFn?: typeof fetch;
  getIdToken: () => Promise<string | null>;
  apiBaseUrl?: string;
  onProgress?: (progress: WaExtractionProgress) => void;
  isCancelled?: () => boolean;
  timeoutMsPerRequest?: number;
}

/**
 * Orquestrador da extração de contatos do WhatsApp.
 * - Conversas e agenda rodam cada uma na sua própria requisição.
 * - Grupos rodam UM por requisição, sequencialmente, reportando progresso.
 * - Falha em um grupo não aborta os demais.
 * - Cancelamento interrompe o fluxo preservando contatos já minerados.
 */
export async function runWaExtractionPipeline(
  plan: WaExtractionPlan,
  options: RunWaExtractionOptions
): Promise<WaExtractionResult> {
  const fetchFn = options.fetchFn || fetch;
  const baseUrl = options.apiBaseUrl || API_BASE_URL;
  const isCancelled = options.isCancelled || (() => false);
  const timeoutMs = options.timeoutMsPerRequest || 30000;

  // 1. Validação de integridade da instância
  const instanceValidation = validateExtractionInstance(
    plan.instanceId || "",
    plan.groupsInstanceId,
    plan.sources.grupos && plan.selectedGroups.length > 0
  );
  if (!instanceValidation.valid) {
    throw new Error(instanceValidation.error || "Instância inválida");
  }

  // 2. Limite com trava de plano mantida
  const effectiveChatLimit = resolveEffectiveChatLimit(plan.isAdvancedPlan);

  const token = await options.getIdToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  let totalExtracted = 0;
  let fromChats = 0;
  let fromAddressBook = 0;
  let fromGroups = 0;
  const failedGroups: WaGroupExtractionFailure[] = [];

  const notifyProgress = (
    phase: WaExtractionProgress["phase"],
    currentGroupIndex: number,
    currentGroupName: string | undefined,
    statusMessage: string
  ) => {
    if (!options.onProgress) return;
    const totalGroups = plan.sources.grupos ? plan.selectedGroups.length : 0;
    const remaining = Math.max(0, totalGroups - currentGroupIndex);
    options.onProgress({
      phase,
      currentGroupIndex,
      totalGroups,
      currentGroupName,
      totalExtracted,
      remainingGroups: remaining,
      failedGroups: [...failedGroups],
      statusMessage,
    });
  };

  // 3. Conversas (uma requisição isolada)
  if (plan.sources.conversas) {
    if (isCancelled()) {
      return { success: true, totalExtracted, fromChats, fromAddressBook, fromGroups, failedGroups, cancelled: true };
    }
    notifyProgress("conversas", 0, undefined, "Buscando e minerando conversas recentes...");
    const signal = createTimeoutSignal(timeoutMs);
    const res = await fetchFn(`${baseUrl}/api/leads/extract-wa-contacts`, {
      method: "POST",
      headers,
      ...(signal ? { signal } : {}),
      body: JSON.stringify({
        clientId: plan.clientId,
        instanceId: plan.instanceId || undefined,
        chatLimit: effectiveChatLimit,
        sources: ["conversas"],
      }),
    });
    if (!res.ok) {
      let errorMsg = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        errorMsg = errJson.message || errJson.error || errorMsg;
      } catch {
        const errText = await res.text().catch(() => "");
        if (errText) errorMsg = errText.slice(0, 150);
      }
      throw new Error(`Falha ao extrair conversas: ${errorMsg}`);
    }
    const data = await res.json();
    const count = Number(data.extractedCount || data.fromChats || 0);
    totalExtracted += count;
    fromChats += count;
  }

  // 4. Agenda (uma requisição isolada)
  if (plan.sources.agenda) {
    if (isCancelled()) {
      return { success: true, totalExtracted, fromChats, fromAddressBook, fromGroups, failedGroups, cancelled: true };
    }
    notifyProgress("agenda", 0, undefined, "Minerando contatos salvos na agenda...");
    const signal = createTimeoutSignal(timeoutMs);
    const res = await fetchFn(`${baseUrl}/api/leads/extract-wa-contacts`, {
      method: "POST",
      headers,
      ...(signal ? { signal } : {}),
      body: JSON.stringify({
        clientId: plan.clientId,
        instanceId: plan.instanceId || undefined,
        sources: ["agenda"],
      }),
    });
    if (!res.ok) {
      let errorMsg = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        errorMsg = errJson.message || errJson.error || errorMsg;
      } catch {
        const errText = await res.text().catch(() => "");
        if (errText) errorMsg = errText.slice(0, 150);
      }
      throw new Error(`Falha ao extrair agenda: ${errorMsg}`);
    }
    const data = await res.json();
    const count = Number(data.extractedCount || data.fromAddressBook || 0);
    totalExtracted += count;
    fromAddressBook += count;
  }

  // 5. Grupos (UMA requisição por grupo)
  if (plan.sources.grupos && plan.selectedGroups.length > 0) {
    const totalGroups = plan.selectedGroups.length;
    for (let i = 0; i < totalGroups; i++) {
      if (isCancelled()) {
        notifyProgress("cancelled", i, undefined, "Extração interrompida pelo usuário");
        return { success: true, totalExtracted, fromChats, fromAddressBook, fromGroups, failedGroups, cancelled: true };
      }

      const group = plan.selectedGroups[i];
      const groupNum = i + 1;
      notifyProgress(
        "grupos",
        groupNum,
        group.name,
        `Processando grupo ${groupNum} de ${totalGroups}: "${group.name}"...`
      );

      try {
        const signal = createTimeoutSignal(timeoutMs);
        const res = await fetchFn(`${baseUrl}/api/leads/extract-wa-contacts`, {
          method: "POST",
          headers,
          ...(signal ? { signal } : {}),
          body: JSON.stringify({
            clientId: plan.clientId,
            instanceId: plan.instanceId || undefined,
            sources: ["grupos"],
            groupIds: [group.id],
          }),
        });

        if (!res.ok) {
          let errorMsg = `HTTP ${res.status}`;
          try {
            const errJson = await res.json();
            errorMsg = errJson.message || errJson.error || errorMsg;
          } catch {
            const text = await res.text().catch(() => "");
            if (text) errorMsg = `Erro ${res.status}: ${text.slice(0, 100)}`;
          }
          failedGroups.push({ groupId: group.id, groupName: group.name, error: errorMsg });
        } else {
          const data = await res.json();
          const count = Number(data.extractedCount || data.fromGroups || 0);
          totalExtracted += count;
          fromGroups += count;
        }
      } catch (err: any) {
        failedGroups.push({
          groupId: group.id,
          groupName: group.name,
          error: err?.message || "Timeout ou falha na rede",
        });
      }

      if (isCancelled()) {
        notifyProgress("cancelled", groupNum, undefined, "Extração interrompida pelo usuário");
        return { success: true, totalExtracted, fromChats, fromAddressBook, fromGroups, failedGroups, cancelled: true };
      }
    }
  }

  notifyProgress("done", plan.selectedGroups.length, undefined, "Extração finalizada.");
  return {
    success: true,
    totalExtracted,
    fromChats,
    fromAddressBook,
    fromGroups,
    failedGroups,
    cancelled: false,
  };
}
