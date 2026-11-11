// O pedido da lista de conversas: tem teto de tempo (vira erro visível, nunca "Carregando..."
// eterno) e é cancelado quando a tela pede outra coisa (não empilha atrás do novo).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatsRequestTimeoutError, CHATS_REQUEST_TIMEOUT_MS, fetchWithTimeout } from "@/hooks/useWhatsAppInbox";

// fetch de mentira que se comporta como o de verdade diante do sinal: fica pendurado até
// alguém abortar, e aí rejeita com AbortError.
function pendingFetch() {
  const seen: { signal?: AbortSignal } = {};
  const impl = vi.fn((_url: string, init?: RequestInit) => {
    seen.signal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort);
    });
  });
  return { impl, seen };
}

describe("pedido da lista de conversas", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("o teto fica acima do teto do servidor (8 s) e abaixo de dois ciclos de atualização (24 s)", () => {
    expect(CHATS_REQUEST_TIMEOUT_MS).toBeGreaterThan(8000);
    expect(CHATS_REQUEST_TIMEOUT_MS).toBeLessThan(24000);
  });

  it("pedido que não volta vira erro de tempo esgotado e é abortado de verdade", async () => {
    const { impl, seen } = pendingFetch();
    vi.stubGlobal("fetch", impl);

    const promise = fetchWithTimeout("/api/whatsapp/chats", {});
    const outcome = promise.catch((err) => err);
    await vi.advanceTimersByTimeAsync(CHATS_REQUEST_TIMEOUT_MS - 1);
    expect(seen.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const err = await outcome;
    expect(err).toBeInstanceOf(ChatsRequestTimeoutError);
    expect(err.message).toBe("A lista de conversas demorou demais para responder.");
    expect(seen.signal?.aborted).toBe(true);
  });

  it("quando a tela pede outra coisa, o pedido anterior é abortado e NÃO vira erro de tempo esgotado", async () => {
    const { impl, seen } = pendingFetch();
    vi.stubGlobal("fetch", impl);
    const caller = new AbortController();

    const outcome = fetchWithTimeout("/api/whatsapp/chats", {}, { signal: caller.signal }).catch((err) => err);
    caller.abort();

    const err = await outcome;
    expect(seen.signal?.aborted).toBe(true);
    expect(err).not.toBeInstanceOf(ChatsRequestTimeoutError);
    expect(err.name).toBe("AbortError");
  });

  it("sinal que já chega abortado não deixa pedido rodando", async () => {
    const { impl, seen } = pendingFetch();
    vi.stubGlobal("fetch", impl);
    const caller = new AbortController();
    caller.abort();

    const outcome = fetchWithTimeout("/api/whatsapp/chats", {}, { signal: caller.signal }).catch((err) => err);
    const err = await outcome;
    expect(seen.signal?.aborted).toBe(true);
    expect(err.name).toBe("AbortError");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pedido que volta a tempo devolve a resposta e desarma o relógio", async () => {
    const response = new Response("{}", { status: 200 });
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return response;
      })
    );

    await expect(fetchWithTimeout("/api/whatsapp/chats", {})).resolves.toBe(response);
    await vi.advanceTimersByTimeAsync(CHATS_REQUEST_TIMEOUT_MS * 2);
    expect(signal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
