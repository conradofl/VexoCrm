// Quem pode abrir o Gestor de Tráfego. Uma função só, usada pelo gate das rotas
// E pela tela (GET /api/traffic/access), como em audioLibrary/access.js.
//
// Duas perguntas:
//   - o USUÁRIO tem a página "trafego"? (admin e superadmin passam);
//   - a EMPRESA está no piloto? A Fase 1 roda só no piloto (decisão do dono:
//     "erro fica dentro de casa"). A lista vem de TRAFFIC_PILOT_TENANTS e, sem
//     a variável, é só a Geração Digital. Vale para todo mundo, admin inclusive:
//     abrir para outra empresa é decisão de ambiente, não de quem está logado.

export const TRAFFIC_PAGE = "trafego";
export const TRAFFIC_PILOT_ENV = "TRAFFIC_PILOT_TENANTS";
export const DEFAULT_TRAFFIC_PILOT_TENANTS = ["geracao-digital"];

export const TRAFFIC_ACCESS_MESSAGES = {
  TRAFFIC_SETTINGS_UNAVAILABLE: "Instabilidade temporária ao verificar o acesso. Tente novamente em instantes.",
  TRAFFIC_ROLE_NOT_ALLOWED: "O Gestor de Tráfego é restrito à equipe interna.",
  TRAFFIC_USER_NOT_ALLOWED: "Seu usuário não tem acesso ao Gestor de Tráfego. Fale com o administrador.",
  TRAFFIC_TENANT_NOT_IN_PILOT: "O Gestor de Tráfego ainda não está disponível para esta empresa.",
};

function allow() {
  return { allowed: true, status: 200, reason: null, message: null };
}

function deny(status, reason) {
  return { allowed: false, status, reason, message: TRAFFIC_ACCESS_MESSAGES[reason] };
}

export function getTrafficPilotTenants(env = process.env) {
  const raw = String(env?.[TRAFFIC_PILOT_ENV] || "").trim();
  if (!raw) return [...DEFAULT_TRAFFIC_PILOT_TENANTS];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Passos que só dependem do usuário. */
export function evaluateTrafficUser(access) {
  if (access?.error === "TENANT_SETTINGS_READ_FAILED") return deny(503, "TRAFFIC_SETTINGS_UNAVAILABLE");
  if (access?.isAdmin || access?.role === "superadmin") return allow();
  if (access?.role !== "internal") return deny(403, "TRAFFIC_ROLE_NOT_ALLOWED");

  const pages = Array.isArray(access.internalPages) ? access.internalPages : [];
  if (!pages.includes(TRAFFIC_PAGE)) return deny(403, "TRAFFIC_USER_NOT_ALLOWED");
  return allow();
}

/** Veredito completo: usuário e empresa. */
export function evaluateTrafficAccess(access, clientId, env = process.env) {
  const user = evaluateTrafficUser(access);
  if (!user.allowed) return user;
  if (!clientId || !getTrafficPilotTenants(env).includes(clientId)) return deny(403, "TRAFFIC_TENANT_NOT_IN_PILOT");
  return allow();
}
