# Handoff — Vexo OS (para o Antigravity)

> Documento de entrada para um agente de código assumir o projeto SEM contexto prévio.
> Trabalho em revezamento com o Claude Code. Última atualização: 2026-06-13.
> **Regra de ouro: leia `aprendizados.md` e `pendencias.md` ANTES de qualquer tarefa.**

---

## 1. O que é o projeto

**Vexo OS** — CRM + automação comercial com IA. Marca client-facing: **Geração Digital**.

- **Repositório canônico (Repo B):** `~/Documents/vexo-sales-module`. Owner **Luiz** (GitHub: **LuizApenas**) commita direto na `main`. (Existiu um "Repo A" — DESCARTADO; nunca usar.)
- **Front:** Vercel — `crm.vexoia.com`. Deploy automático no push da `main`.
- **Backend:** serviço **bk-vexo** no Easypanel (Node/Express).
- **Banco:** **PostgreSQL** — serviço **db-vexo** no Easypanel.
- **Stack:** React + TypeScript (Vite), Node/Express (ESM), PostgreSQL, Evolution API (WhatsApp), Redis, recharts (gráficos).

### Estrutura do repo (pastas principais)
```
vexo-sales-module/
├── backend/
│   ├── src/
│   │   ├── server.js                      # entrypoint: monta Express, runMigrations + app.listen; helpers de DB/auth; buildDispatchLeads
│   │   ├── campaign-outbound.js           # motor de envio: dispatchCampaignSequence (loop de leads/steps, chip, claim, delays)
│   │   ├── pgSupabaseCompat.js            # pool pg + wrapper "supabase-like" (.from().select()...); statement_timeout aqui
│   │   ├── domains/
│   │   │   └── registerAllDomainRoutes.js # TODAS as rotas de domínio: campanhas, disparos, cota/chips, relatórios, runCampaignDispatch
│   │   ├── followup/                       # módulo de follow-up (BullMQ + Evolution)
│   │   └── scripts/conditional-migrate.mjs # roda migrations nos hooks predev/prestart
│   └── supabase/migrations/                # ⚠ DIRETÓRIO CANÔNICO de migrations (apesar do nome "supabase")
├── frontend/
│   └── src/
│       ├── pages/        # LeadImports.tsx (campanhas/disparos), Tenants.tsx (empresas), Conexoes.tsx, Relatorios.tsx
│       ├── components/    # EvolutionChipsPanel.tsx, charts/, ui/ (shadcn)
│       └── hooks/         # useCampanhas.ts, useLeadClients.ts, useReports.ts
└── _memoria/             # SEGUNDO CÉREBRO (ver seção 2)
```
> ⚠ O nome `backend/supabase/migrations/` é histórico. **O banco é PostgreSQL puro no Easypanel; Supabase está OBSOLETO** (ver seção 5). Migrations novas vão em `backend/supabase/migrations/`.

---

## 2. Segundo cérebro (pasta `_memoria/`)

Toda a memória do projeto vive em `~/Documents/vexo-sales-module/_memoria/`. Arquivos:

| Arquivo | Papel | Quando consultar |
|---|---|---|
| **`aprendizados.md`** | Lições técnicas já aprendidas (erros cometidos + como evitar). Append-only. | **SEMPRE, antes de mexer.** Evita repetir erro. |
| **`pendencias.md`** | Estado das tarefas por prioridade (resolvidos / a fazer / dívidas). | **SEMPRE, antes de começar.** Define o que falta. |
| `contexto-vivo.md` | Estado atual do projeto / fila de trabalho. "O repo vence em caso de divergência." | Para situar a fila atual. |
| `decisoes.md` | Decisões de produto/arquitetura (append-only: data + decisão + porquê). | Antes de re-decidir algo já decidido. |
| `auditoria-luiz-08jun.md` | Auditoria (08/jun) do que o Luiz mergeou na `main` (multi-instância Evolution, pause/resume, QR REST, onboarding). | Para entender o que veio do parceiro. |
| `HANDOFF_ANTIGRAVITY.md` | Este documento. | Onboarding. |

