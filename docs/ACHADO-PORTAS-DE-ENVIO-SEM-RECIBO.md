# Achado: três portas de envio de campanha que não deixam recibo

**Status:** achado, **sem correção**. Registrado em 31/10/2026 sobre o `main` `f4514a8e`. Frente própria, fora do escopo da
investigação de envio duplicado.

## O que é "recibo"

O envio por **lote** (`runCampaignDispatch`, `backend/src/domains/campaigns/routes.js:4118`) deixa três rastros:

1. um run em `campaign_dispatch_runs` (claim em `routes.js:4142`, desfecho em `onLeadDispatched`/`onLeadFailed`);
2. uma linha em `lead_messages` por passo enviado, com `meta.source = "campaign_dispatch"` e `meta.dispatchId`
   (`onStepDispatched`, `routes.js:4145`; gravação em `:4173`);
3. o progresso do lead (`normalized_data.campaign_progress`), que a resposta do lead usa para continuar a sequência.

Sem esses rastros o envio existe na Evolution e em mais lugar nenhum do banco.

## As três portas

Todas chamam `dispatchCampaignSequence` **sem** `onLeadClaim`, `onLeadClaimRollback`, `onLeadDispatched`, `onLeadFailed`,
`onStepDispatched`, `onLeadCheckOptout`, `shouldContinue` e `chipProvider`. A única proteção passada é o `quotaGate`.

| Porta | Onde | Estado |
|---|---|---|
| `POST /api/n8n-dispatches` | rota em `routes.js:522`; chamada em `routes.js:589` (modo `legacy_manual_dispatch`); só `quotaGate` (`:588`) | **viva** |
| `POST /api/campaigns/direct-dispatch` | rota em `routes.js:858`; chamada em `routes.js:997` (modo `direct_dispatch`); só `quotaGate` (`:996`) | **viva** |
| Motor legado `executeCampaignDispatch` | `backend/src/campaign/dispatch.js:602`; chamada em `dispatch.js:725` (modo `campaign_dispatch`); só `onLeadDispatched` | **desarmado**, código ainda presente |

### Porta 1 e 2: viva, mas sem chamador na tela

- Os dois endpoints têm hook no frontend (`useCreateN8nDispatch`, `frontend/src/hooks/useLeadImports.ts:578-602`;
  `useDirectDispatch`, `frontend/src/hooks/useCampanhas.ts:864`), e **nenhum componente usa esses hooks** (grep em
  `frontend/src`, fora de testes, `main` `f4514a8e`).
- Continuam acessíveis a quem chamar a API autenticada (`requireFirebaseAuth`; a primeira ainda exige a visão `planilhas`).
  Quem chama hoje, se alguém chama, não se descobre pelo banco: só pelo log do `bk-vexo` (o `direct-dispatch` registra
  `dispatch_started` com `mode: "direct_dispatch"`, `routes.js:985`).

### Porta 3: o motor legado

- `startCampaignScheduler()` é um **no-op** que só loga "desarmado" (`backend/src/campaign/scheduler.js:138-140`).
- `POST /api/campaigns/run-due` responde `disarmed: true` sem chamar o motor (`routes.js:3011`), e
  `POST /api/campaigns/:id/trigger` responde 410 `CAMPAIGN_TRIGGER_DEPRECATED` (`routes.js:3040`).
- O único chamador de `executeCampaignDispatch` é `scheduler.js:74`, dentro de `runDueCampaignDispatches`, que só
  `tickCampaignScheduler` (`scheduler.js:102-106`) invoca, e nada invoca o `tick`. Código morto, mas presente e importável.
- Medição do dono em 28/10/2026: 0 campanhas elegíveis, 0 disparadas por ele em 30 dias.

## Consequências

- **Sem idempotência.** Sem claim, um clique repetido ou duas abas enviam duas vezes. Nada no banco registra que foram duas.
- **Invisível para medição.** Duplicidade de envio, taxa de resposta e auditoria de importação só enxergam o lote. A medição
  de envio duplicado do lote (31/10/2026) é cega para estas portas por construção.
- **Resposta do lead não é atribuída à campanha.** `appendLeadMessage` atribui a resposta pela busca de run `sent` do telefone
  (`backend/src/domains/shared/leadMessaging.js:122-133`); sem run, a resposta fica sem campanha.
- **Sem janela de envio, sem opt-out por lead e sem pausa.** Só o `quotaGate` vale.
- **Origem possível de "duas entregas, um registro".** Um envio avulso para um lead que também está num lote produz uma
  entrega que nenhum recibo explica.

## Como resolver (futuro, decisão do dono)

1. Decidir se as duas portas vivas continuam existindo. Sem consumidor na tela, uma saída é desligá-las como o motor legado
   foi desarmado (resposta 410), com a medição de uso no log antes.
2. Se continuarem, dar a elas o mesmo recibo do lote: claim idempotente, `onStepDispatched` gravando em `lead_messages` com
   `source` próprio e um run (ou registro equivalente) para o envio avulso.
3. Remover o motor legado de vez (`executeCampaignDispatch`, `runDueCampaignDispatches`, `tickCampaignScheduler`) depois que
   o item 1 estiver decidido, para ninguém religá-lo por engano.

Relacionado: DT-001 (a fila de leads também envia fora do agendador de lotes) em `docs/DIVIDAS-TECNICAS.md`.
Medição de envio duplicado e a resposta repetida no mesmo passo: `docs/ACHADO-ENVIO-DUPLICADO-MEDICAO-31OUT.md`.
