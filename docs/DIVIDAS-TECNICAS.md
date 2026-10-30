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

## DT-008 — O pedido de saída só é capturado na resposta ao follow-up; resposta de campanha não é registrada em lugar nenhum

- **Medição (29/10/2026, dono, 23:41Z):** `lead_optouts` existe (colunas `id`, `client_id`, `phone`, `optout_at`, `reason`) e tem
  **zero registros em todos os tenants**, com cerca de 12 mil telefones importados e meses de campanha. Ninguém nunca ter pedido
  para sair não é verdade: o problema está **antes da tabela**.
- **Único ponto que escreve:** `backend/src/followup/routes.js`, webhook `POST /webhooks/whatsapp/:companyId` (linha 147), detecção
  na **linha 211** (`messageText.match(/^(sair|parar|cancelar|stop)$/i)`) e `INSERT` na linha 213. Só vale para quem responde a
  uma mensagem de **follow-up**, e a regex é ancorada: a mensagem inteira tem de ser uma das quatro palavras. "Parar!", "parar.",
  "pare de me mandar mensagem", "não quero mais", "me tira da lista" e "descadastrar" **não casam**. O `.catch` do `INSERT`
  (linha 217) só escreve no log.
- **As três fontes de opt-out:** `leads.opt_out` (coluna), `leads.metadata.opt_out` / `leads.dados.opt_out` (JSON) e a tabela
  `lead_optouts`. A coluna e o JSON só são gravados à mão, pelo PATCH de lead (`backend/src/domains/leads/routes.js:3087-3101`).
  Nenhum código grava as três a partir de uma mensagem do lead numa campanha.
- **Caminho que a resposta de uma CAMPANHA percorre hoje (nenhuma etapa procura pedido de saída):**
  1. `backend/src/domains/chatbot/routes.js`, `POST /api/hardcoded-chat-webhook` (linha 2802), o webhook por instância. Descarta eco
     e mensagem nossa (2823-2880) e resolve o conteúdo (2881).
  2. **ETAPA 3, gravação da mensagem** (2901-2930, `appendLeadMessage` na 2906): a mensagem é gravada como inbound. Nada de
     opt-out aqui.
  3. `reclassifyLeadFromMessages` (2931) muda o estágio do funil; `classifyConversation` (2968,
     `services/whatsappChatClassifier.js`) só separa humano de robô/URA. Nenhum dos dois entende "pare".
  4. **ETAPA 4, roteamento de campanha** (3022): `findCampaignReplyMatches` (3033).
  5. **CAMINHO 1** (3130): `continueCampaignLeadFromReply` (3175, definida em `backend/src/campaign/dispatch.js:2228`) **envia o
     próximo passo da sequência** para o lead que acabou de pedir para sair.
  6. **CAMINHO 2** (3212): o agente de IA responde a mensagem.
  - Variante n8n: `backend/src/domains/campaigns/routes.js`, `POST /api/campaigns/reply-webhook` (6484), com
    `findCampaignReplyMatches` (6533), `continueCampaignLeadFromReply` (6546) e a gravação do inbound (6631 e 6729). Mesma falta.
- **Onde faltaria o gancho:** um único ponto, **logo depois da ETAPA 3** (a mensagem já gravada, 2930) e **antes** da
  reclassificação (2931), da ETAPA 4 (3022), do CAMINHO 1 (3130) e do CAMINHO 2 (3212), com retorno antecipado: quem pediu para
  sair não pode receber o próximo passo da campanha nem resposta do agente. O mesmo gancho na variante n8n, antes da linha 6546.
  O gancho tem de gravar `lead_optouts` **e** a flag `leads.opt_out` (ver DT-005), cancelar a cadência de follow-up
  (`cancelFollowupCadenceOnReply`, já usada no mesmo arquivo) e tirar o lead da fila e do lote, que já leem as duas fontes
  (`campaign/queueOptOut.js`, lote em `routes.js` `checkOptout`, `campaign-outbound.js:1013`).
- **Por que o commit que liga o opt-out ao lote não resolve sozinho:** ele faz o lote respeitar uma lista que continua vazia.
  Passa a valer quando a captura existir.
- **O que a captura exige decidir (peso jurídico, fora do escopo dos PRs de fila):** quais frases valem (palavra exata ou
  intenção em linguagem natural), o risco de falso positivo ("pode parar de ligar às 18h?"), se há mensagem de confirmação, e
  o que fazer com quem já está em sequência no meio.
- **Status:** aberta, **sem correção em andamento**; o dono abrirá frente própria. Registrada em 29/10/2026.

## DT-009 — Custo de IA de campanha sem dono em `llm_usage`

