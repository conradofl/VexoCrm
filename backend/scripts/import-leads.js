// VexoCrm/backend/scripts/import-leads.js
// Imports leads from scripts/leads.json into direct Postgres.
// Requires: backend/.env with DATABASE_URL
// Run from backend/: node scripts/import-leads.js

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import pg from "pg";

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const backendDir = join(__dirname, "..");

dotenv.config({ path: join(backendDir, ".env") });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("Missing DATABASE_URL in backend/.env");
  process.exit(1);
}

const leadsPath = join(backendDir, "..", "scripts", "leads.json");

function quoteIdent(name) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(String(name || ""))) {
    throw new Error(`Invalid identifier: ${name}`);
  }
  return `"${name}"`;
}

async function upsertRows(client, table, rows, conflictColumns) {
  if (!rows.length) return;

  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const values = [];
  const placeholders = rows.map((row) => {
    const rowPlaceholders = columns.map((column) => {
      values.push(row[column] ?? null);
      return `$${values.length}`;
    });
    return `(${rowPlaceholders.join(", ")})`;
  });

  const updateColumns = columns.filter((column) => !conflictColumns.includes(column));
  const updates = updateColumns.map((column) => `${quoteIdent(column)} = excluded.${quoteIdent(column)}`);
  const sql = `
    insert into ${quoteIdent(table)} (${columns.map(quoteIdent).join(", ")})
    values ${placeholders.join(", ")}
    on conflict (${conflictColumns.map(quoteIdent).join(", ")})
    do update set ${updates.join(", ")}
  `;

  await client.query(sql, values);
}

async function main() {
  let leads;
  try {
    leads = JSON.parse(readFileSync(leadsPath, "utf8"));
  } catch (err) {
    console.error("Failed to read leads.json:", err.message);
    console.error("Run: python scripts/excel-to-leads.py path/to/planilha.xlsx");
    process.exit(1);
  }

  if (!Array.isArray(leads) || leads.length === 0) {
    console.error("No leads in leads.json");
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query("begin");
    const clientId = leads[0]?.client_id || "infinie";
    await client.query(
      `
        insert into public.leads_clients (id, name)
        values ($1, $2)
        on conflict (id) do update set name = excluded.name
      `,
      [clientId, "Infinie"]
    );
    await upsertRows(client, "leads", leads, ["client_id", "telefone"]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    console.error("Postgres import error:", error.message);
    if (error.code === "42P01") {
      console.error("Table 'leads' may not exist. Run migrations first.");
    }
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log(`Imported ${leads.length} leads successfully.`);
}

main();
