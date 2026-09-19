// Para quem vai a notificacao de SDR — e, quando nao vai, POR QUE.
//
// O log dizia "no SDR number configured" com o numero salvo na tela. Tres
// situacoes diferentes caiam na mesma frase: transferencia desligada de
// proposito, numero realmente ausente, e falha de LEITURA das settings
// (getLeadClientN8nSettings devolvia null por um catch que engolia o erro).
//
// Desde 06/08/2026 o destino e uma LISTA. A mesma configuracao do tenant serve
// aos dois agentes (disparo e atendimento) — nao existem duas listas.
//
// Desde 18/09/2026 a lista pode girar (mode: "rodizio"). A decisao e POR
// LEAD, nao por mensagem: o dono do lead (se ja houver) sempre recebe os
// avisos seguintes daquele mesmo lead — sem isso, dois consultores ligam pra
// mesma pessoa sem saber um do outro, o erro classico que torna rodizio
// inutil. O dono fica gravado em leads.dados.sdr_rotation_owner; a volta em
// si (de quem e a vez do PROXIMO lead sem dono) vive em sdr_rotation_state,
// nao em memoria — servidor reinicia, a volta continua de onde parou.

import { advanceSdrRotationCursor } from "./sdrRotationState.js";

export const SDR_MOTIVOS = {
  OK: "ok",
  TRANSFERENCIA_DESLIGADA: "transferencia_desligada",
  SEM_NUMERO: "sem_numero_configurado",
  // Todos os destinos fechariam o ciclo (proprio telefone da conversa ou numero
  // da instancia). Nao e falta de configuracao — e protecao contra loop.
  TODOS_EXCLUIDOS: "todos_os_destinos_fechariam_loop",
  LEITURA_FALHOU: "leitura_de_settings_falhou",
};

/**
 * Formato aceito: so digitos, 10 a 15 (E.164 sem o "+"). Numero invalido nao
 * entra na lista — no backend e na tela, para o mesmo criterio valer nos dois.
 */
export function isValidSdrNumber(value) {
  return /^\d{10,15}$/.test(String(value ?? "").replace(/\D/g, ""));
}

