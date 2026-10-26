import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WhatsAppPreviewPanel } from "../pages/LeadImports/WhatsAppPreviewPanel";

describe("WhatsAppPreviewPanel — Renderização Imutável de Links e OpenGraph", () => {
  it("renderiza o link e o host em minúsculo, sem corrupção para HTTPS maiúsculo nem %20", () => {
    const sequence = [
      {
        id: "step-1",
        order: 1,
        type: "link" as const,
        triggerMode: "immediate" as const,
        linkUrl: "https://vexo.com.br/agenda-exclusiva?ref=Teste123",
        text: "👉 É aqui, leva 10 minutos:",
        image: null,
        delayAfterSeconds: 2,
        enabled: true,
      },
    ];

    const { container } = render(
      <WhatsAppPreviewPanel campaignSequence={sequence} multiAgendaEnabled={false} />
    );

    // Hostname em minúsculo na badge
    expect(screen.getByText("vexo.com.br")).toBeInTheDocument();
    expect(screen.queryByText("VEXO.COM.BR")).not.toBeInTheDocument();
    expect(screen.queryByText("HTTPS")).not.toBeInTheDocument();
    expect(screen.queryByText("%20HTTPS")).not.toBeInTheDocument();

    // Título do Rich Open Graph em minúsculo
    expect(screen.getByText("vexo.com.br · Prévia Rich Open Graph")).toBeInTheDocument();
    expect(screen.queryByText("VEXO.COM.BR · Prévia Rich Open Graph")).not.toBeInTheDocument();
    expect(screen.queryByText("HTTPS · Prévia Rich Open Graph")).not.toBeInTheDocument();

    // Texto da mensagem e URL preservada abaixo do card
    expect(screen.getByText("👉 É aqui, leva 10 minutos:")).toBeInTheDocument();
    expect(screen.getAllByText("https://vexo.com.br/agenda-exclusiva?ref=Teste123")).toHaveLength(2);
  });

  it("renderiza {{scheduling_link}} puro com fallback sem duplicar protocolo", () => {
    const sequence = [
      {
        id: "step-sched",
        order: 1,
        type: "link" as const,
        triggerMode: "after_reply" as const,
        linkUrl: "{{scheduling_link}}",
        text: "Escolha seu horário:",
        image: null,
        delayAfterSeconds: 2,
        enabled: true,
      },
    ];

    render(
      <WhatsAppPreviewPanel campaignSequence={sequence} multiAgendaEnabled={false} />
    );

    // Host default resolvido sem caixa alta
    expect(screen.getByText("suaempresa.com.br")).toBeInTheDocument();
    expect(screen.getByText("suaempresa.com.br · Prévia Rich Open Graph")).toBeInTheDocument();
    expect(screen.queryByText("HTTPS · Prévia Rich Open Graph")).not.toBeInTheDocument();
  });

  it("recusa host corrompido https://https://calendly.com/x de campanhas antigas, exibindo aviso visível e fallback", () => {
    const sequence = [
      {
        id: "step-corrupt",
        order: 1,
        type: "link" as const,
        triggerMode: "immediate" as const,
        linkUrl: "https://https://calendly.com/x",
        text: "Link da reunião:",
        image: null,
        delayAfterSeconds: 2,
        enabled: true,
      },
    ];

    render(
      <WhatsAppPreviewPanel campaignSequence={sequence} multiAgendaEnabled={false} />
    );

    // Deve exibir aviso visível de link corrompido / formato inválido
    expect(screen.getByTestId("invalid-link-warning")).toBeInTheDocument();
    expect(screen.getByText("Link corrompido ou formato inválido: exibindo fallback")).toBeInTheDocument();

    // Deve exibir o fallback 'suaempresa.com.br', e JAMAIS 'https' em minúsculo ou maiúsculo
    expect(screen.getByText("suaempresa.com.br")).toBeInTheDocument();
    expect(screen.getByText("suaempresa.com.br · Prévia Rich Open Graph")).toBeInTheDocument();
    expect(screen.queryByText("https · Prévia Rich Open Graph")).not.toBeInTheDocument();
    expect(screen.queryByText("HTTPS · Prévia Rich Open Graph")).not.toBeInTheDocument();
    expect(screen.queryByText("https")).not.toBeInTheDocument();
  });
});
