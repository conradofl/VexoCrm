import type { PromptType } from "@/hooks/usePrompts";

export const BACKEND_URL = "https://crm.vexoia.com";

export const PROMPT_CONFIGS: { type: PromptType; label: string; description: string }[] = [
  { type: "padrao", label: "Prompt Padrão (SPIN)", description: "Usado em todos os atendimentos inbound. Define o fluxo completo de qualificação." },
  { type: "extrato", label: "Extrato SDR", description: "Gera o briefing enviado ao SDR quando o lead finaliza a conversa." },
];
