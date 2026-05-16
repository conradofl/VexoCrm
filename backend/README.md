# Backend VexoCrm

Camada Node.js/Express de apoio ao CRM.

Hoje este backend nao e a origem principal da operacao de leads no n8n. O fluxo operacional de captacao e qualificacao usa `Supabase Edge Functions`. O backend existe para:

- servir o frontend do CRM;
- autenticar usuarios via Firebase;
- expor consultas agregadas de dashboard e leads;
- centralizar notificacoes operacionais.

## Stack

- Node.js 20+
- Express
- Supabase JS
- Firebase Admin
- Docker

## Endpoints em uso

| Metodo | Rota | Uso atual |
| --- | --- | --- |
| `GET` | `/health` | health check |
| `GET` | `/api/lead-clients` | filtros do CRM |
| `GET` | `/api/dashboard` | dashboard do CRM |
| `GET` | `/api/leads` | listagem de leads |
| `POST` | `/api/n8n-dispatches` | envia numeros/leads para webhook de disparo no n8n |

## Endpoints de compatibilidade

As rotas abaixo ainda existem no codigo, mas nao sao a interface principal do workflow atual porque o n8n esta usando Edge Functions do Supabase:

- `POST /api/import-lead-infinie-n8n`

## Variaveis de ambiente

| Variavel | Uso |
| --- | --- |
| `DATABASE_URL` | Postgres connection string; activates pg driver unless `DATA_SOURCE=supabase` or `DB_DRIVER=supabase` |
| `DATA_SOURCE` | set to `supabase` to keep Supabase JS when `DATABASE_URL` is also defined |
| `DB_DRIVER` | optional `postgres` / `supabase` to force one stack explicitly |
| `PG_POOL_MAX` | max connections in the pg pool |
| `PG_CONNECTION_TIMEOUT_MS` | pool connection timeout (default 20s) |
| `HEALTH_PG_PING_TIMEOUT_MS` | max wait for `select 1` inside `/health` (default 4s; keeps Docker HEALTHCHECK from hanging) |
| `PORT` | porta do servidor; padrao `3001` |
| `EXPOSE_INTERNAL_ERROR_DETAILS` | se `1`/`true` em produção, respostas `INTERNAL_ERROR` incluem `error.details` (mensagem / código) para depuração; desligar depois |
| `CORS_ORIGINS` | comma-separated browser origins; in production `*` is ignored (must list real SPA URLs) |
| `FRONTEND_ORIGIN` | optional single SPA URL merged into CORS allow list (EasyPanel-friendly) |
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | service role do Supabase |
| `SUPABASE_ACCESS_TOKEN` | token da CLI para aplicar migrations no startup do container |
| `SUPABASE_DB_PASSWORD` | senha do banco remoto usada pelo Supabase CLI |
| `SUPABASE_DB_URL` | string de conexao alternativa para aplicar migrations sem `link` |
| `RUN_SUPABASE_MIGRATIONS_ON_START` | Docker `start.sh` only: `1` roda migrations antes do `npm start` dentro do container |
| `SKIP_DB_MIGRATE` | Local `npm run dev` / `npm start`: defina `1` para pular o `db push` dos hooks `predev`/`prestart` |
| `FIREBASE_PROJECT_ID` | projeto Firebase |
| `FIREBASE_CLIENT_EMAIL` | service account Firebase |
| `FIREBASE_PRIVATE_KEY` | chave privada Firebase |
| `N8N_WEBHOOK_SECRET` | bearer global legado para webhooks que ainda nao usam escopo por empresa |
| `GROQ_API_KEY` | chave opcional para assistencia de IA nas campanhas |
| `GROQ_CAMPAIGN_AI_MODEL` | modelo Groq opcional para as sugestoes de campanha |
| `EVOLUTION_DISPATCH_WEBHOOKS_JSON` | fallback opcional por tenant para URL/token de disparo direto |
| `EVOLUTION_DISPATCH_WEBHOOK_URL_<TENANT>` | fallback opcional de URL por tenant, ex.: `EVOLUTION_DISPATCH_WEBHOOK_URL_INFINIE` |
| `EVOLUTION_DISPATCH_WEBHOOK_TOKEN_<TENANT>` | token opcional do fallback por tenant |

