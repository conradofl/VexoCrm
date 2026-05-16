---
name: Estado atual
description: Estado persistente atualizado por /end-session
type: memory
tags: [#current-state, #critical]
status: active
created: 2026-05-09
updated: 2026-05-12
---

# Estado Atual — VexoCRM

**Última atualização:** 2026-05-12 (fim de sessão)
**Sessão:** #4 (Chatbot toggle por tenant + kill-switch loop)

---

## 🎯 Prioridades para próxima sessão

🔴 **URGENTE:**
- [ ] Rodar migration no Postgres de produção (EasyPanel terminal ou psql):
  ```sql
  ALTER TABLE lead_client_n8n_settings
    ADD COLUMN IF NOT EXISTS chatbot_enabled BOOLEAN NOT NULL DEFAULT false;
  ```
- [ ] Investigar causa raiz do loop no chatbot (fromMe filter não resolveu)
- [ ] Após corrigir loop: remover kill-switch do código e redeploy

🟡 **MÉDIO PRAZO:**
- [ ] Bug de persistência `_currentStepId`: UPDATE retorna `rows: 0` silenciosamente
- [ ] Kanban do chatbot: refresh automático e filtragem por step SPIN
- [ ] Implementar validação multi-tenant centralizada

🟢 **BAIXA PRIORIDADE:**
- [ ] Notificar consultor quando conversa do chatbot finaliza
- [ ] Melhorar logs de error em campaign-ai.js

---

## 🚧 Estado atual do Chatbot

| Item | Status |
| --- | --- |
| Kill-switch global | ✅ Ativo (loop detectado) |
| fromMe filter | ✅ Commitado |
| Toggle por tenant (frontend) | ✅ Implementado |
| Migration chatbot_enabled | ❌ PENDENTE em prod |
| Loop investigado | ❌ Causa raiz desconhecida |

**Kill-switch location:** `backend/src/server.js` — início do handler `POST /api/hardcoded-chat-webhook`
Para reativar: remover as 3 linhas do kill-switch + redeploy

---

## 🚧 Em andamento

| Task | Status | Bloqueador |
| --- | --- | --- |
| **Chatbot SPIN + Evolution** | ⛔ Desativado | Loop não resolvido |
| **Página Chatbot Config** | ✅ Deploy feito | Migration pendente |
| **Kanban chatbot** | ✅ Deployed | Testar com dados reais |
| Validação multi-tenant | Backlog | Nenhum |

---

## 💡 Decisões desta sessão

1. **Chatbot off por default para todos os tenants** (2026-05-12)
   - `chatbot_enabled BOOLEAN DEFAULT false` em `lead_client_n8n_settings`
   - Novos tenants nascem sem chatbot ativo

2. **Kill-switch global no código** (2026-05-12)
   - Loop detectado em produção, chatbot desativado globalmente
   - Não é a solução permanente — investigar causa raiz antes de reativar

---

## 📊 Status por componente

| Componente | % | Saúde | Última mudança |
| --- | --- | --- | --- |
| **Backend** | 77% | 🟡 Chatbot com problema | Hoje (kill-switch + toggle) |
| **Frontend** | 82% | 🟢 Estável | Hoje (ChatbotConfig toggle) |
| **Infra** | 62% | 🟡 Avançando | — |
| **Docs** | 72% | 🟢 Atualizado | Hoje |

---

## 🔄 Contexto arquitetural

### Backend (Node.js/Express)
- Porta: 3001 (EasyPanel, deploy automático via GitHub)
- Banco: Postgres direto via DATABASE_URL (não Supabase JS)
- Deploy: automático ao push no main

### Frontend (React/Vite)
- Deploy: Vercel (automático ao push no main)

### Database
- Postgres puro na VPS — migrations manuais via psql ou EasyPanel terminal
- NÃO é Supabase JS — rodar SQL direto no banco

---

## 📅 Próxima sessão

**O que fazer primeiro:**
1. Rodar migration `chatbot_enabled` no banco de produção
2. Investigar loop do chatbot nos logs do EasyPanel
3. Corrigir loop → remover kill-switch → testar end-to-end

**Timezone:** America/Sao_Paulo
