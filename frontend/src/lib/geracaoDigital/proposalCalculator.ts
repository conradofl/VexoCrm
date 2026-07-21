import { monthsForPeriod } from "./packagePricing";

export interface ProposalCalculatedValues {
  setupOriginal: number;
  setupFinal: number;

  mensalidadeOriginal: number;
  mensalidadeFinal: number;

  mesesPeriodo: number;
  compromissoOriginal: number;
  compromissoFinal: number;

  /** VP/permuta total, com a MESMA regra anti-bitributação dos valores. */
  vpTotal: number;
  /** Total geral derivado (setup + compromisso do período). Nunca ler valor_total do banco. */
  totalGeral: number;
}

// ---------------------------------------------------------------------------
// Regra anti-bitributação — FONTE ÚNICA.
// Um product_id que já compõe o pacote selecionado (linha de valor 0, sem
// prefixo de avulso/pacote) não pode somar de novo como avulso — nem em valor,
// nem em VP. Exportado para que o wizard use a mesma regra ao montar os itens.
// ---------------------------------------------------------------------------

// Módulo Vexo fantasma legado ("Inteligência de Atendimento", R$ 980, sem
// product_id): não pertence a nenhum pacote e foi injetado por fallback antigo.
export function isOrfaoLegado(item: any): boolean {
  return !item?.product_id && String(item?.descricao || "").includes("Inteligência de Atendimento");
}

export function buildIncludedProductIds(items: any[]): Set<string> {
  return new Set(
    (items || [])
      .filter((item) =>
        item?.product_id &&
        Number(item.valor || 0) === 0 &&
        !item.descricao?.startsWith("GD:") &&
        !item.descricao?.startsWith("Vexo OS:") &&
        !item.descricao?.startsWith("Pacote:") &&
        !item.descricao?.startsWith("Pacote Vexo:")
      )
      .map((item) => item.product_id)
  );
}

/** true quando o item NÃO é uma repetição de algo que já vem no pacote. */
export function isNaoInclusoNoPacote(item: any, includedProductIds: Set<string>): boolean {
  return !(item?.product_id && includedProductIds.has(item.product_id));
}

/**
 * VP total dos itens, deduplicado. Antes o wizard fazia `totalVp += vp` por
 * pacote + cada avulso marcado, sem dedupe: um produto que está no pacote E
 * aparece como avulso contava duas vezes (e ao editar, TODO o conteúdo do
 * pacote vira avulso, multiplicando o VP).
 */
export function computeVpFromItems(items: any[]): number {
  const clean = (items || []).filter((i) => !isOrfaoLegado(i));
  const included = buildIncludedProductIds(clean);
  const total = clean
    .filter((item) => isNaoInclusoNoPacote(item, included))
    .reduce((sum, item) => sum + Number(item?.valor_vp || 0), 0);
  return Math.round(total * 100) / 100;
}

export interface ProposalLike {
  cobrar_setup?: boolean;
  valor_setup_vexo?: number | string | null;
  package_id?: string | null;
  package_vexo_id?: string | null;
  periodo_plano?: string | null;
  descontos_concedidos?: any[] | null;
  itens?: any[] | null;
}

