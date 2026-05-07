# VexoCRM - Índice Completo do Projeto

**Data do índice:** 2026-05-06  
**Versão do projeto:** Sistema multi-tenant de CRM com automação n8n

---

## 📋 Sumário Executivo

VexoCRM é um **CRM integrado com automação de leads** via n8n e Supabase Edge Functions. O sistema captura, qualifica e gerencia leads através de WhatsApp, com dashboard operacional e portal por cliente.

**Arquitetura:** n8n + Supabase + React/Node.js  
**Deploy:** Backend em EasyPanel (VPS), Frontend em Vercel  
**Status:** Em produção com múltiplos tenants

---

## 📁 Estrutura de Pastas

```
VexoCrm/
├── backend/              # API Node.js/Express
├── frontend/             # App React/Vite + Edge Functions
├── docs/                 # Documentação técnica e executiva
├── database.md           # Schema do banco
├── SECURITY_*.md         # Documentos de segurança (P0 fixes)
└── MIGRACAO_SUPABASE_STATUS.md  # Status de migração

```

---

## 🔧 BACKEND

**Localização:** `backend/`  
**Stack:** Node.js 20+, Express, Supabase JS, Firebase Admin, Docker  
**Porta padrão:** 3001  
**Deploy:** Docker no EasyPanel com auto-deploy

### Responsabilidades principais

- Servir frontend CRM
- Autenticar usuários via Firebase
- Expor consultas de dashboard e leads
- Centralizar notificações operacionais
- Integração com Supabase (opcional Postgres direto)

### Arquivos críticos

| Arquivo | Responsabilidade |
| --- | --- |
| `src/server.js` | Inicialização Express e rotas principais |
| `src/commercial-intelligence.js` | Inteligência comercial e IA (Groq) |
| `src/campaign-outbound.js` | Gestão de campanhas de disparo |
| `src/campaign-ai.js` | Geração de sugestões com IA |
| `src/whatsapp.js` | Integração WhatsApp |
| `src/accessGuards.js` | Middleware de autenticação e autorização |
| `src/tenantScope.js` | Escopo multi-tenant |
| `src/userAccessScope.js` | Validação de acesso por usuário |
| `src/notificationScope.js` | Contexto de notificações |
| `src/securityConfig.js` | Configurações de segurança |
| `src/validators.js` | Validadores de entrada |
| `src/pgSupabaseCompat.js` | Camada de compatibilidade Postgres/Supabase |
| `src/repos/` | Repository pattern (abstração de dados) |
| `.env.example` | Template de variáveis de ambiente |
| `deploy.sh` | Script de deploy para EasyPanel |
| `start.sh` | Entrada do container Docker |
| `scripts/apply-supabase-migrations.sh` | Aplicação de migrations |
| `supabase/migrations/` | Migrations de schema |

### Endpoints em uso

| Método | Rota | Uso |
| --- | --- | --- |
| `GET` | `/health` | Health check com status de serviços |
| `GET` | `/api/lead-clients` | Filtros do CRM (clientes/origens) |
| `GET` | `/api/dashboard` | Métricas do dashboard |
| `GET` | `/api/leads` | Listagem paginada de leads |
| `POST` | `/api/n8n-dispatches` | Envia leads para disparo no n8n |
| `GET` | `/api/notifications` | Feed de notificações |
| `PATCH` | `/api/notifications` | Marca notificações como lidas |
| `POST` | `/api/campaigns/direct-dispatch` | Disparo direto de campanhas |
| `GET` | `/api/campaigns/ai/status` | Status de IA em campanhas |

### Endpoints de compatibilidade (legado)

Existem mas não são primários:
- `POST /api/leads-webhook`
- `POST /api/n8n-error-webhook`
- `POST /api/conversation-memory`

### Variáveis de ambiente

**Banco de dados:**
- `DATABASE_URL` — Connection string Postgres (ativa driver pg)
- `DATA_SOURCE=supabase` — Force Supabase JS mesmo com DATABASE_URL
- `DB_DRIVER` — Força `postgres` ou `supabase` explicitamente
- `PG_POOL_MAX` — Max conexões no pool (padrão 10)
- `PG_CONNECTION_TIMEOUT_MS` — Timeout de pool em ms

**Supabase:**
- `SUPABASE_URL` — URL do projeto
- `SUPABASE_SERVICE_ROLE_KEY` — Service role key
- `SUPABASE_ACCESS_TOKEN` — Token CLI para migrations
- `SUPABASE_DB_PASSWORD` — Senha do banco remoto
- `SUPABASE_DB_URL` — String de conexão alternativa
- `RUN_SUPABASE_MIGRATIONS_ON_START` — Habilita auto-migrations no boot

