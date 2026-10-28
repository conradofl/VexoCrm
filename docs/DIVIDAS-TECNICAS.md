# Dívidas técnicas nomeadas

Itens conhecidos, medidos ou lidos no código, **deliberadamente não resolvidos**. Cada um tem um nome estável para ser
citado em código, spec e conversa. Resolver um deles exige spec própria.

## DT-001 — A fila de leads por resposta inicia leads fora do agendador de lotes

- **Onde:** `backend/src/campaign/dispatch.js`, `startNextCampaignLeadInQueue`, chamada em `continueCampaignLeadFromReply`
  (fluxo de resposta, ativo) quando um lead conclui a sequência por respostas e a campanha tem `waitForReply`.
- **O que faz:** escolhe o primeiro lead sem progresso e dispara o passo 1 para ele, **fora** do agendador de lotes
  (`campaign_dispatches` / `runCampaignDispatch`). Não passa por claim (`campaign_dispatch_runs`), não reserva cota do chip
  e não respeita a janela de envio.
- **Por que é uma dívida:** são duas fontes para a mesma decisão (quem recebe e quando), o mesmo padrão que já custou
  tempo no `finalize_sent` e nos dois sistemas de disparo paralelos.
- **A cerca que existe hoje, e é intencional:** `buildDispatchLeads({ limit: campaign.limit_per_run })` limita quais leads
  a fila enxerga (a campanha grava 50 por padrão, ou o tamanho do lote). **Não remover, não anular e não "limpar" essa
  cerca** sem resolver a dívida: sem ela, concluir uma resposta poderia iniciar qualquer lead da base que ainda não
  recebeu. É por isso que a SPEC 17 mantém `campaigns.limit_per_run` gravado mesmo depois de ele deixar de ser limite
  de envio do lote.
- **Como resolver (futuro):** ou a fila passa a criar/reaproveitar um lote (com claim, cota e janela), ou é desarmada
  para campanhas que usam lotes. Decisão do dono, com medição de quantas campanhas dependem dela.
- **Status:** aberta, sem prioridade. Registrada em 28/10/2026.
