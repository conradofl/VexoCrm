# Lista de leads do Banco de Dados: filtro, ordenação, contagem e paginação no SQL (05/10/2026)

Origem: "a tela de leads só enxerga 2.000" (base do cliente: 24.512 leads).

## Causa

1. `GET /api/leads` filtrando por **tag** ou **busca** usava `.contains()` e `.or("nome.ilike…")` da camada de compatibilidade
   (`backend/src/pgSupabaseCompat.js`), que **não tinha `.contains()`** e só entendia `eq` e `is.null` dentro de `.or()`. A consulta lançava,
   caía num `catch` que **registrava um `console.warn` e devolvia as 2.000 primeiras linhas SEM filtro**. A tela mostrava "tag X" e os
   números de uma lista que nunca foi filtrada.
2. A tela refazia **no navegador** filtro, abas, contagens, origens e paginação sobre essa lista de até 2.000 linhas.
3. Os totais (faixas do Potencial) vinham de `select("*")` da **tabela inteira contado no Node**.

O pedido sem filtro nunca teve teto no servidor (devolve todas as linhas). O "Todas (2000)" visto em produção **não foi reproduzido**
localmente; a linha de log `[leads] Advanced query failed…` do servidor de produção é o que o explicaria (agora é `console.error` e a
resposta traz `degraded: true`).

## O que mudou

| Antes | Agora |
|---|---|
| Lista inteira ou 2.000 sem filtro | `GET /api/leads?page=&limit=` devolve **uma página** + `total` + `tabs`, tudo no SQL (`services/leadListQuery.js`) |
| Abas contadas no navegador | `tabs` = `COUNT` do banco **dentro do filtro de tag e busca** |
| Cartões de origem sobre a lista carregada | `GET /api/leads/facets`: **base inteira**, agregada no banco |
| `select("*")` + contas no Node | `queryBaseFacets` (agregação SQL) |
| Selecionar todos / disparo por origem sobre a lista carregada | `GET /api/leads/ids` (todos os ids da combinação de filtros) |
| Público do assistente de campanha em JS | `POST /api/leads/audience` (estágios, tag, regras escalares) |
| Abrir `?leadId=` só se estivesse na lista | `GET /api/leads/lookup` (id ou telefone) |
| Exportação com `.limit(5000)` calado | `GET /api/leads/export` percorre a combinação **inteira**, em blocos |
| Fallback calado | resposta `degraded: true` + `degradedReason`; a tela mostra o aviso |

Paginação é **opt-in**: sem `page`/`limit` o contrato é o de sempre (lista inteira), agora com filtros funcionando e `degraded` no corpo.

## Regras (decisões do dono, 05/10/2026)

- **Leads Frios** = tudo que não é comprador, orçamento aberto nem perdido (o complemento). "Em dúvida" **não** foi resolvido aqui.
- **Cartões de origem e Potencial da Base**: sempre a base inteira. **Abas**: dentro do filtro ativo de tag e busca. **Total da lista**: a
  combinação de todos os filtros. Sem filtro, os três coincidem.
- **Ordem por nome**: ICU, `pt-BR-x-icu` quando o banco tem (produção tem), senão `und-x-icu`. Paridade com `localeCompare` provada em
  teste (acento, cedilha, caixa mista). A diferença entre a raiz e `pt-BR` **não foi medida em produção**: ver a query do dono abaixo.
- **Aba "Orçamentos Abertos"**: antes mostrava `summary.openBudgetsCount` (inclui `status = 'orcamento'`); a lista filtrava só
  `stage = 'open_budget'`. Agora aba e lista contam a mesma coisa (`stage`). O card "Em negociação" do Potencial continua incluindo
  `status = 'orcamento'` (regra das três faixas, inalterada).
- A busca agora também procura em `raw_chat_summary` no servidor (a tela já fazia isso no navegador; o servidor só olhava nome e telefone).
  Texto com `%` ou `_` é literal.

## Regras dinâmicas do assistente de campanha (diagnóstico)

O JavaScript antigo aplicava `String(valor)` a qualquer campo. Em `dados` (jsonb) isso dá `"[object Object]"`; em `tags` (array) dá
`"a,b"`. **Essas regras nunca funcionaram** (nenhuma comparação de texto faz sentido com isso).

