// "De onde tirar" o lote (24/11/2026). Pedido do Conrado: separar lote só de uma tag (ex.: os 685 clientes da Tinge),
// de uma planilha ou do filtro que está na tela, sem exportar para Excel e importar de novo.
//
// A origem vira uma lista de ids de lead pela MESMA consulta da tabela do Banco (queryLeadIds + parseLeadListFilters):
// o que a tela mostra com aquele filtro é exatamente o grupo de onde o lote sai.
import { ImportError } from "./leadImportBatches.js";
import { parseLeadListFilters, queryLeadIds } from "./leadListQuery.js";

export const ORIGEM_TIPOS = ["empresa", "tag", "planilha", "filtro"];

const texto = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * Lê a origem vinda da tela (objeto, ou texto JSON numa query string). Sem origem = empresa inteira.
 * @returns {{ tipo: "empresa" } | { tipo: "tag", tag: string } | { tipo: "planilha", importId: string } | { tipo: "filtro", filtro: object }}
 */
export function lerOrigem(valor) {
  let o = valor;
  if (typeof o === "string") {
    if (!o.trim()) return { tipo: "empresa" };
    try {
      o = JSON.parse(o);
    } catch {
      throw new ImportError(400, "INVALID_BATCH_ORIGIN", "Origem do lote inválida.");
    }
  }
  if (o === null || o === undefined) return { tipo: "empresa" };
  if (typeof o !== "object") throw new ImportError(400, "INVALID_BATCH_ORIGIN", "Origem do lote inválida.");
  const tipo = texto(o.tipo) || "empresa";
  if (!ORIGEM_TIPOS.includes(tipo)) throw new ImportError(400, "INVALID_BATCH_ORIGIN", `Origem do lote desconhecida: ${tipo}.`);
  if (tipo === "empresa") return { tipo };
  if (tipo === "tag") {
    const tag = texto(o.tag);
    if (!tag) throw new ImportError(400, "INVALID_BATCH_ORIGIN", "Escolha a tag de onde tirar o lote.");
    return { tipo, tag };
  }
  if (tipo === "planilha") {
    const importId = texto(o.importId);
    if (!importId) throw new ImportError(400, "INVALID_BATCH_ORIGIN", "Escolha a planilha de onde tirar o lote.");
    return { tipo, importId };
  }
  const filtro = o.filtro && typeof o.filtro === "object" ? o.filtro : null;
  if (!filtro) throw new ImportError(400, "INVALID_BATCH_ORIGIN", "Filtro da tela não veio.");
  return { tipo, filtro };
}

function filtrosDaOrigem(origem) {
  if (origem.tipo === "tag") return { tag: origem.tag };
  if (origem.tipo === "planilha") return { importId: origem.importId };
  return origem.filtro;
}

/**
 * Ids de lead da origem, no escopo de quem pediu (mesmo escopo da tabela). Empresa inteira devolve null (sem restrição).
 * Grupo vazio devolve [] (a prévia mostra zero; separar não cria planilha).
 */
export async function idsDaOrigem(pool, { origem, scope }) {
  if (!origem || origem.tipo === "empresa") return null;
  const parsed = parseLeadListFilters(filtrosDaOrigem(origem));
  if (parsed.problem) throw new ImportError(400, "INVALID_BATCH_ORIGIN", parsed.problem);
  const { ids, truncated } = await queryLeadIds(pool, { scope, filters: parsed.filters });
  if (truncated) {
    throw new ImportError(400, "BATCH_ORIGIN_TOO_LARGE", "Grupo grande demais para separar de uma vez. Filtre mais e tente de novo.");
  }
  return ids;
}

/** Texto curto da origem, gravado na planilha criada (para saber depois de onde o lote saiu). */
export function rotuloDaOrigem(origem) {
  if (!origem || origem.tipo === "empresa") return "Empresa inteira";
  if (origem.tipo === "tag") return `Tag: ${origem.tag}`;
  if (origem.tipo === "planilha") return "Planilha";
  const f = origem.filtro || {};
  const partes = [];
  if (texto(f.tag) && f.tag !== "all") partes.push(`tag ${f.tag}`);
  if (texto(f.search)) partes.push(`busca "${texto(f.search)}"`);
  if (texto(f.stage) && f.stage !== "all") partes.push(`estágio ${f.stage}`);
  if (texto(f.importId) && f.importId !== "all") partes.push("planilha");
  return partes.length ? `Filtro: ${partes.join(", ")}` : "Filtro da tela";
}
