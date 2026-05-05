# Schema Map - Runtime vs Migrations

## Objetivo

Mapear as tabelas reais usadas pelo CRM, comparar com as migrations versionadas e listar divergencias que impactam tenant, contratos e reproducao de ambiente.

---

## 1. Tabelas usadas em runtime

| Tabela | Usada por backend | Usada por Edge Function | Migration versionada | Chave de tenant | Campos criticos | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `leads_clients` | Sim | Nao | Sim (`20260304000001`) | `id` | `id`, `name` | Ok, mas usada como slug textual e nao UUID |
| `leads` | Sim | Sim | Sim (`20260304000001`) | `client_id` | `id`, `client_id`, `telefone`, `status`, `qualificacao` | Drift de colunas e semantica |
| `lead_conversations` | Sim | Sim | Sim (`20260309000003`) | Nao tem `client_id` | `telefone`, `conversation_compressed`, `created_at` | Alto risco de ambiguidade cross-tenant por telefone |
| `lead_imports` | Sim | Nao | Sim (`20260315000004`) | `client_id` | `id`, `client_id`, `source_name` | Ok |
| `lead_import_items` | Sim | Sim | Sim (`20260315000004`) | `client_id` | `import_id`, `client_id`, `telefone`, `skip_reason` | Drift no uso de `skip_reason` e no conceito de "disparado" |
| `access_profiles` | Sim | Nao | Sim (`20260412000007`) | Nao aplicavel | `key`, `role`, `permissions` | Ok para leitura, sem CRUD completo no backend |
| `campaigns` | Sim | Nao | **Parcial** (`20260414000008`, `20260430000011`) | `client_id` | `id`, `client_id`, `webhook_url`, `webhook_token`, `phones`, `status` | Falta migration explicita de criacao na serie atual |
| `notifications` | Sim | Sim | **Parcial** (policy em `20260221031218`) | Nao tem `client_id` | `id`, `type`, `title`, `read` | Tabela usada sem isolamento por tenant |
| `n8n_error_logs` | Sim | Sim | **Parcial** (policy em `20260221031218`) | Nao tem `client_id` | `execution_id`, `workflow_name`, `message` | Criacao nao aparece na serie atual |
| `crm_consultants` | Sim | Nao | Sim (`20260420000009`) | `client_id` | `id`, `client_id`, `name`, `available` | Ok |
| `lead_messages` | Sim | Nao | Sim (`20260420000009`) | `client_id` | `id`, `lead_id`, `campaign_id`, `phone`, `direction` | Ok |
| `lead_assignments` | Sim | Nao | Sim (`20260420000009`) | `client_id` | `id`, `lead_id`, `consultant_id`, `assignment_status` | Ok |
| `lead_conversions` | Sim | Nao | Sim (`20260420000009`) | `client_id` | `id`, `lead_id`, `consultant_id`, `conversion_status` | Ok |
| `lead_distribution_rules` | Sim | Nao | Sim (`20260420000009`) | `client_id` | `id`, `client_id`, `distribution_mode`, `active` | Ok |
| `analytics_insights` | Sim | Nao | Sim (`20260420000009`) | `client_id` | `id`, `title`, `severity`, `generated_at` | Ok |
| `commercial_intelligence_settings` | Sim | Nao | Sim (`20260420000010`) | `client_id` | `client_id`, `qualification_threshold`, `sla_minutes` | Ok |
| `metric_snapshots` | Referenciada em delete de tenant | Nao | **Nao encontrada** | `client_id` | desconhecido | Referencia orphan no purge de tenant |

---

## 2. Divergencias principais entre banco esperado e migrations

| Tema | Migrations/documentacao | Runtime real | Gravidade | Observacao |
| --- | --- | --- | --- | --- |
| Criacao de `campaigns` | So aparecem migrations de alteracao (`20260414000008`, `20260430000011`) | Backend usa CRUD completo de `campaigns` | Critico | Nao da para reconstruir ambiente limpo com confianca |
| Criacao de `notifications` | `20260221031218` aplica RLS/policy | Backend e function usam leitura/escrita | Critico | A criacao da tabela nao aparece na serie atual |
| Criacao de `n8n_error_logs` | `20260221031218` cria policy | Backend e function fazem `upsert` | Critico | Tabela nao esta versionada na serie atual |
| Campos legados de `leads` | Migration cria `conta_energia`, `bot_ativo`, `historico` | Docs mais novas dizem que parte disso nao faz mais parte do fluxo | Alto | Runtime ainda consulta `bot_ativo` e `historico` em revenue/commercial intelligence |
| `lead_conversations` sem tenant | Migration nao possui `client_id` | Backend e n8n consultam por telefone | Alto | Mesmo telefone em duas empresas vira ambiguidade operacional |
| `access_profiles` | Migration existe | Frontend opera como se houvesse CRUD completo | Medio | Backend expoe so listagem |
| `metric_snapshots` | Nao encontrada em migration lida | Backend tenta limpar por tenant ao excluir empresa | Medio | Sinal de schema fora do repo ou codigo legado |

---

## 3. Campos criticos do dominio

### 3.1 Tenant / empresa

