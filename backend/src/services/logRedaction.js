// Máscara de segredos no log (18/11/2026: token do webhook e apikey da Evolution apareceram em log colado em chat).
//
// Duas camadas:
//   1. mascararSegredos(texto): troca por "***" os valores das variáveis secretas do ambiente e qualquer valor depois de
//      ?token= / &apikey= na URL ou de apikey / x-vexo-webhook-token / authorization em cabeçalho, objeto ou JSON.
//   2. instalarMascaraDeLog(): embrulha console.log/info/warn/error/debug para passar toda linha pela máscara. O servidor
//      instala no boot (server.js). A linha sai igual à do console original (mesmo util.format), só com os segredos
//      trocados.
import { format } from "node:util";

// Variáveis cujo VALOR nunca pode aparecer no log.
export const VARIAVEIS_SECRETAS = [
  "EVOLUTION_API_KEY",
  "EVOLUTION_GLOBAL_KEY",
  "GD_EVOLUTION_TOKEN",
  "GD_EVOLUTION_API_TOKEN",
  "EVOLUTION_WEBHOOK_TOKEN",
  "EVOLUTION_WEBHOOK_TOKEN_ANTERIOR",
];

const MASCARA = "***";
// Valor curto demais vira falso positivo (trocaria pedaços de texto comum). Os segredos reais têm 20+ caracteres.
const TAMANHO_MINIMO = 8;

// ?token=<valor>  &apikey=<valor>  (URL, inclusive dentro de texto)
const NA_URL = /([?&](?:token|apikey|api_key|access_token)=)[^&\s"'`<>]+/gi;
// apikey: 'x'   "apikey":"x"   apikey=x   x-vexo-webhook-token: x   authorization: Bearer x
const EM_CHAVE =
  /((?:^|[^\w-])["']?(?:apikey|api_key|x-vexo-webhook-token|authorization)["']?\s*[:=]\s*["']?)(?:bearer\s+)?[^"'\s,;}\])&]+/gi;

function escaparRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function segredosDoAmbiente(env = process.env) {
  const out = [];
  for (const n of VARIAVEIS_SECRETAS) {
    const v = String(env[n] ?? "").trim();
    if (v.length >= TAMANHO_MINIMO) out.push(v);
  }
  // Maior primeiro: um segredo que contém outro é trocado inteiro.
  return [...new Set(out)].sort((a, b) => b.length - a.length);
}

export function mascararSegredos(texto, { env = process.env, extras = [] } = {}) {
  let s = String(texto ?? "");
  const literais = [...segredosDoAmbiente(env), ...extras.map((x) => String(x ?? "").trim()).filter((x) => x.length >= TAMANHO_MINIMO)];
  for (const v of literais) {
    if (s.includes(v)) s = s.replace(new RegExp(escaparRegex(v), "g"), MASCARA);
  }
  s = s.replace(NA_URL, `$1${MASCARA}`);
  s = s.replace(EM_CHAVE, `$1${MASCARA}`);
  return s;
}

const METODOS = ["log", "info", "warn", "error", "debug"];

/** Embrulha o console. Devolve a função que desfaz (para teste). Instalar duas vezes não embrulha de novo. */
export function instalarMascaraDeLog({ alvo = console, env = process.env } = {}) {
  if (alvo.__vexoMascaraDeLog) return alvo.__vexoMascaraDeLog;
  const originais = {};
  for (const m of METODOS) {
    if (typeof alvo[m] !== "function") continue;
    originais[m] = alvo[m];
    alvo[m] = function (...args) {
      if (args.length === 0) return originais[m].call(alvo);
      let linha;
      try {
        linha = mascararSegredos(format(...args), { env });
      } catch {
        linha = "[log] linha descartada: falha ao mascarar";
      }
      return originais[m].call(alvo, linha);
    };
  }
  const desfazer = () => {
    for (const m of Object.keys(originais)) alvo[m] = originais[m];
    delete alvo.__vexoMascaraDeLog;
  };
  alvo.__vexoMascaraDeLog = desfazer;
  return desfazer;
}
