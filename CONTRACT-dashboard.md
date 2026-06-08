# CONTRACT.md — Fonte de verdade da correção de dados + redesign do Dashboard

> **Status:** Fase 0 concluída (diagnóstico + contrato). Gate liberado para Fase 1.
> **Gerado por:** orquestrador (sessão de diagnóstico, Opus). **Executado por:** Terminais A/B em Sonnet 4.6.
> **Escopo:** empresa de referência = **Umuarama MatCon** (`client_id` runtime, tabela `leads_umuarama_matcon`).
> **Regra:** os dois terminais da Fase 1 leem deste arquivo. Não re-investigar o repo.

---

## 0. TL;DR da causa-raiz

**Causa-raiz confirmada: (c) output não mapeado + divergência de tabela/tenant.**
Não é (a) pré-registro sem update isolado, nem (b) extractor que só dispara em lead que avança (esses contribuem em segundo plano). O problema central é **mapeamento de campos** somado a **duas rotas de escrita gravando em tabelas diferentes**, enquanto o dashboard lê apenas uma.

Sintoma (leads sem nome/cidade/perfil) é explicado integralmente por:

1. **Chatbot SPIN ao vivo não persiste identidade.**
   `backend/src/hardcoded-chatbot-persistence.js → persistChatbotProgress()` grava em `leads_<clientId>` apenas:
   `status_conversa, spin_fase, status, mensagem, finalizado, dados (JSONB)` + colunas individuais
   `interesse, objetivo, prazo, melhor_horario, credito, parcela, lance_entrada_fgts`.
   **Nunca grava `nome`, `cidade`, `estado`, `tipo_cliente`, `qualificacao`** em coluna. `cidade` existe em `collectedData`/`dados` (o extractor lê em `hardcoded-chatbot-extractor.js:28`) mas não é promovida a coluna. `nome` não é coletado em nenhum passo do SPIN.

2. **O `lead-webhook` grava na tabela ERRADA para multi-tenant.**
   `frontend/supabase/functions/lead-webhook/index.ts` faz `.from("leads")` **hardcoded** (linhas 67, 117, 150, 214). Na ação `finalize` ele *sim* escreve `nome, tipo_cliente(perfil), cidade, estado, qualificacao` — mas na tabela **base `leads`**, não em `leads_<clientId>`. O dashboard (CI) lê `leads_<clientId>` (`registerAllDomainRoutes.js:1845`), logo nunca vê esses dados para tenants que não sejam o legado `infinie`.

3. **`temperatura` não tem coluna canônica.**
   - Escrita: chatbot grava QUENTE/MORNO/FRIO na coluna **`status`** (via `qualifyLead()`).
   - Leitura: dashboard `detectTemperature()` (`commercial-intelligence.js:84`) lê a coluna **`qualificacao`** procurando "quente/morno/frio".
   - Resultado: a temperatura escrita nunca é lida; e `status` fica sobrecarregado com dois vocabulários (estado do funil *e* temperatura).

4. **"Qualificado" está definido em 3+ lugares com regras diferentes** (ver §4).

> Caminhos de **importação** (planilha/CSV e import do "chat outlier" em `server.js`) **mapeiam `nome`/`cidade` corretamente** para `leads_<clientId>` (`server.js:1870-1910`, `:4286-4408`, `:4890`). Por isso leads importados aparecem preenchidos e leads de **conversa ao vivo** não — pista forte de que os 4 leads frios de Umuarama vieram do caminho de conversa/webhook, não de import.

---

## 1. Mapa do caminho de escrita (ponta a ponta)

