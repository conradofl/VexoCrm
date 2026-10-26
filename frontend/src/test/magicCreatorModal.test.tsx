import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MagicCreatorModal } from "../components/campaigns/MagicCreatorModal";
import type { MagicCampaignResult } from "../hooks/useCampanhas";

const mutateAsyncMock = vi.fn();

vi.mock("@/hooks/useCampanhas", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useMagicCreateCampaign: () => ({
      mutateAsync: mutateAsyncMock,
      isPending: false,
    }),
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const mockGeneratedCampaign: MagicCampaignResult = {
  campaignName: "Lançamento Sky Residence",
  rationale: "Abordagem com curiosidade e exclusividade para agendamento de visita.",
  steps: [
    {
      order: 1,
      type: "text",
      triggerMode: "immediate",
      text: "Olá {{primeiro_nome}}, tudo bem? Temos uma oportunidade de lançamento exclusiva.",
    },
    {
      order: 2,
      type: "text",
      triggerMode: "after_reply",
      text: "Excelente! Condições especiais com entrada reduzida para os primeiros investidores.",
      buttons: [
        { type: "reply", displayText: "1 - Quero aproveitar", replyText: "1 - Quero aproveitar" },
        { type: "reply", displayText: "2 - Agora não", replyText: "2 - Agora não" },
      ],
    },
    {
      order: 3,
      type: "link",
      triggerMode: "after_reply",
      linkUrl: "{{scheduling_link}}",
      text: "👉 Acesse o link oficial para escolher o horário de atendimento com nosso consultor:",
    },
  ],
  agentPrompt: "Instruções do robô para tirar dúvidas e fechar visitas no stand de vendas.",
};

describe("MagicCreatorModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renderiza o cabeçalho com título, badge e formulário", () => {
    renderWithProviders(
      <MagicCreatorModal open={true} onOpenChange={vi.fn()} onApply={vi.fn()} />
    );

    expect(screen.getByText("Vexo Magic Creator")).toBeInTheDocument();
    expect(screen.getByText("Copiloto Criativo")).toBeInTheDocument();
    expect(screen.getByText(/⚡ Gerar Campanha Completa/i)).toBeInTheDocument();
  });

  it("permite selecionar e desmarcar (toggle) pílulas de nicho", () => {
    renderWithProviders(
      <MagicCreatorModal open={true} onOpenChange={vi.fn()} onApply={vi.fn()} />
    );

    const imobPill = screen.getByText("🏢 Imobiliária");

    // Inicialmente nenhuma pílula selecionada: indica que a IA deduzirá
    expect(screen.getByText("IA deduzirá do texto")).toBeInTheDocument();

    // Clica para selecionar
    fireEvent.click(imobPill);
    expect(screen.queryByText("IA deduzirá do texto")).not.toBeInTheDocument();

    // Clica novamente na mesma pílula para desmarcar (toggle de volta para null)
    fireEvent.click(imobPill);
    expect(screen.getByText("IA deduzirá do texto")).toBeInTheDocument();
  });

  it("exibe input inline ao selecionar 'Outro...' permitindo nicho customizado", () => {
    renderWithProviders(
      <MagicCreatorModal open={true} onOpenChange={vi.fn()} onApply={vi.fn()} />
    );

    const outroPill = screen.getByText("Outro...");
    fireEvent.click(outroPill);

    const customInput = screen.getByPlaceholderText(/Digite seu segmento/i);
    expect(customInput).toBeInTheDocument();

    fireEvent.change(customInput, { target: { value: "Pet Shop Especializado" } });
    expect(customInput).toHaveValue("Pet Shop Especializado");
  });

  it("envia payload correto e exibe prévia cromática após geração", async () => {
    mutateAsyncMock.mockResolvedValueOnce(mockGeneratedCampaign);

    const handleApply = vi.fn();
    const handleOpenChange = vi.fn();

    renderWithProviders(
      <MagicCreatorModal
        open={true}
        onOpenChange={handleOpenChange}
        onApply={handleApply}
        clientId="tenant-teste-123"
      />
    );

    const textarea = screen.getByPlaceholderText(/Lançamento de apartamentos/i);
    fireEvent.change(textarea, { target: { value: "Condição VIP de lançamento" } });

    const btnGerar = screen.getByText(/⚡ Gerar Campanha Completa/i);
    fireEvent.click(btnGerar);

    expect(mutateAsyncMock).toHaveBeenCalledWith({
      prompt: "Condição VIP de lançamento",
      niche: "geral",
      tone: "consultivo",
      clientId: "tenant-teste-123",
    });

    // Aguarda exibição da prévia
    await waitFor(() => {
      expect(screen.getByText(/Lançamento Sky Residence/i)).toBeInTheDocument();
    });

    // Verifica badges cromáticas dos 3 passos
    expect(screen.getByText(/Passo 1 · Disparo Inicial/i)).toBeInTheDocument();
    expect(screen.getByText(/Passo 2 · Pós-Resposta com Botões/i)).toBeInTheDocument();
    expect(screen.getByText(/Passo 3 · Envio de Link Oficial/i)).toBeInTheDocument();

    // Verifica botões de resposta no Passo 2
    expect(screen.getByText("1 - Quero aproveitar")).toBeInTheDocument();
    expect(screen.getByText("2 - Agora não")).toBeInTheDocument();

    // Verifica link oficial no Passo 3
    expect(screen.getByText("{{scheduling_link}}")).toBeInTheDocument();

    // Verifica Roteiro do Robô
    expect(screen.getByText(/Instruções para o Agente IA/i)).toBeInTheDocument();
    expect(
      screen.getByText("Instruções do robô para tirar dúvidas e fechar visitas no stand de vendas.")
    ).toBeInTheDocument();

    // Clica em Aplicar na Campanha
    const btnAplicar = screen.getByText(/🪄 Aplicar na Campanha/i);
    fireEvent.click(btnAplicar);

    expect(handleApply).toHaveBeenCalledWith(mockGeneratedCampaign);
    expect(handleOpenChange).toHaveBeenCalledWith(false);
  });
});
