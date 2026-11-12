// backend/src/test/dashboardOverview.test.js
//
// Dashboard, Fase 1 (spec de 11/11/2026, seção 13): as consultas da Visão geral contra Postgres REAL (pglite).
// O que está em teste é a SQL, então nada de dublê da consulta. O único dublê é a fonte de "esperando
// resposta", que é de outro módulo (tela Conversas) e ainda não existe no main.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateDashboardMetrics } from "../services/dashboardCalculations.js";
import {
  coverageLevel,
  measureBaseSlices,
  measureFirstHumanResponseCoverage,
  measureFunnelMeetings,
  measureMeetings,
  measureQueue,
  measureWaiting,
} from "../services/dashboardOverview.js";
import { createPgliteDb } from "./helpers/pgliteDb.js";

const T = "tenant-base";
const SEM_OPTOUT = "tenant-sem-optout";
const TF = "tenant-funil";
const TR = "tenant-resposta";
const SO_ANTIGA = "tenant-reuniao-antiga";
const SEM_REUNIAO = "tenant-sem-reuniao";
const OUTRO = "tenant-outro";
const C1 = "11111111-1111-4111-8111-111111111111";
const CO = (n) => `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${n}`;

const NOW = new Date("2026-11-10T12:00:00Z");
const CUR_START = new Date("2026-10-11T12:00:00Z");
const PREV_START = new Date("2026-09-11T12:00:00Z");
const PERIOD = { currentStart: CUR_START, currentEnd: NOW, previousStart: PREV_START, previousEnd: CUR_START, asOf: NOW, now: NOW };

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL,
    telefone text,
    phone text,
    stage text,
    opt_out boolean,
    metadata jsonb,
    dados jsonb,
    created_at timestamptz NOT NULL DEFAULT '2026-01-01T00:00:00Z'
  );
  CREATE TABLE lead_optouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text, phone text);
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

const lead = (client, tel, { stage = null, optOut = null, metadata = null, createdAt = "2026-01-01T00:00:00Z" } = {}) =>
  `INSERT INTO leads (client_id, telefone, stage, opt_out, metadata, created_at) VALUES ('${client}', ${tel === null ? "NULL" : `'${tel}'`}, ${
    stage ? `'${stage}'` : "NULL"
  }, ${optOut === null ? "NULL" : optOut}, ${metadata ? `'${metadata}'::jsonb` : "NULL"}, '${createdAt}');`;
const msg = (client, phone, direction, at, senderType = null) =>
  `INSERT INTO lead_messages (client_id, phone, direction, sender_type, message_timestamp) VALUES ('${client}', '${phone}', '${direction}', ${
    senderType ? `'${senderType}'` : "NULL"
  }, '${at}');`;
const run = (client, phone, sentAt) =>
  `INSERT INTO campaign_dispatch_runs (client_id, campaign_id, phone, status, sent_at) VALUES ('${client}', '${C1}', '${phone}', 'sent', '${sentAt}');`;
const company = (id, tenant) => `INSERT INTO followup_companies (id, tenant_id) VALUES ('${id}', '${tenant}');`;
const meeting = (companyId, phone, at, status = "scheduled") =>
  `INSERT INTO followup_schedules (company_id, phone, status, created_at) VALUES ('${companyId}', ${phone === null ? "NULL" : `'${phone}'`}, '${status}', '${at}');`;

