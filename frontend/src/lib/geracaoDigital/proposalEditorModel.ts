// ---------------------------------------------------------------------------
// MODELO DO EDITOR DE PROPOSTA — o formulário único.
//
// "Nova Proposta" e "Editar Proposta" abrem o MESMO editor (components/geracaoDigital/
// ProposalEditor). Este módulo é o que os dois compartilham: o estado do formulário, como ele é
// hidratado a partir de uma proposta salva, a validação e a montagem do corpo gravado.
//
// Antes eram dois formulários (um assistente de 4 passos para criar e o editor da página para
// editar) com dois caminhos de gravação. O assistente nunca carregou desconto, setup isento,
// vp_percent nem vexo_plan — a proposta nascia sem eles e o vendedor preenchia tudo de novo ao
// abrir em edição. Enquanto houver dois formulários, todo campo novo precisa ser lembrado duas
// vezes, e uma das vezes é esquecida.
// ---------------------------------------------------------------------------

import {
  type Plano,
  type PeriodoKey,
  PERIODOS,
  planoVazio,
  planoDeProposta,
  planoValido,
  vpMensalDoPrazo,
  prazosOfertados,
  mesesDoPeriodo,
} from "./plano";
import {
  type FormasSelecionadas,
  formasVazias,
  formasParaTerms,
  termsParaFormas,
  termsLegados,
} from "./formasPagamento";

/** Segmentos que o seletor sempre oferece, mesmo quando o catálogo do servidor não os traz. */
export const SEGMENTOS_EMBUTIDOS = ["turismo", "cafeteria"];

export type EditorMode = "new" | "edit";

/** Tudo que o formulário edita. Um objeto só: criar e editar leem e gravam os mesmos campos. */
export interface ProposalEditorValues {
  prospectName: string;
  /** texto legado de condições; sem campo na tela, mas preservado ao salvar */
  condicoes: string;
  paymentLink: string;
  packageId: string;
  packageVexoId: string;
  pacotesOfertados: string[];
  plano: Plano;
  /** VP manual antigo (fallback quando o plano não tem vpPercent) */
  valorVp: number;
  carencia: string;
  cobrarSetup: boolean;
  valorSetupVexo: number;
  /** mensalidade negociada (R$); 0 = usa o preço do pacote */
  mensalidadeNegociada: number;
  formas: FormasSelecionadas;
  legadosPgto: any[];
  condicoesEspeciais: string;
  esconderValores: boolean;
  segmentId: string;
  customSegment: string;
  prospectLogo: string | null;
  periodoPlano: string;
  /** AAAA-MM-DD */
  validadeAte: string;
  valorAposValidade: string;
  observacaoValidade: string;
}

/**
 * Instante gravado (ISO) → data (AAAA-MM-DD) NO RELÓGIO LOCAL, a mesma em que o vendedor a escolheu.
 * A validade é gravada como o fim do dia local (`23:59:59` local → UTC). Fatiar o ISO em UTC
 * (`slice(0, 10)`) devolvia o dia SEGUINTE para quem está atrás do UTC (Brasil): a cada salvamento a
 * validade andava um dia para a frente, sem ninguém tocar nela.
 */
