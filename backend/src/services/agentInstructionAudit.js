// backend/src/services/agentInstructionAudit.js
//
// "Um agente, um dono para cada texto" — Commit 1: mostrar a verdade, sem
// mover nada. Hoje um agente (linha de followup_companies) é instruído por
// até TRÊS fontes ao mesmo tempo, e nenhuma tela diz qual venceu:
//   - o prompt do PRÓPRIO agente (inbound_prompt), se existir;
//   - senão, o prompt PADRÃO DO TENANT (chatbot_prompts, tipo "padrao") —
//     o mesmo texto vale pra TODOS os agentes daquele tenant que não tiverem
//     prompt próprio;
//   - o TEMPLATE (chatbot_templates), escolhido pelo `chatbot_model` do
//     TENANT (não por agente) — data_fields dele entra no prompt de QUALQUER
//     conversa daquele tenant, mesmo que o agente tenha sua própria Coleta
//     SPIN com campos diferentes. As duas listas competem em silêncio.
//
// Esta função só DESCREVE o que está acontecendo agora, com as mesmas
// helpers que o motor (chatbot-ai-engine.js) usa pra montar o prompt de
// verdade — nunca uma reimplementação paralela que poderia divergir. Não
// grava nada, não muda nenhum comportamento. É diagnóstico.

import { normalizeSpinFields } from "./inboundAgent.js";

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function templateFieldsOf(template) {
  const fields = Array.isArray(template?.data_fields) ? template.data_fields : [];
  const required = Array.isArray(template?.required_fields) ? template.required_fields : [];
  return fields
    .map((f) => ({ name: normalizeText(f?.key), label: normalizeText(f?.label), required: required.includes(f?.key) }))
    .filter((f) => f.name);
}

/**
 * Monta o diagnóstico de origem de instrução de um agente.
 *
 * @param {object} params
 * @param {object} params.agentRow - linha crua de followup_companies (inbound_prompt, inbound_spin_fields, inbound_model)
 * @param {string|null} params.tenantPromptContent - chatbot_prompts do tenant, tipo "padrao" (fetchDynamicPrompt)
 * @param {object|null} params.template - chatbot_templates resolvido pelo chatbot_model do TENANT (fetchTemplate)
 * @param {string|null} params.defaultLlmModel - modelo LLM que entra se o agente não tiver o seu
 */
export function auditAgentInstructionSources({ agentRow, tenantPromptContent = null, template = null, defaultLlmModel = null }) {
  const agentPromptText = normalizeText(agentRow?.inbound_prompt);
  const tenantPromptText = normalizeText(tenantPromptContent);

  const prompt = {
    source: agentPromptText ? "agente" : tenantPromptText ? "tenant" : "nenhum",
    value: agentPromptText || tenantPromptText || null,
    // Presente mesmo quando não é a fonte ativa — é o que o painel mostra
    // riscado/secundário, pra ficar claro que existe e não está em uso.
    tenantPromptText: tenantPromptText || null,
  };

  const agentFields = normalizeSpinFields(agentRow?.inbound_spin_fields);
  const templateFields = templateFieldsOf(template);
  const agentNames = new Set(agentFields.map((f) => f.name.toLowerCase()));

  // Conflito só existe numa direção: o template pedindo um campo que o
  // agente não coleta é o robô sendo instruído por baixo, sem que a tela do
  // agente mostre isso — é o que engana. O contrário (campo só no agente,
  // ausente do template) é normal: o agente é a autoridade sobre a própria
  // Coleta, e um template mais enxuto não muda nada no que ele pergunta.
  const conflicts = [];
  for (const f of templateFields) {
    if (!agentNames.has(f.name.toLowerCase())) {
      conflicts.push({
        field: f.name,
        emAgente: false,
        emTemplate: true,
        origemTemplate: template?.template_key || null,
        motivo: `"${f.name}" é pedido pelo template "${template?.template_key || "?"}" mas não está na Coleta do agente`,
      });
    }
  }

  const collection = {
    agentFields,
    templateFields,
    templateKey: template?.template_key || null,
    conflicts,
  };

  const model = {
    source: normalizeText(agentRow?.inbound_model) ? "agente" : "padrão do sistema",
    value: normalizeText(agentRow?.inbound_model) || defaultLlmModel || null,
  };

  return { prompt, collection, model };
}

/**
 * Valida se o prompt e a lista de campos de um agente possuem as condições
 * mínimas para operar de forma autônoma sem o template padrão do tenant.
 *
 * Retorna { valid: boolean, errors: string[] } com os erros detalhados item por item.
 *
 * @param {object} params
 * @param {string|null} params.promptText - Prompt consolidado
 * @param {Array} [params.collectionFields] - Campos de coleta a serem gravados
 */
