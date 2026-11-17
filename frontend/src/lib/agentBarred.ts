// Mensagem do lead que o robô NÃO respondeu por um motivo gravado nela (lead_messages.meta.agente_barrado), pelo
// backend (services/inboundAge.js): mensagem que a Evolution entregou com mais de 30 min de atraso, ou envio do robô
// sem confirmação. A conversa aparece em "Esperam você" com o motivo, sem pausar o agente.

export type MotivoAgenteBarrado = { codigo: string; curto: string; longo: string };

const ROTULOS: Record<string, { curto: string; longo: string }> = {
  mensagem_atrasada: { curto: "Chegou atrasada", longo: "mensagem chegou atrasada" },
  envio_sem_confirmacao: { curto: "Envio sem confirmação", longo: "envio do robô sem confirmação" },
};

export function motivoAgenteBarrado(meta: unknown): MotivoAgenteBarrado | null {
  const codigo = meta && typeof meta === "object" ? (meta as Record<string, unknown>).agente_barrado : null;
  if (typeof codigo !== "string" || !codigo.trim()) return null;
  const rotulo = ROTULOS[codigo] || { curto: "Robô não respondeu", longo: codigo.replace(/_/g, " ") };
  return { codigo, ...rotulo };
}