export function dataLocalDoInstante(iso: unknown): string {
  if (!iso) return "";
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function emptyProposalEditorValues(over: Partial<ProposalEditorValues> = {}): ProposalEditorValues {
  return {
    prospectName: "",
    condicoes: "",
    paymentLink: "",
    packageId: "",
    packageVexoId: "",
    pacotesOfertados: [],
    plano: planoVazio(),
    valorVp: 0,
    carencia: "",
    cobrarSetup: false,
    valorSetupVexo: 0,
    mensalidadeNegociada: 0,
    formas: formasVazias(),
    legadosPgto: [],
    condicoesEspeciais: "",
    esconderValores: false,
    segmentId: "",
    customSegment: "",
    prospectLogo: null,
    periodoPlano: "",
    validadeAte: "",
    valorAposValidade: "",
    observacaoValidade: "",
    ...over,
  };
}

/**
 * Hidrata o formulário a partir de uma proposta salva (o que `selectProposal` fazia inline).
 * `catalogo` = pacotes conhecidos (catálogo + os referenciados pela proposta).
 */
export function proposalEditorValuesFromProposal(
  prop: any,
  ctx: { catalogo: any[]; segmentsList: any[] }
): ProposalEditorValues {
  const itens = Array.isArray(prop.itens) ? prop.itens : [];

  // Preço negociado só existe se a proposta gravou override no item do pacote.
  const pkgItem = itens.find((i: any) => i?.descricao?.startsWith("Pacote:") && i?.valor_override === true);

  const ofertadas = prop.condicoes_pagamento?.ofertadas || [];

  const currentSeg = prop.segment_id || "";
  // "turismo" e "cafeteria" são sempre oferecidos pelo seletor mesmo fora do catálogo do servidor;
  // sem contá-los, uma proposta salva com eles reabria como "Outro segmento: cafeteria".
  const isKnownSeg = SEGMENTOS_EMBUTIDOS.includes(currentSeg) || ctx.segmentsList.some((s) => s.id === currentSeg);
  const segmentId = currentSeg && !isKnownSeg ? "custom" : currentSeg;
  const customSegment = currentSeg && !isKnownSeg ? currentSeg : "";

  const ofertados: string[] = Array.isArray(prop.pacotes_ofertados)
    ? prop.pacotes_ofertados
    : ([prop.package_id, prop.package_vexo_id].filter(Boolean) as string[]);

  // Reconstrói o plano (escopo × prazos) a partir das linhas de preço já gravadas.
  const plano = planoDeProposta(
    ofertados.map((pid) => ctx.catalogo.find((p: any) => p.id === pid)).filter(Boolean),
    itens,
    prop
  );

  return emptyProposalEditorValues({
    prospectName: prop.prospect_name || "",
    condicoes: prop.condicoes || "",
    paymentLink: prop.payment_link || "",
    packageId: prop.package_id || "",
    packageVexoId: prop.package_vexo_id || "",
    pacotesOfertados: ofertados,
    plano,
    valorVp: Number(prop.valor_vp || 0),
    carencia: prop.carencia_dias !== null && prop.carencia_dias !== undefined ? String(prop.carencia_dias) : "",
    cobrarSetup: prop.cobrar_setup === true,
    valorSetupVexo: Number(prop.valor_setup_vexo || 0),
    mensalidadeNegociada: pkgItem ? Number(pkgItem.valor || 0) : 0,
    formas: termsParaFormas(ofertadas),
    legadosPgto: termsLegados(ofertadas),
    condicoesEspeciais: prop.condicoes_especiais || prop.condicao_especial || "",
    esconderValores: prop.esconder_valores === true,
    segmentId,
    customSegment,
    prospectLogo: prop.prospect_logo || null,
    periodoPlano: prop.periodo_plano || "",
    validadeAte: dataLocalDoInstante(prop.validade_ate),
    valorAposValidade:
      prop.valor_apos_validade !== null && prop.valor_apos_validade !== undefined ? String(prop.valor_apos_validade) : "",
    observacaoValidade: prop.observacao_validade || "",
  });
}

// ── Validação (uma só, para criar e editar) ──────────────────────────────

export interface EditorValidation {
  ok: boolean;
  /** só quando ok = false */
  title?: string;
  message?: string;
}

/**
 * - Nome da empresa: obrigatório, criando ou editando.
 * - Link de pagamento: se preenchido, tem que ser http(s) — o servidor recusa o resto, e recusar
 *   depois de criar a proposta deixaria um rascunho pela metade.
 * - Plano (escopo + ao menos 1 prazo com preço): obrigatório ao CRIAR, como o assistente exigia.
 *   Ao editar não bloqueia: proposta legada pode não reconstruir um plano válido, e travar o
 *   salvamento dela seria uma regressão.
 */
export function validateProposalEditor(values: ProposalEditorValues, mode: EditorMode): EditorValidation {
  if (!values.prospectName.trim()) {
    return { ok: false, title: "Nome obrigatório", message: "Informe o nome do prospect." };
  }
  const link = values.paymentLink.trim();
  if (link) {
    let valido = false;
    try {
      const u = new URL(link);
      valido = u.protocol === "http:" || u.protocol === "https:";
    } catch {
      valido = false;
    }
    if (!valido) {
      return {
        ok: false,
        title: "Link de pagamento inválido",
        message: "O link de pagamento deve começar com http:// ou https://.",
      };
    }
  }
  if (mode === "new" && !planoValido(values.plano)) {
    return {
      ok: false,
      title: "Plano incompleto",
      message: "Escolha ao menos 1 item no escopo e preencha o preço de ao menos 1 prazo.",
    };
  }
  return { ok: true };
}

// ── Totais ao vivo, derivados do plano ───────────────────────────────────

/**
 * Setup final, mensalidade final e meses do prazo-base (o mais longo ofertado, que é o
 * pré-selecionado da proposta), direto do plano na tela. Serve aos parcelamentos do editor: antes
 * vinham do pacote JÁ SALVO, então ao criar (nenhum pacote ainda) tudo aparecia R$ 0.
 */
export function totaisAoVivoDoPlano(plano: Plano): { setupFinal: number; mensalidadeFinal: number; mesesPeriodo: number } {
  const prazoBase = prazosOfertados(plano).slice(-1)[0] as PeriodoKey | undefined;
  const meses = prazoBase ? mesesDoPeriodo(prazoBase) : 1;
  const bruta = prazoBase ? Number(plano.precos[prazoBase] || 0) : 0;
  const descPorPrazo = prazoBase ? plano.descontosPorPeriodo?.[prazoBase] : undefined;
  const descMensal = Math.max(
    0,
    Math.min(
      100,
      Number(
        descPorPrazo !== undefined && descPorPrazo !== null
          ? descPorPrazo
          : (plano as any).descontoMensalPorcentagem ?? (plano as any).desconto_mensal_pct ?? 0
      )
    )
  );
  const setupOriginal = Number((plano as any).valorSetupVexo ?? (plano as any).valor_setup_vexo ?? 0);
  const descSetup = Math.max(0, Math.min(100, Number((plano as any).descontoSetupPorcentagem ?? (plano as any).desconto_setup_pct ?? 0)));
  return {
    setupFinal: Math.max(0, setupOriginal * (1 - descSetup / 100)),
    mensalidadeFinal: Math.max(0, bruta * (1 - descMensal / 100)),
    mesesPeriodo: meses,
  };
}

// ── Montagem dos itens e do corpo gravado ────────────────────────────────

const PERIOD_MONTHS: Record<string, number> = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };

