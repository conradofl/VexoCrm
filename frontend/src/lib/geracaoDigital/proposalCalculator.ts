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
  package_id?: string | null;
  package_vexo_id?: string | null;
  periodo_plano?: string | null;
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

  // Setup final. A camada de concessões (descontos_concedidos, da antiga Mesa de
  // Negociação) foi removida na fase 5c: o preço negociado agora é editado
  // direto na proposta. A coluna segue no banco apenas como histórico.
  const setupFinal = setupOriginal;

  // Monthly Original
  //
  // Precedência (fase 5a): preço NEGOCIADO da proposta > pacote vivo do
  // catálogo > valor congelado no item.
  // O override vive no próprio item (`valor_override: true`), dentro do JSONB
  // `itens` — sem coluna nova. Assim continuam valendo as duas regras:
  //   - editar o pacote no catálogo propaga para propostas SEM override;
  //   - proposta negociada mantém o preço combinado (decisão: valores flexíveis).
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
  } else {
    if (savedVexoPkgItem) {
      vexoMonthly = Number(savedVexoPkgItem.valor || 0);
    }
  }

  // Vexo avulsos: items in proposal that are Vexo but NOT the Vexo package itself
  // nem já inclusos no pacote selecionado.
  const vexoAvulsos = items.filter(item => {
    return item.categoria === "vexo" && item.product_id !== null && !item.descricao?.startsWith("Pacote Vexo") && isCobrancaMensal(item) && naoInclusoNoPacote(item);
  });
  const avulsosMonthly = pacoteFechado ? 0 : vexoAvulsos.reduce((sum, item) => sum + Number(item.valor || 0), 0);

  // Legacy items (for backward compatibility): itens GD avulsos com valor,
  // excluindo os que já compõem o pacote selecionado.
  const legacyItems = items.filter(item => {
    return item.categoria === "gd" && Number(item.valor || 0) > 0 && !item.descricao?.startsWith("Pacote:") && isCobrancaMensal(item) && naoInclusoNoPacote(item);
  });
  const legacyMonthly = pacoteFechado ? 0 : legacyItems.reduce((sum, item) => sum + Number(item.valor || 0), 0);

  const faturamentoMensalItems = items.filter(item => {
    return isCobrancaMensal(item) && item.product_id === null && !item.descricao?.startsWith("Pacote:") && !item.descricao?.startsWith("Pacote Vexo:");
  });
  const faturamentoMensalExtra = pacoteFechado ? 0 : faturamentoMensalItems.reduce((sum, item) => sum + Number(item.valor || 0), 0);

  const mensalidadeOriginal = gdMonthly + vexoMonthly + avulsosMonthly + legacyMonthly + faturamentoMensalExtra;
  const mensalidadeFinal = mensalidadeOriginal;


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
