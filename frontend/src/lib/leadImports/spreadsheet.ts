import * as XLSX from "xlsx";
import type { Campaign, CampaignSequenceStep } from "@/hooks/useCampanhas";

const CAMPAIGN_TIME_ZONE = "America/Sao_Paulo";

export interface StepActionButton {
  displayText: string;
  type: "url" | "reply";
  url?: string;
  replyText?: string;
}

export interface FilterRule {
  column: string;
  operator: "equals" | "contains" | "gt" | "lt";
  value: string;
  includeMissing?: boolean;
}

export function findHeaderRowIndex(rangeRows: unknown[][]): number {
  const aliases = [
    "telefone", "telefones", "fone", "fones", "celular", "celulares", "whatsapp", "whatsapps", "phone", "phones", "numero", "numeros", "numero_telefone", "numero_telefones", "telefone_whatsapp", "telefones_whatsapp",
    "nome", "name", "cliente", "contato", "lead", "responsavel", "email", "e_mail", "mail", "city", "cidade", "estado", "uf", "tipo", "tipo_cliente", "perfil", "produto", "status", "dados", "informacoes", "info"
  ];

  let bestIdx = 0;
  let maxMatches = 0;

  const scanLimit = Math.min(rangeRows.length, 20);
  for (let i = 0; i < scanLimit; i++) {
    const row = rangeRows[i];
    if (!Array.isArray(row)) continue;

    let matches = 0;
    for (const cell of row) {
      if (cell === null || cell === undefined) continue;
      const normalized = String(cell)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
      if (aliases.includes(normalized)) {
        matches++;
      }
    }

    if (matches > maxMatches) {
      maxMatches = matches;
      bestIdx = i;
    }
  }

  if (maxMatches === 0) {
    for (let i = 0; i < rangeRows.length; i++) {
      const row = rangeRows[i];
      if (Array.isArray(row) && row.some(cell => String(cell ?? "").trim() !== "")) {
        return i;
      }
    }
  }

  return bestIdx;
}

export function parseSpreadsheetFile(file: File): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const result = event.target?.result;
        if (!result) return reject(new Error("Não foi possível ler o arquivo."));
        const workbook = XLSX.read(result, { type: "array", cellDates: true });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) return reject(new Error("A planilha não possui dados."));
        const worksheet = workbook.Sheets[firstSheetName];

        const rangeRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: "" });
        if (!rangeRows || rangeRows.length === 0) {
          return resolve([]);
        }

        const headerIdx = findHeaderRowIndex(rangeRows);
        const rawHeaders = rangeRows[headerIdx];
        const headers = rawHeaders.map((h, colIdx) => {
          const val = String(h ?? "").trim();
          return val !== "" ? val : `__EMPTY_${colIdx}`;
        });

        const parsedObjects: Record<string, unknown>[] = [];
        for (let i = headerIdx + 1; i < rangeRows.length; i++) {
          const row = rangeRows[i];
          if (!Array.isArray(row)) continue;
          if (row.every(cell => String(cell ?? "").trim() === "")) continue;

          // Skip if this row is a duplicate/leaked header row
          const isHeaderRow = row.some(cell => {
            const val = String(cell ?? "").trim().toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/[^a-z0-9]+/g, "_");
            return val.includes("telefone") || val.includes("whatsapp") || val.includes("celular") || val.includes("phone") || val.includes("fone") || val === "contato" || val === "leads" || val === "lead";
          }) && row.some(cell => {
            const val = String(cell ?? "").trim().toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/[^a-z0-9]+/g, "_");
            return val.includes("nome") || val.includes("name") || val.includes("cliente") || val.includes("contato") || val.includes("lead") || val.includes("responsavel");
          });
          if (isHeaderRow) continue;

          const obj: Record<string, unknown> = {};
          headers.forEach((header, colIdx) => {
            obj[header] = row[colIdx] !== undefined ? row[colIdx] : "";
          });
          parsedObjects.push(obj);
        }

        resolve(parsedObjects);
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Falha ao processar a planilha."));
      }
    };
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo selecionado."));
    reader.readAsArrayBuffer(file);
  });
}

