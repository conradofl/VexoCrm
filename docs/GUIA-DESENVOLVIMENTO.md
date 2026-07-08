# Guia de Desenvolvimento — Vexo OS (pós-refatoração)

Regras para criar features no modelo modular novo (branch `refatoracao`, julho/2026).
Vale para todo código novo. Código legado que ainda foge do padrão é migrado aos poucos — não copie o padrão antigo.

---

## 1. Backend — arquitetura em camadas

```
backend/src/
├── server.js                  # SÓ bootstrap: Express, CORS, routeDeps, listen, shutdown
├── domains/
│   ├── registerAllDomainRoutes.js   # agregador puro — 1 linha por domínio
│   ├── auth/routes.js
│   ├── leads/routes.js
│   ├── campaigns/routes.js
│   ├── chatbot/routes.js
│   ├── insights/routes.js
│   ├── integrations/routes.js
│   └── vexoSales/routes.js
├── campaign/                  # engine de disparo (dispatch.js, scheduler.js)
├── followup/                  # queueRoutes.js
└── services/                  # camada base compartilhada
    ├── database.js            # pool Postgres ("supabase" = rótulo herdado, é Postgres!)
    ├── firebase.js            # auth admin
    ├── httpInfra.js           # sendError, ensureDb, validações genéricas
    ├── tenant.js              # resolveAuthorizedClientId, leadsTableName
    ├── analytics.js / evolution.js / leadImport.js / n8nSettings.js
```

### Regras backend

1. **Rota nova vai no domínio certo** (`domains/<dominio>/routes.js`), nunca em `server.js` nem no agregador. Sem domínio óbvio? Discutir antes de criar um novo.
2. **Grafo de imports é acíclico e bottom-up**: `services/` não importa de `domains/`; domínio não importa de outro domínio. Helper usado por 2+ domínios desce pra `services/`.
3. **Multi-tenant SEMPRE**: toda query nova filtra por `client_id` via `resolveAuthorizedClientId(req, res, clientId)`. Nenhuma leitura cruzada entre clientes. Sem exceção.
4. **Padrão de handler**: `requireFirebaseAuth` + `requireInternalPageAccess("<pagina>")` (ou bearer de webhook), `ensureDb(res)`, `sendError(res, status, "CODE", "mensagem")` para erros.
5. **Estado de módulo é privado**: flags tipo `let schedulerRunning` ficam no módulo dono, nunca exportadas nem duplicadas (incidente da cache Evolution, 15/06).
6. **Não renomear "Supabase"→"Postgres" em massa** — já quebrou migration uma vez. `supabase` no código é a conexão Postgres atual.
7. **Migrations idempotentes** (`ADD COLUMN IF NOT EXISTS ...`) dentro do fluxo existente de `runMigrations`.

---

## 2. Frontend — container + subcomponentes + lib + hooks

```
frontend/src/
├── pages/<Pagina>.tsx             # CONTAINER: PageShell, estado compartilhado, composição
├── pages/<Pagina>/*.tsx           # subcomponentes EXCLUSIVOS da página (steps, tabs, dialogs)
├── components/<feature>/*.tsx     # subcomponentes de feature reusáveis (ex: followup/, commercialIntelligence/)
├── lib/<feature>/*.ts             # funções puras, constantes, types de UI (sem React)
└── hooks/use<Dominio>.ts          # types de domínio no topo + useQuery/useMutation + fetchApi
```

Exemplos canônicos: `pages/LeadImports/` + `lib/leadImports/`, `pages/GeracaoDigitalPitch/` + `lib/geracaoDigital/`, `components/commercialIntelligence/`.

### Regras frontend

1. **Página nova nasce dividida**: container < ~400 linhas; JSX de seção/aba/dialog vira arquivo próprio desde o início. God component novo não entra.
2. **Estado compartilhado vive no container** e desce por props. Estado local (busca, paginação, form de dialog) vive no subcomponente.
3. **Dados via React Query**: todo fetch novo é `useQuery`/`useMutation` em `hooks/use<Dominio>.ts`, usando `fetchApi` de `@/lib/api`, com `queryClient.invalidateQueries` no sucesso. **`fetch()` cru novo é proibido** (o legado ainda tem — não copie).
4. **Types de domínio moram no hook** (ex: `Campaign` em `useCampanhas.ts`). Não redeclarar tipo que já existe — importar.
5. **Função pura vai pra `lib/`** — parsing, formatação, builders. Testável sem render.
6. **UI da casa**: shadcn/ui + `PageShell` em toda página + `EmptyState`/`ErrorMessage` para vazio/erro.
7. **Formulário que não pode perder dados** usa `useLocalStorage` chaveado por `activeClientId` (padrão do LeadImports).

---

## 3. Validação obrigatória antes de qualquer PR/commit

```bash
# frontend/
npx tsc --noEmit -p tsconfig.app.json   # ⚠ SEM -p não checa NADA neste repo
                                        # baseline: 37 erros pré-existentes — NÃO aumentar
npx vitest run                          # 39/39
npm run build

# backend/
npx vitest run                          # 117/117
node --check src/<arquivos alterados>

# e2e (backend + vite reais; specs em frontend/e2e/, config frontend/playwright.config.ts)
E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npx playwright test --workers=1   # 18/18
```

- **Credencial nunca hardcoded** — e2e usa `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` (ver `e2e/credentials.ts`). Segredo em arquivo = incidente.
- Evidência, não afirmação: "testado" = colar a saída real do comando.
- `rbac-roles.spec` tem flake conhecido por acúmulo de usuários `test-*@teste.com` — se falhar na suíte, re-rodar isolado antes de suspeitar do seu código.

---

## 4. Zonas com regra especial

| Área | Regra |
|---|---|
| `pages/UserAccessManagement.tsx` + `hooks/useAdminUsers.ts` | **NÃO MEXER** — área em ponto crítico, fica idêntica à main até segunda ordem do Luiz |
| Código morto conhecido (abas Fila/Sugestões/Campanhas do FollowupQueue; handlers de dispatch do GeracaoDigitalPitch; comentário no fim de LeadImports.tsx) | Preservado de propósito — remoção só com decisão do time |
| `src/test/leadImportsLoading.test.ts` | Valida strings de comentário morto — não estender esse padrão; destino pendente de decisão |
| Histórico de registros | Imutável — nunca UPDATE/DELETE em histórico sem aprovação explícita |
| Status calculado | Nunca persistir status derivável — calcular na leitura |

---

## 5. Git

- Trabalho em branch; PR para `main`. Commits em português, sem footer de IA.
- Antes de construir feature: `git fetch` e conferir commits recentes da `main` — evita refazer o que o parceiro já fez.
- Merge da main em branch refatorada: **portar semanticamente** mudanças feitas em arquivos monolíticos antigos para a estrutura modular (precedente: merge `b7b3b52`).
