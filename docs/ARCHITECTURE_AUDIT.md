# Architecture Audit - Vexo CRM

## Status

- Data: `2026-05-05`
- Escopo: auditoria tecnica do projeto atual
- Objetivo: estabilizar arquitetura antes de colocar clientes
- Fora de escopo: migracao para Angular, novas features, refatoracao ampla

## Metodologia

Esta auditoria foi feita a partir de:

1. leitura da estrutura real do repositorio
2. inspecao das rotas principais em `backend/src/server.js`
3. comparacao entre runtime, `frontend/postgres/migrations/` e `docs/*.md`
4. leitura das rotas Express em `frontend/postgres/functions/`
5. validacao rapida dos trilhos de teste
6. consulta ao Segundo Cerebro para confirmar a prioridade operacional

### Contexto vindo do Segundo Cerebro

Os resultados mais consistentes do vault reforcam que o sistema precisa priorizar:

- operacao de CRM e qualificacao
- etapas claras do funil
- follow-up controlado
- padronizacao de campos
- trilha clara de responsabilidade

Isso confirma a leitura tecnica: o risco imediato nao e framework de frontend. O risco imediato e **inconsistencia estrutural entre contratos, tenant, auth, runtime e schema**.

---

## Diagnostico tecnico objetivo

O projeto atual tem base funcional real e ja entrega fluxo operacional, mas ainda nao esta num ponto seguro para receber clientes sem risco elevado de regressao, vazamento entre empresas e retrabalho.

Arquitetura atual:

- `frontend/`: React + Vite
- `backend/`: Node + Express
- `Postgres`: persistencia principal
- `rotas Express com Postgres direto`: partes do fluxo operacional
- `n8n`: orquestracao de conversa, disparo e qualificacao
- `Firebase Auth`: autenticacao principal

O principal problema nao e falta de tecnologia. O principal problema e falta de **fronteira clara entre camadas**:

1. o backend acumula logica demais em um unico arquivo
2. o schema versionado nao representa com confianca tudo o que o runtime usa
3. ha duplicidade entre backend e rotas Express
4. o controle multi-tenant depende mais de convencao do que de defesa em profundidade
5. contratos de dados mudam de significado conforme a camada

### Recomendacao executiva

- **Nao migrar frontend agora**
- **Manter React/Vite**
- **Estabilizar backend, schema, auth, permissoes e contratos primeiro**
- **Tratar isolamento por tenant e verdade do schema como P0 antes de cliente**

---

## Top 10 maiores problemas estruturais

| # | Severidade | Problema | Evidencia |
| --- | --- | --- | --- |
| 1 | Critico | `backend/src/server.js` concentra auth, permissao, rotas, dashboard, campanhas, webhooks, WhatsApp e normalizacao num unico modulo | `backend/src/server.js` |
| 2 | Critico | Schema real e migrations ainda divergem em pontos sensiveis, especialmente em torno de `campaigns`, `notifications`, `n8n_error_logs` e campos legados de `leads` | `frontend/postgres/migrations/`, `backend/src/server.js`, `docs/postgres-functions.md` |
| 3 | Critico | Existem fluxos duplicados entre backend e rotas Express para leads, memoria e erro operacional | `/api/import-lead-infinie-n8n`, `/api/n8n-error-webhook`, `/api/conversation-memory` vs `lead-webhook`, `n8n-error-webhook`, `conversation-memory*` |
| 4 | Critico | Ha rotas sem filtro consistente por `client_id`, inclusive notificacoes e campanhas, com risco real de tenant leak | `backend/src/server.js` |
| 5 | Alto | Auth e permissoes sao reconstruidos em mais de uma camada, com regras especiais e escalacoes implicitas | `backend/src/server.js`, `frontend/src/lib/access.ts`, `frontend/src/contexts/AuthContext.tsx` |
| 6 | Alto | rotas Express usam `Access-Control-Allow-Origin: *` e ainda dependem de bearer interno, aumentando superficie operacional | `frontend/postgres/functions/*` |
| 7 | Alto | Contratos criticos (`telefone`, `qualificacao`, `client_id`, `tenant_id`, `company_id`, `notifications`) nao estao totalmente normalizados | `backend/src/validators.js`, `backend/src/server.js`, `docs/*.md`, hooks do frontend |
| 8 | Alto | CRUD de campanhas confia demais em permissao de tela e nao bloqueia por tenant em todos os endpoints mutaveis | `backend/src/server.js` |
| 9 | Medio | Trilho de testes nao esta confiavel: frontend depende de instalacao local; backend aborta antes de executar os testes | `frontend/package.json`, `backend/package.json`, `backend/src/test/security.test.js` |
| 10 | Medio | Processo de desenvolvimento ainda nao tem trilho minimo de seguranca para duas pessoas alterando o mesmo sistema | ausencia de CI, checklist de PR e regra firme de escopo |