export function detectSpreadsheetColumns(rows: Record<string, unknown>[]) {
  const mapping = {
    telefone: null as string | null,
    nome: null as string | null,
  };

  if (!Array.isArray(rows) || rows.length === 0) return mapping;

  const firstRow = rows[0];
  if (!firstRow || typeof firstRow !== "object") return mapping;

  const keys = Object.keys(firstRow);

  const aliasesMap = {
    telefone: ["telefone", "telefones", "fone", "fones", "celular", "celulares", "whatsapp", "whatsapps", "phone", "phones", "numero", "numeros", "numero_telefone", "numero_telefones", "telefone_whatsapp", "telefones_whatsapp"],
    nome: ["nome", "name", "cliente", "contato", "lead", "responsavel"],
  };

  // 1. Try mapping by alias matching first
  for (const key of keys) {
    const normalizedKey = key.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    for (const [field, aliases] of Object.entries(aliasesMap)) {
      if (field === "telefone" && !mapping.telefone && aliases.includes(normalizedKey)) {
        mapping.telefone = key;
      }
      if (field === "nome" && !mapping.nome && aliases.includes(normalizedKey)) {
        mapping.nome = key;
      }
    }
  }

  // 2. Fallback scan by value content for phone and name
  const sampleRows = rows.slice(0, 10);

  if (!mapping.telefone) {
    for (const key of keys) {
      let matches = 0;
      let total = 0;
      for (const row of sampleRows) {
        const val = String(row[key] ?? "").trim().replace(/\D/g, "");
        if (val) {
          total++;
          if (val.length >= 8 && val.length <= 15) {
            matches++;
          }
        }
      }
      if (total > 0 && matches / total >= 0.7) {
        mapping.telefone = key;
        break;
      }
    }
  }

  if (!mapping.nome) {
    for (const key of keys) {
      if (key === mapping.telefone) continue;
      let matches = 0;
      let total = 0;
      for (const row of sampleRows) {
        const val = String(row[key] ?? "").trim();
        if (val) {
          total++;
          const digits = val.replace(/\D/g, "");
          if (digits.length < val.length * 0.5) {
            matches++;
          }
        }
      }
      if (total > 0 && matches / total >= 0.7) {
        mapping.nome = key;
        break;
      }
    }
  }

  return mapping;
}

export function getValidDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: unknown, fallback = "Sem data") {
  const date = getValidDate(value);
  return date ? date.toLocaleString("pt-BR", { timeZone: CAMPAIGN_TIME_ZONE }) : fallback;
}

export function campaignLocalDateTimeToUtcIso(value: string) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function campaignUtcIsoToLocalDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

export function getLeadField(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value);
  }
  return "";
}

export function getLeadNormalizedData(item: { normalized_data?: Record<string, unknown> | null }) {
  return item.normalized_data && typeof item.normalized_data === "object" ? item.normalized_data : {};
}

