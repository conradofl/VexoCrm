---
name: Estado atual
description: Estado persistente resumido; fonte operacional principal em _memoria/
type: memory
tags: [#current-state, #critical, #vexocrm]
status: active
created: 2026-05-09
updated: 2026-06-16
---

# Estado Atual — VexoCRM

**Última atualização:** 2026-06-16
**Fonte operacional principal:** `_memoria/contexto-vivo.md`, `_memoria/pendencias.md`, `_memoria/indice-projeto.md`

---

## Snapshot

- Repositório ativo: `/home/luizfelipe/Documents/Programação/Vexo/VexoCrm`.
- Branch: `main`.
- HEAD: `cfcdbe3` — Merge `fix writer do chatbot + marcador de follow-up (bugs 1 e 2) + aprendizados 16/06`.
- `git pull --ff-only origin main` executado em 2026-06-16; fast-forward de `5dc6011` para `cfcdbe3`.
- Memória operacional atualizada em `_memoria/`.

## Arquitetura real

- Backend: Node.js/Express, PostgreSQL/EasyPanel, Docker, Firebase Admin, BullMQ/Redis, Groq.
- Frontend: React/Vite/TypeScript, TanStack Query, Radix UI, Tailwind, Firebase, Vercel.
- Código ainda usa rótulos "Supabase" por compatibilidade histórica com migrations/camada de dados; não renomear sem plano.
- Migrations canônicas: `backend/supabase/migrations/`.
- Segundo cérebro RAG global: servidor em `segundo-cerebro/_rag`, CLI `cerebro` para Codex/Cursor e endpoints HTTP `/api/query`, `/api/search`, `/api/chat` para Claude Code.

## Produto

- Navegação organizada em **Máquina de Vendas** e **Máquina de Disparos**.
- `Conexoes.tsx`: funcional; chips WhatsApp por tenant via `EvolutionChipsPanel`.
- `Relatorios.tsx`: funcional v1; envios por dia/chip via `/api/reports/evolution-usage`.
- `EvolutionAdmin.tsx`: funcional; inventário local por padrão e busca remota manual/cacheada para não martelar `/instance/fetchInstances`.
- `Disparos.tsx`: placeholder.
- `Aquecimento.tsx`: placeholder.
- Follow-up, chatbot, portal cliente, tenants, planilhas/campanhas e usuários continuam presentes no frontend.

## Pendências prioritárias

1. Validar live anti-reenvio por disparo: mesmo `dispatch_id` rodado 2x não pode reenviar leads já tocados.
2. Validar live anti-ban 3a v2: cota por chip e rotação para segundo chip.
3. Validar em produção que `EvolutionAdmin` não chama `/instance/fetchInstances` sem clique em "Buscar Evolution"; manter índice de expressão no banco da Evolution para a query de `"Message"`.
4. Implementar opt-out por palavra-chave.
5. Implementar aviso de cota aos 80%.
6. Construir tela operacional real de `Disparos`.
7. Definir e construir regra de `Aquecimento`.

## Regras de sessão

1. Antes de trabalhar: `git status --short --branch`, `git pull --ff-only origin main`, `git log --oneline --decorate -20`.
2. Se `.cerebro/` e `_memoria/` divergirem, `_memoria/` vence.
3. Nunca gravar segredos em memória, docs ou código.
4. Gate de frontend: usar type-check do `frontend/tsconfig.app.json`; `vite build` não pega identificador global não importado.
5. Gate de backend: não colocar migration/`ALTER TABLE` no caminho quente.
6. Não fazer polling/refetch automático em `/instance/fetchInstances` da Evolution; consulta remota só por ação manual e com cache/dedupe.
7. Para contexto compartilhado entre Codex/Cursor/Claude, consultar `cerebro`/RAG quando disponível.
