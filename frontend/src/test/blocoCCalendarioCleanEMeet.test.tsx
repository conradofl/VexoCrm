// frontend/src/test/blocoCCalendarioCleanEMeet.test.tsx
// Testes automatizados do BLOCO C: CALENDÁRIO CLEAN & GOOGLE MEET no Frontend

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  generateGoogleMeetUrl,
  buildMeetingInviteMessage,
} from "@/components/inbox/ScheduleMeetingModal";
import { MeetingPostCallCheckinCard } from "@/components/inbox/MeetingPostCallCheckinCard";

vi.mock("@/hooks/useLeadReminders", () => ({
  useUpdateLeadReminder: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ success: true }),
    isPending: false,
  }),
}));

describe("Bloco C - Frontend: Google Meet & Atividades Comerciais", () => {
  describe("generateGoogleMeetUrl", () => {
    it("gera um link no formato https://meet.google.com/xxx-yyyy-zzz", () => {
      const url = generateGoogleMeetUrl();
      expect(url).toMatch(/^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
    });

    it("gera links únicos e aleatórios", () => {
      const url1 = generateGoogleMeetUrl();
      const url2 = generateGoogleMeetUrl();
      expect(url1).not.toBe(url2);
    });
  });

  describe("buildMeetingInviteMessage", () => {
    it("monta o convite com o nome do lead, dia da semana, hora e link do Google Meet", () => {
      const meetingDate = new Date("2026-10-16T15:00:00.000Z");
      const url = "https://meet.google.com/abc-defg-hij";
      const message = buildMeetingInviteMessage("Bia Spazio", meetingDate, url);

      expect(message).toContain("Olá Bia");
      expect(message).toContain("reunião está agendada para");
      expect(message).toContain("Link da nossa sala no Google Meet: https://meet.google.com/abc-defg-hij");
      expect(message).toContain("Te vejo lá!");
    });

    it("lida graciosamente com lead sem sobrenome ou nome genérico", () => {
      const meetingDate = new Date("2026-10-16T15:00:00.000Z");
      const url = "https://meet.google.com/abc-defg-hij";
      const message = buildMeetingInviteMessage("Lead", meetingDate, url);

      expect(message).toContain("Olá olá");
      expect(message).toContain(url);
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
