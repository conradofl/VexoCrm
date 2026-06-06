# Release Baseline - Ciclo de Estabilizacao #44-#50

## Objetivo

Registrar a linha de base tecnica do CRM apos o primeiro ciclo de estabilizacao. Este documento serve como referencia para validar o estado minimo antes de liberar testes controlados com cliente.

---

## PRs incluidas no ciclo

| PR | Tema | Entrega principal |
| --- | --- | --- |
| #44 | Auditoria tecnica | Mapas de arquitetura, schema, rotas e plano de estabilizacao |
| #45 | Campanhas | Tenant isolation nas rotas criticas de campanhas |
| #46 | Usuarios/permissoes | Tenant isolation em usuarios e bloqueio de elevacao indevida |
| #47 | Notificacoes | Tenant isolation em notificacoes e globais restritas a admin |
| #48 | Schema/contratos | `API_CONTRACTS`, `client_id` slug e criacao de `notifications`/`n8n_error_logs` |
| #49 | Testes/CI | `npm run check`, backend/frontend tests/build e GitHub Actions |
| #50 | Backend cleanup | Extracao de access guards puros do `server.js` |

---

## Principais riscos corrigidos

- Listagens/mutacoes sensiveis passaram a ter regras explicitas de tenant em campanhas, usuarios e notificacoes.
- Usuarios escopados nao devem conseguir operar usuarios fora do proprio tenant.
- Usuarios escopados nao devem conseguir elevar permissao para admin global.
- `client_id` foi alinhado ao schema real como slug textual, nao UUID obrigatorio.
- Aliases legados de payload seguem aceitos na borda, mas documentados como nao recomendados para codigo novo.
- O projeto ganhou um comando unico de validacao local e CI minimo em PR.
- O `server.js` teve a primeira extracao segura, sem mover rotas nem alterar comportamento.

---

## Validacoes obrigatorias

Antes de promover qualquer branch de estabilizacao:

```bash
npm run check
```

Equivalentes individuais:

```bash
cd backend && node --check src/server.js
cd backend && npx vitest run
cd frontend && npm test -- --run
cd frontend && npm run build
git diff --check
```

Resultado esperado:

- backend syntax check passa
- backend vitest passa
- frontend vitest passa
- frontend build passa
- diff check passa

---

## Checklist antes de liberar teste com cliente

- [ ] Confirmar que as PRs #44 a #50 estao na mesma linha de base final.
- [ ] Rodar `npm run check` em checkout limpo.
- [ ] Conferir variaveis de ambiente de backend, frontend e Postgres.
- [ ] Validar login como admin Vexo.
- [ ] Validar login como usuario interno escopado.
- [ ] Validar login como usuario cliente.
- [ ] Confirmar que usuario cliente nao acessa rotas internas por URL direta.
- [ ] Confirmar que usuario interno escopado nao lista clientes/usuarios/campanhas fora do escopo.
- [ ] Criar lead/campanha de teste em tenant A e confirmar que tenant B nao enxerga.
- [ ] Confirmar notificacoes globais apenas para admin real.
- [ ] Testar fluxo de importacao/disparo em ambiente controlado antes de usar base real.
- [ ] Confirmar backup/export do Postgres antes de qualquer migration nova.

---

## Rollback recomendado

Se algo falhar em teste controlado:

1. Pausar deploy e novas migrations.
2. Registrar rota, usuario, tenant, payload e horario do erro.
3. Reverter para o ultimo commit/PR aprovado antes da falha.
4. Se falha envolver banco, restaurar backup ou desfazer apenas a migration afetada.
5. Abrir PR pequena com teste de regressao antes de aplicar nova correcao.

Ordem pratica:

- falha de frontend/build: rollback do deploy frontend.
- falha de backend/auth/tenant: rollback do deploy backend.
- falha de schema: pausar escrita, validar backup e aplicar hotfix somente com revisao.
- falha de n8n/Edge: desativar workflow/endpoint afetado antes de alterar CRM.

---

## Estado formal da baseline

Esta baseline e adequada para continuar estabilizacao e iniciar testes internos controlados. Para teste com cliente, resolver primeiro as pendencias criticas listadas em `docs/STABILIZATION_PLAN.md`.
