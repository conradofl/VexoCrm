// frontend/src/test/audioLibraryTab.test.tsx
//
// Aba "Áudios" (Biblioteca de Áudios) e o seletor de áudio no passo de
// follow-up. Os hooks de verdade (useAudioLibrary.ts) rodam: o que é trocado é
// só o que sai do processo — o fetch (uma API de mentira em memória), o token
// (useAuth) e o tenant selecionado.
//
// jsdom prova presença e o que vai na rede, NÃO prova que está visível: a aba
// também foi aberta em Chromium real, em computador e em 375 px.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: true, getIdToken: async () => "token-teste" }),
}));
vi.mock("@/hooks/useCrmClient", () => ({
  useOptionalCrmClient: () => ({ selectedClientId: "empresa-a", selectedClient: { id: "empresa-a" } }),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a), info: vi.fn() },
}));

import { AudioLibraryTab } from "@/components/agente/AudioLibraryTab";

type Call = { method: string; path: string; headers: Record<string, string>; body: unknown };

const LIMITS = { maxBytes: 5 * 1024 * 1024, maxSeconds: 180, nameMax: 80, whenToUseMax: 140 };

function audio(over: Record<string, unknown> = {}) {
  return {
    id: "audio-1",
    name: "Apresentação da loja",
    whenToUse: "Quando o cliente pergunta quem somos",
    mimeType: "audio/ogg",
    sizeBytes: 250_000,
    durationSeconds: 47,
    createdAt: "2026-11-11T12:00:00Z",
    updatedAt: "2026-11-11T12:00:00Z",
    archivedAt: null,
    followupSteps: 0,
    ...over,
  };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** API de mentira: guarda as chamadas e responde pelo roteador do teste. */
function installApi(router: (call: Call) => Response | undefined) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://localhost");
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const call: Call = { method: (init.method || "GET").toUpperCase(), path: url.pathname + url.search, headers, body: init.body };
    calls.push(call);
    return router(call) ?? json(404, { success: false, error: { code: "NOT_FOUND", message: "rota não prevista no teste" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const accessOk = () => json(200, { success: true, allowed: true, reason: null, message: null, limits: LIMITS });

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:teste"), revokeObjectURL: vi.fn() }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AudioLibraryTab", () => {
  it("acesso negado: mostra o motivo do backend e NÃO busca a lista", async () => {
    const calls = installApi((c) => {
      if (c.path.startsWith("/api/audio-library/access")) {
        return json(200, { success: true, allowed: false, reason: "AUDIO_MODULE_NOT_CONTRACTED", message: "O Agente IA não está contratado para esta empresa.", limits: LIMITS });
      }
    });
    render(<AudioLibraryTab />, { wrapper });
    expect(await screen.findByText("O Agente IA não está contratado para esta empresa.")).toBeTruthy();
    expect(screen.queryByText("Enviar áudio")).toBeNull();
    expect(calls.filter((c) => c.path.startsWith("/api/audio-library?"))).toHaveLength(0);
  });

  it("lista os áudios da empresa com duração, 'quando usar' e uso no follow-up; avisa quando falta o 'quando usar'", async () => {
    const calls = installApi((c) => {
      if (c.path.startsWith("/api/audio-library/access")) return accessOk();
      if (c.method === "GET" && c.path === "/api/audio-library?clientId=empresa-a") {
        return json(200, { success: true, audios: [audio({ followupSteps: 2 }), audio({ id: "audio-2", name: "Sem instrução", whenToUse: null, durationSeconds: 125 })] });
      }
    });
    render(<AudioLibraryTab />, { wrapper });

    const rows = await screen.findAllByTestId("audio-library-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Apresentação da loja")).toBeTruthy();
    expect(within(rows[0]).getByText(/0:47 · 244 KB · em uso em 2 passos de follow-up/)).toBeTruthy();
    expect(within(rows[0]).getByText("Quando o cliente pergunta quem somos")).toBeTruthy();
    expect(within(rows[1]).getByText(/2:05/)).toBeTruthy();
    expect(within(rows[1]).getByText(/Sem “quando usar”/)).toBeTruthy();
    // Toda chamada vai com o token.
    expect(calls.every((c) => c.headers.authorization === "Bearer token-teste")).toBe(true);
  });

  it("enviar: arquivo acima de 5 MB nem sai do navegador; arquivo válido sobe os bytes e abre o 'quando usar'", async () => {
    const calls = installApi((c) => {
      if (c.path.startsWith("/api/audio-library/access")) return accessOk();
      if (c.method === "GET") return json(200, { success: true, audios: [] });
      if (c.method === "POST" && c.path === "/api/audio-library?clientId=empresa-a") {
        return json(201, { success: true, audio: audio({ id: "novo", name: "boas vindas", whenToUse: null }) });
      }
    });
    render(<AudioLibraryTab />, { wrapper });
    await screen.findByText(/Nenhum áudio ainda/);
    const input = screen.getByTestId("audio-library-file-input") as HTMLInputElement;

    const grande = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "grande.mp3", { type: "audio/mpeg" });
    fireEvent.change(input, { target: { files: [grande] } });
    expect(toastError).toHaveBeenCalledWith("O áudio tem 5.0 MB. O limite é 5 MB.");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);

    const ok = new File([new Uint8Array([1, 2, 3])], "boas_vindas.ogg", { type: "audio/ogg" });
    fireEvent.change(input, { target: { files: [ok] } });

    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(1));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toBe(ok);
    expect(post.headers["x-file-name"]).toBe("boas_vindas.ogg");
    expect(post.headers["content-type"]).toBe("application/octet-stream");

    // Depois de enviar, a tela já pede o "quando usar".
    expect(await screen.findByText("Editar áudio")).toBeTruthy();
    expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("boas vindas");
  });

  it("editar: 141 caracteres no 'quando usar' trava o Salvar; dentro do limite manda nome e texto aparados", async () => {
    const calls = installApi((c) => {
      if (c.path.startsWith("/api/audio-library/access")) return accessOk();
      if (c.method === "GET") return json(200, { success: true, audios: [audio()] });
      if (c.method === "PATCH" && c.path === "/api/audio-library/audio-1") return json(200, { success: true, audio: audio() });
    });
    render(<AudioLibraryTab />, { wrapper });
    fireEvent.click(await screen.findByText("Editar"));

    const when = screen.getByLabelText("Quando usar");
    const salvar = screen.getByText("Salvar").closest("button") as HTMLButtonElement;

    fireEvent.change(when, { target: { value: "a".repeat(141) } });
    expect(screen.getByTestId("audio-library-when-counter").textContent).toBe("141/140");
    expect(salvar.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "  Novo nome  " } });
    fireEvent.change(when, { target: { value: "  Quando pedir o endereço  " } });
    expect(salvar.disabled).toBe(false);
    fireEvent.click(salvar);

    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(JSON.parse(String(patch.body))).toEqual({ name: "Novo nome", whenToUse: "Quando pedir o endereço" });
  });

  it("arquivar: só chama a API depois da confirmação, e mostra o aviso de 'em uso' que o backend devolve", async () => {
    const emUso = 'Este áudio está em uso no follow-up: "Passo 1" (Cadência de boas-vindas). Troque o áudio desses passos antes de arquivar.';
    const calls = installApi((c) => {
      if (c.path.startsWith("/api/audio-library/access")) return accessOk();
      if (c.method === "GET") return json(200, { success: true, audios: [audio({ followupSteps: 1 })] });
      if (c.method === "POST" && c.path === "/api/audio-library/audio-1/archive") {
        return json(409, { success: false, error: { code: "AUDIO_IN_USE", message: emUso } });
      }
    });
    render(<AudioLibraryTab />, { wrapper });
    fireEvent.click(await screen.findByText("Arquivar"));

    expect(await screen.findByText("Arquivar “Apresentação da loja”?")).toBeTruthy();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);

    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByText("Arquivar"));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][0]).toBe(emUso);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("ouvir: baixa o arquivo com o token (não há URL pública) e mostra o player", async () => {
    const calls = installApi((c) => {
      if (c.path.startsWith("/api/audio-library/access")) return accessOk();
      if (c.method === "GET" && c.path === "/api/audio-library/audio-1/file") {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/ogg" } });
      }
      if (c.method === "GET") return json(200, { success: true, audios: [audio()] });
    });
    render(<AudioLibraryTab />, { wrapper });
    fireEvent.click(await screen.findByLabelText("Ouvir Apresentação da loja"));

    const player = (await screen.findByTestId("audio-library-player")) as HTMLAudioElement;
    expect(player.getAttribute("src")).toBe("blob:teste");
    const fileCall = calls.find((c) => c.path === "/api/audio-library/audio-1/file")!;
    expect(fileCall.headers.authorization).toBe("Bearer token-teste");

    // Clicar de novo para e libera o endereço local.
    fireEvent.click(screen.getByLabelText("Parar Apresentação da loja"));
    expect(screen.queryByTestId("audio-library-player")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:teste");
  });
});

