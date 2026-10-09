import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { VoiceSettingsCard, AVAILABLE_VOICES, VOICE_MODES } from "@/components/agente/VoiceSettingsCard";

vi.mock("@/components/ui/use-toast", () => ({ toast: vi.fn() }));

const getIdTokenMock = vi.fn().mockResolvedValue("fake-test-token");
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ getIdToken: getIdTokenMock, isAuthenticated: true }),
}));

// Mock do ResizeObserver exigido pelo Radix Slider em JSDOM
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const fetchApiMock = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    fetchApi: (...args: any[]) => fetchApiMock(...args),
    readApiJson: async (res: any) => res.json(),
    readApiErrorMessage: async () => "Erro na API",
  };
});

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null),
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("VoiceSettingsCard Component — Marco 4: Mensageria Multimodal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchApiMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (String(url).includes("/n8n-settings") && options?.method === "PATCH") {
        const body = JSON.parse(options.body as string);
        return jsonResponse({ item: { ...body } });
      }
      if (String(url).includes("/api/chatbot/voice-preview") && options?.method === "POST") {
        return jsonResponse({
          success: true,
          audioBase64: "ZmFrZS1hdWRpby1ieXRlcw==",
          mimetype: "audio/ogg; codecs=opus",
        });
      }
      return jsonResponse({});
    });

    // Mock do HTMLAudioElement no ambiente jsdom
    window.Audio = vi.fn().mockImplementation(() => ({
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      onplay: null,
      onended: null,
      onerror: null,
    })) as any;
  });

  it("renderiza o card com título, subtítulo e as 3 opções de comportamento de voz", () => {
    renderWithProviders(
      <VoiceSettingsCard
        clientId="tenant-multimodal"
        clientName="Clínica Exemplo"
        initialVoiceMode="disabled"
      />
    );

    expect(screen.getByText("Voz da IA & Respostas em Áudio")).toBeInTheDocument();
    expect(screen.getByText("Desativado")).toBeInTheDocument();
    expect(screen.getByText("Espelhar o Lead")).toBeInTheDocument();
    expect(screen.getByText("Sempre Áudio")).toBeInTheDocument();
    expect(screen.getByText("Recomendado")).toBeInTheDocument();
    expect(screen.getByText("Voz Inativa")).toBeInTheDocument();
  });

  it("exibe badge 'Voz Ativa' quando o modo de voz não está desativado", () => {
    renderWithProviders(
      <VoiceSettingsCard
        clientId="tenant-multimodal"
        clientName="Clínica Exemplo"
        initialVoiceMode="mirror"
      />
    );

    expect(screen.getByText("Voz Ativa")).toBeInTheDocument();
  });

  it("permite selecionar o modo 'Espelhar o Lead' e dispara salvamento em n8n_settings", async () => {
    renderWithProviders(
      <VoiceSettingsCard
        clientId="tenant-multimodal"
        clientName="Clínica Exemplo"
        initialVoiceMode="disabled"
      />
    );

    const mirrorButton = screen.getByRole("radio", { name: /Espelhar o Lead/i });
    fireEvent.click(mirrorButton);

    await waitFor(() => {
      expect(fetchApiMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/lead-clients/tenant-multimodal/n8n-settings"),
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"chatbotVoiceMode":"mirror"'),
        })
      );
    });
  });

  it("renderiza o botão de teste de prévia de voz e dispara requisição para /api/chatbot/voice-preview", async () => {
    renderWithProviders(
      <VoiceSettingsCard
        clientId="tenant-multimodal"
        clientName="Clínica Exemplo"
        initialVoiceMode="mirror"
        initialVoiceId="echo"
        initialVoiceSpeed={1.05}
      />
    );

    const previewButton = screen.getByRole("button", { name: /Ouvir prévia da voz/i });
    expect(previewButton).toBeInTheDocument();

    fireEvent.click(previewButton);

    await waitFor(() => {
      expect(fetchApiMock).toHaveBeenCalledWith(
        "/api/chatbot/voice-preview",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"voice":"echo"'),
        })
      );
    });
  });
});