/** Proposta "em branco" usada como base ao criar: o que o corpo lê de uma proposta já existente. */
export const PROPOSTA_BASE_VAZIA: any = {
  id: "",
  prospect_name: "",
  periodo_plano: null,
  valor_vp: null,
  presentation_slides: null,
  condicoes_pagamento: null,
  owner_company: null,
};

export function buildProposalItems(opts: {
  values: ProposalEditorValues;
  catalogo: any[];
  pkgId: string;
  /** VP mensal do prazo selecionado (alimenta o valor_vp do item do pacote) */
  vpMensalPlano: number;
}): any[] {
  const { values, catalogo, pkgId, vpMensalPlano } = opts;
  const finalItems: any[] = [];

  // 1. Item do pacote GD
  const selectedGdPkg = catalogo.find((p) => p.id === pkgId && (p.tipo === "gd" || !p.tipo));
  if (selectedGdPkg) {
    const val = Number(selectedGdPkg.valor || 0);
    const meses = selectedGdPkg.periodo === "unico" ? null : PERIOD_MONTHS[selectedGdPkg.periodo] ?? 1;
    const mensalidade = meses ? Math.round((val / meses) * 100) / 100 : val;
    const valorTabela = Number(selectedGdPkg.valor_tabela || 0);
    // Preço negociado desta proposta: quando preenchido, vence o pacote vivo do catálogo.
    const negociada = Number(values.mensalidadeNegociada || 0);
    const usaOverride = negociada > 0 && meses !== null;
    const mensalidadeFinalItem = usaOverride ? negociada : mensalidade;
    // O valor_vp do item é o total do PERÍODO; a coluna valor_vp da proposta guarda o MENSAL.
    const vpItemPeriodo = meses && vpMensalPlano > 0 ? Math.round(vpMensalPlano * meses * 100) / 100 : null;

    finalItems.push({
      product_id: null,
      descricao: `Pacote: ${selectedGdPkg.nome} (${selectedGdPkg.periodo === "unico" ? "Setup" : "Recorrência"})`,
      categoria: "gd",
      valor: mensalidadeFinalItem,
      valor_vp: vpItemPeriodo,
      valor_override: usaOverride || undefined,
      recorrencia: meses ? "mensal" : "unico",
      periodo: selectedGdPkg.periodo,
      meses,
      total_periodo: meses ? (usaOverride ? mensalidadeFinalItem * meses : val) : null,
      valor_tabela: valorTabela > val ? valorTabela : null,
    });

    if (Array.isArray(selectedGdPkg.produtos_incluidos)) {
      selectedGdPkg.produtos_incluidos.forEach((p: any) => {
        const isVexo = p.origem === "vexo";
        const desc = isVexo ? (String(p.nome).startsWith("Módulo:") ? p.nome : `Módulo: ${p.nome}`) : p.nome;
        finalItems.push({
          product_id: p.product_id || null,
          descricao: desc,
          categoria: isVexo ? "vexo" : "gd",
          valor: 0,
          recorrencia: "mensal",
        });
      });
    }
  }

  // 2. Item do pacote Vexo
  const selectedVexoPkg = catalogo.find((p) => p.id === values.packageVexoId && p.tipo === "vexo");
  if (selectedVexoPkg) {
    const val = Number(selectedVexoPkg.valor || 0);
    const meses = selectedVexoPkg.periodo === "unico" ? null : PERIOD_MONTHS[selectedVexoPkg.periodo] ?? 1;
    const mensalidade = meses ? Math.round((val / meses) * 100) / 100 : val;
    const valorTabela = Number(selectedVexoPkg.valor_tabela || 0);

    finalItems.push({
      product_id: null,
      descricao: `Pacote Vexo: ${selectedVexoPkg.nome} (${selectedVexoPkg.periodo === "unico" ? "Setup" : "Recorrência"})`,
      categoria: "vexo",
      valor: mensalidade,
      recorrencia: meses ? "mensal" : "unico",
      periodo: selectedVexoPkg.periodo,
      meses,
      total_periodo: meses ? val : null,
      valor_tabela: valorTabela > val ? valorTabela : null,
    });

    if (Array.isArray(selectedVexoPkg.produtos_incluidos)) {
      selectedVexoPkg.produtos_incluidos.forEach((p: any) => {
        const desc = String(p.nome).startsWith("Módulo:") ? p.nome : `Módulo: ${p.nome}`;
        if (!finalItems.some((it) => it.descricao === desc)) {
          finalItems.push({
            product_id: p.product_id || null,
            descricao: desc,
            categoria: "vexo",
            valor: 0,
            recorrencia: "mensal",
          });
        }
      });
    }
  }

  // Deduplica itens de valor zero por descrição (evita repetições)
  const seen = new Set<string>();
  return finalItems.filter((i) => {
    const desc = String(i.descricao || "").trim();
    if (!desc) return false;
    if (Number(i.valor || 0) === 0) {
      if (seen.has(desc)) return false;
      seen.add(desc);
    }
    return true;
  });
}