export function normalizeSdrNumber(value) {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * Lista de numeros do tenant, ja normalizada e sem repetido.
 *
 * Le a coluna nova e cai na antiga quando a linha ainda nao migrou: durante o
 * deploy as duas convivem, e ler so a nova deixaria o tenant sem notificacao.
 */
export function resolveTenantSdrNumbers(tenantSettings) {
  const daLista = Array.isArray(tenantSettings?.sdr_whatsapp_numbers)
    ? tenantSettings.sdr_whatsapp_numbers
    : [];
  const brutos = daLista.length > 0 ? daLista : [tenantSettings?.sdr_whatsapp_number];

  const vistos = new Set();
  const numeros = [];
  for (const bruto of brutos) {
    const numero = normalizeSdrNumber(bruto);
    if (!numero || !isValidSdrNumber(numero) || vistos.has(numero)) continue;
    vistos.add(numero);
    numeros.push(numero);
  }
  return numeros;
}

/**
 * Le o dono gravado no lead (leads.dados.sdr_rotation_owner) — o numero que
 * recebeu o primeiro aviso deste lead, e por isso recebe todos os seguintes.
 */
async function getLeadRotationOwner({ supabase, clientId, leadId }) {
  const { data } = await supabase
    .from("leads")
    .select("dados")
    .eq("id", leadId)
    .eq("client_id", clientId)
    .maybeSingle();
  const dados = data?.dados || {};
  return { number: normalizeSdrNumber(dados.sdr_rotation_owner) || null, dados };
}

/** Grava o dono no lead — a partir daqui, os avisos SEGUINTES vao so pra ele. */
async function setLeadRotationOwner({ supabase, clientId, leadId, dados, owner }) {
  await supabase
    .from("leads")
    .update({ dados: { ...dados, sdr_rotation_owner: owner } })
    .eq("id", leadId)
    .eq("client_id", clientId);
}

/**
 * Rodizio: o MESMO lead sempre volta pro mesmo numero. Sem dono ainda (lead
 * novo) ou dono que saiu da lista (consultor removido) -> pega o proximo da
 * volta e gruda no lead; a volta em si nao anda quando o lead JA TEM dono —
 * girar por mensagem faria dois consultores falando com a mesma pessoa.
 */
async function resolveRodizioTarget({ clientId, leadId, candidates, excluded, supabase, pool }) {
  const owner = await getLeadRotationOwner({ supabase, clientId, leadId });
  if (owner.number && candidates.includes(owner.number)) {
    return { numbers: [owner.number], number: owner.number, reason: SDR_MOTIVOS.OK, excluded };
  }
  const cursor = await advanceSdrRotationCursor(pool, clientId);
  const proximo = candidates[cursor % candidates.length];
  await setLeadRotationOwner({ supabase, clientId, leadId, dados: owner.dados, owner: proximo });
  return { numbers: [proximo], number: proximo, reason: SDR_MOTIVOS.OK, excluded };
}

/**
 * Precedencia (nesta ordem — nenhuma delas muda com o rodizio):
 *  1. agente inbound com transferencia DESLIGADA -> ninguem. Escolha explicita
 *     do usuario naquele numero, vence o padrao do tenant E o rodizio.
 *  2. agente inbound com numero proprio -> so ele. E uma escolha ja unica;
 *     rodizio nao se aplica (nao ha o que girar sobre um numero so).
 *  3. caso contrario -> a lista do tenant — aqui, e so aqui, mode:"rodizio"
 *     entra: em vez da lista inteira, devolve o numero de quem e a vez.
 *
 * Devolve `numbers` (lista) e `number` (o primeiro), este ultimo so para nao
 * quebrar chamador antigo. Precisa de leadId+clientId+supabase+pool pra
 * girar de verdade; faltando qualquer um, cai no comportamento de "todos"
 * (mais seguro que girar sem conseguir fixar o dono no lead).
 */
export async function resolveSdrTarget({
  inboundConfig,
  tenantSettings,
  tenantSettingsReadFailed = false,
  excludeNumbers = [],
  mode = "todos",
  leadId = null,
  clientId = null,
  supabase = null,
  pool = null,
}) {
  if (inboundConfig && !inboundConfig.sdrTransferEnabled) {
    return { numbers: [], number: null, reason: SDR_MOTIVOS.TRANSFERENCIA_DESLIGADA, excluded: [] };
  }

  const doAgente = normalizeSdrNumber(inboundConfig?.sdrPhone);
  const usandoListaDoTenant = !(doAgente && isValidSdrNumber(doAgente));
  const candidatos = usandoListaDoTenant ? resolveTenantSdrNumbers(tenantSettings) : [doAgente];

  // NUNCA mandar o alerta para um numero que fecha o ciclo — o telefone da
  // propria conversa, ou o numero da instancia que envia. O alerta chegaria de
  // volta como inbound e dispararia outro alerta: foi assim que o loop voltou
  // depois que o destino virou uma lista.
  const proibidos = new Set(
    (Array.isArray(excludeNumbers) ? excludeNumbers : [excludeNumbers])
      .map(normalizeSdrNumber)
      .filter(Boolean)
  );
  const numeros = candidatos.filter((n) => !proibidos.has(n));
  const excluded = candidatos.filter((n) => proibidos.has(n));

  if (numeros.length > 0) {
    const podeGirar =
      mode === "rodizio" && usandoListaDoTenant && leadId && clientId && supabase && pool;
    if (podeGirar) {
      return resolveRodizioTarget({ clientId, leadId, candidates: numeros, excluded, supabase, pool });
    }
    return { numbers: numeros, number: numeros[0], reason: SDR_MOTIVOS.OK, excluded };
  }

  if (excluded.length > 0) {
    return { numbers: [], number: null, reason: SDR_MOTIVOS.TODOS_EXCLUIDOS, excluded };
  }

  // Sem numero E a leitura falhou: nao afirmar "nao configurado". A lista pode
  // existir e a consulta ter caido.
  if (tenantSettingsReadFailed) {
    return { numbers: [], number: null, reason: SDR_MOTIVOS.LEITURA_FALHOU, excluded: [] };
  }

  return { numbers: [], number: null, reason: SDR_MOTIVOS.SEM_NUMERO, excluded: [] };
}
