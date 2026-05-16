# VexoCRM — Frontend Blocos 3-6 (2026-05-14/15)

## Status

Branch: `feature/campaign-routing-frontend`
Commits: `81088e5` (blocos 3-6) + `fbdf967` (fix Select Radix UI)
Push: ✅ feito
PR: aguarda abertura manual — `https://github.com/LuizApenas/VexoCrm/compare/main...feature/campaign-routing-frontend`
(gh CLI sem acesso à API GitHub por bloqueio de rede na máquina de dev)

---

## Bloco 3 — Editor de Prompts

**Rota:** `/crm/prompt-editor` | **Permissão:** `empresas` | **Sidebar:** "Editor de Prompts" (ícone `FileEdit`)

**Arquivos:**
- `frontend/src/pages/PromptEditor.tsx`
- `frontend/src/hooks/usePrompts.ts`

**O que faz:** Seletor de empresa + tipo (Padrão/Campanha), editor textarea + preview em abas, badge "alterações não salvas", meta de última edição e quem editou.

**Endpoints pendentes (Conrado):**
```
GET  /api/prompts?clientId=&type=   → { item: { clientId, type, content, updatedAt, updatedByEmail } }
PUT  /api/prompts                   body: { clientId, type, content } → { item: Prompt }
```

---

## Bloco 4 — Fila de Followup

**Rota:** `/crm/followup` | **Permissão:** `planilhas` | **Sidebar:** "Fila de Followup" (ícone `ListChecks`)

**Arquivos:**
- `frontend/src/pages/FollowupQueue.tsx`
- `frontend/src/hooks/useFollowupQueue.ts`

**O que faz:** Filtros por empresa/campanha/status/data, lista de leads com badge de status, ações: reagendar (dialog datetime-local), converter para inbound, descartar (confirm dialog).

**Fix aplicado:** SelectItem com `value=""` crasha o Radix UI. Usar `"_all"` como sentinel.

**Endpoints pendentes (Conrado):**
```
GET   /api/followup-queue?clientId=&campaignId=&status=&dateFrom=&dateTo=
      → { items: FollowupItem[], total: number }

PATCH /api/followup-queue/:id
      body: { scheduledAt? } | { status: "discarded" }
      → { item: FollowupItem }

POST  /api/followup-queue/:id/convert-inbound → 200 OK
```

**Interface FollowupItem:**
```ts
{ id, campaignId, campaignName, leadId, leadName, phone, clientId,
  status: "pending"|"replied"|"scheduled"|"discarded"|"converted",
  scheduledAt, lastContactAt, createdAt }
```

---

## Bloco 5 — Mídia no Chat

**Integração:** `WhatsAppInbox.tsx` — mensagens passam por `MessageBubble` → `MediaMessage`

**Arquivos:**
- `frontend/src/components/MediaMessage.tsx`
- `frontend/src/hooks/useMediaMessage.ts`

**O que faz:**
- `hasMedia: false` → texto normal (sem regressão)
- `hasMedia: true, type=audio` → player HTML5 + botão "Ver transcrição" expansível
- `hasMedia: true, type=image` → `<img>` lazy + descrição automática abaixo
- `hasMedia: true, type=video` → `<video>` com controles
- `hasMedia: true, type=document` → link de download
- 404 → placeholder amigável "endpoint não disponível"

**Endpoint pendente (Conrado):**
```
GET /api/media/:messageId
    → { item: { messageId, mediaType, mimeType, dataUrl|url, transcription, description, fileName } }
```

---

## Bloco 6 — Chatbot Docs: aba Campanhas

**Arquivo:** `frontend/src/pages/ChatbotDocs.tsx` (nova aba adicionada aos tabs existentes)

**3 seções:**

1. **Roteamento Campanha vs Inbound** — diagrama de fluxo, tabela de campos `lead_origin`/`source_campaign_id`, explicação do badge visual
2. **Sequência de Mensagens** — seletor empresa + campanha → carrega `analytics_meta.sequence` da API já existente `/api/campaigns` — **funciona sem backend novo**
3. **Métricas por Agente** — ranking por taxa de conversão (leads, convertidos, %, tempo médio)

**Endpoint pendente (Conrado):**
```
GET /api/campaigns/metrics/by-agent?clientId=
    → { items: [{ agentId, agentName, totalLeads, converted, conversionRate, avgResponseMinutes }] }
```

---

## Checklist para ativar cada bloco

| Bloco | O que o Conrado precisa criar | Frontend pronto? |
|---|---|---|
| 3 — Editor Prompts | `GET/PUT /api/prompts` | ✅ |
| 4 — Followup | `GET/PATCH /api/followup-queue`, `POST .../convert-inbound` | ✅ |
| 5 — Mídia Chat | `GET /api/media/:messageId` | ✅ |
| 6 — Métricas | `GET /api/campaigns/metrics/by-agent` | ✅ |

---

## Sidebar — links adicionados hoje

```ts
{ title: "Editor de Prompts", url: "/crm/prompt-editor", icon: FileEdit, page: "empresas" }
{ title: "Fila de Followup",  url: "/crm/followup",       icon: ListChecks, page: "planilhas" }
```

---

## Nota técnica — Radix UI Select

**Nunca usar `value=""` em `SelectItem`** — o Radix UI não aceita string vazia e crasha o componente silenciosamente (página em branco). Usar sempre um sentinel como `"_all"` e converter na lógica de filtros.