**Server:**
- `PORT` — Porta da API (padrão 3001)
- `CORS_ORIGINS` — Origens permitidas (comma-separated)

**Firebase:**
- `FIREBASE_PROJECT_ID` — Project ID
- `FIREBASE_CLIENT_EMAIL` — Service account email
- `FIREBASE_PRIVATE_KEY` — Private key (PEM format)

**n8n/Webhooks:**
- `N8N_WEBHOOK_SECRET` — Bearer global legado para webhooks
- `EVOLUTION_DISPATCH_WEBHOOKS_JSON` — JSON com fallbacks por tenant
- `EVOLUTION_DISPATCH_WEBHOOK_URL_<TENANT>` — URL por tenant (ex: `_INFINIE`)
- `EVOLUTION_DISPATCH_WEBHOOK_TOKEN_<TENANT>` — Token por tenant

**IA/Groq:**
- `GROQ_API_KEY` — Chave API Groq (opcional)
- `GROQ_CAMPAIGN_AI_MODEL` — Modelo Groq para sugestões (opcional)

### Disparo direto de campanhas

Ordem de resolução de URL Evolution/n8n:
1. `lead_client_n8n_settings.dispatch_webhook_url` (banco)
2. `EVOLUTION_DISPATCH_WEBHOOKS_JSON` (fallback JSON)
3. `EVOLUTION_DISPATCH_WEBHOOK_URL_<TENANT>` (fallback env por tenant)

**Regra:** Cada empresa deve ter URL própria configurada, não use webhook global para multi-tenant.

### Migrations no deploy

- Auto deploy EasyPanel usa contexto `backend/` apenas
- Migrations ficam em `backend/supabase/migrations`
- Se criar migrations em `frontend/supabase`, sincronize:
  ```bash
  node scripts/sync-supabase-assets.mjs
  ```

### Execução local

```powershell
cd backend
npm install
npm run dev
```

### Docker

```bash
docker build -t vexo-api .
docker run --env-file .env -p 3001:3001 vexo-api
```

### Deploy

```bash
cd backend
bash ./deploy.sh
```

---

## 🎨 FRONTEND

**Localização:** `frontend/`  
**Stack:** React 18, TypeScript, Vite, TanStack Query, Firebase Auth, Recharts, Radix UI  
**Build tool:** Bun ou npm  
**Deploy:** Vercel

### Experiências entregues

1. **CRM interno** — Dashboard operacional, base de leads, visão de agente
2. **Portal por cliente** — Rotas públicas controladas por cliente

### Rotas principais

| Rota | Descrição | Tipo |
| --- | --- | --- |
| `/` | Landing page institucional | Público |
| `/login` | Autenticação Firebase | Público |
| `/set-password` | Troca obrigatória de senha | Autenticado |
| `/crm/dashboard` | Dashboard operacional | CRM |
| `/crm/leads` | Base de leads com filtros | CRM |
| `/crm/agente` | Notificações e status operacional | CRM |
| `/crm/tenants` | Gestão de tenants (multi-tenant) | Admin |
| `/crm/user-access` | Gestão de acesso de usuários | Admin |
| `/crm/whatsapp-inbox` | Inbox de WhatsApp | CRM |
| `/crm/lead-imports` | Importação em lote de leads | CRM |
| `/crm/commercial-intelligence` | IA para insights comerciais | CRM |
| `/clientes/:clientId/dashboard` | Portal resumido por cliente | Portal |
| `/clientes/:clientId/leads` | Leads do cliente | Portal |
| `/clientes/:clientId/whatsapp` | WhatsApp do cliente | Portal |
| `/clientes/:clientId/planilhas` | Planilhas do cliente | Portal |

### Estrutura de pastas

```
frontend/src/
├── pages/          # Componentes de página (rotas)
├── components/     # Componentes reutilizáveis
│   ├── ui/         # Primitivos Radix UI
│   └── charts/     # Gráficos com Recharts
├── contexts/       # React Contexts (estado global)
├── hooks/          # Custom hooks
├── lib/            # Utilitários
│   └── api.ts      # Client HTTP (TanStack Query)
└── App.tsx         # Router e layout principal

frontend/supabase/
└── functions/      # Edge Functions (n8n utiliza)
```

### Páginas implementadas

