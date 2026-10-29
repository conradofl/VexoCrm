// backend/src/rag/access.js
//
// Quem pode usar a Base de Conhecimento RAG. Uma função só, usada pelo gate das
// rotas E pela tela (GET /api/rag/access) — se as duas tivessem regra própria,
// a tela voltaria a mostrar um botão que a API recusa.
//
// Antes o gate era requireInternalPageAccess("chatbot-docs"). Só que
// "chatbot-docs" é, na tela, a aba de Documentação do chatbot (admin), e o
// preset gestor que a tela grava nem tem essa página (DT-006): gestor de
// tenant avançado levava 403 no upload.
//
// A regra agora separa as duas perguntas:
//   - o USUÁRIO pode mexer no Agente IA? -> página "agente" (a mesma que abre
//     /crm/agente). "chatbot-docs" continua valendo para não tirar acesso de
//     quem já tem.
//   - o TENANT contratou o RAG? -> plano avançado ou módulo agente_rag. É aqui
//     que "agente" deixa de ser ambíguo: quem só contratou agente_inbound tem a
//     página, mas o tenant não tem o módulo.

import { MODULE_CATALOG } from "../access/permissionsRegistry.js";
import { getLeadClientN8nSettings } from "../services/n8nSettings.js";

const RAG_USER_PAGES = ["agente", "chatbot-docs"];
const RAG_MODULE = MODULE_CATALOG.find((m) => m.id === "agente_rag");

export const RAG_ACCESS_MESSAGES = {
  RAG_SETTINGS_UNAVAILABLE: "Instabilidade temporária ao verificar o plano da empresa. Tente novamente em instantes.",
  RAG_ROLE_NOT_ALLOWED: "A Base de Conhecimento é restrita à equipe com acesso ao Agente IA.",
  RAG_USER_NOT_ALLOWED: "Seu usuário não tem acesso ao Agente IA. Fale com o administrador.",
  RAG_MODULE_NOT_CONTRACTED: "A Base de Conhecimento não está contratada para esta empresa.",
};

function allow() {
  return { allowed: true, status: 200, reason: null, message: null };
}

function deny(status, reason) {
  return { allowed: false, status, reason, message: RAG_ACCESS_MESSAGES[reason] };
}

/** Passos que só dependem do usuário — rodam no router.use, antes de qualquer rota. */
export function evaluateRagUser(access) {
  if (access?.error === "TENANT_SETTINGS_READ_FAILED") return deny(503, "RAG_SETTINGS_UNAVAILABLE");
  // Admin e superadmin não são barrados nem por usuário nem por plano (igual a antes).
  if (access?.isAdmin || access?.role === "superadmin") return { ...allow(), bypassTenant: true };
  if (access?.role !== "internal") return deny(403, "RAG_ROLE_NOT_ALLOWED");

  const pages = Array.isArray(access.internalPages) ? access.internalPages : [];
  if (!RAG_USER_PAGES.some((page) => pages.includes(page))) return deny(403, "RAG_USER_NOT_ALLOWED");

  return allow();
}

/**
 * O tenant contratou o RAG? Mesmo critério de deriveTenantInternalPages
 * (claims.js) para o plano avançado, e o MODULE_CATALOG para id e apelidos do
 * módulo — apelido declarado num lugar só, nunca uma lista paralela aqui.
 */
export function tenantHasRagModule(settings) {
  if (!settings) return false;

  const plano = String(settings.plan_tier || settings.planTier || "").toLowerCase().trim();
  if (plano.includes("avancad") || plano.includes("advanced")) return true;

  const raw = settings.modulos_avulsos || settings.modulosAvulsos || [];
  const lista = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const contratados = new Set(
    lista
      .map((item) => String(item ?? "").toLowerCase().replace(/^(mod_|modulo_)/, "").trim())
      .filter(Boolean)
  );

  if (contratados.has("all") || contratados.has("*")) return true;
  return contratados.has(RAG_MODULE.id) || RAG_MODULE.aliases.some((alias) => contratados.has(alias));
}

/** Veredito completo (usuário + tenant). Falha ao ler o plano nega (503), nunca libera. */
export async function evaluateRagAccess(access, clientId) {
  const user = evaluateRagUser(access);
  if (!user.allowed) return user;
  if (user.bypassTenant) return allow();

  let settings;
  try {
    settings = await getLeadClientN8nSettings(clientId);
  } catch (err) {
    console.error("[rag/access] falha ao ler settings do tenant; acesso negado por segurança", {
      clientId,
      erro: err?.message || String(err),
    });
    return deny(503, "RAG_SETTINGS_UNAVAILABLE");
  }

  if (!tenantHasRagModule(settings)) return deny(403, "RAG_MODULE_NOT_CONTRACTED");
  return allow();
}
