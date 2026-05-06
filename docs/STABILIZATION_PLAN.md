# Stabilization Plan - Vexo CRM

## Objetivo da fase

Encerrar o primeiro ciclo de estabilizacao do CRM com foco em seguranca de tenant, contratos criticos, trilho minimo de qualidade e uma primeira limpeza incremental do backend.

Esta fase nao teve como objetivo criar features novas, migrar frontend, redesenhar UI ou reestruturar o produto. A prioridade foi deixar o sistema mais previsivel antes de avancar para testes com clientes.

---

## Principios adotados

1. **Seguranca antes de organizacao**
   - tenant leak, auth e permissao vieram antes de limpeza estrutural.

2. **Verdade do schema antes de novas features**
   - contratos e migrations criticas foram documentados antes de ampliar funcionalidades.

3. **PR pequena e monotematica**
   - cada PR resolveu um risco especifico.

4. **React preservado**
   - nenhuma migracao para Angular entrou neste ciclo.

5. **Refactor pequeno depois de teste minimo**
   - a primeira extracao do backend aconteceu somente depois do trilho minimo de testes/CI.

---

## PRs do ciclo #44 a #50

| PR | Escopo | Resultado |
| --- | --- | --- |
| #44 | Auditoria e mapas de estabilizacao | Criou `ARCHITECTURE_AUDIT`, `SCHEMA_MAP`, `ROUTES_TENANT_RISK_MAP` e plano inicial |
| #45 | Tenant isolation em campanhas | Corrigiu rotas criticas de campanhas para respeitar escopo de tenant |
| #46 | Tenant isolation em usuarios/permissoes | Restringiu listagem/mutacao de usuarios e bloqueou elevacao indevida |
| #47 | Tenant isolation em notificacoes | Escopou leitura/update de notificacoes e restringiu globais a admin real |
| #48 | Schema truth e contratos criticos | Criou `API_CONTRACTS`, alinhou `client_id` slug e versionou `notifications`/`n8n_error_logs` |
| #49 | Trilho minimo de testes e CI | Criou `npm run check`, scripts de teste/build e GitHub Actions |
| #50 | Limpeza incremental do backend | Extraiu predicados puros de acesso para `backend/src/accessGuards.js` |

---

## Concluido neste ciclo

### Seguranca de tenant/auth

- Campanhas criticas passaram a validar tenant antes de mutacoes/disparo.
- Rotas de usuarios passaram a respeitar escopo do operador.
- Usuarios escopados nao conseguem operar usuarios de outro tenant.
- Usuarios escopados nao conseguem atribuir `internal_admin`, `all_clients` ou `users.manage` indevidamente.
- Notificacoes passaram a respeitar `client_id`, `user_id` ou admin global real.

### Schema e contratos

- `client_id` foi documentado como campo oficial de persistencia para tenant.
- Aliases de borda ficaram documentados: `clientId`, `tenantId`, `companyId`, `phone`, `qualification`.
- Validador de lead passou a aceitar slug textual de `leads_clients.id`, em vez de exigir UUID.
- `notifications` e `n8n_error_logs` passaram a ter criacao versionada com `IF NOT EXISTS`, indices e RLS deny-all.

### Qualidade e CI

- `npm run check` na raiz virou o comando padrao de validacao local.
- Backend ganhou scripts `check` e `test`.
- GitHub Actions passou a rodar sintaxe backend, testes backend, testes frontend, build frontend e diff check.
- Testes de regressao cobrem usuarios/permissoes, aliases de contrato, `client_id` slug e access guards.

### Backend

- Primeiro bloco seguro extraido de `server.js`: predicados puros de acesso.
- Middlewares e rotas permaneceram no `server.js` para evitar refactor amplo.
- Nenhum comportamento funcional foi alterado na PR de limpeza.

---

## Pendencias criticas antes de cliente

Estas pendencias devem ser resolvidas antes de liberar clientes reais em producao.

