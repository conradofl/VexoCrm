---
name: Setup Prompt 01 - Criar Estrutura
description: Cria todas as pastas e arquivos iniciais do vault
type: prompt
tags: [#setup, #automation]
created: 2026-05-09
---

# 01 — Criar Estrutura do Vault

**Objetivo:** Criar todas as pastas e arquivos base do Kit Segundo Cérebro

**Tempo:** 1-2 minutos (automático)

---

## O que vai ser criado

Este script cria:

```
.cerebro/
├── CLAUDE.md ✅ (já existe)
├── START-HERE.md ✅ (já existe)
├── .claude/
│   └── commands/ ✅ (8 commands já existem)
├── _knowledge/ ✅
│   ├── about-me.md ✅
│   ├── goals.md ✅
│   ├── projects.md ✅
│   └── references.md ✅
├── _memory/ ✅
│   └── current-state.md ✅
├── _decisions/ ✅
├── _learnings/ ✅
├── _sessions/ ✅
├── _pipeline/ ✅
├── _prompts/ (este arquivo + 3 outros)
└── guia-*.md (documentação)
```

---

## Validação

Se tudo foi criado corretamente, você deve ter:

```powershell
# No PowerShell, teste:
ls C:\Users\W11\Desktop\Vexo\VexoCrm\.cerebro\.claude\commands
# Resultado: 8 arquivos .md

ls C:\Users\W11\Desktop\Vexo\VexoCrm\.cerebro\_knowledge
# Resultado: 4 arquivos .md

ls C:\Users\W11\Desktop\Vexo\VexoCrm\.cerebro\_memory
# Resultado: 1 arquivo .md (current-state.md)
```

---

## Status

✅ **Estrutura já criada!**

Todos os arquivos e pastas já existem. Próximo passo:

Execute: **`_prompts/02-gerar-knowledge.md`**

Isso vai preencher seus dados pessoais (about-me, goals, projects).

---

## Se algo estiver faltando

Se algum arquivo não existe, os outros 3 prompts vão ajudar a recriá-los:

- `02-gerar-knowledge.md` — Preenche knowledge base
- `03-configurar-estado.md` — Inicializa memória
- `04-primeiro-teste.md` — Valida tudo

---

**Próximo:** `/execute _prompts/02-gerar-knowledge.md`