- **Onde:** as cinco rotas de IA de campanha em `backend/src/domains/campaigns/routes.js` chamam o `campaign-ai.js` sem o
  tenant: `generateCampaignCopySuggestion` (linha 661, rota `POST /api/campaigns/ai/generate-copy`), `suggestCampaignSequence`
  (682, `suggest-sequence`), `generateCampaignTemplateVariants` (713, `generate-template-variants`), `suggestCampaignDelays`
  (743, `suggest-delays`) e `rewriteCampaignStep` (789, `rewrite-step`). Linhas medidas no commit 3795380f.
- **O que acontece:** o `campaign-ai.js` já mede (`contextoDeCampanha`, linha 159, lê `input.clientId`), mas como a rota não
  passa o campo, toda linha de `public.llm_usage` com `origem = 'campanha'` sai com `client_id` nulo.
- **Como resolver:** em cada uma das cinco chamadas, acrescentar `clientId` ao objeto passado, com o mesmo tenant que a rota já
  resolve para autorizar o pedido. Nenhuma mudança no `campaign-ai.js`. Fazer de passagem por quem mexer nessas rotas.
- **Por que não foi feito junto:** `domains/campaigns/*` tem outra frente viva; o commit de medição não tocou nesses arquivos.
- **Status:** aberta. Registrada em 30/10/2026.

## DT-010 — Chamadas de LLM que vão direto na Groq ficam fora de `llm_usage`

- **Onde:** estes pontos postam em `api.groq.com` sem passar por `callLlmChatCompletion` (`backend/src/chatbot-ai-engine.js`),
  então não entram na escada multi-provedor nem na medição de custo:
  - `backend/src/followup/automationEngine.js:219` (SDK `groq.chat.completions.create`)
  - `backend/src/followup/worker.js:665` (SDK `groq.chat.completions.create`)
  - `backend/src/helpdesk-ai.js:67`
  - `backend/src/domains/geracaoDigitalContracts/contractExtract.js:76`
  - `backend/src/domains/geracaoDigital/briefingExtract.js:119`
  - `backend/src/domains/geracaoDigitalRoutes.js:2911`
  - `backend/src/domains/leads/chatInsight.js:567` (fallback direto, depois que `callLlmChatCompletion` falha)
  - `backend/src/services/leadAiFieldExtractor.js:197` (fallback direto, idem)
  - `backend/src/chatbot-ai-engine.js:810`, `describeImage` (visão). Sai desta lista quando a visão for para o Gemini.
- **Fora de propósito:** a transcrição de áudio (`chatbot-ai-engine.js:753` e `domains/geracaoDigital/briefingTranscribe.js`)
  continua na Groq com whisper, por decisão de 30/10/2026. Não conta como texto de LLM.
- **Por que é uma dívida:** hoje é a Groq gratuita e não pesa na fatura. Mas o follow-up acabou de ser consertado e vai passar
  a ser usado, e no dia em que qualquer um desses pontos for apontado para o Gemini vira custo invisível: nada em `llm_usage`.
- **Como resolver:** trocar a chamada direta por `callLlmChatCompletion` com `contexto: { clientId, origem }`. Os dois fallbacks
  diretos podem simplesmente sair, porque a escada já tenta outro provedor.
- **Status:** aberta. Registrada em 30/10/2026.

## DT-011 — `llm_usage` guarda telefone e não tem RLS

- **Onde:** `public.llm_usage` (migration `20261030120000_create_llm_usage.sql`), coluna `phone`.
- **Decisão:** sem RLS de propósito. As tabelas do repositório se dividem entre sem RLS e com uma política que nega tudo, e
  uma política errada bloquearia o INSERT do backend e apagaria a medição sem aviso.
- **A restrição que vem junto:** a tabela tem telefone de lead. Não pode ser exposta por rota pública nem por relatório que
  saia do servidor. Relatório de custo agrupa por `client_id`, `origem`, `provider` e `model`; telefone só para investigação
  dentro do servidor.
- **Status:** restrição permanente. Registrada em 30/10/2026.

## DT-012 — Ordem da escada Gemini e `GEMINI_REASONING_EFFORT` decididas sem prompt real

- **Onde:** `LLM_MODEL_LADDER_PADRAO` em `backend/src/services/llmModels.js` (hoje `gemini-flash-latest` antes de
  `gemini-flash-lite-latest`) e `GEMINI_REASONING_EFFORT` em `backend/src/chatbot-ai-engine.js` (padrão `none`).
- **O que foi medido (30/10/2026, endpoint compatível com OpenAI, respondendo "oi", prompt de 13 tokens):**
  `gemini-flash-latest` com raciocínio 3027 ms e 129 tokens no total; sem raciocínio (`none`) 1693 ms e 18 tokens;
  `gemini-flash-lite-latest` 899 ms e 18 tokens (ele não pensa por padrão e recusa `reasoning_effort` com 400).
