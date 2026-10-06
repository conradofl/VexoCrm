// Procedência × rótulo da IA × marcação da pessoa.
//
// O campo `tags` do lead guardava TRÊS coisas ao mesmo tempo:
//   - procedência: o nome do grupo de onde o contato foi extraído, `agenda-whatsapp`, `WhatsApp WA` (conversa extraída),
//     `#Imp-<arquivo>` (importação de planilha);
//   - palpite da IA/heurística sobre a conversa: Orçamento, Fechamento, Follow-up, Energia Solar…;
//   - marcação da própria pessoa.
// Quem filtra por planilha disputava espaço com o que o robô achou da conversa.
//
// Esta leva é ADITIVA: a procedência e os rótulos da IA ganham campo próprio em `dados` (sem migration de schema), as tags continuam
// sendo gravadas como sempre (o dono tem filtros e campanhas em cima delas) e nada é removido.
//
//   dados.procedencia = { grupos: string[], agenda_whatsapp: boolean, conversa_whatsapp: boolean }
//   dados.rotulos_ia  = string[]   (só da lista fechada AI_LABELS)
//
// A importação de planilha NÃO precisa de campo novo: a procedência verdadeira dela é `dados.import_ids` (não editável, registrada em lead_imports).

/**
 * A lista FECHADA de rótulos que a IA/heurística pode gravar. Quem define é o dono: os 8 medidos em produção (geracao-digital, 06/10/2026).
 * Rótulo fora da lista NÃO é gravado — nem como tag, nem no campo. Ficaram de fora, de propósito: "Campanha" (colide com o canal de marketing de
 * mesmo nome: duas coisas, uma palavra) e "Prótese" (não existe em produção e a lista não deve nascer com o vocabulário de um cliente só).
 *
 * PENDÊNCIA DECLARADA (não fazer agora): esta lista é GLOBAL e deveria ser POR EMPRESA. "Energia Solar" e "Óculos de Sol" só fazem sentido para
 * quem vende isso; outro cliente precisa do vocabulário dele. O ponto de troca é este (AI_LABELS) e o espelho SQL do backfill
 * (ops/sql/2026-10-06-backfill-procedencia.sql, conferido por teste).
 */
export const AI_LABELS = Object.freeze([
  "Fechamento",
  "Orçamento",
  "Dúvida",
  "Não Convertido",
  "Óculos de Sol",
  "Energia Solar",
  "Prioridade alta",
  "Follow-up",
]);

/** Tag que o classificador grava quando nenhum rótulo se aplica: é procedência (conversa extraída do WhatsApp), não palpite. */
export const CONVERSA_WHATSAPP_TAG = "WhatsApp WA";
export const AGENDA_WHATSAPP_TAG = "agenda-whatsapp";
export const IMPORT_TAG_PREFIX = "#Imp-";

export const TAG_KINDS = Object.freeze(["planilha", "origem", "ia", "minhas"]);

const AI_LABEL_SET = new Set(AI_LABELS);

/**
 * Tipo de uma tag, pelo que já dá para saber (nesta ordem): prefixo `#Imp-` → planilha; `agenda-whatsapp`, `WhatsApp WA` ou nome de grupo
 * extraído → origem; rótulo da lista fechada → ia; o resto → minhas. `groupNames` = nomes de grupo que algum lead da empresa guarda em
 * dados.grupo_nome. Uma marcação da pessoa idêntica a um rótulo da IA ("Follow-up") não é distinguível e aparece como rótulo da IA.
 */
export function classifyTagKind(tag, groupNames = new Set()) {
  const t = String(tag ?? "");
  if (t.toLowerCase().startsWith(IMPORT_TAG_PREFIX.toLowerCase())) return "planilha";
  if (t === AGENDA_WHATSAPP_TAG || t === CONVERSA_WHATSAPP_TAG || groupNames.has(t)) return "origem";
  if (AI_LABEL_SET.has(t)) return "ia";
  return "minhas";
}

/**
 * Separa o que a classificação trouxe: rótulos da lista fechada (vão para dados.rotulos_ia e continuam nas tags), a tag de conversa extraída
 * (procedência) e o que sobrou (descartado: a IA não inventa rótulo que caia onde a pessoa marca).
 */
export function sanitizeAiLabels(tags) {
  const rotulos = [];
  const descartados = [];
  let conversaWhatsapp = false;
  for (const raw of Array.isArray(tags) ? tags : []) {
    const t = String(raw ?? "").trim();
    if (!t) continue;
    if (t === CONVERSA_WHATSAPP_TAG) conversaWhatsapp = true;
    else if (AI_LABEL_SET.has(t)) {
      if (!rotulos.includes(t)) rotulos.push(t);
    } else if (!descartados.includes(t)) descartados.push(t);
  }
  return { rotulos, descartados, conversaWhatsapp };
}

/** dados.procedencia para os três pontos de extração. */
export const procedenciaDoGrupo = (nomeDoGrupo) => ({ grupos: [String(nomeDoGrupo)], agenda_whatsapp: false, conversa_whatsapp: false });
export const procedenciaDaAgenda = () => ({ grupos: [], agenda_whatsapp: true, conversa_whatsapp: false });
export const procedenciaDaConversa = () => ({ grupos: [], agenda_whatsapp: false, conversa_whatsapp: true });

/**
 * União de duas procedências. O merge de `dados` é raso: sem isto o lead que aparece num segundo grupo, ou na agenda depois de um grupo,
 * perderia a procedência anterior (as tags acumulam; o campo novo também tem que acumular).
 */
export function mergeProcedencia(prev, next) {
  const a = prev && typeof prev === "object" ? prev : null;
  const b = next && typeof next === "object" ? next : null;
  if (!a && !b) return null;
  const grupos = [];
  for (const list of [a?.grupos, b?.grupos]) {
    if (!Array.isArray(list)) continue;
    for (const g of list) if (g && !grupos.includes(String(g))) grupos.push(String(g));
  }
  return {
    grupos,
    agenda_whatsapp: Boolean(a?.agenda_whatsapp || b?.agenda_whatsapp),
    conversa_whatsapp: Boolean(a?.conversa_whatsapp || b?.conversa_whatsapp),
  };
}