// ─── Passo de follow-up ──────────────────────────────────────────────────────
// Escolher no seletor (Radix) é provado em Chromium real; aqui fica o que é
// regra: abrir um passo que já usa a biblioteca, e o que vai no salvar.

import StepDrawer from "@/components/followup/StepDrawer";
import type { FupTemplate } from "@/hooks/useFollowupAdmin";

describe("StepDrawer — passo com áudio da biblioteca", () => {
  const passo = {
    id: "tpl-1",
    campaign_id: "cadencia-1",
    name: "Passo de áudio",
    message: "Áudio: Apresentação da loja",
    trigger_type: "after_enrollment",
    trigger_value: 1,
    trigger_unit: "days",
    trigger_direction: null,
    scheduled_time: null,
    anchor_field: null,
    audio_library_id: "audio-1",
    audio_library: { name: "Apresentação da loja", durationSeconds: 47, archived: false },
    is_active: true,
    order_index: 0,
    created_at: "2026-11-11T12:00:00Z",
  } as FupTemplate;

  function abrir(calls: Call[]) {
    render(
      <StepDrawer
        isOpen
        onClose={() => {}}
        editingStep={passo}
        campaignId="cadencia-1"
        stepCount={1}
        anchorFields={[]}
        selectedCrmClient={{ id: "empresa-a" }}
        onSuccess={() => {}}
      />,
      { wrapper }
    );
    return calls;
  }

  function api() {
    return installApi((c) => {
      if (c.path.startsWith("/api/audio-library/access")) return accessOk();
      if (c.method === "GET" && c.path.startsWith("/api/audio-library?")) return json(200, { success: true, audios: [audio()] });
      if (c.method === "PATCH" && c.path === "/api/followup/templates/tpl-1") {
        return json(200, { success: true, template: passo, pendingJobsCount: 0, timingChanged: false });
      }
    });
  }

  it("abre mostrando o áudio escolhido e o aviso de que o texto não é enviado; o anexo solto some", async () => {
    abrir(api());
    const bloco = await screen.findByTestId("step-library-audio");
    expect(within(bloco).getByText("Apresentação da loja")).toBeTruthy();
    expect(within(bloco).getByText(/Neste passo vai só o áudio/)).toBeTruthy();
    expect(screen.queryByText("Anexo de Mídia (Opcional)")).toBeNull();
  });

  it("salvar mantém audio_library_id e manda o anexo solto vazio", async () => {
    const calls = abrir(api());
    await screen.findByTestId("step-library-audio");
    fireEvent.click(screen.getByText("Salvar alterações"));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const body = JSON.parse(String(calls.find((c) => c.method === "PATCH")!.body));
    expect(body).toMatchObject({ audio_library_id: "audio-1", media_path: null, media_type: null });
  });

  it("tirar o áudio manda audio_library_id null e devolve o anexo solto", async () => {
    const calls = abrir(api());
    const bloco = await screen.findByTestId("step-library-audio");
    fireEvent.click(within(bloco).getByTitle("Tirar o áudio deste passo"));
    expect(await screen.findByText("Anexo de Mídia (Opcional)")).toBeTruthy();
    fireEvent.click(screen.getByText("Salvar alterações"));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const body = JSON.parse(String(calls.find((c) => c.method === "PATCH")!.body));
    expect(body.audio_library_id).toBeNull();
  });
});