- Campanhas existentes com esse tipo de regra: **nenhuma**. O assistente do funil **não tem interface para criar regras**
  (`setCampaignFunnelFilterRules` nunca é chamado) e as regras não são persistidas. As regras da ramificação de planilha são colunas do
  arquivo, avaliadas no navegador, e não foram tocadas.
- O servidor aceita regra só em colunas escalares de uma lista fechada (`RULE_COLUMNS` em `leadListQuery.js`). Regra em outro campo é
  **recusada com 400 `UNSUPPORTED_RULES` dizendo qual coluna**, e a tela mostra o motivo. Nunca devolve "0 leads" calado.
- `gt`/`lt` reproduzem exatamente `parseFloat(valor.replace(/[^\d.,-]/g, "").replace(",", "."))` (teste de paridade com a transcrição
  do código antigo).

## Importação do Banco (B e C)

- B: a importação feita pelo Banco passa a ser **registrada em `lead_imports` + `lead_import_items`**, o mesmo lugar da tela de Planilhas
  (a Campanhas lista a planilha com os leads), com o **nome do arquivo**, total de linhas e totais de telefone. Texto colado da IA usa nome
  descritivo ("Texto colado (IA) — dd/mm/aaaa hh:mm"); nunca inventa nome de arquivo.
- C: arquivo grande entra em **lotes de 500** (`/api/leads/import-batches/{open,:id/batches,:id/close,:id/progress}`), sem subir o limite de
  15 MiB do `express.json`. O id da **abertura** vai em `dados.import_ids` de cada lead (a exclusão em massa por importação segue exata).
  Cada lote grava os leads **antes** de registrar o lote (se cair no meio, o ponto de retomada não avançou e o reenvio conserta; o upsert por
  telefone é idempotente).
- Importação aberta pelo Banco é recusada pelas rotas da tela de Planilhas (409 `IMPORT_MODE_MISMATCH`), porque essas só registram itens e
  não criariam os leads. Reenviar a planilha pelo Banco não duplica leads.

## Custo da classificação de canal (06/10/2026)

**Sintoma em produção:** `GET /api/leads/facets` → parte `channels` com `Query read timeout` (30 s, `pgSupabaseCompat.js:70-71`), base de 24.655 leads.
As outras três partes (resumo, origens, tags) respondiam. O diagnóstico só foi possível porque o facets passou a degradar por parte e a devolver a causa.

**Causa (reproduzida e medida, pglite, 25 mil leads):** `_s = btrim(lower(_source COLLATE …), …)` ficava num CTE que o planejador do Postgres
"achata": o `lower()+btrim()` era **substituído em cada uma das ~30 referências** da cadeia de canais (`position(...)`, `LIKE`), ou seja,
~30 vezes por linha. **A collation ICU não é o custo**: com `lower()` comum o tempo era o mesmo.

| Consulta (25 mil leads) | Antes | Depois |
|---|---|---|
| `channels` (cartões de origem) | 3.270 ms | 145 ms |
| `summary` | 46 ms | 48 ms |
| `sources` | 147 ms | 146 ms |
| `tags` | 18 ms | 18 ms |
| as 4 em paralelo (uma conexão) | 3.393 ms | 364 ms |
| `lower()` ICU × comum, nos cartões | — | 144 ms × 142 ms (2 ms, 1,4%) |

(pglite não é o Postgres de produção: valem os tempos relativos, não os absolutos. EXPLAIN ANALYZE em produção, quem roda é o dono — abaixo.)

**O que mudou:** (1) os cartões classificam cada ORIGEM DISTINTA uma vez (agrupa antes: poucas centenas de origens em vez de 25 mil linhas) e somam as
contagens — o canal é função só da origem; (2) `_s` fica atrás de uma cerca `OFFSET 0`, calculado uma vez; (3) cada consulta monta só as
colunas derivadas que usa (resumo não monta origem nem canal; lista sem filtro de origem/canal/faixa não monta nenhuma). O piso agora é o `EXISTS … ~*`
sobre as tags (a consulta de origens, 146 ms). Timeout NÃO foi aumentado.

