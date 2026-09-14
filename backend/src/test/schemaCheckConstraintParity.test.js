/**
 * REGRA DE OURO DAS CHECK CONSTRAINTS:
 * 
 * As constraints de banco e os literais do código DEVEM ser estritos e alinhados.
 * NUNCA afrouxe uma constraint adicionando valores arbitrários, duplicados ou grafias
 * concorrentes (ex: 'canceled' e 'cancelled') apenas para fazer este teste passar!
 * 
 * Se o código estiver escrevendo um valor não suportado:
 *   1. Descubra o motivo de negócio.
 *   2. Decida a grafia canônica única.
 *   3. Corrija o código que escreve errado.
 *   4. Crie uma migration idempotente que normalize registros legados e atualize a constraint.
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 * ALCANCE REAL E LIMITES DESTE TESTE (LEIA ANTES DE CONFIAR CEGAMENTE):
 * ═══════════════════════════════════════════════════════════════════════════════
 * 1. O QUE ESTE TESTE COBRE:
 *    - Ele faz varredura estática de LITERAIS explícitos passados em queries SQL
 *      (ex.: UPDATE followup_schedules SET status = 'canceled' -> detecta a violação)
 *      ou literais fixos em constantes mapeadas.
 * 
 * 2. O QUE ESTE TESTE NÃO COBRE (CASOS DINÂMICOS):
 *    - Valores gerados em tempo de execução via funções de normalização
 *      (ex.: normalizeLeadSource(source), sanitizeStatus(s), resolveAccessRole(r)).
 *    - Valores originados dinamicamente de payloads de API, webhooks ou parâmetros
 *      de requisição que não passam por validação/enum estrito antes do SQL.
 * 
 * PORTANTO: Sempre que criar ou modificar funções que calculam ou normalizam valores
 * para colunas com CHECK constraint no Postgres, certifique-se de que os retornos
 * possíveis da função pertençam ESTRITAMENTE ao conjunto definido na migration!
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Extrai constraints das migrations do Supabase
function extractConstraintsFromMigrations(migrationsDir) {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const constraints = new Map(); // key: "table.column" -> Set<string>

  for (const file of files) {
    const content = readFileSync(join(migrationsDir, file), "utf8");

    // Match 1: col_name type CHECK (col_name IN ('a', 'b', ...)) or CHECK (col_name IS NULL OR col_name IN (...))
    // Match 2: ADD CONSTRAINT name CHECK (col IN (...))
    // Match 3: CREATE TABLE table_name ( ... col_name ... CHECK (...) )
    
    // Procura tabelas e suas colunas com CHECK ( ... IN (...) )
    const tableCreateRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\);/gi;
    let tableMatch;
    while ((tableMatch = tableCreateRegex.exec(content)) !== null) {
      const tableName = tableMatch[1].toLowerCase();
      const body = tableMatch[2];

      const colCheckRegex = /([a-zA-Z0-9_]+)\s+[a-zA-Z0-9_()]+[\s\S]*?CHECK\s*\(\s*(?:[a-zA-Z0-9_]+\s+IS\s+NULL\s+OR\s+)?(?:[a-zA-Z0-9_]+)\s+IN\s*\(([^)]+)\)\s*\)/gi;
      let colMatch;
      while ((colMatch = colCheckRegex.exec(body)) !== null) {
        const colName = colMatch[1].toLowerCase();
        const allowedValues = colMatch[2]
          .split(",")
          .map((v) => v.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);

        const key = `${tableName}.${colName}`;
        constraints.set(key, new Set(allowedValues));
      }
    }

    // Procura alterações avulsas: ALTER TABLE [public.]table ADD CONSTRAINT ... CHECK (col IN (...))
    const alterRegex = /ALTER\s+TABLE\s+(?:public\.)?([a-zA-Z0-9_]+)[\s\S]*?ADD\s+CONSTRAINT\s+([a-zA-Z0-9_]+)\s+CHECK\s*\(\s*(?:([a-zA-Z0-9_]+)\s+IS\s+NULL\s+OR\s+)?([a-zA-Z0-9_]+)\s+IN\s*\(([^)]+)\)\s*\)/gi;
    let alterMatch;
    while ((alterMatch = alterRegex.exec(content)) !== null) {
      const tableName = alterMatch[1].toLowerCase();
      const colName = (alterMatch[4] || alterMatch[3]).toLowerCase();
      const allowedValues = alterMatch[5]
        .split(",")
        .map((v) => v.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);

      const key = `${tableName}.${colName}`;
      // Sobrescreve com a constraint mais recente
      constraints.set(key, new Set(allowedValues));
    }
  }

  return constraints;
}

// Encontra literais de status/enums escritos no código JS
function scanJsWriters(srcDir) {
  const violations = [];

  function walk(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const fullPath = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && e.name !== "test") {
          walk(fullPath);
        }
      } else if (e.isFile() && e.name.endsWith(".js")) {
        checkFile(fullPath);
      }
    }
  }

  function checkFile(filePath) {
    const code = readFileSync(filePath, "utf8");

    // Análise de literais específicos para tabelas conhecidas
    if (filePath.includes("followup/")) {
      // followup_schedules status
      const scheduleStatusUpdates = code.matchAll(/UPDATE\s+followup_schedules\s+SET\s+status\s*=\s*['"]([a-zA-Z0-9_]+)['"]/gi);
      for (const m of scheduleStatusUpdates) {
        violations.push({ file: filePath, column: "followup_schedules.status", value: m[1] });
      }

      // followup_jobs status
      const jobStatusUpdates = code.matchAll(/UPDATE\s+followup_jobs\s+SET\s+status\s*=\s*['"]([a-zA-Z0-9_]+)['"]/gi);
      for (const m of jobStatusUpdates) {
        violations.push({ file: filePath, column: "followup_jobs.status", value: m[1] });
      }

      // followup_schedules origin_type
      if (code.includes("origin_type =") || code.includes("origin_type:")) {
        const originTypeLines = code.split("\n").filter(l => l.includes("origin_type =") || l.includes("origin_type:"));
        for (const line of originTypeLines) {
          const stringLiterals = line.match(/['"]([a-zA-Z0-9_]+)['"]/g) || [];
          for (const lit of stringLiterals) {
            const raw = lit.replace(/['"]/g, "");
            if (["manual", "utm", "default"].includes(raw)) {
              violations.push({ file: filePath, column: "followup_schedules.origin_type", value: raw });
            }
          }
        }
      }

      // followup_templates trigger_type
      if (code.includes("trigger_type")) {
        const triggerMatches = code.matchAll(/case\s+['"]([a-zA-Z0-9_]+)['"]|trigger_type\s*===\s*['"]([a-zA-Z0-9_]+)['"]/g);
        for (const m of triggerMatches) {
          const val = m[1] || m[2];
          if (["on_schedule", "after_enrollment", "no_reply", "before_meeting", "after_meeting", "before_anchor", "after_anchor"].includes(val)) {
            violations.push({ file: filePath, column: "followup_templates.trigger_type", value: val });
          }
        }
      }
    }
  }

  walk(srcDir);
  return violations;
}

describe("Schema CHECK Constraints & Code Parity Invariant", () => {
  const migrationsDir = resolve("supabase/migrations");
  const srcDir = resolve("src");

  const constraints = extractConstraintsFromMigrations(migrationsDir);

  it("extracts core check constraints from database migrations", () => {
    expect(constraints.has("followup_schedules.origin_type")).toBe(true);
    expect(constraints.has("followup_schedules.status")).toBe(true);
    expect(constraints.has("followup_jobs.status")).toBe(true);
    expect(constraints.has("followup_templates.trigger_type")).toBe(true);

    const schedOrigin = constraints.get("followup_schedules.origin_type");
    expect(schedOrigin.has("manual")).toBe(true);
    expect(schedOrigin.has("utm")).toBe(true);
    expect(schedOrigin.has("default")).toBe(true);
    // Não deve conter valores especulativos não implementados
    expect(schedOrigin.has("api")).toBe(false);
    expect(schedOrigin.has("webhook")).toBe(false);

    const schedStatus = constraints.get("followup_schedules.status");
    expect(schedStatus.has("cancelled")).toBe(true);
    expect(schedStatus.has("canceled")).toBe(false); // Grafia única!
  });

  it("validates that all code writers conform strictly to database check constraints", () => {
    const writers = scanJsWriters(srcDir);
    const failedWrites = [];

    for (const writer of writers) {
      const allowedSet = constraints.get(writer.column);
      if (!allowedSet) continue;

      if (!allowedSet.has(writer.value)) {
        failedWrites.push({
          file: writer.file.replace(resolve("."), ""),
          column: writer.column,
          invalidValue: writer.value,
          allowedValues: Array.from(allowedSet),
        });
      }
    }

    expect(failedWrites).toEqual([]);
  });
});
