// backend/src/domains/geracaoDigitalContracts/contractMerge.js
//
// Utilitários de cláusulas em blocos, numeração ordinal por extenso e extração dinâmica de marcadores.

export const ORDINAIS_EXTENSO = [
  "", "Primeira", "Segunda", "Terceira", "Quarta", "Quinta",
  "Sexta", "Sétima", "Oitava", "Nona", "Décima",
  "Décima Primeira", "Décima Segunda", "Décima Terceira", "Décima Quarta", "Décima Quinta",
  "Décima Sexta", "Décima Sétima", "Décima Oitava", "Décima Nona", "Vigésima",
  "Vigésima Primeira", "Vigésima Segunda", "Vigésima Terceira", "Vigésima Quarta", "Vigésima Quinta",
  "Vigésima Sexta", "Vigésima Sétima", "Vigésima Oitava", "Vigésima Nona", "Trigésima"
];

/**
 * Converte um índice numérico (1-based) para numeral ordinal por extenso em português.
 * Ex: 1 -> "Primeira", 7 -> "Sétima", 12 -> "Décima Segunda".
 */
export function toExtenseOrdinal(index) {
  const n = Math.floor(Number(index) || 0);
  return ORDINAIS_EXTENSO[n] || `${n}ª`;
}

/**
 * Monta o texto integral do contrato a partir dos blocos de cláusulas ativas,
 * recalculando a numeração ordinal dinamicamente sem lacunas.
 */
export function assembleContractFromBlocks({
  tituloPrincipal,
  clausulas = [],
  fechamento,
} = {}) {
  const activeClauses = (clausulas || []).filter((c) => c && c.ativo !== false);

  const assembledClauses = activeClauses.map((c, idx) => {
    const ordinal = toExtenseOrdinal(idx + 1);
    const cleanTitle = (c.titulo || "")
      .replace(/^(?:Cláusula|CLAUSULA)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9ºª\s]+?)\s*[–\-:|]\s*/i, "")
      .trim();
    const header = `Cláusula ${ordinal} – ${cleanTitle}`;
    const body = (c.conteudo || "").trim();
    return body ? `${header}\n${body}` : header;
  });

  const parts = [];
  if (tituloPrincipal && tituloPrincipal.trim()) {
    parts.push(tituloPrincipal.trim());
  }
  if (assembledClauses.length > 0) {
    parts.push(assembledClauses.join("\n\n"));
  }
  if (fechamento && fechamento.trim()) {
    parts.push(fechamento.trim());
  }
  return parts.join("\n\n");
}

/**
 * Decompõe o texto de um template legado em:
 * - tituloPrincipal (cabeçalho antes da 1ª cláusula)
 * - clausulas (array de blocos estruturados ContractClauseBlock)
 * - fechamento (texto final após a última cláusula)
 */
export function parseTemplateContentToClauses(conteudo) {
  if (!conteudo || typeof conteudo !== "string") {
    return { tituloPrincipal: "", clausulas: [], fechamento: "" };
  }

  // Regex para identificar cabeçalhos de cláusula
  // Suporta: "Cláusula Primeira - Das Partes", "Cláusula Sétima – Do Foro", "CLAUSULA 2ª: Do Objeto", "CLÁUSULA PRIMEIRA | DAS PARTES"
  const clauseRegex = /(?:^|\n)(?:Cláusula|CLAUSULA)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9ºª\s]+?)\s*[–\-:|]\s*([^\n]+)/gi;

  const matches = [...conteudo.matchAll(clauseRegex)];

  if (matches.length === 0) {
    return {
      tituloPrincipal: "",
      clausulas: [
        {
          id: "conteudo-geral",
          titulo: "Conteúdo Geral",
          conteudo: conteudo.trim(),
          ativo: true,
          obrigatorio: true,
        },
      ],
      fechamento: "",
    };
  }

  const firstMatch = matches[0];
  const firstIndex = firstMatch.index + (firstMatch[0].startsWith("\n") ? 1 : 0);
  const tituloPrincipal = conteudo.slice(0, firstIndex).trim();

  // Detecta se há bloco de fechamento formal
  const fechamentoRegex = /(?:\n\n|\n)(E,?\s*por\s*estarem\s*assim[\s\S]*)$/i;
  const fechamentoMatch = conteudo.match(fechamentoRegex);
  let fechamento = "";
  let endOfClauses = conteudo.length;

  if (fechamentoMatch && fechamentoMatch.index !== undefined) {
    fechamento = fechamentoMatch[1].trim();
    endOfClauses = fechamentoMatch.index;
  }

  const clausulas = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const matchStart = match.index + (match[0].startsWith("\n") ? 1 : 0);
    const headerLineEnd = matchStart + match[0].trim().length;

    let bodyEnd = endOfClauses;
    if (i + 1 < matches.length) {
      const nextMatch = matches[i + 1];
      bodyEnd = nextMatch.index + (nextMatch[0].startsWith("\n") ? 1 : 0);
    }

    const rawTitle = (match[2] || "").trim();
    const clauseBody = conteudo.slice(headerLineEnd, bodyEnd).trim();

    const slug = rawTitle
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `clausula-${i + 1}`;

    const isPartes = /^(das\s+partes|partes|dos\s+contratantes)$/i.test(rawTitle.trim());

    clausulas.push({
      id: slug,
      titulo: rawTitle,
      conteudo: clauseBody,
      ativo: true,
      obrigatorio: isPartes,
    });
  }

  return {
    tituloPrincipal,
    clausulas,
    fechamento,
  };
}