const SEED = [
  // ── Base: um lead de cada tipo ──
  lead(T, "5534991110001"), // nunca abordado, abordável
  lead(T, "5534991110001", { stage: "novo" }), // mesmo telefone em outro lead: 2 leads, 1 pessoa
  lead(T, "5534991110003", { optOut: true }), // nunca abordado, opt-out pela flag
  lead(T, "5534991110004"), // nunca abordado, opt-out pela tabela (telefone formatado, sem o nono dígito)
  lead(T, "5534991110012", { metadata: '{"opt_out":"true"}' }), // nunca abordado, opt-out em metadata
  lead(T, "5500991110005"), // telefone fabricado
  lead(T, null), // sem telefone
  lead(T, "5534991110007"), // recebeu mensagem de saída (gravada como JID sem o nono dígito)
  lead(T, "5534991110008"), // recebeu envio de campanha
  lead(T, "5534991110009"), // recebeu envio e respondeu
  lead(T, "5534991110010"), // escreveu e nunca foi abordado: é "em conversa", NÃO "nunca abordado"
  lead(T, "5534991110011", { stage: "perdido" }), // encerrado sem abordagem
  lead(T, "5534991110013", { createdAt: "2026-11-11T00:00:00Z" }), // criado depois do fim do período: fora
  lead(OUTRO, "5534991110001"),
  `INSERT INTO lead_optouts (client_id, phone) VALUES ('${T}', '+55 (34) 9111-0004'), ('${OUTRO}', '5534991110001');`,
  msg(T, "553491110007@s.whatsapp.net", "outbound", "2026-10-20T10:00:00Z", "bot"),
  run(T, "5534991110008", "2026-10-20T10:00:00Z"),
  run(T, "5534991110009", "2026-10-20T10:00:00Z"),
  msg(T, "5534991110009", "inbound", "2026-10-21T10:00:00Z", "lead"),
  msg(T, "5534991110010", "inbound", "2026-10-21T10:00:00Z", "lead"),
  // Empresa sem nenhum opt-out gravado.
  lead(SEM_OPTOUT, "5534992220001"),

  // ── Reunião ──
  company(CO(1), T),
  meeting(CO(1), "5534991110009", "2026-10-20T10:00:00Z"),
  meeting(CO(1), "34991110009", "2026-10-25T10:00:00Z"), // a mesma pessoa, segunda reunião: conta 1
  meeting(CO(1), "5534991110008", "2026-10-22T10:00:00Z", "canceled"), // cancelada: não conta
  meeting(CO(1), null, "2026-10-23T10:00:00Z", "missing_phone"), // sem telefone: não conta
  meeting(CO(1), "5534991110007", "2026-09-20T10:00:00Z"), // período anterior
  company(CO(2), SO_ANTIGA),
  meeting(CO(2), "5534993330001", "2026-03-01T10:00:00Z"), // tem registro, nenhum no período
  company(CO(3), SEM_REUNIAO), // empresa de follow-up sem nenhuma reunião

  // ── Funil de coorte ──
  company(CO(4), TF),
  run(TF, "5534994440001", "2026-10-15T10:00:00Z"), // P1: recebeu (duas vezes), respondeu, marcou depois → entra
  run(TF, "5534994440001", "2026-10-17T10:00:00Z"),
  msg(TF, "5534994440001", "inbound", "2026-10-16T10:00:00Z", "lead"),
  meeting(CO(4), "5534994440001", "2026-10-20T10:00:00Z"),
  run(TF, "5534994440002", "2026-10-15T10:00:00Z"), // P2: respondeu, mas a reunião é ANTERIOR ao envio → não entra
  msg(TF, "5534994440002", "inbound", "2026-10-16T10:00:00Z", "lead"),
  meeting(CO(4), "5534994440002", "2026-10-10T10:00:00Z"),
  run(TF, "5534994440003", "2026-10-15T10:00:00Z"), // P3: recebeu, não respondeu, marcou → não entra no funil
  meeting(CO(4), "5534994440003", "2026-10-20T10:00:00Z"),
  meeting(CO(4), "5534994440004", "2026-10-21T10:00:00Z"), // P4: marcou sem ter recebido campanha → não entra no funil

  // ── Tempo de primeira resposta humana ──
  msg(TR, "5534995550001", "inbound", "2026-10-20T10:00:00Z", "lead"), // a: celular em 10 min
  msg(TR, "5534995550001", "outbound", "2026-10-20T10:10:00Z", "device"),
  msg(TR, "5534995550002", "inbound", "2026-10-20T10:00:00Z", "lead"), // b: ninguém respondeu
  msg(TR, "5534995550003", "inbound", "2026-10-20T10:00:00Z", "lead"), // c: só o robô
  msg(TR, "5534995550003", "outbound", "2026-10-20T10:01:00Z", "bot"),
  msg(TR, "5534995550004", "inbound", "2026-10-20T10:00:00Z", "lead"), // d: só 'user' → indeterminada
  msg(TR, "553495550004@s.whatsapp.net", "outbound", "2026-10-20T11:00:00Z", "user"),
  msg(TR, "5534995550005", "inbound", "2026-10-21T10:00:00Z", "lead"), // e: 'user' em 5 min, celular em 20
  msg(TR, "5534995550005", "outbound", "2026-10-21T10:05:00Z", "user"),
  msg(TR, "5534995550005", "outbound", "2026-10-21T10:20:00Z", "device"),
  msg(TR, "5534995550006", "inbound", "2026-10-22T10:00:00Z", "lead"), // f: tela do CRM em 30 min
  msg(TR, "5534995550006", "outbound", "2026-10-22T10:30:00Z", "agent"),
].join("\n");

