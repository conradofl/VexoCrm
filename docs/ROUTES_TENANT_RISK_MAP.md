# Routes Tenant Risk Map

## Objetivo

Mapear as rotas criticas do backend que tocam empresas, usuarios, leads, campanhas, agentes, notificacoes, dashboard, autenticacao e permissoes, com foco em:

- tabela usada
- filtro por empresa/tenant
- risco de tenant leak
- prioridade de correcao

Legenda de risco:

- **Critico**: pode expor ou alterar dados de outra empresa sem gate forte por `client_id`
- **Alto**: depende de combinacao de permissao e convencao; facil de errar em manutencao
- **Medio**: escopo existe, mas o contrato e fragil ou incompleto
- **Baixo**: tenant scope razoavelmente controlado

---

## 1. Empresas e tenant management

| Metodo | Endpoint | Origem | Tabelas/Fonte | Filtro por tenant | Risco | Prioridade | Observacao |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/lead-clients` | `backend/src/server.js` | `leads_clients` | Sim, por `req.authAccess.clientIds` quando aplicavel | Medio | P2 | Boa base, mas depende de claims coerentes |
| POST | `/api/lead-clients` | `backend/src/server.js` | `leads_clients` | Nao se aplica | Medio | P3 | Criacao depende de permissao `tenants.manage`, sem tenant leak direto |
| DELETE | `/api/lead-clients/:tenantId` | `backend/src/server.js` | `leads_clients` + purge em tabelas operacionais | Atua explicitamente em um tenant escolhido | Alto | P1 | Purge depende de lista manual de tabelas e inclui `metric_snapshots` nao mapeada |
| POST | `/api/lead-clients/delete` | `backend/src/server.js` | mesmas acima | Atua explicitamente em um tenant escolhido | Alto | P1 | Alias duplicado aumenta superficie |
| POST | `/api/lead-clients/:tenantId/delete` | `backend/src/server.js` | mesmas acima | Atua explicitamente em um tenant escolhido | Alto | P1 | Alias duplicado aumenta superficie |
| DELETE | `/api/lead-clients` | `backend/src/server.js` | mesmas acima | Atua explicitamente em um tenant escolhido | Alto | P1 | Alias duplicado aumenta superficie |

---

## 2. Usuarios, autenticacao e permissoes

| Metodo | Endpoint | Origem | Tabelas/Fonte | Filtro por tenant | Risco | Prioridade | Observacao |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/admin/users` | `backend/src/server.js` | Firebase Auth | Sim | Corrigido | Feito | Exige `users.view`; admin ve todos, gestor escopado ve apenas usuarios com tenant em comum |
| GET | `/api/admin/access-profiles` | `backend/src/server.js` | `access_profiles` | Nao aplicavel | Corrigido parcial | Feito | Exige `users.view`; perfis seguem globais, mas mutacoes de usuario bloqueiam elevacao indevida |
| PATCH | `/api/admin/users/:uid/access` | `backend/src/server.js` | Firebase Auth claims | Sim | Corrigido | Feito | Exige `users.manage`, valida tenant do alvo e bloqueia atribuicao fora do escopo/autoelevacao |
| POST | `/api/admin/users` | `backend/src/server.js` | Firebase Auth claims | Sim | Corrigido | Feito | Exige `users.manage` e valida o acesso solicitado antes de criar o usuario no Firebase |
| DELETE | `/api/admin/users/:uid` | `backend/src/server.js` | Firebase Auth | Sim | Corrigido | Feito | Exige `users.manage` e valida tenant do alvo antes de excluir |
| POST | `/api/client-signup` | `backend/src/server.js` | Firebase Auth + `notifications` | Nao | Medio | P2 | Nao e rota multi-tenant, mas grava notificacao global |

---

## 3. Dashboard e inteligencia comercial

