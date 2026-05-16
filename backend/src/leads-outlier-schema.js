const LEADS_OUTLIER_DADOS_FIELDS = [
  "nome",
  "cidade",
  "estado",
  "interesse",
  "objetivo",
  "credito",
  "parcela",
  "prazo",
  "lance_entrada_fgts",
  "experiencia_consorcio",
  "motivacao",
  "decisor",
  "melhor_horario",
];

function normalizeScalarValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function pickRawValue(source, ...keys) {
  for (const key of keys) {
    if (source && Object.prototype.hasOwnProperty.call(source, key)) {
      return source[key];
    }
  }
  return undefined;
}

export function normalizeLeadsOutlierDados(record = {}) {
  const nestedDados =
    record && typeof record.dados === "object" && !Array.isArray(record.dados) ? record.dados : {};

  const creditoRaw =
    pickRawValue(nestedDados, "credito", "credito_faixa", "crédito") ??
    pickRawValue(record, "credito", "credito_faixa", "crédito");

  const normalized = {
    nome: normalizeScalarValue(pickRawValue(nestedDados, "nome") ?? pickRawValue(record, "nome", "Nome")),
    cidade: normalizeScalarValue(pickRawValue(nestedDados, "cidade") ?? pickRawValue(record, "cidade", "Cidade")),
    estado: normalizeScalarValue(pickRawValue(nestedDados, "estado") ?? pickRawValue(record, "estado", "Estado")),
    interesse: normalizeScalarValue(
      pickRawValue(nestedDados, "interesse") ?? pickRawValue(record, "interesse")
    ),
    objetivo: normalizeScalarValue(
      pickRawValue(nestedDados, "objetivo") ?? pickRawValue(record, "objetivo")
    ),
    credito: normalizeScalarValue(creditoRaw),
    parcela: normalizeScalarValue(
      pickRawValue(nestedDados, "parcela") ?? pickRawValue(record, "parcela")
    ),
    prazo: normalizeScalarValue(pickRawValue(nestedDados, "prazo") ?? pickRawValue(record, "prazo")),
    lance_entrada_fgts: normalizeScalarValue(
      pickRawValue(nestedDados, "lance_entrada_fgts") ?? pickRawValue(record, "lance_entrada_fgts")
    ),
    experiencia_consorcio: normalizeScalarValue(
      pickRawValue(nestedDados, "experiencia_consorcio") ?? pickRawValue(record, "experiencia_consorcio")
    ),
    motivacao: normalizeScalarValue(
      pickRawValue(nestedDados, "motivacao") ?? pickRawValue(record, "motivacao")
    ),
    decisor: normalizeScalarValue(pickRawValue(nestedDados, "decisor") ?? pickRawValue(record, "decisor")),
    melhor_horario: normalizeScalarValue(
      pickRawValue(nestedDados, "melhor_horario") ?? pickRawValue(record, "melhor_horario")
    ),
  };

  return normalized;
}

export function validateLeadsOutlierDadosShape(raw) {
  if (raw === undefined || raw === null) {
    return { value: normalizeLeadsOutlierDados({}) };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "dados tem de ser um objeto simples" };
  }

  for (const key of Object.keys(raw)) {
    if (!LEADS_OUTLIER_DADOS_FIELDS.includes(key) && key !== "credito_faixa" && key !== "crédito") {
      return { error: `dados tem chave desconhecida: ${key}` };
    }
    const v = raw[key];
    if (
      v !== null &&
      v !== undefined &&
      typeof v !== "string" &&
      !(typeof v === "number" && Number.isFinite(v))
    ) {
      return {
        error: `dados.${key} tem de ser string, número ou null`,
      };
    }
  }

  return { value: normalizeLeadsOutlierDados({ dados: raw }) };
}

export function parseStoredHistorico(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function serializeHistorico(history) {
  return JSON.stringify(Array.isArray(history) ? history : []);
}

export function buildLeadsOutlierDataColumns(raw = {}) {
  const dados = normalizeLeadsOutlierDados(raw);
  return {
    nome: typeof dados.nome === "string" ? dados.nome : null,
    cidade: typeof dados.cidade === "string" ? dados.cidade : null,
    estado: typeof dados.estado === "string" ? dados.estado : null,
    interesse: dados.interesse ?? null,
    objetivo: dados.objetivo ?? null,
    credito: dados.credito ?? null,
    parcela: dados.parcela ?? null,
    prazo: dados.prazo ?? null,
    lance_entrada_fgts: dados.lance_entrada_fgts ?? null,
    experiencia_consorcio: dados.experiencia_consorcio ?? null,
    motivacao: dados.motivacao ?? null,
    decisor: dados.decisor ?? null,
    melhor_horario: dados.melhor_horario ?? null,
  };
}

export { LEADS_OUTLIER_DADOS_FIELDS };
