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

## DT-002 — A tela não usa `missingOrigin` da recorrência sem origem

- **Onde:** `backend/src/domains/campaigns/routes.js`, rota `GET /:id/recurrence` (o selo `originKind`, em torno da linha
  2508, e o campo `audienceToday`), e a tela que o consome (`RecurrenceHistoryDialog.tsx`, `formatAudienceToday` em
  `frontend/src/lib/campaignRecurrence.ts`).
- **O que acontece:** campanha recorrente de público do Banco **sem origem** agora é segura no backend: a ocorrência é
  pulada com motivo e `countCampaignAudience` devolve `{ total: 0, missingOrigin: true }`. Mas a tela ainda mostra
  "Hoje seriam 0 leads." sem dizer por quê, e o selo de origem continua calculado pelo resolvedor **permissivo**, então diz
  "todas as planilhas" para uma campanha que não tem origem.
- **Falta:** a tela ler `audienceToday.missingOrigin` e mostrar o aviso ("sem origem definida: escolha de onde vêm os
  contatos"); o selo `originKind` usar o resolvedor estrito. O dado já existe no retorno.
- **Por que não bloqueia:** não há campanha recorrente no banco (medição J5, 29/10/2026: 0 recorrentes) e nenhum envio
  sai errado; é só informação enganosa na tela.
- **Status:** aberta, sem prioridade. Registrada em 29/10/2026. Relacionada à correção `fix/recorrencia-sem-origem`.