Veja [backend/.env.example](./.env.example) e [scripts/README-db-migrations.md](./scripts/README-db-migrations.md) para migrations na VPS.

## Validacao de deploy do backend

Depois de publicar alteracoes que criam rotas novas, valide se o EasyPanel esta servindo a imagem correta:

```bash
curl https://SEU_BACKEND/health
```

O retorno precisa conter `ok: true`. Com Postgres direto, `services.postgresPing` indica se o ping ao banco respondeu dentro do orcamento do `/health` (timeout curto para nao travar probes do Docker). Se `false`, verifique `DATABASE_URL` a partir do container (rede/firewall/host).

Se `/api/campaigns/direct-dispatch` ou `/api/campaigns/ai/status` retornar `Cannot POST` ou `Cannot GET`, o frontend ja foi atualizado, mas o backend publicado ainda esta antigo ou apontando para outra instancia.

## Disparo direto de campanhas

O disparo direto usa esta ordem para resolver a URL Evolution/n8n da empresa:

1. `lead_client_n8n_settings.dispatch_webhook_url` da empresa selecionada.
2. Fallback opcional por tenant em `EVOLUTION_DISPATCH_WEBHOOKS_JSON`.
3. Fallback opcional por tenant em `EVOLUTION_DISPATCH_WEBHOOK_URL_<TENANT>`.

Nao use webhook global para disparo direto multi-tenant. Cada empresa precisa ter sua propria URL salva na tabela ou configurada por tenant nas variaveis acima.

## Dados expostos ao frontend

O backend consulta o schema atual de `leads`, sem colunas antigas como:

- `conta_energia`
- `bot_ativo`
- `historico`

As metricas do dashboard hoje usam:

- `totalLeads`
- `leadsToday`
- `qualifiedLeads`
- `qualificationRate`
- `activeCities`
- distribuicao por temperatura, perfil e status

## Execucao local

```powershell
cd backend
npm install
npm run dev
```

Servidor local: `http://localhost:3001`

## Docker

```bash
docker build -t vexo-api .
docker run --env-file .env -p 3001:3001 vexo-api
```

## Deploy

```bash
cd backend
bash ./deploy.sh
```

No EasyPanel com auto deploy, a imagem do backend inicia a API com `npm start` por padrao.

Se voce quiser aplicar migrations no boot, habilite explicitamente `RUN_SUPABASE_MIGRATIONS_ON_START=1`. Nesse modo:

- o container sobe;
- executa `backend/scripts/apply-supabase-migrations.sh`;
- aplica as migrations de `backend/supabase/migrations`;
- e so depois inicia a API com `npm start`.

Para esse fluxo opcional funcionar no EasyPanel, configure no service as variaveis:

- `RUN_SUPABASE_MIGRATIONS_ON_START=1`
- `SUPABASE_ACCESS_TOKEN` + `SUPABASE_DB_PASSWORD`
- ou `SUPABASE_DB_URL`
- opcionalmente `SUPABASE_PROJECT_ID` se quiser sobrescrever `backend/supabase/config.toml`

Se essas variaveis nao estiverem presentes e `RUN_SUPABASE_MIGRATIONS_ON_START=1`, o container falha antes de iniciar a API.

Use 1 replica no service se voce quiser evitar duas instancias tentando aplicar migrations ao mesmo tempo durante um deploy.

### VPS Postgres

Quando o schema ja esta aplicado na VPS via dump/restore, prefira `RUN_SUPABASE_MIGRATIONS_ON_START=0` ou aplique SQL com `SUPABASE_DB_URL` apontando para a VPS — veja [scripts/README-db-migrations.md](./scripts/README-db-migrations.md).

## Migrations no auto deploy

O auto deploy do backend no EasyPanel usa apenas o contexto `backend/`. Por isso, as migrations que entram na imagem ficam em `backend/supabase/migrations`.

Quando voce criar ou alterar migrations em `frontend/supabase`, sincronize a copia do backend antes do commit:

```bash
node scripts/sync-supabase-assets.mjs
```

## Posicionamento deste modulo

Se a pergunta for "onde a automacao de leads roda hoje?", a resposta correta e:

- `n8n + Supabase Edge Functions`

Se a pergunta for "onde o CRM web consulta dados?", a resposta correta e:

- `backend/`
