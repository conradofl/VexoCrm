import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HeloisaVoiceOrb, normalizeWandinhaWakeTranscript } from "../components/HeloisaVoiceOrb";

const mockFetchApi = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isInternalUser: true,
    isAdminUser: true,
    getIdToken: vi.fn().mockResolvedValue("mock-token"),
    user: { displayName: "Conrado Finzi" },
  }),
}));

vi.mock("@/lib/api", () => ({
  fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

describe("Wandinha Voice Orb · Escuta Contínua Multi-Turno (Desktop)", () => {
  let recognitionInstances: any[] = [];
  let activeSpeechUtterances: any[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    recognitionInstances = [];
    activeSpeechUtterances = [];
    mockFetchApi.mockReset();

    Object.defineProperty(window.navigator, "userAgent", {
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36",
      configurable: true,
    });

    Object.defineProperty(window.navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          active: true,
          getTracks: () => [{ stop: vi.fn() }],
        }),
      },
      configurable: true,
    });

    (window as any).AudioContext = undefined;
    (window as any).webkitAudioContext = undefined;

    class MockSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      maxAlternatives = 1;
      onresult: ((e: any) => void) | null = null;
      onerror: ((e: any) => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      abort = vi.fn();
      stop = vi.fn();

      constructor() {
        recognitionInstances.push(this);
      }
    }

    (window as any).SpeechRecognition = MockSpeechRecognition;
    (window as any).webkitSpeechRecognition = MockSpeechRecognition;

    class MockUtterance {
      text: string;
      lang = "";
      rate = 1;
      pitch = 1;
      volume = 1;
      voice: any = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: any) => void) | null = null;

      constructor(text = "") {
        this.text = text;
        if (text) {
          activeSpeechUtterances.push(this);
        }
      }
    }

    (window as any).SpeechSynthesisUtterance = MockUtterance;
    (window as any).speechSynthesis = {
      speak: vi.fn((u: any) => {
        if (u.text) {
          (window as any).speechSynthesis.speaking = true;
          u.onstart?.();
        }
      }),
      cancel: vi.fn(() => {
        (window as any).speechSynthesis.speaking = false;
      }),
      resume: vi.fn(),
      getVoices: vi.fn().mockReturnValue([]),
      speaking: false,
      pending: false,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("normaliza transcrição fonética 'Vandinha' para 'Wandinha' e reconhece wake word isolada", () => {
    expect(normalizeWandinhaWakeTranscript("Oi Vandinha")).toEqual({
      isJustWakeWord: true,
      comandoParaEnviar: "Olá Wandinha",
    });
    expect(normalizeWandinhaWakeTranscript("Oi Vandinha Quais são as suas funções")).toEqual({
      isJustWakeWord: false,
      comandoParaEnviar: "Quais são as suas funções",
    });
    expect(normalizeWandinhaWakeTranscript("Wandinha, auditar campanhas")).toEqual({
      isJustWakeWord: false,
      comandoParaEnviar: "auditar campanhas",
    });
  });

  it("reativa automaticamente o microfone após a 1ª resposta falada e continua ouvindo na 2ª ordem e após timeout ocioso do Chrome", async () => {
    mockFetchApi
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          responseText: "Consigo auditar qualquer tenant e agendar reuniões.",
          executedTools: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          responseText: "Sua agenda de hoje tem duas reuniões.",
          executedTools: [],
        }),
      });

    const { getByLabelText } = render(
      <MemoryRouter>
        <HeloisaVoiceOrb />
      </MemoryRouter>
    );

    // 1. Abre o orbe -> inicia 1ª sessão de SpeechRecognition
    await act(async () => {
      fireEvent.click(getByLabelText("Falar com a Wandinha (Voz)"));
      await Promise.resolve();
    });

    expect(recognitionInstances.length).toBe(1);
    const rec1 = recognitionInstances[0];
    expect(rec1.start).toHaveBeenCalledTimes(1);

    // 2. Usuário fala 1º comando ("Oi Vandinha Quais são as suas funções")
    await act(async () => {
      rec1.onresult?.({
        resultIndex: 0,
        results: [[{ transcript: "Oi Vandinha Quais são as suas funções" }]],
      });
    });

    // Avança os 1200ms de silêncio para disparar envio
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1250);
    });

    expect(mockFetchApi).toHaveBeenCalledTimes(1);
    expect(activeSpeechUtterances.length).toBe(1);

    // 3. Wandinha termina de falar a 1ª resposta -> após 650ms reativa automaticamente o microfone (rec2)!
    await act(async () => {
      (window as any).speechSynthesis.speaking = false;
      activeSpeechUtterances[0].onend?.();
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(recognitionInstances.length).toBe(2);
    const rec2 = recognitionInstances[1];
    expect(rec2.start).toHaveBeenCalledTimes(1);

    // 4. Simula o Chrome encerrando a sessão ociosa por silêncio (onend) -> reconecta automaticamente (rec3)!
    await act(async () => {
      rec2.onend?.();
      await vi.advanceTimersByTimeAsync(350);
    });

    expect(recognitionInstances.length).toBe(3);
    const rec3 = recognitionInstances[2];
    expect(rec3.start).toHaveBeenCalledTimes(1);

    // 5. Usuário fala o 2º comando sem precisar clicar em nada!
    await act(async () => {
      rec3.onresult?.({
        resultIndex: 0,
        results: [[{ transcript: "Wandinha como está minha agenda hoje" }]],
      });
      await vi.advanceTimersByTimeAsync(1250);
    });

    expect(mockFetchApi).toHaveBeenCalledTimes(2);
    expect(activeSpeechUtterances.length).toBe(2);

    // 6. Termina a 2ª resposta -> volta a ouvir pela 4ª vez!
    await act(async () => {
      (window as any).speechSynthesis.speaking = false;
      activeSpeechUtterances[1].onend?.();
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(recognitionInstances.length).toBe(4);
    expect(recognitionInstances[3].start).toHaveBeenCalledTimes(1);
  });
});
