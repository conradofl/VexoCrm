import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  destravarAudioMobile,
  speakNativeTTS,
  getActiveUtterance,
} from "../components/HeloisaVoiceOrb";

describe("Heloísa Mobile Audio & Speech Synthesis (iOS/Android)", () => {
  let mockSpeak: any;
  let mockCancel: any;
  let mockResume: any;
  let mockGetVoices: any;

  beforeEach(() => {
    vi.useFakeTimers();

    mockSpeak = vi.fn();
    mockCancel = vi.fn();
    mockResume = vi.fn();
    mockGetVoices = vi.fn().mockReturnValue([]);

    // Mock do window.speechSynthesis
    (window as any).speechSynthesis = {
      speak: mockSpeak,
      cancel: mockCancel,
      resume: mockResume,
      getVoices: mockGetVoices,
      speaking: false,
    };

    // Mock de SpeechSynthesisUtterance
    class MockSpeechSynthesisUtterance {
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
      }
    }

    (window as any).SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("1. destravarAudioMobile executa fala muda e resume() para capturar User Gesture Token", () => {
    destravarAudioMobile();

    expect(mockResume).toHaveBeenCalled();
    expect(mockSpeak).toHaveBeenCalledTimes(1);

    const dummyUtterance = mockSpeak.mock.calls[0][0];
    expect(dummyUtterance.volume).toBe(0);
    expect(dummyUtterance.rate).toBe(10);
    expect(dummyUtterance.text).toBe("");
  });

  it("2. speakNativeTTS previne Garbage Collection mantendo referência em nível de módulo e window._activeUtterance", () => {
    speakNativeTTS({ text: "Olá Conrado, tudo bem?" });

    const active = getActiveUtterance();
    expect(active).not.toBeNull();
    expect(active?.text).toBe("Olá Conrado, tudo bem?");
    expect((window as any)._activeUtterance).toBe(active);

    // Quando termina a fala, limpa a referência
    active?.onend?.();
    expect(getActiveUtterance()).toBeNull();
    expect((window as any)._activeUtterance).toBeNull();
  });

  it("3. speakNativeTTS evita deadlock de cancel() aguardando 80ms se speaking for true", () => {
    (window as any).speechSynthesis.speaking = true;

    speakNativeTTS({ text: "Testando deadlock cancel" });

    expect(mockCancel).toHaveBeenCalled();
    expect(mockSpeak).not.toHaveBeenCalled();

    // Avança 80ms no timer fake
    vi.advanceTimersByTime(80);

    expect(mockResume).toHaveBeenCalled();
    expect(mockSpeak).toHaveBeenCalledTimes(1);
    expect(mockSpeak.mock.calls[0][0].text).toBe("Testando deadlock cancel");
  });

  it("4. speakNativeTTS preserva lang pt-BR sem quebrar quando getVoices() é vazio (iOS inicial)", () => {
    mockGetVoices.mockReturnValue([]);

    speakNativeTTS({ text: "Resposta no iOS Safari" });

    expect(mockSpeak).toHaveBeenCalledTimes(1);
    const utterance = mockSpeak.mock.calls[0][0];
    expect(utterance.lang).toBe("pt-BR");
    expect(utterance.voice).toBeNull();
  });

  it("5. speakNativeTTS ativa watchdog de 1s para chamar resume() enquanto speaking for true", () => {
    speakNativeTTS({ text: "Fala longa que precisa de watchdog" });

    const utterance = mockSpeak.mock.calls[0][0];
    // Simula disparo do evento onstart
    utterance.onstart?.();

    (window as any).speechSynthesis.speaking = true;

    // Avança 1 segundo (watchdog #1)
    vi.advanceTimersByTime(1000);
    // 1 chamada no doSpeak() inicial + 1 do watchdog
    expect(mockResume).toHaveBeenCalledTimes(2);

    // Avança mais 1 segundo (watchdog #2)
    vi.advanceTimersByTime(1000);
    expect(mockResume).toHaveBeenCalledTimes(3);

    // Finaliza a fala
    (window as any).speechSynthesis.speaking = false;
    utterance.onend?.();

    // Watchdog deve ter sido cancelado, não deve haver novas chamadas
    vi.advanceTimersByTime(2000);
    expect(mockResume).toHaveBeenCalledTimes(3);
  });
});
