/**
 * onboardingNaming.js
 * 
 * Fonte ÚNICA da verdade para padronização de nomenclatura de canais de Onboarding
 * na Geração Digital & Vexo OS.
 * 
 * Regras Operacionais:
 * - WhatsApp: "MÁQUINA DE VENDAS: {EMPRESA EM MAIÚSCULAS}"
 *   - Limite do protocolo WhatsApp / Baileys / Evolution API: 100 caracteres.
 *   - Se ultrapassar 100 caracteres, o corte ocorre ESTRITAMENTE no nome da empresa,
 *     NUNCA no prefixo ("MÁQUINA DE VENDAS: "), com emissão de log de advertência.
 * - Slack: "02-cli-{slug}"
 *   - O slug é gerado a partir do nome da empresa em minúsculas, sem acentos, com
 *     espaços e caracteres especiais convertidos para hífen simples.
 *   - Se a entrada contiver o prefixo da máquina de vendas (ex.: "Máquina de Vendas: Café Eiro"),
 *     ele é removido para que o canal fique "02-cli-cafe-eiro".
 *   - Limite da API do Slack: 80 caracteres (o prefixo "02-cli-" permanece intacto).
 */

export const WHATSAPP_GROUP_PREFIX = "MÁQUINA DE VENDAS: ";
export const SLACK_CHANNEL_PREFIX = "02-cli-";

// Limite real do protocolo WhatsApp / Baileys / Evolution API v2 (100 caracteres)
export const WHATSAPP_GROUP_MAX_LENGTH = 100;

// Limite oficial da API conversations.create do Slack (80 caracteres)
export const SLACK_CHANNEL_MAX_LENGTH = 80;

/**
 * Normaliza o nome da empresa recebido da entrada.
 * Remove prefixos redundantes caso a entrada já venha rotulada
 * (ex: "Máquina de Vendas: Café Eiro" ou "GD & Café Eiro").
 */
export function normalizeCompanyName(rawName) {
  if (!rawName || typeof rawName !== "string") {
    return "";
  }
  let cleaned = rawName.trim();
  // Remove prefixos conhecidos para isolar o nome da empresa
  cleaned = cleaned.replace(/^m[aáàãâ]quina\s+de\s+vendas\s*:\s*/i, "").trim();
  cleaned = cleaned.replace(/^gd\s*(&|-)\s*/i, "").trim();
  return cleaned;
}

/**
 * Converte o nome da empresa em slug padronizado para canal do Slack:
 * - minúsculas
 * - sem acentos (NFD)
 * - espaços e pontuações viram hífen único
 * - sem hífens nas extremidades
 */
export function generateSlackSlug(rawName) {
  const company = normalizeCompanyName(rawName);
  const base = (company || "cliente")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^a-z0-9]/g, "-")       // caracteres não-alfanuméricos viram hífen
    .replace(/-+/g, "-")             // agrupa hífens repetidos
    .replace(/^-+|-+$/g, "");        // apara hífens no início e fim

  return base || "cliente";
}

/**
 * Função única que recebe o nome da empresa e devolve os nomes padronizados
 * para WhatsApp e Slack.
 * 
 * @param {string} rawName - Nome da empresa / cliente (ex: "Café Eiro" ou "Máquina de Vendas: Café Eiro")
 * @param {object} [options] - Opções adicionais
 * @param {object} [options.logger=console] - Objeto de log para emitir alertas de corte
 * @returns {{ whatsappGroupName: string, slackChannelName: string, slug: string, companyName: string }}
 */
