import type { SegmentScenario } from "@/pages/demoSegments";
import type { CurrentStepData, Message, RoiResult } from "./types";

// Extraído de src/pages/VexoPitch.tsx (Onda 4 Run F9) — movimento puro, sem alteração de forma.

// Play synthetic double-chime ding sound for Step 5
export function playNotificationSound(): void {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.type = "sine";
    // Double chime
    oscillator.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
    oscillator.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.1); // A5

    gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);

    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.35);
  } catch (e) {
    console.warn("Could not play notification sound", e);
  }
}

export function formatText(text: string | undefined, prospectName: string, defaultProspectName: string): string {
  if (!text) return "";
  return text.replace(/\{\{prospectName\}\}/g, prospectName || defaultProspectName);
}

// Chat History generation
export function buildChatHistory(
  segment: SegmentScenario,
  simStep: number,
  selectedObjection: string,
  selectedQualification: string,
  selectedPeriod: string,
  selectedSlot: string
): Message[] {
  const list: Message[] = [];

  // Step 1 Greeting (always show)
  list.push({ sender: "system", text: segment.steps.step1.action, time: "14:00" });
  list.push({ sender: "bot", text: segment.steps.step1.botMsg, time: "14:01" });

  // Step 2 Objection Contortion
  if (simStep >= 2 && selectedObjection) {
    const s2 = segment.steps.step2[selectedObjection];
    if (s2) {
      list.push({ sender: "lead", text: s2.leadMsg || "", time: "14:03" });
      list.push({ sender: "bot", text: s2.botMsg, time: "14:04" });
    }
  }

  // Step 3 Qualification
  if (simStep >= 3 && selectedQualification) {
    const s3 = segment.steps.step3[selectedQualification];
    if (s3) {
      list.push({ sender: "lead", text: s3.leadMsg || "", time: "14:06" });
      list.push({ sender: "bot", text: s3.botMsg, time: "14:07" });
    }
  }

  // Step 4 Calendar Period Selection
  if (simStep >= 4 && selectedPeriod) {
    const s4 = segment.steps.step4[selectedPeriod];
    if (s4) {
      list.push({ sender: "lead", text: s4.leadMsg || "", time: "14:09" });
      list.push({ sender: "bot", text: s4.botMsg, time: "14:10" });
    }
  }

  // Step 5 Handoff Confirm
  if (simStep >= 5 && selectedSlot) {
    const s5 = segment.steps.step5[selectedSlot];
    if (s5) {
      list.push({ sender: "lead", text: s5.leadMsg || "", time: "14:12" });
      list.push({ sender: "bot", text: s5.botMsg, time: "14:13" });
      list.push({ sender: "system", text: s5.action, time: "14:14" });
    }
  }

  return list;
}

// AI thoughts and configuration instructions panel data
export function buildCurrentStepData(
  segment: SegmentScenario,
  simStep: number,
  selectedObjection: string,
  selectedQualification: string,
  selectedPeriod: string,
  selectedSlot: string
): CurrentStepData {
  if (simStep === 1) {
    return {
      title: "Passo 1/5: Abordagem Automática",
      reasoning: segment.steps.step1.reasoning,
      training: segment.steps.step1.training,
      action: "Vexo Engine disparou o gatilho da campanha.",
    };
  }
  if (simStep === 2 && selectedObjection) {
    const s2 = segment.steps.step2[selectedObjection];
    return {
      title: "Passo 2/5: Contorno de Objeção",
      reasoning: s2.reasoning,
      training: s2.training,
      action: s2.action,
    };
  }
  if (simStep === 3 && selectedQualification) {
    const s3 = segment.steps.step3[selectedQualification];
    return {
      title: "Passo 3/5: Qualificação Ativa",
      reasoning: s3.reasoning,
      training: s3.training,
      action: s3.action,
    };
  }
  if (simStep === 4 && selectedPeriod) {
    const s4 = segment.steps.step4[selectedPeriod];
    return {
      title: "Passo 4/5: Proposta de Agenda",
      reasoning: s4.reasoning,
      training: s4.training,
      action: s4.action,
    };
  }
  if (simStep === 5 && selectedSlot) {
    const s5 = segment.steps.step5[selectedSlot];
    return {
      title: "Passo 5/5: Agendado & Handoff Closer",
      reasoning: s5.reasoning,
      training: s5.training,
      action: s5.action,
    };
  }
  return {
    title: "Vexo AI Simulator",
    reasoning: "Aguardando interação...",
    training: "Configuração de IA ativa.",
    action: "Nenhuma ação ativa.",
  };
}

// Calculations for ROI slide (aligned with math tests)
export function computeRoi(leadsCount: number, customTicket: number, customConv: number): RoiResult {
  const qualifiedLeads = Math.round(leadsCount * 0.8);
  const operatorHoursSaved = Math.round((qualifiedLeads * 12) / 60);
  const currentSales = Math.round(leadsCount * (customConv / 100));
  const estimatedVexoSales = Math.round(currentSales * 1.30);
  const extraSales = Math.max(1, estimatedVexoSales - currentSales);
  const additionalRevenue = (leadsCount * (customConv / 100)) * customTicket;

  return { qualifiedLeads, operatorHoursSaved, currentSales, estimatedVexoSales, extraSales, additionalRevenue };
}
