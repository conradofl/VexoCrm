import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { measureTenantsDiscrepancy, formatMarkdownTable } from "../scripts/measureDispatchDiscrepancyAllTenants.js";

describe("Medição de Discrepância Dashboard vs Mensagens (SPEC 9)", () => {
  let pool;

  beforeAll(async () => {
    pool = new PGlite();

    await pool.exec(`
      CREATE TABLE public.campaign_dispatch_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id text NOT NULL,
        phone text NOT NULL,
        status text NOT NULL DEFAULT 'sent',
        sent_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE public.lead_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id text NOT NULL,
        campaign_id uuid,
        dispatch_id uuid,
        phone text NOT NULL,
        direction text NOT NULL DEFAULT 'outbound',
        engagement_signal text,
        meta jsonb NOT NULL DEFAULT '{}'::jsonb,
        message_timestamp timestamptz,
        delivered_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    // Tenant A: bia-do-spazio
    // 10 leads de teste com run e com mensagem (7 responderam)
    // 15 leads de teste sem run (apenas em lead_messages com source='campaign_dispatch')
    for (let i = 1; i <= 10; i++) {
      const phone = `553499000${String(i).padStart(4, "0")}`;
      // Insere run
      await pool.query(
        `INSERT INTO public.campaign_dispatch_runs (client_id, phone, status, sent_at)
         VALUES ('bia-do-spazio', $1, 'sent', now() - interval '5 days')`,
        [phone]
      );
      // Se i <= 3, insere 2 runs para simular múltiplos runs por lead (13 runs para 10 leads)
      if (i <= 3) {
        await pool.query(
          `INSERT INTO public.campaign_dispatch_runs (client_id, phone, status, sent_at)
           VALUES ('bia-do-spazio', $1, 'sent', now() - interval '4 days')`,
          [phone]
        );
      }
      // Insere outbound em lead_messages
      await pool.query(
        `INSERT INTO public.lead_messages (client_id, phone, direction, meta, created_at)
         VALUES ('bia-do-spazio', $1, 'outbound', '{"source": "campaign_dispatch"}'::jsonb, now() - interval '5 days')`,
        [phone]
      );
      // 7 responderam dentro de 3 dias
      if (i <= 7) {
        await pool.query(
          `INSERT INTO public.lead_messages (client_id, phone, direction, created_at)
           VALUES ('bia-do-spazio', $1, 'inbound', now() - interval '2 days')`,
          [phone]
        );
      }
    }

    // 15 leads adicionais sem run (órfãos / legado)
    for (let i = 11; i <= 25; i++) {
      const phone = `553499000${String(i).padStart(4, "0")}`;
      await pool.query(
        `INSERT INTO public.lead_messages (client_id, phone, direction, meta, created_at)
         VALUES ('bia-do-spazio', $1, 'outbound', '{"source": "campaign_dispatch"}'::jsonb, now() - interval '10 days')`,
        [phone]
      );
      // 3 deles responderam
      if (i <= 13) {
        await pool.query(
          `INSERT INTO public.lead_messages (client_id, phone, direction, created_at)
           VALUES ('bia-do-spazio', $1, 'inbound', now() - interval '8 days')`,
          [phone]
        );
      }
    }

    // Tenant B: sonhare (100% dos envios com run)
    for (let i = 1; i <= 5; i++) {
      const phone = `551198000${String(i).padStart(4, "0")}`;
      await pool.query(
        `INSERT INTO public.campaign_dispatch_runs (client_id, phone, status, sent_at)
         VALUES ('sonhare', $1, 'sent', now() - interval '12 days')`,
        [phone]
      );
      await pool.query(
        `INSERT INTO public.lead_messages (client_id, phone, direction, meta, created_at)
         VALUES ('sonhare', $1, 'outbound', '{"source": "campaign_dispatch"}'::jsonb, now() - interval '12 days')`,
        [phone]
      );
      if (i <= 2) {
        await pool.query(
          `INSERT INTO public.lead_messages (client_id, phone, direction, created_at)
           VALUES ('sonhare', $1, 'inbound', now() - interval '10 days')`,
          [phone]
        );
      }
    }
  });

  afterAll(async () => {
    if (pool?.close) await pool.close();
  });

  it("calcula com exatidão a discrepância entre runs e mensagens em 30 dias", async () => {
    const rows = await measureTenantsDiscrepancy(pool, "30 days");
    expect(rows.length).toBe(2);

    const bia = rows.find((r) => r.client_id === "bia-do-spazio");
    expect(bia).toBeDefined();
    // Dashboard vê: 13 runs, 10 leads em runs
    // 10 runs tiveram resposta (pois 3 leads tinham 2 runs cada) -> 10 / 13 = 76.9%
    // 7 leads em runs tiveram resposta -> 7 / 10 = 70.0%
    expect(Number(bia.dash_runs_enviados)).toBe(13);
    expect(Number(bia.dash_runs_leads)).toBe(10);
    expect(Number(bia.dash_responderam_runs)).toBe(10);
    expect(Number(bia.dash_taxa_runs_pct)).toBe(76.9);
    expect(Number(bia.dash_leads_responderam)).toBe(7);
    expect(Number(bia.dash_taxa_leads_pct)).toBe(70.0);

    // Realidade (lead_messages): 25 leads alcançados (10 responderam: 7 + 3)
    expect(Number(bia.real_leads_alcancados)).toBe(25);
    expect(Number(bia.real_responderam_14d)).toBe(10);
    expect(Number(bia.real_taxa_14d_pct)).toBe(40.0); // 10 / 25 = 40%

    // Buraco: 15 leads alcançados sem run -> 15 / 25 = 60.0%
    expect(Number(bia.buraco_leads_sem_run)).toBe(15);
    expect(Number(bia.buraco_pct)).toBe(60.0);

    // Tenant B (sonhare): 0% de buraco
    const sonhare = rows.find((r) => r.client_id === "sonhare");
    expect(sonhare).toBeDefined();
    expect(Number(sonhare.dash_runs_enviados)).toBe(5);
    expect(Number(sonhare.real_leads_alcancados)).toBe(5);
    expect(Number(sonhare.buraco_leads_sem_run)).toBe(0);
    expect(Number(sonhare.buraco_pct)).toBe(0.0);

    // Gera tabela markdown
    const md = formatMarkdownTable(rows, "Teste");
    expect(md).toContain("bia-do-spazio");
    expect(md).toContain("TOTAL GERAL");
  });
});
