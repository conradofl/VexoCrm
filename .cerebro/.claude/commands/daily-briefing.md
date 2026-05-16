---
name: Daily Briefing Command
type: command
tags: [#command, #universal, #daily]
created: 2026-05-09
---

# /daily-briefing

**Executa:** Resumo diário do que fazer  
**Frequência:** Toda manhã (opcional automático)  
**Tempo:** 2-3 min de leitura

---

## Identidade

Sou seu assistente matinal. Leia meu resumo para começar o dia focado: prioridades claras, bloqueadores mapeados, progresso visível.

---

## Argumentos

Nenhum. Use assim:
```
/daily-briefing
```

Opcional:
```
/daily-briefing segunda-feira
```

Filtro por dia da semana.

---

## Passos (execução interna)

1. Ler `_memory/current-state.md` → tarefas ativas, bloqueadores, prioridade
2. Ler `_knowledge/projects.md` → projetos ativos, status
3. Ler `_pipeline/` → tarefas por projeto
4. Contar tasks por status: pending, in_progress, blocked
5. Calcular taxa de progresso (tasks ontem vs hoje)
6. Gerar output formatado

---

## Output esperado

```markdown
# ☀️ Briefing — 9 de maio de 2026

## Hoje é quinta-feira

### Prioridades hoje (🔴 2 | 🟡 3 | 🟢 1)
- [x] URGENT: Fixar bug em campaign-outbound.js (backend)
- [ ] Implementar validação multi-tenant (backend)
- [ ] Review de PR #58 (frontend)
- [ ] Atualizar documentação de deploy (infra)
- [ ] Estudar pattern de Edge Functions (learning)

**Próximo:** Começar com bug campaign-outbound

### Bloqueadores
- ❌ Aguardando deploy do backend (requer health check)
- ⚠️ Preciso de review em tenantScope.js

### Progresso
- Ontem: 40% de tasks
- Hoje: 0% (é manhã!)
- Taxa semana: 65% ✅

### Insights ontem
- Aprendido: Supabase Edge Functions requerem middleware específico
- Decisão: Usar Postgres direto para dev local

---

## Ações rápidas
Copie um dos comandos:
- `/braindump Começando bug em...`
- `/decide Vou usar X porque Y`
- `/end-session` quando terminar

```

---

## Regras

- ✅ Leia antes de qualquer decisão
- ✅ Prioridades são **ordenadas** (top = fazer primeiro)
- ✅ Se há bloqueador, identifique solução
- ✅ Tarefas com 🔴 são urgent (hoje mesmo)
- ❌ Não ignore tarefas 🟡 (tech debt explode depois)

---

## Se estiver vazio

Significa que `_memory/current-state.md` está vazio ou `_pipeline/` sem tasks.

**Solução:**
1. Execute `_prompts/03-configurar-estado.md` (popula current-state)
2. Use `/braindump` ou Claude Code tasks para criar items
3. Execute `/end-session` para persistir
4. Próxima manhã `/daily-briefing` funciona

---

## Variações por hora

- **7-9h:** Versão curta (3-5 items)
- **10-17h:** Versão média (5-10 items + bloqueadores)
- **18h+:** Versão "fim de dia" (o que completou? o que fica?)

Customize filtro:
```
/daily-briefing morning
/daily-briefing endofday
```

