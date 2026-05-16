---
name: Project Status Command (Dev-specific)
type: command
tags: [#command, #dev-specific, #vexocrm]
created: 2026-05-09
---

# /project-status

**Executa:** Status detalhado de VexoCRM (backend, frontend, infra, decisions)  
**Frequência:** Sempre que quer visão completa (daily ou weekly)  
**Tempo:** 5-10 min  
**Argumentos:** Opcional (filtro por componente)

---

## Identidade

Sou seu dashboard técnico. Mostra saúde de cada componente: backend, frontend, infra, decisões pendentes, bloqueadores arquiteturais.

---

## Argumentos

```
/project-status              # Visão completa
/project-status backend      # Apenas backend
/project-status frontend     # Apenas frontend
/project-status decisions    # Decisões pendentes
```

---

## Passos

1. Ler `_pipeline/vexocrm.md` (tasks por componente)
2. Ler `_decisions/` (decisões ativas/resolvidas)
3. Ler `current-state.md` (bloqueadores)
4. Ler `_learnings/` (patterns usados)
5. Compilar por componente

---

## Output esperado

```markdown
# Status VexoCRM — 9 de maio 2026

## 🔴 Backend (Node.js/Express)

### Health
- **Deploy:** EasyPanel — Status ✅
- **API:** http://localhost:3001 — Status ✅
- **Database:** Supabase → Postgres direct (em transição)
- **Health check:** `/health` returns OK

### Tasks ativas
- [ ] Fixar bug em campaign-outbound.js (URGENT)
- [ ] Implementar validação multi-tenant (MEDIUM)
- [ ] Refactor de notification scope (LOW)

### Bloqueadores
- ❌ Postgres em prod: migrations timeout
- ⚠️ Awaiting review: tenantScope.js PR

### Decisões pendentes
- Usar pg direto ou Supabase JS? (em diskussão)
- Middleware genérico de validation? (proposto)

### Última atualização
- Deploy: 2026-05-08 14:30
- Health: ✅ OK
- Erros: 0 em últimas 24h

---

## 🟢 Frontend (React/Vite)

### Health
- **Deploy:** Vercel — Status ✅
- **App:** https://vexocrm.vercel.app — Status ✅
- **Build:** Vite — Última build 2h atrás ✅

### Tasks ativas
- [ ] PR review: tenantScope validation (URGENT)
- [ ] Novo componente: Lead filters (MEDIUM)
- [ ] Fix: Dark mode toggle (LOW)

### Bloqueadores
- ❌ PR não pode mergear (awaiting backend PR)

### Última atualização
- Deploy: 2026-05-09 09:15
- Build time: 3min 42sec
- Warnings: 0

---

## 🟡 Infra (Deploy, CI/CD, Config)

### Health
- **EasyPanel:** VPS online ✅
- **Vercel:** Build pipeline OK ✅
- **Supabase:** Cloud OK ✅
- **n8n:** Saas OK ✅

### Tasks ativas
- [ ] Automation: Deploy pipeline (HIGH)
- [ ] Docs: Migrations in prod (MEDIUM)

### Bloqueadores
- ⚠️ Migrations manual em prod (precisa automação)

---

## 🔵 Decisions Log

### Ativas (em diskussão)
1. **Postgres direto vs Supabase JS** (2026-05-08)
   - Pro direto: Compatibilidade, debugging
   - Pro Supabase: Edge Functions integradas
   - Status: Testing em staging

2. **Middleware validation genérico** (2026-05-09)
   - Proposto: Centralizar em validators.js
   - Benefit: DRY, testável
   - Status: Design review

### Resolvidas esta semana
✅ Use Edge Functions para automação (confirmado)
✅ Multi-tenant em tenantScope (aprovado)
✅ Firebase para auth (stable)

---

## 📈 Progresso geral

| Componente | % Completo | Trend | ETA |
| --- | --- | --- | --- |
| Backend | 75% | ↗️ | 2026-05-15 |
| Frontend | 80% | → | 2026-05-20 |
| Infra | 60% | ↗️ | 2026-05-25 |
| Docs | 70% | → | 2026-05-31 |

---

## 🎯 Próximos passos
1. Resolver Postgres em prod (URGENT)
2. Mergear PR de tenantScope
3. Iniciar Deploy automation
4. Atualizar docs de migrations

---

**Última atualização automática:** 2026-05-09 às 16:30
```

---

## Regras

- ✅ Execute quando quer visão de saúde completa
- ✅ Use para reportar status em meetings
- ✅ Decisions pendentes precisam resolution ou arquivamento
- ✅ Bloqueadores devem ter ETA de resolução

