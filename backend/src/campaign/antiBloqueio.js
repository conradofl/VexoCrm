// Antibloqueio de chip (27/11/2026, decisão do Conrado).
//
// Em 26/11 conferir 640 números em 19 min (onWhatsApp) derrubou o chip 9175-1267; conferências parecidas já tinham
// derrubado mais dois chips. Para o WhatsApp, perguntar em massa se números existem parece varredura. Por isso o Vexo
// NÃO pergunta mais ao WhatsApp se um número existe (nem em massa, nem antes do lote). No lugar:
//   1. limpeza sem consulta: formato brasileiro, DDD que existe, celular, sem fixo, sem "5500" inventado, sem repetido
//      e sem número que já deu "não existe" no nosso próprio registro (whatsapp_number_validations, lido do banco);
//   2. freio por lote: se a lista se mostrar ruim durante o envio, o lote pausa sozinho e avisa o Conrado;
//   3. chip restrito (401/403 ou conta restrita) pausa na hora, sem nova tentativa.
// Todos os valores ajustáveis ficam AQUI, num lugar só.

export const ANTIBLOQUEIO = Object.freeze({
  freio: Object.freeze({
    // Janela móvel: os últimos N leads que chegaram à Evolution neste lote.
    janela: 20,
    // Fração de "número inexistente" na janela que pausa o lote (0.25 = 25% ou mais).
    taxaInexistente: 0.25,
    // A taxa só vale com a janela cheia (3 de 4 no começo não é amostra). Baixar para ver lista ruim mais cedo.
    amostraMinima: 20,
    // Falhas seguidas (qualquer motivo vindo da Evolution) que pausam o lote.
    falhasSeguidas: 5,
  }),
  limpeza: Object.freeze({
    // Número que a Evolution já recusou como inexistente fica fora por este tempo (lido do banco, sem consultar o WhatsApp).
    inexistenteValidadeDias: 90,
  }),
});

// DDDs brasileiros em uso (Anatel).
export const DDDS_VALIDOS = new Set([
  "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "21", "22", "24", "27", "28",
  "31", "32", "33", "34", "35", "37", "38",
  "41", "42", "43", "44", "45", "46", "47", "48", "49",
  "51", "53", "54", "55",
  "61", "62", "63", "64", "65", "66", "67", "68", "69",
  "71", "73", "74", "75", "77", "79",
  "81", "82", "83", "84", "85", "86", "87", "88", "89",
  "91", "92", "93", "94", "95", "96", "97", "98", "99",
]);

export const MOTIVO_LIMPEZA = Object.freeze({
  sem_telefone: "sem telefone",
  inventado_5500: "número inventado (5500)",
  formato_invalido: "formato de telefone inválido",
  ddd_inexistente: "DDD que não existe",
  fixo: "telefone fixo",
  repetido: "telefone repetido no lote",
  inexistente_conhecido: "número que já deu \"não existe no WhatsApp\"",
});

export const PREFIXO_LIMPEZA = "Limpeza antes do envio";

/** Dígitos sem o 55 do Brasil quando ele está lá (5534999990000 e 34999990000 são o mesmo número). */
export function chaveDoTelefone(raw) {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.startsWith("55") && (d.length === 12 || d.length === 13) ? d.slice(2) : d;
}

/**
 * Confere o telefone só pelo formato, sem perguntar nada ao WhatsApp.
 * @returns {{ ok: true } | { ok: false, motivo: keyof MOTIVO_LIMPEZA }}
 */
export function limparTelefone(raw) {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return { ok: false, motivo: "sem_telefone" };
  if (d.startsWith("5500")) return { ok: false, motivo: "inventado_5500" };
  const local = chaveDoTelefone(d);
  if (local.length !== 10 && local.length !== 11) return { ok: false, motivo: "formato_invalido" };
  if (!DDDS_VALIDOS.has(local.slice(0, 2))) return { ok: false, motivo: "ddd_inexistente" };
  const primeiro = local[2];
  if (local.length === 11) return primeiro === "9" ? { ok: true } : { ok: false, motivo: "formato_invalido" };
  // 10 dígitos: celular no formato antigo (sem o 9 na frente, comum em número tirado do WhatsApp) ou fixo.
  if ("6789".includes(primeiro)) return { ok: true };
  if ("2345".includes(primeiro)) return { ok: false, motivo: "fixo" };
  return { ok: false, motivo: "formato_invalido" };
}

export function textoDaLimpeza(motivo) {
  return `${PREFIXO_LIMPEZA}: ${MOTIVO_LIMPEZA[motivo] || motivo}`;
}

/**
 * Limpeza do lote inteiro antes de enviar. `inexistentes`: chaves (chaveDoTelefone) que já deram "não existe".
 * @returns {{ aptos: object[], descartados: { lead: object, motivo: string, texto: string }[] }}
 */
export function limparLeadsDoLote(leads = [], { inexistentes = new Set(), telefoneDe = (l) => l?.telefone || l?.phone } = {}) {
  const aptos = [];
  const descartados = [];
  const vistos = new Set();
  for (const lead of leads || []) {
    const raw = telefoneDe(lead);
    const r = limparTelefone(raw);
    let motivo = r.ok ? null : r.motivo;
    const chave = chaveDoTelefone(raw);
    if (!motivo && inexistentes.has(chave)) motivo = "inexistente_conhecido";
    if (!motivo && vistos.has(chave)) motivo = "repetido";
    if (motivo) {
      descartados.push({ lead, motivo, texto: textoDaLimpeza(motivo) });
      continue;
    }
    vistos.add(chave);
    aptos.push(lead);
  }
  return { aptos, descartados };
}

