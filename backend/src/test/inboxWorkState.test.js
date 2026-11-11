// Estados de trabalho da coluna de Conversas (services/inboxWorkState.js).
//
// O SQL roda de verdade em Postgres em memória (PGlite). Nada é dublado: as funções
// testadas são as mesmas que a rota /api/whatsapp/chats chama.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  AWAITING_WINDOW_DAYS,
  WORK_STATES,
  fetchWorkStateCounts,
  fetchWorkStatePage,
  resolveRobotChips,
} from "../services/inboxWorkState.js";

const TENANT = "geracao-digital";
const NOW = new Date("2026-11-10T18:00:00Z");
const ago = ({ minutes = 0, hours = 0, days = 0 }) =>
  new Date(NOW.getTime() - (minutes + hours * 60 + days * 24 * 60) * 60_000).toISOString();

// Telefones das conversas do cenário.
const P = {
  esperaAntiga: "5534990000001", // lead falou há 2 dias
  esperaMedia: "5534990000002", // lead falou há 3 horas
  esperaNova: "5534990000003", // lead falou há 1 hora (telefone gravado em dois formatos)
  esfriou: "5534990000004", // lead falou há 10 dias
  comLead: "5534990000005", // nós falamos por último
  robo: "5534990000006", // lead falou por último no chip do robô
  roboPausado: "5534990000007", // idem, mas agente pausado nesta conversa
  atendida: "5534990000008", // lead falou por último, marcada como atendida depois
  soDisparo: "5534990000009", // só mensagem nossa de campanha, sem chip gravado
  doisChips: "5534990000010", // lead escreveu no chip A, respondemos pelo chip B
  arquivada: "5534990000011",
  automacao: "5534990000012",
  grupo: "120363000000000000@g.us",
};

let db;
const query = (sql, params) => db.query(sql, params);
const base = { clientId: TENANT, now: NOW, robotChips: ["chip-robo"] };

async function msg(phone, direction, when, { chip = "chip-a", text = "mensagem", sender, isGroup = false, tenant = TENANT, campaign = null } = {}) {
  await db.query(
    `INSERT INTO public.lead_messages (client_id, phone, direction, sender_type, message_text, message_timestamp, instance_name, is_group, campaign_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [tenant, phone, direction, sender || (direction === "inbound" ? "lead" : "device"), text, when, chip, isGroup, campaign]
  );
}

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
  `);

  await msg(P.esperaAntiga, "outbound", ago({ days: 3 }));
  await msg(P.esperaAntiga, "inbound", ago({ days: 2 }));

  await msg(P.esperaMedia, "outbound", ago({ hours: 5 }));
  await msg(P.esperaMedia, "inbound", ago({ hours: 3 }));

  // Mesmo contato gravado com e sem DDI/nono dígito: tem que ser UMA conversa.
  await msg("3490000003", "outbound", ago({ hours: 2 }), { chip: "chip-b" });
  await msg(P.esperaNova, "inbound", ago({ hours: 1 }), { chip: "chip-b" });

  await msg(P.esfriou, "outbound", ago({ days: 12 }));
  await msg(P.esfriou, "inbound", ago({ days: 10 }));

  await msg(P.comLead, "inbound", ago({ hours: 4 }));
  await msg(P.comLead, "outbound", ago({ hours: 2 }));

  await msg(P.robo, "inbound", ago({ minutes: 5 }), { chip: "chip-robo" });

  await msg(P.roboPausado, "inbound", ago({ minutes: 30 }), { chip: "chip-robo" });
  await db.query(
    `INSERT INTO public.whatsapp_chat_states (client_id, phone, state, agent_muted_at, agent_muted_source) VALUES ($1,$2,'ativa',$3,'manual')`,
    [TENANT, P.roboPausado, ago({ minutes: 10 })]
  );

  await msg(P.atendida, "inbound", ago({ hours: 6 }));
  await db.query(
    `INSERT INTO public.whatsapp_chat_states (client_id, phone, state, attended_at, attended_by) VALUES ($1,$2,'ativa',$3,'operador')`,
    [TENANT, P.atendida, ago({ hours: 5 })]
  );

  await msg(P.soDisparo, "outbound", ago({ days: 1 }), { chip: null, sender: "bot", campaign: "camp-1" });

  await msg(P.doisChips, "inbound", ago({ hours: 8 }), { chip: "chip-a" });
  await msg(P.doisChips, "outbound", ago({ hours: 7 }), { chip: "chip-b" });

  await msg(P.arquivada, "inbound", ago({ hours: 1 }));
  await db.query(`INSERT INTO public.whatsapp_chat_states (client_id, phone, state) VALUES ($1,$2,'arquivada')`, [TENANT, P.arquivada]);

  await msg(P.automacao, "inbound", ago({ hours: 1 }), { text: "Digite 1 para falar com o financeiro" });
  await msg(P.grupo, "inbound", ago({ hours: 1 }), { isGroup: true });

  // Outra empresa: nunca pode aparecer.
  await msg("5511988887777", "inbound", ago({ hours: 1 }), { tenant: "outra-empresa" });

  // Lead duplicado no mesmo telefone e duas fotos: não pode duplicar a conversa.
  // O segundo lead está na grafia sem o 55: é o mesmo número, e o mais novo é quem vale.
  await db.query(
    `INSERT INTO public.leads (id, client_id, telefone, nome, created_at) VALUES
       ('l1', $1, $2, 'Maria antiga', now() - interval '2 days'),
       ('l2', $1, $3, 'Maria nova', now())`,
    [TENANT, P.esperaMedia, P.esperaMedia.slice(2)]
  );
  await db.query(`INSERT INTO public.whatsapp_lid_map (lid, profile_pic) VALUES ($1,'a.jpg'), ($1,'b.jpg')`, [P.esperaMedia]);
});

