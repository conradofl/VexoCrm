// Selo "o robô não respondeu" na lista de Conversas (revisão do #269). O motivo vem do backend em
// lastMessage.meta.agente_barrado (services/inboundAge.js); o robô segue ativo nas próximas mensagens.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { motivoAgenteBarrado } from "@/lib/agentBarred";
import { ConversationListItem } from "@/components/inbox/InboxColumn";

describe("motivoAgenteBarrado", () => {
  it("traduz os motivos conhecidos e não inventa motivo onde não há", () => {
    expect(motivoAgenteBarrado({ agente_barrado: "mensagem_atrasada" })).toEqual({ codigo: "mensagem_atrasada", curto: "Chegou atrasada", longo: "mensagem chegou atrasada" });
    expect(motivoAgenteBarrado({ agente_barrado: "envio_sem_confirmacao" })?.curto).toBe("Envio sem confirmação");
    expect(motivoAgenteBarrado({ agente_barrado: "outro_motivo" })).toEqual({ codigo: "outro_motivo", curto: "Robô não respondeu", longo: "outro motivo" });
    expect(motivoAgenteBarrado(null)).toBeNull();
    expect(motivoAgenteBarrado({})).toBeNull();
    expect(motivoAgenteBarrado({ agente_barrado: "" })).toBeNull();
  });
});

describe("[OBRIGATÓRIO] cartão da conversa com o robô barrado", () => {
  const base = {
    id: "5534990000001", label: "Lead", preview: "Oi, quero orçamento", selected: false, selectMode: false, checked: false,
    onSelect: () => {}, onToggleCheck: () => {}, waitingSince: new Date().toISOString(), showWait: true, fallbackTime: "10:00", now: Date.now(),
  };
  it("mostra o selo com o motivo e a borda de atenção", () => {
    const barrado = motivoAgenteBarrado({ agente_barrado: "mensagem_atrasada" });
    render(<ConversationListItem {...base} flags={{ agentBarred: barrado, attentionReason: `Robô não respondeu: ${barrado!.longo}` }} />);
    const selo = screen.getByText("Chegou atrasada");
    expect(selo).toHaveAttribute("title", expect.stringContaining("O robô não respondeu: mensagem chegou atrasada"));
    expect(screen.getByTitle("Atenção humana: Robô não respondeu: mensagem chegou atrasada")).toBeInTheDocument();
  });
  it("sem motivo: sem selo", () => {
    render(<ConversationListItem {...base} flags={{}} />);
    expect(screen.queryByText("Chegou atrasada")).toBeNull();
  });
});
