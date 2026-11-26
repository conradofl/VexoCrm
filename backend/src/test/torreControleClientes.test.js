import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  buildTorreClientesOverview,
  classifyFuturoContatoStatus,
  registrarContatoTorreCliente,
  removerContatoTorreCliente,
  setGdTorreAccess,
  isGdTorreAccessEnabled,
} from "../domains/superadmin/torreClientesService.js";

describe("Torre de Controle de Clientes Vexo OS · Horário do Contato, Futuro Contato, Campanhas e Chips", () => {
  it("registra evolução de Horário do Contato e Futuro Contato por cliente e consolida campanhas, fila e limite de chips", async () => {
    const db = new PGlite();
    await db.exec(`
      CREATE TABLE public.heloisa_config (
        chave VARCHAR(100) PRIMARY KEY,
        valor JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        updated_by VARCHAR(150)
      );
      CREATE TABLE public.leads_clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE public.lead_client_evolution_instances (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        name TEXT,
        phone TEXT,
        active BOOLEAN DEFAULT true,
        is_default BOOLEAN DEFAULT false,
        connection_state TEXT,
        chip_state TEXT,
        daily_limit_override INTEGER
      );
      CREATE TABLE public.evolution_instance_daily_usage (
        instance_id TEXT NOT NULL,
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        sent_count INTEGER DEFAULT 0
      );
      CREATE TABLE public.campaigns (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        name TEXT,
        status TEXT,
        starts_at TIMESTAMPTZ,
        ends_at TIMESTAMPTZ,
        scheduled_for TIMESTAMPTZ,
        last_triggered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        archived_at TIMESTAMPTZ,
        analytics_meta JSONB
      );
      CREATE TABLE public.campaign_dispatches (
        id TEXT PRIMARY KEY,
        campaign_id TEXT,
        client_id TEXT,
        status TEXT,
        target_count INTEGER,
        total_leads INTEGER,
        sent_count INTEGER,
        failed_count INTEGER,
        skipped_count INTEGER,
        error_message TEXT,
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE public.campaign_dispatch_runs (
        id BIGSERIAL PRIMARY KEY,
        dispatch_id TEXT,
        status TEXT
      );
      CREATE TABLE public.lead_messages (
        id BIGSERIAL PRIMARY KEY,
        client_id TEXT,
        direction TEXT,
        message_timestamp TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await db.query(`INSERT INTO public.leads_clients (id, name) VALUES ('tinge-brasil', 'Tinge Brasil')`);
    await db.query(
      `INSERT INTO public.lead_client_evolution_instances (id, client_id, name, phone, active, is_default, connection_state, daily_limit_override)
       VALUES ('chip-tb-1', 'tinge-brasil', 'Chip Disparo Tinge', '+5534991112222', true, true, 'open', 50)`
    );
    await db.query(
      `INSERT INTO public.evolution_instance_daily_usage (instance_id, date, sent_count)
       VALUES ('chip-tb-1', '2026-11-26'::date, 19), ('chip-tb-1', '2026-11-25'::date, 31)`
    );
    await db.query(
      `INSERT INTO public.campaigns (id, client_id, name, status, starts_at)
       VALUES ('camp-tb-1', 'tinge-brasil', 'Campanha Fim de Ano', 'running', '2026-11-20T12:00:00Z')`
    );
    await db.query(
      `INSERT INTO public.campaign_dispatches (id, campaign_id, client_id, status, total_leads, sent_count, failed_count, skipped_count, started_at)
       VALUES ('disp-tb-1', 'camp-tb-1', 'tinge-brasil', 'running', 150, 50, 0, 0, '2026-11-20T12:00:00Z')`
    );

    // 1. Registrar 1º contato com Horário do Contato e Futuro Contato
    const c1 = await registrarContatoTorreCliente(db, {
      clientId: "tinge-brasil",
      responsavel: "Gabriel Oliveira",
      horarioContato: "2026-11-25T14:00:00Z",
      futuroContato: "2026-11-27T14:00:00Z",
      resumo: "Alinhado início do lote de fim de ano",
      proximoAssunto: "Conferir taxa de resposta do lote 1",
      criadoPor: "Conrado",
    });
    expect(c1.clienteControle.historicoContatos).toHaveLength(1);

    // 2. Registrar 2º contato evolutivo (histórico vai sendo criado)
    const c2 = await registrarContatoTorreCliente(db, {
      clientId: "tinge-brasil",
      responsavel: "Gabriel Oliveira",
      horarioContato: "2026-11-26T15:00:00Z",
      futuroContato: "2026-11-28T16:00:00Z",
      resumo: "Revisado 50 disparos enviados, fila tem mais 100",
      proximoAssunto: "Validar fechamentos da semana",
      criadoPor: "Conrado",
    });
    expect(c2.clienteControle.historicoContatos).toHaveLength(2);

    // 3. Visão consolidada da Torre
    const overview = await buildTorreClientesOverview(db, { now: new Date("2026-11-26T15:30:00Z") });
    expect(overview.resumoGlobal.totalClientes).toBe(1);
    const tb = overview.clientes[0];
    expect(tb.id).toBe("tinge-brasil");
    expect(tb.chips.connected).toBe(1);
    expect(tb.chips.totalDailyLimit).toBe(50);
    expect(tb.chips.usedQuotaToday).toBe(19);
    expect(tb.chips.totalSentAllChips).toBe(50);
    expect(tb.chips.items[0].usedToday).toBe(19);
    expect(tb.chips.items[0].totalSent).toBe(50);
    expect(tb.chips.items[0].balancePercentToday).toBe(100);
    expect(tb.campanhas.totalLeads).toBe(150);
    expect(tb.campanhas.enviadosTotal).toBe(50);
    expect(tb.campanhas.filaRestante).toBe(100);
    expect(tb.campanhas.items[0].estimatedEndAt).toBeTruthy();
    expect(tb.relacionamento.responsavel).toBe("Gabriel Oliveira");
    expect(tb.relacionamento.horarioContato).toBe("2026-11-26T15:00:00.000Z");
    expect(tb.relacionamento.futuroContato).toBe("2026-11-28T16:00:00.000Z");
    expect(tb.relacionamento.futuroContatoStatus).toBe("agendado");
    expect(tb.relacionamento.historicoContatos).toHaveLength(2);

    // 4. Remover um contato do histórico
    const aposRemocao = await removerContatoTorreCliente(db, {
      clientId: "tinge-brasil",
      contatoId: c2.registro.id,
    });
    expect(aposRemocao.historicoContatos).toHaveLength(1);

    // 5. Controle de acesso para a GD
    await setGdTorreAccess(db, { enabled: false, updatedBy: "Conrado" });
    expect(await isGdTorreAccessEnabled(db)).toBe(false);
    await setGdTorreAccess(db, { enabled: true, updatedBy: "Conrado" });
    expect(await isGdTorreAccessEnabled(db)).toBe(true);

    // 6. Classificação de status do Futuro Contato
    const refNow = new Date("2026-11-26T15:00:00Z");
    expect(classifyFuturoContatoStatus("2026-11-25T15:00:00Z", refNow)).toBe("atrasado");
    expect(classifyFuturoContatoStatus("2026-11-26T18:00:00Z", refNow)).toBe("hoje");
    expect(classifyFuturoContatoStatus("2026-11-29T18:00:00Z", refNow)).toBe("agendado");

    await db.close();
  });
});
