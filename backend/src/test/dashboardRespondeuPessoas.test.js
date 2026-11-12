// backend/src/test/dashboardRespondeuPessoas.test.js
//
// Fase 0 do redesenho do Dashboard (31/10/2026): definição única de "respondeu" = PESSOAS.
// COUNT(DISTINCT telefone canônico) dos envios respondidos em até 14 dias, telefone cru OU canônico.
// Antes o Dashboard contava ENVIOS respondidos (quem recebeu 3 envios e respondeu contava 3) e o perfil
// que converte usava uma terceira regra (qualquer mensagem, a qualquer tempo). Postgres real (pglite):
// o que está em teste é a SQL, então nada de mock da consulta.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { calculateDashboardMetrics, calculateDelta } from "../services/dashboardCalculations.js";
import { buildMessageEffectivenessSql, MESSAGE_EFFECTIVENESS_MIN_SENT } from "../services/messageEffectiveness.js";
import { createPgliteDb } from "./helpers/pgliteDb.js";

const T = "tenant-pessoas";
const OUTRO = "tenant-outro";
const C1 = "11111111-1111-4111-8111-111111111111";
const REF = "2026-10-31T12:00:00Z";

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE campaigns (
    id uuid PRIMARY KEY,
    client_id text NOT NULL,
    name text NOT NULL,
    analytics_meta jsonb NOT NULL DEFAULT '{}'::jsonb
  );
  CREATE TABLE leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL,
    telefone text,
    phone text,
    lead_temperature text,
    temperature text DEFAULT 'warm',
    lead_origin text,
    stage text,
    cidade text,
    assigned_to text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE lead_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL,
    campaign_id uuid,
    phone text NOT NULL,
    direction text NOT NULL,
    engagement_signal text,
    sender_type text,
    is_group boolean,
    message_timestamp timestamptz,
    delivered_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE campaign_dispatch_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL,
    campaign_id uuid,
    lead_id uuid,
    phone text NOT NULL,
    status text NOT NULL DEFAULT 'sent',
    error_message text,
    evolution_instance_id text,
    sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE followup_companies (id uuid PRIMARY KEY, tenant_id text NOT NULL);
  CREATE TABLE followup_schedules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL,
    phone text,
    status text,
    created_at timestamptz NOT NULL DEFAULT now()
  );
