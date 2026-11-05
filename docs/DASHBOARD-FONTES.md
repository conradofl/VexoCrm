# Dashboard — fontes de cada número

Fase 0 do redesenho do Dashboard. Base: `origin/main` em `f4514a8e` (31/10/2026).
Critério de aceite: `VEXO-REGRAS-DASHBOARD.md` (20 regras do dono, 19/10/2026).

**Regra deste documento:** indicador sem linha aqui não entra na tela. Cada linha
diz a pergunta que o número responde, a tabela e a coluna exatas, e o que a tela
mostra quando o dado não existe.

**Regra de ouro da tela:** campo sem dado mostra travessão (—) e uma frase curta
dizendo por quê. É proibido mostrar zero onde o certo é "não medido".

Tudo aqui foi levantado por **leitura de código**. Nenhum número de produção foi
medido para este documento; onde um número aparece, a origem está dita ao lado.

---

## 1. Definição única de "respondeu" (decidida em 31/10/2026)

**Respondeu = PESSOAS, não envios.**

```
COUNT(DISTINCT telefone canônico do envio)
  dos envios de campanha (campaign_dispatch_runs, status = 'sent')
  que receberam resposta em até 14 dias:
    lead_messages do mesmo tenant,
    direction = 'inbound' OR engagement_signal = 'reply',
    telefone cru OU canônico igual ao do envio,
    COALESCE(message_timestamp, delivered_at, created_at) > sent_at
      e <= sent_at + 14 dias
```

- O pedaço "este envio foi respondido?" mora num lugar só:
  `sqlRunRepliedWithinWindow()` em `backend/src/services/messageEffectiveness.js`.
- **Taxa de resposta** = pessoas que responderam ÷ pessoas que receberam envio
  no período. As duas contagens saem da mesma consulta. Dividir por "Enviados"
  misturaria unidades (envios no denominador, pessoas no numerador).
