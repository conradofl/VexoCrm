// Gate do PLANO MODULAR no backend.
//
// Ate aqui o gating existia so no frontend (getInheritedPlanPages, usada por
// AppSidebar e ProtectedRoute). O menu escondia o item e a rota respondia
// normalmente — esconder botao nao e permissao.
//
// O backend ja tinha deriveTenantInternalPages em access/claims.js, com teste verde,
// mas `grep -rn deriveTenantInternalPages backend/src` so encontrava o proprio
// arquivo de teste: a funcao nunca foi ligada ao caminho das claims. Mesmo padrao
// dos dois runCampaignDispatch — funcao certa, teste verde, e o que roda e outra
// coisa. Este modulo e o fio que faltava.
//
// ADITIVO POR CONSTRUCAO: so restringe quando o tenant e "modular". Essencial,
// avancado e tenant sem plano saem daqui com as mesmas paginas que entraram. O
// projeto ja teve regressao de acesso por troca de lista, entao a restricao e uma
// INTERSECAO com o que o usuario ja tinha, nunca uma substituicao.

import { deriveTenantInternalPages } from "./claims.js";
import { getLeadClientN8nSettings } from "../services/n8nSettings.js";
import { sendError } from "../services/httpInfra.js";

const REVALIDATION_TTL_MS = 60_000; // 1 minuto para revalidação periódica
const LAST_GOOD_HORIZON_MS = 24 * 60 * 60_000; // 24 horas de resiliência durante instabilidade de banco

const revalidationCache = new Map();
const lastGoodCache = new Map();

function planoDoTenant(settings) {
  return String(settings?.plan_tier || settings?.planTier || "").toLowerCase().trim();
}

export function isPlanoModular(settings) {
  const plano = planoDoTenant(settings);
  return plano.includes("modular") || plano.includes("avulso");
}

function formatAge(ms) {
  const seg = Math.max(0, Math.floor(ms / 1000));
  if (seg < 60) return `${seg}s`;
  const min = Math.floor(seg / 60);
  if (min < 60) return `${min}m ${seg % 60}s`;
  const horas = Math.floor(min / 60);
  return `${horas}h ${min % 60}m`;
}

/**
 * Settings do tenant com revalidação a cada 1 minuto (TTL) e rede de degradação
 * separada (lastGoodCache) com horizonte de 24 horas.
 *
 * Em caso de oscilação do banco (readError):
 * - Se existe última leitura bem-sucedida dentro de 24h, usa-a e loga a idade exata
 *   da leitura ("usando cache de X atrás"), mantendo planos essencial/avançado/modular no ar.
 * - Só nega (fail-closed) se NUNCA houve leitura boa ou se a última tiver mais de 24 horas.
 */
async function settingsDoTenant(clientId) {
  const agora = Date.now();
  const revalEntry = revalidationCache.get(clientId);
  if (revalEntry && agora - revalEntry.timestamp < REVALIDATION_TTL_MS) {
    return revalEntry.settings;
  }

  try {
    const settings = await getLeadClientN8nSettings(clientId);
    revalidationCache.set(clientId, { settings, timestamp: agora });
    lastGoodCache.set(clientId, { settings, timestamp: agora });
    return settings;
  } catch (err) {
    const lastGood = lastGoodCache.get(clientId);
    if (lastGood && agora - lastGood.timestamp < LAST_GOOD_HORIZON_MS) {
      const idadeMs = agora - lastGood.timestamp;
      const idadeLegivel = formatAge(idadeMs);
      console.warn("[modular-gate] oscilação de banco: usando última leitura de settings bem-sucedida em cache", {
        clientId,
        plano: planoDoTenant(lastGood.settings),
        idadeMs,
        idadeLegivel,
        aviso: `usando cache de ${idadeLegivel} atrás`,
        erro: err?.message || err,
      });
      return lastGood.settings;
    }

    // Em controle de acesso, se NUNCA houve leitura bem-sucedida ou expirou o horizonte máximo:
    // falha de leitura NEGA acesso (fail-closed) e loga com erro.
    console.error("[modular-gate] falha ao ler settings do tenant sem cache prévio válido; acesso negado por segurança", {
      clientId,
      erro: err?.message || err,
    });
    return { readError: true, error: err };
  }
}

