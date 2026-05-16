---
name: Bem-vindo ao Kit Segundo Cérebro
type: onboarding
tags: [#template, #setup]
created: 2026-05-09
updated: 2026-05-09
---

# 🧠 Bem-vindo ao Kit Segundo Cérebro — VexoCRM Edition

Este é seu **segundo cérebro** para Claude Code. Um sistema de memória que funciona 24/7 entre sessões.

## O que você tem aqui

✅ **Memória persistente** — Tudo que você aprende fica registrado  
✅ **8 slash commands** — Automação de tarefas (briefings, logs, decisões)  
✅ **Base de conhecimento** — Sobre você, seus projetos, suas decisões  
✅ **Pipeline de tarefas** — Rastreamento de trabalho em andamento  
✅ **Obsidian vault** — Conecte ideias com WikiLinks  

---

## Como começa

### Passo 1: Abra como vault Obsidian (opcional mas recomendado)

Se tiver Obsidian instalado:

1. Abra Obsidian
2. "Open folder as vault"
3. Selecione `C:\Users\W11\Desktop\Vexo\VexoCrm\.cerebro`
4. Pronto! Você vê WikiLinks, tags, e toda a estrutura

Se não tiver Obsidian:
- Claude Code funciona normalmente com arquivos .md
- Instale depois se quiser interface visual

### Passo 2: Configure a estrutura

No Claude Code (dentro deste projeto):

```
Cole isto no chat:
Execute _prompts/01-criar-estrutura.md
```

Isso cria todas as pastas automaticamente.

### Passo 3: Preencha sua identidade

Também no Claude Code:

```
Execute _prompts/02-gerar-knowledge.md
```

Você responde perguntas sobre:
- Quem você é (skills, tools, forma de trabalhar)
- Objetivos (curto/médio/longo prazo)
- Projetos atuais (VexoCRM + outros)

### Passo 4: Inicialize estado

```
Execute _prompts/03-configurar-estado.md
```

Isso popula `_memory/current-state.md` com dados reais.

### Passo 5: Valide o setup

```
Execute /test-setup
```

Output ✅ = pronto para usar!

---

## Seu primeiro dia

### Manhã
```
/daily-briefing
```

Você vê tarefas do dia, bloqueadores, progresso.

### Trabalho
- Tasks são criadas via `/braindump` ou Claude Code tasks
- Decisões técnicas são registradas via `/decide`
- Bloqueadores vão para `current-state.md`

### Saída (IMPORTANTE ⚠️)
```
/end-session
```

Isso consolida tudo para próxima sessão:
- O que você fez
- O que ficou pendente
- Aprendizados
- Próximos passos

**Sem `/end-session`, a memória não persiste.**

---

## Estrutura rápida

```
.cerebro/
├── CLAUDE.md                 ← Leia isso para config completa
├── _knowledge/               ← Sobre você (identity, goals, projects)
├── _memory/current-state.md  ← Estado atual (atualizado por /end-session)
├── _decisions/               ← Por que você decide o que decide
├── _learnings/               ← Insights acumulados
├── _pipeline/                ← Tasks ativas
├── _sessions/                ← Logs de sessão
└── .claude/commands/         ← 8 slash commands
```

Você não precisa criar nada manualmente — os prompts fazem isso.

---

## 8 Slash Commands que você tem

### Daily work
- `/daily-briefing` — Resumo do dia (execute ao acordar)
- `/braindump` — Captura rápida (ideias, logs, notas)
- `/end-session` — Fecha dia e persiste (execute ao sair) ⚠️

### Review
- `/weekly-review` — Análise semanal (toda segunda)
- `/project-status` — Status VexoCRM (qualquer hora)

### Decisions
- `/decide` — Registra decisão técnica
- `/decision-log` — Log de todas as decisões

### Setup
- `/test-setup` — Valida se tudo funciona

---

## Dicas de uso

### 1. Atualize `current-state.md` frequentemente
Sempre que tiver uma sessão, execute `/end-session` para persistir memória.

### 2. Use tags consistentemente
```yaml
tags: [#urgent, #backend, #decision]
```

Isso permite buscar depois (ex: "quais decisões tomei?")

### 3. Conecte com WikiLinks
```markdown
Veja mais em [[projects]] e [[about-me]]
```

Obsidian cria um grafo de conhecimento.

### 4. Nomeie decisões com data
```
2026-05-09-usar-supabase-edge-functions.md
```

Fácil buscar "o que decidi em maio?"

### 5. Execute `weekly-review` toda segunda
Detecta padrões, recorrências, aprendizados da semana.

---

## Exemplos de sessão

### Dia 1: Setup
```
1. /daily-briefing → "não há dados ainda"
2. Execute _prompts/02-gerar-knowledge.md
3. Execute _prompts/03-configurar-estado.md
4. /test-setup → "✅ Setup OK"
5. /end-session → "Inicializado sistema"
```

### Dia 2: Desenvolvimento
```
1. /daily-briefing → lista de tasks
2. /braindump Fixei bug em campaign-outbound.js
3. /decide Usar Postgres direto em vez de Supabase JS
4. (trabalha no código)
5. /end-session → consolida tudo
```

### Dia 7: Revisão
```
1. /weekly-review → análise completa
2. /decision-log → vê decisões da semana
3. /project-status → status VexoCRM
4. /braindump Aprendizado: erro foi na validação de multi-tenant
5. /end-session → semana consolidada
```

---

## Problemas comuns

### "Os comandos não funcionam"
Verifique se `.claude/commands/` tem 8 arquivos. Se não:

```
Execute _prompts/01-criar-estrutura.md
```

### "Memória vazia no briefing"
Preencha `_knowledge/about-me.md`, `goals.md`, `projects.md` primeiro.

### "WikiLinks não funcionam"
Abra `.cerebro` como vault Obsidian (passo 1).

### "Esqueci de fazer /end-session"
Faça agora! Backfill: abra `_memory/current-state.md` e atualize manualmente, depois execute `/end-session` para sincronizar.

---

## Próximo passo

👉 **Vá para `CLAUDE.md`** para entender config completa.

Ou execute direto:

```
_prompts/01-criar-estrutura.md
```

---

**Versão:** 1.0 — VexoCRM Edition  
**Data:** 2026-05-09  
**Criado para:** Luiz Felipe Santos