`;

const run = (phone, sentAt, client = T) =>
  `INSERT INTO campaign_dispatch_runs (client_id, campaign_id, phone, status, sent_at) VALUES ('${client}', '${C1}', '${phone}', 'sent', '${sentAt}');`;
const inbound = (phone, at, client = T) =>
  `INSERT INTO lead_messages (client_id, phone, direction, message_timestamp) VALUES ('${client}', '${phone}', 'inbound', '${at}');`;

const SEED = [
  `INSERT INTO campaigns (id, client_id, name) VALUES ('${C1}', '${T}', 'Campanha A');`,
  // A: três envios, uma resposta (telefone cru diferente, casa pelo canônico). Antes contava 3; agora 1.
  run("5534991110001", "2026-10-10T10:00:00Z"),
  run("5534991110001", "2026-10-12T10:00:00Z"),
  run("5534991110001", "2026-10-14T10:00:00Z"),
  inbound("34991110001", "2026-10-15T09:00:00Z"),
  // B: 28 envios, nenhuma resposta (dá volume para o ranking de mensagens, mínimo de 30 envios).
  ...Array.from({ length: 28 }, (_, i) => run("5534991110002", `2026-10-${String(2 + (i % 28)).padStart(2, "0")}T08:00:00Z`)),
  // C: respondeu 16 dias depois — fora da janela de 14 dias, não conta.
  run("553491110003", "2026-10-05T10:00:00Z"),
  inbound("5534991110003", "2026-10-21T10:00:00Z"),
  // D: a "resposta" é de outro tenant — não conta.
  run("5534991110004", "2026-10-10T10:00:00Z"),
  inbound("5534991110004", "2026-10-11T10:00:00Z", OUTRO),
  // Período anterior (setembro): E recebeu e respondeu.
  run("5534991110005", "2026-09-20T10:00:00Z"),
  inbound("5534991110005", "2026-09-21T10:00:00Z"),
].join("\n");

describe("Dashboard — 'respondeu' conta PESSOAS (definição única, 31/10/2026)", () => {
  let db;
  let metrics;

  beforeAll(async () => {
    db = await createPgliteDb(SCHEMA);
    await db.exec(SEED);
    metrics = await calculateDashboardMetrics(db, T, "30d", { referenceDate: REF });
  });

  afterAll(async () => {
    await db?.close();
  });

  it("[TESTE OBRIGATÓRIO] quem recebeu 3 envios e respondeu conta UMA pessoa, não três", () => {
    expect(metrics.unavailableBlocks).not.toContain("summary.replied");
    // A respondeu; B nunca; C fora da janela; D só no outro tenant.
    expect(metrics.summary.replied.current).toBe(1);
  });

  it("taxa = pessoas que responderam ÷ pessoas alcançadas (4), não ÷ envios (33)", () => {
    expect(metrics.summary.sent.current).toBe(33);
    expect(metrics.summary.replied.reached).toBe(4);
    expect(metrics.summary.replied.rate).toBe(25);
  });

  it("período anterior usa a mesma regra", () => {
    expect(metrics.summary.replied.previous).toBe(1);
    expect(metrics.summary.replied.previousReached).toBe(1);
  });

  it("ranking de mensagens conta pessoas; envios seguem em sent_count", () => {
    const [c] = metrics.rankings.messages;
    expect(c.campaign_name).toBe("Campanha A");
    expect(c.sent_count).toBe(33);
    expect(c.reached_count).toBe(4);
    expect(c.replied_count).toBe(1);
    expect(c.reply_rate).toBe(25);
  });

  it("ranking de região conta pessoas", () => {
    const ddd34 = metrics.rankings.regions.filter((r) => r.ddd === "34");
    expect(ddd34.reduce((s, r) => s + r.replies, 0)).toBe(1);
    expect(ddd34.reduce((s, r) => s + r.reached, 0)).toBe(4);
  });
});

describe("Uma definição só: Dashboard e relatório de eficácia dizem o MESMO número de pessoas", () => {
  let db;
  let metrics;
  let relatorio;

  beforeAll(async () => {
    db = await createPgliteDb(SCHEMA);
    await db.exec(
      [
        `INSERT INTO campaigns (id, client_id, name) VALUES ('${C1}', '${T}', 'Campanha A');`,
        // UMA pessoa, TRÊS envios, e cada um dos três foi respondido (o terceiro com o telefone escrito
        // de outro jeito). Contando envios dá 3; contando pessoas dá 1.
        run("5534991110001", "2026-10-10T10:00:00Z"),
        inbound("5534991110001", "2026-10-10T11:00:00Z"),
        run("5534991110001", "2026-10-12T10:00:00Z"),
        inbound("5534991110001", "2026-10-12T11:00:00Z"),
        run("34991110001", "2026-10-14T10:00:00Z"),
        inbound("34991110001", "2026-10-14T11:00:00Z"),
        // Volume para o mínimo de envios: outra pessoa, 28 envios, nenhuma resposta.
        ...Array.from({ length: 28 }, (_, i) => run("5534991110002", `2026-10-${String(2 + i).padStart(2, "0")}T08:00:00Z`)),
      ].join("\n")
    );
    metrics = await calculateDashboardMetrics(db, T, "30d", { referenceDate: REF });
    const { rows } = await db.query(buildMessageEffectivenessSql(true, true), [T, MESSAGE_EFFECTIVENESS_MIN_SENT]);
    relatorio = rows;
  });

  afterAll(async () => {
    await db?.close();
  });

  it("[TESTE OBRIGATÓRIO] 1 pessoa com 3 envios respondidos: o Dashboard diz 1, não 3", () => {
    expect(metrics.unavailableBlocks).not.toContain("summary.replied");
    expect(metrics.summary.replied.current).toBe(1);
    expect(metrics.rankings.messages[0].replied_count).toBe(1);
  });

  it("[TESTE OBRIGATÓRIO] 1 pessoa com 3 envios respondidos: o relatório de eficácia diz 1, não 3", () => {
    expect(relatorio).toHaveLength(1);
    expect(relatorio[0].replied_count).toBe(1);
  });

  it("os dois lugares batem em envios, pessoas alcançadas e pessoas que responderam", () => {
    const dash = metrics.rankings.messages[0];
    const rel = relatorio[0];
    expect(rel.sent_count).toBe(31);
    expect(rel.reached_count).toBe(2);
    expect({ sent: rel.sent_count, reached: rel.reached_count, replied: rel.replied_count }).toEqual({
      sent: dash.sent_count,
      reached: dash.reached_count,
      replied: dash.replied_count,
    });
  });

  it("os recortes de quem respondeu somam com o total de pessoas (não de envios)", () => {
    const rel = relatorio[0];
    // Sem lead cadastrado para o telefone: a única pessoa cai em lead_nao_encontrado, uma vez só.
    expect(rel.quente + rel.morno + rel.frio + rel.sem_classificacao + rel.lead_nao_encontrado).toBe(rel.replied_count);
    expect(rel.respostas_de_grupo).toBe(0);
  });
});

describe("calculateDelta — período anterior zerado não tem base de comparação", () => {
  it("[TESTE OBRIGATÓRIO] 0 → qualquer coisa é null, nunca +100%", () => {
    expect(calculateDelta(5, 0)).toBeNull();
    expect(calculateDelta(0, 0)).toBeNull();
  });

  it("anterior desconhecido é null", () => {
    expect(calculateDelta(5, null)).toBeNull();
    expect(calculateDelta(null, 5)).toBeNull();
  });

  it("com base, segue o percentual inteiro", () => {
    expect(calculateDelta(150, 100)).toBe(50);
    expect(calculateDelta(50, 100)).toBe(-50);
    expect(calculateDelta(0, 10)).toBe(-100);
    expect(calculateDelta(10, 10)).toBe(0);
  });
});
