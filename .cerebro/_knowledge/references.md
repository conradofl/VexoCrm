---
name: Referências e recursos
description: Links, ferramentas, documentação, recursos úteis
type: knowledge
tags: [#references, #resources]
status: active
created: 2026-05-09
updated: 2026-05-09
---

# Referências e Recursos

## Documentação do projeto

- [PROJECT_INDEX.md](../../PROJECT_INDEX.md) — Índice completo da arquitetura
- [backend/README.md](../../backend/README.md) — API e deploy
- [frontend/README.md](../../frontend/README.md) — Stack e rotas
- [docs/arquitetura-operacional.md](../../docs/arquitetura-operacional.md) — Arquitetura real
- [docs/workflow-n8n.md](../../docs/workflow-n8n.md) — Automação

## Deploy e infra

- **Backend:** EasyPanel (VPS)
  - Health: `GET /health` (deve retornar `ok: true`)
  - Services check: `services.postgresPing: true`
  - Repo context: `backend/`
  - Porta: 3001 (padrão)

- **Frontend:** Vercel
  - URL: https://vexocrm.vercel.app (seu deploy)
  - Auto-deploy: on push to main
  - Build: `npm run build` (ou `bun run build`)

- **Database:** Supabase
  - Tipo: PostgreSQL
  - Em transição: Postgres direto vs Supabase JS
  - Migrations: `backend/supabase/migrations/`

## Ferramentas externas

- **n8n:** Automação de leads e WhatsApp
  - Webhook entrada: (seu webhook)
  - Padrão: n8n calls Supabase Edge Functions
  - Docs: `docs/workflow-n8n.md`

- **Firebase:** Autenticação CRM
  - Console: https://console.firebase.google.com
  - Auth provider: Email + JWT

- **Obsidian:** Seu segundo cérebro
  - Vault: C:\Users\W11\Desktop\Vexo\VexoCrm\.cerebro
  - Status: Setup inicial (02 em andamento)

## Documentação externa

### Node.js / Express
- [Express.js docs](https://expressjs.com/)
- [Supabase JS SDK](https://supabase.com/docs/reference/javascript)
- [pg driver](https://node-postgres.com/)

### React / Frontend
- [React docs](https://react.dev/)
- [Vite docs](https://vitejs.dev/)
- [TanStack Query](https://tanstack.com/query/latest)
- [Radix UI](https://www.radix-ui.com/)

### Database
- [PostgreSQL docs](https://www.postgresql.org/docs/)
- [Supabase docs](https://supabase.com/docs)
- [Migrations](https://supabase.com/docs/guides/database/migrations)

### DevOps
- [Docker docs](https://docs.docker.com/)
- [n8n docs](https://docs.n8n.io/)

## Contatos úteis

- [ ] Seu manager/colleague: (nome, email)
- [ ] DevOps/Infra: (nome, email)
- [ ] Suporte Supabase: support@supabase.io
- [ ] Suporte n8n: (seu contato)

## Passwords / Secrets

⚠️ **NUNCA coloque passwords aqui!**  
Use gerenciador de senhas:
- [ ] 1Password
- [ ] LastPass
- [ ] KeePass
- [ ] (seu gerenciador)

---

**Próximo passo:** Atualize com seus links e referências reais.
