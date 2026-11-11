# Achado: envio duplicado, medição de 31/10/2026 e a resposta repetida no mesmo passo

**Status:** achado, **sem correção**. Código lido no `main` `f4514a8e`. Os números da medição foram rodados e relatados
pelo dono (consultas 1 a 5, 31/10/2026); este documento os registra e **não os reproduz**. Complementa
`docs/ACHADO-PORTAS-DE-ENVIO-SEM-RECIBO.md`.

## 1. O que a medição mostrou

| Pergunta | Resultado |
|---|---|
| O filtro estreito (`source = campaign_dispatch`, no mesmo lote) vale? | **Sim.** Base de 1.122 mensagens em 128 lotes; o histograma só tem "1 envio" por passo. O zero é real. |
| E sem exigir lote? (rede larga) | **156 mensagens extras** que o filtro estreito não via. |
| Onde estão os 156? | geracao-digital 77, bia-do-spazio 75 (não é mais cliente), vexo-adm 2, nous-gestao 2. |
| Quantos em cliente pagante ativo? | **2** (nous-gestao, ambos `campaign_reply_progression`), em 60 dias. Não é emergência. |
| Motor legado (`executeCampaignDispatch`)? | Consulta 5 **vazia**: zero marcas. Confirmado desarmado. |
| Padrão mais suspeito | `campaign_reply_progression` repetindo o **mesmo `stepId` para o mesmo telefone**: 40 grupos, 67 mensagens extras (grupos por tenant: bia-do-spazio 31, geracao-digital 6, nous-gestao 2, vexo-adm 1). |

Ressalva sobre "no mesmo lote": a coluna `no_mesmo_lote_ou_sem_lote` da consulta 4 junta os dois casos. A resposta por
reply-progression só carrega `dispatchId` quando consegue resolvê-lo (ver seção 2), então boa parte dos 40 grupos pode
não ter lote nenhum. "Mesmo lote" não está estabelecido para eles.

## 2. A coluna `lead_messages.dispatch_id`: quem ligou e por que a cobertura é parcial

**Não é coluna morta.** Foi medido em produção: gravada **desde 25/10/2026 23:45**, em **146 de 1.078** mensagens
`campaign_dispatch` e **164 de 877** `campaign_reply_progression` (janela desde 01/09).

**Quem ligou:** o commit `0c8c3b46`, de 24/10/2026 15:41 (−03), "fix(campaigns): freeze dispatch options in batch snapshot
and persist dispatch_id in lead messages". Ele criou, no mesmo ato, a migration
`20261024150000_add_dispatch_options_and_dispatch_id.sql` e a gravação em
`backend/src/domains/shared/leadMessaging.js` (parâmetro `dispatchId`, `resolvedDispatchId`, `dispatch_id` no `INSERT`,
regravação sem a coluna quando ela não existe). Entrou no `main` pela fusão `36360058` (25/10 13:53 −03,
`feat/campaign-dispatch-actions-and-diagnostics`). A primeira linha com a coluna em produção (25/10 23:45) é posterior às
fusões de 25/10 (a última, às 19:04 −03): coerente com o deploy daquela noite, já que a migration roda no boot
(`server.js:976`). Qual deploy foi exatamente não se prova pelo código.

**Por que a cobertura é parcial (o que o código admite; a proporção de cada causa NÃO foi medida):**

1. **Tempo.** Tudo o que foi gravado antes de 25/10 23:45 não tem a coluna, e a janela medida começa em 01/09. Parte grande
   dos 13,5% e 18,7% pode ser só isso. Para separar, repetir a consulta 3 com a janela a partir de `2026-10-25T23:45:00Z`:
   a cobertura depois do deploy deveria ser quase total no lote.
2. **`INSERT` direto no pool sem a coluna.** Quando o primeiro `INSERT` falha, o fallback grava por
   `leadMessaging.js:249-253`, e essa lista de colunas **não inclui `dispatch_id`**.
3. **A fila não passa o lote.** `startNextCampaignLeadInQueue` chama `appendLeadMessage` em `dispatch.js:1118-1130` sem
   `dispatchId`, então `campaign_queue` fica sem a coluna por desenho.
4. **A continuação por resposta só preenche quando resolve o lote.** Usa `dispatchId || progress?.dispatchId`
   (`dispatch.js:2544`, `:2658`, `:2674`). Lead cujo progresso não carrega o lote (iniciado pela fila, ou anterior ao
   commit que passou a gravá-lo no progresso) fica sem a coluna.
5. **Coluna ausente.** Se faltar, o código a remove e regrava (`leadMessaging.js:185-192`).

## 3. O que impede o mesmo passo de ser reenviado quando o lead responde duas vezes?

**Nada garante idempotência por passo.** Não existe, em `continueCampaignLeadFromReply` (`backend/src/campaign/dispatch.js:2228`)
nem em quem o chama, nenhuma checagem do tipo "este passo já foi enviado a este telefone nesta campanha" (nem em
`lead_messages`, nem em `campaign_dispatch_runs`). A única proteção é o **estado do progresso do item de planilha**, em três
guardas, cada uma com um furo.