/** So para teste: zera ambos os caches entre casos. */
export function _resetModularGateCache() {
  revalidationCache.clear();
  lastGoodCache.clear();
}

/**
 * Aplica o plano modular ao perfil de acesso, no lugar por onde TODA rota passa
 * (requireFirebaseAuth). Devolve o proprio perfil quando nao ha o que restringir.
 */
export async function applyModularPlanGate(accessProfile) {
  if (!accessProfile) return accessProfile;

  // Admin e superadmin nao sao restringidos: sao a equipe Vexo, nao o tenant.
  if (accessProfile.isAdmin || accessProfile.role === "superadmin") return accessProfile;

  const clientId = accessProfile.clientId || accessProfile.clientIds?.[0] || null;
  if (!clientId) return accessProfile;

  const settings = await settingsDoTenant(clientId);
  if (!settings) return accessProfile;

  if (settings.readError) {
    return {
      ...accessProfile,
      internalPages: [],
      planTier: "error",
      error: "TENANT_SETTINGS_READ_FAILED",
    };
  }

  if (!isPlanoModular(settings)) return accessProfile;

  const permitidas = deriveTenantInternalPages({
    plan_tier: settings.plan_tier,
    modulos_avulsos: settings.modulos_avulsos,
  });
  const permitidasSet = new Set(permitidas);

  const antes = Array.isArray(accessProfile.internalPages) ? accessProfile.internalPages : [];
  // INTERSECAO: o modular nunca CONCEDE pagina que o usuario nao tinha; so tira o
  // que o tenant nao contratou.
  const depois = antes.filter((pagina) => permitidasSet.has(pagina));

  if (depois.length !== antes.length) {
    const removidas = antes.filter((p) => !permitidasSet.has(p));
    console.log("[modular-gate] paginas removidas por plano modular", {
      clientId,
      removidas,
      restantes: depois.length,
    });
  }

  return { ...accessProfile, internalPages: depois, planTier: "modular" };
}

/**
 * Exige que a pagina venha de um modulo CONTRATADO — mas so para tenant modular.
 *
 * Nao da para usar requireInternalPageAccess aqui: ele cobra a chave da claim, e
 * claim de usuario antigo nao tem "banco-de-dados" (a chave so entrou em
 * INTERNAL_PAGE_KEYS em a3fae32, e claim so e reescrita quando o acesso do
 * usuario e salvo). Cobrar a chave hoje derrubaria usuario de tenant pagante que
 * usa a tela todo dia.
 *
 * Entao o criterio e o unico que ja e verdade agora: para tenant modular,
 * applyModularPlanGate acabou de reduzir internalPages ao que o plano concede —
 * se a pagina nao sobreviveu ali, o modulo nao foi contratado. Para tenant
 * essencial e avancado o middleware nao faz nada, porque modulos_avulsos nunca
 * governou esses planos.
 */
export function requireContractedModulePage(page) {
  const pages = Array.isArray(page) ? page : [page];
  return (req, res, next) => {
    const access = req.authAccess;

    if (access?.isAdmin || access?.role === "superadmin") {
      next();
      return;
    }

    if (access?.error === "TENANT_SETTINGS_READ_FAILED") {
      sendError(
        res,
        503,
        "SERVICE_UNAVAILABLE",
        "Instabilidade temporária ao verificar módulo contratado. Por favor, tente novamente em instantes."
      );
      return;
    }

    // planTier so vale "modular" quando applyModularPlanGate agiu de fato.
    if (access?.planTier !== "modular") {
      next();
      return;
    }

    if (Array.isArray(access.internalPages) && pages.some((p) => access.internalPages.includes(p))) {
      next();
      return;
    }

    console.warn("[modular-gate] modulo nao contratado", {
      page: pages.join(", "),
      clientId: access?.clientId,
    });
    sendError(res, 403, "FORBIDDEN", `Módulo não contratado no plano modular: ${pages.join(", ")}`);
  };
}