> **Instrução firme ao Antigravity: leia `aprendizados.md` + `pendencias.md` antes de QUALQUER tarefa.** Ao terminar, atualize `pendencias.md` e registre lição nova em `aprendizados.md`.

### Aprendizados-chave já registrados (resumo — leia o arquivo para o detalhe)
- **`tsc --noEmit` no root NÃO checa `src/`** (tsconfig solution-style com `files: []` + refs). Validar com **`npx tsc --noEmit -p tsconfig.app.json`**. Já deixou passar um `ReferenceError` (`Trash2`) em produção.
- **`vite build` (esbuild) NÃO pega identificador indefinido** — trata como global, builda, e só quebra em runtime. Quem pega é o type-check contra o tsconfig certo.
- **`ALTER TABLE ADD COLUMN IF NOT EXISTS` pega lock `ACCESS EXCLUSIVE` mesmo em no-op.** Nunca rodar `ALTER/CREATE` no caminho quente; memoizar com flag de módulo (`let _ensured = false`). Foi a causa do disparo travar em "running"/0 enviados (Fatia 3a).
- **Elegibilidade idempotente = claim ANTES do envio** (`INSERT ON CONFLICT DO NOTHING`), não marcação depois — senão crash no meio do loop duplica na retomada. Escopo POR DISPARO. `failed` conta como tocado.
- **Reutilizar tabela equivalente** em vez de criar nova (`campaign_dispatch_runs` estendida, não tabela paralela).
- **Validação backend sem DB: harness HTTP local** simulando a Evolution API + `node --check` + load ESM.
- **Renomear "Supabase"→"Postgres" no código quebra migrations** — tratar "Supabase" como sinônimo da conexão pg atual; só tocar com evidência.
- **Auditar a `main` do parceiro antes de construir** (`git log origin/main --oneline -20`) — o Luiz mergeia sem avisar.
- **Higiene de segredos:** credenciais nunca em arquivo versionado nem em memória — só env var.

---

## 3. Como acessar tudo (caminhos, NUNCA o segredo)

> **Nenhuma credencial neste arquivo.** Cada item diz ONDE obter, não o valor.

- **GitHub:** repo canônico `LuizApenas/VexoCrm` (remote `origin`). Clonar via SSH/HTTPS com seu próprio acesso. Fluxo: `git pull origin main` → editar → validar (seção 4) → `git commit` → `git push origin main`. Luiz commita direto na mesma `main` — **sempre `git pull` antes** e cheque `git log` por trabalho dele.
- **Easypanel (painel de infra):** hospeda os serviços. Acesso via conta Easypanel do projeto (peça a URL/login ao Conrado). Serviços relevantes:
  - **db-vexo** — PostgreSQL. Credenciais: Easypanel → db-vexo → aba **Credenciais**.
  - **bk-vexo** — backend Node. Variáveis de ambiente e logs ficam aqui.
  - **Evolution API** — gateway WhatsApp (envio + QR).
  - **Redis** — cache/chat.
- **Console do Postgres:** Easypanel → **db-vexo → Console → botão "Cliente Postgres"** abre o `psql` já conectado (não precisa digitar senha). Usuário: **`dbvexo`** · banco: **`vexo-data`** (estes não são segredo; a **senha** é — pegar na aba Credenciais, nunca colar em arquivo).
- **Vercel:** hospeda o front (`crm.vexoia.com`). Deploy **automático** a cada push na `main`. Painel Vercel mostra status do build.
- **Confirmar deploy do backend (bk-vexo):** o push NÃO reinicia na hora. Faça poll do health e observe o **reset de uptime** (processo novo):
  ```bash
  curl -s https://bks-bk-vexo.ymqjmy.easypanel.host/health
  # uptimeSeconds caindo para ~0 = deploy novo no ar; postgresPing:true = banco OK
  ```

---

## 4. Disciplina de validação (regra de ouro)

