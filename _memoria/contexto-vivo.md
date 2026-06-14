# Contexto-vivo — Vexo OS

> Estado atual do projeto. Fonte de estado para novas sessões, mas o repo vence em caso de divergência.

_Última atualização: 2026-06-13 após `git pull --ff-only origin main`._

## Snapshot Git

- Repositório local ativo: `/home/luizfelipe/Documents/Programação/Vexo/VexoCrm`.
- Branch: `main`.
- Remoto: `origin https://github.com/LuizApenas/VexoCrm.git`.
- HEAD confirmado: `93653a7` — Merge PR #122 `codex/empresas-modal-listagem`.
- Pull em `origin/main`: executado em 2026-06-13; resultado `Already up to date`.
- Worktree antes da atualização da memória: limpo.

## Infraestrutura e stack

- Monorepo com `backend/`, `frontend/`, `apps/angular-crm/`, `docs/`, `_memoria/` e `.cerebro/`.
- Banco operacional: PostgreSQL no EasyPanel, acessado pelo código ainda rotulado como "Supabase" por compatibilidade histórica. Não renomear referências "Supabase" sem evidência e migração controlada.
- Backend: Node.js/Express ESM, porta padrão 3001, deploy Docker/EasyPanel, migrations no contexto `backend/`.
- Frontend: React 18 + TypeScript + Vite + TanStack Query + Radix UI + Tailwind, deploy Vercel.
- Auth: Firebase Auth/custom claims.
- Fila/automação: BullMQ/Redis presente no backend; disparo de campanha principal ainda roda no processo Express.
- WhatsApp/Evolution: instâncias por tenant em `lead_client_evolution_instances`.
- IA: Groq para campanhas/chatbot/helpdesk onde configurado.

## Memórias do repo

- `_memoria/`: memória operacional ativa do orquestrador.
  - `contexto-vivo.md`: estado atual.
  - `pendencias.md`: fila aberta e dívidas.
  - `decisoes.md`: append-only de decisões.
  - `aprendizados.md`: append-only de lições.
  - `indice-projeto.md`: índice atual do repo, criado/atualizado em 2026-06-13.
- `.cerebro/`: vault/estrutura antiga de segundo cérebro; existe e contém conhecimento histórico, mas estava defasada desde maio. Atualizar no mínimo `.cerebro/_memory/current-state.md` quando houver mudança grande de estado.

## Produto atual

Vexo OS se organiza em dois blocos comerciais no sidebar:

- **Máquina de Vendas**: dashboard, leads, conversas, agentes IA, inteligência comercial, chatbot, follow-up.
- **Máquina de Disparos**: chips WhatsApp/conexões, envios por planilha, disparos, aquecimento, relatórios.

Estado real das telas de Disparos:

- `Conexoes.tsx`: funcional; permite selecionar tenant e reutiliza `EvolutionChipsPanel` para gerenciar chips, QR/provisionamento manual, cota diária e estado frio/aquecido.
- `Relatorios.tsx`: funcional v1; gráfico de envios por dia e por chip nos últimos 14 dias, via `/api/reports/evolution-usage`.
- `Disparos.tsx`: placeholder "Em construção".
- `Aquecimento.tsx`: placeholder "Em construção".

## Backend: módulos importantes

- `backend/src/server.js`: API principal, auth, tenants, Evolution, campanhas, relatórios, memória de conversa e rotas legadas.
- `backend/src/campaign-outbound.js`: sequência de disparo, health-check de Evolution, delay, resumo e callbacks por lead.
- `backend/src/campaign-ai.js`: sugestões de campanha com IA.
- `backend/src/chatbot-ai-engine.js` e `backend/src/hardcoded-chatbot*.js`: chatbot/template/persistência.
- `backend/src/followup/*`: módulo follow-up com rotas, serviço, worker, analytics e fila.
- `backend/src/onboarding/*`: onboarding.
- `backend/src/pgSupabaseCompat.js`: compatibilidade para Postgres/Supabase.
- `backend/src/accessGuards.js`, `tenantScope.js`, `userAccessScope.js`, `notificationScope.js`: autorização, escopo e permissões.

## Frontend: módulos importantes