| Página | Arquivo | Responsabilidade |
| --- | --- | --- |
| Landing | `pages/LandingPage.tsx` | Entrada institucional |
| Dashboard | `pages/Dashboard.tsx` | Métricas operacionais |
| Leads | `pages/Leads.tsx` | Base com schema atual |
| Agente | `pages/Agente.tsx` | Notificações e erros n8n |
| Login | `pages/Login.tsx` | Firebase Auth |
| Set Password | `pages/SetPassword.tsx` | Troca obrigatória |
| Tenants | `pages/Tenants.tsx` | Multi-tenant admin |
| User Access | `pages/UserAccessManagement.tsx` | RBAC management |
| WhatsApp Inbox | `pages/WhatsAppInbox.tsx` | Conversa WhatsApp |
| Lead Imports | `pages/LeadImports.tsx` | Importação CSV/Excel |
| Commercial Intelligence | `pages/CommercialIntelligence.tsx` | IA e insights |
| Client Portal Dashboard | `pages/ClientPortalDashboard.tsx` | Vista por cliente |
| Client Portal Leads | `pages/ClientPortalLeads.tsx` | Leads filtrados |
| Client Portal WhatsApp | `pages/ClientPortalWhatsApp.tsx` | Chat do cliente |
| Client Portal Planilhas | `pages/ClientPortalPlanilhas.tsx` | Dados tabulares |
| Client Signup | `pages/ClientSignup.tsx` | Cadastro no portal |
| Not Found | `pages/NotFound.tsx` | 404 |
| Pending Approval | `pages/PendingApproval.tsx` | Aprovação pendente |

### Componentes principais

| Componente | Arquivo | Uso |
| --- | --- | --- |
| MainLayout | `components/MainLayout.tsx` | Layout do CRM |
| AuthLayout | `components/AuthLayout.tsx` | Layout login/signup |
| AppSidebar | `components/AppSidebar.tsx` | Sidebar navegação |
| PageShell | `components/PageShell.tsx` | Wrapper de página |
| KpiGrid | `components/KpiGrid.tsx` | Grades de métricas |
| FilterPanel | `components/FilterPanel.tsx` | Filtros de dados |
| ErrorBoundary | `components/ErrorBoundary.tsx` | Tratamento de erros React |
| NotificationList | `components/NotificationList.tsx` | Feed de notificações |
| RevenueChart | `components/charts/RevenueChart.tsx` | Gráfico de receita |
| ConversionDonut | `components/charts/ConversionDonut.tsx` | Rosca de conversão |
| PipelineChart | `components/charts/PipelineChart.tsx` | Pipeline visual |
| theme-provider | `components/theme-provider.tsx` | Tema e CSS variables |
| UI (Radix) | `components/ui/*.tsx` | Primitivos (accordion, dialog, etc) |

### Consumo de dados

**Backend Node.js:**
- `GET /api/lead-clients` — Clientes e filtros
- `GET /api/dashboard` — Métricas
- `GET /api/leads` — Leads paginados
- `GET /api/notifications` — Notificações
- `PATCH /api/notifications` — Marcar como lidas

**Autenticação:**
- Firebase Auth no login
- Token validado pelo backend em rotas protegidas

### Supabase Edge Functions

Pasta `frontend/supabase/functions/` está no repositório frontend por conveniência, mas:
- Não entra no bundle React
- Pertence ao runtime de automação n8n
- Documentadas em `docs/supabase-functions.md`

### Variáveis de ambiente

```env
VITE_API_BASE_URL=http://seu-backend.com
# Se não definida, usa http://127.0.0.1:3001 em dev
```

Copie `.env.example` para `.env.local`.

### Execução local

```powershell
cd frontend
npm install
npm run dev
```

Acesso: `http://localhost:5173` (Vite default)

### Build

```powershell
cd frontend
npm run build
```

Output em `frontend/dist/`

---

## 🗄️ BANCO DE DADOS

**Localização:** `database.md` + `backend/supabase/migrations/`

### Tabelas operacionais

| Tabela | Responsabilidade |
| --- | --- |
| `leads_clients` | Cadastro de clientes/origens |
| `leads` | Base principal de leads |
| `lead_conversations` | Memória comprimida de conversas |
| `notifications` | Notificações operacionais do sistema |
| `n8n_error_logs` | Auditoria de erros e falhas |
| `lead_client_n8n_settings` | Configuração de webhook por cliente |

### Schema atual de leads

- `telefone` — Identificador principal
- `nome` — Nome do lead
- `tipo_cliente` — Classificação (tipo)
- `faixa_consumo` — Faixa de consumo (energia, água, etc)
- `cidade` — Localização
- `estado` — UF
- `status` — Estado (novo, qualificado, fechado, etc)
- `data_hora` — Timestamp de criação
- `qualificacao` — Score de qualificação
- `created_at` — Data de criação no sistema

### Colunas descontinuadas

Não mais usadas no schema:
- `conta_energia`
- `bot_ativo`
- `historico`

---

## 🔄 AUTOMAÇÃO (n8n + Supabase)

**Localização:** `docs/workflow-n8n.md`

### Componentes de automação