**Sempre antes de commitar:**
- **Front:** `npx tsc --noEmit -p tsconfig.app.json` **+** `npm run build` (vite). Type-check sozinho NÃO basta, e build sozinho também não — rodar os dois. Critério: **nenhum erro NOVO nos arquivos que você tocou** (há erros pré-existentes em arquivos lixo `" 2".tsx` e afins — não são seus).
- **Backend (.js):** `node --check <arquivo>` **+** carregar o módulo (`node --input-type=module -e "await import('./src/...')"`). O `--check` pega sintaxe; o load ESM pega import/referência indefinida.
  - Atalho do projeto: `npm --prefix backend run check` (roda `node --check` em `server.js` e `registerAllDomainRoutes.js`).
  - ⚠ `server.js` auto-inicia (`runMigrations` + `app.listen`) ao ser importado — não o importe cru para "load test" (pendura/precisa de env). Teste os módulos de domínio isolados.
- **Suite completa (opcional):** na raiz, `npm run check` = `check:backend` + testes (vitest back/front) + `build:frontend` + `git diff --check`.

**Depois do push:** confirmar deploy — Vercel (front) e uptime reset no bk-vexo (back). Se o backend não mudou, não há deploy de backend a confirmar.

---

## 5. Arquitetura crítica (o que NÃO pode ser quebrado)

- **Motor anti-ban** (diferencial vendável): cota diária **POR CHIP** (independente), **rodízio round-robin** entre chips, **delays aleatórios** entre leads (30–90s), **pausa automática** quando a cota de todos os chips esgota. Implementação em `registerAllDomainRoutes.js` (`runCampaignDispatch`, `chipProvider`, `reserveEvolutionInstanceDailyQuota`) + `campaign-outbound.js` (`dispatchCampaignSequence`). Cota fica em `evolution_instance_daily_usage (instance_id, date, sent_count)`.
- **Disparo roda em LOOP SÍNCRONO no Express, NÃO em BullMQ/fila.** Por isso o **lote tem teto de 500** (`CAMPAIGN_LIMIT_MAX`) — acima disso o request longo trava o processo. Migrar pra fila é pré-requisito para passar de 500 / base grande. Hoje lotes ≤500 são seguros.
- **Livro-razão de dedup:** `campaign_dispatch_runs` com **`UNIQUE INDEX (dispatch_id, lead_id)`**. Dedup é **POR DISPARO** — o mesmo lead não recebe 2x no mesmo disparo, mas PODE em disparos futuros (preserva follow-up/remarketing). NÃO trocar por dedup global.
- **Claim idempotente ANTES do envio:** `INSERT ... ON CONFLICT (dispatch_id, lead_id) DO NOTHING` marca `claimed` antes de chamar a Evolution; `failed` conta como tocado (sai do reprocesso) e é exportável via endpoint de failed. `buildDispatchLeads(excludeDispatchId)` remove da fila quem já tem registro no disparo.
- **`statement_timeout`/`query_timeout` = 30s no pool pg** (`pgSupabaseCompat.js`): query travada em lock morre em 30s (→ disparo cai em `failed`, visível) em vez de pendurar pra sempre em "running".
- **Banco é PostgreSQL no Easypanel. Supabase está OBSOLETO** (migração concluída). Ignorar referências a Supabase/service-role no código — são compat/legado. O nome `supabase` no `pgSupabaseCompat`/migrations é só rótulo histórico; **NÃO renomear** (quebra migrations).

---

## 6. Onde encontrar erros e histórico

- **`_memoria/aprendizados.md`** — erros já cometidos e como evitar (primeira parada).
- **Logs do backend:** Easypanel → bk-vexo → **Registros/Logs**.
- **Logs do Postgres:** Easypanel → db-vexo → **Registros**. Para lock vivo: `SELECT pid,state,wait_event_type,wait_event,now()-query_start AS dur,left(query,120) FROM pg_stat_activity WHERE state<>'idle';`
- **Falhas de disparo:** `GET /api/campaigns/dispatches/:dispatchId/failed` (aceita `?format=csv`) — lista os leads `failed` daquele disparo para tratamento manual.
- **Histórico de mudanças:** `git log --oneline -30`.

---

## 7. O que JÁ foi feito (estado atual)

Commits recentes na `main` (mais novo primeiro):

