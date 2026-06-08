# Auditoria — Trabalho do Luiz na `origin/main`

> Realizada em 2026-06-08 (somente leitura). Repo B, após `git fetch --all`.
> Commits inspecionados: `70da6c8`, `d17462d`, `9d353b9`, `d4bc3b3` e adjacentes.

## A) Estado do repositório após fetch

- `origin/main` HEAD: `d4bc3b3` (Luiz, Merge PR #120 — "evolution-multi-instance-dispatch", 07/jun/2026)
- Commits recentes relevantes:

| Hash | Data | Mensagem | Linhas |
|---|---|---|---|
| d4bc3b3 | 07/jun | Merge PR #120 evolution-multi-instance-dispatch | — |
| 70da6c8 | 07/jun | Add Evolution multi-instance dispatch support | +1532 |
| d17462d | 06/jun | Integrate onboarding with dynamic lead tables | +283 |
| a78822f | 06/jun | Add Help Desk AI functionality | — |
| 6a834b2 | 05/jun | Revert naming migration (Supabase→Postgres revertido) | — |
| ad81ba4 | 05/jun | Avoid automatic migrations on startup | — |

## B) Item por item com evidência (arquivo:linha)

### 1. Pause/resume em campanhas e disparos — ✅ FEITO
- `backend/src/campaign-outbound.js:479` — `summary.paused = true/false`
- `campaign-outbound.js:590` — `if (summary.paused) break;`
- `registerAllDomainRoutes.js:4580` — `ensureCampaignDispatchPausedStatusAllowed()`
- `registerAllDomainRoutes.js:4760` — `status: "paused"`, mensagem "Disparo pausado manualmente."
- Cobertura: `campaignReplyFlow.test.js` (parcial). Sem teste dedicado de pause.

### 2. Multi-instância Evolution por tenant — ✅ FEITO, ❌ não testado
- Tabela `public.lead_client_evolution_instances` via DDL inline `server.js:1565`
- Chave de tenant: `client_id`
- Índices: `idx_lead_client_evolution_default (client_id, active)`, `idx_lead_client_evolution_client (client_id)`
- Endpoints:
  - `GET  /api/lead-clients/:tenantId/evolution-instances` — lista instâncias
  - `POST /api/lead-clients/:tenantId/evolution-instances` — cria instância
  - `POST /api/lead-clients/:tenantId/evolution-instances/:id/provision` — provisiona/QR
  - `DELETE /api/lead-clients/:tenantId/evolution-instances/:id` — remove
- Todos os endpoints validam `tenantId` antes de agir. Tenant-isolated.
- Coluna `evolution_instance_id UUID` em `campaign_dispatches` (`registerAllDomainRoutes.js:4599`).
- Validação "for this tenant" na seleção da instância (:4609–4613).

### 3. QR via Evolution REST — ⚠️ FEITO, ❌ não testado, CAMINHO DUPLO
- Novo: `server.js:1969–2005` — `qrcode.base64/code`, `instance/connect` na Evolution REST.
- **Legado ainda ativo:** `backend/src/whatsapp.js:4,90` — `whatsapp-web.js`, `client.on("qr")`, lib `qrcode`.
- Os dois coexistem. Risco em produção: qual caminho é chamado primeiro? Não confirmado.

### 4. Cota por número / anti-ban / lotes — ❌ NÃO ENCONTRADO
- Apenas `round_robin` de distribuição de leads em `commercial-intelligence` (não é anti-ban).
- Não há: limite de mensagens por número/dia, delay aleatório entre envios, lote com pausa entre grupos.
- É o maior buraco de produto — E3 do roadmap.

### 5. Tabelas dinâmicas no onboarding — ✅ FEITO
- Novo arquivo: `backend/src/lead-client-tables.js` (+140 linhas, commit d17462d)
- `onboarding/routes.js` atualizado.
- `frontend/src/pages/Tenants.tsx` inclui UI de onboarding.

### 6. UI de empresas/instâncias — ✅ FEITO
- `frontend/src/pages/Tenants.tsx`: +457 linhas em `70da6c8`, +85 em `d17462d`.
- Inclui CRUD de instâncias Evolution, onboarding dinâmico de tabelas.
- Hook `frontend/src/hooks/useLeadClients.ts` (novo, 156 linhas).

### Extra: Nav Vendas × Disparos — ❌ NÃO ENCONTRADO na main
- Nenhuma separação de navegação em `App.tsx` ou `AppSidebar.tsx` na main.
- T3 havia feito isso numa branch (Repo B), mas não está mergeado.

### Extra: Bug scroll import (10/509) — ⚠️ INCONCLUSIVO
- `frontend/src/pages/LeadImports.tsx` foi reescrito pelo Luiz (+160 linhas em `70da6c8`).
- Não foi possível confirmar se o bug `slice(0,10)` foi corrigido — precisa verificar o diff.

## C) Cruzamento com nosso roadmap

| Item | Luiz JÁ FEZ | Testado? | Ainda Falta |
|---|---|---|---|
| Entidade Conexão multi-tenant | `lead_client_evolution_instances` | ❌ | Validação ponta-a-ponta (E1) |
| Disparo multi-instância | `evolution_instance_id` em `campaign_dispatches` | ❌ | Validação + webhook fan-in (E1/E4) |
| QR via REST | `server.js:1969–2005` | ❌ | Resolver caminho duplo + limpar legado (E2) |
| Pause/resume campanha | ✅ | parcial | — |
| Onboarding dinâmico | `lead-client-tables.js` | ❌ | — |
| UI empresas | `Tenants.tsx` | ❌ | — |
| Anti-ban (cota+lotes+delay) | — | — | **E3 — MAIOR BURACO** |
| Webhook fan-in todas as instâncias | Não confirmado | — | E4 |
| Nav Vendas × Disparos | — | — | E5 |
| Bug scroll import | Reescrito (inconclusivo) | — | Verificar em E6 |

## D) Riscos e conflitos

### 🔴 Colisão direta (nossa migration vs tabela do Luiz)
- Nossa migration `connections` (`tenant_id` FK) e a tabela do Luiz `lead_client_evolution_instances` (`client_id`) implementam a mesma entidade de conexão com nomes e chaves diferentes.
- **Resolução: nossa migration DESCARTADA.** Entidade oficial = `lead_client_evolution_instances`.

### 🔴 Arquivos de alto risco de colisão (Luiz modificou recentemente):
- `backend/src/server.js` (+483)
- `backend/src/domains/registerAllDomainRoutes.js` (+315/+120)
- `frontend/src/pages/Tenants.tsx` (+457/+85)
- `frontend/src/pages/LeadImports.tsx` (+160) ← T4 também editou este arquivo

### ⚠️ "Feito mas não testado" — risco de regressão em produção
- Multi-instância em disparo, QR, onboarding: zero testes automatizados.
- Qualquer mudança nesses módulos precisa de validação manual antes de ir para produção.

### 🟢 Segurança
- PAT removido da URL do origin (Repo B). Token confirmado como revogado pelo Conrado.
- Isolamento de tenant nos novos endpoints: confirmado por inspeção do código.
- Vulnerabilidade estrutural permanece: `pg.Pool` bypassa RLS. Segurança 100% dependente de filtro por `client_id` no código.
