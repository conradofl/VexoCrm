// Ordem e prazos do desligamento gracioso (SIGTERM), 21/11/2026.
//
// Orçamento: tudo cabe nos 10 s que o código (SHUTDOWN_FORCE_MS) e o Docker/Swarm já assumem, com folga de 2 s.
//   1. liga a flag de desligamento: o motor não reivindica lead novo nem começa passo novo, as pausas acordam e o
//      /health responde "desligando" (o HTTP continua aberto para isso);
//   2. para os agendadores;
//   3. EM PARALELO, até PRAZO_ESPERA_ENVIO_MS (5 s): espera o passo em voo terminar e ser registrado, e drena o agente;
//   4. fecha o HTTP, até PRAZO_HTTP_MS (1,5 s) para requisições em voo;
//   5. só então fecha a infraestrutura (workers, filas, Redis, pool Postgres).
// O pool fecha DEPOIS que o laço do lote parou (ou o prazo estourou). Antes, o laço seguia com o pool fechado.
// Pior caso: 5 + 1,5 + ~1 = ~7,5 s; folga de 2,5 s até os 10 s.

export const PRAZO_ESPERA_ENVIO_MS = 5000;
export const PRAZO_HTTP_MS = 1500;

export async function executarDesligamento({
  iniciar,
  pararAgendadores,
  aguardarEnvios,
  drenarAgente,
  fecharHttp,
  fecharInfra,
  prazoEsperaMs = PRAZO_ESPERA_ENVIO_MS,
  prazoHttpMs = PRAZO_HTTP_MS,
  agora = Date.now,
  log = console.log,
} = {}) {
  const inicio = agora();
  const etapas = {};
  const marcar = (nome, desde) => {
    etapas[nome] = agora() - desde;
  };

  iniciar();

  let t = agora();
  try {
    await pararAgendadores();
  } catch (err) {
    log("[shutdown] falha ao parar agendadores:", err?.message || err);
  }
  marcar("agendadores", t);

  t = agora();
  const [envios, agente] = await Promise.allSettled([aguardarEnvios(prazoEsperaMs), drenarAgente(prazoEsperaMs)]);
  marcar("espera", t);
  const enviosPararam = envios.status === "fulfilled" && envios.value === true;
  const agenteTerminou = agente.status === "fulfilled" ? agente.value : null;
  log(`[shutdown] envio em andamento ${enviosPararam ? "parou no fim do passo" : "NÃO parou no prazo (a conferência do boot trata)"}; espera ${etapas.espera}ms.`);

  t = agora();
  try {
    await fecharHttp(prazoHttpMs);
  } catch (err) {
    log("[shutdown] falha ao fechar o HTTP:", err?.message || err);
  }
  marcar("http", t);

  t = agora();
  try {
    await fecharInfra();
  } catch (err) {
    log("[shutdown] falha ao fechar a infraestrutura:", err?.message || err);
  }
  marcar("infra", t);

  return { enviosPararam, agenteTerminou, ms: agora() - inicio, etapas };
}