**Collation em `_s` — mantida, de propósito.** Pedido: trocar por `lower()` comum se o resultado não mudar. Medido: o ganho é de 2 ms (nada), e o resultado
**diverge em 2 de 65 valores** do corpus (fixture `shared/leadOrigins.json` + acentos/caixa variada): `İstanbul` (i com ponto turco) e `ΣΊΣΥΦΟΣ` (sigma final).
Nenhum é origem real, mas a ICU bate com o `toLowerCase()` do JavaScript nos 65, e o `lower()` comum não. Sem ganho e com divergência, não troquei.
(No pglite `datctype` é `C.UTF-8`, que dobra acento; em produção é `en_US.utf8`, medido pelo dono.)

**Medição em produção (somente leitura, dono):**
```sql
EXPLAIN (ANALYZE, BUFFERS) <bloco 2, channels>;   -- o SQL novo, com 'geracao-digital'
```
e, se quiser conferir que `lower()` comum e ICU coincidem nas origens REAIS:
```sql
SELECT DISTINCT lead_source AS v FROM public.leads WHERE client_id = 'geracao-digital' AND lead_source IS NOT NULL
 AND lower(lead_source) <> lower(lead_source COLLATE "pt-BR-x-icu");
```

**`\v` dentro do `E'…'` — medido e descartado (06/10/2026).** A dúvida era se o Postgres de produção entendia `\v` (tabulação vertical) no
literal `E' \t\n\r\f\v…'` do `btrim`; se tratasse como a letra `v`, `vendas_fechadas` viraria `endas_fechadas` na classificação de canal.
O dono mediu em produção: `SELECT ascii(E'\v');` → **11**. O escape é entendido corretamente e o `btrim` não come a letra "v". **Sem correção.**

**A saída definitiva é outra leva:** a classificação de canal é calculada **por linha, em toda leitura**. Mesmo com o custo caído de 30 s para centenas de
milissegundos, é trabalho que cresce com a base. O certo é gravar o canal no lead quando a origem muda, e ler a coluna.

## Procedência × rótulo da IA × marcação da pessoa; campanha por planilha (06/10/2026)

**O defeito:** o campo `tags` guardava três coisas: procedência (nome do grupo extraído, `agenda-whatsapp`, `WhatsApp WA`, `#Imp-…`), palpite da IA/heurística
(`Orçamento`, `Follow-up`, `Energia Solar`…) e marcação da pessoa. Medido em produção (`geracao-digital`, 24.655 leads): 6 tags de planilha (18.279 marcações,
73 leads com mais de uma), `agenda-whatsapp` 5.050, grupos (`VP Ofertas` 1.011, `Via Permuta 🇧🇷` 437…), 8 rótulos da IA.

**Aditivo, nada removido.** Nenhuma tag foi alterada ou removida (o dono tem filtros e campanhas em cima delas; `VP Ofertas` tem 1.011 leads).

- **Bloco 1 — campanha por planilha.** O assistente de campanha ganhou "Filtrar por Planilha importada" (`lead_imports`, rota do Banco `GET /api/leads/import-sources`). O público sai de
  `dados.import_ids` (procedência verdadeira: não editável, não acumula por engano). Antes de confirmar, a tela mostra os dois números: quantos leads **nasceram** na importação e quantos
  **já existiam** e foram atualizados por ela (`GET /api/leads/import-origin`); padrão = todos, com recorte "só os que nasceram" / "só os que já existiam". Combina em E com estágio e tag.
  **Como se distingue:** `dados.import_ids` guarda toda importação que tocou o lead; o que separa os dois grupos é `leads.created_at` contra `lead_imports.created_at` (lead criado depois da
  abertura = nasceu; antes = já existia), com tolerância de 10 s entre o relógio do app (que carimba o lead) e o do banco (que carimba a abertura) — sem ela, importação de 1 linha cairia do lado errado.
  Limite conhecido: lead criado por outro caminho nos 10 s anteriores à abertura conta como "nasceu". Importações anteriores à correção de 05/10 não têm registro em `lead_imports` e não aparecem no seletor.