| Componente | Responsabilidade |
| --- | --- |
| `n8n` | Orquestração de workflow, qualificação, envio de respostas |
| `Supabase Edge Functions` | Funções serverless chamadas pelo n8n |
| `conversation-memory` | Compactação de histórico de conversa |
| `conversation-memory-latest` | Busca do contexto mais recente |
| `lead-webhook` | Criar/finalizar leads |
| `n8n-error-webhook` | Registrar falhas e gerar notificações |

### Fluxo típico de um lead

1. Webhook n8n recebe mensagem WhatsApp
2. Telefone é normalizado
3. n8n consulta `conversation-memory-latest` para contexto
4. Se novo, cria lead com `lead-webhook` (action=create)
5. Motor de qualificação conduz conversa
6. Ao final, n8n chama `lead-webhook` (action=finalize)
7. Memória é compactada e salva em `conversation-memory`
8. Se erro: `n8n-error-webhook` registra e notifica CRM
9. CRM consome dados consolidados via backend

### Entrada de mensagens

- WhatsApp via API de mensageria
- Webhook de entrada no n8n

---

## 📚 DOCUMENTAÇÃO

**Localização:** `docs/`

### Documentos técnicos

| Arquivo | Conteúdo |
| --- | --- |
| `README.md` | Índice de documentação |
| `arquitetura-operacional.md` | Arquitetura real em uso |
| `workflow-n8n.md` | Fluxo de automação n8n |
| `supabase-functions.md` | Edge Functions disponíveis |
| `apresentacao-executiva.md` | Overview executivo do produto |

### Formatos disponíveis

Documentos principais geram versões em:
- **Markdown** (.md) — Edição e controle de versão
- **HTML** (.html) — Visualização e compartilhamento
- **PDF** (.pdf) — Impressão e apresentações

---

## 🔒 SEGURANÇA

**Localização:** `SECURITY_*.md` + `P0_FIXES_COMPLETE.md`

### Documentos de segurança

| Arquivo | Status |
| --- | --- |
| `SECURITY_SUMMARY.md` | Resumo de melhorias realizadas |
| `SECURITY_FIXES_P0.md` | P0 fixes críticos |
| `SECURITY_IMPROVEMENTS.md` | Melhorias gerais |
| `P0_FIXES_COMPLETE.md` | Checklist de conclusão |

### Pontos críticos

- Autenticação via Firebase
- Validação de token em rotas protegidas
- Escopo multi-tenant com validação por empresa
- Acesso por usuário com RBAC
- Tratamento de segredos via variáveis de ambiente

---

## 🚀 DEPLOY

### Backend (EasyPanel - VPS)

**Process:** Docker auto-deploy com contexto `backend/`

1. Push para `main`
2. EasyPanel detecta mudança
3. Executa `docker build` com contexto `backend/`
4. Inicia container com `npm start`
5. Health check em `/health`

**Setup recomendado:**
- 1 replica se aplicar migrations no boot
- Variáveis `RUN_SUPABASE_MIGRATIONS_ON_START`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`

### Frontend (Vercel)

**Process:** Build automático no push

1. Push para `main`
2. Vercel detecta
3. Executa `npm run build` (ou `bun run build`)
4. Deploy em CDN global

---

## 📦 Módulos e dependências

### Backend principais
- **express** — Framework web
- **supabase** — Cliente JS (dados + auth)
- **firebase-admin** — Autenticação backend
- **pg** — Driver Postgres (opcional)
- **node-fetch** — HTTP client

### Frontend principais
- **react** — UI framework
- **@tanstack/react-query** — Data fetching
- **recharts** — Gráficos
- **@radix-ui/** — Primitivos acessíveis
- **typescript** — Type safety
- **vite** — Build tool
- **firebase** — Auth frontend

---

## 🔗 Fluxo de integração

```
WhatsApp → n8n webhook → Supabase Edge Functions
                          ↓
                       leads table
                          ↓
                      Backend Node.js
                          ↓
                       Frontend React
```

```
Frontend → Backend (node) → Supabase
                              ↓
                    lead_clients, leads, 
                    notifications, n8n_error_logs
```

---

## 📝 Notas operacionais

- **Origem principal de fluxo:** n8n + Supabase + Edge Functions
- **Backend não é origin:** Funciona como consolidação e produto
- **Multi-tenant:** Validação por empresa em cada request
- **Migrations:** Sincronize se editar em `frontend/supabase`
- **Health check:** Sempre valide deploy com `GET /health`

---

## 📂 Arquivos importantes a ler

**Começar por:**
1. `docs/apresentacao-executiva.md`
2. `docs/arquitetura-operacional.md`
3. `docs/workflow-n8n.md`
4. `backend/README.md`
5. `frontend/README.md`

---

**Último update:** 2026-05-06  
**Mantido por:** Claude Code com memória persistente