let db;
beforeAll(async () => {
  db = await createPgliteDb(SCHEMA);
  await db.exec(SEED);
});
afterAll(async () => {
  await db?.close();
});

describe("Situação da base: cinco fatias, cada lead em uma só", () => {
  let base;
  beforeAll(async () => {
    base = await measureBaseSlices(db, { clientId: T, ...PERIOD });
  });

  it("cada lead cai em exatamente uma fatia, e as fatias somam a base", () => {
    expect(base.total).toBe(12);
    expect(base.slices).toEqual({ invalidPhone: 2, inConversation: 2, noReply: 2, neverApproached: 5, closedNoApproach: 1 });
    expect(base.slicesAddUp).toBe(true);
  });

  it("quem escreveu e nunca foi abordado é 'em conversa', nunca 'nunca abordado'", () => {
    // 0009 (recebeu e respondeu) e 0010 (só escreveu). Se 0010 fosse nunca abordado, a fatia teria 6.
    expect(base.slices.inConversation).toBe(2);
    expect(base.slices.neverApproached).toBe(5);
  });

  it("telefone fabricado 5500 e lead sem telefone são inválidos, não abordáveis", () => {
    expect(base.slices.invalidPhone).toBe(2);
  });

  it("saída gravada como JID sem o nono dígito casa com o lead pelo canônico", () => {
    // 0007 só tem a mensagem em '553491110007@s.whatsapp.net'. Sem o canônico ele viraria nunca abordado.
    expect(base.slices.noReply).toBe(2);
  });

  it("[MUTAÇÃO: tirar o desconto de opt-out derruba] o cartão conta telefones distintos abordáveis", () => {
    // Nunca abordados: 0001 (dois leads), 0003 (flag), 0004 (tabela), 0012 (metadata). Só 0001 dá para abordar.
    expect(base.neverApproached.totalLeads).toBe(5);
    expect(base.neverApproached.totalPhones).toBe(4);
    expect(base.neverApproached.reachable).toBe(1);
    expect(base.neverApproached.optOutDiscounted).toBe(3);
    expect(base.neverApproached.optOutRecorded).toBe(true);
  });

  it("opt-out de outra empresa não desconta ninguém aqui", () => {
    // lead_optouts tem 5534991110001 para OUTRO; o lead 0001 de T continua abordável.
    expect(base.neverApproached.reachable).toBe(1);
  });

  it("empresa sem nenhum opt-out gravado diz que não registra, em vez de dizer que descontou zero", async () => {
    const semOptOut = await measureBaseSlices(db, { clientId: SEM_OPTOUT, ...PERIOD });
    expect(semOptOut.neverApproached.optOutRecorded).toBe(false);
    expect(semOptOut.neverApproached.reachable).toBe(1);
  });

  it("empresa sem lead nenhum não divide por zero", async () => {
    const vazia = await measureBaseSlices(db, { clientId: "tenant-vazio", ...PERIOD });
    expect(vazia.total).toBe(0);
    expect(vazia.neverApproached.shareOfBasePct).toBeNull();
  });
});

