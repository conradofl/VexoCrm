import dotenv from "dotenv";
dotenv.config();

async function run() {
  const { createDatabasePool } = await import("./src/pgSupabaseCompat.js");
  const pool = createDatabasePool(process.env.DATABASE_URL);
  try {
    const res = await pool.query(
      "INSERT INTO public.events (name, date, location) VALUES ($1, $2, $3) RETURNING *",
      ["Masterclass Teste Vexo", new Date().toISOString(), "Online"]
    );
    console.log("Inserted event:", res.rows[0]);
  } catch (err) {
    console.error("Error inserting event:", err);
  } finally {
    await pool.end();
  }
}

run();
