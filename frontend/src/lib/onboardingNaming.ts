/**
 * onboardingNaming.ts
 * 
 * Fonte ÚNICA de padronização de nomenclatura de canais de Onboarding
 * (WhatsApp e Slack) no Frontend do Vexo OS.
 */

export const WHATSAPP_GROUP_PREFIX = "MÁQUINA DE VENDAS: ";
export const SLACK_CHANNEL_PREFIX = "02-cli-";
export const WHATSAPP_GROUP_MAX_LENGTH = 100;
export const SLACK_CHANNEL_MAX_LENGTH = 80;

export function normalizeCompanyName(rawName?: string | null): string {
  if (!rawName || typeof rawName !== "string") {
    return "";
  }
  let cleaned = rawName.trim();
  cleaned = cleaned.replace(/^m[aáàãâ]quina\s+de\s+vendas\s*:\s*/i, "").trim();
  cleaned = cleaned.replace(/^gd\s*(&|-)\s*/i, "").trim();
  return cleaned;
}

export function generateSlackSlug(rawName?: string | null): string {
  const company = normalizeCompanyName(rawName);
  const base = (company || "cliente")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return base || "cliente";
}

export function buildOnboardingNames(rawName?: string | null): {
  whatsappGroupName: string;
  slackChannelName: string;
  slug: string;
  companyName: string;
} {
  const company = normalizeCompanyName(rawName);
  const baseUpper = (company || "CLIENTE").toUpperCase();

  const maxCompanyLen = WHATSAPP_GROUP_MAX_LENGTH - WHATSAPP_GROUP_PREFIX.length;
  let finalCompanyUpper = baseUpper;
  if (WHATSAPP_GROUP_PREFIX.length + finalCompanyUpper.length > WHATSAPP_GROUP_MAX_LENGTH) {
    finalCompanyUpper = finalCompanyUpper.slice(0, maxCompanyLen).trim();
  }
  const whatsappGroupName = `${WHATSAPP_GROUP_PREFIX}${finalCompanyUpper}`;

  let slug = generateSlackSlug(rawName);
  const maxSlugLen = SLACK_CHANNEL_MAX_LENGTH - SLACK_CHANNEL_PREFIX.length;
  if (slug.length > maxSlugLen) {
    slug = slug.slice(0, maxSlugLen).replace(/-+$/, "");
  }
  const slackChannelName = `${SLACK_CHANNEL_PREFIX}${slug}`;

  return {
    whatsappGroupName,
    slackChannelName,
    slug,
    companyName: company || "Cliente",
  };
}
