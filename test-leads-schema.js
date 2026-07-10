require("dotenv").config({ path: "backend/.env" });
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const { data, error } = await supabase.from('leads').select("*").limit(1);
  console.log(error ? "Error: " + error.message : "Success: " + Object.keys(data[0] || {}).join(", "));
}
run();
