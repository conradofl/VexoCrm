# Stabilization Plan - Vexo CRM

## Objetivo desta fase

Transformar a auditoria em uma sequencia de PRs pequenas, seguras e executaveis, sem abrir refactor grande e sem mexer em framework frontend.

Escopo desta fase:

- mapear a estrutura real
- priorizar riscos
- ordenar as primeiras correcoes
- padronizar o trabalho de duas pessoas

Fora de escopo desta fase:

- migracao para Angular
- novas features
- refatoracao ampla do backend
- redesign de frontend

---

## Principios de estabilizacao

1. **Seguranca antes de organizacao**
   - tenant leak, auth e permissao vem antes de limpeza estrutural.

2. **Verdade do schema antes de novas features**
   - nao adicionar fluxo novo sobre tabelas cujo estado real ainda nao esta consolidado.

3. **PR pequena e monotematica**
   - uma PR deve corrigir uma classe de problema, nao "aproveitar a viagem".

4. **Sem mexer em React agora**
   - o frontend atual continua.
   - so entra mudanca visual/UX se for necessaria para sustentar correcao de seguranca ou contrato.

5. **Sem refactor grande sem base de testes minima**
   - modularizacao do backend so depois que tenant scope e contratos estiverem fechados.

---

## Linha de base desta PR de documentacao

Esta PR deve entregar apenas:

1. `docs/ARCHITECTURE_AUDIT.md`
2. `docs/SCHEMA_MAP.md`
3. `docs/ROUTES_TENANT_RISK_MAP.md`
4. `docs/STABILIZATION_PLAN.md`

Sem mudanca funcional.

---

## Sequencia recomendada de correcoes

## Etapa 0 - Congelar escopo e alinhar time

### Objetivo

Evitar continuar empilhando mudancas em cima de uma base instavel.

### Acoes

1. pausar qualquer migracao de framework
2. proibir PR mista de feature + ajuste estrutural
3. definir ownership temporario:
   - Pessoa A: backend, tenant, auth, schema
   - Pessoa B: hooks, telas e consumo de contrato
4. toda PR deve citar explicitamente:
   - risco de tenant
   - tabelas afetadas
   - rotas afetadas

### Saida esperada

- backlog sequenciado
- escopo de cada PR menor

---

## Etapa 1 - Correcoes criticas de tenant e auth

### Objetivo

Fechar os vazamentos mais perigosos antes de qualquer cliente.

### PR 1 - Tenant scope em campanhas

Corrigir:

- `POST /api/campaigns`
- `PATCH /api/campaigns/:id`
- `DELETE /api/campaigns/:id`
- `POST /api/campaigns/:id/trigger`
- `GET /api/campaigns`

### Motivo

Essas rotas hoje permitem, em graus diferentes:

- criar campanha para tenant arbitrario
- alterar ou excluir campanha por `id` sem validar escopo
- listar campanhas globais quando a query nao restringe `clientId`

### PR 2 - Tenant scope em notificacoes

Decidir e implementar um dos caminhos:

1. `notifications` e global de operacao
   - restringir rota a admin real
2. `notifications` deve respeitar tenant
   - adicionar `client_id`
   - escopar leitura e update

### PR 3 - Revisao de usuarios e perfis

Revisar:

- `GET /api/admin/users`
- `GET /api/admin/access-profiles`

Objetivo:

- confirmar se pagina `usuarios` e suficiente
- ou se essas rotas devem ser elevadas para perfil mais restrito

Status:

- corrigido na branch `codex/tenant-scope-users`

Resultado:

- `GET /api/admin/users` exige `users.view` e filtra por tenant para gestores escopados
- `PATCH /api/admin/users/:uid/access`, `POST /api/admin/users` e `DELETE /api/admin/users/:uid` exigem `users.manage`
- gestores escopados nao podem operar usuarios fora do proprio tenant
- gestores escopados nao podem atribuir `internal_admin`, `all_clients` ou `users.manage`

Risco remanescente:

- `access_profiles` ainda e global. Nesta PR, isso foi aceito porque a elevacao real fica bloqueada nas mutacoes de usuario. Uma futura PR pode decidir se perfis precisam virar tenant-aware.

### Criterio de saida da Etapa 1

- nenhum endpoint mutavel de tenant sensivel opera apenas por `id`
- nenhuma listagem critica retorna dados de todos os tenants por default

---

## Etapa 2 - Verdade do schema e contratos

### Objetivo

Fazer o repositorio representar o banco real e padronizar os campos mais fragis.

### PR 4 - Schema truth

Status: **parcialmente corrigido na PR `codex/schema-contracts-truth`**.

Corrigido:

- criacao versionada de `notifications`
- criacao versionada de `n8n_error_logs`
- contrato oficial de `client_id` como `TEXT`/slug de `leads_clients.id`
- validacao backend aceitando `client_id` real e aliases legados de borda

Ainda pendente em PR propria:

- criacao versionada de `campaigns`
- referencia orphan de `metric_snapshots`

### PR 5 - Normalizacao de identificadores

Definir padrao:

- persistencia: `client_id`
- aliases aceitos na borda: `clientId`, `tenantId`, `companyId`
- normalizacao obrigatoria na entrada

Status: **iniciado na PR `codex/schema-contracts-truth`**.

Documento criado:

- `docs/API_CONTRACTS.md`

Primeira correcao segura:

- `createLeadSchema` normaliza `clientId`, `tenantId`, `companyId`, `phone` e `qualification` para `client_id`, `telefone` e `qualificacao`.
- codigo novo deve usar campos oficiais; aliases seguem apenas para compatibilidade gradual.

### PR 6 - Normalizacao de contratos do lead

Fechar semantica de:

- `telefone`
- `qualificacao`
- `status`

Resultado esperado:

- um formato canonico por campo
- docs e validadores coerentes

### Criterio de saida da Etapa 2

- ambiente limpo reconstruivel
- validadores coerentes com schema real
- docs sem conflito com runtime

---

## Etapa 3 - Trilho minimo de testes

### Objetivo

Restaurar um caminho de verificacao que qualquer pessoa do time consiga executar.

### Frontend - estado atual

- em checkout limpo, `npm test -- --run` falhou porque `vitest` nao estava disponivel localmente (`sh: vitest: command not found`)
- em checkout anterior com dependencias presentes, a trilha ja mostrava drift de mensagem em `frontend/src/test/security.test.ts`

### Backend - estado atual

- `npx vitest run` aborta antes de executar testes:
  - `Cannot find package 'zod' imported from backend/src/test/security.test.js`
- `backend/package.json` nao possui script `test`

### PR 7 - Restaurar trilhos

1. definir script `test` no backend
2. garantir dependencias minimas locais
3. documentar setup unico de dev/test
4. corrigir drift de mensagens de validacao do frontend

### PR 8 - Smoke tests minimos

Criar testes para:

- resolucao de tenant autorizado
- campanhas fora do tenant
- notificacoes
- payload de leads
- claims de acesso

### Criterio de saida da Etapa 3

- frontend e backend rodam testes minimos de forma reproduzivel
- falhas de auth/tenant geram regressao visivel em PR

---

## Etapa 4 - Padronizacao e melhoria incremental

### Objetivo

Com tenant e contratos fechados, comecar a reduzir custo de manutencao.

### Acoes

1. extrair helpers de tenant/auth para modulo proprio
2. padronizar shape de erro
3. padronizar logging com evento + tenant + rota
4. reduzir duplicidade backend vs Edge Functions
5. so depois avaliar modularizacao maior do backend

### Criterio de saida da Etapa 4

- PRs menores
- menos logica repetida
- menor risco de drift entre docs e runtime

---

## Primeira sequencia concreta de PRs

| Ordem | Escopo | Tamanho esperado | Tipo | Status |
| --- | --- | --- | --- | --- |
| 1 | Docs de auditoria e mapeamento | Pequena | Documentacao | Em PR |
| 2 | Tenant scope em campanhas | Pequena | Correcao critica | Em PR |
| 3 | Rotas admin e usuarios | Pequena | Seguranca/permissao | Em PR |
| 4 | Notificacoes: global vs tenant | Pequena | Correcao critica | Pendente |
| 5 | `POST /api/lead-imports` com tenant scope | Pequena | Correcao critica | Pendente |
| 6 | Schema truth de `campaigns`/`notifications`/`n8n_error_logs` | Media | Banco/documentacao | Parcial: `notifications` e `n8n_error_logs` corrigidos |
| 7 | Normalizacao de `client_id`, `telefone`, `qualificacao` | Media | Contrato | Iniciado com `API_CONTRACTS.md` e validadores |
| 8 | Trilho de testes minimo | Pequena | Qualidade | Pendente |

---

## Padrao de trabalho para duas pessoas

## Branches

- `main`: sempre estavel
- `codex/<tema-curto>` ou `fix/<tema-curto>`
- uma branch por problema

Exemplos:

- `codex/tenant-scope-campaigns`
- `codex/notifications-scope`
- `codex/schema-truth-campaigns`

## Regra para abrir PR

Toda PR deve responder:

1. qual problema unico ela resolve?
2. quais rotas/tabelas toca?
3. existe risco de tenant/auth?
4. quais arquivos ficaram fora de escopo?

## Checklist antes de merge

- [ ] diff pequeno e monotematico
- [ ] sem arquivo fora de escopo
- [ ] sem segredo novo hardcoded
- [ ] se tocou rota, documentou tenant scope
- [ ] se tocou schema, documentou migration e compatibilidade
- [ ] testes executados ou limitacao explicitada
- [ ] revisado por outra pessoa

## Padrao de commits

Usar formato curto e objetivo:

- `docs: map schema and tenant risks`
- `fix: scope campaign mutations by authorized client`
- `test: restore backend vitest entrypoint`

Evitar:

- `ajustes`
- `corrigindo coisas`
- `update`

## Regra para nao alterar arquivos fora do escopo

Se a PR for de:

- tenant: nao mexer em layout
- docs: nao mexer em runtime
- testes: nao refatorar rotas
- schema: nao aproveitar para redesenhar dashboard

Se surgir problema paralelo:

1. registrar em doc ou issue
2. seguir com o escopo original

## Como evitar conflito entre os dois desenvolvedores

1. alinhar ownership por PR antes de codar
2. evitar mexer no mesmo arquivo grande no mesmo periodo
3. abrir PR pequena cedo, nao so no final
4. quando um arquivo monolitico precisar de duas mudancas, dividir por ordem:
   - primeiro merge da PR A
   - rebase da PR B

## Como documentar decisoes tecnicas

Criar ADRs simples em `docs/adr/` com:

- contexto
- decisao
- impacto
- alternativas descartadas

Temas recomendados para as proximas ADRs:

1. ownership de webhooks (`backend` vs `edge functions`)
2. identificador oficial de tenant
3. estrategia de notificacoes (global vs tenant)

---

## Resultado esperado ao final do plano

Se a sequencia acima for seguida, o projeto fica em condicao muito melhor para receber os primeiros clientes porque:

- os maiores vazamentos de tenant estarao fechados
- o schema real passara a estar representado no repo
- os contratos mais sensiveis deixarao de variar por camada
- o time conseguira mexer com menos conflito e mais previsibilidade