/**
 * Extrai todos os marcadores {{nome}} de um texto ou array de blocos de cláusula ativos.
 */
export function extractPlaceholders(textOrClauses) {
  const text = typeof textOrClauses === "string"
    ? textOrClauses
    : (textOrClauses || [])
        .filter((c) => c && c.ativo !== false)
        .map((c) => c.conteudo || "")
        .join("\n");

  const matches = text.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g);
  const found = new Set();
  for (const m of matches) {
    if (m[1]) found.add(m[1]);
  }
  return Array.from(found);
}

export const STANDARD_CONTRACT_FIELDS = new Set([
  // Contratante
  "razao_social",
  "cnpj",
  "telefone",
  "telefone2",
  "email",
  "representante",
  "endereco",
  // Objeto & Preço
  "produtos",
  "artes_mensais",
  "forma_pagamento",
  "num_parcelas",
  "valor_parcela",
  "data_primeiro_venc",
  "condicoes_pagamento",
  // Prazo, Foro & Assinatura
  "prazo_dias",
  "aviso_previo_dias",
  "vigencia",
  "foro_cidade",
  "cidade_assinatura",
  // Sistema / Calculados / Assinaturas / Cronograma
  "data_extenso",
  "cronograma_pagamento",
  "parcelas",
  "assinatura_contratada",
  "assinatura_contratante",
  "espaco_assinatura",
]);

export function isSystemOrStandardField(key) {
  if (!key) return false;
  if (STANDARD_CONTRACT_FIELDS.has(key)) return true;
  if (key.startsWith("contratada_")) return true;
  return false;
}

/**
 * Formata um valor numérico em moeda brasileira (BRL).
 */
export function formatBrl(val) {
  if (val == null || val === "") return "";
  if (typeof val === "string" && val.includes("R$")) return val;
  const num = typeof val === "number" ? val : parseFloat(String(val).replace(/[^\d.,-]/g, "").replace(",", "."));
  if (isNaN(num)) return String(val);
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(num).replace(/\u00a0/g, " ");
}

export const formatCurrencyBRL = formatBrl;

/**
 * Aplica máscara de CNPJ (14 dígitos) ou CPF (11 dígitos).
 */
export function formatCnpj(val) {
  if (!val) return "";
  const digits = String(val).replace(/\D/g, "");
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  return String(val);
}

/**
 * Aplica máscara de CPF (11 dígitos).
 */
export function formatCpf(val) {
  if (!val) return "";
  const digits = String(val).replace(/\D/g, "");
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  return String(val);
}

/**
 * Aplica máscara brasileira de telefone celular (11 dígitos) ou fixo (10 dígitos).
 * Se contiver o DDI 55 (12 ou 13 dígitos), remove o 55 antes de formatar.
 */
export function formatTelefone(val) {
  if (!val) return "";
  let digits = String(val).replace(/\D/g, "");
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(2);
  }
  if (digits.length === 11) {
    return digits.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
  }
  if (digits.length === 10) {
    return digits.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2-$3");
  }
  return String(val);
}

/**
 * Normaliza e aplica máscaras em todos os campos do objeto dados do contrato.
 */
