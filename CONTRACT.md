# CONTRACT.md — Vexo OS · Máquina de Vendas × Máquina de Disparos

> Contexto compartilhado entre todas as sessões/etapas. Não apagar entre tarefas.
> Workflow: Opus organiza/analisa, Sonnet executa. Dev solo: Conrado.

## Produto
Vexo OS — CRM + automação comercial para PMEs brasileiras.

## Objetivo estratégico (o "porquê")
Dividir o produto em DOIS módulos de topo, com navegação independente, e criar
as funções que faltam para ele virar simultaneamente:
1. **MÁQUINA DE VENDAS**  → CRM + Agentes IA (qualificar, atender, follow-up, pipeline)
2. **MÁQUINA DE DISPAROS** → outreach em massa (multi-chip, cota por número, anti-ban, aquecimento)

**Ponte entre os módulos:** lead que RESPONDE um disparo entra na Máquina de
Vendas e um chatbot assume. O handoff sempre ocorre; muda só o prompt:
- Campanha "Só Disparo" → chatbot padrão de qualificação.
- Campanha "Com Agente IA" → chatbot usa o prompt da campanha.

## Diferencial competitivo (validado por pesquisa de mercado)
Concorrentes BR limitam a 5–10 chips conectados. Meta do Vexo: 20+ (a Evolution
é gratuita e conecta ilimitado). Compradores já confirmados: Umuarama Materiais
(base pronta) e Liv Pub (23k+ leads).

## Stack (CONFIRMAR inspecionando o repo antes de assumir nomes)
- Frontend: React + TypeScript, deploy na Vercel
- Backend: Node/TypeScript, serviço `bk-vexo` no Easypanel (porta 3001)
- Banco: **PostgreSQL** (`db-vexo`, database `vexo-data`, user `dbvexo`) no Easypanel.
  Credenciais já fornecidas ao Claude Code. NÃO usa Supabase como serviço.
  ATENÇÃO: o CÓDIGO ainda está todo NOMEADO como "Supabase" (variáveis, helpers,
  nomes) — é rótulo herdado apontando para o PostgreSQL. O Luiz tentou renomear,
  commitou numa branch e REVERTEU por medo de quebrar as migrations. Portanto:
  trate "Supabase" no código como sinônimo de "a conexão PostgreSQL atual".
  NÃO faça renomeação ampla Supabase→Postgres agora (já provou que quebra).
- Filas: BullMQ + Redis (worker já deployado no Easypanel)
- WhatsApp: Evolution API (instância "Vexo Assistent" já existe)
- IA: Groq (llama-3.1-8b-instant)

## REGRAS INEGOCIÁVEIS
1. ANTES de escrever código, inspecione o repo e descreva em até 5 bullets como
   o fluxo atual de campanha/disparo/conexão funciona HOJE. NÃO assuma nomes de
   arquivo/tabela — confirme.
2. **Multi-tenant:** todo dado novo (conexão, campanha, lote, log) isolado por
   tenant/cliente. Nunca leitura cruzada entre contas. Toda query filtra por tenant.
3. **QR/instância via API REST direta da Evolution.** NÃO usar automação de
   navegador/headless. Se faltar endpoint na Evolution, pare e me avise antes de
   improvisar.
4. **Anti-ban embutido desde o início:** disparo em massa nasce com cota por
   número + lote + delay (idealmente aleatório) + tratamento de desconexão.
   Trate banimento de chip como evento ESPERADO, não exceção fatal (reconectar,
   marcar instância como banned, redistribuir cota restante).
5. **LGPD:** toda base importada registra origem; todo disparo respeita opt-out.
6. **Segredos** (credenciais PostgreSQL, PAT, tokens) nunca em arquivo
   versionado nem hardcoded. Variável de ambiente + validação na inicialização.
   (O incidente anterior de key vazada já foi resolvido; manter a higiene.)
7. Mudanças incrementais e testáveis. Não quebrar o fluxo de campanha existente
   durante a migração.
8. **Teste com evidência real, não afirmação.** Cada terminal é responsável por
   RODAR seu próprio teste no ambiente e COLAR a saída real (log, retorno da API,
   resultado da query, print do comportamento). Não escreva "funciona" ou
   "testado com sucesso" sem mostrar a evidência. Se não conseguiu rodar o teste,
   diga isso explicitamente e por quê — não presuma sucesso. O orquestrador
   valida o relato contra o critério de aceite; ele NÃO roda o código e não deve
   afirmar que testou.