/** Reescreve a lista de serviços do slide "parceria" a partir dos itens (só se a proposta tem slides). */
export function slidesComItens(slidesAtuais: any, itens: any[]): any[] | null {
  if (!Array.isArray(slidesAtuais) || slidesAtuais.length === 0) return null;
  const slides = JSON.parse(JSON.stringify(slidesAtuais));

  const ehPacoteGd = (desc: string) => desc.toLowerCase().startsWith("pacote:") && !desc.toLowerCase().includes("vexo");
  const ehVexo = (it: any, desc: string) => {
    const cat = String(it.categoria || "").toLowerCase();
    return cat === "vexo" || desc.toLowerCase().includes("plano") || desc.toLowerCase().includes("vexo") || desc.toLowerCase().includes("chatbot");
  };

  const gdItems: string[] = [];
  const pkgItem = itens.find((it: any) => ehPacoteGd(String(it.descricao || it.nome || "").trim()));
  if (pkgItem) gdItems.push(pkgItem.descricao || pkgItem.nome);

  itens.forEach((it: any) => {
    const desc = String(it.descricao || it.nome || "").trim();
    if (!desc) return;
    if (ehPacoteGd(desc)) return;
    if (!ehVexo(it, desc) && !gdItems.includes(desc)) gdItems.push(desc);
  });

  const vexoItems: string[] = [];
  itens.forEach((it: any) => {
    const desc = String(it.descricao || it.nome || "").trim();
    if (!desc) return;
    if (ehPacoteGd(desc)) return;
    if (ehVexo(it, desc) && !vexoItems.includes(desc)) vexoItems.push(desc);
  });
  if (vexoItems.length === 0) {
    vexoItems.push("Plano Avançado Vexo OS", "Chatbot IA de Qualificação", "Jornadas de Follow-up");
  }

  return slides.map((s: any) => {
    if (s.kind === "partnership" || s.id === 5) {
      return {
        ...s,
        fronts: [
          {
            label: "Geração Digital",
            tag: "Atração & Posicionamento",
            items: gdItems.length > 0 ? gdItems : ["Gestão de Redes Sociais", "Tráfego Pago", "Posicionamento"],
          },
          { label: "Vexo Atendimento", tag: "IA & Automação Comercial", items: vexoItems },
        ],
      };
    }
    return s;
  });
}