| Commit | Entrega | Estado |
|---|---|---|
| `dfb311e` | **Lote configurável** (input livre 1–500, validação front + clamp backend) | No ar |
| `e680684` | Fix: tipar `campaign_prompt_id` no front (prompt do agente ao editar) | No ar |
| `db611be` | **Editar Campanha** (botão + reuso do form de criação, PATCH existente) | No ar |
| `f82fcdf` | **Relatórios v1** — gráfico de envios/dia por chip (recharts, `evolution_instance_daily_usage`) | No ar |
| `8abde88` | **Defeito A** — elegibilidade idempotente por disparo + claim | No ar |
| `e24b5a4` | `statement_timeout`/`query_timeout` 30s no pool pg | No ar |
| `71621f5` | Tela **Conexões** (painel de chips reutilizável extraído do Tenants) | No ar |
| `5047a77`, `1aacb0c`, `3232ec3` | **Anti-ban 3a/3b** — cota por chip + rotação + delay + UI de cota | No ar |

- **Defeito A (elegibilidade/claim):** RESOLVIDO. A lógica de orquestração foi provada por harness HTTP local. **Gate live** (rodar o mesmo disparo 2x → 0 elegíveis na segunda) deve ser confirmado no banco quando houver disparo real — ver `pendencias.md`.
- **Editar Campanha / Relatórios v1 / Lote configurável / statement_timeout / Conexões / anti-ban 3a-3b:** fechados.

---

## 8. O que FALTA fazer (backlog priorizado)

1. **[Operacional, não-código]** Definir a **cota real por chip da Umuarama** (base × aquecimento dos chips). Cliente começa atendimento na segunda.
2. **Migração do disparo para BullMQ/fila** — pré-requisito para lote >500 e base grande (Liv Pub 23k, se fechar). NÃO bloqueia Umuarama hoje.
3. **Botão "limpar/reutilizar disparos" (remarketing)** — **DECIDIR semântica antes de codar**: "ocultar da lista" vs "resetar disparo concluído". ⚠ NÃO apagar o livro-razão (`campaign_dispatch_runs`) de um disparo ativo às cegas — reabre risco de envio duplo.
4. **[Investigar, não consertar às cegas]** Aba "Leads Pendentes" → colunas **Em Contato / Qualificado / Segmentados** não populam. Hipótese provável: comportamento correto (leads recém-disparados são todos "Novo"). **Inspecionar a lógica de mapeamento estágio→coluna ANTES de mexer** (em `LeadImports.tsx`, visão Kanban/Funil lê `normalized_data.status`).
5. **Refino de UX/layout** — cores, reorganização e agrupamento de ferramentas no menu. Há item de "pente-fino" (labels cortados, contraste claro/escuro) em `pendencias.md`.
6. **Staging** — dívida com gatilho (quando o onboarding Umuarama começar). Hoje valida em produção porque o login local está quebrado (Firebase de outro projeto).

**Design system:** Electric Indigo **`#6366F1`** (estrutura/navegação) · laranja **`#ff7a1a`** (ação/marca) · Cyan Neon `#22D3EE` (complemento). Não improvisar paleta.

---

## 9. Clientes e prazos

- **Umuarama Materiais** — cliente CONFIRMADO. Onboarding começa **segunda (semana de 15/06)**.
- **Liv Pub (≈23k leads)** — prospect futuro, contrato **NÃO fechado**. É o gatilho da migração pra fila.

---

## 10. Como trabalhar em conjunto (com o Claude Code)

1. **Antes de qualquer tarefa:** ler `aprendizados.md` + `pendencias.md`.
2. **Inspecionar o código real antes de assumir** nomes de coluna/endpoint. Classe de erro recorrente neste projeto: campo certo, nome errado → some silenciosamente (ex.: `maskN8nSettings` mostrando "0" instâncias; SELECT sem `campaign_prompt_id`). Rodar `\d <tabela>` no psql / `grep` no código — não chutar.
3. **Reusar endpoints/componentes existentes** em vez de duplicar (ex.: PATCH de campanha já existia; `EvolutionChipsPanel` é compartilhado por Empresas e Conexões).
4. **Validar (seção 4) antes de commitar.** Confirmar deploy depois.
5. **Ao terminar:** atualizar `pendencias.md` e registrar lição nova em `aprendizados.md`.
6. **`git pull` sempre antes de começar** — o Luiz commita direto na `main`.
