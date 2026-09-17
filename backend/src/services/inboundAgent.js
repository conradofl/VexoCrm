// Configuração do agente inbound por NÚMERO de WhatsApp.
//
// Por que existe: a tela "Agente IA → Inbound" gravava inbound_enabled,
// inbound_model, inbound_prompt, inbound_spin_fields, inbound_webhook_url e
// sdr_transfer_enabled em followup_companies, e nenhum código lia esses campos.
// A tela configurava e o motor (chatbot-ai-engine) obedecia só às configurações
// do tenant, em outra tabela. Este módulo é a ponte.
//
// Um número por linha: followup_companies.evolution_instance guarda o nome da
// instância Evolution, então vários números de atendimento são várias linhas —
// cada uma com seu próprio prompt, modelo e SPIN. Não precisou mudar schema.

import { getLeadClientEvolutionInstances, parseEvolutionWebhookEndpoint } from "./evolution.js";

function normalize(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Normaliza a coluna inbound_spin_fields (JSONB) pro formato {name, required}
 * usado em toda parte que lê a coleta declarada do agente. Extraída daqui pra
 * não duplicar a mesma regra em quem só precisa LER a coleta sem resolver o
 * agente inteiro (ex.: o painel de diagnóstico de origem de instrução).
 */
export function normalizeSpinFields(rawSpinFields) {
  return Array.isArray(rawSpinFields)
    ? rawSpinFields
        .map((f) => ({ name: normalize(f?.name), required: f?.required !== false }))
        .filter((f) => f.name)
    : [];
}

/**
 * Resolve a configuração inbound do número que recebeu a mensagem.
 *
 * @returns {Promise<null | {
 *   companyId: string, instanceName: string|null, enabled: boolean,
 *   model: string|null, prompt: string|null,
 *   spinFields: Array<{name: string, required: boolean}>,
 *   webhookUrl: string|null, sdrPhone: string|null, sdrTransferEnabled: boolean
 * }>} null quando o tenant não tem nenhuma linha configurada.
 */
export async function resolveInboundAgentConfig({ supabase, clientId, instanceName }) {
  if (!supabase || !clientId) return null;

  const { data, error } = await supabase
    .from("followup_companies")
    .select(
      "id, evolution_instance, evolution_instances, inbound_role, inbound_enabled, inbound_model, inbound_prompt, inbound_spin_fields, inbound_webhook_url, sdr_whatsapp_number, sdr_transfer_enabled"
    )
    .eq("tenant_id", clientId);

  if (error || !Array.isArray(data) || data.length === 0) {
    if (error) console.warn("[inbound-agent] falha ao ler followup_companies:", error.message);
    return null;
  }

  let tenantInstances = [];
  try {
    tenantInstances = await getLeadClientEvolutionInstances(clientId);
  } catch {
    tenantInstances = [];
  }

  const resolveAliases = (instValue) => {
    const raw = normalize(instValue);
    if (!raw) return [];
    const aliases = new Set([raw.toLowerCase()]);
    const matched = (tenantInstances || []).find((inst) => {
      const parsed = parseEvolutionWebhookEndpoint(inst.dispatch_webhook_url);
      const urlInstance = parsed?.instance ? parsed.instance.toLowerCase() : null;
      return (
        inst.id === raw ||
        (inst.name && inst.name.toLowerCase() === raw.toLowerCase()) ||
        urlInstance === raw.toLowerCase()
      );
    });
    if (matched) {
      if (matched.id) aliases.add(matched.id.toLowerCase());
      if (matched.name) aliases.add(matched.name.toLowerCase());
      const parsed = parseEvolutionWebhookEndpoint(matched.dispatch_webhook_url);
      if (parsed?.instance) aliases.add(parsed.instance.toLowerCase());
    }
    return Array.from(aliases);
  };

  const wanted = normalize(instanceName);
  const wantedAliases = wanted ? resolveAliases(wanted) : [];

  // Um agente pode atender VÁRIOS números (evolution_instances). A coluna antiga
  // entra como fallback para linhas anteriores à migration.
  const instancesOf = (row) => {
    const list = Array.isArray(row?.evolution_instances) ? row.evolution_instances : [];
    const nomes = list.map(normalize).filter(Boolean);
    const legado = normalize(row?.evolution_instance);
    if (legado && !nomes.includes(legado)) nomes.push(legado);
    return nomes;
  };

  // Casa pelo nome da instância ou apelidos resolvidos (slug da URL, ID ou display name).
  // Sem casamento exato, só aceita uma linha genérica se ela for a única do tenant.
  const candidatas = wanted
    ? data.filter((row) => {
        const rowAliases = instancesOf(row).flatMap(resolveAliases);
        return rowAliases.some((alias) => wantedAliases.includes(alias));
      })
    : [];
  const byInstance =
    candidatas.find((row) => row.inbound_enabled === true) ||
    candidatas[0] ||
    (data.length === 1 ? data[0] : null);
  if (!byInstance) return null;
  const row = byInstance;

  const spinFields = normalizeSpinFields(row.inbound_spin_fields);

  return {
    companyId: row.id,
    instanceName: normalize(row.evolution_instance) || null,
    instanceNames: instancesOf(row),
    role: row.inbound_role === "qualificador" ? "qualificador" : "atendimento",
    enabled: row.inbound_enabled === true,
    model: normalize(row.inbound_model) || null,
    prompt: normalize(row.inbound_prompt) || null,
    spinFields,
    webhookUrl: normalize(row.inbound_webhook_url) || null,
    sdrPhone: normalize(row.sdr_whatsapp_number) || null,
    sdrTransferEnabled: row.sdr_transfer_enabled === true,
  };
}

/**
 * Bloco de instruções da Coleta SPIN, anexado ao prompt do agente.
 * Sem isto os campos configurados na tela eram salvos e ignorados.
 */
export function buildSpinInstruction(spinFields) {
  if (!Array.isArray(spinFields) || spinFields.length === 0) return "";

  const obrigatorios = spinFields.filter((f) => f.required).map((f) => f.name);
  const opcionais = spinFields.filter((f) => !f.required).map((f) => f.name);

  const linhas = ["", "COLETA DE DADOS OBRIGATÓRIA:"];
  if (obrigatorios.length > 0) {
    linhas.push(
      `Antes de encerrar o atendimento, colete: ${obrigatorios.join(", ")}.`,
      `Pergunte um dado por vez, de forma natural, sem parecer formulário.`,
      `Só marque "finalizado": true depois que todos estiverem coletados.`
    );
  }
  if (opcionais.length > 0) {
    linhas.push(`Colete se surgir naturalmente (não insista): ${opcionais.join(", ")}.`);
  }
  linhas.push(`Devolva os valores coletados dentro de "dados", usando exatamente estas chaves.`);

  return linhas.join("\n");
}

/**
 * Dispara o webhook de finalização configurado na tela, quando existir.
 * Falha aqui não pode derrubar a resposta ao lead — só loga.
 */
export async function fireInboundCompletionWebhook({ webhookUrl, clientId, phone, instanceName, dados, classificacao }) {
  if (!webhookUrl) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "inbound_agent.completed",
        clientId,
        instanceName: instanceName || null,
        phone,
        classificacao: classificacao || null,
        dados: dados || {},
        completedAt: new Date().toISOString(),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn(`[inbound-agent] webhook de finalizacao respondeu ${response.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[inbound-agent] webhook de finalizacao falhou:", err?.message || err);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
