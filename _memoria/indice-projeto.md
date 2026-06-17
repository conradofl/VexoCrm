# Índice do Projeto — VexoCrm

> Índice operacional para localizar rapidamente o que existe no repo.
> Atualizado em 2026-06-13, branch `main`, HEAD `93653a7`.

## Raiz

- `README.md`: visão técnica geral, parcialmente histórica; confirmar contra `_memoria/contexto-vivo.md`.
- `PROJECT_INDEX.md`: índice antigo de 2026-05-06; útil como histórico, não como fonte atual.
- `ORQUESTRACAO.md`: protocolo do cérebro/orquestrador; contém conceitos importantes, mas partes do roadmap/caminho canônico ficaram antigas.
- `CONTRACT.md`: contrato ativo da frente de Disparos.
- `CONTRACT-dashboard.md`: contrato separado da frente Dashboard.
- `_memoria/`: memória operacional atual.
- `.cerebro/`: vault histórico/segundo cérebro.
- `docs/`: documentação técnica, auditorias, contratos, PDFs e roadmap.
- `_exports/`: exports/relatórios de dados históricos.
- `scripts/`: scripts auxiliares de sync/import/limpeza.

## Backend

Local: `backend/`.

Stack:

- Node.js/Express ESM.
- PostgreSQL via `pg` e camada compatível "Supabase".
- Firebase Admin para auth.
- BullMQ/Redis para follow-up/fila.
- Groq para IA.
- Docker/EasyPanel.

Arquivos principais:

- `backend/src/server.js`: API principal e rotas concentradas.
- `backend/src/domains/registerAllDomainRoutes.js`: rotas de domínio agregadas.
- `backend/src/campaign-outbound.js`: motor de sequência/disparo Evolution.
- `backend/src/campaign-ai.js`: geração IA de campanhas.
- `backend/src/chatbot-ai-engine.js`: motor IA do chatbot.
- `backend/src/hardcoded-chatbot*.js`: chatbot hardcoded/extrator/persistência.
- `backend/src/followup/`: follow-up, worker, analytics e automação.
- `backend/src/onboarding/`: onboarding.
- `backend/src/pgSupabaseCompat.js`: compatibilidade Postgres/Supabase.
- `backend/src/accessGuards.js`: guards de acesso.
- `backend/src/tenantScope.js`: escopo multi-tenant.
- `backend/src/userAccessScope.js`: permissões/claims.
- `backend/src/notificationScope.js`: escopo de notificações.
- `backend/src/securityConfig.js`: segurança, rate limits e headers.
- `backend/src/validators.js`: validações.
- `backend/src/whatsapp.js`: legado WhatsApp/whatsapp-web.js.

Migrations:

- Canônico para deploy: `backend/supabase/migrations/`.
- Migration mais recente: `20260612060000_dispatch_runs_lead_claim.sql`.
- `frontend/supabase/migrations/` existe, mas não é o diretório canônico no deploy atual.

Testes/backend:

- `backend/src/test/*.test.js`.
- `backend/src/onboarding/onboarding.test.js`.
- Comandos: `npm --prefix backend run check` e `npm --prefix backend run test`.

## Frontend

Local: `frontend/`.

Stack:

- React 18, TypeScript, Vite.
- TanStack Query.
- Radix UI/shadcn-style components.
- Tailwind.
- Firebase client.
- Recharts.

Entrada e layout:

- `frontend/src/App.tsx`: roteamento.
- `frontend/src/main.tsx`: bootstrap React.
- `frontend/src/components/MainLayout.tsx`: layout interno.
- `frontend/src/components/AppSidebar.tsx`: sidebar modular Vendas x Disparos.
- `frontend/src/components/PageShell.tsx`: shell de páginas.
- `frontend/src/components/ErrorBoundary.tsx`: boundary React.
- `frontend/src/components/ui/`: primitivos UI.

Páginas principais:

- `Dashboard.tsx`: dashboard.
- `Leads.tsx`: leads.
- `LeadImports.tsx`: planilhas/campanhas.
- `WhatsAppInbox.tsx`: inbox WhatsApp.
- `Agente.tsx`: agentes/notificações.
- `Tenants.tsx`: empresas/tenants.
- `Conexoes.tsx`: chips WhatsApp por tenant.
- `EvolutionAdmin.tsx`: inventário admin Evolution; busca remota manual/cacheada.
- `Relatorios.tsx`: envios por chip/dia.
- `Disparos.tsx`: placeholder.
- `Aquecimento.tsx`: placeholder.
- `CommercialIntelligence.tsx`: inteligência comercial.
- `UserAccessManagement.tsx`: usuários/acessos.
- `ChatbotKanban.tsx`, `ChatbotSettings.tsx`, `ChatbotDocs.tsx`, `ChatbotTemplates.tsx`, `ChatbotConfig.tsx`: chatbot.
- `FollowupQueue.tsx`, `FollowupCompanies.tsx`, `FollowupCampaigns.tsx`, `FollowupTemplates.tsx`, `FollowupAnalytics.tsx`, `FollowupSuggestions.tsx`: follow-up.
- `OnboardingWizard.tsx`, `OnboardingAgent.tsx`: onboarding.
- `ClientPortal*.tsx`: portal cliente.
- `LandingPage.tsx`, `Login.tsx`, `ClientSignup.tsx`, `SetPassword.tsx`, `PendingApproval.tsx`, `NotFound.tsx`: públicas/auth.