export function prepareContractDados(dados = {}) {
  const d = { ...dados };
  if (d.cnpj) d.cnpj = formatCnpj(d.cnpj);
  if (d.contratada_cnpj) d.contratada_cnpj = formatCnpj(d.contratada_cnpj);
  if (d.responsavel_cpf) d.responsavel_cpf = formatCpf(d.responsavel_cpf);
  if (d.cpf) d.cpf = formatCpf(d.cpf);

  if (d.telefone) d.telefone = formatTelefone(d.telefone);
  if (d.telefone2) d.telefone2 = formatTelefone(d.telefone2);
  if (d.contratada_telefone) d.contratada_telefone = formatTelefone(d.contratada_telefone);

  if (d.valor_total != null && d.valor_total !== "") {
    d.valor_total = formatBrl(d.valor_total);
  }
  if (d.valor_parcela != null && d.valor_parcela !== "") {
    d.valor_parcela = formatBrl(d.valor_parcela);
  }
  if (d.condicao_permuta != null && d.condicao_permuta !== "" && !isNaN(Number(String(d.condicao_permuta).replace(/[^\d.,-]/g, "").replace(",", ".")))) {
    d.condicao_permuta = formatBrl(d.condicao_permuta);
  }

  if (d.endereco && typeof d.endereco === "object") {
    const e = d.endereco;
    const parts = [];
    if (e.logradouro) parts.push(e.logradouro + (e.numero ? `, ${e.numero}` : ""));
    if (e.bairro) parts.push(e.bairro);
    if (e.cidade && e.uf) parts.push(`${e.cidade} – ${e.uf}`);
    else if (e.cidade) parts.push(e.cidade);
    if (e.cep) parts.push(`CEP ${e.cep}`);
    d.endereco = parts.join(", ");
  }

  return d;
}

/**
 * Formata a data de uma parcela (YYYY-MM-DD -> DD/MM/YYYY).
 */
export function formatScheduleDateDisplay(dateStr) {
  if (!dateStr || dateStr === "a combinar") return "a combinar";
  const [yyyy, mm, dd] = String(dateStr).split("-");
  if (yyyy && mm && dd) return `${dd}/${mm}/${yyyy}`;
  return String(dateStr);
}

/**
 * Retorna o rótulo amigável para o meio de pagamento da parcela.
 */
export function formatTipoParcelaLabel(tipo) {
  const map = {
    dinheiro: "Dinheiro",
    pix: "PIX",
    boleto: "Boleto",
    cartao: "Cartão",
    permuta: "Permuta",
    misto: "Misto (Dinheiro + Permuta)",
  };
  return map[tipo] || tipo;
}

/**
 * Projeta parcelas de acordo com a periodicidade selecionada (semanal, quinzenal, mensal ou livre).
 */