export interface BuiltProposal {
  items: any[];
  slides: any[] | null;
  body: Record<string, any>;
}

/**
 * Monta os itens e o corpo gravado. Mesma função para criar e editar: `base` é a proposta salva
 * (editar) ou PROPOSTA_BASE_VAZIA (criar).
 */
export function buildProposalBody(opts: {
  values: ProposalEditorValues;
  base: any;
  catalogo: any[];
  pkgId: string;
  pacotesOfertados: string[];
  clientId: string | null;
  isVexoCommercial: boolean;
  mode: EditorMode;
}): BuiltProposal {
  const { values, base, catalogo, pkgId, pacotesOfertados, clientId, isVexoCommercial, mode } = opts;
  const plano = values.plano;

  // Setup Vexo: extrai do plano em edição com fallback nos estados locais
  const setupDoPlano = Number((plano as any).valorSetupVexo ?? (plano as any).valor_setup_vexo ?? values.valorSetupVexo ?? 0);
  const cobrarSetupFinal = setupDoPlano > 0 ? true : values.cobrarSetup || false;

  // VP MENSAL do prazo selecionado (%, do plano). Com plano válido e % preenchido, o % manda;
  // senão cai no VP manual antigo.
  const selectedGdPkg = catalogo.find((p) => p.id === pkgId && (p.tipo === "gd" || !p.tipo));
  const periodoSel = String(selectedGdPkg?.periodo || values.periodoPlano || base.periodo_plano || "anual");
  const vpMensalPlano =
    Number(plano.vpPercent || 0) > 0 && (PERIODOS as readonly any[]).some((p) => p.key === periodoSel)
      ? vpMensalDoPrazo(plano, periodoSel as PeriodoKey)
      : Number(values.valorVp || 0) > 0
      ? Number(values.valorVp)
      : Number(base.valor_vp || 0) > 0
      ? Number(base.valor_vp)
      : 0;

  const items = buildProposalItems({ values, catalogo, pkgId, vpMensalPlano });
  const slides = slidesComItens(base.presentation_slides, items);

  const finalPeriodoPlano = (() => {
    const gdPkg = catalogo.find((p: any) => p.id === pkgId && (p.tipo === "gd" || !p.tipo));
    const vexoPkg = catalogo.find((p: any) => p.id === values.packageVexoId && p.tipo === "vexo");
    return gdPkg?.periodo || vexoPkg?.periodo || base.periodo_plano || "mensal";
  })();

  const body = {
    client_id: clientId,
    prospect_name: values.prospectName,
    package_id: pkgId || null,
    // Lista de prazos ofertados, derivada do próprio plano na tela.
    pacotes_ofertados: pacotesOfertados,
    package_vexo_id: values.packageVexoId || null,
    itens: items,
    presentation_slides: slides || undefined,
    // Ao criar, vazio vira null: o servidor mantém o texto padrão de condições da proposta nova.
    condicoes: mode === "new" ? values.condicoes || null : values.condicoes,
    payment_link: values.paymentLink,
    cobrar_setup: cobrarSetupFinal,
    // Mantém o valor gravado mesmo isentando, para exibir o riscado.
    valor_setup_vexo:
      setupDoPlano > 0 ? setupDoPlano : cobrarSetupFinal && Number(values.valorSetupVexo || 0) > 0 ? Number(values.valorSetupVexo) : null,
    segment_id: values.segmentId === "custom" ? values.customSegment.trim() || "custom" : values.segmentId || null,
    custom_segment_name: values.segmentId === "custom" ? values.customSegment.trim() || null : null,
    prospect_logo: values.prospectLogo || null,
    condicoes_pagamento: {
      // Formas fixas primeiro; condições legadas seguem gravadas enquanto estiverem marcadas.
      ofertadas: [...formasParaTerms(values.formas, finalPeriodoPlano), ...values.legadosPgto],
      escolhida: base.condicoes_pagamento?.escolhida ?? null,
    },
    periodo_plano: finalPeriodoPlano,
    validade_ate: values.validadeAte ? new Date(`${values.validadeAte}T23:59:59`).toISOString() : null,
    valor_apos_validade: values.valorAposValidade !== "" ? Number(values.valorAposValidade) : null,
    observacao_validade: values.observacaoValidade || null,
    carencia_dias: values.carencia !== "" ? Number(values.carencia) : null,
    // Coluna valor_vp = VP MENSAL do prazo selecionado (a página pública divide a mensalidade por ele).
    valor_vp: vpMensalPlano > 0 ? vpMensalPlano : null,
    vp_percent: Number(plano.vpPercent || 0) > 0 ? Number(plano.vpPercent) : null,
    condicoes_especiais: values.condicoesEspeciais || (plano as any).condicoesEspeciais || null,
    esconder_valores: values.esconderValores,
    desconto_setup_pct: (plano as any).descontoSetupPorcentagem ?? (plano as any).desconto_setup_pct ?? 0,
    descontos_por_periodo: plano.descontosPorPeriodo || null,
    desconto_mensal_pct: (() => {
      const p = (finalPeriodoPlano || "mensal") as PeriodoKey;
      if (plano.descontosPorPeriodo && plano.descontosPorPeriodo[p] !== undefined) {
        return Number(plano.descontosPorPeriodo[p] || 0);
      }
      return (plano as any).descontoMensalPorcentagem ?? (plano as any).desconto_mensal_pct ?? 0;
    })(),
    vexo_plan: (plano as any).vexoPlan || null,
    vexo_price: (plano as any).vexoPlan === "essencial" ? 397 : (plano as any).vexoPlan === "avancado" ? 897 : 0,
    owner_company: isVexoCommercial ? "vexo" : base.owner_company || "geracao-digital",
  };

  return { items, slides, body };
}
