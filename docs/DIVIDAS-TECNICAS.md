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
- **Status:** aberta. Registrada em 28/10/2026. Atualizado em 29/10/2026: a fila ganhou claim (PR #167), trava por ciclo no claim do lote
  (PR 1b) e os três freios (PR 2): janela de envio, cota do chip e opt-out, com adiamento e retomada pelo agendador. Continua
  fora do agendador de lotes (sem run); a rotação entre chips na fila é o PR 3.

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

## DT-003 — Fila e lote não se excluem de forma atômica por item

- **Onde:** `claimQueueLead` (`backend/src/campaign/queueClaim.js`, grava o progresso e confere os runs num único `UPDATE`)
  e o `claimLead` do lote (`backend/src/domains/campaigns/routes.js`, grava o run e, desde o PR 1b, relê o progresso).
- **O que sobra:** os dois claims escrevem em tabelas diferentes (`lead_import_items` e `campaign_dispatch_runs`). Se a fila
  e o lote reivindicarem o MESMO lead no mesmo instante (janela de milissegundos), cada um pode não enxergar a escrita do
  outro, e o lead recebe duas vezes. O caso medido de 29/10/2026 (6 segundos de distância) está fechado; esta janela não.
- **Segundo buraco, de cerca de um segundo:** a trava por ciclo (`isLeadBlockedByActiveCycleProgress`) só reconhece
  progresso com `waitForReply` e status `aguardando_usuario` ou `pendente`. O claim provisório da fila grava `iniciando`,
  que ela não reconhece. Um lote que reivindique o lead durante o envio da fila (cerca de um segundo) ainda passa.
- **Como resolver (futuro):** `pg_advisory_xact_lock` por item de planilha nos dois caminhos (fila e lote), tomado antes de
  ler e escrever. É uma mudança maior e arriscada: decisão do dono, com medição do tamanho real da janela.
- **Status:** aberta, sem prioridade. Registrada em 29/10/2026.

## DT-004 — Claim da fila com status `iniciando` não expira

- **Onde:** `claimQueueLead` e a escolha de candidatos em `startNextCampaignLeadInQueue` (`backend/src/campaign/`).
- **O que acontece:** o claim grava `status: "iniciando"` e `claimedAt` e é devolvido quando o envio falha ou não entrega.
  Se o processo morrer entre o claim e a devolução (deploy, queda), o lead fica com `iniciando` para sempre: a fila só
  considera candidato quem não tem progresso nenhum, e o lote só conhece a regra de `aguardando_usuario`. Ninguém resolve.
- **Como resolver (futuro):** tratar `iniciando` com `claimedAt` mais antigo que um limite (proposta: 10 minutos) como livre,
  tanto na escolha de candidatos quanto no `UPDATE` do claim. Entra junto do PR dos freios, onde claim pendurado é o tema.
- **Status:** RESOLVIDA em 29/10/2026 no PR dos freios: `isStaleQueueClaim` e o `UPDATE` do claim tratam `iniciando` com mais de 10
  minutos (`CLAIM_TTL_MINUTES`) como livre. Mantida aqui só como registro.

## DT-005 — Quem digita "parar" vira `lead_optouts`, mas não vira a flag `leads.opt_out`

- **Onde:** `backend/src/domains/followup/routes.js` (webhook de resposta do follow-up, que reconhece "sair", "parar",
  "cancelar" e "stop" e grava em `lead_optouts`) e `backend/src/campaign/queueOptOut.js` (a leitura única das duas fontes).
- **O que acontece:** o opt-out por palavra grava só na tabela. A flag `leads.opt_out` (a que a tela de leads edita e que
  `buildDispatchLeads` filtra na montagem da lista) não é gravada. Até 29/10/2026 NENHUM envio de campanha lia a tabela: o
  `checkOptout` do lote existia e nunca foi passado ao envio. Agora a fila e o lote leem as duas fontes pelo mesmo helper
  (`isPhoneOptedOut`), mas qualquer outra tela ou relatório que olhe só a flag continua sem enxergar quem digitou "parar".
- **Como resolver (futuro):** gravar a flag `leads.opt_out` (e `metadata.opt_out`) no mesmo ponto em que se grava
  `lead_optouts`; decidir se o opt-out por palavra também vale para o agente de IA e o follow-up.
- **Status:** aberta. Registrada em 29/10/2026. Dívida nomeada do PR dos freios.

## DT-006 — Dois presets "gestor": o da tela e o do backend divergem, e o da tela vence

- **Onde:** `frontend/src/lib/access.ts` (`PRESET_DEFAULTS.gestor`, linhas 263-310) e
  `backend/src/access/claims.js` (`ACCESS_PRESET_DEFAULTS.gestor`, linhas 139-168).
- **O que diverge:** o backend dá ao gestor `INTERNAL_PAGE_KEYS` inteiro menos `empresas` (34 páginas). A tela dá uma
  lista fixa de 17 (de `dashboard` a `livpub`). Faltam no da tela, entre outras: `chatbot-docs`, `chatbot-kanban`,
  `chatbot-config`, `inteligencia-comercial`, as subpáginas de follow-up, `integracoes`, `leads-parados`.
  Os presets de cliente também divergem em `internalPages` (a tela grava páginas, o backend grava `[]`); hoje é inerte,
  porque role `client` não passa por `requireInternalPageAccess`. O `operador` bate nos dois lados.
- **Por que o da tela vence:** ao salvar um usuário, a tela manda `internalPages` no corpo, e a rota usa o corpo antes do
  preset (`backend/src/domains/auth/routes.js:321`, `req.body?.internalPages ?? selectedProfile?.internalPages`).
  O preset do backend só vale para quem nunca foi salvo pela tela.
- **Por que é mais grave que parece:** enquanto os dois divergirem, **qualquer página nova que entrar em
  `INTERNAL_PAGE_KEYS` não chega a quem foi salvo pela tela**. Re-salvar não conserta: a tela parte das claims atuais
  (`UserAccessManagement.tsx:512`). Trocar o preset também não: aplica a lista da tela. E não existe checkbox por página
  na edição de usuário (`AccessPagesTabs` só aparece dentro de `AccessProfileForm`, que não é renderizado).
- **Prova (29/10/2026):** usuário gestor do container-led (uid `v0zP4gKY…`) tinha exatamente as 17 páginas do preset
  da tela, na mesma ordem. As datas descartam "claims velhas": `chatbot-docs` existe desde 19/05 (cb317e48), `livpub`,
  `eventos` e `relacionamento` desde 29/06 (149477cb). O usuário tem as de junho e não a de maio. Efeito visível: 403
  no upload do RAG, que exigia `chatbot-docs`.
- **Mesma família de:** a divergência de `approvalLevel` nas claims (a tela preserva o valor antigo ao trocar o preset).
- **Como resolver (futuro):** uma fonte só. A tela já carrega os perfis do backend (`useAccessProfiles`, servido por
  `GET /api/admin/access-profiles`, `routes.js:194`), mas usa `buildPresetDefaults` local nas linhas 476, 500, 652, 675,
  718, 758, 2802 e 2830. Trocar essas chamadas pelo perfil vindo da API e apagar `PRESET_DEFAULTS` duplicado. Depois,
  um backfill das claims dos usuários já salvos, com snapshot, dry-run e rollback (mesmo molde de
  `migrate-user-claims-item4.mjs`).
- **Decisão do dono antes:** qual lista é a certa para o gestor. A do backend é larga (inclui páginas GD, que são
  barradas por tenant, além de `onboarding-agent` e `integracoes`). Unificar pela do backend **amplia** acesso a todos
  os gestores.
- **Tamanho:** o código são horas (meio dia, com testes). A decisão do conteúdo e o backfill medido das claims em
  produção são o que leva para 1 a 2 dias.
- **Status:** aberta. Registrada em 29/10/2026. O RAG deixou de depender disso com `fix/rag-gate-agente-rag` (gate pela
  página `agente` + módulo do tenant), mas a dívida continua para qualquer página nova.

## DT-007 — Todo deploy pausa os lotes que estão em voo

- **Onde:** `backend/src/campaign/orphanRecovery.js`, `recoverOrphanDispatches` (chamada em `server.js:976`, logo depois de
  `runMigrations`, antes de o servidor ouvir). A mensagem gravada está nas linhas 130-132.
- **O que acontece:** um lote `running` no momento em que o processo reinicia fica órfão. No boot ele é recolhido e vai para
  `paused` com "Pausado — servidor reiniciou durante o envio. Retome quando quiser." (com a contagem de leads de envio não
  confirmado, quando há). Ninguém retoma sozinho.
- **Medido em 29/10/2026:** lote 4/21 da campanha "Continuação - Apoio Julio": `paused`, target 10, sent 7, failed 0, com essa
  mensagem. No log do boot anterior, "Lote 2/21" pausado com `leadsSent: 5`. Explica lotes "com pendentes" depois de um
  deploy sem que a fila, o claim ou o envio tenham defeito.
- **Por que não é defeito:** a recuperação protege contra reenvio (lead com envio não confirmado não é reenviado). O custo é
  que **todo deploy nosso pega algum lote em voo** e o deixa parado até alguém clicar em retomar.
- **O que fazer hoje:** antes de subir, conferir `activeDispatchesCount` no `/health` (`domains/insights/routes.js:163`) e
  preferir subir com zero lotes em andamento; depois do deploy, listar e retomar os lotes pausados por reinício.
- **Como resolver (futuro):** decisão do dono. Ou retomada automática dos lotes pausados por reinício (respeitando janela de
  envio e cota do chip, e tratando os leads de envio não confirmado), ou drenagem do que está em voo antes do deploy.
- **Status:** aberta. Registrada em 29/10/2026.
