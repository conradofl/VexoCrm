---
name: Setup Prompt 03 - Configurar Estado
description: Inicializa current-state.md com dados do projeto e status real
type: prompt
tags: [#setup, #automation]
created: 2026-05-09
---

# 03 — Configurar Estado Inicial

**Objetivo:** Popular `_memory/current-state.md` com status real de VexoCRM

**Tempo:** 5-10 minutos

---

## O que vai ser preenchido

```yaml
current-state.md:
  - Prioridades desta semana
  - Tasks em andamento
  - Bloqueadores
  - Últimas decisões
  - Status por componente (backend, frontend, infra)
  - Progresso geral
  - Próxima sessão (data e o que fazer)
```

---

## Informações que preciso

Responda rapidamente (30 segundos cada):

### Sobre VexoCRM agora

1. **Prioridades:** Quais são as 3-5 tasks mais urgentes?
   ```
   - Fixar X (urgente)
   - Implementar Y (médio)
   - Documentar Z (baixo)
   ```

2. **Em andamento:** O que você está trabalhando agora?
   ```
   - Task 1: 50% pronto
   - Task 2: 0% (bloqueado)
   ```

3. **Bloqueadores:** O que está te impedindo?
   ```
   - Bug em campaign-outbound.js
   - Awaiting PR review
   ```

4. **Decisões recentes:** O que você decidiu (últimas 2 semanas)?
   ```
   - Usar Postgres direto
   - Edge Functions v2
   ```

5. **Status por componente:**
   ```
   - Backend: 75% completo
   - Frontend: 80% completo
   - Infra: 60% completo
   ```

---

## Como responder

**Opção 1 (rápido):**
```
Execute: /braindump
Copie e cole suas respostas
```

**Opção 2 (interativo):**
```
Edite manualmente _memory/current-state.md
Salve arquivo
```

---

## Modelo de resposta

```
## 🎯 Prioridades
- [ ] Bug campaign-outbound (URGENT)
- [ ] Multi-tenant validation (MEDIUM)
- [ ] PR review tenantScope (MEDIUM)

## 🚧 Em andamento
| Task | Status | ETA |
| --- | --- | --- |
| Campaign bug | 50% | 2026-05-10 |
| Multi-tenant | 0% | 2026-05-15 |

## 🚫 Bloqueadores
- Backend migrations timeout
- Awaiting review from X

## 💡 Decisões
- Postgres direto (2026-05-09)
- Edge Functions v2 (2026-05-08)

## 📈 Progresso
- Backend: 75%
- Frontend: 80%
- Infra: 60%
```

---

## Próximo passo

Depois de preencher current-state.md:

Execute: **`_prompts/04-primeiro-teste.md`**

---

## Status

✅ Arquivo já existe (`_memory/current-state.md`)  
⏳ Aguardando suas informações para popular

**Copie as respostas acima e edite o arquivo manualmente, ou execute `/braindump` com suas respostas.**

---

**Próximo:** Preencha `current-state.md` → Execute `_prompts/04-primeiro-teste.md`