| Prioridade | Pendencia | Motivo |
| --- | --- | --- |
| Critico | Confirmar merge/ordem final das PRs #45, #47, #48, #49 e #50 na base principal | O baseline precisa existir em uma linha unica antes de teste externo |
| Critico | Criacao versionada de `campaigns` | Hoje ha migrations de alteracao, mas a criacao completa ainda precisa ficar reproduzivel |
| Critico | Fechar `POST /api/lead-imports` com tenant scope | Continua listado como rota sensivel pendente |
| Critico | Validar `lead_conversations` sem `client_id` | Conversas por telefone podem misturar contexto entre empresas com numeros iguais |
| Critico | Revisar duplicidade backend `/api/notifications` vs Edge `notifications-api` | Evitar dois caminhos com auth/escopo diferentes para o mesmo dominio |
| Critico | Rodar checklist manual de acesso com usuario Vexo admin, usuario interno escopado e usuario cliente | Confirmar isolamento real alem dos testes unitarios |

---

## Pendencias pos-go-live

Podem ficar para depois do primeiro teste controlado, desde que clientes reais ainda estejam em acompanhamento proximo.

| Pendencia | Motivo |
| --- | --- |
| Tornar `access_profiles` tenant-aware ou documentar formalmente que e global | Hoje a elevacao real esta bloqueada nas mutacoes, mas a tabela segue global |
| Padronizar semantica final de `status` e `qualificacao` | Ainda ha uso misto entre resumo, etapa e qualificacao |
| Adicionar smoke tests HTTP com mocks de Firebase/Supabase | A cobertura atual e majoritariamente de helpers/contratos |
| Melhorar observabilidade de erros backend/n8n | Hoje logs existem, mas ainda nao ha padrao unico de evento |
| Revisar CORS/Auth das Edge Functions | CORS e tokens ainda precisam politica operacional unica |

---

## Melhorias tecnicas futuras

| Tema | Proximo passo recomendado |
| --- | --- |
| `server.js` monolitico | Extrair middlewares com dependencia de `sendError` somente apos helpers de erro ficarem modulares |
| Shape de erro | Criar modulo unico para `sendError` e codigos de erro |
| Tenant helpers | Extrair resolucao de tenant sem carregar `req/res` para facilitar testes |
| Rotas estabilizadas | Mover grupos pequenos depois de testes de rota existirem |
| Lint | Corrigir warnings/erros legados e transformar lint em check obrigatorio |
| Migrations | Criar teste de schema/migration em banco ephemeral quando o schema estabilizar |

---

## Validacao baseline

Comandos obrigatorios antes de considerar a baseline pronta:

```bash
npm run check
cd backend && node --check src/server.js
cd backend && npx vitest run
cd frontend && npm test -- --run
cd frontend && npm run build
git diff --check
```

Resultado esperado no encerramento do ciclo:

- backend syntax check passa
- backend vitest passa
- frontend vitest passa
- frontend build passa
- diff check passa

---

## Padrao de trabalho para proximos ciclos

## Branches

- `main`: sempre estavel
- `codex/<tema-curto>` ou `fix/<tema-curto>`
- uma branch por problema

Exemplos:

- `codex/schema-truth-campaigns`
- `codex/lead-import-tenant-scope`
- `codex/edge-notifications-consolidation`

## Regra para abrir PR

Toda PR deve responder:

1. qual problema unico ela resolve?
2. quais rotas/tabelas toca?
3. existe risco de tenant/auth?
4. quais arquivos ficaram fora de escopo?
5. quais checks passaram?

## Checklist antes de merge

- [ ] diff pequeno e monotematico
- [ ] sem arquivo fora de escopo
- [ ] sem segredo novo hardcoded
- [ ] se tocou rota, documentou tenant scope
- [ ] se tocou schema, documentou migration e compatibilidade
- [ ] testes executados ou limitacao explicitada
- [ ] revisado por outra pessoa

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
2. estrategia de notificacoes (`backend` canonico vs Edge legado)
3. ciclo de vida de `lead_conversations` com tenant
4. status canonico de lead/campanha

---

## Encerramento do ciclo

O ciclo #44-#50 fecha a primeira estabilizacao tecnica. O CRM ainda nao deve ser tratado como pronto para operacao ampla com clientes, mas a base ficou mais segura e verificavel para iniciar testes controlados apos resolver as pendencias criticas antes de cliente.
