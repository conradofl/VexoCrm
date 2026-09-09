import { monthsForPeriod } from "./packagePricing";

export interface ProposalCalculatedValues {
  setupOriginal: number;
  setupFinal: number;

  mensalidadeOriginal: number;
  mensalidadeFinal: number;

  mesesPeriodo: number;
  compromissoOriginal: number;
  compromissoFinal: number;

  /** VP / Permuta comercial */
  temVp: boolean;
  vpMensal: number;
  vpPeriodo: number;
  dinheiroMensal: number;
  dinheiroPeriodo: number;
  vpPercent: number;

  /** VP/permuta total, com a MESMA regra anti-bitributação dos valores. */
  vpTotal: number;
  /** Total geral derivado (setup + compromisso do período). Nunca ler valor_total do banco. */
  totalGeral: number;

  descontoSetupPorcentagem: number;
  descontoMensalPorcentagem: number;

  isCombo: boolean;
  repasseVexoMensal: number;
  repasseVexoSetup: number;
  repasseVexoPercentual: number;
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

// ---------------------------------------------------------------------------
// Recorrência — NORMALIZAÇÃO. Existem dois vocabulários para a mesma ideia:
// o catálogo (gd_products.recorrencia) grava "pontual" e o wizard grava "unico".
// Todo o cálculo testava só "unico", então os 12 produtos GD cadastrados como
// "pontual" (Landing page, Logomarca, Panfletos, Vídeo avulso...) ficavam de
// fora do setup E entravam na mensalidade — multiplicados pelos meses do
// período. Ex.: Landing page R$ 2.500 pontual virava R$ 15.000 num semestral.
// Nunca comparar recorrencia por string solta: usar os predicados abaixo.
// ---------------------------------------------------------------------------

const RECORRENCIAS_UNICAS = new Set(["unico", "único", "pontual", "avulso", "unica", "única"]);

/** true quando o item é cobrado UMA vez (setup), não todo mês. */
export function isCobrancaUnica(item: any): boolean {
  return RECORRENCIAS_UNICAS.has(String(item?.recorrencia ?? "mensal").trim().toLowerCase());
}

/** true quando o item compõe a mensalidade. */
export function isCobrancaMensal(item: any): boolean {
  return !isCobrancaUnica(item);
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

/** Linha que representa o pacote em si (não o conteúdo dele). */
export function isLinhaDePacote(item: any): boolean {
  const d = String(item?.descricao || "");
  return d.startsWith("Pacote:") || d.startsWith("Pacote Vexo:");
}

// ---------------------------------------------------------------------------
// PACOTE FECHADO — regra de negócio.
// Escolheu pacote, o preço do pacote É o preço. Nada mais entra em setup nem em
// mensalidade: nem avulso, nem pontual, nem extra. O único setup cobrável é o
// do sistema Vexo (`valor_setup_vexo`), que não pertence ao pacote GD.
// O dedupe por product_id continua existindo para quem NÃO tem pacote e para o
// escopo exibido, mas deixou de ser o que segura o valor: sem pacote não há o
// que duplicar, com pacote nada soma.
// ---------------------------------------------------------------------------
export function temPacote(items: any[]): boolean {
  return (items || []).some(isLinhaDePacote);
}

/**
 * VP total. Com pacote escolhido, só o VP das linhas de pacote conta — mesma
 * regra do valor em reais. Sem pacote, soma os itens deduplicados.
 */
export function computeVpFromItems(items: any[]): number {
  const clean = (items || []).filter((i) => !isOrfaoLegado(i));
  const base = temPacote(clean)
    ? clean.filter(isLinhaDePacote)
    : clean.filter((item) => isNaoInclusoNoPacote(item, buildIncludedProductIds(clean)));
  const total = base.reduce((sum, item) => sum + Number(item?.valor_vp || 0), 0);
  return Math.round(total * 100) / 100;
}

export interface ProposalLike {
  cobrar_setup?: boolean;
  valor_setup_vexo?: number | string | null;
  valor_vp?: number | string | null;
  vp_percent?: number | string | null;
  vpPercent?: number | string | null;
  package_id?: string | null;
  package_vexo_id?: string | null;
  periodo_plano?: string | null;
  itens?: any[] | null;
  desconto_setup_pct?: number | null;
  desconto_mensal_pct?: number | null;
  descontoSetupPorcentagem?: number | null;
  descontoMensalPorcentagem?: number | null;
  descontos_por_periodo?: Record<string, number | string | null | undefined> | string | null;
  descontosPorPeriodo?: Record<string, number | string | null | undefined> | string | null;
  repasse_vexo_pct?: number | null;
  vexoPlan?: "essencial" | "avancado" | null;
}

export function calculateProposalValues(
  proposal: ProposalLike,
  availablePackages: any[] = []
): ProposalCalculatedValues {
  const valorSetupVexo = Number(proposal.valor_setup_vexo || 0);
  const cobrarSetup = proposal.cobrar_setup === undefined
    ? valorSetupVexo > 0
    : !!proposal.cobrar_setup;

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

  // Pacote fechado: nada além do pacote entra na conta. Ver bloco acima.
  const pacoteFechado = temPacote(items) || !!gdPkg || !!vexoPkg;

  // Setup: sem pacote, itens de cobrança única somam. Com pacote, só o setup
  // Vexo (já contabilizado em setupOriginal) — o pacote cobre o resto.
  const itemsSetup = pacoteFechado
    ? 0
    : items
        .filter(item => isCobrancaUnica(item) && naoInclusoNoPacote(item))
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

  // Meses do contrato e prazo
  const pkgItem = items.find(i =>
    i.descricao?.startsWith("Pacote:") || i.descricao?.startsWith("Pacote Vexo:")
  );
  const planoPeriodoKey = String(proposal.periodo_plano || gdPkg?.periodo || vexoPkg?.periodo || pkgItem?.periodo || "mensal").toLowerCase();

  // Descontos em %
  const descontoSetupPorcentagem = Math.max(0, Math.min(100, Number(proposal.desconto_setup_pct ?? proposal.descontoSetupPorcentagem ?? 0)));

  let rawDescontos = proposal.descontos_por_periodo ?? proposal.descontosPorPeriodo;
  if (typeof rawDescontos === "string") {
    try { rawDescontos = JSON.parse(rawDescontos); } catch (_) { rawDescontos = null; }
  }
  let descontoMensalPorcentagem = 0;
  const hasDescontosPorPeriodo = rawDescontos && typeof rawDescontos === "object" && Object.keys(rawDescontos).length > 0;
  if (hasDescontosPorPeriodo) {
    const periodoVal = (rawDescontos as Record<string, any>)[planoPeriodoKey];
    if (periodoVal !== undefined && periodoVal !== null && periodoVal !== "") {
      descontoMensalPorcentagem = Math.max(0, Math.min(100, Number(periodoVal)));
    } else {
      descontoMensalPorcentagem = 0;
    }
  } else {
    // Compatibilidade obrigatória: proposta que não tiver esse campo preenchido continua usando o desconto_mensal_pct atual para todos os prazos
    descontoMensalPorcentagem = Math.max(0, Math.min(100, Number(proposal.desconto_mensal_pct ?? proposal.descontoMensalPorcentagem ?? 0)));
  }

  const setupFinal = Math.max(0, setupOriginal * (1 - descontoSetupPorcentagem / 100));

  // Monthly Original
  const savedGdPkgItem = items.find(i => i.categoria === "gd" && i.recorrencia === "mensal" && i.descricao?.startsWith("Pacote:"));
  const gdOverride = savedGdPkgItem?.valor_override === true;

  let gdMonthly = 0;
  if (gdOverride) {
    gdMonthly = Number(savedGdPkgItem?.valor || 0);
  } else if (gdPkg && gdPkg.periodo !== "unico") {
    const months = monthsForPeriod(gdPkg.periodo) || 1;
    gdMonthly = Number(gdPkg.valor || 0) / months;
  } else if (savedGdPkgItem) {
    // Fallback: read directly from the saved item
    gdMonthly = Number(savedGdPkgItem.valor || 0);
  }

  const savedVexoPkgItem = items.find(i => i.categoria === "vexo" && i.recorrencia === "mensal" && i.descricao?.startsWith("Pacote Vexo:"));
  const vexoOverride = savedVexoPkgItem?.valor_override === true;

  let vexoMonthly = 0;
  if (vexoOverride) {
    vexoMonthly = Number(savedVexoPkgItem?.valor || 0);
  } else if (vexoPkg && vexoPkg.periodo !== "unico") {
    const months = monthsForPeriod(vexoPkg.periodo) || 1;
    vexoMonthly = Number(vexoPkg.valor || 0) / months;
  } else if (savedVexoPkgItem) {
    vexoMonthly = Number(savedVexoPkgItem.valor || 0);
  }

  const explicitVexoPlan = (proposal as any).vexo_plan || proposal.vexoPlan || (items.some(i => i.descricao?.toLowerCase().includes("avançado")) ? "avancado" : items.some(i => i.descricao?.toLowerCase().includes("essencial") || i.categoria === "vexo" || Boolean(proposal.package_vexo_id)) ? "essencial" : null);

  // Vexo avulsos
  const vexoAvulsos = items.filter(item => {
    return item.categoria === "vexo" && item.product_id !== null && !item.descricao?.startsWith("Pacote Vexo") && isCobrancaMensal(item) && naoInclusoNoPacote(item);
  });
  const avulsosMonthly = pacoteFechado ? 0 : vexoAvulsos.reduce((sum, item) => sum + Number(item.valor || 0), 0);

  // Legacy items
  const legacyItems = items.filter(item => {
    return item.categoria === "gd" && Number(item.valor || 0) > 0 && !item.descricao?.startsWith("Pacote:") && isCobrancaMensal(item) && naoInclusoNoPacote(item);
  });
  const legacyMonthly = pacoteFechado ? 0 : legacyItems.reduce((sum, item) => sum + Number(item.valor || 0), 0);

  const faturamentoMensalItems = items.filter(item => {
    return isCobrancaMensal(item) && item.product_id === null && !item.descricao?.startsWith("Pacote:") && !item.descricao?.startsWith("Pacote Vexo:");
  });
  const faturamentoMensalExtra = pacoteFechado ? 0 : faturamentoMensalItems.reduce((sum, item) => sum + Number(item.valor || 0), 0);

  const mensalidadeOriginal = gdMonthly + vexoMonthly + avulsosMonthly + legacyMonthly + faturamentoMensalExtra;
  const mensalidadeFinal = Math.max(0, mensalidadeOriginal * (1 - descontoMensalPorcentagem / 100));

  // Meses do contrato
  const mesesFromItem = pkgItem && Number(pkgItem.meses) > 0 ? Number(pkgItem.meses) : null;
  const mesesPeriodo = mesesFromItem || monthsForPeriod(planoPeriodoKey) || 1;

  const compromissoOriginal = mensalidadeOriginal * mesesPeriodo;
  const compromissoFinal = mensalidadeFinal * mesesPeriodo;

  // Lógica de Repasse Percentual Vexo OS x Geração Digital (Combos)
  const hasGdServices = gdMonthly > 0 || items.some(i => i.categoria === "gd");
  const hasVexoServices = vexoMonthly > 0 || items.some(i => i.categoria === "vexo") || !!proposal.vexoPlan || !!explicitVexoPlan;
  const isCombo = hasGdServices || hasVexoServices;

  const repasseVexoPercentual = Number(
    proposal.repasse_vexo_pct ?? (explicitVexoPlan === "avancado" ? 45 : explicitVexoPlan === "essencial" ? 35 : 35)
  );

  let repasseVexoMensal = 0;
  let repasseVexoSetup = 0;

  if (isCombo || hasVexoServices) {
    // Em combo conjunto GD + Vexo: o repasse devido à Vexo incide como porcentagem sobre a mensalidade GD
    repasseVexoMensal = Math.round((mensalidadeOriginal * (repasseVexoPercentual / 100)) * 100) / 100;
    // O repasse sobre a taxa de setup é 50% do valor do setup negociado
    const repasseSetupPct = Number((proposal as any).repasse_setup_pct ?? 50);
    repasseVexoSetup = Math.round((setupOriginal * (repasseSetupPct / 100)) * 100) / 100;
  }

  // VP / Permuta comercial
  let vpMensal = 0;
  let vpPeriodo = 0;

  const explicitVpPercent = Number(proposal.vp_percent ?? (proposal as any).vpPercent ?? 0);

  if (explicitVpPercent > 0) {
    // O VP tem que ser percentual aplicado sobre a mensalidade já descontada.
    // Ou seja: aplica o desconto primeiro, e só então fatia a proporção de permuta sobre o valor final.
    vpMensal = Math.round((mensalidadeFinal * (explicitVpPercent / 100)) * 100) / 100;
    vpPeriodo = Math.round((compromissoFinal * (explicitVpPercent / 100)) * 100) / 100;
  } else {
    // 1. Lê do pacote selecionado no catálogo (se houver)
    if (gdPkg && Number(gdPkg.valor_vp || 0) > 0) {
      const months = monthsForPeriod(gdPkg.periodo) || 1;
      const rawPkgVp = Number(gdPkg.valor_vp);
      if (months > 1 && rawPkgVp >= gdMonthly && Math.round((rawPkgVp / months) * 100) / 100 < gdMonthly) {
        vpMensal = Math.round((rawPkgVp / months) * 100) / 100;
        vpPeriodo = rawPkgVp;
      } else if (rawPkgVp < gdMonthly) {
        vpMensal = rawPkgVp;
        vpPeriodo = Math.round(rawPkgVp * months * 100) / 100;
      } else {
        vpMensal = Math.round((rawPkgVp / months) * 100) / 100;
        vpPeriodo = rawPkgVp;
      }
    }

    // 2. Se não encontrou no pacote, lê do item do pacote salvo
    if (!vpMensal && savedGdPkgItem && Number(savedGdPkgItem.valor_vp || 0) > 0) {
      const itemMeses = savedGdPkgItem.meses || mesesPeriodo || 1;
      const rawItemVp = Number(savedGdPkgItem.valor_vp);
      if (itemMeses > 1 && rawItemVp >= mensalidadeFinal && Math.round((rawItemVp / itemMeses) * 100) / 100 < mensalidadeFinal) {
        vpMensal = Math.round((rawItemVp / itemMeses) * 100) / 100;
        vpPeriodo = rawItemVp;
      } else if (rawItemVp < mensalidadeFinal) {
        vpMensal = rawItemVp;
        vpPeriodo = Math.round(rawItemVp * itemMeses * 100) / 100;
      } else {
        vpMensal = Math.round((rawItemVp / itemMeses) * 100) / 100;
        vpPeriodo = rawItemVp;
      }
    }

    // 3. Fallback: lê de proposal.valor_vp ou deriva proporção de outros pacotes
    if (!vpMensal) {
      const rawPropVp = Number(proposal.valor_vp || 0);
      if (rawPropVp > 0) {
        if (rawPropVp >= mensalidadeFinal && mesesPeriodo > 1 && Math.round((rawPropVp / mesesPeriodo) * 100) / 100 < mensalidadeFinal) {
          vpMensal = Math.round((rawPropVp / mesesPeriodo) * 100) / 100;
          vpPeriodo = rawPropVp;
        } else if (rawPropVp < mensalidadeFinal) {
          vpMensal = rawPropVp;
          vpPeriodo = Math.round(rawPropVp * mesesPeriodo * 100) / 100;
        } else {
          vpMensal = Math.round((rawPropVp / mesesPeriodo) * 100) / 100;
          vpPeriodo = rawPropVp;
        }
      } else {
        const otherPkgWithVp = availablePackages.find(p => Number(p.valor_vp || 0) > 0 && Number(p.valor || 0) > 0);
        if (otherPkgWithVp) {
          const vpPct = Number(otherPkgWithVp.valor_vp) / Number(otherPkgWithVp.valor);
          if (vpPct > 0 && vpPct < 1) {
            vpMensal = Math.round(mensalidadeFinal * vpPct * 100) / 100;
            vpPeriodo = Math.round(vpMensal * mesesPeriodo * 100) / 100;
          }
        }
      }
    }
  }

  const temVp = vpMensal > 0 && vpMensal < mensalidadeFinal;
  const dinheiroMensal = temVp ? Math.round((mensalidadeFinal - vpMensal) * 100) / 100 : mensalidadeFinal;
  const dinheiroPeriodo = temVp ? Math.round((compromissoFinal - vpPeriodo) * 100) / 100 : compromissoFinal;
  const vpPercent = explicitVpPercent > 0
    ? explicitVpPercent
    : (temVp && mensalidadeFinal > 0 ? Math.round((vpMensal / mensalidadeFinal) * 100 * 10) / 10 : 0);

  // VP pela MESMA regra de dedupe
  const vpTotal = computeVpFromItems(items);
  const totalGeral = Math.round((setupFinal + compromissoFinal) * 100) / 100;

  return {
    setupOriginal: Math.round(setupOriginal * 100) / 100,
    setupFinal: Math.round(setupFinal * 100) / 100,
    mensalidadeOriginal: Math.round(mensalidadeOriginal * 100) / 100,
    mensalidadeFinal: Math.round(mensalidadeFinal * 100) / 100,
    mesesPeriodo,
    compromissoOriginal: Math.round(compromissoOriginal * 100) / 100,
    compromissoFinal: Math.round(compromissoFinal * 100) / 100,
    temVp,
    vpMensal,
    vpPeriodo,
    dinheiroMensal,
    dinheiroPeriodo,
    vpPercent,
    vpTotal,
    totalGeral,
    descontoSetupPorcentagem,
    descontoMensalPorcentagem,
    isCombo,
    repasseVexoMensal,
    repasseVexoSetup,
    repasseVexoPercentual
  };
}
