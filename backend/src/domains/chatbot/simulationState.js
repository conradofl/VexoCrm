// backend/src/domains/chatbot/simulationState.js
//
// Memória do simulador "Testar antes de soltar", que agora mora na tela e vem
// no corpo de POST /api/chatbot-test. Antes ela ficava no lead de telefone
// fixo 5500000000000 — um lead fantasma por tenant, compartilhado por todos os
// agentes e usuários, que aparecia no Banco e entrava em "selecionar todos".
//
// O conteúdo vem do navegador, então é validado antes de chegar ao prompt:
// só papéis user/assistant (nunca "system"), só texto, com teto de tamanho.

const MAX_TURNOS = 80;
const MAX_CHARS_POR_FALA = 8000;
const MAX_BYTES_DADOS = 32 * 1024;
const PAPEIS = new Set(["user", "assistant"]);

function invalido(problem) {
  return { ok: false, problem };
}

/** Sem memória no corpo -> { ok: true, state: null } (chamada antiga, intacta). */
export function parseSimulationState(raw) {
  if (raw === undefined || raw === null) return { ok: true, state: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return invalido("simulacao deve ser um objeto");

  const historico = raw.historico ?? [];
  if (!Array.isArray(historico)) return invalido("simulacao.historico deve ser uma lista");
  if (historico.length > MAX_TURNOS) return invalido(`simulacao.historico passa de ${MAX_TURNOS} falas`);
  for (const fala of historico) {
    if (!fala || typeof fala !== "object" || !PAPEIS.has(fala.role)) {
      return invalido("simulacao.historico só aceita falas de 'user' e 'assistant'");
    }
    if (typeof fala.content !== "string" || fala.content.length > MAX_CHARS_POR_FALA) {
      return invalido(`cada fala precisa ser texto de até ${MAX_CHARS_POR_FALA} caracteres`);
    }
  }

  const dados = raw.dados ?? {};
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return invalido("simulacao.dados deve ser um objeto");
  if (JSON.stringify(dados).length > MAX_BYTES_DADOS) return invalido("simulacao.dados grande demais");

  return {
    ok: true,
    state: { historico: historico.map((f) => ({ role: f.role, content: f.content })), dados },
  };
}