describe("Reunião: o Dashboard só lê followup_schedules", () => {
  it("conta pessoas: a mesma pessoa com duas reuniões é 1; cancelada e sem telefone não contam", async () => {
    const r = await measureMeetings(db, { clientId: T, ...PERIOD });
    expect(r).toEqual({ hasRecords: true, current: 1, previous: 1 });
  });

  it("empresa com registro e nenhum no período devolve 0", async () => {
    const r = await measureMeetings(db, { clientId: SO_ANTIGA, ...PERIOD });
    expect(r).toEqual({ hasRecords: true, current: 0, previous: 0 });
  });

  it("empresa sem nenhuma linha devolve 'sem registro' (null), nunca 0", async () => {
    const r = await measureMeetings(db, { clientId: SEM_REUNIAO, ...PERIOD });
    expect(r).toEqual({ hasRecords: false, current: null, previous: null });
  });

  it("não lê crm_consultant_schedules: link de consultor não é reunião", async () => {
    // A tabela nem existe neste banco. Se a consulta a lesse, daria 42P01.
    await expect(measureMeetings(db, { clientId: T, ...PERIOD })).resolves.toBeTruthy();
  });
});

describe("Funil de coorte: 'marcaram reunião' é subconjunto de 'responderam'", () => {
  it("só entra quem respondeu a campanha e marcou DEPOIS do envio", async () => {
    const r = await measureFunnelMeetings(db, { clientId: TF, ...PERIOD });
    // P1 entra. P2 marcou antes do envio. P3 não respondeu. P4 nem recebeu campanha.
    expect(r).toEqual({ current: 1, previous: 0 });
  });

  it("as reuniões do período são outro número, maior: contam quem não veio de campanha", async () => {
    const r = await measureMeetings(db, { clientId: TF, ...PERIOD });
    expect(r.current).toBe(3); // P1, P3 e P4 (a de P2 é anterior ao período)
  });
});

describe("Tempo de primeira resposta humana, com cobertura", () => {
  let r;
  beforeAll(async () => {
    r = await measureFirstHumanResponseCoverage(db, { clientId: TR, ...PERIOD });
  });

  it("[MUTAÇÃO: tratar 'user' como humano derruba] conversa só com saída 'user' é indeterminada", () => {
    expect(r.conversations).toBe(6);
    expect(r.indeterminate).toBe(1);
    expect(r.measured).toBe(5);
    expect(r.coveragePct).toBe(83.3);
    expect(r.coverageLevel).toBe("ok");
  });

  it("humano é celular ou tela do CRM; robô não responde por gente", () => {
    expect(r.answered).toBe(3); // a (device), e (device), f (agent)
    expect(r.waiting).toBe(2); // b (nada), c (só robô)
    expect(r.waitingBotOnly).toBe(1);
    expect(r.waitingOverThreshold).toBe(2);
  });

  it("mediana e p90 saem só das respondidas, pelo tempo da resposta HUMANA", () => {
    // 10, 20 e 30 minutos. A conversa 'e' conta 20 (celular), não 5 ('user').
    expect(r.medianMinutes).toBe(20);
    expect(r.p90Minutes).toBe(28);
    expect(r.answeredWithUnknownBefore).toBe(1);
  });

  it("cortes de cobertura: 80% entra normal, 50% entra com destaque, abaixo disso espera", () => {
    expect(coverageLevel(88.7)).toBe("ok");
    expect(coverageLevel(80)).toBe("ok");
    expect(coverageLevel(79.9)).toBe("partial");
    expect(coverageLevel(50)).toBe("partial");
    expect(coverageLevel(49.9)).toBe("insufficient");
    expect(coverageLevel(null)).toBe("none");
  });

  it("empresa sem conversa no período não inventa cobertura nem tempo", async () => {
    const vazio = await measureFirstHumanResponseCoverage(db, { clientId: "tenant-vazio", ...PERIOD });
    expect(vazio).toMatchObject({ conversations: 0, measured: 0, coveragePct: null, coverageLevel: "none", medianMinutes: null, p90Minutes: null });
  });
});

