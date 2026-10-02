// frontend/src/test/newVersionBanner.test.tsx
//
// Aviso de nova versão. A tela consulta /version.json a cada 5 minutos, só
// com a aba visível, e compara com a versão que ela carregou. Diferente →
// aviso discreto com botão de atualizar. NUNCA recarrega sozinha: o usuário
// pode estar no meio de uma mensagem de campanha ou de uma importação.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NewVersionBanner } from "@/components/NewVersionBanner";
import { VERSION_CHECK_INTERVAL_MS, VERSION_FILE_PATH, fetchLatestVersion } from "@/lib/appVersion";

const INTERVAL = VERSION_CHECK_INTERVAL_MS;

let visibility: DocumentVisibilityState = "visible";

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("NewVersionBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("o intervalo de verificação é de cinco minutos", () => {
    expect(INTERVAL).toBe(5 * 60 * 1000);
  });

  it("[TESTE OBRIGATÓRIO] versão igual não mostra nada", async () => {
    const fetchLatest = vi.fn(async () => "v1");
    render(<NewVersionBanner currentVersion="v1" fetchLatest={fetchLatest} />);

    await advance(INTERVAL);

    expect(fetchLatest).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Nova versão disponível.")).toBeNull();
  });

  it("[TESTE OBRIGATÓRIO] versão diferente mostra o aviso", async () => {
    const fetchLatest = vi.fn(async () => "v2");
    render(<NewVersionBanner currentVersion="v1" fetchLatest={fetchLatest} />);

    expect(screen.queryByText("Nova versão disponível.")).toBeNull();
    await advance(INTERVAL);

    expect(screen.getByText("Nova versão disponível.")).toBeTruthy();
  });

  it("[TESTE OBRIGATÓRIO] dispensar esconde, e o aviso volta na verificação seguinte", async () => {
    const fetchLatest = vi.fn(async () => "v2");
    render(<NewVersionBanner currentVersion="v1" fetchLatest={fetchLatest} />);

    await advance(INTERVAL);
    expect(screen.getByText("Nova versão disponível.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Dispensar aviso/ }));
    expect(screen.queryByText("Nova versão disponível.")).toBeNull();

    // a aba continua velha — a próxima verificação avisa de novo
    await advance(INTERVAL);
    expect(fetchLatest).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Nova versão disponível.")).toBeTruthy();
  });

  it("[TESTE OBRIGATÓRIO] o botão recarrega a página", async () => {
    const onReload = vi.fn();
    render(<NewVersionBanner currentVersion="v1" fetchLatest={async () => "v2"} onReload={onReload} />);
    await advance(INTERVAL);

    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));

    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("sem onReload, o botão chama window.location.reload", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    try {
      render(<NewVersionBanner currentVersion="v1" fetchLatest={async () => "v2"} />);
      await advance(INTERVAL);

      fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));

      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("[TESTE OBRIGATÓRIO] nunca recarrega sozinho — nem quando detecta versão nova", async () => {
    // observa as DUAS portas: o onReload injetado e o window.location.reload
    // de verdade (que é o que a produção usa) — vigiar só uma deixaria a
    // outra recarregar a página sem o teste perceber
    const onReload = vi.fn();
    const realReload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload: realReload });
    try {
      render(<NewVersionBanner currentVersion="v1" fetchLatest={async () => "v2"} onReload={onReload} />);
      render(<NewVersionBanner currentVersion="v1" fetchLatest={async () => "v2"} />);

      await advance(INTERVAL * 3);

      expect(screen.getAllByText("Nova versão disponível.").length).toBeGreaterThan(0);
      expect(onReload).not.toHaveBeenCalled();
      expect(realReload).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("[TESTE OBRIGATÓRIO] aba em segundo plano não consulta", async () => {
    const fetchLatest = vi.fn(async () => "v2");
    visibility = "hidden";
    render(<NewVersionBanner currentVersion="v1" fetchLatest={fetchLatest} />);

    await advance(INTERVAL * 4);

    expect(fetchLatest).not.toHaveBeenCalled();
    expect(screen.queryByText("Nova versão disponível.")).toBeNull();

    // voltou pra aba depois de muito tempo — aí sim pergunta
    await act(async () => {
      setVisibility("visible");
    });
    expect(fetchLatest).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Nova versão disponível.")).toBeTruthy();
  });

  it("[TESTE OBRIGATÓRIO] a consulta não acontece mais de uma vez por intervalo", async () => {
    const fetchLatest = vi.fn(async () => "v1");
    render(<NewVersionBanner currentVersion="v1" fetchLatest={fetchLatest} />);

    await advance(INTERVAL - 1000);
    expect(fetchLatest).toHaveBeenCalledTimes(0);

    await advance(1000);
    expect(fetchLatest).toHaveBeenCalledTimes(1);

    // sai e volta da aba dentro do mesmo intervalo — não é motivo pra perguntar de novo
    await act(async () => {
      setVisibility("hidden");
    });
    await advance(60 * 1000);
    await act(async () => {
      setVisibility("visible");
    });
    expect(fetchLatest).toHaveBeenCalledTimes(1);

    // só no intervalo seguinte
    await advance(INTERVAL);
    expect(fetchLatest).toHaveBeenCalledTimes(2);
  });

  it("consulta lenta ainda em andamento não empilha outra consulta por cima", async () => {
    const fetchLatest = vi.fn(() => new Promise<string | null>(() => {}));
    render(<NewVersionBanner currentVersion="v1" fetchLatest={fetchLatest} />);

    await advance(INTERVAL * 3);

    expect(fetchLatest).toHaveBeenCalledTimes(1);
  });

  it("sem versão carregada (dev e testes) nunca consulta nada", async () => {
    const fetchLatest = vi.fn(async () => "v2");
    render(<NewVersionBanner currentVersion={null} fetchLatest={fetchLatest} />);

    await advance(INTERVAL * 3);

    expect(fetchLatest).not.toHaveBeenCalled();
  });

  it("consulta que falhou (null) não vira aviso e não derruba nada", async () => {
    const fetchLatest = vi.fn(async () => null);
    render(<NewVersionBanner currentVersion="v1" fetchLatest={fetchLatest} />);

    await advance(INTERVAL * 2);

    expect(fetchLatest).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Nova versão disponível.")).toBeNull();
  });
});

describe("fetchLatestVersion", () => {
  it("[TESTE OBRIGATÓRIO] pede /version.json sem cache e devolve a versão publicada", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => ({ version: "abc123" }) })) as any;

    const version = await fetchLatestVersion(fetchFn);

    expect(version).toBe("abc123");
    expect(fetchFn).toHaveBeenCalledWith(VERSION_FILE_PATH, { cache: "no-store" });
    expect(VERSION_FILE_PATH).toBe("/version.json");
  });

  it("resposta de erro devolve null, não inventa versão", async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, json: async () => ({ version: "abc" }) })) as any;
    expect(await fetchLatestVersion(fetchFn)).toBeNull();
  });

  it("a Vercel responde index.html pra caminho inexistente — não é JSON, devolve null", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    })) as any;
    expect(await fetchLatestVersion(fetchFn)).toBeNull();
  });

  it("JSON sem o campo version devolve null", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => ({ outra: "coisa" }) })) as any;
    expect(await fetchLatestVersion(fetchFn)).toBeNull();
  });

  it("rede caída devolve null", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as any;
    expect(await fetchLatestVersion(fetchFn)).toBeNull();
  });
});
