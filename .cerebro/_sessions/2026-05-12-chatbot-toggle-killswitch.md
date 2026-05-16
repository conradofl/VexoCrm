---
name: Sessão 2026-05-12 — Chatbot toggle por tenant + kill-switch
type: session
tags: [#chatbot, #backend, #frontend, #bug]
status: closed
created: 2026-05-12
---

# Sessão 2026-05-12

## O que foi feito

### 1. Fix fromMe filter (commit 5389b1e)
- Adicionado filtro no início do webhook para ignorar eventos `SEND_MESSAGE` do Evolution (fromMe: true)
- Esses eventos causavam re-trigger do webhook quando o bot enviava resposta
- Logging melhorado: clientId e queryClientId agora aparecem no log

### 2. Toggle de chatbot por tenant (commit 4032070)
- Nova coluna `chatbot_enabled BOOLEAN DEFAULT false` em `lead_client_n8n_settings`
- Migration: `backend/supabase/migrations/20260512100000_add_chatbot_enabled_to_n8n_settings.sql`
- Backend: `buildN8nSettingsPayload` aceita `chatbotEnabled`, queries incluem a coluna
- Backend: webhook verifica `chatbot_enabled` antes de processar mensagens
- Frontend: Switch toggle na página `/crm/chatbot-config` por empresa
- Cards ficam opacos quando desativado, botão de teste também desabilita

### 3. Kill-switch global (commit db2cbdc)
- Loop detectado em produção → chatbot causando mensagens em loop no WhatsApp
- Adicionado early return no início do webhook handler
- Desativa para TODOS os tenants independente do banco

### 4. Default false para todos (commit f83f558)
- `chatbot_enabled DEFAULT false` (era true)
- `maskN8nSettings`: retorna `false` quando coluna não existe
- `buildN8nSettingsPayload`: `chatbotEnabled === true` (não mais `!== false`)
- Frontend: fallback `?? false` (era `?? true`)

## Bloqueadores ao fechar sessão

- **Migration não rodou**: banco de produção é Postgres puro (não Supabase) — precisa rodar ALTER TABLE manualmente via psql ou EasyPanel
- **Erro no toggle**: `N8N_SETTINGS_SAVE_FAILED` porque coluna não existe ainda
- **Loop não investigado**: kill-switch resolve o sintoma, causa raiz desconhecida

## Commits desta sessão
- `5389b1e` fix: filter fromMe messages in chatbot webhook to prevent infinite loop
- `4032070` feat: add per-tenant chatbot enable/disable toggle
- `db2cbdc` fix: disable chatbot webhook globally (loop detected)
- `f83f558` fix: chatbot_enabled defaults to false (off by default for all tenants)