export function validateAutonomousPrompt({ promptText, collectionFields = [] } = {}) {
  const errors = [];
  const cleanPrompt = typeof promptText === "string" ? promptText.trim() : "";

  if (!cleanPrompt) {
    errors.push("Prompt está vazio — defina as instruções de atendimento do agente antes de torná-lo autônomo.");
  } else if (cleanPrompt.length < 20) {
    errors.push("Prompt é muito curto (mínimo de 20 caracteres) — detalhe o objetivo e as instruções de conversa.");
  }

  if (Array.isArray(collectionFields)) {
    for (let i = 0; i < collectionFields.length; i++) {
      const f = collectionFields[i];
      if (!f?.name || !String(f.name).trim()) {
        errors.push(`Campo de coleta #${i + 1} possui nome vazio.`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// "Agente de atendimento não liga sem prompt". A tela gravava inbound_enabled
// direto num PATCH que não olhava nada, e o agente ficava "ligado" recebendo
// mensagens sem responder ninguém (PROMPT NOT FOUND no motor). A regra mora no
// servidor e olha o estado FINAL da linha, para fechar as três portas de uma
// vez: ligar sem prompt, apagar o prompt de um agente ligado e trocar a Função
// de Disparo para Atendimento sem prompt.
//
// Agente de Disparo (agent_kind "campanha") não é barrado: ele só fala com quem
// responde campanha, e o roteiro da campanha vira a base do prompt no motor.
// Os passos da campanha não dependem do agente (caminho 1 do webhook roda antes
// do portão do agente — provado em campaignStepIndependsOfAgent.test.js).
//
// Todo texto nomeia a saída "mude a Função para Disparo": bloquear sem ensinar
// o caminho foi o que fez a tela mandar cliente para outra tela à toa.
export const AGENT_WITHOUT_PROMPT = "AGENT_WITHOUT_PROMPT";

const MENSAGEM_TRAVA = {
  ligar:
    "Um agente de atendimento precisa de prompt para ser ligado. Sem ele, recebe as mensagens e não responde ninguém. Se este agente serve só para continuar campanha e não para atender, mude a Função para Disparo em vez de escrever um prompt.",
  apagar_prompt:
    "Este agente está ligado. Sem prompt, ele para de responder. Desligue antes de apagar, ou mude a Função para Disparo se ele serve só para campanha.",
  mudar_para_atendimento:
    "Para atender, este agente precisa de prompt. Escreva como ele deve conversar antes de mudar a Função para Atendimento.",
};

/**
 * Decide se uma escrita em followup_companies deixaria um agente de
 * atendimento ligado sem prompt efetivo. O prompt efetivo é o mesmo que o motor
 * usa (chatbot-ai-engine.js): agente consolidado só conta o próprio; os demais
 * caem no prompt padrão da empresa quando o próprio está vazio. O mínimo é o de
 * validateAutonomousPrompt.
 *
 * @param {object} params
 * @param {object|null} params.antes - linha gravada antes da escrita (null na criação)
 * @param {object} params.depois - linha como fica depois da escrita
 * @param {() => Promise<string|null>} params.loadTenantPrompt - busca o prompt
 *   padrão da empresa; só é chamada quando ele decide o resultado
 * @returns {Promise<null | { code: string, motivo: string, message: string, saida: { agent_kind: "campanha" } }>}
 */
export async function checkAgentEnableGuard({ antes = null, depois, loadTenantPrompt }) {
  if (depois?.inbound_enabled !== true) return null;
  if (depois?.agent_kind === "campanha") return null;

  const consolidado = Boolean(depois.instructions_consolidated_at);
  const temPromptProprio = Boolean(normalizeText(depois.inbound_prompt));
  const tenantPromptContent =
    consolidado || temPromptProprio || typeof loadTenantPrompt !== "function" ? null : await loadTenantPrompt();

  const { prompt } = auditAgentInstructionSources({ agentRow: depois, tenantPromptContent });
  if (validateAutonomousPrompt({ promptText: prompt.value }).valid) return null;

  let motivo = "apagar_prompt";
  if (antes?.inbound_enabled !== true) motivo = "ligar";
  else if (antes?.agent_kind === "campanha") motivo = "mudar_para_atendimento";

  return {
    code: AGENT_WITHOUT_PROMPT,
    motivo,
    message: MENSAGEM_TRAVA[motivo],
    saida: { agent_kind: "campanha" },
  };
}

