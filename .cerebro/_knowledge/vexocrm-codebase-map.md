---
name: Mapa de Codebase VexoCRM
description: Localização de arquivos, responsabilidades, pontos de entrada
type: knowledge
tags: [#vexocrm, #codebase, #reference]
status: active
created: 2026-05-09
updated: 2026-05-09
---

# Mapa de Codebase — VexoCRM

**Objetivo:** Localizar rapidamente onde fazer alterações e entender fluxos  
**Última atualização:** 2026-05-09

---

## 1. BACKEND (`backend/src/`)

### 1.1 Arquivo principal

**`server.js`** (3.000+ linhas)
- ✨ **Ponto de entrada** da API
- Inicialização Express
- Todas as rotas principais
- Middleware de autenticação
- Handlers de erro global

**Estrutura interna:**
```javascript
// Linhas 1-100: Imports + inicialização
// Linhas 100-300: CORS + segurança
// Linhas 300-500: Firebase + database setup
// Linhas 500+: Rotas GET (health, leads, dashboard, etc)
// Linhas 1000+: Rotas POST (webhooks, imports, campaigns)
// Linhas 2000+: Rotas especiais (whatsapp, admin)
// Linhas 2500+: Error handlers
```

---

### 1.2 Módulos de autorização

**`accessGuards.js`**
- `requireFirebaseAuth` — Valida token
- `requireAppViewAccess(view)` — Permissão de visualização
- `canAccessAppView(uid, view)` — Check booleano
- `hasAccessPermission(permission)` — Permissão granular

**Uso:**
```javascript
app.get("/api/leads",
  requireFirebaseAuth,
  requireAppViewAccess("leads"),
  async (req, res) => { ... }
);
```

---

**`tenantScope.js`**
- Multi-tenant validation
- `resolveRequiredAuthorizedClientId(clientId)`
- Valida acesso de internal users a clientes específicos
- Admin bypass logic

**Fluxo:**
```
requisição com ?clientId=X
  → extractClientIdFromRequest()
  → validar role (admin/internal/client)
  → validar clientIds array
  → retornar clientId autorizado ou erro 403
```

---

**`userAccessScope.js`**
- RBAC (Role-Based Access Control)
- `hasUserPermission(perm)` — Check granular
- `canAssignManagedAccess(source, target, clientId)`
- `filterVisibleUserRecords(records, user)` — Filtro de visibilidade
- `canManageTargetAccess(actor, target, clientId)`

**Permissões:**
- `view:leads`, `edit:leads`
- `view:campaigns`, `edit:campaigns`
- `manage:users`, `view:users`
- `admin:system`, `admin:tenant`

---

**`notificationScope.js`**
- Contexto de notificação
- Quem vê qual notificação
- Baseado em role + clientId

---

**`securityConfig.js`**
- Middleware de segurança global
- Helmet (headers de segurança)
- Rate limiters (3 níveis)
- Sanitização de entrada
- Validação de Content-Type

**Rate limiters:**
```javascript
generalLimiter: 200 req/15min
authLimiter: 20 req/15min
webhookLimiter: 60 req/1min
```

---

### 1.3 Validadores

**`validators.js`**
- 7 schemas Zod
- Validação de email, telefone, UUID
- Sanitização de strings
- Testes (26 testes, 100% passando)

**Schemas:**
```javascript
leadSchema → create/update leads
clientSchema → create clients
userSchema → create/update users
loginSchema → login validation
whatsappSchema → WhatsApp messages
campaignSchema → campaign creation
webhookPayloadSchema → incoming webhooks
```

**Uso:**
```javascript
const validated = leadSchema.parse(req.body);
// Throws se inválido, retorna tipado se válido
```

---

### 1.4 Domínios de negócio

**`commercial-intelligence.js`**
- Inteligência comercial via IA
- `buildCommercialIntelligencePayload()`
- `getCommercialIntelligenceDefaultSettings()`
- Integração Groq (opcional)

**Funções:**
```
GET /api/intelligence?clientId=X
POST /api/intelligence/settings
```

---

**`campaign-outbound.js`**
- Gerenciamento de campanhas de disparo
- `dispatchCampaignSequence()` — Executa campanha
- `getCampaignStepPlan()` — Planeja etapas
- `normalizeCampaignAnalyticsMeta()` — Sanitiza dados
- Suporta Evolution/n8n/custom webhooks

**Fluxo:**
```
POST /api/campaigns/direct-dispatch
  → valida clientId
  → resolve webhook URL (BD > JSON > env)
  → chama n8n/Evolution
  → registra logs
```

---

**`campaign-ai.js`**
- Sugestões de IA para campanhas
- `generateCampaignCopySuggestion()` — Texto da campanha
- `suggestCampaignSequence()` — Ordem de mensagens
- `suggestCampaignDelays()` — Timing entre mensagens
- `rewriteCampaignStep()` — Refaz uma mensagem
- `getGroqCampaignAiStatus()` — Status da IA

**Integração Groq:**
```javascript
if (process.env.GROQ_API_KEY) {
  // Usar Groq para geração
} else {
  // Fallback: templates fixos
}
```

---

**`whatsapp.js`**
- Session manager para WhatsApp
- `whatsappSessionManager` — Singleton
- Mantém sessão ativa
- Sanitização de números

**Responsabilidades:**
- Manter conexão
- Receber mensagens
- Enviar mensagens
- Tratar falhas

---

### 1.5 Abstração de banco de dados

**`pgSupabaseCompat.js`**
- Abstração SQL para compatibilidade
- `createDatabasePool()` — Pool Postgres com `pg`
- `createPgSupabaseClient()` — Cliente compatível com `supabase.from()`
- Permite trocar Supabase JS por Postgres direto

**Uso:**
```javascript
// Funciona igual independente do driver:
const data = await db.from("leads")
  .select("*")
  .eq("client_id", clientId);
```

**Drivers suportados:**
```
if (DB_DRIVER === "postgres" || DATABASE_URL):
  Use pg + createDatabasePool()
  
else if (DATA_SOURCE === "supabase"):
  Use @supabase/supabase-js direto
  
else:
  Auto-detect (prefer Postgres se DATABASE_URL)
```

---

### 1.6 Utilitários

**`leadQualificacaoBoolean.js`**
- Parse de field `qualificacao`
- Extrai sinais de temperatura
- Booleanos de status

---

## 2. FRONTEND (`frontend/src/`)

### 2.1 Rotas e Páginas

**CRM Pages (autenticado):**
```
/crm/dashboard          → Dashboard.tsx
/crm/leads              → Leads.tsx
/crm/agente             → Agente.tsx (notificações SDR)
/crm/whatsapp           → WhatsAppInbox.tsx  ← inbox WA (dados do WA session manager)
/crm/chatbot            → ChatbotKanban.tsx  ← kanban leads chatbot SPIN (dados do banco)
/crm/chatbot-config     → ChatbotConfig.tsx  ← configurações do chatbot
/crm/chatbot-docs       → ChatbotDocs.tsx    ← docs interativa do chatbot
/crm/lead-imports       → LeadImports.tsx
/crm/commercial-intelligence → CommercialIntelligence.tsx
/crm/user-access        → UserAccessManagement.tsx
/crm/tenants            → Tenants.tsx
/crm/vexo-sales         → VexoSales.tsx
```

**Endpoints de conversas:**
```
GET /api/whatsapp/chats          → dados do whatsappSessionManager (NÃO do banco)
                                   tipo WhatsAppChat: id, name, isGroup, unreadCount,
                                   leadOrigin*, sourceCampaignId* (*ainda null no banco)
GET /api/hardcoded-chat-leads    → tabela leads_{clientId}, retorna ChatbotLead
                                   ATENÇÃO: lead_origin NÃO está no SELECT ainda
                                   (pendente backend Conrado — PR #70)
```

**Portal Pages (público, controlado):**
```
/clientes/:clientId/dashboard    → ClientPortalDashboard.tsx
/clientes/:clientId/leads        → ClientPortalLeads.tsx
/clientes/:clientId/whatsapp     → ClientPortalWhatsApp.tsx
/clientes/:clientId/planilhas    → ClientPortalPlanilhas.tsx
```

**Auth Pages:**
```
/                       → LandingPage.tsx
/login                  → Login.tsx
/set-password           → SetPassword.tsx
/client-signup          → ClientSignup.tsx
/pending-approval       → PendingApproval.tsx
```

---

### 2.2 Componentes principais

**Layout:**
```
MainLayout.tsx          → CRM wrapper (sidebar + topbar)
AuthLayout.tsx          → Login/signup wrapper
ClientPortalLayout.tsx  → Portal wrapper
AppSidebar.tsx          → Sidebar nav
```

**Dashboard:**
```
DashboardPanel.tsx      → Contêiner principal
KpiGrid.tsx             → Grid de KPIs
KpiCard.tsx             → Card individual
RecentActivity.tsx      → Activity feed
TopSellers.tsx          → Top performance
```

**Charts:**
```
RevenueChart.tsx        → Gráfico de receita
ConversionDonut.tsx     → Rosca de conversão
PipelineChart.tsx       → Pipeline visual
```

**Data:**
```
FilterPanel.tsx         → Filtros de busca
[data tables]           → Tabelas paginadas
```

**Common:**
```
PageShell.tsx           → Wrapper de página
PageTitle.tsx           → Título + breadcrumb
LoadingScreen.tsx       → Loading state
ErrorBoundary.tsx       → Error handling
ErrorMessage.tsx        → Mensagem de erro
FormField.tsx           → Form input wrapper
```

**UI (Radix primitives):**
```
accordion.tsx           → Accordion
alert-dialog.tsx        → Alert dialog
[15+ outros]            → Dialog, Button, etc
```

---

### 2.3 State Management

**Contexts:**
```
AuthContext?            → User + permissions (infer from JWT)
ClientContext?          → Client selection
NotificationContext?    → Toast notifications
```

**TanStack Query:**
- `useQuery` para GET
- `useMutation` para POST/PATCH
- Caching automático
- Invalidation em mutações

**File:** `lib/api.ts`
```javascript
// useLeadsQuery({ clientId, filters })
// useUpdateLeadMutation()
// useDashboardQuery({ clientId })
```

---

### 2.4 Validação

**File:** `lib/validationSchemas.ts`
```javascript
loginSchema
setPasswordSchema
clientSignupSchema
createUserSchema
leadUpdateSchema
```

**Biblioteca:** Zod

---

### 2.5 Testes

**File:** `test/security.test.ts` (16 testes)
```
✅ Validação de força de senha
✅ Rate limiting no login
✅ Schemas Zod
✅ XSS prevention
✅ Input sanitization
```

**Framework:** Vitest

---

## 3. SUPABASE EDGE FUNCTIONS (`frontend/supabase/functions/`)

### 3.1 Funções ativas

**`conversation-memory`** (POST)
- Salva conversa compactada
- Recebe: telefone, conversation_compressed, tamanho_original
- Gera: carimbo de timestamp
- Usado por: n8n (final de conversa)

---

**`conversation-memory-latest`** (GET)
- Recupera última memória por telefone
- Query: `?telefone=11999999999`
- Retorna: conversa anterior ou null
- Usado por: n8n (no início de conversa)

---

**`lead-webhook`** (POST)
- Cria ou finaliza leads
- `action=create` → insere novo
- `action=finalize` → atualiza com dados completos
- Chave lógica: `client_id + telefone`
- Usado por: n8n (início e fim de fluxo)

---

**`n8n-error-webhook`** (POST)
- Registra erros de n8n
- Gera notificações automáticas
- Salva em `n8n_error_logs`
- Usado por: n8n (on error)

---

**`notifications-api`** (POST)
- Cria notificações operacionais
- Salva em `notifications` table
- Usado por: Edge Functions, backend

---

## 4. CONFIGURAÇÃO

### 4.1 Variáveis de ambiente

**Backend (`.env`):**
```env
# Server
NODE_ENV=production
PORT=3001
CORS_ORIGINS=https://vexocrm.vercel.app,...

# Database
DATABASE_URL=postgresql://user:pass@host:5432/db
DB_DRIVER=postgres

# Firebase
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=...

# Webhooks
N8N_DISPATCH_WEBHOOK_URL=...
N8N_DISPATCH_WEBHOOK_TOKEN=...

# Campaign scheduler
CAMPAIGN_SCHEDULER_ENABLED=true
CAMPAIGN_SCHEDULER_TOKEN=...

# IA (optional)
GROQ_API_KEY=...
GROQ_CAMPAIGN_AI_MODEL=...

# Security (P0 fixes)
FIXED_ADMIN_UIDS=uid1,uid2
FIXED_ADMIN_EMAILS=email1,email2
```

**Frontend (`.env.local`):**
```env
VITE_API_BASE_URL=http://localhost:3001
```

---

### 4.2 Build & Run

**Backend:**
```bash
cd backend
npm install
npm run dev        # local (watches)
npm run build      # typescript check
npm start          # production
npm test           # testes
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev        # local (Vite)
npm run build      # production
npm run preview    # serve build locally
npm test           # testes
```

---

## 5. FLUXOS CRÍTICOS

### 5.1 Autenticação (Login)

```
1. User clica Login
2. Frontend: Firebase login (email + password)
3. Firebase retorna: idToken
4. Frontend: Armazena token em localStorage
5. Backend: Valida token em cada requisição
6. Backend: Extrai UID + custom claims
7. Determina: role (internal/client/admin)
8. Autoriza ou rejeita
```

**Arquivo:** `server.js` linhas ~100-200

---

### 5.2 Lead capture (n8n → Backend → Banco)

```
1. WhatsApp entra no n8n
2. n8n normaliza número
3. n8n chama: conversation-memory-latest
4. n8n chama: lead-webhook (action=create)
5. Backend: insere em `leads` table
6. n8n: qualifica (conversa)
7. n8n chama: lead-webhook (action=finalize)
8. Backend: atualiza `leads` com dados
9. n8n: compacta conversa
10. n8n chama: conversation-memory
11. Backend: salva em `lead_conversations`
```

**Arquivos:** `campaign-outbound.js`, `server.js` rotas de webhook

---

### 5.3 Campaign dispatch (Frontend → Backend → n8n)

```
1. User seleciona campaign
2. Frontend: POST /api/campaigns/direct-dispatch
3. Backend: valida clientId (tenantScope)
4. Backend: resolve webhook URL
   a. BD lead_client_n8n_settings.dispatch_webhook_url
   b. Fallback: EVOLUTION_DISPATCH_WEBHOOKS_JSON
   c. Fallback: env var EVOLUTION_DISPATCH_WEBHOOK_URL_X
5. Backend: chama webhook com leads
6. n8n/Evolution: dispara mensagens
7. Backend: registra em logs
```

**Arquivo:** `campaign-outbound.js`, `server.js` rota `/campaigns/direct-dispatch`

---

### 5.4 Admin add user (RBAC)

```
1. Admin UI: POST /api/admin/users
2. Backend: requireFirebaseAuth
3. Backend: requireAdminAccess (ou canAssignManagedAccess)
4. Backend: Firebase SDK cria usuário
5. Backend: salva permissões em `access_profiles`
6. Backend: registra auditoria
7. Backend: envia email de boas-vindas
```

**Arquivo:** `server.js` rota `POST /api/admin/users`, `userAccessScope.js`

---

## 6. DEBUGGING RÁPIDO

### Problema: API retorna 403
**Checklist:**
1. Token é válido? (`GET /health` com `Authorization: Bearer TOKEN`)
2. User tem permissão? (`hasAccessPermission`, custom claims)
3. ClientId é válido? (`resolveAuthorizedClientId`)
4. Role é correto? (check `req.authAccess.role`)

**Arquivo:** `accessGuards.js`, `tenantScope.js`

---

### Problema: Leads não aparecem no CRM
**Checklist:**
1. Lead foi criado? (`SELECT * FROM leads WHERE client_id = X`)
2. ClientId está correto?
3. Filtro do CRM está ativo? (check query params)
4. Permissão de visualização? (`requireAppViewAccess("leads")`)

**Arquivo:** `server.js` rota `GET /api/leads`

---

### Problema: Campaign não dispara
**Checklist:**
1. Webhook URL configurado? (BD ou env)
2. Bearer token correto? (`N8N_DISPATCH_WEBHOOK_TOKEN`)
3. n8n está online? (check n8n logs)
4. Erros registrados? (check `n8n_error_logs` table)

**Arquivo:** `campaign-outbound.js`

---

## 7. CONVENÇÕES DE CÓDIGO

### Naming
- `camelCase` para variáveis/funções
- `UPPER_CASE` para constantes
- `PascalCase` para componentes React
- Prefixo: `handle*` para event handlers, `use*` para hooks

### Error handling
- Sempre retornar `{error: {code, message}}`
- Log sensível com `[SECURITY]`, `[ERROR]`, etc
- Nunca expor stack traces em produção

### Database
- Sempre escapar IDs: `WHERE id = $1` (prepared statements)
- Usar `client_id` para multi-tenant filtering
- Foreign keys onde possível

### Security
- Sempre validar entrada com Zod
- Sempre autenticar antes de autorizar
- Rate limit endpoints públicos
- Log de auditoria para operações sensíveis

---

**Referência rápida:** `Project_INDEX.md` para macro, este arquivo para micro.

**Última atualização:** 2026-05-09