- **Bloco 2 — seletor de tags agrupado.** Planilhas (prefixo `#Imp-`), Grupos e origem (`agenda-whatsapp`, `WhatsApp WA`, nomes que batem com `dados.grupo_nome` de algum lead da MESMA empresa),
  Rótulos da IA (lista fechada), Minhas (o resto). O servidor classifica (`kind` em cada tag do facets); nenhum dado muda e nenhuma tag some (teste: a lista agrupada é uma partição da lista original).
  Uma marcação da pessoa idêntica a um rótulo da IA (`Follow-up`) não é distinguível e aparece como rótulo da IA. Se a consulta dos nomes de grupo falhar, as tags continuam saindo (grupos caem em "Minhas") e a causa vai em `tagKindsCause`.
- **Bloco 3 — campo próprio.** `dados.procedencia = { grupos, agenda_whatsapp, conversa_whatsapp }` e `dados.rotulos_ia`, gravados daqui para frente pelos três pontos de extração (grupo, agenda, conversa) **além** das
  tags. Em `dados` (jsonb): sem migration de schema, os leitores continuam funcionando com ou sem o campo (DIRETRIZES §12). `procedencia` **acumula** nos três caminhos de upsert (o merge raso a sobrescreveria).
  Histórico: migration `20261006120000_backfill_lead_procedencia.sql` (idempotente, só acrescenta chaves em `dados`, não toca tags nem `updated_at`).
  **IA com lista fechada** (`AI_LABELS` em `services/leadProcedencia.js`): os 8 medidos em produção — Fechamento, Orçamento, Dúvida, Não Convertido, Óculos de Sol, Energia Solar,
  Prioridade alta, Follow-up. Ficaram de fora, por decisão do dono: `Campanha` (colide com o canal de marketing de mesmo nome) e `Prótese` (não existe em produção; a lista não nasce com
  vocabulário de um cliente só). Rótulo fora da lista não é gravado (nem tag, nem campo); `WhatsApp WA` (rótulo-padrão quando nada se aplica) é procedência (`conversa_whatsapp`), não palpite.
  **Pendência declarada (não é para fazer agora): a lista é GLOBAL e deveria ser POR EMPRESA** — `Energia Solar` e `Óculos de Sol` só fazem sentido para quem vende isso.

### Importações antigas: reconstrução (06/10/2026)

**Premissa corrigida pela medição de produção (06/10/2026).** Eu havia lido a captura do dono ("4 ids distintos em `dados.import_ids`") como "as planilhas só existem como tag". **Errado:** `lead_imports` já tinha
**23 linhas, com os nomes de arquivo reais** — a tela de Planilhas sempre registrou; quem não registrava era só a importação feita pelo Banco (corrigida em 05/10). Por isso a reconstrução criou apenas 3 linhas
(`INSERT 0 2`, `INSERT 0 1`, `UPDATE 4`: uma só precisou ligar leads, as 4 de `#Imp-LEAD_-_DESENVOLVIMENTO_PESSOAS`): faltava pouco, não era defeito. Executada em produção em 06/10 pelo dono, medindo antes com `ROLLBACK`
e gravando com `COMMIT`: **151 ms, 294 ms e 134 ms** (Postgres real). O script continua útil e idempotente; o seletor mostra as planilhas com os nomes de arquivo verdadeiros.

**Achado da mesma medição:** `3e2b960b…` (17.843 leads ligados) e `61417058…` (351) têm as mesmas 19.998 linhas e 19.998 itens: o MESMO arquivo importado duas vezes. A planilha tem duas colunas de telefone e o sistema só aceita uma;
o dono gerou dois arquivos. Só 351 empresas têm segundo número — as outras 19.647 linhas da segunda importação não viraram nada. Próxima leva: importação com mais de uma coluna de telefone
(uma linha = um lead; o primeiro telefone válido identifica; os demais ficam em `dados.telefones_extras`).

**Como o script foi desenhado (continua valendo):**

- **Fontes (as únicas sem palpite):** (1) id em `dados.import_ids` sem registro → o registro nasce com o MESMO id; (2) grupo de leads com a mesma tag `#Imp-…` → uma importação por (empresa, tag),
  só se algum lead do grupo não estiver em nenhuma importação com registro (grupo todo coberto já está representado: não duplica); (3) cada lead com a tag recebe o id da reconstruída em `dados.import_ids` (união).
