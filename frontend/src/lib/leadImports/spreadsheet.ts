import * as XLSX from "xlsx";
import type { Campaign, CampaignSequenceStep } from "@/hooks/useCampanhas";

const CAMPAIGN_TIME_ZONE = "America/Sao_Paulo";

export interface StepActionButton {
  displayText: string;
  type: "url" | "reply";
  url?: string;
}

export interface FilterRule {
  column: string;
  operator: "equals" | "contains" | "gt" | "lt";
  value: string;
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
    triggerMode: patch.triggerMode === "after_reply" ? "after_reply" : "immediate",
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
        triggerMode: step.triggerMode || "immediate",
        buttons: step.buttons || [],
      }));
  }
  return [];
}
