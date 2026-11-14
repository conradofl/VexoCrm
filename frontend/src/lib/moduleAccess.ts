// UMA pergunta, UMA resposta: "este tenant pode usar este módulo?"
//
// Antes havia duas implementações da mesma regra. AppSidebar tinha a sua
// (isSidebarItemModularlyLocked: lista própria de páginas universais, mais um
// curto-circuito em planTier !== "modular") e cada tela tinha a sua, chamando
// hasFeatureUnlocked com uma chave escolhida na hora. Deram respostas opostas
// para o mesmo tenant: no print do Sonhare o menu mostrava "Chips WhatsApp" sem
// cadeado e a tela mostrava bloqueio — porque o menu perguntava pela chave da
// PÁGINA ("chips-whatsapp", liberada no Essencial) e a tela perguntava pela
// chave do MÓDULO PAGO ("multiplos_chips", negada no Essencial).
//
// Menu, rota e tela agora chamam esta função. Se as três não chamarem o mesmo
// código, o problema volta.

import { hasFeatureUnlocked } from "@/lib/planTier";
import { canUseChipsPage, type ChipLimits } from "@/lib/chipLimit";

// Ferramentas que todo tenant enxerga sem contratar nada.
// banco-de-dados NÃO está aqui: virou módulo vendável avulso.
export const UNIVERSAL_SIDEBAR_KEYS = new Set([
  "dashboard",
  "leads",
  "conversas",
  "whatsapp",
  "admin",
  "onboarding",
  "equipe-usuarios",
  "goclaw-gd",
  "colaboradores-gd",
]);

// Chaves da sidebar que falam de chip de WhatsApp. Para elas a pergunta não é
// "tem o módulo?" e sim "tem direito a pelo menos 1 chip?" — o módulo vende chip
// A MAIS, não vende a tela.
const CHAVES_DE_CHIP = new Set(["chips-whatsapp", "conexoes", "aquecimento", "multiplos_chips"]);

/**
 * O tenant pode usar este módulo/tela?
 *
 * `chave` aceita tanto a chave da sidebar (item.key) quanto a da página
 * (item.page) — as duas resolvem para a mesma resposta, que era exatamente o que
 * não acontecia antes.
 */
export function canUseModule(
  client: any,
  chave: string,
  chipLimits?: Partial<ChipLimits> | null
): boolean {
  // Sem tenant selecionado nada é bloqueado: quem recusa de verdade é o backend.
  if (!client) return true;
  if (!chave) return true;

  if (UNIVERSAL_SIDEBAR_KEYS.has(chave)) return true;

  if (CHAVES_DE_CHIP.has(chave)) return canUseChipsPage(client, chipLimits);

  return hasFeatureUnlocked(client, chave);
}

/** Inverso, para quem desenha cadeado. */
export function isModuleLocked(
  client: any,
  chave: string,
  chipLimits?: Partial<ChipLimits> | null
): boolean {
  return !canUseModule(client, chave, chipLimits);
}
