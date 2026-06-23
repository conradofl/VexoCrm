# Plano de Unificação — Segmentação única (3 mecanismos → 1)

## STATUS (2026-06-21) — núcleo implementado e verificado

| Passo | Estado | Evidência |
|---|---|---|
| 0+1 Catálogo + matcher genérico + adapter | ✅ feito | `backend/src/segmentation.js`, `textNormalize.js`; 12 testes verdes (`test/segmentation.test.mjs`) |
| 2 Disparo usa catálogo + matcher | ✅ feito | `server.js buildDispatchLeads` roteia por `isFilterShape`; `node --check` ok |
| 3 Endpoint dry-run preview | ✅ feito | `POST /api/lead-clients/:tenantId/segmentation/preview` em `registerAllDomainRoutes.js` |
| 4 Write path + IA | ✅ feito | `campaign-outbound.js normalizeCampaignAnalyticsMeta` + `campaign-ai.js sanitizeSegmentContext`; smoke test import chain ok |
| 5 Catálogo v2 (sanitize) | ✅ feito | `server.js sanitizeSegmentationConfig` → v2 (`fields[]`+`featuredKpis`) + espelho `kpis[]` legado |
| 6 Frontend converge | ✅ núcleo | `LeadImports.tsx` envia `filters[]` (reusa `filterRules`), código morto removido; `useCampanhas.ts` tipo unificado; `tsc --noEmit` 0 erros |
| 7 Legado | ✅ por design | nenhum código produz mais shape legado (grep limpo); `leadMatchesCampaignSegmentation` **fica** como adapter de campanha histórica |

**Polish de UI restante (opcional, melhor verificar com app rodando):**
- `Tenants.tsx`: editar `fields[]` separado de `featuredKpis` (hoje edita via `kpis[]`, funciona pelo espelho).
- Wirar o endpoint dry-run de preview no fluxo de disparo de import existente (sem planilha carregada).
- Auto-registro de coluna nova → `fields[]` no upload.

**Não verificado em runtime real** (precisa DB/Evolution): disparo ponta-a-ponta com tenant real. Critérios da §4 abaixo a rodar antes de deploy.

---


> **Pré-requisito do plano Liv Pub** (`docs/PLANO-LIVPUB.md`). Fazer antes de qualquer esteira.
> Decisão: **Opção 3** (catálogo de campos por empresa + auto-registro no import) +
> **Matcher A** (preview via dry-run no backend, lógica única).
> Caminho de disparo multi-tenant ATIVO (Umuarama, Infinie, Liv). Não quebrar
> disparo existente (CONTRACT.md §7). Incremental, testável, compat retroativo.

---

## 1. Os 3 mecanismos de hoje (a fundir)

| # | Mecanismo | Onde | Forma | Papel atual |
|---|---|---|---|---|
| 1 | Filtro de planilha (pré-import) | `LeadImports.tsx:631` `filterRules` + matcher `:407` | dinâmico `{column, operator: equals/contains/gt/lt, value}` | **client-side**, filtra linhas antes do import. Não vai pro backend. |
| 2 | Segmentação de campanha (disparo) | `meta.segmentation` → `leadMatchesCampaignSegmentation` `server.js:3497`, call site `:5232` | **hardcoded** `{gender, productType, ticket, ticketThreshold, interest, campaignTag}` | filtra leads no disparo. |
| 3 | Segmentação por empresa | `lead_client_n8n_settings.segmentation_config` `server.js:1565`, cap 6 em `:1596` | dinâmico `kpis[]: {id,label,field,type,enabled}` | **só dashboard** (capado em 6). |

Três universos de campo + duas implementações de matcher (`:407` front, `:3497` back). Fundir tudo.

---

## 2. Modelo unificado (o destino)

### 2.1 Catálogo de campos = fonte da verdade (por empresa)

`segmentation_config` deixa de ser "6 KPIs de dashboard" e passa a ser **catálogo de campos** do tenant:

```jsonc
// lead_client_n8n_settings.segmentation_config (novo shape)
{
  "version": 2,
  "fields": [                                   // catálogo FILTRÁVEL — SEM cap
    { "field": "perfil_musical", "label": "Perfil musical", "type": "category" },
    { "field": "faixa_consumo",  "label": "Conta de luz",   "type": "money" },
    { "field": "cidade",         "label": "Cidade",         "type": "category" }
  ],
  "featuredKpis": ["faixa_consumo", "cidade"]    // subconjunto p/ dashboard — mantém cap 6
}
```

- `fields[]` = tudo que dá pra filtrar (ilimitado). Separa "filtrável" de "KPI em destaque".
- `featuredKpis` = só o que aparece como cartão no dashboard (preserva o cap 6 atual).
- **Compat de leitura:** shape antigo (`{version:1, kpis:[...]}`) → migrar em memória para `fields = kpis`, `featuredKpis = kpis enabled (≤6)`. Nenhuma migration destrutiva.

### 2.2 Shape único de filtro (usado em TODO lugar)

```jsonc
{
  "filters": [
    { "field": "perfil_musical", "operator": "equals",   "value": "pagode" },
    { "field": "faixa_consumo",  "operator": "gt",        "value": 50000   },
    { "field": "cidade",         "operator": "contains",  "value": "uber"  }
  ]
}
```

