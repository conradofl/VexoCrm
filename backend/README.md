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
| `GET` | `/api/notifications` | feed de notificacoes |
| `PATCH` | `/api/notifications` | marcar notificacoes como lidas |

## Endpoints de compatibilidade

As rotas abaixo ainda existem no codigo, mas nao sao a interface principal do workflow atual porque o n8n esta usando Edge Functions do Supabase:

- `POST /api/leads-webhook`
- `POST /api/n8n-error-webhook`
- `POST /api/conversation-memory`

## Variaveis de ambiente

| Variavel | Uso |
| --- | --- |
| `PORT` | porta do servidor; padrao `3001` |
| `CORS_ORIGINS` | origens permitidas |
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | service role do Supabase |
| `SUPABASE_ACCESS_TOKEN` | token da CLI para aplicar migrations no startup do container |
| `SUPABASE_DB_PASSWORD` | senha do banco remoto usada pelo Supabase CLI |
| `SUPABASE_DB_URL` | string de conexao alternativa para aplicar migrations sem `link` |
| `RUN_SUPABASE_MIGRATIONS_ON_START` | habilita ou desabilita migrations automaticas no boot |
| `FIREBASE_PROJECT_ID` | projeto Firebase |
| `FIREBASE_CLIENT_EMAIL` | service account Firebase |
| `FIREBASE_PRIVATE_KEY` | chave privada Firebase |
| `N8N_WEBHOOK_SECRET` | bearer global legado para webhooks que ainda nao usam escopo por empresa |
| `GROQ_API_KEY` | chave opcional para assistencia de IA nas campanhas |
| `GROQ_CAMPAIGN_AI_MODEL` | modelo Groq opcional para as sugestoes de campanha |

Veja [backend/.env.example](./.env.example).

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

No EasyPanel com auto deploy, o comportamento automatico agora vem da propria imagem do backend:

- o container sobe;
- executa `backend/scripts/apply-supabase-migrations.sh`;
- aplica as migrations de `backend/supabase/migrations`;
- e so depois inicia a API com `npm start`.

Para isso funcionar no EasyPanel, configure no service as variaveis:

- `SUPABASE_ACCESS_TOKEN` + `SUPABASE_DB_PASSWORD`
- ou `SUPABASE_DB_URL`
- opcionalmente `SUPABASE_PROJECT_ID` se quiser sobrescrever `backend/supabase/config.toml`

Se essas variaveis nao estiverem presentes e `RUN_SUPABASE_MIGRATIONS_ON_START=1`, o container falha antes de publicar uma versao possivelmente incompativel com o schema.

Use 1 replica no service se voce quiser evitar duas instancias tentando aplicar migrations ao mesmo tempo durante um deploy.

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