| Metodo | Endpoint | Origem | Tabelas/Fonte | Filtro por tenant | Risco | Prioridade | Observacao |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/dashboard` | `backend/src/server.js` | `leads_clients`, `leads`, `lead_conversions` | Sim, `resolveAuthorizedClientId` + `eq("client_id", clientId)` | Baixo | P3 | Boa referencia de rota tenant-safe |
| GET | `/api/revenue-ops` | `backend/src/server.js` | `leads`, `campaigns`, `lead_conversations`, `lead_messages`, `lead_assignments`, `lead_conversions`, `crm_consultants`, `lead_distribution_rules`, `analytics_insights`, `lead_import_items` | Quase sempre sim | Medio | P2 | `lead_conversations` nao tem `client_id`, consulta por telefones do tenant |
| GET | `/api/commercial-intelligence` | `backend/src/server.js` | mesmas acima + `commercial_intelligence_settings` | Parcial | Alto | P1 | `lead_conversations` e lida sem filtro por tenant; confia que telefones derivados do tenant sejam suficientes |
| POST | `/api/commercial-intelligence/consultants` | `backend/src/server.js` | `crm_consultants` | Sim, `resolveAuthorizedClientId` | Baixo | P3 | Boa |
| PATCH | `/api/commercial-intelligence/consultants/:id` | `backend/src/server.js` | `crm_consultants` | Sim, carrega `client_id` atual e valida | Baixo | P3 | Boa |
| DELETE | `/api/commercial-intelligence/consultants/:id` | `backend/src/server.js` | `crm_consultants` | Sim, carrega `client_id` atual e valida | Baixo | P3 | Boa |
| POST | `/api/commercial-intelligence/distribution-rules` | `backend/src/server.js` | `lead_distribution_rules` | Sim, `resolveAuthorizedClientId` | Baixo | P3 | Boa |
| PATCH | `/api/commercial-intelligence/distribution-rules/:id` | `backend/src/server.js` | `lead_distribution_rules` | Sim, carrega `client_id` atual e valida | Baixo | P3 | Boa |
| PATCH | `/api/commercial-intelligence/assignments/:id/action` | `backend/src/server.js` | `lead_assignments` | Sim, carrega `client_id` atual e valida | Baixo | P3 | Boa |
| PUT | `/api/commercial-intelligence/settings` | `backend/src/server.js` | `commercial_intelligence_settings` | Sim, `resolveAuthorizedClientId` | Baixo | P3 | Boa |
| PATCH | `/api/commercial-intelligence/insights/:id/status` | `backend/src/server.js` | `analytics_insights` | Sim, carrega `client_id` atual e valida | Baixo | P3 | Boa |

---

## 4. Leads e importacao

| Metodo | Endpoint | Origem | Tabelas/Fonte | Filtro por tenant | Risco | Prioridade | Observacao |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/leads` | `backend/src/server.js` | `leads` | Sim, `resolveAuthorizedClientId` + `eq("client_id", clientId)` | Baixo | P3 | Boa |
| GET | `/api/lead-imports` | `backend/src/server.js` | `lead_imports` | Sim | Baixo | P3 | Boa |
| DELETE | `/api/lead-imports/:importId` | `backend/src/server.js` | `lead_imports`, `lead_import_items` | Sim, resolve pelo `client_id` do import | Baixo | P3 | Boa |
| GET | `/api/lead-import-items` | `backend/src/server.js` | `lead_import_items`, `campaigns` | Sim | Medio | P2 | Usa `campaigns.phones` para inferir dispatch; contrato operacional fragil |
| POST | `/api/lead-imports` | `backend/src/server.js` | `lead_imports`, `lead_import_items` | **Nao valida** `clientId` com `resolveAuthorizedClientId` | Critico | P0 | Usuario interno pode enviar import para qualquer `clientId` informado no body |
| POST | `/api/n8n-dispatches` | `backend/src/server.js` | `leads`, `lead_import_items`, `leads_clients` | Sim | Medio | P2 | Seguro por tenant, mas faz dispatch com segredos externos |
| GET | `/api/leads-for-dispatch` | `backend/src/server.js` | `leads`, `lead_import_items` | Nao via auth humana; depende de `requireN8nWebhookSecret` | Alto | P1 | Workflow pode buscar qualquer `clientId` valido se tiver o segredo |

---

## 5. Notificacoes, agentes e webhooks operacionais

