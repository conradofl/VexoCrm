import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Etapa 5 Commit 3 — checagem estrutural de que a faixa "Próximos N dias" e o
// calendário estão de fato ligados nos pontos exigidos, e que o calendário
// reaproveita a ação de cancelar já existente em vez de inventar uma nova rota.

describe("faixa 'Próximos N dias' aparece nos dois lugares exigidos", () => {
  const cadenceEditorSource = readFileSync(resolve("src/components/followup/CadenceEditor.tsx"), "utf8");
  const applyModalSource = readFileSync(resolve("src/components/followup/ApplyFollowupModal.tsx"), "utf8");
  const upcomingStripSource = readFileSync(resolve("src/components/followup/UpcomingStrip.tsx"), "utf8");

  it("CadenceEditor.tsx usa UpcomingStrip com o hook useUpcomingWindow", () => {
    expect(cadenceEditorSource).toContain("useUpcomingWindow");
    expect(cadenceEditorSource).toContain("<UpcomingStrip");
  });

  it("ApplyFollowupModal.tsx (arquivo EXISTENTE, não um ApplyCadenceModal novo) usa UpcomingStrip projetando leads.length", () => {
    expect(applyModalSource).toContain("<UpcomingStrip");
    expect(applyModalSource).toContain("projectLeads=${leads.length}");
  });

  it("UpcomingStrip: o vermelho (overLimit) vem do total do chip, nunca da fração isolada da cadência", () => {
    expect(upcomingStripSource).toContain("d.overLimit");
    // Não deve existir uma comparação alternativa tipo cadencePending > chipLimit
    expect(upcomingStripSource).not.toMatch(/cadencePending\s*>\s*chipLimit/);
  });
});

describe("jitter anti-ban exposto na UI da cadência", () => {
  const cadenceEditorSource = readFileSync(resolve("src/components/followup/CadenceEditor.tsx"), "utf8");

  it("CadenceEditor.tsx tem input de jitter que salva via dispatch_jitter_minutes", () => {
    expect(cadenceEditorSource).toContain("jitter-input");
    expect(cadenceEditorSource).toContain("dispatch_jitter_minutes");
  });
});

describe("calendário: lente, não superfície de criação", () => {
  const calendarSource = readFileSync(resolve("src/components/followup/FollowupCalendar.tsx"), "utf8");
  const queueSource = readFileSync(resolve("src/pages/FollowupQueue.tsx"), "utf8");

  it("FollowupCalendar.tsx não cria nem arrasta nada — só lê os hooks de calendário", () => {
    expect(calendarSource).toContain("useFollowupCalendarMonth");
    expect(calendarSource).toContain("useFollowupCalendarDay");
    expect(calendarSource).not.toContain("useCreateFupTemplate");
    expect(calendarSource).not.toContain("draggable");
    expect(calendarSource).not.toContain("onDrop");
  });

  it("cancelar um passo no calendário REAPROVEITA useCancelFollowupJob (rota já existente), não inventa endpoint novo", () => {
    expect(calendarSource).toContain("useCancelFollowupJob");
    expect(calendarSource).not.toMatch(/fetch\(.*\/api\/followup/);
  });

  it("'abrir a conversa' usa o deep link real do inbox (/crm/whatsapp?phone=), mesmo padrão do WhatsAppInbox.tsx", () => {
    expect(calendarSource).toContain("/crm/whatsapp?phone=");
  });

  it("FollowupQueue.tsx expõe o Calendário como uma aba própria, ao lado de Cadências e Fila", () => {
    expect(queueSource).toContain('"calendario"');
    expect(queueSource).toContain("<FollowupCalendar");
  });
});
