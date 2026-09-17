// backend/src/services/chipExclusivity.js
//
// "Um chip pertence a um agente só" — hoje evolution_instances é uma lista no
// agente, e nada impede dois agentes reivindicarem o mesmo chip. A resolução
// (resolveInboundAgentConfig) escolhia "o primeiro que casar" — regra
// invisível, dependente da ordem que o Supabase devolve as linhas.
//
// Esta função roda NA GRAVAÇÃO (POST/PATCH de agente): se algum chip pedido
// já pertence a outro agente do MESMO tenant, recusa nomeando qual agente já
// usa aquele chip. Medição de 16/09 (sete tenants, um agente e um chip cada,
// nenhuma duplicata) mostrou que hoje não existe conflito real — por ser
// retrato de um momento, a checagem vale pra sempre daqui pra frente, não só
// uma vez agora.

import { expandChipAliases } from "./evolution.js";

/**
 * @param {object} params
 * @param {string[]} params.requestedInstanceNames - nomes/ids de chip pedidos pro agente sendo salvo
 * @param {string|null} params.agentIdBeingSaved - id do agente sendo salvo (null = criando um novo)
 * @param {Array<{id: string, name: string|null, evolution_instance: string|null, evolution_instances: string[]|null}>} params.otherAgentRows - TODAS as linhas de followup_companies do tenant (inclui a que está sendo salva — ela é ignorada por id)
 * @param {Array} params.tenantInstances - getLeadClientEvolutionInstances(tenantId), pra resolver apelido/slug/id do mesmo jeito que a resolução em tempo real usa
 * @returns {{ chipRequested: string, ownedByAgentId: string, ownedByAgentName: string } | null}
 */
export function findChipExclusivityConflict({ requestedInstanceNames, agentIdBeingSaved, otherAgentRows, tenantInstances }) {
  const pedidos = (requestedInstanceNames || [])
    .map((name) => ({ name, aliases: expandChipAliases(name, tenantInstances) }))
    .filter((p) => p.aliases.length > 0);

  for (const row of otherAgentRows || []) {
    if (agentIdBeingSaved && row.id === agentIdBeingSaved) continue;

    const nomesDaLinha = [
      ...(Array.isArray(row.evolution_instances) ? row.evolution_instances : []),
      row.evolution_instance,
    ].filter(Boolean);
    const aliasesDaLinha = new Set(nomesDaLinha.flatMap((n) => expandChipAliases(n, tenantInstances)));
    if (aliasesDaLinha.size === 0) continue;

    for (const pedido of pedidos) {
      if (pedido.aliases.some((a) => aliasesDaLinha.has(a))) {
        return {
          chipRequested: pedido.name,
          ownedByAgentId: row.id,
          ownedByAgentName: row.name || "outro agente",
        };
      }
    }
  }

  return null;
}
