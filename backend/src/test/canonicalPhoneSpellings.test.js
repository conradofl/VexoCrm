// Amarra as DUAS regras de telefone que a lista de Conversas usa:
//   SQL_CANONICAL_PHONE            (qualquer grafia -> número canônico)
//   SQL_CANONICAL_PHONE_SPELLINGS  (número canônico -> grafias cruas que se procura no índice)
//
// A lista acha o lead por `telefone = ANY(grafias)`. Isso só é correto se TODA grafia só de
// dígitos que a expressão canônica leva a um número estiver na lista de grafias desse número
// (senão o lead existe e a tela não acha), e se a lista não tiver grafia a mais (senão a tela
// acha o lead de outro número). O SQL roda em Postgres de verdade (PGlite).
//
// Mudou SQL_CANONICAL_PHONE e este teste quebrou: a lista de grafias tem que mudar junto.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { SQL_CANONICAL_PHONE, SQL_CANONICAL_PHONE_SPELLINGS, toCanonicalPhone } from "../services/canonicalPhone.js";
import { fetchWorkStatePage } from "../services/inboxWorkState.js";

let db;

// Números de base, sem DDI: (DDD, número local). Cobre celular com o 9 seguido de 6-9,
// celular com o 9 seguido de 0-5 (a expressão NÃO devolve o 9 nesses), celular antigo de 8
// dígitos e fixo.
const DDDS = ["11", "34", "99"];
const LOCAIS = [
  "999990001", // celular 9 + 9
  "960000002", // celular 9 + 6
  "970000003",
  "980000004",
  "950000005", // celular 9 + 5: "sem o 9" vira outro número (fixo)
  "920000006",
  "900000007",
  "91234567", // 8 dígitos começando em 9 (celular antigo)
  "61234567",
  "71234567",
  "81234567",
  "21234567", // fixo
  "32345678",
  "42345678",
  "52345678",
];

// Todas as grafias só de dígitos em que um número brasileiro costuma ser gravado.
function grafiasDe(ddd, local) {
  const out = new Set();
  for (const ddi of ["", "55"]) {
    out.add(`${ddi}${ddd}${local}`);
    if (local.length === 9 && local[0] === "9") out.add(`${ddi}${ddd}${local.slice(1)}`); // sem o 9
    if (local.length === 8) out.add(`${ddi}${ddd}9${local}`); // com o 9 na frente
  }
  return [...out];
}

const CORPUS = [...new Set(DDDS.flatMap((ddd) => LOCAIS.flatMap((local) => grafiasDe(ddd, local))))];

