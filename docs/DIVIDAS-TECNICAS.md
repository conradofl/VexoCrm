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
