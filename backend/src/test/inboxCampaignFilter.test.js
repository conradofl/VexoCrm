// Filtro "Campanha" da coluna de Conversas (services/inboxCampaignFilter.js + inboxWorkState.js).
//
// O SQL roda de verdade em Postgres em memória (PGlite). Nada é dublado: as funções testadas são
// as mesmas que a rota /api/whatsapp/chats e /api/whatsapp/chats/campaigns chamam.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { fetchInboxCounts, fetchWorkStatePage } from "../services/inboxWorkState.js";
import { campaignPhonesSql, listInboxCampaigns, parseCampaignFilter } from "../services/inboxCampaignFilter.js";

const TENANT = "tinge-brasil";
const OUTRA = "outra-empresa";
const NOW = new Date("2026-11-24T15:00:00Z");
const ago = ({ minutes = 0, hours = 0, days = 0 }) =>
  new Date(NOW.getTime() - (minutes + hours * 60 + days * 24 * 60) * 60_000).toISOString();

const CAMP_SITE = "0ddbdbfd-f87d-4bca-8b9c-0a59186531a1";
const CAMP_AVALIACAO = "bab84af4-3a4c-49dc-a2b1-4453a6805352";
const CAMP_DA_OUTRA = "11111111-2222-4333-8444-555555555555";

const P = {
  siteRespondeu: "5534991110001", // recibo gravado sem o 55: tem que cair na mesma conversa
  siteSemResposta: "5534991110002", // recebeu e não respondeu
  siteNumeroInvalido: "5534991110003", // recibo invalid_number: não recebeu, não é da campanha
  siteSoBastao: "5534991110004", // sem recibo, só a mensagem marcada com a campanha
  avaliacao: "5534991110005",
  semCampanha: "5534991110006",
};

let db;
const query = (sql, params) => db.query(sql, params);
const base = { clientId: TENANT, now: NOW, robotChips: [] };

async function msg(phone, direction, when, { chip = "chip-a", campaign = null, tenant = TENANT } = {}) {
  await db.query(
    `INSERT INTO public.lead_messages (client_id, phone, direction, sender_type, message_text, message_timestamp, instance_name, campaign_id)
     VALUES ($1,$2,$3,$4,'mensagem',$5,$6,$7)`,
    [tenant, phone, direction, direction === "inbound" ? "lead" : "bot", when, chip, campaign]
  );
}
async function recibo(phone, campaign, status = "sent", tenant = TENANT, when = ago({ hours: 6 })) {
  await db.query(
    `INSERT INTO public.campaign_dispatch_runs (client_id, campaign_id, phone, status, sent_at) VALUES ($1,$2,$3,$4,$5)`,
    [tenant, campaign, phone, status, when]
  );
}
const phonesOf = (rows) => rows.map((r) => r.phone_number).sort();

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE public.lead_messages (
      id BIGSERIAL PRIMARY KEY,
      client_id TEXT, lead_id TEXT, campaign_id TEXT, phone TEXT, sender_type TEXT, direction TEXT,
      message_text TEXT, delivered_at TIMESTAMPTZ, message_timestamp TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(), meta JSONB, instance_name TEXT, contact_name TEXT,
      is_group BOOLEAN DEFAULT false
    );
    CREATE TABLE public.leads (
      id TEXT, client_id TEXT, telefone TEXT, nome TEXT, lead_origin TEXT, source_campaign_id TEXT,
      assigned_to TEXT, created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE public.whatsapp_chat_states (
      client_id TEXT NOT NULL, phone TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'ativa', reason TEXT,
      source TEXT NOT NULL DEFAULT 'auto', changed_by TEXT, attended_at TIMESTAMPTZ, attended_by TEXT,
      agent_muted_at TIMESTAMPTZ, agent_muted_reason TEXT, agent_muted_source TEXT, agent_mute_last_human_at TIMESTAMPTZ,
      PRIMARY KEY (client_id, phone)
    );
    CREATE TABLE public.whatsapp_lid_map (lid TEXT, profile_pic TEXT, contact_name TEXT);
    CREATE TABLE public.campaigns (id TEXT PRIMARY KEY, client_id TEXT, name TEXT);
    CREATE TABLE public.campaign_dispatch_runs (
      id BIGSERIAL PRIMARY KEY, client_id TEXT, campaign_id TEXT, phone TEXT, status TEXT,
      sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await db.query(
    `INSERT INTO public.campaigns (id, client_id, name) VALUES
      ($1, $4, 'Tinge · Conheça o site'), ($2, $4, 'Tinge · Avaliação no Google'), ($3, $5, 'Campanha de outra empresa')`,
    [CAMP_SITE, CAMP_AVALIACAO, CAMP_DA_OUTRA, TENANT, OUTRA]
  );

  // Campanha do site
  await recibo("34991110001", CAMP_SITE, "sent", TENANT, ago({ hours: 6 }));
  await msg(P.siteRespondeu, "outbound", ago({ hours: 6 }), { campaign: CAMP_SITE });
  await msg(P.siteRespondeu, "inbound", ago({ hours: 2 }));

  await recibo(P.siteSemResposta, CAMP_SITE);
  await msg(P.siteSemResposta, "outbound", ago({ hours: 5 }));

  await recibo(P.siteNumeroInvalido, CAMP_SITE, "invalid_number");
  await msg(P.siteNumeroInvalido, "inbound", ago({ hours: 1 }));

  await msg(P.siteSoBastao, "outbound", ago({ hours: 4 }), { campaign: CAMP_SITE, chip: "chip-b" });
  await msg(P.siteSoBastao, "inbound", ago({ hours: 3 }), { chip: "chip-b" });

  // Campanha de avaliação, mais recente
  await recibo(P.avaliacao, CAMP_AVALIACAO, "sent", TENANT, ago({ hours: 1 }));
  await msg(P.avaliacao, "outbound", ago({ hours: 1 }), { campaign: CAMP_AVALIACAO });
  await msg(P.avaliacao, "inbound", ago({ minutes: 30 }));

  // Conversa comum, sem campanha
  await msg(P.semCampanha, "inbound", ago({ minutes: 20 }));

  // Outra empresa mandou a MESMA campanha (id) para um número que também conversa com a Tinge
  await recibo(P.semCampanha, CAMP_SITE, "sent", OUTRA);
  await recibo("5534990000099", CAMP_DA_OUTRA, "sent", OUTRA);
});