---

## Achados por area

### 1. Backend

#### Diagnostico

O backend entrega muito, mas hoje funciona como um modulo procedural grande, com baixa separacao entre controller, service e adapter.

#### Achados

1. **Monolito de rotas**
   - `backend/src/server.js` concentra praticamente toda a aplicacao.

2. **Separacao fraca de responsabilidades**
   - rotas fazem validacao, resolucao de escopo, regra de negocio e acesso a banco ao mesmo tempo.

3. **Tenant scope nao e uniforme**
   - rotas como `/api/dashboard`, `/api/revenue-ops`, `/api/commercial-intelligence`, `/api/leads` usam `resolveAuthorizedClientId`.
   - outras, como `/api/notifications`, nao usam filtro por tenant.

4. **Permissao com excecoes especiais**
   - `requireInternalPageAccess`, `requireUserManagementAccess`, `hasAccessPermission` e `extractManagedAccessClaims` fazem a regra de autorizacao ficar distribuida.

5. **Contas admin fixas hardcoded**
   - emails e UIDs administrativos fixos seguem embutidos em runtime.

6. **Logs inconsistentes**
   - existe bastante `console.error`, mas sem padrao de evento, categoria, tenant e correlation id.

#### Impacto

- alto custo de revisao
- regressao lateral facil
- tenant leak por esquecimento de filtro
- dificuldade de instrumentar e testar

### 2. Postgres

#### Diagnostico

O Postgres continua sendo a escolha certa, mas o repositorio ainda nao representa com clareza o banco real esperado pelo runtime.

#### Achados

1. **Schema versionado parcial**
   - as migrations cobrem `leads`, `leads_clients`, `lead_conversations`, `lead_imports`, `lead_import_items`, `access_profiles`, revenue ops e commercial intelligence settings.
   - varias tabelas usadas em runtime dependem de que a tabela `campaigns` ja exista antes das migrations de alteracao.

2. **Migration fraca por ordem e dependencia**
   - `20260221031218_*.sql` tenta aplicar policy em `n8n_error_logs` antes de haver criacao versionada dessa tabela.
   - `20260414000008_*` e `20260430000011_*` alteram `campaigns`, mas o repo nao possui migration explicita de criacao dessa tabela na serie atual.

3. **RLS nao faz isolamento por tenant**
   - ha varias politicas `Deny all direct access`, mas a estrategia de isolamento depende principalmente do backend com service role.
   - `20260304000001_create_leads_tables.sql` permite `SELECT` amplo em `leads` e `leads_clients` para `anon, authenticated`.

4. **Schema de `leads` carrega legado**
   - migrations ainda mantem `conta_energia`, `bot_ativo` e `historico`.
   - docs mais novas descrevem um schema mais limpo.

#### Impacto

- ambiente limpo dificil de reconstruir
- risco de "funciona na instancia atual, nao no repositorio"
- dependencia de schema manual ou historico fora do Git

### 3. Autenticacao e permissoes

#### Diagnostico

Firebase Auth pode continuar por agora. O problema e a falta de uma fonte unica e auditavel de autorizacao.

#### Achados