afterAll(async () => {
  await db?.close();
});

const phonesOf = (rows) => rows.map((r) => r.phone_number);
const page = (state, extra = {}) => fetchWorkStatePage(query, { ...base, state, limit: 200, ...extra });

describe("estados de trabalho — quem falou por último", () => {
  it("'Esperam você' traz só conversas em que o lead falou por último, dentro da janela", async () => {
    const rows = await page("esperam");
    expect(phonesOf(rows).sort()).toEqual([P.esperaAntiga, P.esperaMedia, P.esperaNova, P.roboPausado].sort());
    expect(rows.every((r) => r.direction === "inbound")).toBe(true);
  });

  it("'Com o lead' traz as conversas em que nós falamos por último e as marcadas como atendidas", async () => {
    const rows = await page("com_lead");
    expect(phonesOf(rows).sort()).toEqual([P.comLead, P.atendida, P.soDisparo, P.doisChips].sort());
    const disparo = rows.find((r) => r.phone_number === P.soDisparo);
    expect(disparo.lead_never_spoke).toBe(true);
  });

  it(`'Esfriaram' traz quem espera há mais de ${AWAITING_WINDOW_DAYS} dias`, async () => {
    expect(phonesOf(await page("esfriaram"))).toEqual([P.esfriou]);
  });

  it("'Robô cuida' traz a conversa do chip do robô, e a pausa devolve a conversa para 'Esperam você'", async () => {
    expect(phonesOf(await page("robo"))).toEqual([P.robo]);
    expect(phonesOf(await page("esperam"))).toContain(P.roboPausado);
  });

  it("sem chip de robô, nenhuma conversa vai para 'Robô cuida'", async () => {
    expect(await page("robo", { robotChips: [] })).toEqual([]);
    expect(phonesOf(await page("esperam", { robotChips: [] }))).toContain(P.robo);
  });

  it("grupo, arquivada, automação e outra empresa ficam fora dos quatro estados", async () => {
    const todas = (await Promise.all(WORK_STATES.map((s) => page(s)))).flat();
    const fora = [P.grupo, P.arquivada, P.automacao, "5511988887777"];
    expect(phonesOf(todas).filter((p) => fora.includes(p))).toEqual([]);
  });
});

