// backend/src/scripts/reaplicarWebhooksEvolution.mjs
//
// Reaplica o webhook da Evolution de cada instância do Vexo com o token no cabeçalho x-vexo-webhook-token e SEM token na
// URL. Lógica em services/webhookReapply.js. Não reinicia, não reconecta e não mexe em sessão de WhatsApp: só chama
// POST /webhook/set (o mesmo que a tela de chips faz ao salvar) e lê de volta com GET /webhook/find.
//
// Uso (Console do bk-vexo no EasyPanel), nesta ordem:
//   node src/scripts/reaplicarWebhooksEvolution.mjs                              # dry-run: lista o que mudaria
//   node src/scripts/reaplicarWebhooksEvolution.mjs --aplicar --instancia NOME   # canário: uma instância só
//   node src/scripts/reaplicarWebhooksEvolution.mjs --aplicar                    # todas
//
// --aplicar exige EVOLUTION_WEBHOOK_TOKEN no ambiente (aborta sem ele). Nunca imprime valor de token.
import pg from "pg";
import { reaplicarWebhooks } from "../services/webhookReapply.js";
import { instalarMascaraDeLog } from "../services/logRedaction.js";

instalarMascaraDeLog();
const args = process.argv.slice(2);
const aplicar = args.includes("--aplicar");
const i = args.indexOf("--instancia");
const instancia = i >= 0 ? String(args[i + 1] || "").trim() || null : null;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
let code = 0;
try {
  if (i >= 0 && !instancia) throw new Error("--instancia precisa do nome da instância");
  const r = await reaplicarWebhooks({ pool, aplicar, instancia });
  if (r.falhas > 0) code = 1;
} catch (e) {
  console.log("ERRO:", String(e?.message || e).slice(0, 300));
  code = 1;
} finally {
  await pool.end().catch(() => {});
}
process.exit(code);
