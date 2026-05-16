---
name: Seus projetos
description: Projetos ativos com status, prioridade, próximo passo
type: knowledge
tags: [#projects, #active]
status: active
created: 2026-05-09
updated: 2026-05-09
---

# Seus Projetos

## 🎯 VexoCRM (Ativo - CRITICAL)

**Status:** Em produção, desenvolvimento ativo  
**Tipo:** SaaS — CRM com automação n8n  
**Componentes:** Backend (Node) + Frontend (React) + Supabase Edge Functions + n8n  
**Prioridade:** 🔴 CRITICAL  
**Próximo passo:** Fixar 3+ bugs críticos (próximas 2 semanas)  

### Progresso atual
- Backend: 75% completo (APIs estáveis, bugs em campaign-outbound)
- Frontend: 80% completo (validação multi-tenant em PR)
- Infra: 60% completo (deploy automation pendente)
- **Overall:** ~72% → Target 90% em 6 meses

### Time
- **Você:** Full-stack (Luiz Felipe) — 4-6h/dia
- **Outros devs:** (adicione quando souber)

### Bloqueadores atuais
- ❌ Campaign-outbound.js retorna undefined em prod
- ⚠️ Migrations timeout em prod (Postgres vs Supabase JS)
- ⏳ PR de tenantScope.js aguardando review

### Decisões ativas
1. **Postgres direto vs Supabase JS** — Testando em staging
2. **Edge Functions v2 pattern** — Design em andamento
3. **Middleware validation** — Centralizar em `validators.js`

### Referências
- [[PROJECT_INDEX.md]] — Arquitetura completa
- [[decision-log]] — Decisões técnicas
- `/project-status` — Dashboard atualizado

---

## Outros projetos (opcional)

### Projeto 2
**Status:** (draft / active / paused)  
**Prioridade:** 🟡 MEDIUM  
**Descrição:** (o que é)  
**Próximo passo:** (what's next)  

---

## Arquivados

### Projeto X
**Status:** ✅ Completo / ❌ Cancelado  
**Aprendizado:** O que você aprendeu?  

---

**Próximo passo:** Mantenha atualizado. Use `/project-status` para ver saúde de VexoCRM.
