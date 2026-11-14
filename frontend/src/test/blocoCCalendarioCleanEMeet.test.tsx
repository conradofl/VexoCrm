// frontend/src/test/blocoCCalendarioCleanEMeet.test.tsx
// Testes automatizados do BLOCO C: CALENDÁRIO CLEAN & GOOGLE MEET no Frontend

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import * as meetingModal from "@/components/inbox/ScheduleMeetingModal";
import { buildMeetingInviteMessage, parseMeetingLink } from "@/components/inbox/ScheduleMeetingModal";
import { MeetingPostCallCheckinCard } from "@/components/inbox/MeetingPostCallCheckinCard";

vi.mock("@/hooks/useLeadReminders", () => ({
  useUpdateLeadReminder: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ success: true }),
    isPending: false,
  }),
}));

describe("Bloco C - Frontend: Google Meet & Atividades Comerciais", () => {
  describe("o sistema não fabrica link de reunião", () => {
    it("não existe mais gerador de link do Google Meet", () => {
      expect("generateGoogleMeetUrl" in meetingModal).toBe(false);
    });
  });

  describe("parseMeetingLink", () => {
    it("vazio é válido: o link é opcional", () => {
      expect(parseMeetingLink("")).toEqual({ url: null });
      expect(parseMeetingLink("   ")).toEqual({ url: null });
      expect(parseMeetingLink(null)).toEqual({ url: null });
    });

    it("aceita o link colado, com ou sem https://", () => {
      expect(parseMeetingLink(" https://meet.google.com/abc-defg-hij ")).toEqual({ url: "https://meet.google.com/abc-defg-hij" });
      expect(parseMeetingLink("zoom.us/j/123456")).toEqual({ url: "https://zoom.us/j/123456" });
    });

    it("recusa o que não é endereço de página", () => {
      expect(parseMeetingLink("sala do meet")).toHaveProperty("error");
      expect(parseMeetingLink("javascript:alert(1)")).toHaveProperty("error");
      expect(parseMeetingLink("depois eu mando")).toHaveProperty("error");
    });
  });

  describe("buildMeetingInviteMessage", () => {
    const meetingDate = new Date("2026-10-16T15:00:00.000Z");

    it("com link colado: nome, dia, hora e o link", () => {
      const message = buildMeetingInviteMessage("Bia Spazio", meetingDate, "https://meet.google.com/abc-defg-hij");
      expect(message).toContain("Olá Bia,");
      expect(message).toContain("reunião está agendada para");
      expect(message).toContain("Link da reunião: https://meet.google.com/abc-defg-hij");
      expect(message).toContain("Te vejo lá!");
    });

    it("sem link: só dia e hora, nenhum endereço na mensagem", () => {
      for (const empty of [null, undefined, "", "   "]) {
        const message = buildMeetingInviteMessage("Bia Spazio", meetingDate, empty);
        expect(message).toContain("Olá Bia, nossa reunião está agendada para");
        expect(message).not.toMatch(/https?:|meet\.google|Link/i);
        expect(message).toContain("Te vejo lá!");
      }
    });

    it("lead sem nome: cumprimento simples", () => {
      const message = buildMeetingInviteMessage("Lead", meetingDate, null);
      expect(message.startsWith("Olá, nossa reunião")).toBe(true);
    });
  });

  describe("MeetingPostCallCheckinCard", () => {
    const mockMeeting = {
      id: "meet-1",
      clientId: "spazio",
      leadId: "lead-1",
      phone: "5534999990001",
      leadName: "Bia",
      title: "Call Apresentação",
      notes: null,
      remindAt: "2026-10-16T15:00:00.000Z",
      assignedToUid: "u1",
      assignedToName: "Consultor",
      createdByUid: "u1",
      createdByName: "Consultor",
      status: "pending" as const,
      completedAt: null,
      completedByUid: null,
      createdAt: "2026-10-16T10:00:00.000Z",
      activityType: "meeting" as const,
      meetingUrl: "https://meet.google.com/abc-defg-hij",
    };

    it("renderiza o card pós-reunião com botões de desfecho em 1 clique", () => {
      const onReschedule = vi.fn();
      const onStageChange = vi.fn();

      render(
        <MeetingPostCallCheckinCard
          meeting={mockMeeting}
          clientId="spazio"
          onReschedule={onReschedule}
          onStageChange={onStageChange}
        />
      );

      expect(screen.getByText("A call terminou? Qual foi o desfecho?")).toBeInTheDocument();
      expect(screen.getByText("Call Apresentação")).toBeInTheDocument();
      expect(screen.getByText("✅ Venda Fechada")).toBeInTheDocument();
      expect(screen.getByText("📄 Proposta Enviada")).toBeInTheDocument();
      expect(screen.getByText("🔄 Remarcar Call")).toBeInTheDocument();
      expect(screen.getByText("❌ Não Compareceu")).toBeInTheDocument();
    });

    it("aciona callback de remarcar call ao clicar em Remarcar", () => {
      const onReschedule = vi.fn();
      render(
        <MeetingPostCallCheckinCard
          meeting={mockMeeting}
          clientId="spazio"
          onReschedule={onReschedule}
        />
      );

      const rescheduleBtn = screen.getByText("🔄 Remarcar Call");
      fireEvent.click(rescheduleBtn);
      expect(onReschedule).toHaveBeenCalledTimes(1);
    });
  });
});
