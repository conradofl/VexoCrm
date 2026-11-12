// backend/src/audioLibrary/access.js
//
// Quem pode usar a Biblioteca de Áudios. Espelha rag/access.js (uma função só,
// usada pelo gate das rotas E pela tela em GET /api/audio-library/access), mas
// com regra própria — rag/access.js fica intocado e nenhuma chave de permissão
// nova nasce aqui.
//
// As duas perguntas, separadas como no RAG:
//   - o USUÁRIO pode mexer no Agente IA? -> página "agente", a mesma que abre
//     /crm/agente, onde a aba "Áudios" mora.
//   - o TENANT tem o Agente IA? -> a página "agente" precisa sair de
//     deriveTenantInternalPages (claims.js), a mesma derivação que monta as
//     páginas do tenant no login. Nada de lista paralela de planos aqui.

import { deriveTenantInternalPages } from "../access/claims.js";
import { getLeadClientN8nSettings } from "../services/n8nSettings.js";

const AUDIO_LIBRARY_PAGE = "agente";

export const AUDIO_LIBRARY_ACCESS_MESSAGES = {
  AUDIO_SETTINGS_UNAVAILABLE: "Instabilidade temporária ao verificar o plano da empresa. Tente novamente em instantes.",
  AUDIO_ROLE_NOT_ALLOWED: "A Biblioteca de Áudios é restrita à equipe com acesso ao Agente IA.",
  AUDIO_USER_NOT_ALLOWED: "Seu usuário não tem acesso ao Agente IA. Fale com o administrador.",
  AUDIO_TENANT_NOT_CONFIGURED: "Esta empresa ainda não tem o Agente IA configurado.",
  AUDIO_MODULE_NOT_CONTRACTED: "O Agente IA não está contratado para esta empresa.",
};

function allow() {
  return { allowed: true, status: 200, reason: null, message: null };
}

function deny(status, reason) {
  return { allowed: false, status, reason, message: AUDIO_LIBRARY_ACCESS_MESSAGES[reason] };
}

/** Passos que só dependem do usuário — rodam no router.use, antes de qualquer rota. */
export function evaluateAudioLibraryUser(access) {
  if (access?.error === "TENANT_SETTINGS_READ_FAILED") return deny(503, "AUDIO_SETTINGS_UNAVAILABLE");
  // Admin e superadmin não são barrados nem por usuário nem por plano (igual ao RAG).
  if (access?.isAdmin || access?.role === "superadmin") return { ...allow(), bypassTenant: true };
  if (access?.role !== "internal") return deny(403, "AUDIO_ROLE_NOT_ALLOWED");

  const pages = Array.isArray(access.internalPages) ? access.internalPages : [];
  if (!pages.includes(AUDIO_LIBRARY_PAGE)) return deny(403, "AUDIO_USER_NOT_ALLOWED");

  return allow();
}

/** O tenant tem a página "agente"? Decide a mesma função que deriva as páginas no login. */
export function tenantHasAgentPage(settings) {
  if (!settings) return false;
  return deriveTenantInternalPages(settings).includes(AUDIO_LIBRARY_PAGE);
}

/** Veredito completo (usuário + tenant). Falha ao ler o plano nega (503), nunca libera. */
export async function evaluateAudioLibraryAccess(access, clientId) {
  const user = evaluateAudioLibraryUser(access);
  if (!user.allowed) return user;
  if (user.bypassTenant) return allow();

  let settings;
  try {
    settings = await getLeadClientN8nSettings(clientId);
  } catch (err) {
    console.error("[audioLibrary/access] falha ao ler settings do tenant; acesso negado por segurança", {
      clientId,
      erro: err?.message || String(err),
    });
    return deny(503, "AUDIO_SETTINGS_UNAVAILABLE");
  }

  // Sem linha de settings não dá para derivar plano nenhum: negar com o motivo
  // certo, em vez de cair no plano padrão e liberar por omissão.
  if (!settings) return deny(403, "AUDIO_TENANT_NOT_CONFIGURED");
  if (!tenantHasAgentPage(settings)) return deny(403, "AUDIO_MODULE_NOT_CONTRACTED");
  return allow();
}