Hooks importantes:

- `useLeadClients.ts`: tenants, settings n8n e instâncias Evolution.
- `useCampanhas.ts`: campanhas.
- `useReports.ts`: relatório Evolution.
- `useLeadImports.ts`: importações/campanhas por planilha.
- `useWhatsAppInbox.ts`, `useWhatsAppSession.ts`: WhatsApp.
- `useFollowup*.ts`: follow-up.
- `useAuth` em `contexts/AuthContext.tsx`: sessão/claims.
- `useAccessProfiles.ts`, `useAdminUsers.ts`: acesso e usuários.

Testes/frontend:

- `frontend/src/test/*.test.ts`.
- Comando: `npm --prefix frontend test -- --run`.
- Type-check correto para app: `cd frontend && npx tsc --noEmit -p tsconfig.app.json`.

## Edge Functions / n8n

Fontes em `frontend/supabase/functions/` e espelho backend em `backend/supabase/functions/` para algumas funções.

Funções relevantes:

- `conversation-memory`
- `conversation-memory-latest`
- `lead-webhook`
- `n8n-planilha-webhook`
- `mark-lead-dispatched`
- `n8n-error-webhook`
- `notifications-api`
- `get-leads-disparo`

Docs:

- `docs/workflow-n8n.md`
- `docs/supabase-functions.md`
- `docs/edge-functions-port-map.md`
- `docs/arquitetura-operacional.md`

## Disparos / Evolution

Banco/tabelas-chave:

- `lead_client_evolution_instances`: instâncias/chips por tenant.
- `evolution_instance_daily_usage`: uso diário por instância.
- `campaigns`: campanhas.
- `campaign_dispatches`: disparos.
- `campaign_dispatch_runs`: runs por telefone/lead; agora também claim idempotente.
- `lead_imports` e `lead_import_items`: imports/base para campanhas.

Frontend:

- `Conexoes.tsx`: seleciona tenant e mostra `EvolutionChipsPanel`.
- `EvolutionAdmin.tsx`: lista inventário local de instâncias/settings/follow-up; só chama `/instance/fetchInstances` com ação manual "Buscar Evolution".
- `EvolutionChipsPanel.tsx`: provisionamento, manual add, QR modal, default/active, cota e estado cold/warm.
- `Relatorios.tsx`: gráfico Recharts por chip/dia.
- `LeadImports.tsx`: fluxo de planilha/campanha.

Backend:

- `server.js` linhas de Evolution/instâncias: funções `ensureLeadClientEvolutionInstancesTable`, `getLeadClientEvolutionInstances*`, `upsertLeadClientEvolutionInstance`, `provisionLeadClientEvolutionInstance`, `deleteLeadClientEvolutionInstance`.
- `registerAllDomainRoutes.js` admin Evolution: `GET /api/admin/evolution-config` local por padrão; `?remote=true` usa cache/dedupe para buscar `/instance/fetchInstances`.
- `server.js` campanha: `buildDispatchLeads`, `executeCampaignDispatch`, `claimCampaignForDispatch`.
- `campaign-outbound.js`: envio por sequência.

## Follow-up

Backend:

- `backend/src/followup/routes.js`
- `backend/src/followup/service.js`
- `backend/src/followup/worker.js`
- `backend/src/followup/queue.js`
- `backend/src/followup/automationEngine.js`
- `backend/src/followup/analyticsService.js`

Frontend:

- `FollowupQueue.tsx`
- `FollowupCompanies.tsx`
- `FollowupCampaigns.tsx`
- `FollowupTemplates.tsx`
- `FollowupAnalytics.tsx`
- `FollowupSuggestions.tsx`

Migrations:

- `20260526000001_create_followup_module.sql`
- `20260527000001_create_followup_suggestions.sql`
- `20260528000001_add_archived_at_to_followup_companies.sql`

## Docs úteis

- `docs/API_CONTRACTS.md`
- `docs/ARCHITECTURE_AUDIT.md`
- `docs/ROUTES_TENANT_RISK_MAP.md`
- `docs/SCHEMA_MAP.md`
- `docs/STABILIZATION_PLAN.md`
- `docs/TESTING_AND_CI.md`
- `docs/NEXT_ROADMAP.md`
- `docs/SDD.md`
- `docs/backend-postgres-smoke.md`

## Comandos principais

Root:

```bash
npm run check
```

Backend:

```bash
npm --prefix backend run check
npm --prefix backend run test
```

Frontend:

```bash
npm --prefix frontend test -- --run
npm --prefix frontend run build
cd frontend && npx tsc --noEmit -p tsconfig.app.json
```

Git antes de sessão:

```bash
git status --short --branch
git pull --ff-only origin main
git log --oneline --decorate -20
```