- **O que essa medição NÃO prova:** o "7x" de tokens é artefato do prompt minúsculo. O raciocínio custa uns cem tokens fixos, e
  num prompt real de tenant com RAG a entrada tem milhares: a economia de custo ali é pequena, talvez desprezível. O que é real
  é a latência, quase um segundo e meio por resposta, e é por ela que o `none` entrou. Nada sobre qualidade de conversa.
- **A medição que falta, uma só, respondendo as duas perguntas juntas, com prompts reais de tenant de venda com RAG:**
  1. o `gemini-flash-latest` sem raciocínio conversa tão bem quanto com raciocínio?
  2. o `gemini-flash-lite-latest` conversa tão bem quanto o flash?
  Ela decide a ordem dos degraus e o valor de `GEMINI_REASONING_EFFORT`. Medir também latência e `total_tokens` (de
  `public.llm_usage`, que já registra o total da API, raciocínio incluído).
- **Até lá:** a ordem fica a do commit que pôs o Gemini como padrão, e o `none` fica. Nenhum dos dois muda por esta medição de "oi".
- **Status:** aberta, para depois do merge de `fix/migracao-gemini`. Registrada em 30/10/2026.

## DT-013 — O resgate de passo de campanha some quando o chip ganha um agente, mesmo desligado

- **Onde:** `backend/src/domains/chatbot/routes.js`, bypass de `chatbot_disabled` (`:3268-3328`), que chama
  `resolvePendingCampaignRunForPhone` (`:90`) e `continueCampaignLeadFromReply` (`:3308`).
- **O que faz:** é o segundo dos dois pontos que avançam passo de campanha a partir de uma resposta. O primeiro (`:3145-3221`)
  roda antes de qualquer leitura do agente. Este só é alcançado dentro do `else` de "chip sem agente próprio": exige
  `inboundConfig === null` e `chatbot_enabled === false`. Se o chip tem qualquer linha ativa em `followup_companies`,
  ligada ou desligada, a resposta para no portão `inbound_disabled` (`:3253`) ou vai para a IA, e o resgate nunca roda.
- **Pegadinha:** tenant com exatamente um agente ativo aplica esse agente a qualquer chip dele, inclusive os não vinculados
  (`backend/src/services/inboundAgent.js:146`, `data.length === 1`). Nesse tenant o resgate não roda em chip nenhum.
- **Quem perde:** respostas que o primeiro caminho não pega. São as de campanha com fluxo de resposta cujo progresso no item
  da importação não está `aguardando_usuario` (Prioridade A) e as que só existem em `campaign_dispatch_runs`, do segundo
  sistema de disparo (Prioridade B).
- **Por que é uma dívida:** a continuação de campanha depende da AUSÊNCIA de agente no chip. Criar um agente, mesmo desligado,
  muda o disparo sem nenhum aviso. Foi daí que veio a crença "o agente precisa estar ligado para a campanha seguir": ligado
  ou desligado, com agente o resgate não roda.
- **Status:** aberta, sem medição de raio. Registrada em 30/10/2026.

## DT-014 — A Prioridade B do resgate força `nextStepIndex: 1` e pode reenviar o passo 2 ao mesmo lead

- **Onde:** `backend/src/domains/chatbot/routes.js`, `resolvePendingCampaignRunForPhone`, Prioridade B (`:125-221`), que
  monta o progresso com `nextStepIndex: 1` fixo (`:213`). `continueCampaignLeadFromReply`
  (`backend/src/campaign/dispatch.js:2228`) confia nesse progresso como veio (`:2253-2263`) e não relê o progresso gravado.
- **O que faz:** a Prioridade B acha o run `sent` mais recente do telefone em `campaign_dispatch_runs` e, se a campanha tem
  fluxo de resposta e mais de um passo, devolve "aguardando o passo de índice 1" sem olhar o que já foi enviado.
- **O risco:** se a próxima resposta do mesmo lead cair de novo na Prioridade B (sem item da importação, ou com o progresso
  gravado num lugar que `findCampaignReplyMatches` não acha), o passo 2 sai de novo. É disparo repetido para o mesmo lead
  pelo mesmo chip.
- **Alcance:** só existe onde a DT-013 deixa o resgate rodar: chip sem agente e `chatbot_enabled === false`.
- **Como medir (antes de consertar):** a assinatura no log do `bk-vexo` é `[campaign-routing] bypass chatbot_disabled`
  repetido para o mesmo telefone e a mesma campanha. No banco, o mesmo texto de passo enviado duas ou mais vezes ao mesmo
  telefone, depois de conferir no `information_schema` onde o envio do passo fica registrado.
- **Status:** aberta, sem medição. Registrada em 30/10/2026. Não consertar junto com outra frente.