- **Regras:** nome sintético e marcado ("Importação reconstruída — <tag em comum> (≈ dd/mm/aaaa)"), nunca nome de arquivo inventado; `source_type = 'reconstruida'`; total = leads encontrados e **é piso**;
  data = menor `created_at` do grupo e **é aproximada**; nada por palpite (sem quem importou, sem mapeamento, sem linhas puladas conhecidas, sem dados brutos, nenhum `lead_import_items`).
- **Na aplicação:** "nasceram / já existiam" **não vale** para elas (não existe hora de abertura): a tela mostra só "no mínimo N leads", diz por quê, e oferece só "todos"; o recorte é recusado
  pelo servidor (400 `IMPORT_SCOPE_UNAVAILABLE`). A tela de Planilhas **não** as lista (sem itens nem dados brutos não são fonte de campanha); o seletor da campanha do Banco sim.
- **Limite conhecido:** a tag é editável. A ligação é exata para quem TEM a tag, e só isso.

### Backfill de procedência/rótulos: fora do boot

`ops/sql/2026-10-06-backfill-procedencia.sql` (antes era uma migration que rodaria no boot) foi movido para `ops/sql/`: uma migration lenta atrasa a subida do servidor. **Ainda NÃO executado em produção** (aditivo; não bloqueia nada;
fica para quando o dono tiver tempo). A reconstrução, já executada, levou 134–294 ms em Postgres real — o que indica que o backfill também será rápido, mas isso não foi medido. Rodar no console psql, **medindo sem gravar**: `BEGIN; \timing on; <arquivo>; ROLLBACK;`. Só vira migration de boot se passar na medição (poucos segundos). Medido em pglite (WASM, limite superior): ver o resultado do
teste de custo. Os dois scripts são idempotentes e o código funciona com ou sem eles (os leitores não dependem do campo novo).

## Segunda tentativa por outro número — Bloco B (06/10/2026)

"Tentar o número adicional de quem não respondeu." A unidade é a **empresa** (o lead), não a linha telefônica. Código:
`backend/src/services/secondNumberAudience.js`, rotas `GET /api/leads/second-number/campaigns` e `POST /api/leads/second-number/audience`
(gate do Banco, escopo do operador), painel `frontend/src/components/leads/SecondNumberPanel.tsx` (terceira origem do assistente de campanha).

**O público:** recebeu a campanha escolhida (run `sent`), **não respondeu em nenhum número**, tem um telefone adicional que ainda não recebeu
essa campanha, e passou do prazo (dias depois do **último** envio). O disparo vai **só para o adicional** (o primeiro, na ordem da planilha). Os
dois números ao mesmo tempo só com a caixa marcada de propósito, com o aviso "é a mesma empresa recebendo duas vezes" (padrão: desmarcada).

**Resposta, no nível do lead e por qualquer número dele:** o principal, qualquer `dados.telefones_extras` e os números do lead referenciado em
`ja_existe_como_lead`. O cruzamento é **por telefone, nunca por `lead_id`**: a mensagem que chega de um número adicional entra com `lead_id` nulo
(o webhook só liga o lead quando `telefone` casa exato). Nada no webhook/roteamento mudou. Janela da resposta: **"até agora"** (qualquer momento
depois do envio daquela empresa); `replyWindowDays` existe só para provar a paridade com o relatório (14 dias) em teste.

**Definição única de "respondeu":** `REPLY_MESSAGE_FILTER_SQL` e `MESSAGE_TIMESTAMP_SQL` saíram de `buildMessageEffectivenessSql` (mesma saída) e o serviço
as importa; teste de código-fonte trava que o serviço não tem cópia (`direction = 'inbound'`, `engagement_signal`, `message_timestamp` não aparecem nele).
Telefone: `SQL_CANONICAL_PHONE_JID` nos dois lados.

**O que a prévia mostra, sempre, na tela (não em tooltip), com número real da empresa:**
1. "N excluídos por já terem respondido em outro número";
2. "N respostas deste período não puderam ser ligadas a um envio" — resposta de `@lid` não tem telefone recuperável (Evolution API, irreversível):
   **"não respondeu" aqui quer dizer "não achamos resposta", não "ignorou"**. Medido pelo dono em produção (geracao-digital): 511 das 5.085 entradas são `@lid`;