| Campo | Onde aparece | Observacao |
| --- | --- | --- |
| `client_id` | tabelas de leads, imports, campaigns, commercial intelligence | Hoje e a chave operacional dominante no banco |
| `id` em `leads_clients` | banco | Funciona como slug textual da empresa (`infinie`) |
| `tenantId` | claims e params | Alias de aplicacao, nao padrao de banco |
| `companyId` | claims | Alias adicional |

**Recomendacao:** adotar `client_id` como identificador de tenant no dominio de persistencia e tratar `tenantId/companyId/clientId` apenas como aliases de entrada a serem normalizados.

### 3.2 Usuario

| Campo | Onde aparece | Observacao |
| --- | --- | --- |
| `uid` | Firebase / backend | Identificador real de usuario |
| `email` | Firebase / frontend | Tambem usado em logs e ownership |
| custom claims | backend/frontend | Hoje sao a fonte de autorizacao, mas com varios aliases de tenant |

### 3.3 Lead

| Campo | Onde aparece | Observacao |
| --- | --- | --- |
| `id` | `leads`, `lead_messages`, `lead_assignments`, `lead_conversions` | Chave principal correta |
| `lead_id` | mensagens, atribuicoes, conversoes | Relacao operacional principal |
| `telefone` | `leads`, `lead_conversations`, `lead_import_items`, payloads n8n | Campo com maior risco de drift |
| `qualificacao` | `leads`, docs do workflow, commercial intelligence | Campo com semantica instavel |

### 3.4 Campanha

| Campo | Onde aparece | Observacao |
| --- | --- | --- |
| `id` | `campaigns` | Chave principal |
| `campaign_id` | `lead_messages`, `lead_assignments`, `lead_conversions` | Relacao importante |
| `phones` | `campaigns` | Usado como marcador de dispatch e fonte de leads disparados |
| `webhook_url`, `webhook_token` | `campaigns` | Segredos operacionais na tabela |

### 3.5 Permissoes

| Campo | Onde aparece | Observacao |
| --- | --- | --- |
| `permissions` | `access_profiles`, Firebase claims | Fonte de acesso granular |
| `allowedViews` | claims / frontend | Mistura controle de navegacao e acesso de produto |
| `scopeMode` | claims / backend | Controla se o usuario ve todos os clientes ou so os atribuidos |

---

## 4. Contratos inconsistentes

| Campo | Inconsistencia | Evidencia | Gravidade |
| --- | --- | --- | --- |
| `telefone` | `validators.js` aceita `10-11` digitos em algumas validacoes, outros contratos aceitam ate `13`, runtime normaliza para `55...` | `backend/src/validators.js`, `backend/src/server.js`, docs do workflow | Critico |
| `qualificacao` | ora e resumo textual do lead, ora e usada como sinal de status/qualificacao | `docs/workflow-n8n.md`, `docs/supabase-functions.md`, `backend/src/server.js` | Alto |
| `client_id` | backend de validacao exige UUID em alguns schemas, banco usa slug textual (`infinie`) | `backend/src/validators.js`, `20260304000001_create_leads_tables.sql` | Critico |
| `company_id` | aparece em claims, nao como padrao de persistencia | `backend/src/server.js` | Medio |
| `tenant_id` | aparece em claims e params, nao no schema principal | `backend/src/server.js`, hooks do frontend | Medio |
| `notifications` | docs apontam `notifications-api` na edge; frontend atual consome backend `/api/notifications` | `docs/supabase-functions.md`, `frontend/src/hooks/useNotifications.ts`, `backend/src/server.js` | Alto |
| `password/senha` | contratos de mensagem divergem entre frontend e testes; backend so aplica regra minima de tamanho | `frontend/src/lib/validationSchemas.ts`, `frontend/src/test/security.test.ts`, `backend/src/server.js` | Medio |

---

## 5. RLS e isolamento por tenant

| Tabela | Estado atual | Leitura da auditoria |
| --- | --- | --- |
| `leads` | RLS habilitada com policy de leitura ampla para `anon, authenticated` | Nao isola por tenant no banco |
| `leads_clients` | Leitura ampla | Nao isola por tenant no banco |
| `lead_conversations` | RLS deny-all | Depende de service role / backend |
| `lead_imports` | RLS deny-all | Depende do backend |
| `lead_import_items` | RLS deny-all | Depende do backend |
| `access_profiles` | RLS deny-all | Dependencia total do backend |
| revenue ops / commercial intelligence tables | RLS deny-all | Dependencia total do backend |
| `notifications` | RLS deny-all | Mas backend atual lista/atualiza sem `client_id` |
| `n8n_error_logs` | policy deny-all | Sem criacao versionada clara |

**Leitura pratica:** o isolamento hoje e uma responsabilidade de aplicacao, nao do banco. Isso e aceitavel por enquanto, mas exige rotas muito rigorosas e contrato unico de tenant.

---

## 6. Primeira sequencia de correcoes recomendada

1. fechar a verdade do schema de `campaigns`, `notifications` e `n8n_error_logs`
2. decidir se `lead_conversations` continua sem `client_id` ou se precisa migracao
3. normalizar `client_id` como identificador oficial no backend
4. alinhar validadores para aceitar o formato real de `client_id`
5. remover docs que indiquem flows ou contratos divergentes do runtime
