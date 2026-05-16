---
name: Test Setup Command (Dev-specific)
type: command
tags: [#command, #dev-specific, #setup]
created: 2026-05-09
---

# /test-setup

**Executa:** Valida se o Kit Segundo Cérebro está funcional  
**Frequência:** Setup inicial + quando algo quebra  
**Tempo:** 30 segundos  
**Argumentos:** Nenhum

---

## Identidade

Sou seu verificador de saúde. Checo se o vault está pronto: pastas existem, arquivos têm conteúdo, commands são acessíveis, memoria persiste.

---

## Passos (execução interna)

1. **Verificar estrutura de pastas:**
   - [ ] `.cerebro/` existe
   - [ ] `.cerebro/.claude/commands/` existe
   - [ ] `_knowledge/` existe
   - [ ] `_memory/` existe
   - [ ] `_decisions/` existe
   - [ ] `_learnings/` existe
   - [ ] `_sessions/` existe
   - [ ] `_pipeline/` existe

2. **Verificar arquivos críticos:**
   - [ ] `CLAUDE.md` é legível
   - [ ] `START-HERE.md` é legível
   - [ ] `_memory/current-state.md` existe (ou vazio é OK)
   - [ ] 8 commands em `.claude/commands/` (ver lista abaixo)

3. **Verificar conteúdo:**
   - [ ] YAML frontmatter válido (em arquivos populados)
   - [ ] WikiLinks parseáveis (se tiver)
   - [ ] Sem caracteres especiais quebrados

4. **Verificar permissions:**
   - [ ] Leitura de `_memory/current-state.md` OK
   - [ ] Escrita em `_sessions/` OK
   - [ ] Escrita em `_decisions/` OK

5. **Teste de memória:**
   - [ ] Consegue ler `_memory/current-state.md`?
   - [ ] Consegue atualizar?
   - [ ] Timestamp está atualizado?

---

## Output esperado (✅ tudo OK)

```markdown
# ✅ Kit Segundo Cérebro — Setup Validação

**Data:** 2026-05-09 16:45  
**Status:** ✅ PRONTO PARA USAR

---

## 📁 Estrutura de pastas

✅ `.cerebro/` — ENCONTRADA
✅ `.cerebro/.claude/` — ENCONTRADA
✅ `.cerebro/.claude/commands/` — ENCONTRADA
✅ `_knowledge/` — ENCONTRADA
✅ `_memory/` — ENCONTRADA
✅ `_decisions/` — ENCONTRADA
✅ `_learnings/` — ENCONTRADA
✅ `_sessions/` — ENCONTRADA
✅ `_pipeline/` — ENCONTRADA

---

## 📄 Arquivos críticos

✅ `CLAUDE.md` — LEGÍVEL (4.2 KB)
✅ `START-HERE.md` — LEGÍVEL (3.8 KB)
✅ `_memory/current-state.md` — EXISTENTE (2.1 KB)

---

## ⚙️ Commands (8 total)

✅ daily-briefing.md — PRONTO
✅ end-session.md — PRONTO
✅ braindump.md — PRONTO
✅ weekly-review.md — PRONTO
✅ project-status.md — PRONTO
✅ decide.md — PRONTO
✅ decision-log.md — PRONTO
✅ test-setup.md — PRONTO

---

## 📝 Conteúdo

✅ YAML frontmatter — VÁLIDO
✅ WikiLinks — PARSEÁVEIS
✅ Caracteres especiais — OK
✅ Encoding — UTF-8

---

## 🔐 Permissions

✅ Leitura `_memory/` — OK
✅ Escrita `_sessions/` — OK
✅ Escrita `_decisions/` — OK
✅ Escrita `_learnings/` — OK

---

## 💾 Memória

✅ `current-state.md` é legível
✅ Última atualização: 2026-05-09 16:30
✅ Pode ser atualizado

---

## 🚀 Próximos passos

Tudo funcionando! Você pode:

```
/daily-briefing        # Começar dia
/braindump sua-ideia   # Logar ideias
/end-session           # Fechar dia
```

**Bem-vindo ao seu segundo cérebro!** 🧠
```

---

## Output esperado (❌ com problemas)

```markdown
# ❌ Kit Segundo Cérebro — Setup com Problemas

---

## ⚠️ Problemas encontrados

### Críticos (impede uso)
❌ Pasta `.cerebro/` — NÃO ENCONTRADA
   → Solução: Execute `_prompts/01-criar-estrutura.md`

❌ Arquivo `CLAUDE.md` — NÃO ENCONTRADO
   → Solução: Recrie via prompt 01

### Avisos (reduz funcionalidade)
⚠️ Arquivo `_memory/current-state.md` — VAZIO
   → Solução: Execute `_prompts/03-configurar-estado.md`

⚠️ Pasta `_decisions/` — VAZIA (sem decisões)
   → Solução: Use `/decide` para registrar decisões

⚠️ 2 comandos faltando:
   - ❌ `decide.md`
   - ❌ `decision-log.md`
   → Solução: Execute `_prompts/01-criar-estrutura.md` (recria todos)

---

## 🔧 Como corrigir

1. Se faltar estrutura: Execute `_prompts/01-criar-estrutura.md`
2. Se faltar conteúdo: Execute `_prompts/02-gerar-knowledge.md`
3. Se faltar memória: Execute `_prompts/03-configurar-estado.md`
4. Se tudo quebrado: Comece do passo 1 acima

---

## ❓ Precisa de ajuda?

Leia `START-HERE.md` ou `CLAUDE.md` seção Troubleshooting
```

---

## Regras

- ✅ Execute ao setup inicial
- ✅ Execute se achar que algo quebrou
- ✅ Execute antes de chamar para help
- ✅ Output é diagnóstico (sabe exatamente o que falta)

