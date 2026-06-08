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

> **Atualizado 2026-06-08 pós-auditoria.** A entidade oficial é a tabela do Luiz
> (`lead_client_evolution_instances`), já mergeada na `main` via PR #120.
> A migration `connections` criada pelo T1 está **DESCARTADA** — não aplicar.
> O wrapper T2 (cliente Evolution) também está **DESCARTADO** — os endpoints do
> Luiz já cumprem o papel.

### Tabela oficial: `public.lead_client_evolution_instances`

Criada por DDL inline em `backend/src/server.js:1565` (Luiz, PR #120, 07/jun).
Chave de tenant: **`client_id`** (não `tenant_id`).

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `UUID` | `gen_random_uuid()` |
| `client_id` | referência ao tenant | FK; toda query filtra por este campo |
| `instance_name` | `TEXT` | Nome exato na Evolution API |
| `active` | `BOOLEAN` | `true` = instância disponível para disparo |
| (demais colunas) | ver DDL em `server.js:1565` | |

**Índices (já criados pelo Luiz):**
- `idx_lead_client_evolution_default` — `(client_id, active)`
- `idx_lead_client_evolution_client` — `(client_id)`

**Endpoints já existentes (não recriar):**
- `GET  /api/lead-clients/:tenantId/evolution-instances` — lista instâncias do tenant
- `POST /api/lead-clients/:tenantId/evolution-instances` — cria instância
- `POST /api/lead-clients/:tenantId/evolution-instances/:instanceId/provision` — provisiona/QR
- `DELETE /api/lead-clients/:tenantId/evolution-instances/:instanceId` — remove

**Integração em campanhas:**
- Coluna `evolution_instance_id UUID` adicionada em `campaign_dispatches`
  (`registerAllDomainRoutes.js:4599`).
- Validação tenant-scoped na seleção da instância (:4609–4613).

**Caminho de QR (atenção — duplo, risco):**
- **Novo (REST Evolution):** `server.js:1969–2005` — usa API REST da Evolution (`qrcode.base64`).
- **Legado (whatsapp-web.js):** `backend/src/whatsapp.js:4,90` — lib `qrcode`, `client.on("qr")`.
- Os dois coexistem. E2 do roadmap resolve isso.

**Invariantes que continuam valendo:**
1. Toda query inclui `client_id`. Zero exceções.
2. RLS é inefetivo (pg.Pool bypassa) — segurança depende 100% de filtro por `client_id` no código.
3. QR somente via API REST da Evolution (regra inegociável §3 acima). O caminho legado
   `whatsapp.js` deve ser isolado/removido com evidência de que não quebra (E2).

---

## ORDEM DAS ETAPAS (roadmap atualizado 2026-06-08)

| # | Etapa | Estado |
|---|---|---|
| E1 | **Validar** o que o Luiz fez: QR ponta-a-ponta real + multi-instância em disparo | a fazer (PRIMEIRO) |
| E2 | **Resolver caminho duplo de QR** (REST novo vs legado `whatsapp.js`) — escolher um, remover/isolar o outro com evidência de não quebrar | a fazer |
| E3 | **Anti-ban REAL**: cota por número (≤200/nº/dia) + lotes + delay aleatório + tratamento de ban/desconexão | a fazer — **MAIOR VALOR** |
| E4 | **Webhook fan-in**: confirmar/garantir que ouve TODAS as instâncias com roteamento por tenant | a fazer |
| E5 | **Nav Vendas × Disparos** (em cima dos arquivos novos do Luiz no Repo B) | a fazer |
| E6 | **Bugs UI**: scroll import (10/509) + status variação vermelho→verde (verificar se `LeadImports.tsx` reescrito pelo Luiz já resolveu) | a fazer |
| — | Aquecimento de chip | aguardando regra de negócio do Conrado |
