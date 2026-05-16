---
name: Weekly Review Command
type: command
tags: [#command, #universal, #weekly]
created: 2026-05-09
---

# /weekly-review

**Executa:** Análise semanal de progresso, padrões, aprendizados  
**Frequência:** Toda segunda-feira (ou início de semana)  
**Tempo:** 10-15 min  
**Argumentos:** Nenhum

---

## Identidade

Sou seu coach semanal. Analiso o que você fez, detecta padrões, identifica o que funcionou vs o que não funcionou, e alinha para próxima semana.

---

## Passos (execução interna)

1. Ler logs de `_sessions/` (últimos 7 dias)
2. Ler `_memory/current-state.md`
3. Ler `_decisions/` (decisões da semana)
4. Ler `_learnings/` (insights da semana)
5. Contar:
   - Tasks completadas vs planejadas
   - Taxa de conclusão %
   - Bloqueadores recorrentes
   - Padrões de trabalho (qual hora produz mais, etc)
6. Gerar relatório visual

---

## Output esperado

```markdown
# Revisão Semanal — Semana de 2 a 9 de maio

## 📊 Métricas
- **Taxa de conclusão:** 65% (13 de 20 tasks)
- **Tasks urgentes:** 2 completadas, 0 pendentes ✅
- **Tasks tech-debt:** 3 completadas
- **Novos bloqueadores:** 2

## 🏃 O que saiu bem
- Backend: Fixei 3 bugs críticos
- Refactor de tenantScope (mais testável)
- Descoberta sobre Edge Functions (reutilizável)

## ⚠️ O que não saiu
- Frontend: PR review pegou mais tempo que esperado
- Migrations em prod tiveram delay (melhorar docs)
- Parei terça por bloqueador de deploy

## 🎯 Decisões da semana
1. Usar Postgres direto (staging works, prod não)
2. Migrar conversation-memory v2 (melhor pattern)
3. Criar middleware de validation (centralizado)

## 💡 Aprendizados
1. Edge Functions requerem error handling específico
2. Multi-tenant validation em middleware (não em route)
3. Health check deve incluir services.postgresPing

## 📈 Padrão de produtividade
- Segunda: 40% (planejamento)
- Terça: 20% (bloqueado)
- Quarta: 90% (pico!)
- Quinta: 60% (cansaço)
- Sexta: 50% (reviews e docs)

**Insight:** Sexta é melhor para reviews, quarta para coding novo.

## 🚀 Semana que vem (prioridades)
1. [ ] Fixar Postgres em prod
2. [ ] Deploy migration automation
3. [ ] Frontend: completar PR review
4. [ ] Documentar decision-log
5. [ ] Tech debt: validadores centralizados

## 📝 Notas
- Bloqueador de deploy vai afetar semana que vem (plan isso)
- Momentum de refactor bom, continua
- Comunicação com team: melhorar (esperou muito por review)

---

**Próximo passo:** Execute `/end-session` e ajuste `_memory/current-state.md` com prioridades de próxima semana.
```

---

## Regras

- ✅ Execute toda segunda
- ✅ Seja honesto sobre o que não funcionou
- ✅ Padrões aparecem (qual tipo de task toma mais tempo?)
- ✅ Use insights para semana que vem

---

## Variante: sprint-review

Se você usa sprints de 2 semanas:

```
/weekly-review sprint
```

Output: Semana 1 vs Semana 2, tendências, velocity.

