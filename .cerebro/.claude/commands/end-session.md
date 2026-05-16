---
name: End Session Command
type: command
tags: [#command, #universal, #critical]
created: 2026-05-09
---

# /end-session

**Executa:** Fecha sessão e persiste memória  
**Frequência:** **OBRIGATÓRIO** ao sair (final do dia/semana)  
**Tempo:** 5-10 min  
**Crítico:** Sem isso, próxima sessão não lembra nada ⚠️

---

## Identidade

Sou seu consolidador de memória. Quando você sai, captura tudo (tarefas, decisões, aprendizados, bloqueadores) e salva para que próxima sessão de Claude Code saiba exatamente onde você estava.

---

## Argumentos

Nenhum. Use assim:
```
/end-session
```

---

## Passos (execução interna)

1. **Perguntar ao usuário:**
   - O que você fez hoje/essa semana?
   - O que ficou pendente? (bloqueadores?)
   - Qual é o próximo passo?
   - Teve aprendizado/insight?

2. **Consolidar respostas:**
   - Tasks completadas → arquivar em `_pipeline/`
   - Tasks em andamento → atualizar status
   - Bloqueadores → adicionar em `current-state.md`
   - Decisões tomadas → criar em `_decisions/`
   - Aprendizados → criar em `_learnings/`

3. **Atualizar arquivos:**
   - `_memory/current-state.md` (o mais importante)
   - `_sessions/[TIMESTAMP].md` (log da sessão)
   - `_pipeline/[projeto].md` (tasks restantes)

4. **Confirmar:**
   - "✅ Memória consolidada"
   - "Próxima sessão sabe exatamente onde você estava"

---

## Output esperado

```markdown
# Fim de Sessão — 9 de maio 2026, 18:45

## Resumo do dia
- ✅ Completou: Fixar bug em campaign-outbound.js
- ✅ Completou: Criar teste de validação multi-tenant
- ⏳ Pendente: PR review em tenantScope.js
- 🚧 Em andamento: Documentar deploy automation

## Bloqueadores
- ❌ Backend não sobe com migrations ativas (investigar amanhã)
- ⚠️ Aguardando review de @colleague

## Decisões tomadas
- Usar Postgres direto (não Supabase JS) para compatibilidade
- Migrar notification scope para v2 (mais testável)

## Aprendizados
- Edge Functions precisam de tratamento de erro específico
- Multi-tenant validation deve estar em middleware, não em route handler

## Próximo passo (amanhã)
1. Continuar PR de tenantScope
2. Investigar bug de migrations
3. Deploy to staging

---

## Estado consolidado
✅ Tudo salvo em:
- `_memory/current-state.md` (próxima sessão lê isso)
- `_sessions/2026-05-09T18-45-00.md` (log histórico)
- `_decisions/2026-05-09-postgres-direto.md` (decisão registrada)
- `_learnings/2026-05-09-edge-functions-error.md` (insight)

```

---

## Regras CRÍTICAS ⚠️

- ✅ **SEMPRE execute ao sair** (fim de dia, sexta, antes de férias)
- ✅ **Sem isso, memória não persiste** → próxima sessão não sabe nada
- ✅ **Leve 5-10 min** → Vale MUITO a pena
- ✅ **Seja honesto** → "não fiz nada" é válido, registra bloqueador
- ✅ **Aprendizados contam** → Mesmo sem código pronto

---

## Se esquecer de fazer

Não tem problema:

1. Abra `_memory/current-state.md` manualmente
2. Atualize o que fez (na mão)
3. Execute `/end-session` mesmo assim
4. Próxima sessão lê current-state e recupera contexto

---

## Feriados / Semanas

Se sair por uma semana:

```
/end-session
  → Qual é a situação geral?
  → Volta em 2026-05-20, o que deve estar pronto?
  → Há dependências?
```

Output vai detalhar tudo que próxima pessoa (ou você futuro) precisa saber.

---

## Variante: end-of-week

Execute na sexta à noite:

```
/end-session week
```

Output vai incluir:
- Semana: 18 de maio (segunda-sexta)
- Tasks completadas: N
- Taxa de conclusão: %
- Decisões da semana
- Aprendizados
- Semana que vem: prioridades