describe("'Pessoas esperam resposta' depende da tela Conversas", () => {
  it("sem a fonte, devolve 'pending_source' e nenhum número", async () => {
    const r = await measureWaiting(db, { clientId: T, now: NOW }, { loadSource: async () => null });
    expect(r).toEqual({ status: "pending_source" });
  });

  it("a fonte está no main: a tela Conversas exporta a função do contrato", async () => {
    const mod = await import("../services/inboxWorkState.js");
    expect(typeof mod.countWaitingForDashboard).toBe("function");
    expect(mod.WAITING_THRESHOLD_HOURS).toBe(3);
  });

  it("liga sozinho quando a fonte existir, chamando a MESMA função da tela Conversas", async () => {
    const countWaitingForDashboard = vi.fn(async () => ({ waiting: 12, waitingOverThreshold: 7 }));
    const r = await measureWaiting(db, { clientId: T, now: NOW }, { loadSource: async () => countWaitingForDashboard });
    expect(countWaitingForDashboard).toHaveBeenCalledWith(db, { clientId: T, now: NOW });
    expect(r).toEqual({ status: "ready", waiting: 12, waitingOverThreshold: 7, thresholdHours: 3 });
  });

  it("retorno fora do contrato não vira número adivinhado", async () => {
    for (const bad of [null, {}, { waiting: "12" }, { waiting: -1 }, { waiting: 1.5 }]) {
      const r = await measureWaiting(db, { clientId: T, now: NOW }, { loadSource: async () => async () => bad });
      expect(r).toEqual({ status: "pending_source" });
    }
  });
});

describe("Aba Atendimento: faixas de espera", () => {
  const TB = "tenant-faixas";
  beforeAll(async () => {
    const at = (min) => new Date(Date.parse("2026-11-01T10:00:00Z") + min * 60000).toISOString();
    await db.exec(
      [
        // p1: 5 min · p2: exatamente 10 min (ainda "até 10") · p3: 20 min · p4: 1 hora · p5: 3 horas · p6: sem resposta
        ...[["5534993330001", 5], ["5534993330002", 10], ["5534993330003", 20], ["5534993330004", 60], ["5534993330005", 180]].flatMap(([phone, wait]) => [
          msg(TB, phone, "inbound", at(0), "lead"),
          msg(TB, phone, "outbound", at(wait), "device"),
        ]),
        msg(TB, "5534993330006", "inbound", at(0), "lead"),
      ].join("\n")
    );
  });

  it("[TESTE OBRIGATÓRIO] as quatro faixas somam quem foi respondido por gente; o limite da faixa entra na faixa de baixo", async () => {
    const r = await measureFirstHumanResponseCoverage(db, { clientId: TB, ...PERIOD });
    expect(r.answered).toBe(5);
    expect(r.waitBuckets).toEqual({ upTo10m: 2, upTo30m: 1, upTo2h: 1, over2h: 1 });
    expect(Object.values(r.waitBuckets).reduce((a, b) => a + b, 0)).toBe(r.answered);
    expect(r.waiting).toBe(1);
  });

  it("empresa sem conversa: faixas zeradas, sem inventar distribuição", async () => {
    const r = await measureFirstHumanResponseCoverage(db, { clientId: "tenant-vazio", ...PERIOD });
    expect(r.waitBuckets).toEqual({ upTo10m: 0, upTo30m: 0, upTo2h: 0, over2h: 0 });
  });
});