| Metodo | Endpoint | Origem | Tabelas/Fonte | Filtro por tenant | Risco | Prioridade | Observacao |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/notifications` | `backend/src/server.js` | `notifications` | **Corrigido nesta PR** | Baixo | P4 | Filtra notificacoes por `client_id`/`tenant_id`/`company_id` ou `user_id`; notificacoes globais ficam restritas a admin interno real |
| PATCH | `/api/notifications` | `backend/src/server.js` | `notifications` | **Corrigido nesta PR** | Baixo | P4 | Valida escopo antes de marcar uma notificacao como lida; `markAllRead` de usuario nao-admin atualiza apenas notificacoes visiveis |
| POST | `/api/import-lead-infinie-n8n` | `backend/src/server.js` | `leads` | Nao via auth humana; recebe `client_id` do payload | Alto | P1 | Pode gravar em qualquer tenant se segredo vazar |
| POST | `/api/n8n-error-webhook` | `backend/src/server.js` | `n8n_error_logs`, `notifications` | Nao | Alto | P1 | Registro e notificacao globais, sem tenant |
| POST | `/api/conversation-memory` | `backend/src/server.js` | `leads`, `lead_conversations` | Nao por tenant | Alto | P1 | Persiste memoria por telefone, sem `client_id` |

### Observacao da PR `codex/tenant-scope-notifications`

- O backend atual do CRM consome `GET/PATCH /api/notifications`; por isso a correcao funcional ficou nesse caminho.
- A Edge Function `frontend/postgres/functions/notifications-api` continua duplicando leitura/update com service role, JWT Postgres e CORS `*`. Ela nao foi removida nem reescrita nesta PR para evitar refactor amplo.
- Proxima PR recomendada: decidir se `notifications-api` sera desativada, alinhada ao Firebase Auth do backend ou mantida apenas como endpoint legado bloqueado por tenant.

---

## 6. WhatsApp

| Metodo | Endpoint | Origem | Tabelas/Fonte | Filtro por tenant | Risco | Prioridade | Observacao |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/whatsapp/session` | `backend/src/server.js` | runtime WhatsApp | Nao se aplica | Baixo | P4 | Estado global da sessao |
| POST | `/api/whatsapp/session/start` | `backend/src/server.js` | runtime WhatsApp | Nao se aplica | Baixo | P4 | Operacional |
| POST | `/api/whatsapp/session/reset` | `backend/src/server.js` | runtime WhatsApp | Nao se aplica | Medio | P3 | Impacto global da sessao |
| GET | `/api/whatsapp/chats` | `backend/src/server.js` | runtime WhatsApp | Parcial | Medio | P2 | Depende de `ensureAuthorizedWhatsAppPhone` e chats autorizados por telefones do tenant |
| POST | `/api/whatsapp/chats/read` | `backend/src/server.js` | runtime WhatsApp | Parcial | Medio | P2 | Mesmo risco da rota de chats |
| GET | `/api/whatsapp/messages` | `backend/src/server.js` | runtime WhatsApp | Parcial | Medio | P2 | Escopo depende de telefone autorizado |
| POST | `/api/whatsapp/messages` | `backend/src/server.js` | runtime WhatsApp | Parcial | Medio | P2 | Envio depende de telefone autorizado |
| POST | `/api/whatsapp/messages/direct` | `backend/src/server.js` | runtime WhatsApp | Nao | Alto | P1 | Admin global pode enviar mensagem direta fora do escopo do tenant |

---

## 7. Campanhas

| Metodo | Endpoint | Origem | Tabelas/Fonte | Filtro por tenant | Risco | Prioridade | Observacao |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/campaigns` | `backend/src/server.js` | `campaigns`, `leads_clients` | Sim | Corrigido | Feito | Agora exige `clientId` autorizado ou tenant derivado das claims; nao lista tudo por default |
| GET | `/api/campaigns/:id/leads` | `backend/src/server.js` | `campaigns`, `leads` | Sim, resolve a partir do `client_id` da campanha | Baixo | P3 | Boa |
| POST | `/api/campaigns` | `backend/src/server.js` | `campaigns` | Sim | Corrigido | Feito | `clientId` do body passa por tenant scope antes do insert |
| PATCH | `/api/campaigns/:id` | `backend/src/server.js` | `campaigns` | Sim | Corrigido | Feito | Carrega a campanha, valida `client_id` contra o operador e atualiza com `.eq("client_id", authorizedClientId)` |
| DELETE | `/api/campaigns/:id` | `backend/src/server.js` | `campaigns` | Sim | Corrigido | Feito | Carrega a campanha, valida `client_id` contra o operador e exclui com `.eq("client_id", authorizedClientId)` |
| POST | `/api/campaigns/:id/trigger` | `backend/src/server.js` | `campaigns`, `leads`, `leads_clients` | Sim | Corrigido | Feito | Valida `client_id` antes de buscar leads, montar payload, chamar n8n e atualizar `last_triggered_at` |

---

## 8. Primeira sequencia de correcoes recomendada

### P0 - primeira PR funcional de seguranca

1. pendente: adicionar `resolveAuthorizedClientId` ou validacao equivalente em:
   - `POST /api/lead-imports`
2. pendente: escopar `GET/PATCH /api/notifications` ou assumir explicitamente que notificacoes sao globais e restringir o acesso a admin real

### Concluido na PR de tenant scope de campanhas

- `GET /api/campaigns`
- `POST /api/campaigns`
- `PATCH /api/campaigns/:id`
- `DELETE /api/campaigns/:id`
- `POST /api/campaigns/:id/trigger`

### P1 - segunda PR funcional

3. pendente: revisar webhooks internos para tenant explícito, principalmente `/api/import-lead-infinie-n8n` e `/api/conversation-memory`
4. pendente: decidir se perfis de acesso devem virar entidade tenant-aware no futuro

### Concluido na PR de tenant scope de usuarios

- `GET /api/admin/users`
- `GET /api/admin/access-profiles`
- `PATCH /api/admin/users/:uid/access`
- `POST /api/admin/users`
- `DELETE /api/admin/users/:uid`

### P2 - terceira PR funcional

6. reduzir ambiguidade de `lead_conversations` sem `client_id`
7. revisar rotas WhatsApp globais
8. padronizar logs e erro de acesso negado por tenant