- Operadores: `equals | contains | gt | lt` (set do `filterRules` atual).
- Operadores válidos derivam do `type`: `category`→`equals/contains`; `money`/`number`→`gt/lt/equals`; `date`→`gt/lt`.
- Mesmo shape no pré-import (#1) e no disparo de campanha (#2).

### 2.3 Matcher único (Opção A)

- Uma só implementação backend: `leadMatchesSegmentation(lead, fields, filters)`.
- Preview no front = **dry-run no backend** (endpoint conta quantos casam). Mata a lógica duplicada do `LeadImports.tsx:407`.

### 2.4 Auto-registro no import (Opção 3)

- No upload de planilha, coluna não presente em `fields[]` é oferecida pra **registrar no catálogo** (sob confirmação do operador).
- Preserva o poder atual de filtrar coluna arbitrária — só que agora ela passa a existir pro disparo e dashboard também.

---

## 3. Passos (ordem segura — nada quebra no meio)

### Passo 0 — Helper de catálogo (leitura compat)
- `getSegmentationCatalog(clientId)`: lê `segmentation_config`, normaliza shape v1→v2 em memória, devolve `{ fields, featuredKpis }`.
- Não escreve nada ainda. Base pros próximos passos.

### Passo 1 — Matcher genérico + adapter legado (backend, sem remover nada)
- Novo `leadMatchesSegmentation(lead, fields, filters)` (módulo `segmentation.js` ou em `server.js`). Reusa `getNormalizedField`, `normalizeLooseText`, `parseMoneyLikeValue`.
- **Adapter:** `meta.segmentation` no shape antigo (sem `filters`, com `gender`/...) → mapeado on-the-fly para `filters[]`:
  - `gender→{genero,equals}`, `productType→{tipo_produto,contains}`, `ticket+threshold→{valor,gt|lt}`, `interest→{interesse,contains}`, `campaignTag→{campanha,contains}`.
- `leadMatchesCampaignSegmentation` legado segue existindo até o Passo 6.

### Passo 2 — Disparo usa catálogo + matcher novo
- `buildDispatchLeads({clientId, segmentation})` (`server.js:5180`): carrega catálogo via Passo 0; troca `leadMatchesCampaignSegmentation(item, segmentation)` (`:5232`) por `leadMatchesSegmentation(item, fields, filters)` (com adapter pra campanha antiga).

### Passo 3 — Endpoint dry-run (preview unificado)
- `POST /api/lead-clients/:tenantId/segmentation/preview` → recebe `{ filters, importId? }`, devolve `{ matchedCount, sample }`. Filtra por `client_id` (CLAUDE.md §8).
- Reusa `buildDispatchLeads` em modo count-only.

### Passo 4 — Write path + IA
- `normalizeCampaignAnalyticsMeta` (`campaign-outbound.js:209`): aceitar/validar `segmentation.filters[]` contra o catálogo; descartar filtro de campo fora do catálogo.
- `campaign-ai.js:55-63`: gerar resumo de público a partir de `filters[]` + labels do catálogo, não das keys fixas.

### Passo 5 — Catálogo gravável + auto-registro
- Endpoint de update do `segmentation_config` v2 (`fields[]` + `featuredKpis`). Estende o `PATCH .../segmentation-config` existente.
- Import: detecta coluna nova → oferece registrar em `fields[]`.

### Passo 6 — Frontend converge no shape único
- `useCampanhas.ts:100`: `CampaignSegmentation` (keys fixas) → `{ filters: SegmentationFilter[] }`.
- `LeadImports.tsx`: remover `CampaignSegmentationState`/`toCampaignSegmentationPayload`/matcher local (`:98-132,407-426,1110`). UI passa a:
  - montar `filters[]` com campos vindos do **catálogo da empresa** (não da planilha crua);
  - preview via endpoint dry-run (Passo 3);
  - reaproveitar o componente de regra que já existe (`filterRules`, `:1548`) — mesmo UX coluna/operador/valor.
- Tela de empresa (`Tenants.tsx:664`): editar `fields[]` + escolher `featuredKpis`.

### Passo 7 — Remover legado
- Só após 1-6 validados em produção: remover `leadMatchesCampaignSegmentation` (`server.js:3497`, exports `:7250`, `registerAllDomainRoutes.js:340`, `populateRouteDeps.snippet.js:118`).
- **Adapter de compat fica permanente** (campanhas arquivadas podem re-disparar com shape antigo). Histórico imutável (regra do Luiz).

---

## 4. Critério de aceite (evidência real — CLAUDE.md §3)

1. Campanha NOVA com `filters[]` dispara só pros leads que casam — colar query/contagem.
2. Campanha ANTIGA (shape hardcoded) de outro tenant (Infinie) **dispara idêntico** via adapter — evidência antes/depois.
3. Preview (dry-run) e disparo retornam **a mesma contagem** pro mesmo filtro — colar os dois.
4. Coluna nova de planilha registra em `fields[]` e fica filtrável no disparo.
5. Dashboard segue mostrando só `featuredKpis` (cap 6 preservado).
6. Multi-tenant: toda leitura de catálogo/leads filtra por `client_id`.

---

## 5. Arquivos tocados

**Backend:** `server.js` (catálogo 1565/1596, matcher 3497, dispatch 5232, exports 7250, +endpoint preview, +helper catálogo), `campaign-outbound.js` (209), `campaign-ai.js` (55-63), `domains/registerAllDomainRoutes.js` (340), `http/populateRouteDeps.snippet.js` (118).
**Frontend:** `hooks/useCampanhas.ts` (57,100,230), `hooks/useLeadClients.ts` (segmentationConfig types), `pages/LeadImports.tsx` (98-132,407-426,689,1110,form 1548), `pages/Tenants.tsx` (333,664).
**Migration:** nenhuma destrutiva. `segmentation_config` v1 lido com compat; grava v2 no próximo update.

---

## 6. Por que antes do Liv Pub

Unificado, o `perfil_musical` da Liv vira **entrada no catálogo** (`fields[]`) — zero motor de filtro novo. Construir esteira sobre base hardcoded seria refeito depois.