## ENTREGÁVEL DE CADA ETAPA
- Código + migration (se mudar schema)
- Lista de arquivos tocados
- Como testar manualmente (passo a passo) + **a saída real do teste colada como evidência**
- Riscos/limitações conhecidos

## ENTIDADE: Conexão/Instância Evolution

> **Atualizado 2026-06-13 após pull da `main` (`93653a7`).** A entidade oficial
> continua sendo `lead_client_evolution_instances`. A migration `connections`
> criada pelo T1 está **DESCARTADA** — não aplicar. O wrapper T2 também está
> **DESCARTADO** — os endpoints atuais já cumprem esse papel.

### Tabela oficial: `public.lead_client_evolution_instances`

Criada/garantida por DDL inline memoizado em `backend/src/server.js`.
Chave de tenant: **`client_id`** (não `tenant_id`).

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `UUID` | `gen_random_uuid()` |
| `client_id` | referência ao tenant | FK; toda query filtra por este campo |
| `name` | `TEXT` | Nome da instância/chip no Vexo/Evolution |
| `dispatch_webhook_url` | `TEXT` | Endpoint Evolution usado no envio |
| `dispatch_webhook_token` | `TEXT` | Token mascarado no frontend; nunca registrar em memória |
| `inbound_bearer_token` | `TEXT` | Token inbound legado |
| `active` | `BOOLEAN` | `true` = instância disponível para disparo |
| `is_default` | `BOOLEAN` | no máximo uma default por `client_id` |
| `chip_state` | `TEXT` | `cold` ou `warm` para cota anti-ban |
| `daily_limit_override` | `INTEGER` | override opcional da cota diária |
| (demais colunas) | ver DDL em `server.js` | auditoria/criação/atualização |

**Índices:**
- `idx_lead_client_evolution_default` — único por `client_id` quando `is_default = true`.
- `idx_lead_client_evolution_client` — `(client_id, active)`.

**Endpoints já existentes (não recriar):**
- `GET  /api/lead-clients/:tenantId/evolution-instances` — lista instâncias do tenant
- `POST /api/lead-clients/:tenantId/evolution-instances` — cria instância
- `POST /api/lead-clients/:tenantId/evolution-instances/:instanceId/provision` — provisiona/QR
- `DELETE /api/lead-clients/:tenantId/evolution-instances/:instanceId` — remove

**Integração em campanhas/disparos:**
- O envio usa configurações do tenant/instância Evolution resolvidas pelo backend.
- `campaign_dispatch_runs` agora também é usado como claim idempotente por `(dispatch_id, lead_id)`.
- `evolution_instance_daily_usage` alimenta cota/relatório por chip.

**Caminho de QR (atenção — duplo, risco):**
- **Novo (REST Evolution):** `server.js` — provisionamento chama API REST da Evolution e retorna `qrcode.base64`.
- **Legado (whatsapp-web.js):** `backend/src/whatsapp.js` — lib `qrcode`, `client.on("qr")`.
- Os dois coexistem. E2 do roadmap resolve isso.

**Invariantes que continuam valendo:**
1. Toda query inclui `client_id`. Zero exceções.
2. RLS é inefetivo (pg.Pool bypassa) — segurança depende 100% de filtro por `client_id` no código.
3. QR somente via API REST da Evolution (regra inegociável §3 acima). O caminho legado
   `whatsapp.js` deve ser isolado/removido com evidência de que não quebra (E2).

---

## ORDEM DAS ETAPAS (roadmap atualizado 2026-06-13)

| # | Etapa | Estado |
|---|---|---|
| P1 | Gate live anti-reenvio por disparo (`campaign_dispatch_runs` claim) | a validar |
| P1 | Gate live anti-ban 3a v2: cota por chip + rotação | a validar |
| P2 | Opt-out por palavra-chave | a fazer |
| P2 | Aviso de cota aos 80% | a fazer |
| P2 | Tela operacional real de `Disparos.tsx` | a fazer |
| P3 | Aquecimento de chip | aguardando regra de negócio |
| P3 | QR/status automático via webhook Evolution | a fazer |