describe("estados de trabalho — ordem", () => {
  it("'Esperam você' ordena pelo tempo de espera: mais parado primeiro", async () => {
    const rows = await page("esperam", { robotChips: [] });
    expect(phonesOf(rows)).toEqual([P.esperaAntiga, P.esperaMedia, P.esperaNova, P.roboPausado, P.robo]);
  });

  it("'Com o lead' ordena pela mensagem mais recente primeiro", async () => {
    const rows = await page("com_lead");
    expect(phonesOf(rows)).toEqual([P.comLead, P.atendida, P.doisChips, P.soDisparo]);
  });
});

describe("estados de trabalho — contador coerente com a lista", () => {
  it("o contador de cada aba é igual à quantidade de itens que a aba lista", async () => {
    const counts = await fetchWorkStateCounts(query, base);
    for (const state of WORK_STATES) {
      const rows = await page(state);
      expect(rows.length, `aba ${state}`).toBe(counts[state]);
    }
    expect(counts).toEqual({ esperam: 4, com_lead: 4, robo: 1, esfriaram: 1 });
  });

  it("lead duplicado e foto duplicada não duplicam a conversa na lista", async () => {
    const rows = await page("esperam");
    const maria = rows.filter((r) => r.phone_number === P.esperaMedia);
    expect(maria).toHaveLength(1);
    expect(maria[0].lead_name).toBe("Maria nova");
  });

  it("a paginação soma exatamente o contador", async () => {
    const counts = await fetchWorkStateCounts(query, base);
    const p1 = await fetchWorkStatePage(query, { ...base, state: "esperam", limit: 3, offset: 0 });
    const p2 = await fetchWorkStatePage(query, { ...base, state: "esperam", limit: 3, offset: 3 });
    expect(p1.length + p2.length).toBe(counts.esperam);
    expect(new Set([...phonesOf(p1), ...phonesOf(p2)]).size).toBe(counts.esperam);
  });
});

describe("estados de trabalho — escopo de chip", () => {
  it("filtra de verdade: um chip mostra menos conversas que todos", async () => {
    const todos = await fetchWorkStateCounts(query, base);
    const chipB = await fetchWorkStateCounts(query, { ...base, chipAliases: ["chip-b"] });
    const soma = (c) => Object.values(c).reduce((a, b) => a + b, 0);
    expect(soma(todos)).toBe(10);
    expect(soma(chipB)).toBe(2);
    expect(phonesOf(await page("esperam", { chipAliases: ["chip-b"] }))).toEqual([P.esperaNova]);
  });

  it("conversa só com mensagens sem chip gravado não entra em chip nenhum", async () => {
    for (const chip of ["chip-a", "chip-b", "chip-robo"]) {
      const todas = (await Promise.all(WORK_STATES.map((s) => page(s, { chipAliases: [chip] })))).flat();
      expect(phonesOf(todas), `chip ${chip}`).not.toContain(P.soDisparo);
    }
    expect(phonesOf(await page("com_lead"))).toContain(P.soDisparo);
  });

  it("o estado é da conversa inteira: respondida por outro chip continua respondida", async () => {
    expect(phonesOf(await page("com_lead", { chipAliases: ["chip-a"] }))).toContain(P.doisChips);
    expect(phonesOf(await page("esperam", { chipAliases: ["chip-a"] }))).not.toContain(P.doisChips);
  });

  it("contador e lista continuam iguais dentro de um chip", async () => {
    for (const chip of ["chip-a", "chip-b", "chip-robo"]) {
      const counts = await fetchWorkStateCounts(query, { ...base, chipAliases: [chip] });
      for (const state of WORK_STATES) {
        expect((await page(state, { chipAliases: [chip] })).length, `${chip}/${state}`).toBe(counts[state]);
      }
    }
  });
});

