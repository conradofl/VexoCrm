# SPEC 17 — O default "50" da tela não pode virar limite real de envio

Status: **APROVADA em 27/10 com ressalvas (seção 7). Implementada na branch `feat/spec17-limite-opcional`. Merge e deploy SÓ no fim de semana.**
Base: `main` em `776bf109` (SPEC 13 já em produção). Data: 27/10/2026.

## 1. Diagnóstico (provado no código, `file:line` em `776bf109`)

Campanha sem lotes configurados (o caminho "Lote Principal") envia no máximo **50 leads**, mesmo que o público tenha mais, e a tela mostra o público inteiro.

| # | Fato | Onde |
|---|------|------|
| 1 | A tela **não tem campo** para esse limite. `campaignLimitPerRun` só aparece como estado e setter; nenhum componente o exibe ou recebe. | `LeadImports.tsx:607, 1327, 1647, 2078, 2323` |
| 2 | O estado nasce `"50"` e o envio usa `Number.parseInt(...) \|\| 50`. Sem lotes, vai como `limitPerRun` da campanha. | `LeadImports.tsx:607, 1647, 1653, 1682` |
| 3 | O backend repete o default: `limitPerRun ?? "50"`, mínimo 1, máximo 5000. | `routes.js:1307-1308` |
| 4 | O "Lote Principal" é criado **sem** `limitPerRun` e sem `offset` (lote com `limit_per_run` e `offset` nulos). | `LeadImports.tsx:1889-1905` |
| 5 | Na criação do lote, `target_count` é calculado com o limite do lote (nulo) = **público inteiro**. | `routes.js:5925-5940` |
| 6 | No envio, o limite é `dispatch.limit_per_run ?? campaign.limit_per_run` = **50**. | `routes.js:3232` (agendador e Disparar Agora), `routes.js:5441` (run-pending) |
| 7 | As prévias do lote usam só `dispatch.limit_per_run`, sem fallback: mostram o público inteiro. | `routes.js:4695, 4767` |
| 8 | A listagem mostra `"${limit_per_run} leads por lote"` da campanha. | `CampaignsTable.tsx:29` |
| 9 | O caminho legado também corta em `campaign.limit_per_run`. | `dispatch.js:412, 617, 906` |

Consequência: lote com `target_count` 120 envia 50 e fecha `interrupted` ("Interrompido: 70 lead(s) pendente(s)"). A tela, o `target_count` e as prévias dizem 120; só o envio diz 50.

### Reprodução executada (código real, Postgres real em pglite, 27/10/2026)

Campanha do Banco com 120 leads, `campaigns.limit_per_run = 50`, lote criado pela rota `POST /api/campaigns/:id/dispatches` sem limite, envio por `runCampaignDispatch`:

```
lote ao criar:  limit_per_run=null, offset=null, target_count=120
mensagens enviadas: 50    runs 'sent': 50
lote depois:    status=interrupted, "Interrompido: 70 lead(s) pendente(s) de envio.", sent_count=50
```

Esta é a linha de base vermelha: a prova da correção exige `120` no lugar de `50`.

## 2. Decisão: o limite vira opcional; lote sem fatia = público inteiro

Escolho **tornar o limite opcional (nulo = sem limite)** em vez de apenas avisar na tela.

Justificativa:
1. **Não há escolha do usuário para avisar.** O campo não existe na tela (fato 1). Um aviso pediria confirmação de um número que ninguém digitou.
2. **Já existe precedente no backend.** Campanha recorrente cobre o público inteiro e a cota do chip é o freio (`routes.js:2419`, `3223`).
3. **O freio anti-ban independe do limite.** Cota diária por chip, janela de envio e pausa com retomada no dia seguinte (`QUOTA_PAUSE_MARKER`) continuam valendo. "Sem limite" não é rajada: o lote avança por dias.
4. **Evita três números diferentes para o mesmo lote.** Hoje: criação 120, prévia 120, envio 50. Sem o fallback, os três coincidem.
5. **Não depende de schema.** A regra vive no lote, então nenhuma coluna nova e nenhuma migration (produção não roda migration no boot).

Quem quer limitar por vontade própria passa a ter um campo **opcional e visível**: "Enviar só os primeiros N" (vazio por padrão). Ele grava `limit_per_run` no **lote** e usa a mesma conta em `target_count`.

### Regra nova

