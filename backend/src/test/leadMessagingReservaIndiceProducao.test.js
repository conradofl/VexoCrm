// Gravação de reserva em lead_messages com o índice ÚNICO DE PRODUÇÃO (20/11/2026).
//
// Fato (pg_indexes de produção, lido às 01:17Z pelo chat cérebro): o único índice único com wa_message_id é
//   idx_lead_messages_wa_message_id (client_id, wa_message_id) WHERE wa_message_id IS NOT NULL.
// Não existe índice único só em wa_message_id. A gravação de reserva (leadMessaging.js), que roda quando a primeira
// gravação falha, usava "ON CONFLICT (wa_message_id)": o Postgres recusa com 42P10 em TODA execução, o catch engolia
// o erro sem log e a mensagem NÃO era gravada. O teste antigo (leadMessagingFallbackMetaMerge) criava a tabela com
// "wa_message_id text UNIQUE", um índice que produção não tem, e por isso passava.
//
// SQL de verdade (PGlite) com o índice igual ao de produção. Dublê só no cliente da primeira gravação (que falha).
import { afterAll, describe, expect, it, vi } from "vitest";
import { createLeadMessaging } from "../domains/shared/leadMessaging.js";
import { createPgliteDb } from "./helpers/pgliteDb.js";

const SCHEMA = `
  CREATE TABLE public.lead_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text, lead_id uuid, campaign_id uuid, phone text, sender_type text, direction text,
    engagement_signal text, message_text text, delivered_at timestamptz, message_timestamp timestamptz,
    meta jsonb DEFAULT '{}'::jsonb, instance_name text, wa_message_id text,
    media_path text, media_url text, content_type text, created_at timestamptz DEFAULT now()
  );
  CREATE UNIQUE INDEX idx_lead_messages_wa_message_id
    ON public.lead_messages (client_id, wa_message_id) WHERE wa_message_id IS NOT NULL;
`;

const abertos = [];
afterAll(async () => {
  for (const db of abertos) await db.close().catch(() => {});
});

// A primeira gravação falha (queda de conexão com o banco, por exemplo): força o caminho de reserva.
const primeiraFalha = {
  from: (table) => {
    if (table === "leads") {
      const chain = { eq: () => chain, in: () => chain, order: () => chain, limit: () => chain, maybeSingle: () => Promise.resolve({ data: null, error: null }) };
      return { select: () => chain };
    }
    return { insert: () => Promise.resolve({ error: { code: "08006", message: "connection terminated unexpectedly" } }) };
  },
};

async function preparar() {
  const db = await createPgliteDb(SCHEMA);
  abertos.push(db);
  const { appendLeadMessage } = createLeadMessaging({
    supabase: primeiraFalha,
    pgDatabasePool: db,
    normalizeString: (s) => String(s || "").trim(),
    leadsTableName: () => "leads",
    isMissingSchemaError: () => false,
  });
  return { db, appendLeadMessage };
}
const linhas = async (db) =>
  (await db.query("SELECT client_id, wa_message_id, direction, meta, media_url FROM public.lead_messages ORDER BY client_id")).rows;

describe("Gravação de reserva com o índice de produção (client_id, wa_message_id) parcial", () => {
  it("primeira gravação falhou: a reserva GRAVA a mensagem (antes: 42P10 engolido, mensagem perdida)", async () => {
    const { db, appendLeadMessage } = await preparar();
    await appendLeadMessage({
      clientId: "container-led", phone: "5534999997660", senderType: "lead", direction: "inbound",
      messageText: "Teste 4", meta: { source: "hardcoded-chat-webhook" }, waMessageId: "WA-RESERVA-1",
    });
    const r = await linhas(db);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ client_id: "container-led", wa_message_id: "WA-RESERVA-1", direction: "inbound" });
  });

  it("mesmo id na mesma empresa: atualiza (junta o meta), não duplica", async () => {
    const { db, appendLeadMessage } = await preparar();
    await db.query(
      `INSERT INTO public.lead_messages (client_id, phone, direction, message_text, meta, wa_message_id)
       VALUES ('container-led', '5534999997660', 'outbound', 'oi', '{"source":"campaign_dispatch"}'::jsonb, 'WA-RESERVA-2')`
    );
    await appendLeadMessage({
      clientId: "container-led", phone: "5534999997660", senderType: "device", direction: "outbound",
      messageText: "oi", meta: { source: "device-whatsapp-webhook", fromMe: true }, waMessageId: "WA-RESERVA-2",
    });
    const r = await linhas(db);
    expect(r).toHaveLength(1);
    expect(r[0].meta).toMatchObject({ source: "campaign_dispatch", fromMe: true });
  });

  it("mesmo id em OUTRA empresa (chip para chip): grava a linha da segunda empresa", async () => {
    const { db, appendLeadMessage } = await preparar();
    await db.query(
      `INSERT INTO public.lead_messages (client_id, phone, direction, message_text, wa_message_id)
       VALUES ('vexo-adm', '5534999999499', 'outbound', 'Teste 3', 'WA-RESERVA-3')`
    );
    await appendLeadMessage({
      clientId: "container-led", phone: "5534999991267", senderType: "lead", direction: "inbound",
      messageText: "Teste 3", meta: {}, waMessageId: "WA-RESERVA-3",
    });
    expect((await linhas(db)).map((x) => x.client_id)).toEqual(["container-led", "vexo-adm"]);
  });

  it("a mídia gravada depois só mexe na linha da própria empresa", async () => {
    const { db, appendLeadMessage } = await preparar();
    await db.query(
      `INSERT INTO public.lead_messages (client_id, phone, direction, message_text, wa_message_id)
       VALUES ('vexo-adm', '5534999999499', 'outbound', '[imagem]', 'WA-RESERVA-4')`
    );
    await appendLeadMessage({
      clientId: "container-led", phone: "5534999991267", senderType: "lead", direction: "inbound",
      messageText: "[imagem]", meta: {}, waMessageId: "WA-RESERVA-4", mediaUrl: "https://midia.invalid/foto.jpg",
    });
    const r = await linhas(db);
    expect(r.find((x) => x.client_id === "container-led").media_url).toBe("https://midia.invalid/foto.jpg");
    expect(r.find((x) => x.client_id === "vexo-adm").media_url).toBeNull();
  });

  it("se a reserva também falhar, o erro dela vai para o log (antes: engolido em silêncio)", async () => {
    const { db, appendLeadMessage } = await preparar();
    await db.exec("ALTER TABLE public.lead_messages RENAME COLUMN message_text TO texto_renomeado");
    const aviso = vi.spyOn(console, "error").mockImplementation(() => {});
    await appendLeadMessage({
      clientId: "container-led", phone: "5534999997660", senderType: "lead", direction: "inbound",
      messageText: "oi", meta: {}, waMessageId: "WA-RESERVA-5",
    });
    const textos = aviso.mock.calls.map((c) => c.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    aviso.mockRestore();
    expect(textos.some((t) => t.includes("[lead-messages] reserva também falhou"))).toBe(true);
  });
});