describe("Aba Atendimento: a fila é a da tela Conversas", () => {
  const TQ = "tenant-fila";
  const deps = { settings: null, loadInstances: async () => [] };
  let warnSpy;
  beforeAll(async () => {
    // O que a consulta da fila lê e esta base de teste do Dashboard não tinha.
    await db.exec(`
      ALTER TABLE lead_messages ADD COLUMN IF NOT EXISTS instance_name text;
      ALTER TABLE lead_messages ADD COLUMN IF NOT EXISTS message_text text;
      ALTER TABLE lead_messages ADD COLUMN IF NOT EXISTS contact_name text;
      ALTER TABLE lead_messages ADD COLUMN IF NOT EXISTS meta jsonb;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS nome text;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_origin text;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_campaign_id uuid;
      CREATE TABLE IF NOT EXISTS whatsapp_chat_states (
        client_id text NOT NULL, phone text NOT NULL, state text NOT NULL DEFAULT 'ativa', reason text, source text, changed_by text,
        attended_at timestamptz, attended_by text, agent_muted_at timestamptz, agent_muted_reason text, agent_muted_source text,
        agent_mute_last_human_at timestamptz, PRIMARY KEY (client_id, phone)
      );
      CREATE TABLE IF NOT EXISTS whatsapp_lid_map (lid text, profile_pic text, contact_name text);
    `);
    const ago = (hours) => new Date(NOW.getTime() - hours * 3600000).toISOString();
    const inbound = (phone, hours, chip, contact) =>
      `INSERT INTO lead_messages (client_id, phone, direction, sender_type, message_timestamp, instance_name, message_text, contact_name) VALUES ('${TQ}', '${phone}', 'inbound', 'lead', '${ago(hours)}', '${chip}', 'oi', ${contact ? `'${contact}'` : "NULL"});`;
    await db.exec(
      [
        `INSERT INTO leads (client_id, telefone, nome) VALUES ('${TQ}', '5534994440001', 'Jéssica Mendonça');`,
        inbound("5534994440001", 5, "Comercial", "Jé"), // espera há 5 h: passou do limite; o nome do lead vence o do contato
        inbound("5534994440002", 1, "Pessoal", "Marcos"), // espera há 1 h; sem lead, vale o nome do contato
        inbound("5534994440003", 2, "Comercial", null), // respondida depois: está "com o lead", não espera
        `INSERT INTO lead_messages (client_id, phone, direction, sender_type, message_timestamp, instance_name, message_text) VALUES ('${TQ}', '5534994440003', 'outbound', 'device', '${ago(1.5)}', 'Comercial', 'olá');`,
      ].join("\n")
    );
  });
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("[TESTE OBRIGATÓRIO] os números são os dos contadores da tela Conversas, não uma segunda conta", async () => {
    const queue = await import("../services/inboxWorkState.js");
    const ctx = await queue.loadWorkStateContext(db, TQ, deps);
    const direto = await queue.fetchInboxCounts((sql, params) => db.query(sql, params), {
      clientId: TQ, now: NOW, robotChips: ctx.robotInfo.robotChips, chipAliases: null, pauseExpiredSql: ctx.pauseExpiredSql,
    });
    const viaContrato = await queue.countWaitingForDashboard(db, { clientId: TQ, now: NOW }, deps);

    const r = await measureQueue(db, { clientId: TQ, now: NOW }, { deps });

    expect(r.states).toEqual({ waiting: direto.work.esperam, withLead: direto.work.com_lead, withRobot: direto.work.robo, cooled: direto.work.esfriaram });
    expect(r.states.waiting).toBe(viaContrato.waiting);
    expect(r.waitingOverThreshold).toBe(viaContrato.waitingOverThreshold);
    expect(r.states).toMatchObject({ waiting: 2, withLead: 1 });
    expect(r.waitingOverThreshold).toBe(1);
    expect(r.thresholdHours).toBe(3);
  });

  it("[TESTE OBRIGATÓRIO] quem espera há mais tempo vem primeiro, com nome, chip e desde quando", async () => {
    const r = await measureQueue(db, { clientId: TQ, now: NOW }, { deps });

    expect(r.oldest.map((o) => o.phone)).toEqual(["5534994440001", "5534994440002"]);
    expect(r.oldest[0]).toMatchObject({ name: "Jéssica Mendonça", chip: "Comercial" });
    expect(r.oldest[1]).toMatchObject({ name: "Marcos", chip: "Pessoal" });
    expect(Date.parse(r.oldest[0].waitingSince)).toBe(NOW.getTime() - 5 * 3600000);
    // Quem já foi respondido não aparece na lista.
    expect(r.oldest.some((o) => o.phone === "5534994440003")).toBe(false);
  });

  it("empresa sem ninguém esperando: zero e lista vazia, sem consultar a página", async () => {
    const r = await measureQueue(db, { clientId: "tenant-vazio", now: NOW }, { deps });
    expect(r.states).toEqual({ waiting: 0, withLead: 0, withRobot: 0, cooled: 0 });
    expect(r.oldest).toEqual([]);
  });

  it("[TESTE OBRIGATÓRIO] fila que falha vira bloco indisponível no payload, nunca zero", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const metrics = await calculateDashboardMetrics(db, TQ, "30d", {
      referenceDate: NOW,
      queueOptions: { loadModule: async () => { throw new Error("fila fora do ar"); } },
    });
    expect(metrics.overview.queue).toBeNull();
    expect(metrics.unavailableBlocks).toContain("overview.queue");
    expect(errorSpy).toHaveBeenCalled();
  });

  it("no payload, a fila da aba Atendimento e o bloco 1 dizem o mesmo número", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const metrics = await calculateDashboardMetrics(db, TQ, "30d", { referenceDate: NOW, queueOptions: { deps } });
    expect(metrics.overview.queue.states.waiting).toBe(metrics.overview.waiting.waiting);
    expect(metrics.overview.queue.oldest).toHaveLength(2);
  });
});