export function calculateProposalValues(
  proposal: ProposalLike,
  availablePackages: any[] = []
): ProposalCalculatedValues {
  const cobrarSetup = !!proposal.cobrar_setup;
  const valorSetupVexo = Number(proposal.valor_setup_vexo || 0);

  // Find selected packages in catalog
  const gdPkg = availablePackages.find(p => p.id === proposal.package_id && (p.tipo === "gd" || !p.tipo));
  const vexoPkg = availablePackages.find(p => p.id === proposal.package_vexo_id && p.tipo === "vexo");

  // Setup original: base value is the optional Vexo Setup
  let setupOriginal = cobrarSetup ? valorSetupVexo : 0;

  const itemsRaw = Array.isArray(proposal.itens) ? proposal.itens : [];

  // Remove o módulo fantasma legado e aplica a regra anti-bitributação
  // (helpers exportados acima = fonte única, usada também pelo wizard).
  const items = itemsRaw.filter(item => !isOrfaoLegado(item));
  const includedProductIds = buildIncludedProductIds(items);
  const naoInclusoNoPacote = (item: any) => isNaoInclusoNoPacote(item, includedProductIds);

  // Setup: itens únicos avulsos, excluindo os que já compõem o pacote.
  const itemsSetup = items
    .filter(item => item.recorrencia === "unico" && naoInclusoNoPacote(item))
    .reduce((sum, item) => sum + Number(item.valor || 0), 0);
  setupOriginal += itemsSetup;

  // If items array is empty (e.g. during wizard draft creation), check package definitions directly:
  if (items.length === 0) {
    if (gdPkg && gdPkg.periodo === "unico") {
      setupOriginal += Number(gdPkg.valor || 0);
    }
    if (vexoPkg && vexoPkg.periodo === "unico") {
      setupOriginal += Number(vexoPkg.valor || 0);
    }
  }

  // Setup final after discounts/concessions
  let setupFinal = setupOriginal;
  const descontosConcedidos = Array.isArray(proposal.descontos_concedidos) ? proposal.descontos_concedidos : [];

  // Find setup trilha concessions (excluding parcelamento)
  const setupTrilhaConcessions = descontosConcedidos.filter(d => d.trilha === "setup" && d.tipo !== "parcelamento");
  if (setupTrilhaConcessions.length > 0) {
    setupFinal = Number(setupTrilhaConcessions[setupTrilhaConcessions.length - 1].valor_final || 0);
  }

  // Monthly Original
  let gdMonthly = 0;
  if (gdPkg && gdPkg.periodo !== "unico") {
    const months = monthsForPeriod(gdPkg.periodo) || 1;
    gdMonthly = Number(gdPkg.valor || 0) / months;
  } else {
    // Fallback: read directly from the saved item
    const savedGdPkgItem = items.find(i => i.categoria === "gd" && i.recorrencia === "mensal" && i.descricao?.startsWith("Pacote:"));
    if (savedGdPkgItem) {
      gdMonthly = Number(savedGdPkgItem.valor || 0);
    }
  }

  let vexoMonthly = 0;
  if (vexoPkg && vexoPkg.periodo !== "unico") {
    const months = monthsForPeriod(vexoPkg.periodo) || 1;
    vexoMonthly = Number(vexoPkg.valor || 0) / months;
  } else {
    // Fallback: read directly from the saved item
    const savedVexoPkgItem = items.find(i => i.categoria === "vexo" && i.recorrencia === "mensal" && i.descricao?.startsWith("Pacote Vexo:"));
    if (savedVexoPkgItem) {
      vexoMonthly = Number(savedVexoPkgItem.valor || 0);
    }
  }

  // Vexo avulsos: items in proposal that are Vexo but NOT the Vexo package itself
  // nem já inclusos no pacote selecionado.
  const vexoAvulsos = items.filter(item => {
    return item.categoria === "vexo" && item.product_id !== null && !item.descricao?.startsWith("Pacote Vexo") && item.recorrencia !== "unico" && naoInclusoNoPacote(item);
  });
  const avulsosMonthly = vexoAvulsos.reduce((sum, item) => sum + Number(item.valor || 0), 0);

  // Legacy items (for backward compatibility): itens GD avulsos com valor,
  // excluindo os que já compõem o pacote selecionado.
  const legacyItems = items.filter(item => {
    return item.categoria === "gd" && Number(item.valor || 0) > 0 && !item.descricao?.startsWith("Pacote:") && item.recorrencia !== "unico" && naoInclusoNoPacote(item);
  });
  const legacyMonthly = legacyItems.reduce((sum, item) => sum + Number(item.valor || 0), 0);

  const faturamentoMensalItems = items.filter(item => {
    return item.recorrencia === "mensal" && item.product_id === null && !item.descricao?.startsWith("Pacote:") && !item.descricao?.startsWith("Pacote Vexo:");
  });
  const faturamentoMensalExtra = faturamentoMensalItems.reduce((sum, item) => sum + Number(item.valor || 0), 0);

  const mensalidadeOriginal = gdMonthly + vexoMonthly + avulsosMonthly + legacyMonthly + faturamentoMensalExtra;
  let mensalidadeFinal = mensalidadeOriginal;

  // Apply monthly discount layers
  const mensalidadeTrilhaConcessions = descontosConcedidos.filter(d => d.trilha === "mensalidade");
  if (mensalidadeTrilhaConcessions.length > 0) {
    mensalidadeFinal = Number(mensalidadeTrilhaConcessions[mensalidadeTrilhaConcessions.length - 1].valor_final || 0);
  }

  // Meses do contrato (Compromisso do Período): robusto mesmo sem availablePackages.
  // Ordem: periodo_plano da proposta → período do pacote (catálogo) →
  // metadados do item "Pacote:" salvo na proposta → mensal.
  const pkgItem = items.find(i =>
    i.descricao?.startsWith("Pacote:") || i.descricao?.startsWith("Pacote Vexo:")
  );
  const mesesFromItem = pkgItem && Number(pkgItem.meses) > 0 ? Number(pkgItem.meses) : null;
  const planoPeriodoKey = proposal.periodo_plano || gdPkg?.periodo || vexoPkg?.periodo || pkgItem?.periodo || "mensal";
  const mesesPeriodo = mesesFromItem || monthsForPeriod(planoPeriodoKey) || 1;

  const compromissoOriginal = mensalidadeOriginal * mesesPeriodo;
  const compromissoFinal = mensalidadeFinal * mesesPeriodo;

  // VP pela MESMA regra de dedupe (antes era somado solto no wizard).
  const vpTotal = computeVpFromItems(items);
  // Total geral SEMPRE derivado: setup final + compromisso do período.
  // Nunca usar gd_proposals.valor_total (o backend recomputa sem dedupe e infla).
  const totalGeral = Math.round((setupFinal + compromissoFinal) * 100) / 100;

  return {
    setupOriginal: Math.round(setupOriginal * 100) / 100,
    setupFinal: Math.round(setupFinal * 100) / 100,
    mensalidadeOriginal: Math.round(mensalidadeOriginal * 100) / 100,
    mensalidadeFinal: Math.round(mensalidadeFinal * 100) / 100,
    mesesPeriodo,
    compromissoOriginal: Math.round(compromissoOriginal * 100) / 100,
    compromissoFinal: Math.round(compromissoFinal * 100) / 100,
    vpTotal,
    totalGeral
  };
}
