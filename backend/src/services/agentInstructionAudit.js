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