describe("Payload do Dashboard: bloco `overview`", () => {
  let errorSpy;
  let warnSpy;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("leva as consultas novas, e o bloco 1 sai com o número da tela Conversas", async () => {
    // O que a consulta da fila lê e esta base de teste do Dashboard não tinha.
    await db.exec(`
      ALTER TABLE lead_messages ADD COLUMN IF NOT EXISTS instance_name text;
      ALTER TABLE lead_messages ADD COLUMN IF NOT EXISTS message_text text;
      ALTER TABLE lead_messages ADD COLUMN IF NOT EXISTS contact_name text;
      ALTER TABLE lead_messages ADD COLUMN IF NOT EXISTS meta jsonb;
      CREATE TABLE IF NOT EXISTS whatsapp_chat_states (
        client_id text NOT NULL, phone text NOT NULL, state text NOT NULL DEFAULT 'ativa', reason text, source text, changed_by text,
        attended_at timestamptz, attended_by text, agent_muted_at timestamptz, agent_muted_reason text, agent_muted_source text,
        agent_mute_last_human_at timestamptz, PRIMARY KEY (client_id, phone)
      );
    `);
    const metrics = await calculateDashboardMetrics(db, T, "30d", { referenceDate: NOW });
    const { countWaitingForDashboard } = await import("../services/inboxWorkState.js");
    const direto = await countWaitingForDashboard(db, { clientId: T, now: NOW });
    expect(metrics.overview.waiting).toEqual({ status: "ready", ...direto, thresholdHours: 3 });
    expect(Number.isInteger(direto.waiting)).toBe(true);
    expect(metrics.overview.base.total).toBe(12);
    expect(metrics.overview.base.neverApproached.reachable).toBe(1);
    expect(metrics.overview.meetings.hasRecords).toBe(true);
    expect(metrics.overview.funnel.received).toEqual({ current: 2, previous: 0 });
    expect(metrics.overview.funnel.replied).toEqual({ current: 1, previous: 0 });
    // A pessoa 0009 recebeu em 20/10 10:00, respondeu, e as reuniões dela são de 20/10 10:00 (não é depois) e 25/10.
    expect(metrics.overview.funnel.meetings).toEqual({ hasRecords: true, current: 1, previous: 0 });
    expect(metrics.unavailableBlocks.filter((b) => b.startsWith("overview."))).toEqual([]);
  });

  it("empresa sem registro de reunião: a etapa do funil sai null, não 0", async () => {
    const metrics = await calculateDashboardMetrics(db, SEM_REUNIAO, "30d", { referenceDate: NOW }).catch((e) => e);
    // Sem nenhum envio e sem tabelas de chip este tenant ainda calcula os blocos de campanha (zeros medidos).
    expect(metrics.overview.meetings).toEqual({ hasRecords: false, current: null, previous: null });
    expect(metrics.overview.funnel.meetings).toEqual({ hasRecords: false, current: null, previous: null });
  });

  it("consulta que falha devolve bloco indisponível (null), nunca 0", async () => {
    const quebrado = await createPgliteDb(SCHEMA);
    try {
      await quebrado.exec(SEED);
      await quebrado.exec("DROP TABLE lead_optouts;");
      const metrics = await calculateDashboardMetrics(quebrado, T, "30d", { referenceDate: NOW });
      expect(metrics.overview.base).toBeNull();
      expect(metrics.unavailableBlocks).toContain("overview.base");
      // O resto da Visão geral segue de pé.
      expect(metrics.overview.meetings.hasRecords).toBe(true);
    } finally {
      await quebrado.close();
    }
  });
});