export function buildOnboardingNames(rawName, { logger = console } = {}) {
  const company = normalizeCompanyName(rawName);
  const baseUpper = (company || "CLIENTE").toUpperCase();

  // 1. WhatsApp: "MÁQUINA DE VENDAS: {EMPRESA EM MAIÚSCULAS}"
  const maxCompanyLen = WHATSAPP_GROUP_MAX_LENGTH - WHATSAPP_GROUP_PREFIX.length; // 100 - 19 = 81
  let finalCompanyUpper = baseUpper;

  if (WHATSAPP_GROUP_PREFIX.length + finalCompanyUpper.length > WHATSAPP_GROUP_MAX_LENGTH) {
    const originalUpper = finalCompanyUpper;
    finalCompanyUpper = finalCompanyUpper.slice(0, maxCompanyLen).trim();
    if (logger && typeof logger.warn === "function") {
      logger.warn(
        `[onboarding-naming] Nome do grupo WhatsApp ultrapassou ${WHATSAPP_GROUP_MAX_LENGTH} caracteres. Nome da empresa cortado de "${originalUpper}" para "${finalCompanyUpper}". Prefixo "${WHATSAPP_GROUP_PREFIX}" mantido intacto.`
      );
    }
  }

  const whatsappGroupName = `${WHATSAPP_GROUP_PREFIX}${finalCompanyUpper}`;

  // 2. Slack: "02-cli-{slug}"
  let slug = generateSlackSlug(rawName);
  const maxSlugLen = SLACK_CHANNEL_MAX_LENGTH - SLACK_CHANNEL_PREFIX.length; // 80 - 7 = 73

  if (slug.length > maxSlugLen) {
    const originalSlug = slug;
    slug = slug.slice(0, maxSlugLen).replace(/-+$/, "");
    if (logger && typeof logger.warn === "function") {
      logger.warn(
        `[onboarding-naming] Slug do canal Slack ultrapassou ${maxSlugLen} caracteres. Slug cortado de "${originalSlug}" para "${slug}". Prefixo "${SLACK_CHANNEL_PREFIX}" mantido intacto.`
      );
    }
  }

  const slackChannelName = `${SLACK_CHANNEL_PREFIX}${slug}`;

  return {
    whatsappGroupName,
    slackChannelName,
    slug,
    companyName: company || "Cliente",
  };
}

/**
 * Higieniza o assunto do grupo de WhatsApp garantindo o teto do protocolo (100 caracteres).
 * Se o assunto começar com o prefixo oficial, corta somente a parte da empresa, mantendo
 * o prefixo intacto e registrando aviso em log.
 * 
 * Substitui o antigo substring(0, 25).
 * 
 * @param {string} subject - Assunto recebido
 * @param {object} [options] - Opções de log
 * @returns {string} Assunto com no máximo 100 caracteres e prefixo preservado
 */
export function sanitizeWhatsAppGroupSubject(subject, { logger = console } = {}) {
  if (!subject || typeof subject !== "string") {
    return `${WHATSAPP_GROUP_PREFIX}CLIENTE`;
  }

  const trimmed = subject.trim();
  if (trimmed.length <= WHATSAPP_GROUP_MAX_LENGTH) {
    return trimmed;
  }

  if (trimmed.startsWith(WHATSAPP_GROUP_PREFIX)) {
    const companyPart = trimmed.slice(WHATSAPP_GROUP_PREFIX.length);
    const maxCompanyLen = WHATSAPP_GROUP_MAX_LENGTH - WHATSAPP_GROUP_PREFIX.length;
    const truncatedCompany = companyPart.slice(0, maxCompanyLen).trim();
    if (logger && typeof logger.warn === "function") {
      logger.warn(
        `[onboarding-naming] Assunto do grupo WhatsApp cortado de ${trimmed.length} para ${WHATSAPP_GROUP_MAX_LENGTH} caracteres. Prefixo mantido intacto: "${WHATSAPP_GROUP_PREFIX}${truncatedCompany}".`
      );
    }
    return `${WHATSAPP_GROUP_PREFIX}${truncatedCompany}`;
  }

  const truncated = trimmed.slice(0, WHATSAPP_GROUP_MAX_LENGTH).trim();
  if (logger && typeof logger.warn === "function") {
    logger.warn(
      `[onboarding-naming] Assunto do grupo WhatsApp cortado de ${trimmed.length} para ${WHATSAPP_GROUP_MAX_LENGTH} caracteres: "${truncated}".`
    );
  }
  return truncated;
}
