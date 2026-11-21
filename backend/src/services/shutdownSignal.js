// Sinal de desligamento do processo (21/11/2026).
//
// Todo push no main reinicia o bk-vexo. Até aqui o SIGTERM fechava o pool Postgres com o laço do lote ainda rodando:
// o processo morria no meio de um lead, às vezes entre a chamada à Evolution e o registro do envio.
// Agora, no SIGTERM:
// - estaDesligando() vira true: o motor de envio não reivindica lead novo nem começa passo novo, e o /health responde
//   "desligando";
// - as pausas entre passos e entre leads (dormirInterrompivel) acordam na hora;
// - aguardarEnviosPararem() espera, com prazo, o passo que está em voo terminar e ser registrado. Só depois o pool fecha.
// Nada aqui cria estado novo no banco: o lote que não terminou fica como o boot já trata (orphanRecovery.js e a
// conferência dos claimed).

let desligando = false;
let ativos = 0;
const acordadores = new Set();
const esperas = new Set();

export function estaDesligando() {
  return desligando;
}

/** Liga a flag e acorda todas as pausas em curso. Idempotente. */
export function iniciarDesligamento() {
  if (desligando) return;
  desligando = true;
  for (const acordar of [...acordadores]) acordar();
  acordadores.clear();
}

/**
 * Pausa que acaba na hora se o desligamento começar. Devolve true se dormiu o tempo todo, false se foi acordada (ou se
 * o desligamento já tinha começado).
 */
export function dormirInterrompivel(ms) {
  if (desligando) return Promise.resolve(false);
  const espera = Math.max(0, Number(ms) || 0);
  return new Promise((resolve) => {
    const acordar = () => {
      clearTimeout(timer);
      acordadores.delete(acordar);
      resolve(false);
    };
    const timer = setTimeout(() => {
      acordadores.delete(acordar);
      resolve(true);
    }, espera);
    acordadores.add(acordar);
  });
}

/** Roda fn contando como "envio em andamento" até terminar (com sucesso ou erro). */
export async function comEnvioRegistrado(fn) {
  ativos += 1;
  try {
    return await fn();
  } finally {
    ativos -= 1;
    if (ativos === 0) for (const fim of [...esperas]) fim();
  }
}

export function enviosEmAndamento() {
  return ativos;
}

/** Espera os envios em andamento pararem. true = pararam; false = estourou o prazo. */
export function aguardarEnviosPararem(prazoMs) {
  if (ativos === 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const fim = () => {
      clearTimeout(timer);
      esperas.delete(fim);
      resolve(true);
    };
    const timer = setTimeout(() => {
      esperas.delete(fim);
      resolve(false);
    }, Math.max(0, Number(prazoMs) || 0));
    esperas.add(fim);
  });
}

/** Só para teste. */
export function _resetDesligamentoParaTeste() {
  desligando = false;
  ativos = 0;
  acordadores.clear();
  esperas.clear();
}
