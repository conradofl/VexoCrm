// Processo filho dos testes de desligamento (desligamentoEsperaPasso.test.js). Roda o motor de campanha REAL e o
// coordenador REAL de desligamento; recebe SIGTERM de verdade do processo pai. Dublê só no HTTP da Evolution.
// Uso: node desligamentoFilho.mjs <cenario>   (cenario: em_voo | estoura | sem_lote)
// Escreve uma linha JSON por evento no stdout.
import { dispatchCampaignSequence } from "../../campaign-outbound.js";
import { executarDesligamento } from "../../services/shutdownCoordinator.js";
import { aguardarEnviosPararem, iniciarDesligamento } from "../../services/shutdownSignal.js";

const cenario = process.argv[2] || "em_voo";
const evento = (tipo, dados = {}) => process.stdout.write(`${JSON.stringify({ tipo, t: Date.now(), ...dados })}\n`);
const atrasoEvolutionMs = cenario === "estoura" ? 60_000 : 400;
const prazoEsperaMs = cenario === "estoura" ? 300 : 5000;

globalThis.fetch = async (url, init) => {
  if (/connectionState|fetchInstances|whatsappNumbers/.test(String(url))) {
    return { ok: true, status: 200, json: async () => ({ state: "open" }), text: async () => '{"state":"open"}' };
  }
  const tel = (String(init?.body || "").match(/55\d{10,11}/) || [""])[0];
  evento("evolution_inicio", { tel });
  await new Promise((r) => setTimeout(r, atrasoEvolutionMs));
  evento("evolution_fim", { tel });
  return { ok: true, status: 200, json: async () => ({ key: { id: "wa" } }), text: async () => '{"key":{"id":"wa"}}' };
};

process.on("SIGTERM", async () => {
  evento("sigterm");
  const r = await executarDesligamento({
    iniciar: iniciarDesligamento,
    pararAgendadores: async () => {},
    aguardarEnvios: (prazo) => aguardarEnviosPararem(prazo),
    drenarAgente: async () => true,
    fecharHttp: async () => {},
    fecharInfra: async () => evento("pool_end"),
    prazoEsperaMs,
    log: () => {},
  });
  evento("desligado", { enviosPararam: r.enviosPararam, ms: r.ms });
  process.exit(0);
});

if (cenario === "sem_lote") {
  evento("pronto");
  setInterval(() => {}, 1000); // processo vivo, sem envio nenhum
} else {
  dispatchCampaignSequence({
    webhookUrl: "https://evolution.teste/message/sendText/chip-1",
    webhookToken: "t",
    leads: [
      { id: "lead-1", nome: "Ana", telefone: "5534999990001" },
      { id: "lead-2", nome: "Bia", telefone: "5534999990002" },
      { id: "lead-3", nome: "Caio", telefone: "5534999990003" },
    ],
    analyticsMeta: { sequence: [{ id: "s1", type: "text", text: "Oi", order: 1, enabled: true, triggerMode: "immediate", delayAfterSeconds: 0 }] },
    leadDelayProvider: () => 0,
    onLeadClaim: async ({ lead }) => { evento("claim", { lead: lead.id }); return true; },
    onLeadSendStarting: async ({ lead }) => { evento("marca", { lead: lead.id }); return true; },
    onLeadDispatched: async ({ lead }) => { evento("sent", { lead: lead.id }); },
  }).then(({ summary }) => evento("motor_parou", { shutdown: Boolean(summary.shutdown), successCount: summary.successCount }));
}
