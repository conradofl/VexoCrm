import { monthsForPeriod } from "./packagePricing";

export interface ProposalCalculatedValues {
  setupOriginal: number;
  setupFinal: number;

  mensalidadeOriginal: number;
  mensalidadeFinal: number;

  mesesPeriodo: number;
  compromissoOriginal: number;
  compromissoFinal: number;
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

  // Sum any items in proposal.itens with recorrencia === "unico"
  const items = Array.isArray(proposal.itens) ? proposal.itens : [];
  const itemsSetup = items
    .filter(item => item.recorrencia === "unico")
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

  // Vexo avulsos: items in proposal that are Vexo but NOT the Vexo package itself.
  const vexoAvulsos = items.filter(item => {
    return item.categoria === "vexo" && item.product_id !== null && !item.descricao?.startsWith("Pacote Vexo") && item.recorrencia !== "unico";
  });
  const avulsosMonthly = vexoAvulsos.reduce((sum, item) => sum + Number(item.valor || 0), 0);

  // Legacy items (for backward compatibility):
  const legacyItems = items.filter(item => {
    return item.categoria === "gd" && Number(item.valor || 0) > 0 && !item.descricao?.startsWith("Pacote:") && item.recorrencia !== "unico";
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

  // Period Plano months:
  const planoPeriodoKey = proposal.periodo_plano || gdPkg?.periodo || vexoPkg?.periodo || "mensal";
  const mesesPeriodo = monthsForPeriod(planoPeriodoKey) || 1;

  const compromissoOriginal = mensalidadeOriginal * mesesPeriodo;
  const compromissoFinal = mensalidadeFinal * mesesPeriodo;

  return {
    setupOriginal: Math.round(setupOriginal * 100) / 100,
    setupFinal: Math.round(setupFinal * 100) / 100,
    mensalidadeOriginal: Math.round(mensalidadeOriginal * 100) / 100,
    mensalidadeFinal: Math.round(mensalidadeFinal * 100) / 100,
    mesesPeriodo,
    compromissoOriginal: Math.round(compromissoOriginal * 100) / 100,
    compromissoFinal: Math.round(compromissoFinal * 100) / 100
  };
}