3. "N campanhas disparadas pelo caminho antigo não aparecem aqui: elas não gravam o registro de envio e o cruzamento não as enxerga." O caminho legado
   (`executeCampaignDispatch`) não escreve em `campaign_dispatch_runs`. Medido pelo dono: 286 envios registrados nessa tabela = **todo o universo do B** nessa empresa.

**Tempo em 25 mil** (pglite, mundo de 24.655 leads, 24.655 envios, 20.000 adicionais, ~7.000 respostas): **0,67 s**. A primeira versão tinha um `LATERAL` que
varria a lista de números inteira por lead (24 mil × 44 mil linhas): **100 s** medidos, mesmo resultado. Trocado por CTE agregada (`DISTINCT ON`) com join por hash.
Lição repetida: junção correlacionada contra uma CTE grande é quadrática; agregue e junte.

**Achado do JID (registrado como medido):** o webhook pode gravar `phone` com sufixo `@s.whatsapp.net`/`@c.us` — **real no código, zero ocorrências medidas
em 06/10/2026** (nenhuma entrada de entrada com esses sufixos em produção). Mesmo assim o B mantém a variante JID nos dois lados: custo nulo, e o dia em que
aparecer não vira exclusão silenciosa.

**PENDÊNCIA: as definições de "respondeu" ainda divergem — elas dão respostas diferentes para a mesma pergunta.** Pergunta: "esta empresa respondeu?". Cada tela
responde com uma regra própria, e os números não são comparáveis entre telas. Arquivo e linha de cada uma (estado de 06/10/2026):

| # | Onde | Mensagem que conta | Telefone | Janela | Unidade |
|---|------|--------------------|----------|--------|---------|
| 1 | `backend/src/services/messageEffectiveness.js:21-22` (constantes), `:28-39` (EXISTS) — relatório de efetividade; **o B usa as mesmas constantes** (`secondNumberAudience.js`) | inbound **ou** `engagement_signal='reply'` | cru **ou** canônico (sem variante JID) | 14 dias depois do envio (B: "até agora") | cada envio |
| 2 | `backend/src/domains/campaigns/routes.js:206-216` (`buildImportAuditSql`, definido em `:124`) — auditoria da importação | inbound ou `reply` | canônico **com** variante JID | 14 dias depois do envio | cada envio |
| 3 | `backend/src/domains/campaigns/routes.js:3114-3123` — contagem de respondidos na lista de campanhas | inbound ou `reply` | **só cru** (`lm.phone = r.phone`) | **nenhuma** (qualquer mensagem, antes ou depois do envio) | telefones distintos |
| 4 | `backend/src/services/dashboardAnalysis.js:236-243` — "respondeu" por perfil de lead | inbound ou `reply` | canônico | **nenhuma**, e sem relação com envio nenhum | lead criado no período |
| 5 | `backend/src/services/dashboardAnalysis.js:92-133` — funil do primeiro disparo | **só** `direction='inbound'` (ignora `reply`), sem grupos | canônico | depois do 1º/2º envio, sem teto | telefone |

