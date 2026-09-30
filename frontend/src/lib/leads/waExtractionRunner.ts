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

export interface WaPhaseFailure {
  phase: "conversas" | "agenda" | "grupos";
  label: string;
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
  failures: WaPhaseFailure[];
  statusMessage: string;
}

export interface WaExtractionResult {
  success: boolean;
  totalExtracted: number;
  fromChats: number;
  fromAddressBook: number;
  fromGroups: number;
  failedGroups: WaGroupExtractionFailure[];
  failures: WaPhaseFailure[];
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
 * - Conversas e agenda rodam paginadas em lotes confortáveis para não estourar o timeout.
 * - Grupos rodam UM por requisição, sequencialmente, reportando progresso.
 * - Falha em uma fase ou grupo não aborta as demais fases.
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

  // Identificador único da sessão de extração para manter integridade entre os lotes
  const sessionId = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    ? crypto.randomUUID()
    : `extract-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

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
  const failures: WaPhaseFailure[] = [];

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
      failures: [...failures],
      statusMessage,
    });
  };

  // 3. Conversas (paginada em lotes para não estourar teto de tempo de 30s)
  if (plan.sources.conversas) {
    let cursor = 0;
    let hasMore = true;
    const CHAT_BATCH_SIZE = 15;

    while (hasMore) {
      if (isCancelled()) {
        notifyProgress("cancelled", 0, undefined, "Extração interrompida pelo usuário");
        return { success: true, totalExtracted, fromChats, fromAddressBook, fromGroups, failedGroups, failures, cancelled: true };
      }

      notifyProgress(
        "conversas",
        0,
        undefined,
        cursor === 0
          ? "Buscando e minerando conversas recentes..."
          : `Minerando conversas recentes (a partir de ${cursor})...`
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
            chatLimit: effectiveChatLimit,
            sources: ["conversas"],
            sessionId,
            cursor,
            batchSize: CHAT_BATCH_SIZE,
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
          failures.push({ phase: "conversas", label: "Conversas", error: errorMsg });
          break; // Falha em conversas NÃO aborta agenda nem grupos
        }

        const data = await res.json();
        const count = Number(data.extractedCount || data.fromChats || 0);
        totalExtracted += count;
        fromChats += count;

        hasMore = Boolean(data.hasMore);
        if (typeof data.nextCursor === "number") {
          cursor = data.nextCursor;
        } else {
          cursor += CHAT_BATCH_SIZE;
        }

        notifyProgress(
          "conversas",
          0,
          undefined,
          data.totalAvailable
            ? `Conversas: ${Math.min(cursor, data.totalAvailable)} de ${data.totalAvailable} processadas (${fromChats} mineradas)...`
            : `Conversas: ${fromChats} mineradas...`
        );
      } catch (err: any) {
        const errorMsg = err?.name === "AbortError" || err?.name === "TimeoutError"
          ? "Timeout na requisição de conversas"
          : (err?.message || "Falha ao extrair conversas");
        failures.push({ phase: "conversas", label: "Conversas", error: errorMsg });
        break; // Falha em conversas NÃO aborta agenda nem grupos
      }
    }
  }

  // 4. Agenda (paginada em lotes para instâncias com muitos contatos)
  if (plan.sources.agenda) {
    let cursor = 0;
    let hasMore = true;
    const AGENDA_BATCH_SIZE = 50;

    while (hasMore) {
      if (isCancelled()) {
        notifyProgress("cancelled", 0, undefined, "Extração interrompida pelo usuário");
        return { success: true, totalExtracted, fromChats, fromAddressBook, fromGroups, failedGroups, failures, cancelled: true };
      }

      notifyProgress(
        "agenda",
        0,
        undefined,
        cursor === 0
          ? "Minerando contatos salvos na agenda..."
          : `Minerando contatos da agenda (a partir de ${cursor})...`
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
            sources: ["agenda"],
            sessionId,
            cursor,
            batchSize: AGENDA_BATCH_SIZE,
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
          failures.push({ phase: "agenda", label: "Agenda", error: errorMsg });
          break; // Falha em agenda NÃO aborta grupos
        }

        const data = await res.json();
        const count = Number(data.extractedCount || data.fromAddressBook || 0);
        totalExtracted += count;
        fromAddressBook += count;

        hasMore = Boolean(data.hasMore);
        if (typeof data.nextCursor === "number") {
          cursor = data.nextCursor;
        } else {
          cursor += AGENDA_BATCH_SIZE;
        }

        notifyProgress(
          "agenda",
          0,
          undefined,
          data.totalAvailable
            ? `Agenda: ${Math.min(cursor, data.totalAvailable)} de ${data.totalAvailable} contatos processados (${fromAddressBook} minerados)...`
            : `Agenda: ${fromAddressBook} minerados...`
        );
      } catch (err: any) {
        const errorMsg = err?.name === "AbortError" || err?.name === "TimeoutError"
          ? "Timeout na requisição da agenda"
          : (err?.message || "Falha ao extrair agenda");
        failures.push({ phase: "agenda", label: "Agenda", error: errorMsg });
        break; // Falha em agenda NÃO aborta grupos
      }
    }
  }

  // 5. Grupos (UMA requisição por grupo)
  if (plan.sources.grupos && plan.selectedGroups.length > 0) {
    const totalGroups = plan.selectedGroups.length;
    for (let i = 0; i < totalGroups; i++) {
      if (isCancelled()) {
        notifyProgress("cancelled", i, undefined, "Extração interrompida pelo usuário");
        return { success: true, totalExtracted, fromChats, fromAddressBook, fromGroups, failedGroups, failures, cancelled: true };
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
            sessionId,
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
          const failItem = { groupId: group.id, groupName: group.name, error: errorMsg };
          failedGroups.push(failItem);
          failures.push({ phase: "grupos", label: `Grupo "${group.name}"`, error: errorMsg });
        } else {
          const data = await res.json();
          const count = Number(data.extractedCount || data.fromGroups || 0);
          totalExtracted += count;
          fromGroups += count;
        }
      } catch (err: any) {
        const errorMsg = err?.message || "Timeout ou falha na rede";
        const failItem = { groupId: group.id, groupName: group.name, error: errorMsg };
        failedGroups.push(failItem);
        failures.push({ phase: "grupos", label: `Grupo "${group.name}"`, error: errorMsg });
      }

      if (isCancelled()) {
        notifyProgress("cancelled", groupNum, undefined, "Extração interrompida pelo usuário");
        return { success: true, totalExtracted, fromChats, fromAddressBook, fromGroups, failedGroups, failures, cancelled: true };
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
    failures,
    cancelled: false,
  };
}
