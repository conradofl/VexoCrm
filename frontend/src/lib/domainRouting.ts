// frontend/src/lib/domainRouting.ts
//
// Segregação de domínio para roteamento institucional vs. aplicação CRM (Item 13)

/**
 * Identifica se a execução atual está rodando sob o subdomínio do CRM.
 * Cobre crm.vexoia.com, subdomínios de preview/staging do CRM (ex: crm-*.vercel.app)
 * e parâmetros explícitos de teste/override (?app=crm ou ?mode=crm).
 */
export function isCrmDomain(hostname?: string, search?: string): boolean {
  if (typeof window === "undefined" && !hostname) return false;

  const host = (hostname || (typeof window !== "undefined" ? window.location.hostname : "") || "").toLowerCase();
  const query = search !== undefined ? search : (typeof window !== "undefined" ? window.location.search : "");

  if (query.includes("app=crm") || query.includes("mode=crm")) {
    return true;
  }

  return (
    host.startsWith("crm.") ||
    host.startsWith("app.") ||
    host.includes("crm-") ||
    host.includes("-crm")
  );
}

/**
 * Retorna o destino correto para o botão de Login do CRM na Landing Page:
 * - Em produção sob vexoia.com (institucional) -> https://crm.vexoia.com/login
 * - Em desenvolvimento local/testes -> /login
 */
export function getCrmLoginUrl(hostname?: string): string {
  const host = (hostname || (typeof window !== "undefined" ? window.location.hostname : "") || "").toLowerCase();

  if (host.includes("vexoia.com") && !host.startsWith("crm.")) {
    return "https://crm.vexoia.com/login";
  }

  return "/login";
}