describe("resolveRobotChips — mesma regra do portão do webhook", () => {
  const chip = (id, name, slug) => ({ id, name, dispatch_webhook_url: `https://evo.invalid/message/sendText/${slug}` });
  const instances = [
    chip("id-hostery", "Comercial - Hostery", "gd-comercial-hostery"),
    chip("id-caio", "Pessoal -  Caio", "gd-pessoal-caio"),
    chip("id-gabriel", "Comercial - Gabriel", "gd-comercial-gabriel"),
  ];

  it("configuração real da Geração Digital em 10/11/2026: o robô não responde em chip nenhum", () => {
    const { robotChips, byChip } = resolveRobotChips({
      settings: { chatbot_enabled: false, chatbot_instances: ["gd-priscila", "gd-comercial-gabriel"] },
      agents: [
        { name: "Atendimento GD", evolution_instances: ["gd-numero-oficial"], inbound_enabled: false, archived_at: "2026-10-31" },
        { name: "Agente de Atendimento", evolution_instances: ["gd-comercial-gabriel"], inbound_enabled: false, archived_at: null },
      ],
      instances,
    });
    expect(robotChips).toEqual([]);
    expect(byChip["gd-comercial-gabriel"]).toMatchObject({ kind: "nenhum", reason: "agente_do_chip_desligado", agentName: "Agente de Atendimento" });
    expect(byChip["gd-comercial-hostery"]).toMatchObject({ kind: "nenhum", reason: "robo_da_empresa_desligado" });
    expect(byChip["gd-pessoal-caio"]).toMatchObject({ kind: "nenhum", reason: "chip_pessoal" });
  });

  it("agente próprio desligado cala o chip mesmo com o robô da empresa ligado e o chip marcado", () => {
    const { robotChips, byChip } = resolveRobotChips({
      settings: { chatbot_enabled: true, chatbot_instances: ["gd-comercial-gabriel", "gd-comercial-hostery"] },
      agents: [{ name: "Agente de Atendimento", evolution_instances: ["gd-comercial-gabriel"], inbound_enabled: false }],
      instances,
    });
    expect(byChip["gd-comercial-gabriel"].kind).toBe("nenhum");
    expect(byChip["gd-comercial-hostery"]).toMatchObject({ kind: "empresa", reason: "robo_da_empresa" });
    expect(robotChips.sort()).toEqual(["Comercial - Hostery", "gd-comercial-hostery", "id-hostery"].sort());
  });

  it("agente próprio ligado responde com o nome dele; agente arquivado é ignorado", () => {
    const { byChip } = resolveRobotChips({
      settings: { chatbot_enabled: false, chatbot_instances: [] },
      agents: [
        { name: "Bia", evolution_instances: ["id-hostery"], inbound_enabled: true, agent_kind: "atendimento" },
        { name: "Velho", evolution_instances: ["gd-comercial-gabriel"], inbound_enabled: true, archived_at: "2026-01-01" },
      ],
      instances,
    });
    expect(byChip["gd-comercial-hostery"]).toMatchObject({ kind: "agente", agentName: "Bia" });
    expect(byChip["gd-comercial-gabriel"].kind).toBe("nenhum");
  });

  it("robô da empresa com lista vazia vale para todo chip que não é pessoal; agente de campanha não atende", () => {
    const { byChip } = resolveRobotChips({
      settings: { chatbot_enabled: true, chatbot_instances: [] },
      agents: [{ name: "Disparo", evolution_instances: ["gd-comercial-gabriel"], inbound_enabled: true, agent_kind: "campanha" }],
      instances,
    });
    expect(byChip["gd-comercial-hostery"].kind).toBe("empresa");
    expect(byChip["gd-pessoal-caio"].kind).toBe("nenhum");
    expect(byChip["gd-comercial-gabriel"]).toMatchObject({ kind: "nenhum", reason: "agente_so_de_campanha" });
  });
});