/**
 * Lê do NOSSO banco quais destes telefones já deram "não existe no WhatsApp" (gravado quando a Evolution recusou um
 * envio). Não consulta o WhatsApp. Erro de leitura é registrado e devolve conjunto vazio: o freio do lote continua de pé.
 */
export async function carregarInexistentesConhecidos(pool, telefones = [], { dias = ANTIBLOQUEIO.limpeza.inexistenteValidadeDias } = {}) {
  const chaves = [...new Set((telefones || []).map(chaveDoTelefone).filter(Boolean))];
  if (!pool || chaves.length === 0) return new Set();
  const variantes = chaves.flatMap((c) => [c, `55${c}`]);
  try {
    const { rows } = await pool.query(
      `SELECT phone FROM public.whatsapp_number_validations
        WHERE phone = ANY($1::text[]) AND exists_whatsapp = false AND validated_at >= now() - make_interval(days => $2)`,
      [variantes, dias]
    );
    return new Set((rows || []).map((r) => chaveDoTelefone(r.phone)));
  } catch (err) {
    console.error("[antibloqueio] não consegui ler os números já inexistentes; a limpeza segue só pelo formato:", err?.message || err);
    return new Set();
  }
}

const RE_INEXISTENTE = /"exists"\s*:\s*false|não existe no whatsapp|number does not exist|not on whatsapp/i;
const RE_CONTA_RESTRITA = /\b(restricted|banned|account (is )?(locked|blocked|suspended))\b|conta (restrita|banida|bloqueada|suspensa)/i;

/**
 * Classifica a falha de um envio à Evolution.
 * @returns {"chip_restrito" | "inexistente" | "outra"}
 */
export function classificarFalhaDeEnvio(err) {
  if (!err || err.code === "OUTBOUND_GUARD_BLOCKED") return "outra";
  const status = Number.isInteger(err.statusCode) ? err.statusCode : null;
  const texto = String(err.message || "");
  if (err.isUnauthorized || status === 401 || status === 403 || RE_CONTA_RESTRITA.test(texto)) return "chip_restrito";
  if (RE_INEXISTENTE.test(texto)) return "inexistente";
  return "outra";
}

export const TEXTO_INEXISTENTE_NO_ENVIO = "Número não existe no WhatsApp (recusado no envio)";

/**
 * Decide se o lote deve pausar. `resultados`: em ordem, um por lead que chegou à Evolution: "ok" | "inexistente" | "falha".
 * @returns {null | { tipo: "falhas_seguidas" | "inexistentes", motivo: string }}
 */
export function avaliarFreio(resultados = [], cfg = ANTIBLOQUEIO.freio) {
  let seguidas = 0;
  for (let i = resultados.length - 1; i >= 0 && resultados[i] !== "ok"; i -= 1) seguidas += 1;
  if (seguidas >= cfg.falhasSeguidas) {
    return {
      tipo: "falhas_seguidas",
      motivo: `Pausado pelo freio — ${seguidas} envios seguidos falharam. Confira o chip e a lista antes de retomar.`,
    };
  }
  const janela = resultados.slice(-cfg.janela);
  if (janela.length >= cfg.amostraMinima) {
    const inexistentes = janela.filter((r) => r === "inexistente").length;
    if (inexistentes / janela.length >= cfg.taxaInexistente) {
      return {
        tipo: "inexistentes",
        motivo: `Pausado pelo freio — ${inexistentes} dos últimos ${janela.length} envios deram número inexistente ` +
          `(${Math.round((inexistentes / janela.length) * 100)}%). Lista suspeita: confira a planilha antes de retomar.`,
      };
    }
  }
  return null;
}

export function motivoChipRestrito(err, chipNome = null) {
  const status = Number.isInteger(err?.statusCode) ? `HTTP ${err.statusCode}` : "conta restrita";
  const chip = chipNome ? ` (${chipNome})` : "";
  return `Pausado — o chip${chip} recusou o envio (${status}: possível restrição da conta ou token inválido). Confira o chip no celular antes de retomar.`;
}

/**
 * Aviso no WhatsApp do Conrado quando o freio ou o chip restrito pausa um lote. Mesmo envio do alerta de atraso da
 * Evolution (services/inboundDelayAlert.js). Nunca lança: o lote já está pausado, o aviso é extra.
 */
export async function avisarFreioNoWhatsApp({ motivo, campanha = null, lote = null, empresa = null }, { enviar = null } = {}) {
  const texto =
    `⚠️ Vexo: lote pausado sozinho. ${motivo}` +
    `${empresa ? ` Empresa: ${empresa}.` : ""}${campanha ? ` Campanha: ${campanha}.` : ""}${lote ? ` Lote: ${lote}.` : ""}`;
  try {
    const fn = enviar || (process.env.NODE_ENV === "test" ? null : (await import("../services/inboundDelayAlert.js")).enviarAvisoWhatsApp);
    if (!fn) return false;
    await fn({ texto });
    return true;
  } catch (err) {
    console.error("[antibloqueio] lote pausado, mas o aviso no WhatsApp não saiu:", String(err?.message || err).slice(0, 160));
    return false;
  }
}
