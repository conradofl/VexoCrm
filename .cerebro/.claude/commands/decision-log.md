---
name: Decision Log Command (Dev-specific)
type: command
tags: [#command, #dev-specific, #log]
created: 2026-05-09
---

# /decision-log

**Executa:** Log histórico de todas as decisões tomadas (VexoCRM)  
**Frequência:** Consulta histórica (qualquer hora)  
**Tempo:** 2-3 min de leitura  
**Argumentos:** Nenhum

---

## Identidade

Sou seu historiador técnico. Mostro todas as decisões que você tomou em VexoCRM: quando, por quê, impacto. Útil para responder "por que fazemos assim?" ou recuperar raciocínio que esqueceu.

---

## Passos

1. Ler pasta `_decisions/`
2. Ordenar por data (mais recentes primeiro)
3. Compilar com status (ativa, arquivada, revertida)
4. Mostrar impacto e raciocínio

---

## Output esperado

```markdown
# Decision Log — VexoCRM

**Total decisões:** 23 | **Ativas:** 18 | **Revertidas:** 1 | **Arquivadas:** 4

---

## 📌 Decisões Ativas (últimas 30 dias)

### 1. Usar Postgres direto vs Supabase JS
**Data:** 2026-05-09 | **Componente:** Backend | **Impacto:** Alto  
**Status:** ✅ Ativa (implementando)  
**Raciocínio:** Migrations em SQL puro, debugging simples, team confortável  
**Trade-off:** Perder real-time (não usamos anyway)  
**Timeline:** Deploy em 2026-05-29  

### 2. Migrar conversation-memory para Edge Functions v2
**Data:** 2026-05-08 | **Componente:** Automação | **Impacto:** Alto  
**Status:** ✅ Ativa (design phase)  
**Raciocínio:** Melhor error handling, pattern mais testável  
**Alternativa rejeitada:** Manter v1 e adicionar layer (mais complexo)  

### 3. Middleware genérico de validação
**Data:** 2026-05-09 | **Componente:** Backend | **Impacto:** Médio  
**Status:** ⏳ Pendente review  
**Raciocínio:** Centralizar validadores em `/src/validators.js`, DRY  

### 4. Firebase para autenticação CRM
**Data:** 2026-04-15 | **Componente:** Auth | **Impacto:** Crítico  
**Status:** ✅ Ativa (stable em prod)  
**Raciocínio:** Melhor que JWT manual, integração fácil com Vercel  

---

## 📚 Decisões Resolvidas (completadas/fechadas)

### 5. Use n8n para orquestração (não custom)
**Data:** 2026-03-20  
**Raciocínio:** n8n pronto para prod vs 3-4 meses build in-house  
**Resultado:** ✅ Funcionando há 6 semanas, zero issues  

### 6. Supabase Edge Functions para automação leads
**Data:** 2026-03-18  
**Raciocínio:** Real-time, escala automática, custa pouco  
**Resultado:** ✅ Em produção, 50k função calls/dia  

---

## ⚠️ Decisões Revertidas

### 7. Usar Supabase Auth (revertida 2026-04-10)
**Data original:** 2026-03-25  
**Razão reversão:** Incompatível com multi-tenant, mudou para Firebase  
**Lição aprendida:** Testar multi-tenant antes de escolher auth  

---

## 📋 Decisões Arquivadas (não relevantes mais)

### 8. Usar GraphQL vs REST (arquivada 2026-04-01)
**Data:** 2026-02-20  
**Contexto:** Inicialmente REST foi escolhido, GraphQL descartado  
**Razão arquivamento:** Team confortável com REST, GraphQL não needed  

---

## 🎯 Próximas decisões pendentes

- [ ] Quando migrar Postgres v13 → v15?
- [ ] CDN para assets estáticos (S3? Vercel Edge)?
- [ ] Rate limiting strategy (Redis ou API Gateway)?

---

## 📊 Estatísticas

| Métrica | Valor |
| --- | --- |
| Decisões ativas | 18 |
| Tempo médio decisão | 2-3 dias |
| Taxa revertida | 4% (1 de 23) |
| Componente mais mudança | Backend (8) |
| Período | Fevereiro - Maio 2026 |

```

---

## Regras

- ✅ Leia antes de propor nova coisa (já foi decidido?)
- ✅ Histórico tem valor (saber por que, não só o quê)
- ✅ Se quer reabrir decisão antiga: `/decide Reconsiderar X porque Y`
- ✅ Consulte ao onboarding novo dev ("aqui estão nossas decisões")