```
Evolution/WhatsApp ──► n8n ──┬─► [Edge] lead-webhook (action=create)   ──► public.leads        (nome, status="novo")          ❌ tabela base
                             │                                                                   ❌ não escreve em leads_<clientId>
                             └─► [Edge] lead-webhook (action=finalize) ──► public.leads (UPSERT) (nome, tipo_cliente, cidade,
                                                                                                   estado, status="qualificado",
                                                                                                   qualificacao)                 ❌ tabela base

WhatsApp (conversa) ──► backend chatbot (hardcoded-chatbot) ──► persistChatbotProgress()
                                                              ──► leads_<clientId> (INSERT/UPDATE por client_id+telefone)
                                                                  grava: status_conversa, spin_fase, status(QUENTE/MORNO/FRIO),
                                                                         mensagem, finalizado, dados(JSONB),
                                                                         interesse, objetivo, prazo, melhor_horario,
                                                                         credito, parcela, lance_entrada_fgts
                                                                  ❌ NÃO grava: nome, cidade, estado, tipo_cliente, qualificacao

Import planilha/CSV ──► server.js (validate*Record) ──► leads_<clientId> (INSERT)
                                                         ✅ grava: nome, cidade, estado, telefone, qualificacao, ...

Dashboard (RESUMO/FUNIL/OPERACAO)
  └─ GET /api/commercial-intelligence  (registerAllDomainRoutes.js:~1830)
       └─ SELECT ... FROM leads_<clientId> WHERE client_id=<clientId>     ◄── LÊ AQUI
          colunas: id, telefone, nome, tipo_cliente, faixa_consumo, cidade, estado, status,
                   bot_ativo, historico, data_hora, qualificacao, created_at, updated_at,
                   source_campaign_id, lead_score, potential_contract_value,
                   first_contact_at, qualified_at, closed_at, lead_temperature, lead_origin, behavior_meta
       └─ buildCommercialIntelligencePayload()  (commercial-intelligence.js:353)
```

**Pontos onde os campos DEVERIAM ser gravados e não são (no caminho de conversa ao vivo):**

| Campo | Onde existe a fonte | Onde deveria ser gravado | Hoje |
|------|----------------------|--------------------------|------|
| `nome` | `body.nome` (n8n/pushName) | `leads_<clientId>.nome` | só vai p/ base `leads` (create/finalize); nunca p/ `leads_<clientId>` na conversa |
| `cidade` | `collectedData.cidade` / `body.cidade` | `leads_<clientId>.cidade` | só em `dados` JSON; webhook escreve em base `leads` |
| `estado` | `collectedData.estado` / `body.estado` | `leads_<clientId>.estado` | idem cidade |
| `tipo_cliente` (perfil) | `body.perfil` / SPIN | `leads_<clientId>.tipo_cliente` | só base `leads` no finalize |
| `temperatura` | `qualifyLead()` → QUENTE/MORNO/FRIO | coluna canônica (ver §3) | escrita em `status`, lida de `qualificacao` |
| `qualificacao`/`qualificado` | regra de negócio | `leads_<clientId>.qualificacao` | não escrita na conversa |

---

## 2. Contagem por campo (script read-only) — PENDENTE de execução

⚠️ **Não executado nesta sessão:** só há credenciais Supabase *placeholder* (`frontend/.env`: `VITE_SUPABASE_URL=https://placeholder...`). Backend `SERVICE_ROLE_KEY` não disponível localmente.

**Terminal A deve rodar** `scripts/diagnose-leads-fill.sql` no Supabase (SQL editor com service role) ou `scripts/diagnose-leads-fill.mjs` com env real, e **colar o resultado abaixo** antes de implementar.

Preencher:

| Campo | Total leads | Preenchidos | Nulos | % preenchido |
|------|-------------|-------------|-------|--------------|
| nome | | | | |
| cidade | | | | |
| tipo_cliente (perfil) | | | | |
| status (temperatura) | | | | |
| qualificacao | | | | |
| client_id | | | | |

> Expectativa, dado o diagnóstico: `nome`/`cidade`/`tipo_cliente` ~majoritariamente nulos nos leads de conversa; `interesse`/`objetivo` mais preenchidos. Confirmar.

---

