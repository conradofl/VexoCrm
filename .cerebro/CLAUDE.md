---
name: Configuração do Kit Segundo Cérebro
type: system-config
created: 2026-05-09
updated: 2026-05-09
---

# CLAUDE.md — Kit Segundo Cérebro para VexoCRM

Arquivo central de configuração. Define como Claude Code se comporta neste vault e como persiste memória entre sessões.

## Identidade do Projeto

**Projeto:** VexoCRM  
**Tipo:** Sistema de CRM multi-tenant + automação n8n  
**Você (desenvolvedor):** Luiz Felipe Santos  
**Email:** luizz.felipe.santos17@gmail.com  
**Papel:** Full-stack developer (backend Node + frontend React)

## Modo de operação

Claude Code trabalha dentro deste vault com 3 responsabilidades:

### 1. Lembrar

**Memória automática entre sessões via:**
- `_knowledge/` — Base pessoal (habilidades, preferências, forma de trabalhar)
- `_memory/current-state.md` — Estado atual (projetos, prioridades, bloqueadores)
- `_decisions/` — Decisões técnicas com raciocínio
- `_learnings/` — Insights acumulados
- `_pipeline/` — Tarefas ativas

**Regra:** Toda conversa produz memória. Ao final (/end-session), estado é registrado.

### 2. Executar

**Slash commands disponíveis:**
- `/daily-briefing` — Resumo diário do que fazer
- `/end-session` — Fecha sessão e persiste estado
- `/braindump` — Captura rápida de ideias/logs
- `/weekly-review` — Análise semanal de progresso
- `/project-status` — Status detalhado de projetos (dev-specific)
- `/decide` — Registra decisões técnicas (dev-specific)
- `/decision-log` — Log de decisões e raciocínio
- `/test-setup` — Validação de setup (dev-specific)

### 3. Aprender

**Feedback loop:**
- User → Task → Decision → Learning → State
- Cada sessão melhora compreensão do projeto
- Padrões de work detectados e documentados

---

## Estrutura do Vault

```
.cerebro/
├── CLAUDE.md                 # Este arquivo (config central)
├── START-HERE.md            # Onboarding para novo usuário
├── guia-instalacao.md       # Setup passo a passo
├── guia-personalizacao.md   # Como customizar o kit
│
├── _knowledge/              # Base pessoal
│   ├── about-me.md         # Identidade, skills, tools
│   ├── goals.md            # Objetivos short/mid/long term
│   ├── projects.md         # Projetos ativos (VexoCRM + outros)
│   └── references.md       # Links, recursos, documentação
│
├── _memory/                 # Estado persistente
│   └── current-state.md    # Atualizado por /end-session
│
├── _decisions/              # Raciocínio técnico
│   └── [data-titulo].md    # Decisão com contexto + raciocínio
│
├── _learnings/              # Insights acumulados
│   └── [data-titulo].md    # Aprendizado com aplicação
│
├── _pipeline/               # Tarefas ativas
│   └── [projeto-id].md     # Tasks por projeto
│
├── _sessions/               # Logs de sessão
│   └── [data-hora].md      # Braindump de sessão
│
├── .claude/
│   └── commands/            # 8 slash commands
│       ├── daily-briefing.md
│       ├── end-session.md
│       ├── braindump.md
│       ├── weekly-review.md
│       ├── project-status.md
│       ├── decide.md
│       ├── decision-log.md
│       └── test-setup.md
│
└── _prompts/                # Setup helpers
    ├── 01-criar-estrutura.md
    ├── 02-gerar-knowledge.md
    ├── 03-configurar-estado.md
    └── 04-primeiro-teste.md
```

---

## Convenções

### Nomes de arquivo
- **kebab-case:** `my-file.md`
- **Data prefix em logs:** `2026-05-09-task-title.md`
- **Sem espaços ou maiúsculas**

### Frontmatter YAML
Todo arquivo tem:
```yaml
---
name: Título legível
type: knowledge | decision | learning | pipeline | memory | session
tags: [#tag1, #tag2]
status: active | archived | draft
created: 2026-05-09
updated: 2026-05-09
---
```

### Tags padrão
- `#urgent` — Bloqueador / priority alta
- `#backend` — Tarefas backend (Node)
- `#frontend` — Tarefas frontend (React)
- `#infra` — Deploy, DevOps, CI/CD
- `#decision` — Decisão técnica registrada
- `#learning` — Insight aprendido
- `#project` — Item de projeto
- `#bug` — Bug encontrado/fixado

### WikiLinks
Conecte ideias:
- `[[about-me]]` — Referencia a si mesmo
- `[[projects]]` — Projetos ativos
- `[[current-state]]` — Estado atual
- `[[vexocrm-architecture]]` — Arquitetura

---

## Fluxo de sessão

### Início de sessão
1. Claude Code carrega este vault
2. Lê `_memory/current-state.md`
3. Entende contexto: projeto, prioridades, bloqueadores
4. Inicia com `/daily-briefing` automático (opcional)

### Durante a sessão
- Tasks são criadas/atualizadas
- Decisões são registradas em `_decisions/`
- Bloqueadores são loggados
- Estado é atualizado incrementalmente

### Fim de sessão
- User executa `/end-session`
- Claude Code consolida em `current-state.md`
- Sessão é loggada em `_sessions/[timestamp].md`
- Memória persiste para próxima sessão

---

## Regras de memória

### ✅ Salvar em memória

