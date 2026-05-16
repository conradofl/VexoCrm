---
name: Decide Command (Dev-specific)
type: command
tags: [#command, #dev-specific, #decision]
created: 2026-05-09
---

# /decide

**Executa:** Registra decisão técnica arquitetural no momento  
**Frequência:** Sempre que toma decisão importante (varias vezes/semana)  
**Tempo:** 2-3 min  
**Argumentos:** Sim, a decisão (texto)

---

## Identidade

Sou seu documentador de raciocínio. Quando você decide algo técnico, registro o contexto, alternativas, trade-offs e raciocínio. Isso fica histórico (6 meses depois você saberá por que escolheu).

---

## Argumentos

### Sem argumentos
```
/decide
```
Abre prompt interativo.

### Com argumentos
```
/decide Usar Postgres direto em vez de Supabase JS
/decide Migrar conversation-memory para Edge Functions v2
```

---

## Passos (execução interna)

1. Ler proposição (argumentos ou input)
2. Perguntar:
   - **Contexto:** Por que essa decisão agora?
   - **Alternativas:** Quais você considerou?
   - **Trade-offs:** Pros e contras?
   - **Raciocínio:** Por que essa é melhor?
3. Registrar em `_decisions/[DATA]-[TITULO].md`
4. Adicionar tag automática `#decision`

---

## Output esperado

```markdown
# Decisão: Usar Postgres direto em vez de Supabase JS

**Data:** 2026-05-09  
**Componente:** Backend (API)  
**Impacto:** Alto  
**Status:** Ativa  
**Rationale:** Migration segura para Postgres, melhor debugging

---

## Contexto

Supabase JS estava causando incompatibilidades em prod. Migrations rodavam em dev mas falhavam em staging. Precisamos de mais controle sobre conexão.

## Alternativas consideradas

1. **Supabase JS (mantém atual)**
   - Pro: Edge Functions integradas, real-time subscriptions
   - Con: Incompatibilidades em migrations, vendor lock-in

2. **Postgres com pg driver (proposto)**
   - Pro: Controle total, migrations em SQL puro, debugging fácil
   - Con: Perder integração com Edge Functions (mas n8n usa direto)

3. **Hybrid: pg + Supabase para queries apenas**
   - Pro: Melhor dos dois mundos
   - Con: Mais complexo, duplica código

## Decisão

✅ **Postgres direto com pg driver**

**Raciocínio:**
- n8n já usa Supabase direto (não perde nada)
- pgSupabaseCompat.js abstrai se mudamos depois
- Migrations são SQL (version-controlled, testáveis)
- Team está mais confortável com Postgres que Supabase JS

**Timeline:**
- Semana 1 (9-15 mai): Implementar abstração
- Semana 2 (16-22 mai): Testar em staging
- Semana 3 (23-29 mai): Deploy prod

## Trade-offs aceitos

❌ **Perder:** Real-time subscriptions (não usamos anyway)  
❌ **Perder:** Supabase auth integration (Firebase já temos)  
✅ **Ganhar:** Debugging simples (psql direto)  
✅ **Ganhar:** Migrations versionadas (SQL puro)  

## Impacto em outras decisões

- `pgSupabaseCompat.js` fica abstração (pode trocar depois)
- Edge Functions continuam usando Supabase direto (não muda)
- Frontend continua com Supabase JS (auth + real-time)

---

## Revisão
Próxima revisão: 2026-05-22 (após staging)
```

---

## Regras

- ✅ **Não procrastine** — Decida enquanto contexto é fresco
- ✅ **Altenativas sempre** — Considere pelo menos 2 opções
- ✅ **Trade-offs claros** — Nada é perfect, saiba o custo
- ✅ **Timestamp** — Quando você decidi? (6 meses depois faz diferença)
- ✅ **Raciocínio bate** — Se não conseguir explicar, não decida

---

## Depois: /decision-log

Ao sair do dia, `/end-session` consolida suas decisões. `/decision-log` mostra todas (histórico).