## 3. CONTRATO DE DADOS CANÔNICO (o que o dashboard PODE assumir)

Tabela de leitura do dashboard: **`leads_<clientId>`** (NUNCA a base `leads`). O contrato abaixo é o alvo após a correção do Terminal A.

| Campo (coluna) | Tipo | Sempre preenchido? | Regra de quando é populado |
|----------------|------|--------------------|----------------------------|
| `id` | uuid | ✅ sim | gerado no insert |
| `client_id` | text | ✅ sim | identidade do tenant; = nome da tabela `leads_<client_id>` |
| `telefone` | text (E.164 digits, ex. `55449...`) | ✅ sim | normalizado no insert (1º contato) |
| `nome` | text | ⚠️ best-effort | capturado do `pushName`/`body.nome` no 1º contato; fallback "Sem nome" só na UI, **nunca** gravar "Sem nome" no banco (manter null) |
| `cidade` | text | ⚠️ best-effort | promovido de `collectedData.cidade`/`body.cidade` assim que disponível (já no 1º turno se vier) |
| `estado` | text | ⚠️ best-effort | idem cidade |
| `tipo_cliente` (perfil) | text | ⚠️ quando qualificado | de `body.perfil`/SPIN; populado quando o perfil é determinado |
| `status` | text (estado do funil) | ✅ sim | **apenas** estado do funil: `novo` → `em_atendimento` → `qualificado` → `convertido`/`perdido`. **NÃO** usar para temperatura |
| `temperatura` | text enum | ⚠️ após sinal | **coluna canônica nova/normalizada** (ver decisão abaixo): `quente`/`morno`/`frio`/`sem-sinal` |
| `qualificacao` | text/bool-coerce | ⚠️ quando avaliado | resultado da regra única de §4; coerção via `parseLeadQualificacaoBoolean` |
| `interesse`, `objetivo`, `prazo`, `melhor_horario` | text | ⚠️ progressivo | preenchidos conforme SPIN avança |
| `dados` | jsonb | ✅ sim | backup histórico de tudo coletado |
| `created_at`, `updated_at`, `data_hora` | timestamptz | ✅ sim | timestamps |

### Decisão de schema — `temperatura`

Hoje QUENTE/MORNO/FRIO é gravado em `status` e lido de `qualificacao` (inconsistente). **Decisão canônica:**

- **Coluna dedicada `temperatura TEXT`** em `leads_<clientId>` (migration idempotente `ADD COLUMN IF NOT EXISTS`, igual ao padrão de `20260516100000_normalize_leads_individual_columns.sql`).
- Valores canônicos (minúsculo, sem acento de caixa): `quente` | `morno` | `frio` | `sem-sinal`.
- `status` volta a significar **só** estado do funil.
- O dashboard (`detectTemperature`) passa a ler `temperatura` (não mais `qualificacao`). Terminal A escreve; Terminal B lê. **Backfill:** Terminal A migra QUENTE/MORNO/FRIO que hoje estão em `status` para `temperatura` e normaliza `status`.

---

## 4. Definição ÚNICA e CANÔNICA

> Hoje há ao menos 3 implementações divergentes: `commercial-intelligence.js:isQualifiedStatus`, `hardcoded-chatbot-persistence.js:qualifyLead`, `leadQualificacaoBoolean.js:parseLeadQualificacaoBoolean`, + `DEFAULT_SETTINGS.metricRules`. **Terminal A centraliza tudo num único helper** (ex.: `backend/src/leadClassification.js`) e remove as duplicatas.

### 4.1 Temperatura — `classifyTemperature(lead) → "quente"|"morno"|"frio"|"sem-sinal"`

Baseado nos dados coletados (não no avanço da conversa):

- **quente**: interesse explícito (`interesse` ~ "sim") **E** crédito bom/excelente **E** ≥ 6 campos de `dados` preenchidos.
- **morno**: ≥ 4 campos de `dados` preenchidos (sinal parcial).
- **frio**: 1–3 campos, ou interesse negado.
- **sem-sinal**: 0 campos coletados / sem engajamento (substitui o "FRIO" que hoje mascara leads que nunca responderam — ver hipótese (b)).