- **"Enviados" continua contando envios.** É outra pergunta ("quantas mensagens
  saíram"), e a tela tem que dizer "envios", não "pessoas".
- O período de uma pessoa é o do envio respondido. Quem recebeu envio nos dois
  períodos e respondeu nos dois aparece nos dois. Isso é coorte, não duplicata.

### Por que muda o número, e para que lado

Antes, o Dashboard fazia `COUNT(*)` sobre os envios respondidos. Quem recebeu
3 envios e respondeu contava **3**. O cartão de Campanhas
(`domains/campaigns/routes.js`, consulta do `replied_count`) já fazia
`COUNT(DISTINCT r.phone)` e contava **1**.

A conta registrada pelo dono em 19/10 (em `VEXO-REGRAS-DASHBOARD.md`, seção
"Pré-requisito"): **Dashboard 42, cartão da campanha 32** para o mesmo fato.
Pela leitura do código, a diferença de 10 são respostas a mais vindas de pessoas
que receberam mais de um envio. **Essa explicação não foi medida.** E existe
mais uma diferença que pode entrar na conta: o cartão não filtra período, o
Dashboard filtra. A medição que fecha isso está na seção 6.

**Efeito na tela: "Responderam" cai** (ou fica igual, se ninguém recebeu dois
envios). A taxa pode subir ou cair, porque numerador e denominador passam a ser
pessoas. Os rankings de mensagem, chip e região também passam a contar pessoas.

### O que morreu junto

- **Terceira definição**, no "perfil que mais converteu"
  (`dashboardAnalysis.js`, `measureTopProfiles`): contava qualquer mensagem do
  lead, a qualquer tempo, sem janela e sem envio. Agora usa a mesma regra: o lead
  da coorte "respondeu" se respondeu a um envio de campanha em até 14 dias.
  Consequência que precisa estar na tela quando ela for refeita: **lead que
  chegou escrevendo sozinho não "respondeu", ele "chamou"**. São perguntas
  diferentes.

### O que NÃO foi unificado neste PR (pendente)

- **Relatório de eficácia de mensagens** (`buildMessageEffectivenessSql`, tela
  de Campanhas) continua contando envios respondidos. É uma tela fora do
  Dashboard, com testes e consumidores próprios. Deve seguir a mesma definição,
  em PR separado.

---

## 2. Indicadores da tela atual

Legenda da coluna Situação: **OK** = fonte confiável · **DIVERGE** = fonte existe,
número não bate · **INVENTADO** = sem fonte, hoje a tela inventa.

| Indicador | Pergunta | Fonte exata | Sem dado mostra | Situação |
|---|---|---|---|---|
| Enviados | Quantas mensagens de campanha saíram? | `campaign_dispatch_runs`, `status='sent'`, `sent_at` no período | "Indisponível" (bloco em `unavailableBlocks`) | OK, só campanha. Rótulo tem que dizer "envios de campanha": follow-up não entra. Envio sem run (divergência 7) não aparece por construção. |
| Responderam | Quantas pessoas responderam? | Seção 1 | "Indisponível" | **Corrigido neste PR** (era DIVERGE). |
| Taxa de resposta | Que fração das pessoas alcançadas respondeu? | Seção 1 | "—" se o bloco caiu | **Corrigido neste PR.** Ainda mostra 0% com zero pessoas alcançadas; o certo é "—, nenhum envio no período". Fica para a tela nova. |
| Variação (delta) de todos os cards | Melhorou ou piorou contra o período anterior de mesma duração? | `calculateDelta(atual, anterior)` | **"sem base de comparação"** se o anterior é 0; "—" se é desconhecido | **Corrigido neste PR** (era INVENTADO: +100% a partir de zero). |
| Agendaram reunião | Quantos agendamentos no período? | `followup_schedules.created_at` (via `followup_companies.tenant_id`) + `crm_consultant_schedules.created_at` | "Indisponível" | DIVERGE: não filtra cancelado (o perfil filtra `status <> 'canceled'`); achado de 02/10 diz que conta link de consultor (não remedido). |
| Propostas criadas (GD) | Quantas propostas no período? | `gd_proposals.created_at`, tenant em `::text` | Card some se o tenant não usa GD; "Indisponível" se não deu para saber | OK. |
| Contratos fechados (GD) | Quantos contratos assinados no período? | `gd_contracts`, `status IN ('assinado','fechado','signed')`, `updated_at OR created_at` no período | idem | DIVERGE: contrato editado depois de assinado conta de novo no período da edição. Precisa de data de assinatura. |
| Fechamentos | Quantas vendas ganhas no período? | `lead_conversions`, status ganho, `COALESCE(closed_at, updated_at)` | "não se aplica" se a tabela não existe | DIVERGE quando `closed_at` é nulo (mesmo efeito do contrato). |
| Ranking de mensagens | Qual campanha faz mais gente responder? | Seção 1 por `campaign_id`; mínimo 30 envios | "Indisponível" | **Corrigido neste PR** (pessoas). `sent_count` segue em envios, `reached_count` é pessoas. A tela atual ainda mostra envios ao lado da taxa de pessoas: arrumar na tela nova. |
| Ranking de chips | Qual chip enviou e quantos responderam? | `campaign_dispatch_runs.evolution_instance_id`; cota em `evolution_instance_daily_usage.sent_count` (hoje) | "Indisponível" | Respostas **corrigidas** (pessoas). DIVERGE: `chip_state` nulo vira `'cold'` e pode disparar aviso de chip frio. Tela faz `chipsUnattributedSent ?? 0`: esconde indisponível como 0. |
| Envios sem chip registrado | Quantos envios não sabem qual chip saiu? | `campaign_dispatch_runs.evolution_instance_id IS NULL` | deveria ser "—"; hoje a tela mostra 0 | DIVERGE (só na tela). Volume em produção não medido. |
| Ranking de região | Onde a campanha funciona melhor? | DDD tirado de `campaign_dispatch_runs.phone`; cidade de `leads.cidade` | "Indisponível" | **Corrigido neste PR** (pessoas). Telefone `5500…` cai em "Outro". |
| Motivos de falha | Por que os envios falharam? | `campaign_dispatch_runs.status IN ('failed','invalid_number')` + regex no `error_message` | "Indisponível" | DIVERGE: causa adivinhada por texto ("http 400" vira "número inexistente", "timeout" vira "chip fora do ar"). |
| Leads que chegaram (temperatura e estágio) | Quantos leads entraram e como estão? | `leads.created_at`, `SQL_LEAD_TEMPERATURE_BUCKET`, `leads.stage` | "Indisponível" | OK. |
| Pararam depois da primeira resposta | Quem respondeu o primeiro passo e sumiu? | `lead_messages` com `campaign_id` (saída) e inbound | "—" se ninguém recebeu o passo seguinte | Não verificado: depende de `lead_messages.campaign_id` ser gravado no envio. |
| Perfil que mais converteu | Que tipo de lead responde, agenda e fecha? | coorte `leads.created_at`; respondeu pela seção 1; agendou em `followup_schedules` não cancelado; fechou em `lead_conversions` | "Indisponível" | **Corrigido neste PR** (respondeu). |
| Saúde da base | Quanto da base é contatável e nunca foi tocado? | `leads` até o fim do período, regex de telefone válido, `lead_messages` saída e `campaign_dispatch_runs` | "Indisponível" | OK. Exclui `5500…` e LID. |
| Nunca abordados (card de parados) | idem, outra conta | `leads.last_message_at IS NULL AND last_interaction_at IS NULL` | — | DIVERGE: **duas definições na mesma tela** (esta e a da saúde da base). Fica uma só na tela nova: a da saúde da base. |
| Leads parados | Quem está em conversa sem resposta há dias? | `/api/leads/stalled`, `leadReactivationEngine` (dias desde `last_interaction_at`) | **"Leads parados: —" + motivo** | **Corrigido neste PR** (era INVENTADO: erro virava "SLA 100% em dia" verde). |
| Esperando resposta / tempo até a 1ª resposta humana | Tem alguém esperando por mim? | `measureFirstHumanResponse` | "Indisponível" | DIVERGE nos dois sentidos. Definição nova na seção 4. **Não muda neste PR.** |
| Links clicados / CTR | Quem clicou nos links? | `smart_links.clicks_count`, `created_at >= NOW() - N dias` | 0 (errado) | DIVERGE: "este mês" vira 30 dias; intervalo personalizado é contado a partir de hoje, não das datas escolhidas. |
| Aviso "chip com inválidos acima do normal" | Preciso limpar a lista? | falhas por categoria ÷ (envios + falhas) do tenant, limiar fixo 15% | não aparece | INVENTADO no rótulo: não é por chip, e "normal" é um 15% fixo. |
| Progresso de implantação | O que falta configurar? | `useOnboardingProgress` | — | Não rastreado. Não entra no dashboard novo sem linha aqui. |

---

## 3. As sete divergências conhecidas

| # | Divergência | Situação depois deste PR |
|---|---|---|
| 1 | "Respondeu" com duas (três) definições | **Fechada no Dashboard.** Pendente no relatório de eficácia (seção 1). |
| 2 | replyRate com telefone cru no EXISTS | O Dashboard já comparava cru OU canônico. O import-audit não foi lido nesta fase: segue aberto. |
| 3 | Tenant sumia por `uuid = text` | Fechada no código (`::text` dos dois lados; só `42P01` é "tabela ausente"). |
| 4 | `target_count` fabrica "N pendentes" | Não aparece no Dashboard atual. Vira bloqueio quando a fila de disparo entrar no Bloco 1: o card tem que ler o mesmo campo que o agendador. |
| 5 | Run não grava o chip | Coluna `evolution_instance_id` existe e o backend separa "sem chip registrado". Tela mostra 0 quando indisponível (seção 2). Volume não medido. |
| 6 | Telefone fabricado `5500…` | Saúde da base exclui; região joga em "Outro"; Enviados conta normalmente. Volume não medido. |
| 7 | Envio duplicado sem registro | Invisível por construção: o Dashboard só vê o que tem run. Card nenhum pode afirmar "sem duplicata". |

---

## 4. "Esperando resposta" — proposta de definição (NÃO implementada)

Este vira o card herói do Bloco 1. A definição de hoje
(`measureFirstHumanResponse`) erra nos dois sentidos:

- **Perde quem volta a escrever.** Olha só a *primeira* mensagem do lead no
  período; qualquer resposta humana depois dela marca a conversa como respondida.
  Lead atendido de manhã que escreve de novo à tarde e fica 16h sem resposta
  não aparece.
- **Conta conversa bem atendida pela IA como esperando.** Resposta do robô
  (`sender_type = 'bot'`) não conta.

### A pergunta que decide

> Resposta do robô conta como resposta?

Posição do dono (31/10): **conta para "o lead foi respondido" e NÃO conta para
"alguém da equipe precisa olhar". São dois números.**

### Unidade e ponto de partida (comum aos dois)

- **Conversa** = (tenant, telefone canônico) em `lead_messages`, sem grupo
  (`is_group IS NOT TRUE`).
- Olha o **fim** da conversa, não o começo do período. "Esperando desde" = a
  primeira mensagem do lead depois da última resposta que conta. É isso que pega
  o caso das 16h.
- **Envio de campanha não é resposta.** Saída com `campaign_id` preenchido é
  disparo, não atendimento: não zera a espera.

### Número A — "Lead sem resposta nenhuma"

Conversa cuja última mensagem é do lead e não tem **nenhuma** saída depois
(robô, equipe ou celular), descontado disparo de campanha.

- Pergunta: alguém ficou no vácuo, inclusive do robô?
- Pega também o agente mudo (robô ligado que não respondeu): é falha, não espera
  normal.

### Número B — "Precisa de alguém da equipe" (o herói)

Conversa em que o lead escreveu depois da última resposta **humana**
(`sender_type IN ('agent','device')`) **e** o robô não vai responder por desenho.
O robô "não vai responder" quando:

1. a conversa está pausada para atendimento humano
   (`whatsapp_chat_states.agent_muted_at` preenchido com
   `agent_muted_source = 'manual'`, ainda não expirada pela regra de
   `agent_pause_expiry_days`); ou
2. o chip da conversa não tem agente ligado; ou
3. o robô se silenciou por conversa não-comercial
   (`agent_muted_source = 'classificador'` ou nulo).

Sem a restrição "o robô não vai responder", toda conversa que o robô conduz
sozinho entraria em B para sempre, e o número perderia o sentido.

- Mostra: quantas conversas e **há quanto tempo está a mais antiga**.
- Vermelho acima de 2h.
- Clique abre a lista.

### Decisões que faltam antes de escrever o SQL

1. **Item 3 entra em B?** Conversa pessoal no chip da empresa (o robô calou por
   não ser comercial). A pessoa está esperando alguém, mas talvez não "a equipe".
2. **As 2h contam no relógio ou no horário comercial?** No relógio, toda
   mensagem das 22h chega vermelha às 8h do dia seguinte.
3. **Janela de corte.** A conversa que termina num "obrigado" do lead fica
   "esperando" para sempre: não existe marcador de conversa encerrada. Proposta:
   só mensagens do lead dos últimos 7 dias.
4. **Item 2 precisa de fonte.** Hoje não existe gravado em `lead_messages` por
   qual chip a mensagem entrou de forma confiável para cruzar com o agente do
   chip. Sem isso, B nasce só com 1 e 3, e a tela diz que o item 2 não é medido.
5. **LID (`@lid`).** Conversa sem telefone: entra na contagem, mas o botão
   "abrir no WhatsApp" não funciona para ela.

---

## 5. Indicadores pedidos para a Fase 1 que ainda não têm linha

Não entram até ganhar linha na seção 2:

- **Chips conectados (N de M).** Cadastro (`lead_client_evolution_instances`) não
  é conexão. A varredura (`VARREDURA-MENSAGENS.md`, itens 2.6 e 2.7) mostra que o
  sistema já confunde os dois. Precisa de fonte de estado de conexão.
- **Fila de disparo** (quantos na fila, próximo lote, parado por janela).
  Depende da divergência 4.
- **Agente IA ligado/parado e conversas pausadas.** Pausas em
  `whatsapp_chat_states` (seção 4); "ligado" por chip a mapear.
- **Consumo do plano em atendimentos.** "Atendimento" não tem definição gravada
  hoje. `llm_usage` mede token, e token é proibido na tela do cliente.
- **Receita.** Não há integração financeira. Não entra: "R$ 0" seria mentira.

---

## 6. Medição pendente em produção

O 42 contra 32 é o registro do dono, não uma medição deste trabalho. Para fechar,
rodar no Console do Serviço do **bk-vexo**, trocando `TENANT` e `CAMPANHA`:

```
node -e 'const {Pool}=require("pg");const p=new Pool({connectionString:process.env.DATABASE_URL});const w="(lm.direction = \x27inbound\x27 OR lm.engagement_signal = \x27reply\x27) AND COALESCE(lm.message_timestamp,lm.delivered_at,lm.created_at) > r.sent_at AND COALESCE(lm.message_timestamp,lm.delivered_at,lm.created_at) <= r.sent_at + interval \x2714 days\x27";p.query("SELECT now() AS medido_em, COUNT(*) FILTER (WHERE rep)::int AS envios_respondidos, COUNT(DISTINCT phone) FILTER (WHERE rep)::int AS pessoas_cru, COUNT(*)::int AS envios, COUNT(DISTINCT phone)::int AS pessoas_alcancadas FROM (SELECT r.phone, EXISTS (SELECT 1 FROM public.lead_messages lm WHERE lm.client_id = r.client_id AND lm.phone = r.phone AND "+w+") AS rep FROM public.campaign_dispatch_runs r WHERE r.client_id = $1 AND r.campaign_id = $2 AND r.status = \x27sent\x27 AND r.phone <> \x27\x27 AND r.sent_at IS NOT NULL) x",["TENANT","CAMPANHA"]).then(r=>{console.log(JSON.stringify(r.rows[0]));return p.end()}).then(()=>process.exit(0)).catch(e=>{console.error(e.message);p.end().finally(()=>process.exit(1))})'
```

Esta versão compara só o telefone cru, para ficar curta. Ela dá o **piso**:
`envios_respondidos` corresponde à definição antiga, `pessoas_cru` à nova. Se
`envios_respondidos − pessoas_cru` der 10 na campanha do 42/32, a explicação da
seção 1 está provada. Repassar o número só com a query e o `medido_em`.

---

## 7. O que este PR mudou

| Arquivo | Mudança |
|---|---|
| `backend/src/services/messageEffectiveness.js` | `sqlRunRepliedWithinWindow()`: o pedaço único "envio respondido em 14 dias". |
| `backend/src/services/dashboardCalculations.js` | Responderam, taxa e rankings (mensagem, chip, região) contam pessoas; payload ganha `reached`/`previousReached` (pessoas alcançadas); `calculateDelta` devolve `null` sem base. |
| `backend/src/services/dashboardAnalysis.js` | Perfil que converte: "respondeu" pela definição única. |
| `frontend/src/lib/dashboard/formatters.ts` | `formatDelta` diferencia "sem delta" (`isMissing`) de 0%. |
| `frontend/src/pages/Dashboard/Block1WhatHappened.tsx` | Selo mostra "sem base de comparação" (anterior 0) ou "—" (desconhecido). |
| `frontend/src/components/dashboard/StalledLeadsAlertCard.tsx` | Sem resposta da API: "Leads parados: —" + motivo. Verde só com contagem medida igual a zero. |

Nenhuma tela nova. Os textos da tela atual que mudaram são só o selo de variação
e o card de parados.