- Limite do lote = `dispatch.limit_per_run` (nulo = público inteiro). **Remove-se o fallback para `campaign.limit_per_run`.** Lote em fatias (batching) sempre grava limite e offset, então não é afetado.
- Ocorrência recorrente continua ignorando limite.
- Uma única função, `resolveDispatchLeadLimit(dispatch, { isOccurrence })`, usada nos dois sites do fato 6 (hoje duplicados), em vez de espalhar a regra.

## 3. Mudanças previstas (escopo fechado)

Backend:
- `routes.js:3232` e `:5441`: usar a função única, sem `?? campaign.limit_per_run`.
- `POST /api/campaigns` (`:1307-1308`): sem `limitPerRun` no corpo, não inventar 50. Se a coluna for `NOT NULL` (ver medição R1), manter um valor numérico irrelevante para o envio.

Frontend:
- `LeadImports.tsx:1647-1653, 1682`: sem lotes, **não** enviar `limitPerRun` padrão.
- Passo de agendamento: linha com o número real, "**N leads vão sair**" (mesma conta do `target_count`). Com lotes: "N leads em K lotes de S". Com o limite opcional preenchido: "X de N leads (os outros N−X não saem)".
- `CampaignsTable.tsx:29`: a coluna "Leads" passa a vir dos lotes (soma de `target_count`), nunca de `campaigns.limit_per_run`.

Fora de escopo (registrado): o caminho legado `executeCampaignDispatch` (`dispatch.js:412, 617, 906`) continua cortando em `campaign.limit_per_run`. Ele convive com o caminho de lotes (dois sistemas de disparo vivos) e precisa de spec própria.

## 4. Provas exigidas

Todas por mutação no arquivo de produção (nunca no teste, nunca regex sobre texto-fonte): vermelho capturado, restauração com `cp`, `cmp`, verde capturado.

| # | Teste (Postgres real, pglite) | Mutação no arquivo de produção | Vermelho esperado |
|---|---|---|---|
| 1 | Campanha sem lotes, 120 leads, `limit_per_run` 50: lote criado pela rota real e enviado por `runCampaignDispatch` envia **120**, `target_count` 120, lote `done` | restaurar `?? campaign.limit_per_run` em `routes.js:3232` | 50 enviados, lote `interrupted` |
| 2 | Mesmo cenário por `run-pending` | restaurar o fallback em `routes.js:5441` | 50 enviados |
| 3 | Lote em fatia (limite 10, offset 0, público 120) segue enviando **10** | remover a leitura de `dispatch.limit_per_run` | 120 enviados |
| 4 | Limite opcional "só os primeiros 30": envia 30, `target_count` 30, lote `done` (não `interrupted`) | `target_count` ignorar o limite do lote | `target_count` 120 e lote `interrupted` |
| 5 | Cota continua sendo o freio: público 120, cota do chip menor que o público, lote pausa com o marcador de cota (cobrir com o mundo de `campaignChipQuota.test.js`) | remover a reserva de cota no envio | envia acima da cota |
| F1 | `SchedulingStep` com 120 leads e sem lotes mostra "120 leads vão sair" | voltar a exibir o default 50 | texto "50" |
| F2 | Payload de criar campanha sem lotes **não** carrega `limitPerRun` 50 | restaurar `\|\| 50` em `LeadImports.tsx:1647` | `limitPerRun` 50 no payload |

Além disso: `node --check` em todo arquivo de backend alterado, suítes inteiras de backend e frontend, `tsc` comparado ao `main` (mesmos 10 erros), e a contagem real de testes reportada.

## 5. Medição de raio (antes de implementar)

Pergunta do dono: quantas campanhas em produção têm `limit_per_run = 50` e público acima de 50, e quais.

Medida pelo lote, não por estimativa: o `target_count` do lote sem limite foi gravado com o público inteiro na criação (fato 5). Logo, "campanha com limite 50, lote com `limit_per_run` nulo e `target_count > 50`" é exatamente o conjunto cortado. O comando foi entregue ao dono na conversa; o resultado entra aqui quando chegar.

Medição R1 do mesmo comando confirma se `campaigns.limit_per_run` e `campaign_dispatches.limit_per_run` aceitam nulo (decide só a nota do `POST /api/campaigns`; a regra nova não depende disso).

