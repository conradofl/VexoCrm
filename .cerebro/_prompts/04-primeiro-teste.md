---
name: Setup Prompt 04 - Primeiro Teste
description: Valida se tudo está funcionando e pronto para usar
type: prompt
tags: [#setup, #validation]
created: 2026-05-09
---

# 04 — Primeiro Teste Completo

**Objetivo:** Validar que o Kit está 100% funcional

**Tempo:** 2-3 minutos

---

## Checklist de validação

### Estrutura de pastas

- [ ] `.cerebro/` existe
- [ ] `.cerebro/.claude/commands/` existe
- [ ] `_knowledge/` existe (4 arquivos)
- [ ] `_memory/` existe (1 arquivo)
- [ ] `_decisions/`, `_learnings/`, `_sessions/`, `_pipeline/` existem

### Arquivos principais

- [ ] `CLAUDE.md` é legível
- [ ] `START-HERE.md` é legível
- [ ] `_memory/current-state.md` foi preenchido
- [ ] `_knowledge/about-me.md` foi preenchido
- [ ] `_knowledge/goals.md` foi preenchido
- [ ] `_knowledge/projects.md` foi preenchido

### Comandos

Execute no Claude Code:
```
/test-setup
```

Output esperado: ✅ SETUP OK

---

## Teste de uso

Execute em sequência:

```
1. /daily-briefing
   → Deve mostrar prioridades do dia

2. /braindump Teste inicial do kit
   → Deve registrar no log de sessão

3. /project-status
   → Deve mostrar status de VexoCRM

4. /end-session
   → Deve consolidar tudo em current-state
```

---

## Se tudo passou ✅

Parabéns! Seu Kit Segundo Cérebro está 100% funcional.

**Próximos passos:**
1. Use `/daily-briefing` todo dia de manhã
2. Use `/braindump` sempre que descobrir algo
3. Use `/end-session` antes de sair (CRÍTICO)
4. Use `/weekly-review` toda segunda

---

## Se algo falhou ❌

Execute `/test-setup` para diagnóstico completo.

Erros comuns:

| Erro | Solução |
| --- | --- |
| "Comando não encontra" | Verifique se `.cerebro/.claude/commands/` tem 8 arquivos |
| "current-state vazio" | Execute manual: edite `_memory/current-state.md` |
| "WikiLinks não funciona" | Abra `.cerebro` como vault no Obsidian |
| "Não consigo salvar" | Verifique permissões de escrita em `_memory/` |

---

## Backup

Recomendação: **Versione tudo no Git**

```powershell
cd C:\Users\W11\Desktop\Vexo\VexoCrm
git add .cerebro/
git commit -m "Initial: Kit Segundo Cérebro setup"
git push
```

---

## Próximos passos na vida real

Depois que validar com `/test-setup`:

### Hoje
1. `/daily-briefing` → veja prioridades
2. Trabalhe normalmente
3. `/braindump` → ideias/bugs que encontrar
4. `/end-session` → saia

### Amanhã
1. `/daily-briefing` → contexto foi preservado!
2. Continue de onde parou

### Segunda-feira
1. `/weekly-review` → análise semanal
2. `/project-status` → health check completo
3. `/end-session` week → semana consolidada

---

## Documentação

Se ficar com dúvida:

1. Leia `CLAUDE.md` (config central)
2. Leia `START-HERE.md` (onboarding)
3. Leia `.cerebro/.claude/commands/*.md` (documentação de cada comando)

---

## Sucesso! 🎉

Agora você tem:

✅ Memória persistente entre sessões  
✅ 8 slash commands para automação  
✅ Base de conhecimento pessoal  
✅ Histórico de decisões  
✅ Log de aprendizados  
✅ Pipeline de tarefas  

**Bem-vindo ao seu segundo cérebro!** 🧠

---

**Última validação:** Execute `/test-setup` agora
