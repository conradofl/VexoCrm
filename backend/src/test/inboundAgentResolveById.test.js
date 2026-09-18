// backend/src/test/inboundAgentResolveById.test.js
//
// resolveInboundAgentConfig({ agentId }) — busca direta pelo id do agente,
// escopada por tenant_id na própria query. É o que o simulador ("Testar
// antes de soltar") usa pra testar um agente sem chip vinculado. Precisa
// devolver null (não lançar) quando o id não bate com o tenant — a rota
// decide o 404 a partir disso, sem tocar processBatch.

import { describe, expect, it, vi } from "vitest";
import { resolveInboundAgentConfig } from "../services/inboundAgent.js";

function mockSupabaseReturning(row) {
  const is = vi.fn(() => ({ maybeSingle: () => Promise.resolve({ data: row, error: null }) }));
  const eq2 = vi.fn(() => ({ is }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  const from = vi.fn(() => ({ select }));
  return { from, _eq1: eq1, _eq2: eq2, _is: is, _select: select };
}

describe("resolveInboundAgentConfig com agentId", () => {
  it("agente existe e pertence ao tenant: devolve a config com prompt e companyId do agente", async () => {
    const supabase = mockSupabaseReturning({
      id: "agente-1",
      tenant_id: "sonhare",
      evolution_instance: null,
      evolution_instances: [],
      inbound_role: "atendimento",
      inbound_enabled: true,
      inbound_model: "openai/gpt-oss-120b",
      inbound_prompt: "Prompt exclusivo deste agente.",
      inbound_spin_fields: [{ name: "interesse", required: true }],
      inbound_webhook_url: null,
      sdr_whatsapp_number: null,
      sdr_transfer_enabled: false,
      instructions_consolidated_at: null,
      agent_kind: "atendimento",
    });

    const config = await resolveInboundAgentConfig({ supabase, clientId: "sonhare", agentId: "agente-1" });

    expect(config).not.toBeNull();
    expect(config.companyId).toBe("agente-1");
    expect(config.prompt).toBe("Prompt exclusivo deste agente.");
    expect(config.model).toBe("openai/gpt-oss-120b");
  });

  it("[TESTE OBRIGATÓRIO] a query filtra por id E por tenant_id — não só por id", async () => {
    const supabase = mockSupabaseReturning({
      id: "agente-1", tenant_id: "sonhare", evolution_instance: null, evolution_instances: [],
      inbound_role: "atendimento", inbound_enabled: true, inbound_model: null, inbound_prompt: "x",
      inbound_spin_fields: [], inbound_webhook_url: null, sdr_whatsapp_number: null,
      sdr_transfer_enabled: false, instructions_consolidated_at: null, agent_kind: "atendimento",
    });

    await resolveInboundAgentConfig({ supabase, clientId: "sonhare", agentId: "agente-1" });

    expect(supabase._select).toHaveBeenCalled();
    expect(supabase._eq1).toHaveBeenCalledWith("id", "agente-1");
    expect(supabase._eq2).toHaveBeenCalledWith("tenant_id", "sonhare");
    expect(supabase._is).toHaveBeenCalledWith("archived_at", null);
  });

  it("[TESTE OBRIGATÓRIO] agente arquivado: a query pede archived_at nulo — arquivado não é achado, mesmo id e tenant certos", async () => {
    // O mock devolve null pra simular a query real não achando linha (o
    // filtro .is("archived_at", null) descarta a linha arquivada no banco).
    const supabase = mockSupabaseReturning(null);

    const config = await resolveInboundAgentConfig({ supabase, clientId: "sonhare", agentId: "agente-arquivado" });

    expect(supabase._is).toHaveBeenCalledWith("archived_at", null);
    expect(config).toBeNull();
  });

  it("[TESTE OBRIGATÓRIO] agente de outro tenant (a query não acha nada com o filtro tenant_id): devolve null, não lança", async () => {
    const supabase = mockSupabaseReturning(null);

    const config = await resolveInboundAgentConfig({ supabase, clientId: "sonhare", agentId: "agente-de-outro-tenant" });

    expect(config).toBeNull();
  });

  it("erro do banco na busca por id: devolve null (o chamador decide 404, não 500)", async () => {
    const from = vi.fn(() => ({
      select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: "timeout" } }) }) }) }) }),
    }));

    const config = await resolveInboundAgentConfig({ supabase: { from }, clientId: "sonhare", agentId: "agente-1" });

    expect(config).toBeNull();
  });

  it("agentId tem prioridade — mesmo sem instanceName, resolve normalmente", async () => {
    const supabase = mockSupabaseReturning({
      id: "agente-1", tenant_id: "sonhare", evolution_instance: null, evolution_instances: [],
      inbound_role: "atendimento", inbound_enabled: false, inbound_model: null, inbound_prompt: "x",
      inbound_spin_fields: [], inbound_webhook_url: null, sdr_whatsapp_number: null,
      sdr_transfer_enabled: false, instructions_consolidated_at: null, agent_kind: "atendimento",
    });

    const config = await resolveInboundAgentConfig({ supabase, clientId: "sonhare", agentId: "agente-1", instanceName: null });

    expect(config.companyId).toBe("agente-1");
  });
});