São **cinco** formas, não três (o levantamento anterior parou nas três da camada de campanha; as duas do dashboard também são definições próprias). A #3 é a mais
distante: sem janela e sem o canônico, ela conta como "respondeu" quem mandou mensagem **antes** do envio e perde quem respondeu de um telefone formatado diferente.
Consequência prática: a mesma campanha pode mostrar uma taxa na lista (#3), outra no relatório (#1) e outra na auditoria da importação (#2). Unificar é leva própria;
o caminho é cada uma importar `REPLY_MESSAGE_FILTER_SQL`/`MESSAGE_TIMESTAMP_SQL` e escolher a janela de forma explícita (a unidade e a janela são decisões de produto, não detalhe).

**PENDÊNCIA (a próxima leva): resposta do número adicional entra sem `lead_id`.** Onde: `backend/src/domains/shared/leadMessaging.js:76-93`, `appendLeadMessage` resolve o
lead só por `telefone IN (variantes)` (`:82`) e, se não acha, **segue sem erro com `lead_id` nulo** (a mensagem é gravada normalmente). `:206-208` faz o mesmo `IN` para
marcar `ultima_interacao_usuario`: se não acha lead, o `UPDATE` casa 0 linhas e ninguém é avisado. Ninguém consulta `dados.telefones_extras` nesse caminho. O B contorna
isso no público (cruza por telefone), então a resposta **conta** para a empresa na segunda tentativa; mas a mensagem fica fora da conversa do lead e `ultima_interacao_usuario` não anda.

**Limites que a tela não esconde:** o disparo segue pelo handoff de linhas (`vexo_pending_campaign_audience`, ~5 MB de `localStorage`; as linhas viram uma
importação de itens, não leads novos). Resposta que chegar do número adicional continua entrando com `lead_id` nulo (o B não mexe nisso).

## Pendências registradas

1. **Dois chamadores ainda carregam a lista inteira** (sem `page`/`limit`): `frontend/src/components/CommercialIntelligenceContent.tsx:246` e
   `frontend/src/hooks/useLeads.ts:54` (usado por WhatsAppInbox e SegmentacaoCatalog). Funcionam (agora com filtro correto), mas com 25.000
   leads baixam a base inteira. Migrar para o modo paginado/`facets` quando cada tela for mexida.
2. **Passagem do público para a central de campanhas** é por `localStorage` (`vexo_pending_campaign_audience`, ~5 MB). Público muito grande
   estoura: a tela tenta sem o resumo da IA e, se ainda não couber, avisa e não segue. O correto é o servidor guardar o público.
3. **Retomar importação do Banco interrompida**: a importação fica `incomplete` e visível em Planilhas, mas a retomada é reenviar a planilha
   pela tela do Banco (cria um segundo registro). Falta o "Retomar" do Banco.
4. ~~Reconstrução das importações antigas~~ — feita (ver "Importações antigas: reconstrução"); falta só o dono rodar `ops/sql/2026-10-06-reconstruir-importacoes.sql` e conferir as contagens.
5. **Lista de rótulos da IA por empresa** (hoje global): ver `AI_LABELS`.
6. **Cinco definições de "respondeu" divergentes** e **resposta do número adicional sem `lead_id`**: ver "Segunda tentativa por outro número".
7. **Verificação em produção** (somente leitura, pelo dono): a query de collation abaixo e a linha de log `[leads] Advanced query failed`.

## Verificação em produção (somente leitura, quem roda é o dono)

```sql
-- as collations que o produto usa existem?
SELECT collname, collprovider FROM pg_collation WHERE collname IN ('pt-BR-x-icu', 'und-x-icu');

-- ordem real de produção, SEM lower() (é a que o produto usa: ORDER BY nome COLLATE "pt-BR-x-icu"); compare com a raiz e com o navegador:
--   [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR')).join(' | ')
WITH n(nome) AS (VALUES ('Ácaro'),('alvaro'),('Álvaro'),('Ana'),('ana'),('Cesar'),('Çesar'),('Eder'),('Éder'),('Oscar'),('Óscar'),('Zoe'),
                        ('ângela'),('Zélia'),('Érica'),('Çaio'),('Caio'),('joão'),('JOÃO'),('Bruna'),('bruno'),('José'),('josé'),('Jose'),('ana maria'),('Ana Maria'))
SELECT 'pt-BR' AS col, string_agg(nome, ' | ' ORDER BY nome COLLATE "pt-BR-x-icu") FROM n
UNION ALL
SELECT 'und', string_agg(nome, ' | ' ORDER BY nome COLLATE "und-x-icu") FROM n;
```

Medição de produção já recebida: `datcollate = datctype = en_US.utf8`, provedor libc (não é `C`: `lower()` e `ILIKE` dobram acento); `pt-BR-x-icu` existe.
A ordenação **não usa `lower()`**: com ele "Ana" e "ana" viram a mesma chave e o desempate seria arbitrário; a ICU trata caixa como diferença
terciária, o critério do `localeCompare`. A ordem fixa de produção sem `lower()` entra como expectativa do teste de paridade quando a medição chegar.
