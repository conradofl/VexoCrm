---
name: Sessão 2026-05-14 — Campaign Routing Frontend
type: session
tags: [#frontend, #feature, #campaign, #vexocrm]
status: active
created: 2026-05-14
updated: 2026-05-14
---

# Sessão: Badge Visual de Origem de Lead

## O que foi feito

Implementação completa da feature de badge visual de origem de conversa (campanha vs inbound)
no frontend do VexoCRM. Trabalho em paralelo com Conrado (backend).

### Fase 1 — Mapeamento
- Frontend: `frontend/` — React 18 + Vite + TypeScript
- UI: shadcn/ui + Tailwind + cor `electric-indigo`
- Duas telas de conversas identificadas:
  - `/crm/chatbot` → `ChatbotKanban.tsx` (primária — leads do chatbot)
  - `/crm/whatsapp` → `WhatsAppInbox.tsx` (inbox WhatsApp)
- Endpoints mapeados:
  - `GET /api/hardcoded-chat-leads` — query na tabela `leads_{clientId}`, mas sem `lead_origin` no SELECT
  - `GET /api/whatsapp/chats` — dados do WA session manager (não do banco)
- Conclusão: ambos precisam de ajuste no backend para expor `lead_origin`

### Fase 2 — Implementação
Branch: `feature/campaign-routing-frontend` (a partir de main)

**Arquivos modificados:**
1. `frontend/src/hooks/useWhatsAppInbox.ts` — adicionou campos `leadOrigin` e `sourceCampaignId` ao tipo `WhatsAppChat`
2. `frontend/src/pages/ChatbotKanban.tsx`:
   - Interface `ChatbotLead` atualizada com `leadOrigin`, `sourceCampaignId`
   - Componente `OriginBadge` criado
   - `useCampanhas` integrado para lookup de nome de campanha por UUID
   - Props `campaignNames` propagadas para `LeadCard` e `KanbanColumn`
3. `frontend/src/pages/WhatsAppInbox.tsx`:
   - Componente `OriginBadge` criado (usa `electric-indigo` para campanha)
   - Badge na lista lateral de chats
   - Badge no header da conversa selecionada
   - `useCrmClient` + `useCampanhas` para lookup de nomes

**TypeScript:** `tsc --noEmit` sem erros

### PR
- Número: #70
- URL: https://github.com/LuizApenas/VexoCrm/pull/70
- Base: main
- Status: aguardando merge + backend do Conrado

## Pendências

1. **Conrado (backend):** Adicionar ao SELECT do endpoint `GET /api/hardcoded-chat-leads` (`registerAllDomainRoutes.js:5082`):
   - `lead_origin, source_campaign_id` na query
   - `leadOrigin` e `sourceCampaignId` no objeto de resposta

2. **WhatsApp Inbox (fase futura):** O `GET /api/whatsapp/chats` retorna dados do WA session manager (sem campos do banco). Para badges aparecerem ali, o backend precisaria cruzar os chats por telefone com a tabela de leads — trabalho maior, deixado para próxima sprint.

3. **Teste manual (Fase 3):** Não executado — requer acesso ao banco. Rodar UPDATE SQL nos 3 estados e tirar prints para validar visualmente.

## Decisão técnica

**Campaign name lookup via frontend (useCampanhas)** — escolhido em vez de join no backend para:
- Evitar tocar em mais código do Conrado
- Aproveitar cache do React Query (30s staleTime)
- Fallback gracioso: se campanha não carregar, mostra "Campanha" sem nome

## Links
- [[vexocrm-codebase-map]] — atualizado com novas telas e endpoints
- [[campaign_reply_flow_fix]] — fix anterior relacionado a campanhas
