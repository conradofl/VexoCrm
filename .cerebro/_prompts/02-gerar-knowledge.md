---
name: Setup Prompt 02 - Gerar Knowledge Base
description: Preenche about-me, goals, projects com suas informações reais
type: prompt
tags: [#setup, #automation]
created: 2026-05-09
---

# 02 — Gerar Knowledge Base

**Objetivo:** Preencher sua identidade, objetivos e projetos com dados reais

**Tempo:** 10-15 minutos (você responde perguntas)

---

## Perguntas que vou fazer

### Sobre você (about-me.md)

- Qual é seu timezone?
- Você é madrugador ou matutino?
- Qual é seu maior desafio em VexoCRM?
- Qual tecnologia quer dominar?
- Como aprende melhor? (lendo / vendo / fazendo)
- Qual é sua maior distração?

### Seus objetivos (goals.md)

**Curto prazo (2 semanas):**
- O que quer completar?

**Médio prazo (6-8 semanas):**
- Qual é o objetivo principal?

**Longo prazo (6 meses):**
- Onde quer estar?

### Seus projetos (projects.md)

- Qual é o status de VexoCRM?
- Quem mais está no projeto?
- Qual é o próximo passo?
- Há blockers?

### Suas referências (references.md)

- URL do backend (EasyPanel)?
- URL do frontend (Vercel)?
- Qual é seu gerenciador de senhas?

---

## Como proceder

Copie e responda as perguntas:

```
1. Timezone: (seu timezone)
2. Turno: (manhã / noite / ambos)
3. Maior desafio: (seu desafio)
4. Tecnologia: (qual quer dominar)
5. Como aprende: (método)
...
```

Cole as respostas aqui ou execute `/braindump` com suas respostas.

---

## Status

Templates já existem em `_knowledge/`. Você precisa:

1. Abrir `_knowledge/about-me.md`
2. Preencher as seções (remova os `[ ]` vazios)
3. Fazer o mesmo com `goals.md` e `projects.md`
4. Salvar arquivos

---

## Próximo passo

Depois de preencher:

Execute: **`_prompts/03-configurar-estado.md`**

---

## Dica

Se ficar difícil responder, execute `/end-session` mesmo assim. A próxima sessão você lê current-state e pode refinar depois.

---

**Próximo:** Preencha `_knowledge/about-me.md`, `goals.md`, `projects.md` → Execute `_prompts/03-configurar-estado.md`
