// VexoCrm/backend/scripts/import-leads.js
// Imports leads from scripts/leads.json into Supabase.
// Requires: backend/.env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// Run from backend/: node scripts/import-leads.js

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendDir = join(__dirname, "..");

dotenv.config({ path: join(backendDir, ".env") });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const leadsPath = join(backendDir, "..", "scripts", "leads.json");

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

  // Ensure leads_clients has 'infinie'
  const clientId = leads[0]?.client_id || "infinie";
  await supabase.from("leads_clients").upsert(
    { id: clientId, name: "Infinie" },
    { onConflict: "id", ignoreDuplicates: true }
  );

  // Upsert by (client_id, telefone)
  const { data, error } = await supabase.from("leads").upsert(leads, {
    onConflict: "client_id,telefone",
    ignoreDuplicates: false,
  });

  if (error) {
    console.error("Supabase error:", error.message);
    if (error.code === "42P01") {
      console.error("Table 'leads' may not exist. Run migrations first.");
    }
    process.exit(1);
  }

  console.log(`Imported ${leads.length} leads successfully.`);
}

main();
