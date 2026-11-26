// Retomada das respostas barradas (18-19/11): nesta versão SÓ classifica e conta, não envia. Postgres real (pglite).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { classifyBarredReplies, getBarredRetakeStatus, _resetBarredRetakeStatusForTesting } from "../campaign/retomadaBarradas.js";
import { pickCampaignAwaitingReply } from "../campaign/replyRouting.js";

const SEQ = { sequence: [
  { id: "s1", type: "text", text: "Oi", order: 1, enabled: true },
  { id: "s2", type: "text", text: "Passo 2", order: 2, enabled: true, triggerMode: "after_reply" },
] };
const esperando = (id = "camp-1") => ({ id, status: "ativa", analyticsMeta: SEQ, leadImportItem: { id: "it", progress: { status: "aguardando_usuario", nextStepIndex: 1, waitForReply: true } } });
const ctx = (camps) => ({ matches: camps, waitForReplyMatches: camps, processingWaitForReplyMatches: [], activePeriodCampaign: null });

let db;
afterEach(async () => {
  _resetBarredRetakeStatusForTesting();
  if (db) await db.close();
  db = null;
});

async function banco() {
  db = await createPgliteDb(`CREATE TABLE public.lead_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text, phone text,
    direction text, wa_message_id text, message_timestamp timestamptz, created_at timestamptz, meta jsonb DEFAULT '{}'::jsonb);`);
  const ins = (c, p, dir, ts, cr, meta = {}) => db.query(
    "INSERT INTO lead_messages (client_id, phone, direction, wa_message_id, message_timestamp, created_at, meta) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)",
    [c, p, dir, `wa-${p}-${cr}`, ts, cr, JSON.stringify(meta)]
  );
  const B = { agente_barrado: "mensagem_atrasada" };
  // adv: 4 leads barrados
  await ins("adv", "5534991342631", "inbound", "2026-11-18 21:23Z", "2026-11-19 03:00Z", B);       // elegível
  await ins("adv", "5534991442757", "inbound", "2026-11-18 21:28Z", "2026-11-19 03:00Z", B);       // equipe respondeu depois
  await ins("adv", "553491442757", "outbound", null, "2026-11-20 12:00Z");                        //   (outra grafia: sem o 9)
  await ins("adv", "5534999669078", "inbound", "2026-11-18 21:29Z", "2026-11-19 03:00Z", B);       // pediu para sair
  await ins("adv", "5534990001111", "inbound", "2026-11-18 21:30Z", "2026-11-19 03:00Z", B);       // sem etapa pendente
  await ins("adv", "5534990002222", "inbound", "2026-11-18 21:31Z", "2026-11-19 03:00Z", { ...B, retomada_em: "x" }); // já retomada
  await ins("adv", "5534990003333", "inbound", "2026-11-25 10:00Z", "2026-11-25 10:00Z", B);       // fora do período
  await ins("adv", "5534990004444", "inbound", "2026-11-18 21:32Z", "2026-11-19 03:00Z");          // não barrada
  // a mesma pessoa barrada duas vezes conta UMA
  await ins("tinge", "5511999990001", "inbound", "2026-11-18 10:00Z", "2026-11-18 20:00Z", B);
  await ins("tinge", "5511999990001", "inbound", "2026-11-18 10:05Z", "2026-11-18 21:00Z", B);
  return { query: (sql, p) => db.query(sql, p) };
}

describe("classifyBarredReplies (não envia)", () => {
  it("[OBRIGATÓRIO] classifica por empresa: atendida depois (em qualquer grafia), opt-out, sem etapa pendente, elegível; uma vez por lead", async () => {
    const pool = await banco();
    const consultados = [];
    const r = await classifyBarredReplies(pool, {
      optedOut: async (_p, { phone }) => phone === "5534999669078",
      findCampaignReplyMatches: async ({ phone }) => { consultados.push(phone); return ctx(phone === "5534990001111" ? [] : [esperando()]); },
    });
    expect(r.porEmpresa.adv).toEqual({ barradas: 4, atendidaDepois: 1, optOut: 1, semEtapaPendente: 1, elegiveis: 1 });
    expect(r.porEmpresa.tinge).toEqual({ barradas: 1, atendidaDepois: 0, optOut: 0, semEtapaPendente: 0, elegiveis: 1 });
    expect(r.elegiveis.map((e) => e.phone).sort()).toEqual(["5511999990001", "5534991342631"]);
    expect(consultados).not.toContain("5534991442757"); // atendida depois: nem consulta campanha
  });

  it("no /health: só contagens, modo so_contagem, sem telefone", async () => {
    const pool = await banco();
    expect(getBarredRetakeStatus(pool)).toEqual({ medido: false, emAndamento: true });
    await new Promise((r) => setTimeout(r, 400));
    const st = getBarredRetakeStatus(pool);
    expect(st.modo).toBe("so_contagem");
    expect(JSON.stringify(st)).not.toMatch(/\d{10,}/);
  });

  it("o módulo não envia: não importa continueCampaignLeadFromReply nem o motor de envio", () => {
    const src = readFileSync(resolve("src/campaign/retomadaBarradas.js"), "utf8");
    expect(src).not.toMatch(/continueCampaignLeadFromReply|dispatchCampaignSequence|sendText/);
  });
});

describe("pickCampaignAwaitingReply (regra extraída do webhook, igual)", () => {
  it("pega a campanha com progresso pendente e próximo passo; ignora pausada, finalizada e sem passo", () => {
    const pausada = { ...esperando("p"), status: "pausada" };
    const finalizada = { ...esperando("f"), leadImportItem: { progress: { status: "finalizado", nextStepIndex: 1 } } };
    const semPasso = { ...esperando("s"), leadImportItem: { progress: { status: "aguardando_usuario", nextStepIndex: 5 } } };
    expect(pickCampaignAwaitingReply(ctx([pausada, finalizada, semPasso, esperando("ok")]))?.id).toBe("ok");
    expect(pickCampaignAwaitingReply(ctx([pausada, finalizada]))).toBeNull();
  });

  it("o webhook usa a função extraída", () => {
    const src = readFileSync(resolve("src/domains/chatbot/routes.js"), "utf8");
    expect(src).toContain("let activeWaitCampaign = pickCampaignAwaitingReply(campaignReplyContext);");
  });
});