export function makeCampaignStepId() {
  return `step-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createCampaignStep(type: "text" | "image", order: number, patch: Partial<CampaignSequenceStep> = {}): CampaignSequenceStep & { buttons?: StepActionButton[] } {
  return {
    id: patch.id || makeCampaignStepId(),
    type,
    order,
    text: patch.text || "",
    textVariants: patch.textVariants || [],
    image: patch.image || null,
    enabled: patch.enabled ?? true,
    delayAfterSeconds: patch.delayAfterSeconds ?? 5,
    triggerMode: patch.triggerMode === "after_reply" ? "after_reply" : patch.triggerMode === "with_previous" ? "with_previous" : "immediate",
    buttons: (patch as any).buttons || [],
  };
}

export function normalizeCampaignSequence(meta?: Campaign["analytics_meta"]): Array<CampaignSequenceStep & { buttons?: StepActionButton[] }> {
  const provided = Array.isArray(meta?.sequence) ? meta.sequence : [];
  if (provided.length > 0) {
    return [...provided]
      .sort((a, b) => a.order - b.order)
      .map((step, idx) => ({
        ...step,
        order: idx + 1,
        textVariants: Array.isArray(step.textVariants) ? step.textVariants : [],
        image: step.image || null,
        enabled: step.enabled !== false,
        delayAfterSeconds: step.delayAfterSeconds || 5,
        triggerMode: step.triggerMode === "after_reply" ? "after_reply" : step.triggerMode === "with_previous" ? "with_previous" : "immediate",
        buttons: step.buttons || [],
      }));
  }
  return [];
}

// ---------------------------------------------------------------------------
// Mapeamento dinâmico de colunas na importação de planilhas
// ---------------------------------------------------------------------------

export type ColumnMappingTarget = "ignore" | "telefone" | "nome" | "custom";
export type CustomFieldType = "text" | "number" | "date";

export interface ColumnMappingItem {
  column: string;
  target: ColumnMappingTarget;
  label: string;
  type: CustomFieldType;
  key: string;
}

export interface StoredColumnMapping {
  columns: string[];
  mapping: Array<{
    column: string;
    target: ColumnMappingTarget;
    label?: string;
    type?: CustomFieldType;
    key?: string;
  }>;
}

export interface ColumnMappingValidationResult {
  isValid: boolean;
  errorMessage?: string;
  candidatePhoneColumn?: string | null;
}

export interface TypeDivergenceWarning {
  column: string;
  label: string;
  key: string;
  detectedType: CustomFieldType;
  registeredType: CustomFieldType;
  message: string;
}

/**
 * Retorna o valor de exemplo da PRIMEIRA LINHA PREENCHIDA de uma coluna específica,
 * evitando usar valores vazios de linhas anteriores.
 */
export function extractFirstFilledColumnValue(rows: Record<string, unknown>[], column: string): string {
  if (!Array.isArray(rows)) return "";
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const val = row[column];
    if (val !== undefined && val !== null) {
      const s = String(val).trim();
      if (s !== "") {
        return s;
      }
    }
  }
  return "";
}

/**
 * Mapeia cada coluna para o seu exemplo real não vazio.
 */
export function extractColumnSamples(columns: string[], rows: Record<string, unknown>[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const col of columns) {
    result[col] = extractFirstFilledColumnValue(rows, col);
  }
  return result;
}

export function parseNumberValue(val: unknown): number {
  if (typeof val === "number") return Number.isFinite(val) ? val : NaN;
  if (val === null || val === undefined) return NaN;
  const s = String(val).trim().replace(/^R\$\s*/i, "").trim();
  if (!s) return NaN;

  // Se contiver espaços no meio, não é um número válido (ex: "10 20")
  if (/\s/.test(s)) return NaN;

  if (s.includes(".") && s.includes(",")) {
    if (s.indexOf(".") < s.indexOf(",")) {
      // Formato brasileiro: 1.500,50
      const normalized = s.replace(/\./g, "").replace(",", ".");
      if ((normalized.match(/\./g) || []).length > 1) return NaN;
      if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return NaN;
      return parseFloat(normalized);
    } else {
      // Formato americano: 1,500.50
      const normalized = s.replace(/,/g, "");
      if ((normalized.match(/\./g) || []).length > 1) return NaN;
      if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return NaN;
      return parseFloat(normalized);
    }
  }

  // Dois ou mais pontos sem vírgula (ex: "1.2.3") -> inválido (dois pontos decimais)
  if ((s.match(/\./g) || []).length > 1) {
    return NaN;
  }

  // Duas ou mais vírgulas sem ponto (ex: "1,2,3") -> inválido
  if ((s.match(/,/g) || []).length > 1) {
    return NaN;
  }

  if (s.includes(",")) {
    const normalized = s.replace(",", ".");
    if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return NaN;
    return parseFloat(normalized);
  }

  if (!/^-?\d+(?:\.\d+)?$/.test(s)) {
    return NaN;
  }

  return parseFloat(s);
}

export function isNumericValue(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === "number") return Number.isFinite(val);
  const s = String(val).trim().replace(/^R\$\s*/i, "");
  if (s === "") return false;
  const parsed = parseNumberValue(s);
  return !Number.isNaN(parsed) && Number.isFinite(parsed) && /^-?\d+(?:[.,]\d+)*(?:[.,]\d+)?$/.test(s);
}

export function isDateValue(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (val instanceof Date) return !Number.isNaN(val.getTime());
  const s = String(val).trim();
  if (s === "") return false;

  const isoPattern = /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
  const brPattern = /^\d{1,2}[\/-]\d{1,2}[\/-]\d{4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?$/;

  if (isoPattern.test(s) || brPattern.test(s)) {
    const timestamp = Date.parse(s.replace(/(\d{2})\/(\d{2})\/(\d{4})/, "$3-$2-$1"));
    return !Number.isNaN(timestamp);
  }
  return false;
}

/**
 * Propõe o tipo da coluna com base nos valores não vazios:
 * - Só números -> "number"
 * - Só datas -> "date"
 * - Misto ou outros -> "text"
 */
export function inferColumnType(values: unknown[]): CustomFieldType {
  if (!Array.isArray(values) || values.length === 0) return "text";
  const nonEmpties = values.filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
  if (nonEmpties.length === 0) return "text";

  const allNumbers = nonEmpties.every(isNumericValue);
  if (allNumbers) return "number";

  const allDates = nonEmpties.every(isDateValue);
  if (allDates) return "date";

  return "text";
}

/**
 * Normaliza o rótulo da coluna em chave técnica segura (minúscula, sem acentos, underscores).
 */
export function normalizeFieldKey(label: string): string {
  if (!label || typeof label !== "string") return "";
  const trimmed = label.trim();
  const cleaned = trimmed.startsWith("=") ? trimmed.slice(1).trim() : trimmed;
  if (!cleaned) return "";

  return cleaned
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Localiza qual coluna mais se parece com telefone (por apelido ou por dígitos nos dados).
 */
export function guessPhoneColumnCandidate(
  columns: string[],
  sampleRows: Record<string, unknown>[] = []
): string | null {
  if (!Array.isArray(columns) || columns.length === 0) return null;

  const phoneAliases = [
    "telefone", "telefones", "fone", "fones", "celular", "celulares",
    "whatsapp", "whatsapps", "phone", "phones", "numero", "numeros",
    "numero_telefone", "numero_telefones", "telefone_whatsapp", "telefones_whatsapp"
  ];

  // 1. Apelidos exatos
  for (const col of columns) {
    const norm = normalizeFieldKey(col);
    if (phoneAliases.includes(norm)) {
      return col;
    }
  }

  // 2. Apelidos parciais comuns
  for (const col of columns) {
    const norm = normalizeFieldKey(col);
    if (norm.includes("tel") || norm.includes("cel") || norm.includes("wpp") || norm.includes("whats")) {
      return col;
    }
  }

  // 3. Varredura por padrão de dígitos nas linhas de exemplo (8 a 15 dígitos)
  if (Array.isArray(sampleRows) && sampleRows.length > 0) {
    for (const col of columns) {
      let matches = 0;
      let total = 0;
      for (const row of sampleRows.slice(0, 20)) {
        if (!row) continue;
        const raw = String(row[col] ?? "").trim();
        const digits = raw.replace(/\D/g, "");
        if (digits) {
          total++;
          if (digits.length >= 8 && digits.length <= 15) {
            matches++;
          }
        }
      }
      if (total > 0 && matches / total >= 0.7) {
        return col;
      }
    }
  }

  return null;
}

export function areColumnSetsEqual(colsA: string[], colsB: string[]): boolean {
  if (!Array.isArray(colsA) || !Array.isArray(colsB)) return false;
  if (colsA.length !== colsB.length) return false;
  const setA = new Set(colsA.map((c) => c.trim().toLowerCase()));
  const setB = new Set(colsB.map((c) => c.trim().toLowerCase()));
  if (setA.size !== setB.size) return false;
  for (const a of setA) {
    if (!setB.has(a)) return false;
  }
  return true;
}

/**
 * Procura um mapeamento anterior cujo conjunto de colunas seja idêntico ao atual.
 */
export function findMatchingRememberedMapping(
  columns: string[],
  pastImports: Array<{ column_mapping?: StoredColumnMapping | null }>
): StoredColumnMapping | null {
  if (!Array.isArray(columns) || columns.length === 0 || !Array.isArray(pastImports)) return null;
  for (const imp of pastImports) {
    if (imp?.column_mapping && Array.isArray(imp.column_mapping.columns)) {
      if (areColumnSetsEqual(columns, imp.column_mapping.columns)) {
        return imp.column_mapping;
      }
    }
  }
  return null;
}

/**
 * Propõe a configuração de mapeamento de colunas para uma planilha recém-carregada.
 */
export function proposeColumnMappings(params: {
  columns: string[];
  sampleRows?: Record<string, unknown>[];
  rememberedMapping?: StoredColumnMapping | null;
  knownCustomFields?: Array<{ key: string; label: string; type: CustomFieldType }>;
}): ColumnMappingItem[] {
  const { columns, sampleRows = [], rememberedMapping = null } = params;
  if (!Array.isArray(columns) || columns.length === 0) return [];

  // Se existe mapeamento anterior idêntico em colunas, pré-preenche tudo!
  if (rememberedMapping && areColumnSetsEqual(columns, rememberedMapping.columns)) {
    const rememberedMap = new Map(
      rememberedMapping.mapping.map((m) => [m.column.trim().toLowerCase(), m])
    );

    return columns.map((col) => {
      const match = rememberedMap.get(col.trim().toLowerCase());
      if (match) {
        return {
          column: col,
          target: match.target,
          label: match.label || col,
          type: match.type || "text",
          key: match.key || normalizeFieldKey(match.label || col),
        };
      }
      return {
        column: col,
        target: "ignore",
        label: col,
        type: inferColumnType(sampleRows.map((r) => r[col])),
        key: normalizeFieldKey(col),
      };
    });
  }

  // Detecção inicial automática por apelidos conhecidos
  const detected = detectSpreadsheetColumns(
    sampleRows.length > 0 ? sampleRows : [{ ...Object.fromEntries(columns.map((c) => [c, ""])) }]
  );

  return columns.map((col) => {
    let target: ColumnMappingTarget = "ignore";
    if (detected.telefone && col === detected.telefone) {
      target = "telefone";
    } else if (detected.nome && col === detected.nome) {
      target = "nome";
    }

    const colValues = sampleRows.map((r) => r[col]);
    const inferredType = inferColumnType(colValues);

    return {
      column: col,
      target,
      label: col,
      type: inferredType,
      key: normalizeFieldKey(col),
    };
  });
}

/**
 * Validação do mapeamento:
 * - Telefone obrigatório e único. Sem ele, a importação é bloqueada e informa qual coluna parece ser telefone.
 * - Nome é único.
 * - Campos de informação do lead não podem repetir rótulo/chave normalizada.
 */
export function validateColumnMappings(
  mappings: ColumnMappingItem[],
  columns: string[] = [],
  sampleRows: Record<string, unknown>[] = []
): ColumnMappingValidationResult {
  if (!Array.isArray(mappings) || mappings.length === 0) {
    return {
      isValid: false,
      errorMessage: "Nenhuma coluna para mapear.",
      candidatePhoneColumn: null,
    };
  }

  const effectiveColumns = columns.length > 0 ? columns : mappings.map((m) => m.column);

  // 1. Telefone obrigatório e único
  const phoneMappings = mappings.filter((m) => m.target === "telefone");
  if (phoneMappings.length === 0) {
    const candidate = guessPhoneColumnCandidate(effectiveColumns, sampleRows);
    const message = candidate
      ? `Nenhuma coluna mapeada para telefone. A coluna '${candidate}' parece ser o telefone.`
      : "Nenhuma coluna mapeada para telefone. O telefone é obrigatório para importar.";
    return {
      isValid: false,
      errorMessage: message,
      candidatePhoneColumn: candidate,
    };
  }
  if (phoneMappings.length > 1) {
    return {
      isValid: false,
      errorMessage: "Mais de uma coluna foi mapeada como Telefone. O destino Telefone é único.",
      candidatePhoneColumn: phoneMappings[0].column,
    };
  }

  // 2. Nome único
  const nameMappings = mappings.filter((m) => m.target === "nome");
  if (nameMappings.length > 1) {
    return {
      isValid: false,
      errorMessage: "Mais de uma coluna foi mapeada como Nome. O destino Nome é único.",
      candidatePhoneColumn: null,
    };
  }

  // 3. Informações customizadas não podem ter rótulos/chaves repetidas
  const customMappings = mappings.filter((m) => m.target === "custom");
  const seenKeys = new Set<string>();
  const seenLabels = new Set<string>();

  for (const m of customMappings) {
    const rawLabel = (m.label || m.column || "").trim().toLowerCase();
    const normKey = normalizeFieldKey(m.label || m.column || m.key);

    if (!rawLabel || !normKey) {
      return {
        isValid: false,
        errorMessage: `A coluna '${m.column}' foi marcada para guardar, mas está com rótulo vazio.`,
        candidatePhoneColumn: null,
      };
    }

    if (seenLabels.has(rawLabel) || seenKeys.has(normKey)) {
      return {
        isValid: false,
        errorMessage: `Duas colunas não podem ter o mesmo rótulo/destino de informação do lead: '${m.label}'.`,
        candidatePhoneColumn: null,
      };
    }

    seenLabels.add(rawLabel);
    seenKeys.add(normKey);
  }

  return {
    isValid: true,
  };
}

/**
 * Detecta se algum campo customizado possui tipo divergente do já registrado no banco de dados.
 */
export function detectTypeDivergences(
  mappings: ColumnMappingItem[],
  knownCustomFields: Array<{ key: string; label: string; type: CustomFieldType }>
): TypeDivergenceWarning[] {
  if (!Array.isArray(mappings) || !Array.isArray(knownCustomFields)) return [];

  const knownMap = new Map(knownCustomFields.map((f) => [f.key, f]));
  const warnings: TypeDivergenceWarning[] = [];

  for (const m of mappings) {
    if (m.target !== "custom") continue;
    const key = normalizeFieldKey(m.label || m.column);
    const existing = knownMap.get(key);
    if (existing && existing.type !== m.type) {
      warnings.push({
        column: m.column,
        label: m.label,
        key,
        detectedType: m.type,
        registeredType: existing.type,
        message: `A coluna '${m.column}' veio com valores do tipo '${m.type}', mas o campo '${m.label}' já está cadastrado como '${existing.type}'. O tipo original será mantido no registro.`,
      });
    }
  }

  return warnings;
}

/**
 * Aplica o mapeamento a uma linha da planilha:
 * - Colunas marcadas como informação do lead entram em dados.campos com chave normalizada.
 * - Colunas ignoradas não entram em lugar nenhum.
 * - Valor vazio não cria chave nem vira "" ou 0: a chave simplesmente não entra para aquele lead.
 * - Sem nome mapeado, o nome vira o telefone.
 */
export function applyColumnMappingsToRow(
  row: Record<string, unknown>,
  mappings: ColumnMappingItem[]
): {
  telefone: string;
  nome: string;
  dados: {
    campos: Record<string, unknown>;
    telefone_bruto?: string | null;
  };
} {
  const phoneMapping = mappings.find((m) => m.target === "telefone");
  const nameMapping = mappings.find((m) => m.target === "nome");
  const customMappings = mappings.filter((m) => m.target === "custom");

  const rawPhone = phoneMapping ? row[phoneMapping.column] : "";
  const phoneStr = rawPhone !== undefined && rawPhone !== null ? String(rawPhone).trim() : "";

  const rawName = nameMapping ? row[nameMapping.column] : "";
  const nameStr = rawName !== undefined && rawName !== null && String(rawName).trim() !== ""
    ? String(rawName).trim()
    : phoneStr;

  const campos: Record<string, unknown> = {};

  for (const m of customMappings) {
    const rawVal = row[m.column];
    if (rawVal === undefined || rawVal === null) continue;
    const str = String(rawVal).trim();
    if (str === "") continue;

    const normKey = normalizeFieldKey(m.label || m.column);
    if (!normKey) continue;

    if (m.type === "number") {
      const parsedNum = parseNumberValue(rawVal);
      campos[normKey] = !Number.isNaN(parsedNum) ? parsedNum : str;
    } else {
      campos[normKey] = str;
    }
  }

  const dados: { campos: Record<string, unknown>; telefone_bruto?: string | null } = {
    campos,
    telefone_bruto: phoneStr || null,
  };

  return {
    telefone: phoneStr,
    nome: nameStr,
    dados,
  };
}
