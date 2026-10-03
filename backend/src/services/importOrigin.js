// Origem de um lead que chega por importação de planilha (POST /api/leads/import-csv).
//
// A origem é um fato: ou a pessoa informou um canal (tag de canal na importação, tag de canal na linha,
// coluna de origem na planilha), ou a planilha é vendas fechadas, ou NÃO se sabe o canal — e então a
// origem é a própria importação. Nunca se inventa um canal que ninguém escolheu.

export const IMPORT_CHANNEL_RE = /instagram|facebook|linkedin|tiktok|direct|messenger/i;

/** Origem quando ninguém informou canal: a própria importação. */
export const IMPORT_ORIGIN_LABEL = "Importação de planilha";
export const IMPORT_ORIGIN_KEY = "importacao_planilha";

export const CLOSED_SALES_ORIGIN_LABEL = "Importação Vendas Fechadas";
export const CLOSED_SALES_ORIGIN_KEY = "vendas_fechadas";

/**
 * @returns {{ originTag: string | null, origem: string, origemMarketing: string, leadSource: string }}
 *  `originTag` é a tag de origem a somar às tags do lead — ou null quando a origem é a própria importação
 *  (a tag da importação já a representa; criar outra seria redundante e falsa).
 */
export function resolveImportOrigin({ importTags = [], rowTags = [], rowOrigem = null, isClosedSales = false }) {
  const channelTag =
    importTags.find((t) => IMPORT_CHANNEL_RE.test(t)) || rowTags.find((t) => IMPORT_CHANNEL_RE.test(t)) || null;

  if (channelTag) {
    return { originTag: channelTag, origem: channelTag, origemMarketing: isClosedSales ? CLOSED_SALES_ORIGIN_KEY : channelTag, leadSource: isClosedSales ? CLOSED_SALES_ORIGIN_KEY : channelTag };
  }
  if (isClosedSales) {
    return {
      originTag: CLOSED_SALES_ORIGIN_LABEL,
      origem: CLOSED_SALES_ORIGIN_LABEL,
      origemMarketing: CLOSED_SALES_ORIGIN_KEY,
      leadSource: CLOSED_SALES_ORIGIN_KEY,
    };
  }
  const column = rowOrigem === null || rowOrigem === undefined ? "" : String(rowOrigem).trim();
  if (column) {
    return { originTag: column, origem: column, origemMarketing: column, leadSource: column };
  }
  return { originTag: null, origem: IMPORT_ORIGIN_LABEL, origemMarketing: IMPORT_ORIGIN_KEY, leadSource: IMPORT_ORIGIN_KEY };
}