export function generateScheduleInstallments({
  numParcelas,
  valorTotal,
  valorPorParcela,
  dataPrimeiroVenc,
  periodicidade = "mensal",
  tipoPadrao = "dinheiro",
  observacaoPadrao = "",
} = {}) {
  const n = Math.max(1, Math.floor(Number(numParcelas) || 1));
  const valor = valorPorParcela !== undefined && Number(valorPorParcela) > 0
    ? Number(valorPorParcela)
    : (Number(valorTotal || 0) / n);
  const baseDate = dataPrimeiroVenc ? new Date(`${dataPrimeiroVenc}T12:00:00`) : null;
  const parcelas = [];
  for (let i = 0; i < n; i++) {
    let dataStr = "";
    if (baseDate && !isNaN(baseDate.getTime())) {
      const d = new Date(baseDate);
      if (periodicidade === "semanal") {
        d.setDate(d.getDate() + (i * 7));
      } else if (periodicidade === "quinzenal") {
        d.setDate(d.getDate() + (i * 15));
      } else if (periodicidade === "mensal") {
        d.setMonth(d.getMonth() + i);
      }
      dataStr = d.toISOString().slice(0, 10);
    }
    parcelas.push({
      id: `parcela-${i + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      numero: i + 1,
      data: dataStr || dataPrimeiroVenc || "",
      valor: Math.round(valor * 100) / 100,
      tipo: tipoPadrao,
      observacao: i === 0 && !observacaoPadrao ? "Entrada na assinatura" : (observacaoPadrao || ""),
    });
  }
  return parcelas;
}

/**
 * Calcula os totais segregados do cronograma: total geral, moeda corrente e permuta.
 */
export function calculateScheduleTotals(parcelas = []) {
  let totalGeral = 0;
  let totalDinheiro = 0;
  let totalPermuta = 0;
  for (const p of parcelas || []) {
    const val = Number(p.valor) || 0;
    totalGeral += val;
    if (p.tipo === "permuta") {
      totalPermuta += val;
    } else if (p.tipo === "misto") {
      totalDinheiro += val / 2;
      totalPermuta += val / 2;
    } else {
      totalDinheiro += val;
    }
  }
  return {
    totalGeral: Math.round(totalGeral * 100) / 100,
    totalDinheiro: Math.round(totalDinheiro * 100) / 100,
    totalPermuta: Math.round(totalPermuta * 100) / 100,
    numParcelas: (parcelas || []).length,
  };
}

/**
 * Monta a cláusula textual do cronograma de pagamento suportando tanto o array
 * de parcelas flexíveis (Peça 4) quanto a assinatura legada de 3 argumentos.
 */
export function buildCronograma(
  numParcelasOrList,
  valorParcela,
  dataPrimeiroVenc
) {
  // Caso 1: Array de parcelas estruturadas (Peça 4)
  if (Array.isArray(numParcelasOrList)) {
    const parcelas = numParcelasOrList;
    if (parcelas.length === 0) return "";
    const linhas = parcelas.map((p, idx) => {
      const numOrdinal = `${idx + 1}ª Parcela`;
      const dataFmt = formatScheduleDateDisplay(p.data);
      const valorFmt = formatBrl(p.valor);
      const tipoFmt = formatTipoParcelaLabel(p.tipo);
      const obsFmt = p.observacao && p.observacao.trim() ? ` — Obs: ${p.observacao.trim()}` : "";
      return `${numOrdinal} — Vencimento: ${dataFmt} — Valor: ${valorFmt} (${tipoFmt})${obsFmt}`;
    });
    const totals = calculateScheduleTotals(parcelas);
    const resumoLinha = `Total do Contrato: ${formatBrl(totals.totalGeral)} (Em Moeda: ${formatBrl(totals.totalDinheiro)} | Em Permuta: ${formatBrl(totals.totalPermuta)})`;
    return `${linhas.join("\n")}\n\n${resumoLinha}`;
  }

  // Caso 2: Modo legado (numParcelas, valorParcela, dataPrimeiroVenc)
  const n = Math.max(0, Math.floor(Number(numParcelasOrList) || 0));
  const valor = Number(valorParcela) || 0;
  if (n <= 0) return "";
  const base = dataPrimeiroVenc ? new Date(`${dataPrimeiroVenc}T12:00:00`) : null;
  const linhas = [];
  for (let i = 0; i < n; i++) {
    let dataStr = "a combinar";
    if (base && !isNaN(base.getTime())) {
      const d = new Date(base);
      d.setMonth(d.getMonth() + i);
      dataStr = d.toLocaleDateString("pt-BR");
    }
    linhas.push(`${i + 1}ª Parcela — Data: ${dataStr} — Valor: ${formatBrl(valor)}`);
  }
  return linhas.join("\n");
}

export function buildContractDados(formData = {}) {
  const forma = String(formData.forma_pagamento || "conforme condições da proposta");
  const cronograma = Array.isArray(formData.parcelas) && formData.parcelas.length > 0
    ? buildCronograma(formData.parcelas)
    : buildCronograma(formData.num_parcelas, formData.valor_parcela, formData.data_primeiro_venc);

  const result = {
    ...formData,
    forma_pagamento: forma,
    cronograma_pagamento: cronograma || String(formData.condicoes_pagamento || "Conforme condições da proposta comercial aceita."),
    parcelas: Array.isArray(formData.parcelas) ? formData.parcelas : undefined,
  };
  return result;
}

/**
 * Filtra os marcadores ativos retornando apenas as variáveis dinâmicas que necessitam
 * de input customizado no formulário (ex: area_m2, potencia_kwp, cro, marca_veiculo).
 */
export function extractDynamicPlaceholders(textOrClauses) {
  const all = extractPlaceholders(textOrClauses);
  return all.filter((key) => !isSystemOrStandardField(key));
}

/**
 * Formata a chave da variável para exibição amigável como rótulo de input.
 * Ex: "potencia_kwp" -> "Potência Kwp" / "Potencia Kwp".
 */
export function formatFieldLabel(key) {
  if (!key) return "";
  return key
    .replace(/_/g, " ")
    .replace(/\b[a-zÀ-ÿ]/g, (letter) => letter.toUpperCase())
    .trim();
}
