import { describe, it, expect } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { SQL_CANONICAL_PHONE, toCanonicalPhone, toCanonicalPhoneFromJid } from "../services/canonicalPhone.js";
import { createLeadMessaging } from "../domains/shared/leadMessaging.js";

describe("Correção e Integridade da Timeline e Canonicalização do WhatsApp", () => {
  it("Ordenação da timeline com desempate numérico de ID, messageTimestamp e createdAt", () => {
    const messages = [
      { id: "10001", body: "Que bom!", timestamp: 1731239100, messageTimestamp: "2026-11-10T11:45:00.300Z", createdAt: "2026-11-10T11:45:00.000Z" },
      { id: "9999", body: "Olá CONRADO!", timestamp: 1731239100, messageTimestamp: "2026-11-10T11:45:00.100Z", createdAt: "2026-11-10T11:45:00.000Z" },
      { id: "10000", body: "pode sim", timestamp: 1731239100, messageTimestamp: "2026-11-10T11:45:00.200Z", createdAt: "2026-11-10T11:45:00.000Z" },
    ];

    const sortFn = (list) => [...list].sort((a, b) => {
      const timeDiff = Number(a.timestamp || 0) - Number(b.timestamp || 0);
      if (timeDiff !== 0) return timeDiff;
      const aMsgTime = "messageTimestamp" in a && a.messageTimestamp ? new Date(a.messageTimestamp).getTime() : 0;
      const bMsgTime = "messageTimestamp" in b && b.messageTimestamp ? new Date(b.messageTimestamp).getTime() : 0;
      if (aMsgTime !== bMsgTime) return aMsgTime - bMsgTime;
      const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (aCreated !== bCreated) return aCreated - bCreated;
      const numA = Number(a.id);
      const numB = Number(b.id);
      if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB;
      return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
    });

    const sorted = sortFn(messages);
    expect(sorted[0].body).toBe("Olá CONRADO!");
    expect(sorted[1].body).toBe("pode sim");
    expect(sorted[2].body).toBe("Que bom!");

    // Mesmo se messageTimestamp for idêntico ou ausente, IDs numéricos 9999 e 10000 desempatam corretamente:
    const messagesNoMs = [
      { id: "10000", body: "pode sim", timestamp: 1731239100, createdAt: "2026-11-10T11:45:00.000Z" },
      { id: "9999", body: "Olá CONRADO!", timestamp: 1731239100, createdAt: "2026-11-10T11:45:00.000Z" },
    ];
    const sortedNoMs = sortFn(messagesNoMs);
    expect(sortedNoMs[0].id).toBe("9999");
    expect(sortedNoMs[1].id).toBe("10000");
  });

  it("SQL_CANONICAL_PHONE unifica JIDs com @s.whatsapp.net e @c.us e preserva @g.us e @lid", async () => {
    const db = await createPgliteDb(`
      CREATE TABLE lead_messages (
        id SERIAL PRIMARY KEY,
        client_id TEXT NOT NULL,
        phone TEXT NOT NULL,
        message_text TEXT NOT NULL,
        effective_timestamp TIMESTAMPTZ NOT NULL
      );
    `);

    await db.query(`
      INSERT INTO lead_messages (client_id, phone, message_text, effective_timestamp)
      VALUES 
        ('c1', '5534997817660', 'Msg Disparo', '2026-11-10 11:45:00Z'),
        ('c1', '553497817660@s.whatsapp.net', 'Msg Resposta', '2026-11-10 11:45:05Z'),
        ('c1', '553497817660@c.us', 'Msg Confirmacao', '2026-11-10 11:45:10Z'),
        ('c1', '120363049633060243@g.us', 'Msg Grupo', '2026-11-10 11:45:15Z'),
        ('c1', '100000000000000@lid', 'Msg Lid', '2026-11-10 11:45:20Z')
    `);

    const query = `
      SELECT 
        phone as raw_phone,
        ${SQL_CANONICAL_PHONE("phone")} as canonical_phone,
        message_text
      FROM lead_messages
      ORDER BY id ASC;
    `;

    const res = await db.query(query);
    expect(res.rows[0].canonical_phone).toBe("5534997817660");
    expect(res.rows[1].canonical_phone).toBe("5534997817660");
    expect(res.rows[2].canonical_phone).toBe("5534997817660");
    expect(res.rows[3].canonical_phone).toBe("120363049633060243@g.us");
    expect(res.rows[4].canonical_phone).toBe("100000000000000@lid");

    // Agrupamento DISTINCT ON (canonical_phone) converge mensagens 1, 2 e 3 para a mesma conversa
    const groupQuery = `
      WITH pre_canonical AS (
        SELECT
          id,
          ${SQL_CANONICAL_PHONE("phone")} as canonical_phone,
          message_text,
          effective_timestamp
        FROM lead_messages
        WHERE client_id = 'c1' AND phone NOT LIKE '%@g.us' AND phone NOT LIKE '%@lid'
      )
      SELECT DISTINCT ON (canonical_phone)
        canonical_phone as phone,
        message_text,
        effective_timestamp
      FROM pre_canonical
      ORDER BY canonical_phone, effective_timestamp DESC NULLS LAST, id DESC;
    `;

    const groupRes = await db.query(groupQuery);
    expect(groupRes.rows.length).toBe(1);
    expect(groupRes.rows[0].phone).toBe("5534997817660");
    // A última mensagem do chat é 'Msg Confirmacao' (11:45:10), e NÃO 'Msg Disparo' (11:45:00)
    expect(groupRes.rows[0].message_text).toBe("Msg Confirmacao");

    await db.close();
  });

  it("toCanonicalPhone e toCanonicalPhoneFromJid normalizam telefones e JIDs de forma paritária", () => {
    expect(toCanonicalPhone("553497817660@s.whatsapp.net")).toBe("5534997817660");
    expect(toCanonicalPhone("5534997817660@c.us")).toBe("5534997817660");
    expect(toCanonicalPhone("553497817660")).toBe("5534997817660");
    expect(toCanonicalPhone("5534997817660")).toBe("5534997817660");
    expect(toCanonicalPhone("(34) 99781-7660")).toBe("5534997817660");
    expect(toCanonicalPhone("120363049633060243@g.us")).toBe("120363049633060243@g.us");
    expect(toCanonicalPhone("100000000000000@lid")).toBe("100000000000000@lid");

    expect(toCanonicalPhoneFromJid("553497817660@s.whatsapp.net")).toBe("5534997817660");
    expect(toCanonicalPhoneFromJid("120363049633060243@g.us")).toBe("120363049633060243@g.us");
  });

  it("appendLeadMessage grava telefone canônico ao receber JID individual", async () => {
    let recordedPhone = null;
    let recordedVariants = null;
    const mockSupabase = {
      from: (table) => {
        if (table === "leads_client1") {
          return {
            select: () => ({
              eq: () => ({
                in: (col, variants) => {
                  recordedVariants = variants;
                  return {
                    order: () => ({
                      limit: () => ({
                        maybeSingle: async () => ({ data: null, error: null }),
                      }),
                    }),
                  };
                },
              }),
            }),
          };
        }
        if (table === "lead_messages") {
          return {
            insert: (payload) => {
              recordedPhone = payload.phone;
              return {
                select: () => ({
                  maybeSingle: async () => ({ data: { id: "1", ...payload }, error: null }),
                }),
              };
            },
          };
        }
        return { select: () => ({}) };
      },
    };

    const { appendLeadMessage } = createLeadMessaging({
      supabase: mockSupabase,
      normalizeString: (s) => String(s || "").trim(),
      leadsTableName: (c) => `leads_${c}`,
      isMissingSchemaError: () => false,
    });

    await appendLeadMessage({
      clientId: "client1",
      phone: "553497817660@s.whatsapp.net",
      messageText: "pode sim",
      direction: "inbound",
      senderType: "lead",
    });

    expect(recordedPhone).toBe("5534997817660");
    expect(recordedVariants).toContain("5534997817660");
  });
});