- `frontend/src/App.tsx`: rotas principais.
- `frontend/src/components/AppSidebar.tsx`: navegação modular Vendas x Disparos + Sistema/Admin.
- `frontend/src/components/EvolutionChipsPanel.tsx`: painel compartilhado de chips Evolution.
- `frontend/src/pages/Tenants.tsx`: gestão admin de empresas/tenants.
- `frontend/src/pages/Conexoes.tsx`: gestão de chips por tenant.
- `frontend/src/pages/Relatorios.tsx`: relatório de uso por chip.
- `frontend/src/pages/LeadImports.tsx`: planilhas/campanhas/envios.
- `frontend/src/pages/Followup*.tsx`: módulo follow-up.
- `frontend/src/pages/Chatbot*.tsx`: chatbot, configurações, docs e Kanban.
- `frontend/src/hooks/useLeadClients.ts`: empresas, settings n8n/Evolution e mutations de instância.
- `frontend/src/hooks/useCampanhas.ts`: campanhas.
- `frontend/src/hooks/useReports.ts`: relatórios Evolution.

## Banco e migrations

- Diretório canônico de migrations para deploy: `backend/supabase/migrations/`.
- `frontend/supabase/migrations/` existe, mas está defasado e menor; sincronizar com `node scripts/sync-supabase-assets.mjs` apenas quando o fluxo exigir.
- Migration mais recente confirmada: `backend/supabase/migrations/20260612060000_dispatch_runs_lead_claim.sql`.
- Essa migration estende `campaign_dispatch_runs` com `lead_id`, `claimed_at`, status `claimed` e índice único `(dispatch_id, lead_id)` para evitar reenvio no mesmo disparo.

## Estado das frentes recentes

- PR #122: melhoria na tela de empresas/modal/listagem, já na `main`.
- PR #121: redesign visual Direção C/Conexões/Chips/tokens, já na `main`.
- Anti-ban 3a v2: motor com cota/rotação/delay e schema memoizado está na `main`; precisa validação live final.
- 3b UI: painel de chips já foi extraído para `EvolutionChipsPanel` e aparece em `Conexoes`; faltam polimentos e validação de UX em produção.
- Relatórios v1: implementado por chip/dia.
- Defeito A anti-reenvio: correção idempotente implementada; falta gate live do mesmo disparo rodado 2x.
- LeadImports/Planilhas: primeira passada de UX em 2026-06-13 para deixar o fluxo mais linear para usuários leigos; abas viraram etapas compactas, `Disparo avulso` saiu da navegação principal, upload ganhou copy mais simples e histórico ficou com colunas menos técnicas.
- Segmentação de leads/campos de filtro: decisão de produto em 2026-06-13 é ficar no cadastro da empresa/tenant, não na criação de campanha. `LeadImports.tsx` deve manter campanha simples (base + mensagem); `Tenants.tsx` expõe o perfil de segmentação/schema da empresa.
- Criação de campanha em `LeadImports.tsx`: UI compactada em 2026-06-13 para notebook comum; reduzir cards aninhados, paddings grandes e explicações longas. Preferir chips/resumos curtos e controles em uma única superfície.
- KPIs de segmentação: devem continuar existindo, mas personalizados por empresa. Implementado `lead_client_n8n_settings.segmentation_config` (JSONB) para guardar lista de KPIs/campos por tenant; criação de empresa edita esses KPIs e campanha exibe resumo por tenant.
- Edição pós-criação de KPIs de segmentação: `Tenants.tsx` permite editar e salvar `segmentation_config` depois que a empresa já existe, via rota dedicada `/api/lead-clients/:tenantId/segmentation-config` com permissão `tenants.manage`.
- Padrão visual global: em 2026-06-13 foi aplicado “zoom reverso” no frontend. `html` usa 15px no desktop, e `PageShell`, `Card`, `Button`, `Input`, `Select`, `Textarea`, `Dialog` e `AlertDialog` foram compactados. Próximas telas devem manter densidade menor para notebook comum.
- Paginação/densidade: tabelas globais foram compactadas (`TableHead`/`TableCell` menores). `Tenants.tsx` pagina empresas em 8 por página e `Leads.tsx` pagina leads em 25 por página para evitar scroll infinito em telas com listas/tabelas.

## Regras operacionais permanentes

- Nunca gravar segredos em `_memoria/`, `.cerebro/`, docs ou código.
- Se o cérebro e o repo divergirem, o repo vence e a memória deve ser corrigida.
- Antes de planejar feature nova, rodar `git pull --ff-only origin main` e auditar commits recentes.
- Para frontend, `vite build` não substitui type-check. Usar `npx tsc --noEmit -p frontend/tsconfig.app.json` ou comando equivalente no contexto correto.
- Para migrations, não colocar `ALTER TABLE` no caminho quente. Se existir `ensure*`, precisa ser memoizado ou migrado para boot/migration.