1. **Claims multi-tenant com nomes paralelos**
   - runtime aceita `clientId`, `client_id`, `companyId`, `tenantId`, `clientIds`, `tenantIds`.

2. **Autorizacao reconstruida em camadas diferentes**
   - backend decide acesso real.
   - frontend tambem precisa reconstruir boa parte da semantica para mostrar rotas e views.

3. **Escalacao implicita de acesso**
   - ha permissoes derivadas de presets/paginas, nao apenas de claims diretas.

4. **Risco de vazamento entre empresas**
   - qualquer rota esquecida fora de `resolveAuthorizedClientId` herda o alcance total do service role.

#### Impacto

- comportamento dificil de prever
- drift entre frontend e backend
- revisao de seguranca cara

### 4. Frontend React/Vite

#### Diagnostico

O frontend React deve ser mantido. O problema principal hoje nao e o framework, e sim dependencia de contratos instaveis e algumas telas com responsabilidade excessiva.

#### Achados

1. **Hooks dependem fortemente de `clientId` e contratos do backend**
   - `useDashboard`, `useLeads`, `useLeadImports`, `useCampanhas`, `useRevenueOps`, `useCommercialIntelligence`.

2. **Paginas de operacao crescidas**
   - ha superficies grandes e densas, com mais chance de misturar regra visual com regra de negocio.

3. **Dependencia de rotas/contratos nao normalizados**
   - `notifications`, `campaigns`, `commercial-intelligence`, `lead-imports`.

#### Impacto

- fragilidade quando backend muda contrato
- custo alto para debugar bugs de tenant e permissao

### 5. rotas Express e integracoes

#### Diagnostico

As rotas Express existem com papel operacional valido, mas hoje competem em parte com o backend e ainda expõem padroes de seguranca e CORS mais amplos do que o ideal.

#### Mapa objetivo das functions atuais

| Function | Finalidade | Variaveis sensiveis | Bearer/token | CORS | Duplicidade com backend | Risco operacional |
| --- | --- | --- | --- | --- | --- | --- |

#### Achados

1. **CORS aberto**
   - todas as functions inspecionadas usam `Access-Control-Allow-Origin: *`.

2. **Bearer interno e service role**

3. **Duplicidade com backend**
   - `lead-webhook` x `/api/import-lead-infinie-n8n`
   - `n8n-error-webhook` x `/api/n8n-error-webhook`
   - `conversation-memory*` x `/api/conversation-memory`

4. **Auth heterogenea**
   - `notifications-api` usa JWT do Postgres, enquanto o produto principal usa Firebase Auth.

#### Impacto

- maior superficie operacional
- fronteira confusa para debug
- risco de drift entre docs e runtime

### 6. Processo de desenvolvimento

#### Diagnostico

O risco aqui e organizacional e tecnico ao mesmo tempo: duas pessoas alterando areas semelhantes, com alto volume de mudancas, sem um trilho minimo que force escopo pequeno e verificacao consistente.

#### Achados

1. branch strategy frouxa
2. PRs possivelmente grandes
3. sem checklist padrao de merge
4. sem trilho minimo de CI versionado no repo
5. testes locais dependem do estado da maquina

#### Impacto

- conflitos frequentes
- refix de bugs
- regressao silenciosa

---

## O que deve ser corrigido antes de colocar cliente

### Critico

1. fechar rotas com risco de tenant leak
2. consolidar mapa do schema real e alinhar migrations
3. decidir qual camada e dona de:
   - lead webhook
   - n8n error webhook
   - conversation memory
4. normalizar identificadores de tenant (`client_id`, `tenant_id`, `company_id`)
5. revisar rotas mutaveis de campanhas e notificacoes

### Alto

6. consolidar regra de autorizacao numa semantica unica
7. padronizar contrato de `telefone`
8. padronizar contrato de `qualificacao`
9. remover dependencias em campos legados sem fonte unica de verdade
10. fechar variaveis de ambiente e secrets obrigatorios

---

## O que pode ficar para depois

