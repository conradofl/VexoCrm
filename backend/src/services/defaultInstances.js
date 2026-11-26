// Chips (instâncias da Evolution) usados como PADRÃO quando o cadastro não diz qual — num lugar só (untangle, 26/11/2026).
//
// Antes estes nomes estavam escritos em ~40 pontos (secretária, GD, jurídico, espelho do Slack, lembretes de briefing). São
// DOIS chips de verdade, de donos diferentes, mais fallbacks de quando falta a variável de ambiente:
//   - INSTANCIA_PADRAO_VEXO_ADM: chip da secretária (Wandinha) / diretoria da Vexo;
//   - INSTANCIA_PADRAO_GD_COMERCIAL: chip comercial da Geração Digital (último recurso quando o cadastro não indica chip);
//   - INSTANCIA_TESTE_GD: chip de teste da GD (reconhecido no webhook e como candidato de contingência da secretária);
//   - instanciaGdDoEnv(fallback): GD_EVOLUTION_INSTANCE (configurada em produção) ou o fallback de cada fluxo, que só vale
//     sem a variável (dev): INSTANCIA_GD_SEM_ENV para o espelho do Slack e INSTANCIA_JURIDICO_SEM_ENV para jurídico/GD.
// Movimento puro: os mesmos valores de antes em cada ponto. Trocar um chip padrão passa a ser mudar UMA linha aqui.
// O /health (evolutionConfig.instanciasPadrao) diz se cada um está cadastrado.

export const INSTANCIA_PADRAO_VEXO_ADM = "vexo-adm-vexo-atende";
export const INSTANCIA_PADRAO_GD_COMERCIAL = "geracao-digital-comercial-hostery";
export const INSTANCIA_TESTE_GD = "geracao-digital-teste-vexo";
export const INSTANCIA_GD_SEM_ENV = "gd-oficial";
export const INSTANCIA_JURIDICO_SEM_ENV = "Teste";

/** GD_EVOLUTION_INSTANCE quando definida; senão o fallback do fluxo. */
export function instanciaGdDoEnv(fallback) {
  return process.env.GD_EVOLUTION_INSTANCE || fallback;
}

export const INSTANCIAS_PADRAO_DO_CODIGO = [
  INSTANCIA_PADRAO_VEXO_ADM,
  INSTANCIA_PADRAO_GD_COMERCIAL,
  INSTANCIA_TESTE_GD,
  INSTANCIA_GD_SEM_ENV,
  INSTANCIA_JURIDICO_SEM_ENV,
];
