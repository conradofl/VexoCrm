import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const engineSource = readFileSync(resolve("src/followup/automationEngine.js"), "utf8");
const routesSource = readFileSync(resolve("src/followup/routes.js"), "utf8");

describe("LivPub Proactive Followup Automation Rules", () => {
  it("defines the LivPub candidates finder function", () => {
    expect(engineSource).toContain("export async function findLivPubCandidates(companyId)");
  });

  it("checks for both birthday and inactive configurations from default presets", () => {
    expect(engineSource).toContain("const config = buildDefaultSegmentationConfig(\"livpub\")");
    expect(engineSource).toContain("config.kpis.some(k => k.field === 'ultima_visita' && k.enabled)");
    expect(engineSource).toContain("config.kpis.some(k => k.field === 'data_nascimento' && k.enabled)");
  });

  it("implements the birthday trigger matching current month and day", () => {
    expect(engineSource).toContain("EXTRACT(MONTH FROM data_nascimento) = EXTRACT(MONTH FROM CURRENT_DATE)");
    expect(engineSource).toContain("EXTRACT(DAY FROM data_nascimento) = EXTRACT(DAY FROM CURRENT_DATE)");
  });

  it("implements the inactivity trigger matching leads who did not visit for > 6 months", () => {
    expect(engineSource).toContain("ultima_visita < NOW() - INTERVAL '6 months'");
  });

  it("contains the appropriate reason labels and context for both triggers", () => {
    expect(engineSource).toContain("livpub_aniversario: \"Esteira 3: Aniversariante do dia\"");
    expect(engineSource).toContain("livpub_inativo:     \"Esteira 4: Cliente inativo (> 6 meses)\"");
    expect(engineSource).toContain("livpub_aniversario: \"Este cliente faz aniversário hoje. Ofereça uma condição especial: cortesia/mesa VIP para o aniversariante e desconto para os convidados que forem junto.\"");
    expect(engineSource).toContain("livpub_inativo:     \"Este cliente não frequenta os eventos há mais de 6 meses. Tente reativá-lo.\"");
  });

  it("processes standard candidates and LivPub candidates concurrently in the runner", () => {
    expect(engineSource).toContain("const candidates = await findCandidates(company_id, campaign_id)");
    expect(engineSource).toContain("const livpubCandidates = await findLivPubCandidates(company_id)");
    expect(engineSource).toContain("const allCandidates = [...candidates, ...livpubCandidates]");
  });
});

describe("LivPub Birthday Automation (Esteira 3)", () => {
  it("selects perfil_musical alongside the lead so the AI can adapt the copy tone", () => {
    expect(engineSource).toContain("perfil_musical");
  });

  it("instructs the AI to offer VIP for the birthday lead and a discount for guests", () => {
    expect(engineSource).toContain("cortesia/mesa VIP para o aniversariante e desconto para os convidados que forem junto");
  });

  it("adapts the prompt to the lead's perfil_musical when generating the birthday copy", () => {
    expect(engineSource).toContain("reasonType === \"livpub_aniversario\"");
    expect(engineSource).toContain("ao perfil musical do cliente (${lead.perfil_musical})");
  });

  it("deduplicates birthday suggestions per calendar year regardless of prior status", () => {
    expect(engineSource).toContain("EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)");
    expect(engineSource).toContain('lead.reasonType === "livpub_aniversario"');
  });
});

describe("LivPub Reactivation Manual Trigger (Esteira 4)", () => {
  it("scans lead tables in batches to protect the database with 21k contacts", () => {
    expect(engineSource).toContain("async function fetchLeadsInBatches(tablename, whereSql, reasonType)");
    expect(engineSource).toContain("LIMIT ${ENGINE_BATCH_SIZE} OFFSET ${offset}");
    expect(engineSource).toContain("— lote ${batch}: ${rows.length} leads");
  });

  it("caps suggestions per run so a single sweep cannot flood Groq or the database", () => {
    expect(engineSource).toContain("ENGINE_MAX_SUGGESTIONS_PER_RUN");
    expect(engineSource).toContain("if (created >= ENGINE_MAX_SUGGESTIONS_PER_RUN) break;");
  });

  it("exports a manual trigger guarded against concurrent runs", () => {
    expect(engineSource).toContain("export function triggerAutomationRun()");
    expect(engineSource).toContain("if (engineRunning) return { started: false, alreadyRunning: true };");
  });

  it("schedules the cron through the same guarded trigger", () => {
    expect(engineSource).toContain("cron.schedule(\"0 */6 * * *\", () => { triggerAutomationRun(); })");
  });

  it("exposes the authenticated POST /engine/run route returning 202", () => {
    expect(routesSource).toContain("import { triggerAutomationRun } from \"./automationEngine.js\"");
    expect(routesSource).toContain("router.post(\"/engine/run\", requireFirebaseAuth, requireInternalPageAccess(\"planilhas\")");
    expect(routesSource).toContain("res.status(202).json({ success: true, started: true })");
    expect(routesSource).toContain("ENGINE_ALREADY_RUNNING");
  });
});
