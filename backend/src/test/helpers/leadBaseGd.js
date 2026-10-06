// A base de teste com a forma MEDIDA em produção (geracao-digital, 06/10/2026): 24.655 leads; 6 tags de planilha (#Imp-…) com 17.843, 351, 58, 21, 4 e 2 leads
// (18.279 marcações em 18.162 leads, 73 com mais de uma: 50 com 2, 2 com 3, 21 com 4); agenda-whatsapp 5.050; nomes de grupo; rótulos da IA; marcações da pessoa.
import { AGENDA_WHATSAPP_TAG, CONVERSA_WHATSAPP_TAG } from "../../services/leadProcedencia.js";

export const N = 24_655;

// ── a base: distribuição medida em produção ────────────────────────────────────────────────────────────────────────────────
export const GRUPOS = [["VP Ofertas", 1011], ["Via Permuta 🇧🇷", 437], ["VP Uberlândia oficial", 300], ["#VIA PERMUTA BLACK", 79], ["Via Permuta Udia #2", 54], ["MARKETING ILÚMINUS", 13], ["Ofertas Via Permuta - -", 7], ["Bora pra resenha", 4]];
export const ROTULOS = [["Follow-up", 152], ["Dúvida", 136], ["Energia Solar", 89], ["Orçamento", 40], ["Fechamento", 18], ["Prioridade alta", 13], ["Não Convertido", 5], ["Óculos de Sol", 4]];
export const PLANILHAS = ["#Imp-clientes_2026", "#Imp-feira_abril", "#Imp-indicados", "#Imp-lista_vp", "#Imp-reativacao", "#Imp-janeiro"];
/** leads por tag de planilha, como medido */
export const PLANILHA_TAMANHOS = [17_843, 351, 58, 21, 4, 2];

export function montaBase() {
  const rows = Array.from({ length: N }, (_, i) => ({ i: i + 1, tags: [], dados: {} }));
  const add = (r, tag) => { if (!r.tags.includes(tag)) r.tags.push(tag); };
  // planilha, EXATAMENTE como medido: tag 0 em 17.843 leads; 73 desses também carregam outras tags (21 com 3 extras, 2 com 2, 50 com 1 = 117 marcas extras);
  // as 319 marcas restantes das tags 1..5 ficam em leads que só têm aquela tag. Total: 18.279 marcações em 18.162 leads.
  const [t0, t1, t2, t3, t4, t5] = PLANILHAS;
  for (let k = 0; k < PLANILHA_TAMANHOS[0]; k++) add(rows[k], t0);
  let m = 0;
  for (let k = 0; k < 21; k++, m++) { add(rows[m], t1); add(rows[m], t2); add(rows[m], t3); }
  for (let k = 0; k < 2; k++, m++) { add(rows[m], t1); add(rows[m], t2); }
  for (let k = 0; k < 50; k++, m++) add(rows[m], t1);
  // leads SEM a tag 0: o que falta de cada tag
  let solo = PLANILHA_TAMANHOS[0];
  const solos = [[t1, PLANILHA_TAMANHOS[1] - 73], [t2, PLANILHA_TAMANHOS[2] - 23], [t4, PLANILHA_TAMANHOS[4]], [t5, PLANILHA_TAMANHOS[5]]];
  for (const [tag, qtd] of solos) for (let k = 0; k < qtd; k++) add(rows[solo++], tag);
  // agenda-whatsapp: 5.050 leads, parte deles TAMBÉM em planilha
  for (let k = 0; k < 5_050; k++) add(rows[17_000 + k], AGENDA_WHATSAPP_TAG);
  // grupos: cada grupo marca os seus membros; 120 leads estão em DOIS grupos (o dados.grupo_nome guarda só o último, como o merge raso faz)
  let cursor = 20_000;
  for (const [nome, qtd] of GRUPOS) {
    for (let k = 0; k < qtd; k++) { const r = rows[cursor + k]; add(r, nome); r.dados.grupo_nome = nome; }
    cursor += qtd;
  }
  for (let k = 0; k < 120; k++) { const r = rows[20_000 + k]; add(r, "Via Permuta 🇧🇷"); r.dados.grupo_nome = "Via Permuta 🇧🇷"; }
  // rótulos da IA (sobrepostos às planilhas) e "WhatsApp WA" (conversa extraída)
  let c2 = 3_000;
  for (const [rot, qtd] of ROTULOS) { for (let k = 0; k < qtd; k++) add(rows[c2 + k], rot); c2 += 97; }
  for (let k = 0; k < 293; k++) add(rows[22_000 + k], CONVERSA_WHATSAPP_TAG);
  // marcações da pessoa (inclui uma com o MESMO nome de um grupo de OUTRA empresa)
  for (let k = 0; k < 300; k++) add(rows[100 + k], "vip");
  for (let k = 0; k < 50; k++) add(rows[600 + k], "Cliente Antigo");
  for (let k = 0; k < 7; k++) add(rows[900 + k], "Grupo da Outra Empresa");
  // alguns leads sem tag nenhuma (NULL) — o backfill tem que aguentar
  rows[24_000].tags = null;
  rows[24_001].tags = null;
  return rows;
}


export async function inserirBase(database, rows, client) {
  for (let start = 0; start < rows.length; start += 5000) {
    const chunk = rows.slice(start, start + 5000).map((r) => ({ telefone: `55${String(r.i).padStart(11, "0")}`, nome: `Lead ${r.i}`, tags: r.tags, dados: r.dados }));
    await database.query(
      `INSERT INTO leads (client_id, telefone, nome, tags, dados, created_at)
       SELECT $2, x.telefone, x.nome, x.tags, x.dados, timestamptz '2026-01-01' + (row_number() OVER ())::int * interval '1 second'
         FROM jsonb_to_recordset($1::jsonb) AS x(telefone text, nome text, tags text[], dados jsonb)`,
      [JSON.stringify(chunk), client]
    );
  }
}

