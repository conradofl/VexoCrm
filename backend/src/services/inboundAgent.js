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

import { getLeadClientEvolutionInstances, expandChipAliases } from "./evolution.js";

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

const INBOUND_AGENT_COLUMNS =
  "id, evolution_instance, evolution_instances, inbound_role, inbound_enabled, inbound_model, inbound_prompt, inbound_spin_fields, inbound_webhook_url, sdr_whatsapp_number, sdr_transfer_enabled, instructions_consolidated_at, agent_kind";

// Um agente pode atender VÁRIOS números (evolution_instances). A coluna antiga
// entra como fallback para linhas anteriores à migration.
function instancesOfRow(row) {
  const list = Array.isArray(row?.evolution_instances) ? row.evolution_instances : [];
  const nomes = list.map(normalize).filter(Boolean);
  const legado = normalize(row?.evolution_instance);
  if (legado && !nomes.includes(legado)) nomes.push(legado);
  return nomes;
}

// Uma única função monta o objeto de configuração, não importa se a linha foi
// achada pelo número (webhook) ou pelo id do agente (simulador testando o
// agente antes de existir chip) — duas montagens divergiriam na primeira
// coluna nova que alguém esquecesse de replicar na outra.
function buildInboundAgentConfig(row) {
  const spinFields = normalizeSpinFields(row.inbound_spin_fields);
  return {
    companyId: row.id,
    instanceName: normalize(row.evolution_instance) || null,
    instanceNames: instancesOfRow(row),
    role: row.inbound_role === "qualificador" ? "qualificador" : "atendimento",
    enabled: row.inbound_enabled === true,
    model: normalize(row.inbound_model) || null,
    prompt: normalize(row.inbound_prompt) || null,
    spinFields,
    webhookUrl: normalize(row.inbound_webhook_url) || null,
    sdrPhone: normalize(row.sdr_whatsapp_number) || null,
    sdrTransferEnabled: row.sdr_transfer_enabled === true,
    // "Um agente, um dono para cada texto", Commit 2: uma vez consolidado, o
    // agente ignora template e prompt padrão do tenant — processBatch lê isto
    // pra nem buscar os dois.
    instructionsConsolidated: Boolean(row.instructions_consolidated_at),
    // "Um agente por chip, com função declarada", Commit 3: pra que serve o
    // chip — atendimento (responde quem procurou a empresa) ou campanha
    // (chip de disparo, não faz atendimento espontâneo). Não confundir com
    // `role` (inbound_role) acima, que diz o que o agente FAZ dentro do
    // atendimento (atender ou qualificar).
    agentKind: row.agent_kind === "campanha" ? "campanha" : "atendimento",
  };
}

/**
 * Resolve a configuração inbound do número que recebeu a mensagem, OU do
 * agente pelo próprio id (simulador: testar o agente antes de ter chip).
 *
 * Com `agentId`: busca direta, escopada por tenant_id — fora do escopo ou
 * inexistente, null (o chamador decide 404). Ignora `instanceName` quando
 * `agentId` é passado.
 *
 * @returns {Promise<null | {
 *   companyId: string, instanceName: string|null, enabled: boolean,
 *   model: string|null, prompt: string|null,
 *   spinFields: Array<{name: string, required: boolean}>,
 *   webhookUrl: string|null, sdrPhone: string|null, sdrTransferEnabled: boolean,
 *   instructionsConsolidated: boolean, agentKind: "atendimento"|"campanha"
 * }>} null quando o tenant não tem nenhuma linha configurada.
 */
export async function resolveInboundAgentConfig({ supabase, clientId, instanceName, agentId }) {
  if (!supabase || !clientId) return null;

  if (normalize(agentId)) {
    const { data: row, error } = await supabase
      .from("followup_companies")
      .select(INBOUND_AGENT_COLUMNS)
      .eq("id", agentId)
      .eq("tenant_id", clientId)
      .is("archived_at", null)
      .maybeSingle();
    if (error || !row) return null;
    return buildInboundAgentConfig(row);
  }

  // Agente arquivado não responde mais — é exatamente o que "arquivar" com
  // chip amarrado promete: o chip volta a cair no chatbot padrão do tenant.
  const { data, error } = await supabase
    .from("followup_companies")
    .select(INBOUND_AGENT_COLUMNS)
    .eq("tenant_id", clientId)
    .is("archived_at", null);

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

  const resolveAliases = (instValue) => expandChipAliases(instValue, tenantInstances);

  const wanted = normalize(instanceName);
  const wantedAliases = wanted ? resolveAliases(wanted) : [];

  // Casa pelo nome da instância ou apelidos resolvidos (slug da URL, ID ou display name).
  // Sem casamento exato, só aceita uma linha genérica se ela for a única do tenant.
  const candidatas = wanted
    ? data.filter((row) => {
        const rowAliases = instancesOfRow(row).flatMap(resolveAliases);
        return rowAliases.some((alias) => wantedAliases.includes(alias));
      })
    : [];
  const byInstance =
    candidatas.find((row) => row.inbound_enabled === true) ||
    candidatas[0] ||
    (data.length === 1 ? data[0] : null);
  if (!byInstance) return null;

  return buildInboundAgentConfig(byInstance);
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