afterAll(async () => {
  await db?.close();
});

describe("parseCampaignFilter", () => {
  it("vazio é sem filtro; uuid vira minúsculo; texto qualquer é inválido", () => {
    expect(parseCampaignFilter(undefined)).toBeNull();
    expect(parseCampaignFilter("  ")).toBeNull();
    expect(parseCampaignFilter(CAMP_SITE.toUpperCase())).toBe(CAMP_SITE);
    expect(parseCampaignFilter("tinge")).toBeUndefined();
    expect(parseCampaignFilter("1; drop table leads")).toBeUndefined();
  });
});

describe("filtro de campanha na coluna de Conversas", () => {
  it("sem filtro, todas as conversas aparecem (controle)", async () => {
    const esperam = await fetchWorkStatePage(query, { ...base, state: "esperam" });
    expect(phonesOf(esperam)).toEqual(
      [P.siteRespondeu, P.siteNumeroInvalido, P.siteSoBastao, P.avaliacao, P.semCampanha].sort()
    );
  });

  it("com a campanha do site, só quem recebeu: recibo sem o 55 e mensagem marcada contam; número inválido e outras ficam fora", async () => {
    const esperam = await fetchWorkStatePage(query, { ...base, state: "esperam", campaignId: CAMP_SITE });
    expect(phonesOf(esperam)).toEqual([P.siteRespondeu, P.siteSoBastao].sort());
    const comLead = await fetchWorkStatePage(query, { ...base, state: "com_lead", campaignId: CAMP_SITE });
    expect(phonesOf(comLead)).toEqual([P.siteSemResposta]);
  });

  it("recibo da mesma campanha em OUTRA empresa não puxa conversa desta empresa", async () => {
    const esperam = await fetchWorkStatePage(query, { ...base, state: "esperam", campaignId: CAMP_SITE });
    expect(phonesOf(esperam)).not.toContain(P.semCampanha);
  });

  it("campanha de avaliação mostra só a conversa dela", async () => {
    const esperam = await fetchWorkStatePage(query, { ...base, state: "esperam", campaignId: CAMP_AVALIACAO });
    expect(phonesOf(esperam)).toEqual([P.avaliacao]);
  });

  it("contadores seguem o filtro e batem com a lista", async () => {
    const counts = await fetchInboxCounts(query, { ...base, campaignId: CAMP_SITE });
    expect(counts.work).toEqual({ esperam: 2, com_lead: 1, robo: 0, esfriaram: 0 });
    const todas = await fetchInboxCounts(query, base);
    expect(todas.work.esperam).toBe(5);
  });

  it("campanha e chip juntos: só o que cumpre os dois", async () => {
    const esperam = await fetchWorkStatePage(query, {
      ...base,
      state: "esperam",
      campaignId: CAMP_SITE,
      chipAliases: ["chip-b"],
    });
    expect(phonesOf(esperam)).toEqual([P.siteSoBastao]);
    const counts = await fetchInboxCounts(query, { ...base, campaignId: CAMP_SITE, chipAliases: ["chip-b"] });
    expect(counts.work.esperam).toBe(1);
  });

  it("a subconsulta da lista antiga (busca, grupos, arquivadas) devolve os mesmos telefones canônicos", async () => {
    const { rows } = await db.query(`SELECT phone FROM ${campaignPhonesSql(2)} AS t(phone) ORDER BY 1`, [TENANT, CAMP_SITE]);
    expect(rows.map((r) => r.phone)).toEqual([P.siteRespondeu, P.siteSemResposta, P.siteSoBastao]);
  });
});

describe("listInboxCampaigns (seletor da tela)", () => {
  it("lista as campanhas da empresa que mandaram algo, mais recente primeiro, com quantos números receberam", async () => {
    const items = await listInboxCampaigns(query, TENANT);
    expect(items.map((i) => [i.name, i.sent])).toEqual([
      ["Tinge · Avaliação no Google", 1],
      ["Tinge · Conheça o site", 3],
    ]);
    expect(items[0].id).toBe(CAMP_AVALIACAO);
  });

  it("campanha de outra empresa não aparece", async () => {
    const items = await listInboxCampaigns(query, TENANT);
    expect(items.map((i) => i.id)).not.toContain(CAMP_DA_OUTRA);
    const daOutra = await listInboxCampaigns(query, OUTRA);
    expect(daOutra.map((i) => i.id)).toEqual([CAMP_DA_OUTRA]);
  });
});