(Equivalência com o legado: QUENTE→quente, MORNO→morno, FRIO→frio, vazio→sem-sinal.)

### 4.2 Qualificado — `isQualified(lead) → boolean`

Lead é **qualificado** quando o `status` do funil é `qualificado` (ou posterior: `convertido`), **OU** `qualificacao` coerce-true via `parseLeadQualificacaoBoolean`. Threshold de score (`qualificationThreshold=60`) permanece para ranking, **não** para o booleano. Esta é a única fonte; `isQualifiedStatus` e variantes passam a delegar para este helper.

### 4.3 Funil canônico (para o gráfico do Terminal B)

Prompt pede **Entrada → Qualificado → Fechado**. Mapear do payload CI:
- **Entrada** = `overview.charts.funnel[stage="Totais"]` (total de leads).
- **Qualificado** = `isQualified` (stage "Qualificados").
- **Fechado** = conversões won (stage "Fechados").
(Os estágios intermediários "Abordados/Respondidos" do payload ficam fora do gráfico de 1 etapa do RESUMO; podem aparecer no FUNIL detalhado.)

---

## 5. Divisão de arquivos da Fase 1 (sem colisão)

**Terminal A (backend/dados) — pode tocar:**
- `backend/src/hardcoded-chatbot-persistence.js` (mapear nome/cidade/estado/tipo_cliente/temperatura)
- `frontend/supabase/functions/lead-webhook/index.ts` (rotear para `leads_<clientId>`; manter compat base `leads` se necessário)
- `backend/src/leadClassification.js` (NOVO helper único — temperatura + qualificado)
- `backend/src/commercial-intelligence.js` (passar a ler `temperatura`; delegar qualificação ao helper) — ⚠️ contém lógica de leitura; coordenar: Terminal B **não** edita este arquivo.
- nova migration `frontend/supabase/migrations/20260603xxxxxx_add_temperatura_to_leads.sql`
- `scripts/diagnose-leads-fill.{sql,mjs}` (diagnóstico/teste)
- testes em `backend/src/test/`

**Terminal B (frontend/dashboard) — pode tocar:**
- `frontend/src/pages/Dashboard.tsx` e/ou `frontend/src/pages/CommercialIntelligence.tsx`
- `frontend/src/components/CommercialIntelligenceContent.tsx`
- componentes de UI do dashboard (`KpiCard`, `DashboardPanel`, gráficos)
- `frontend/src/hooks/useCommercialIntelligence.ts` (apenas tipos/consumo; não mexer no backend)
- tokens CSS (`frontend/src/index.css`, `tailwind.config.ts`)

**Fronteira crítica:** `commercial-intelligence.js` é do **Terminal A**. O Terminal B consome o JSON via `useCommercialIntelligence`; se precisar de campo novo no payload, **registrar aqui** e A implementa.

---

## 6. Restrições herdadas do prompt

- Não alterar navegação lateral nem seletor de empresa.
- Não adicionar lib de gráfico nova (reusar a existente).
- Tokens via CSS vars; sem hex hardcoded; sem gradiente de fundo nos cards; um accent por estado.
- Empty states sem "0%" nu; esconder dimensões 100% vazias; touch ≥ 44px; responsivo 3→1 col.
- Diffs cirúrgicos; não reescrever o que funciona.

---

## 7. Estado final (preencher na Fase 2)

- [ ] Contagem pós-fix colada em §2 com taxa de preenchimento maior.
- [ ] Lead de teste ponta a ponta com nome/cidade/perfil/temperatura.
- [ ] Sem registro-fantasma duplicado.
- [ ] Helper único de qualificado/temperatura em uso; duplicatas removidas.
</content>
</invoke>
