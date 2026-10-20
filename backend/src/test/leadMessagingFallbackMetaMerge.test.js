// backend/src/test/leadMessagingFallbackMetaMerge.test.js
// Teste (u): Fallback de gravação em lead_messages com conflito em wa_message_id
// Garante que o merge de JSONB preserva os metadados do disparo (source: 'campaign_dispatch')
// e incorpora chaves novas do eco (ex: fromMe, messageType).
//
// MUTAÇÃO: inverter a ordem para public.lead_messages.meta || EXCLUDED.meta faz (u) falhar.

import { describe, it, expect, afterAll } from "vitest";
import { createLeadMessaging } from "../domains/shared/leadMessaging.js";
import { createPgliteDb } from "./helpers/pgliteDb.js";

const LEAD_MESSAGES_SCHEMA = `
  CREATE TABLE public.lead_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text,
    lead_id uuid,
    campaign_id uuid,
    phone text,
    sender_type text,
    direction text,
    engagement_signal text,
    message_text text,
    delivered_at timestamptz,
    message_timestamp timestamptz,
    meta jsonb DEFAULT '{}'::jsonb,
    instance_name text,
    wa_message_id text UNIQUE,
    media_path text,
    media_url text,
    content_type text,
    created_at timestamptz DEFAULT now()
  );
`;

const openDbs = [];
afterAll(async () => {
  for (const db of openDbs) {
    try {
      await db.close();
    } catch {
      /* ignore */
    }
  }
});

describe("leadMessaging fallback ON CONFLICT meta merge", () => {
  it("u) conflito no fallback com meta do eco -> source continua 'campaign_dispatch'", async () => {
    const db = await createPgliteDb(LEAD_MESSAGES_SCHEMA);
    openDbs.push(db);

    const waMsgId = "WA_MSG_ID_CAMPAIGN_123";
    const campaignId = "11111111-1111-4111-8111-111111111111";

    // 1. Mensagem original da campanha já gravada no banco
    await db.query(
      `INSERT INTO public.lead_messages (
        client_id, campaign_id, phone, sender_type, direction,
        message_text, meta, wa_message_id
      ) VALUES ($1, $2::uuid, $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        "geracao-digital",
        campaignId,
        "5511999998888",
        "bot",
        "outbound",
        "Mensagem promocional da campanha",
        JSON.stringify({
          source: "campaign_dispatch",
          dispatchId: "disp-xyz-001",
          stepId: "step-100",
          stepType: "text",
        }),
        waMsgId,
      ]
    );

    // 2. Simula o eco do webhook (fromMe: true) chegando quando o cliente Supabase/PostgREST
    // falha, forçando o caminho de fallback (pool.query)
    const mockSupabase = {
      from: (table) => {
        if (table === "leads") {
          const chain = {
            eq: () => chain,
            in: () => chain,
            order: () => chain,
            limit: () => chain,
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          };
          return {
            select: () => chain,
          };
        }
        return {
          insert: () =>
            Promise.resolve({
              error: {
                code: "PGRST_CONNECTION_ERROR",
                message: "PostgREST connection lost (simulando fallback para pool direto)",
              },
            }),
        };
      },
    };

    const { appendLeadMessage } = createLeadMessaging({
      supabase: mockSupabase,
      pgDatabasePool: db,
      normalizeString: (s) => String(s || "").trim(),
      leadsTableName: () => "leads",
      isMissingSchemaError: () => false,
    });

    // Chamada do eco (como em chatbot/routes.js:2771-2790)
    await appendLeadMessage({
      clientId: "geracao-digital",
      phone: "5511999998888",
      senderType: "device",
      direction: "outbound",
      messageText: "Mensagem promocional da campanha",
      meta: {
        source: "device-whatsapp-webhook",
        messageType: "conversation",
        fromMe: true,
        transcribed: false,
      },
      waMessageId: waMsgId,
    });

    // 3. Lê o registro no banco para validar o merge
    const res = await db.query(
      `SELECT wa_message_id, meta FROM public.lead_messages WHERE wa_message_id = $1`,
      [waMsgId]
    );

    expect(res.rows.length).toBe(1);
    const row = res.rows[0];
    const meta = typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;

    // A chave 'source' do disparo original DEVE vencer a colisão
    expect(meta.source).toBe("campaign_dispatch");

    // Metadados específicos do disparo continuam preservados
    expect(meta.dispatchId).toBe("disp-xyz-001");
    expect(meta.stepId).toBe("step-100");
    expect(meta.stepType).toBe("text");

    // Novas chaves trazidas pelo eco são incorporadas no merge
    expect(meta.fromMe).toBe(true);
    expect(meta.messageType).toBe("conversation");
    expect(meta.transcribed).toBe(false);
  });
});