### As três guardas

1. **Portão de estado** (`dispatch.js:2252-2262`). Só continua se o progresso tem `waitForReply`, `status ===
   "aguardando_usuario"` e `nextStepIndex` válido. O progresso vem de `campaignMatch.leadImportItem.progress`, um
   **instantâneo** montado por `findCampaignReplyMatches` (`dispatch.js:1394`, `hasPendingProgress` em `:1516`) quando o
   webhook chegou. A função **não relê** a linha antes de agir.
2. **Fechar a porta antes de enviar** (`dispatch.js:2574-2590`): grava `status: "enviando_proximas_etapas"`. Com isso a
   próxima resposta já não casa como pendente (`:1516`) e não entra em `processingWaitForReplyMatches`
   (`chatbot/routes.js:3130`). Mas é uma gravação **incondicional** (`updateLeadImportItemCampaignProgress`,
   `dispatch.js:1223`: lê, mescla e grava, sem comparar o estado anterior).
3. **O índice só avança depois do envio:** por passo (`dispatch.js:2694-2705`, `nextStepIndex: originalStepIndex + 1`) e
   no fechamento (`dispatch.js:2790-2811`, `markCampaignLeadWaitingReply`).

### Os três furos (o código admite os três; qual deles produz os 40 grupos NÃO foi medido)

- **F1, corrida entre duas respostas seguidas.** Entre o portão (`dispatch.js:2255`) e a gravação que o fecha (`:2574`) a
  função resolve o lote, lê o snapshot dele e monta a sequência (várias consultas; a campanha em si já foi lida antes do portão). Duas respostas dentro dessa janela passam as duas pelo
  portão e as duas enviam o mesmo passo. É o caso comum de o lead mandar duas mensagens em sequência (texto e áudio, por
  exemplo). A guarda de reprocessamento do webhook (`shouldIgnoreInboundEvent`, `chatbot/routes.js` da linha 2907 em
  diante, comentário em `:2895`) cobre a **mesma** mensagem entregue duas vezes, não duas mensagens diferentes.
  *Assinatura esperada:* o mesmo passo, o mesmo telefone, com segundos de diferença.
- **F2, dois itens de planilha para o mesmo telefone.** `resolveMatchedImportItemForCampaign` (`dispatch.js:1347`) devolve o
  **primeiro** item "aguardando resposta". Quando esse item termina, o segundo (que ainda está no passo 1) passa a ser o
  primeiro, e a sequência recomeça: o telefone recebe a sequência inteira duas vezes. É o caso do lead 2 da campanha
  `0d3e7b15` (dois itens de duas importações, finalizados em 22/10 e 24/10). *Assinatura:* intervalo de horas ou dias e mais
  de um item do telefone na campanha.
- **F3, progresso que volta para trás.** Quem escreve "aguardando o passo 1" não olha o estado atual do item:
  `markCampaignLeadWaitingReply` (`dispatch.js:1708`) é chamada pelo lote (`routes.js:4197`, com
  `nextStepIndex: primeiroPassoAposResposta`), pela fila (`dispatch.js:1171`) e pelo motor legado desarmado (`dispatch.js:754`).
  O `mergeCampaignProgress` (`dispatch.js:1201`) sobrescreve as chaves. A única barreira é a trava por ciclo
  (`isLeadBlockedByActiveCycleProgress`, `dispatch.js:1614`), que só bloqueia `aguardando_usuario` e `pendente`: **não**
  bloqueia `enviando_proximas_etapas`, `finalizado` nem `erro`. Se um desses escritores reenviar o passo 0 a um lead que já
  avançou, o índice volta e a próxima resposta repete o passo 1. É o caso do lead 1 da `0d3e7b15` (um item só, o mesmo
  passo três vezes em 90 minutos). *Assinatura:* intervalo de minutos a horas e um item só.

### Como separar os três

A consulta 6 (`6-reply-progression-por-provavel-causa`, entregue no chat e validada em Postgres de teste) classifica cada
grupo por tenant: `itens_duplicados_do_mesmo_telefone` (F2) quando o telefone tem mais de um item com progresso na
campanha, `corrida_respostas_juntas` (F1) quando o intervalo é de até 120 s, e `progresso_voltou_ou_outro` (F3) no resto.
A classificação é indício: F3 é o resíduo e inclui qualquer causa não prevista.

## 4. O que fica

- Os 2 casos em cliente pagante ativo (nous-gestao) não justificam correção hoje. Os 40 grupos de reply-progression
  (31 em bia-do-spazio, que não é mais cliente) pedem a consulta 6 antes de qualquer decisão.
- O legado está confirmado em zero e desarmado (`scheduler.js:138-140`, `routes.js:3011`).
- Nenhuma correção foi escrita nesta frente.