Lotes já cortados ficam `interrupted` com "N pendentes". Com a SPEC 13 em produção, **Retomar** funciona nesses lotes e, com a regra nova, enviaria o restante de uma vez. Decisão do dono, campanha a campanha: leads que ficaram sem envio há semanas podem estar frios.

## 6. Decisões que dependem do dono

1. Aprovar "limite opcional, nulo = público inteiro" no lugar de apenas avisar.
2. Lotes **já agendados** (`draft`/`scheduled`) com `target_count > 50` passam a enviar o público inteiro, que é o número que a tela mostrava na criação. Aprovar, ou congelar esses lotes.
3. O que fazer com os lotes já cortados (lista da medição): retomar, ignorar ou reimportar o restante.

## 7. Decisões do dono, medição de raio e desvios da implementação (27/10, noite)

### Medição de raio (bk-vexo, 21:40Z)
- R1: `campaigns.limit_per_run` e `campaign_dispatches.limit_per_run` aceitam nulo. **`campaigns.limit_per_run` tem DEFAULT 50 no banco.**
- R2: 10 campanhas com limite 50; **0 campanhas cortadas, 0 lotes cortados, 0 tenants.** R3: nenhuma linha.
- Leitura: o defeito é real e reproduzido, mas **ainda não cortou nenhuma campanha em produção** pelo critério medido (lote sem limite com `target_count > 50`). Lotes com `target_count` nulo ou 0 não entram nesse critério.

### Decisões
1. **Aprovado:** limite opcional, nulo = público inteiro.
2. **Recusado como estava:** lote que já existe não muda de comportamento no deploy. Entra o bloco "backfill": `backend/src/scripts/backfillDispatchLimit.js` grava no lote o limite efetivo de hoje (`COALESCE(d.limit_per_run, c.limit_per_run)`), um UPDATE atômico, **antes** do código novo; a regra nova vale só para lote criado depois do deploy. Só toca em `limit_per_run`; ignora ocorrência recorrente; idempotente; dry-run por padrão.
3. **Lotes já cortados:** nenhum retomar em massa e nenhuma migração de status. R3 veio vazio, então não há lista a decidir.
4. **Legado:** ver "Legado" abaixo.
5. **Janela:** a SPEC muda volume de envio, então não sobe em dia útil.
6. `SchedulingStep.tsx` não foi tocado (o texto dos rótulos é decisão do dono).

### Desvios em relação à seção 3 (e por quê)
- **`campaigns.limit_per_run` continua sendo gravado (default 50).** Não escrevo NULL no `POST /api/campaigns`. O valor deixou de ser limite de envio, mas `startNextCampaignLeadInQueue` (`dispatch.js`, fluxo de resposta, ativo) o usa como cerca (`buildDispatchLeads({ limit: campaign.limit_per_run })`). Anular a cerca deixaria a conclusão de uma resposta iniciar leads ainda não enviados, fora do lote, sem cota nem janela.
- **O aviso não ficou dentro do `SchedulingStep.tsx`** (decisão 6): é o componente novo `DispatchVolumeNotice.tsx`, montado logo acima dele em `LeadImports.tsx`.
- **Achado extra, corrigido:** `handleEditCampaign` ligava o loteamento sempre que `c.limit_per_run` existia (sempre existe). Toda edição abria como "lotes de 50" e o Disparar agora criava "Lote 1/1" com `limitPerRun: 50`. Agora só liga se a campanha já tem mais de um lote.
- Prova de frontend F2 (payload sem `limitPerRun: 50` no POST da campanha) foi trocada por prova no POST do **lote**, que é onde o valor decide o envio.
- A prova 5 (cota como freio) não ganhou teste novo: a cobertura existente de cota (`campaignChipQuota`) segue verde.
- Um teste antigo (`compactCardsAndStableColor`) fixava "quantos leads = limit_per_run"; foi atualizado para ler os lotes. É mudança de comportamento intencional.

### Ordem de deploy (fim de semana)
1. Janela sem atividade e `activeDispatchesCount` = 0.
2. `node src/scripts/backfillDispatchLimit.js` (dry-run) e conferir a contagem.
3. `node src/scripts/backfillDispatchLimit.js --apply`; esperado: "restantes ... 0".
4. Merge e deploy do código. **Nunca rodar o backfill depois do deploy.**
5. Risco conhecido: lote criado por código velho entre os passos 3 e 4 ficaria sem limite e enviaria o público inteiro. Por isso a janela sem atividade.
