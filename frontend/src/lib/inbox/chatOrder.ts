// Ordem da lista de conversas na tela.
// "Esperam você" e "Esfriaram" chegam do servidor com o mais parado primeiro
// (tempo desde a última mensagem DO LEAD); a tela não pode reordenar.
// Nas demais abas, a conversa com mensagem mais recente sobe para o topo.
export const SERVER_ORDERED_TABS: ReadonlySet<string> = new Set(["esperam", "esfriaram"]);

export function orderChatsForTab<T extends { timestamp: number | null }>(list: T[], tab: string): T[] {
  if (SERVER_ORDERED_TABS.has(tab)) return list;
  return [...list].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
}
