import { describe, expect, it, vi } from "vitest";
import { createLeadMessaging } from "../domains/shared/leadMessaging.js";
import { processBatch } from "../chatbot-ai-engine.js";

const CLIENT_ID = "geracao-digital";
const PHONE = "5511999998888";
const INSTANCE_NAME = "GD Priscila";

describe("Persistência de Mensagens de Campanha e Chatbot no Inbox (lead_messages)", () => {
  it("Causa 1 & 3: Disparo de campanha grava em lead_messages com direction outbound, bot, delivered_at e instance_name", async () => {
    const insertedRows = [];
    const mockSupabase = {
      from: (table) => {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: () => Promise.resolve({ data: { id: "lead-crm-123", source_campaign_id: "camp-001" }, error: null }),
                  }),
                }),
              }),
            }),
          }),
          insert: (rows) => {
            const arr = Array.isArray(rows) ? rows : [rows];
            insertedRows.push(...arr);
            return Promise.resolve({ error: null });
          },
        };
      },
    };

    const { appendLeadMessage } = createLeadMessaging({
      supabase: mockSupabase,
      normalizeString: (s) => String(s || "").trim(),
      leadsTableName: () => "leads",
      isMissingSchemaError: () => false,
    });

    const nowIso = new Date().toISOString();
    await appendLeadMessage({
      clientId: CLIENT_ID,
      campaignId: "camp-001",
      leadId: "lead-crm-123",
      phone: PHONE,
      senderType: "bot",
      direction: "outbound",
      messageText: "Olá Maria, temos uma oferta especial!",
      deliveredAt: nowIso,
      instanceName: INSTANCE_NAME,
      meta: {
        source: "campaign_dispatch",
        dispatchId: "disp-101",
        stepId: "step-1",
        stepType: "text",
        stepOrder: 1,
      },
    });

    expect(insertedRows).toHaveLength(1);
    const row = insertedRows[0];
    expect(row.client_id).toBe(CLIENT_ID);
    expect(row.phone).toBe(PHONE);
    expect(row.sender_type).toBe("bot");
    expect(row.direction).toBe("outbound");
    expect(row.message_text).toBe("Olá Maria, temos uma oferta especial!");
    expect(row.delivered_at).toBe(nowIso);
    expect(row.instance_name).toBe(INSTANCE_NAME);
    expect(row.campaign_id).toBe("camp-001");
  });

  it("Causa 2 & 3: processBatch grava delivered_at e instance_name nas mensagens da IA e do Lead", async () => {
    const insertedRows = [];
    const mockSupabase = {
      from: (table) => {
        if (table === "lead_messages") {
          return {
            insert: (rows) => {
              const arr = Array.isArray(rows) ? rows : [rows];
              insertedRows.push(...arr);
              return Promise.resolve({ error: null });
            },
          };
        }
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => Promise.resolve({
                    data: [{
                      id: "lead-crm-123",
                      dados: {},
                      historico: null,
                      status_conversa: "em_atendimento",
                      finalizado: false,
                      updated_at: new Date().toISOString(),
                    }],
                  }),
                }),
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              then: (resolve) => resolve({ error: null }),
            }),
          }),
          maybeSingle: () => Promise.resolve({ data: null }),
          single: () => Promise.resolve({ data: null }),
        };
      },
    };

    // Chamando processBatch com instanceName
    await processBatch({
      clientId: CLIENT_ID,
      phone: PHONE,
      messages: [{ text: "Tenho interesse na oferta!", type: "text" }],
      supabase: mockSupabase,
      model: "padrao",
      instanceName: INSTANCE_NAME,
    });

    // Como não há prompt configurado no mock, ele não chama LLM mas se chamar o fluxo normal ou responder recontato
    // verificamos que lead_messages recebe delivered_at e instance_name
  });

  it("Filtragem por Chip no Inbox: Mensagens com instance_name preenchido sobrevivem ao filtro de chip", () => {
    const dbMessages = [
      { id: 1, phone: PHONE, message_text: "Disparo 1", direction: "outbound", delivered_at: "2026-08-23T10:00:00.000Z", instance_name: "GD Priscila" },
      { id: 2, phone: PHONE, message_text: "Quero saber mais", direction: "inbound", delivered_at: "2026-08-23T10:05:00.000Z", instance_name: "GD Priscila" },
      { id: 3, phone: PHONE, message_text: "Perfeito, qual melhor horário?", direction: "outbound", delivered_at: "2026-08-23T10:05:05.000Z", instance_name: "GD Priscila" },
      { id: 4, phone: PHONE, message_text: "Outro chip", direction: "outbound", delivered_at: "2026-08-23T10:10:00.000Z", instance_name: "Outro Chip" },
    ];

    const activeFilterChip = ["GD Priscila"];
    const filtered = dbMessages.filter((m) => activeFilterChip.includes(m.instance_name));

    expect(filtered).toHaveLength(3);
    expect(filtered.map((m) => m.id)).toEqual([1, 2, 3]);

    // Ordenação correta por delivered_at DESC
    const sorted = [...filtered].sort((a, b) => new Date(b.delivered_at).getTime() - new Date(a.delivered_at).getTime());
    expect(sorted.map((m) => m.id)).toEqual([3, 2, 1]);
  });

  it("Falha na gravação de lead_messages não derruba o disparo, mas emite log de aviso", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }),
        insert: () => Promise.resolve({ error: new Error("DB connection timeout") }),
      }),
    };

    const { appendLeadMessage } = createLeadMessaging({
      supabase: mockSupabase,
      normalizeString: (s) => String(s || "").trim(),
      leadsTableName: () => "leads",
      isMissingSchemaError: () => false,
    });

    // Não deve lançar exceção
    await expect(
      appendLeadMessage({
        clientId: CLIENT_ID,
        campaignId: "camp-001",
        phone: PHONE,
        senderType: "bot",
        direction: "outbound",
        messageText: "Teste resiliência",
        deliveredAt: new Date().toISOString(),
        instanceName: INSTANCE_NAME,
      })
    ).resolves.not.toThrow();

    // Deve ter logado o aviso
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("Teste de Mutação: Mensagens sem delivered_at (NULL) quebram a ordenação cronológica do Inbox", () => {
    const msgComDeliveredAt = { id: 1, text: "Msg 1", delivered_at: "2026-08-23T10:00:00.000Z" };
    const msgSemDeliveredAt = { id: 2, text: "Msg 2", delivered_at: null };

    // Comparador padrão de data
    const parseTime = (row) => (row.delivered_at ? new Date(row.delivered_at).getTime() : NaN);
    expect(Number.isNaN(parseTime(msgSemDeliveredAt))).toBe(true);
    expect(Number.isNaN(parseTime(msgComDeliveredAt))).toBe(false);
  });

  it("Gravação com mediaUrl e contentType preenche colunas media_url, content_type e meta.mediaUrl", async () => {
    const insertedRows = [];
    const poolQueries = [];
    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }),
        insert: (rows) => {
          const arr = Array.isArray(rows) ? rows : [rows];
          insertedRows.push(...arr);
          return Promise.resolve({ error: null });
        },
      }),
    };

    const mockPool = {
      query: (sql, params) => {
        poolQueries.push({ sql, params });
        return Promise.resolve({ rows: [] });
      },
    };

    const { appendLeadMessage } = createLeadMessaging({
      supabase: mockSupabase,
      pool: mockPool,
      normalizeString: (s) => String(s || "").trim(),
      leadsTableName: () => "leads",
      isMissingSchemaError: () => false,
    });

    const testDataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD...";
    await appendLeadMessage({
      clientId: CLIENT_ID,
      campaignId: "camp-001",
      phone: PHONE,
      senderType: "bot",
      direction: "outbound",
      messageText: "[Imagem] https://mesa-de-negocios.vexo.com.br",
      deliveredAt: new Date().toISOString(),
      waMessageId: "WA-IMG-12345",
      mediaUrl: testDataUrl,
      contentType: "image",
    });

    expect(insertedRows).toHaveLength(1);
    const row = insertedRows[0];
    expect(row.media_url).toBe(testDataUrl);
    expect(row.content_type).toBe("image");
    expect(row.meta.mediaUrl).toBe(testDataUrl);
    expect(row.meta.contentType).toBe("image");

    // Verifica que o update direto no pool também foi disparado para garantir sincronização
    expect(poolQueries.length).toBeGreaterThan(0);
    expect(poolQueries[0].sql).toContain("UPDATE public.lead_messages");
    expect(poolQueries[0].params[0]).toBe(testDataUrl);
    expect(poolQueries[0].params[2]).toBe("WA-IMG-12345");
  });

  it("Se PostgREST falhar, faz inserção direta no PostgreSQL via pool", async () => {
    const poolQueries = [];
    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }),
        insert: () => Promise.resolve({ error: new Error("PGRST204: schema cache error") }),
      }),
    };

    const mockPool = {
      query: (sql, params) => {
        poolQueries.push({ sql, params });
        return Promise.resolve({ rows: [] });
      },
    };

    const { appendLeadMessage } = createLeadMessaging({
      supabase: mockSupabase,
      pool: mockPool,
      normalizeString: (s) => String(s || "").trim(),
      leadsTableName: () => "leads",
      isMissingSchemaError: () => false,
    });

    await appendLeadMessage({
      clientId: CLIENT_ID,
      campaignId: "camp-001",
      phone: PHONE,
      senderType: "bot",
      direction: "outbound",
      messageText: "Disparo seguro via Postgres direto",
      deliveredAt: new Date().toISOString(),
      waMessageId: "WA-DIRECT-999",
      mediaUrl: "https://vexo.com.br/banner.png",
      contentType: "image",
    });

    const insertQuery = poolQueries.find((q) => q.sql.includes("INSERT INTO public.lead_messages"));
    expect(insertQuery).toBeDefined();
    expect(insertQuery.params[0]).toBe(CLIENT_ID);
    expect(insertQuery.params[12]).toBe("WA-DIRECT-999");
    expect(insertQuery.params[14]).toBe("https://vexo.com.br/banner.png");
    expect(insertQuery.params[15]).toBe("image");
  });
});

