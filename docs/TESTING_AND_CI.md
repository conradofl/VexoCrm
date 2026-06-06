# Testing and CI - Vexo CRM

## Objetivo

Criar uma barreira minima antes de novas features: sintaxe do backend, testes de regressao, build do frontend e higiene de diff.

Esta etapa nao substitui uma suite end-to-end completa. Ela impede regressao nos pontos ja estabilizados e torna visivel quando uma PR quebra contrato, tenant isolation ou build.

---

## Como rodar localmente

Na raiz do repositorio:

```bash
npm run check
```

Comandos individuais:

```bash
npm run check:backend
npm run test:backend
npm run test:frontend
npm run build:frontend
npm run diff:check
```

Equivalentes diretos:

```bash
cd backend && npm run check
cd backend && npm test
cd frontend && npm test -- --run
cd frontend && npm run build
git diff --check
```

---

## O que bloqueia PR

O workflow `.github/workflows/ci.yml` roda em pull requests e bloqueia quando:

- `backend/src/server.js` tem erro de sintaxe.
- algum teste backend falha.
- algum teste frontend falha.
- o build Vite do frontend falha.
- o diff introduz whitespace invalido detectado por `git diff --check`.

Lint ainda nao e bloqueador nesta fase porque existem avisos/erros legados fora do escopo das PRs de estabilizacao. O lint deve virar bloqueador em uma PR propria depois que a base estiver limpa.

---

## Cobertura minima atual

| Area | Arquivo | Cobertura |
| --- | --- | --- |
| Usuarios/permissoes | `backend/src/test/userAccessScope.test.js` | Usuario escopado nao lista nem gerencia usuario de outro tenant; bloqueia elevacao indevida |
| Contratos de lead | `backend/src/test/security.test.js` | `client_id` slug funciona; aliases `clientId`/`tenantId`/`companyId`, `phone` e `qualification` continuam aceitos na borda |
| Frontend auth/validacao | `frontend/src/test/access.test.ts`, `frontend/src/test/security.test.ts` | Regras basicas de acesso, senha e schemas de entrada |

---

## Cobertura que entra ao incorporar branches ja abertas

Algumas correcoes funcionais ainda estao em PRs paralelas sobre a branch de estabilizacao. Quando essas PRs forem incorporadas na base, o CI desta PR passa a executar os testes delas automaticamente.

| Area | Origem | Cobertura esperada |
| --- | --- | --- |
| Campanhas | PR de tenant scope em campanhas | Campanha de tenant A nao pode ser alterada, removida ou disparada por tenant B |
| Notificacoes | PR de tenant scope em notificacoes | Usuario de tenant A nao lista nem marca notificacao do tenant B |

Se a ordem de merge exigir, a PR que trouxer campanhas/notificacoes deve manter os testes junto do codigo de escopo. O CI aqui e o trilho que passa a bloquear esses testes.

---

## Padrao minimo para novas correcoes

Toda PR de correcao deve:

1. Tocar um unico tema.
2. Adicionar ou atualizar pelo menos um teste quando mudar tenant, auth, contrato ou persistencia.
3. Atualizar docs quando mudar contrato de API, migration ou regra de permissao.
4. Rodar `npm run check` na raiz antes de pedir merge.
5. Declarar no corpo da PR quais checks passaram.

---

## Proximos passos recomendados

1. Incorporar os testes de campanhas e notificacoes na base comum de estabilizacao.
2. Criar smoke tests para rotas HTTP com mocks de Postgres/Firebase sem subir servidor real.
3. Limpar problemas legados de lint e promover `frontend npm run lint` a check obrigatorio.
4. Adicionar teste de migration em ambiente ephemeral Postgres/Postgres quando o schema estiver mais consolidado.