// Estrangeiros e formatos que a expressão devolve como vieram.
const OUTROS = ["14155552671", "447911123456", "351912345678", "5491112345678", "123456", "5534"];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE TABLE t (raw TEXT PRIMARY KEY)`);
  for (const raw of [...CORPUS, ...OUTROS]) await db.query(`INSERT INTO t (raw) VALUES ($1) ON CONFLICT DO NOTHING`, [raw]);
});

afterAll(async () => {
  await db?.close();
});

const canonRows = async () =>
  (
    await db.query(
      `SELECT raw, canon, ${SQL_CANONICAL_PHONE_SPELLINGS("canon")} AS grafias
         FROM (SELECT raw, (${SQL_CANONICAL_PHONE("raw")}) AS canon FROM t OFFSET 0) x
        ORDER BY raw`
    )
  ).rows;

describe("grafias cruas × expressão canônica", () => {
  it("o corpus tem volume e variedade (não é teste de três linhas)", () => {
    expect(CORPUS.length).toBeGreaterThan(150);
  });

  it("toda grafia só de dígitos que a expressão canônica leva a um número está na lista de grafias desse número", async () => {
    const rows = await canonRows();
    const faltando = rows.filter((r) => !r.grafias.includes(r.raw)).map((r) => `${r.raw} -> ${r.canon} (grafias: ${r.grafias.join(",")})`);
    expect(faltando).toEqual([]);
  });

  it("a lista não tem grafia a mais: cada grafia listada volta para o mesmo número", async () => {
    const rows = await canonRows();
    const canons = [...new Set(rows.map((r) => r.canon))];
    const { rows: volta } = await db.query(
      `SELECT c AS canon, g AS grafia, (${SQL_CANONICAL_PHONE("g")}) AS canon_da_grafia
         FROM unnest($1::text[]) AS c, LATERAL unnest(${SQL_CANONICAL_PHONE_SPELLINGS("c")}) AS g`,
      [canons]
    );
    expect(volta.length).toBeGreaterThan(canons.length);
    const erradas = volta.filter((r) => r.canon_da_grafia !== r.canon).map((r) => `${r.grafia} listada para ${r.canon}, mas é ${r.canon_da_grafia}`);
    expect(erradas).toEqual([]);
  });

  it("celular com o 9 seguido de 6-9 tem as quatro grafias; seguido de 0-5 só duas; fixo duas; o resto só a própria", async () => {
    const grafias = async (canon) =>
      (await db.query(`SELECT ${SQL_CANONICAL_PHONE_SPELLINGS("$1::text")} AS g`, [canon])).rows[0].g.sort();
    expect(await grafias("5534999990001")).toEqual(["3499990001", "34999990001", "553499990001", "5534999990001"].sort());
    expect(await grafias("5534950000005")).toEqual(["34950000005", "5534950000005"].sort());
    expect(await grafias("553432345678")).toEqual(["3432345678", "553432345678"].sort());
    expect(await grafias("14155552671")).toEqual(["14155552671"]);
    expect(await grafias("120363000000000000@g.us")).toEqual(["120363000000000000@g.us"]);
  });

  it("a versão JavaScript da regra canônica concorda com a SQL em todo o corpus", async () => {
    const rows = await canonRows();
    const divergentes = rows.filter((r) => toCanonicalPhone(r.raw) !== r.canon).map((r) => `${r.raw}: sql=${r.canon} js=${toCanonicalPhone(r.raw)}`);
    expect(divergentes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// O limite, escrito. Estes formatos SÓ entram no banco pelas portas que não aplicam a regra
// canônica (ver a issue "Portas que gravam leads.telefone sem a regra canônica":
// /api/lead-webhook grava só os dígitos do que receber). A busca por grafias não acha o lead;
// a conversa continua na lista e aparece com o nome do contato, sem o nome do lead.
// Se um destes casos passar a ser achado, ótimo: mova para o grupo de cima.
// ---------------------------------------------------------------------------
describe("limite documentado: o que a busca por grafias NÃO acha", () => {
  const NUMERO = "5534999990001";
  const NAO_ACHA = [
    ["máscara", "(34) 99999-0001"],
    ["máscara com +55", "+55 34 99999-0001"],
    ["zero na frente do DDD", "034999990001"],
    ["dois zeros e DDI", "005534999990001"],
    ["sem DDD, 9 dígitos", "999990001"],
    ["sem DDD, 8 dígitos", "99990001"],
    ["JID do WhatsApp", "5534999990001@s.whatsapp.net"],
  ];

  it.each(NAO_ACHA)("%s (%s) não está nas grafias do número", async (_nome, gravado) => {
    const { rows } = await db.query(`SELECT ${SQL_CANONICAL_PHONE_SPELLINGS("$1::text")} AS g`, [NUMERO]);
    expect(rows[0].g).not.toContain(gravado);
  });

  it("na lista: lead gravado com máscara não é achado e a conversa aparece sem o nome do lead; gravado sem o 55 é achado", async () => {
    await db.exec(`
      CREATE TABLE public.lead_messages (
        id BIGSERIAL PRIMARY KEY, client_id TEXT, campaign_id TEXT, phone TEXT, sender_type TEXT, direction TEXT,
        message_text TEXT, delivered_at TIMESTAMPTZ, message_timestamp TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(),
        meta JSONB, instance_name TEXT, contact_name TEXT, is_group BOOLEAN DEFAULT false
      );
      CREATE TABLE public.leads (id TEXT, client_id TEXT, telefone TEXT, nome TEXT, lead_origin TEXT, source_campaign_id TEXT, created_at TIMESTAMPTZ DEFAULT now());
      CREATE UNIQUE INDEX leads_client_telefone_uidx ON public.leads (client_id, telefone);
      CREATE TABLE public.whatsapp_chat_states (
        client_id TEXT, phone TEXT, state TEXT, reason TEXT, source TEXT, changed_by TEXT, attended_at TIMESTAMPTZ, attended_by TEXT,
        agent_muted_at TIMESTAMPTZ, agent_muted_reason TEXT, agent_muted_source TEXT, agent_mute_last_human_at TIMESTAMPTZ
      );
      CREATE TABLE public.whatsapp_lid_map (lid TEXT, profile_pic TEXT, contact_name TEXT);
      INSERT INTO public.lead_messages (client_id, phone, sender_type, direction, message_text, message_timestamp, contact_name) VALUES
        ('t', '5534999990001', 'lead', 'inbound', 'oi', now() - interval '2 hours', 'Contato Um'),
        ('t', '5534960000002', 'lead', 'inbound', 'oi', now() - interval '1 hour', 'Contato Dois');
      INSERT INTO public.leads (id, client_id, telefone, nome) VALUES
        ('a', 't', '(34) 99999-0001', 'Lead com máscara'),
        ('b', 't', '34960000002', 'Lead sem 55');
    `);
    const rows = await fetchWorkStatePage((sql, params) => db.query(sql, params), {
      clientId: "t",
      state: "esperam",
      now: new Date(),
      robotChips: [],
      chipAliases: null,
      pauseExpiredSql: "false",
    });
    const porFone = Object.fromEntries(rows.map((r) => [r.phone_number, r]));
    expect(Object.keys(porFone).sort()).toEqual(["5534960000002", "5534999990001"]);
    expect(porFone["5534999990001"].lead_name).toBeNull();
    expect(porFone["5534999990001"].contact_name).toBe("Contato Um");
    expect(porFone["5534960000002"].lead_name).toBe("Lead sem 55");
  });
});