1. modularizacao completa do backend
2. melhoria visual de telas
3. novas features multiagente
4. migracao de framework frontend
5. dashboards mais sofisticados

---

## Recomendacao clara

### Direcao recomendada

- **manter React e limpar arquitetura**
- **reestruturar backend primeiro, de forma incremental**
- **fechar schema, contratos, auth e tenant antes de qualquer expansao**

### Direcao nao recomendada agora

- migrar frontend
- abrir refactor grande
- adicionar novas features operacionais antes de tenant/auth

---

## Plano de estabilizacao em etapas

### Etapa 1 - Correcoes criticas

1. mapa real do schema
2. mapa das rotas com risco de tenant leak
3. lista de contratos inconsistentes
4. decisao por fluxo duplicado: backend ou rota Express

### Etapa 2 - Padronizacao

1. padronizar `client_id` como identificador de tenant do dominio
2. criar regra unica para escopo autorizado
3. reduzir excecoes implicitas de permissao
4. padronizar shape de erro e log

### Etapa 3 - Testes minimos

1. restaurar trilho do frontend
2. restaurar trilho do backend
3. criar smoke tests para:
   - auth
   - tenant scope
   - campaigns
   - notifications
   - leads

### Etapa 4 - Melhorias futuras

1. modularizar backend
2. fortalecer observabilidade
3. revisar rotas Express e convergir ownership
4. abrir backlog de evolucao de produto

---

## Padrao de trabalho recomendado para duas pessoas

### Estrategia de branches

- `main`: sempre estavel
- `codex/<escopo-curto>` ou `feat/<escopo-curto>` para trabalho isolado
- uma branch por objetivo pequeno
- proibido misturar correcoes de seguranca, visual e schema na mesma branch

### Regra para abrir PR

Toda PR deve:

1. ter escopo unico
2. listar arquivos alterados
3. dizer explicitamente o que ficou fora
4. citar risco de tenant/auth se tocar backend

### Checklist antes de merge

- [ ] escopo pequeno e objetivo
- [ ] sem arquivos fora do objetivo
- [ ] sem segredo hardcoded novo
- [ ] rotas novas ou alteradas documentadas
- [ ] tenant scope validado
- [ ] build/testes minimos executados ou limitacao documentada
- [ ] impacto em migrations documentado

### Padrao de commits

- `docs: map schema and tenant risks`
- `fix: scope campaigns by authorized client`
- `refactor: isolate tenant access helpers`

Evitar commits genericos como `ajustes` ou `corrigindo bugs`.

### Regra para nao alterar arquivos fora do escopo

- se a tarefa e de docs, nao mexer em runtime
- se a tarefa e de tenant security, nao aproveitar para redesenhar tela
- se aparecer problema paralelo, registrar em doc/issue e seguir

### Como evitar conflito entre socios

1. dividir ownership temporario por area
   - pessoa A: tenant/auth/backend
   - pessoa B: telas/hook/UX
2. nunca editar a mesma tela grande e a mesma rota grande em paralelo sem alinhamento
3. abrir PR cedo, mesmo pequena
4. revisar diffs por pasta, nao so por resumo

### Como documentar decisoes tecnicas

Criar ou manter ADRs simples em `docs/adr/` com:

- contexto
- decisao
- impacto
- o que foi descartado

---

## Testes e trilho atual

### Frontend

- no checkout limpo desta auditoria, `npm test -- --run` em `frontend/` nao executou porque `vitest` nao estava instalado localmente (`sh: vitest: command not found`).
- no checkout anterior usado na auditoria manual, o trilho falhava em `frontend/src/test/security.test.ts` por drift de mensagem de validacao de senha.

### Backend

- `npx vitest run` em `backend/` abortou antes de executar casos:
  - `Cannot find package 'zod' imported from backend/src/test/security.test.js`
- ou seja: o trilho atual quebra antes da validacao funcional propriamente dita.

### Leitura pratica

Antes de aumentar cobertura, precisamos primeiro restaurar um trilho minimo executavel e reproduzivel por qualquer maquina.