**User:**
- Preferências ("não use X", "prefiro Y")
- Aprendizados ("descobri que Z funciona")
- Decisões ("por que fazemos assim")
- Feedback ("isso foi bom, repita")

**Project:**
- Status de tasks e projetos
- Bloqueadores e dependências
- Deadlines e prioridades (datas absolutas, não relativas)
- Contexto de negócio (por que fazemos isso)

**Tech:**
- Decisões arquiteturais
- Patterns usados no projeto
- Ferramentas configuradas
- Integrações e APIs

### ❌ NÃO salvar

- Git history (use `git log`)
- Código (use IDE)
- Bugs resolvidos (só se tiver pattern)
- Checklists temporários
- Estados efêmeros

---

## Slash commands (8 total)

### Universal (5 commands)

#### `/daily-briefing`
Resumo diário do que fazer.

**Output:**
```
# Briefing — 9 de maio, 2026

## Prioridades hoje
- [ ] Task 1
- [ ] Task 2

## Bloqueadores
- Nenhum

## Progresso
Ontem: X% → Hoje: Y%
```

#### `/end-session`
Fecha sessão e persiste estado. **Obrigatório ao final.**

**Pergunta:**
- O que foi feito?
- O que está bloqueado?
- Próximo passo?
- Aprendizado?

**Salva em:**
- `_memory/current-state.md`
- `_sessions/[timestamp].md`

#### `/braindump`
Captura rápida de ideias/logs.

**Aceita argumentos:**
```
/braindump Tive uma ideia para otimizar...
/braindump Descobri que o bug era em...
```

**Salva em:** `_sessions/[timestamp].md`

#### `/weekly-review`
Análise semanal. **Execute toda segunda-feira.**

**Output:**
- Semana: X de Y
- Tasks completadas: N
- Taxa de conclusão: %
- Blockers recorrentes
- Insights da semana

#### `/project-status`
Status detalhado de VexoCRM (dev-specific).

**Output:**
```
# Status VexoCRM — 9 de maio

## Backend
- Tasks ativas: N
- Prioridade: HIGH
- Bloqueador: (se houver)

## Frontend
- Tasks ativas: N
- Prioridade: MEDIUM
- Próximo: (rota/componente)

## Infra
- Deploys: N esta semana
- Falhas: (se houver)

## Decisions pendentes
- [ ] Decision 1
```

### Dev-Specific (3 commands)

#### `/decide`
Registra decisão técnica no momento.

**Prompts:**
- Qual é a decisão?
- Por quê? (contexto)
- Alternativas consideradas?
- Trade-offs?

**Salva em:** `_decisions/[data]-[titulo].md`

#### `/decision-log`
Log de todas as decisões tomadas.

**Output:**
```
# Decision Log — VexoCRM

## 2026-05-09: Use Supabase Edge Functions
- Contexto: Automação de leads
- Raciocínio: Serverless + real-time
- Trade-off: Vendor lock-in

## 2026-05-08: React + Vite
- Contexto: Frontend rebuild
- Raciocínio: Performance + DX
```

#### `/test-setup`
Valida se o vault está funcional (dev-specific).

**Checks:**
- [ ] Pasta `.cerebro/` existe
- [ ] `CLAUDE.md` é legível
- [ ] 8 commands em `.claude/commands/`
- [ ] `_knowledge/` populado
- [ ] `_memory/current-state.md` existe
- [ ] Frontmatter YAML válido

**Output:** ✅ Setup OK | ❌ Setup com problemas

---

## Como customizar

### Renomear comandos
1. Renomeie arquivo em `.claude/commands/novo-nome.md`
2. Comando fica disponível como `/novo-nome`
3. Atualize referências neste arquivo

### Adicionar novo comando
1. Crie `.claude/commands/meu-comando.md`
2. Siga estrutura: nome + argumentos + output + regras
3. Comando automático como `/meu-comando`

### Remover seção (ex: decisions)
1. Delete pasta `_decisions/`
2. Delete comando `/decide` e `/decision-log`
3. Atualize `current-state.md` (remova references)

### Adaptar para outro projeto
1. Copie esta estrutura
2. Edite `about-me.md`, `goals.md`, `projects.md`
3. Customize tags em `_learnings/` e `_decisions/`
4. Teste com `/test-setup`

---

## Troubleshooting

### "Comando não encontra"
```powershell
ls .claude/commands/
# Deve listar 8 arquivos .md
```

### "Memória vazia"
Preencha antes:
- `_knowledge/about-me.md`
- `_knowledge/goals.md`
- `_knowledge/projects.md`

Depois execute `/end-session` manualmente.

### "WikiLinks não funcionam"
Obsidian precisa ver `C:\Users\W11\Desktop\Vexo\VexoCrm\.cerebro` como vault.

1. Abra Obsidian
2. "Open folder as vault"
3. Selecione `.cerebro/`
4. WikiLinks funcionam

---

## Próximos passos

1. Leia `START-HERE.md`
2. Execute `_prompts/01-criar-estrutura.md` (cria pastas)
3. Execute `_prompts/02-gerar-knowledge.md` (templates)
4. Execute `_prompts/03-configurar-estado.md` (preenche dados)
5. Execute `_prompts/04-primeiro-teste.md` (valida)
6. Use `/daily-briefing` todos os dias
7. Use `/end-session` ao sair

---

**Última atualização:** 2026-05-09  
**Kit versão:** 1.0 — VexoCRM Edition  
**Mantido por:** Claude Code + Obsidian
