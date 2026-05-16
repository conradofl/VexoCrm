# DB Schema Full Map

## Resumo

O projeto usa **PostgreSQL via Supabase** como banco oficial. A fonte versionada de schema está em `backend/supabase/migrations/`.

Hoje o banco está em **estado híbrido**:

- existe uma base histórica centrada em `public.leads`;
- existe uma evolução mais nova para tabelas por tenant no padrão `public.leads_{client_id}`;
- o backend ainda opera partes dos dois modelos.

## Fonte da verdade

- Migrations ativas: `backend/supabase/migrations/`
- Runtime principal: `backend/src/server.js` e `backend/src/domains/registerAllDomainRoutes.js`
- Compat de acesso: `backend/src/pgSupabaseCompat.js`

## Inventário completo de tabelas

| Tabela | Origem | Papel | Status no runtime |
| --- | --- | --- | --- |
| `n8n_error_logs` | `20260221031218` | auditoria de erros de automações | ativa |
| `notifications` | `20260221031218` | notificações operacionais | ativa |
| `leads_clients` | `20260304000001` | cadastro de tenants/clientes | ativa |
| `leads` | `20260304000001` | tabela histórica de leads compartilhada | ativa em rotas legadas/híbridas |
| `lead_conversations` | `20260309000003` | memória comprimida de conversa | ativa |
| `lead_imports` | `20260315000004` | cabeçalho de importações | ativa |
| `lead_import_items` | `20260315000004` | itens linha a linha de importação | ativa |
| `access_profiles` | `20260412000007` | perfis/permissões de acesso | ativa |
| `campaigns` | criação não localizada nas migrations atuais | campanhas e webhooks | ativa com schema parcial versionado |
| `crm_consultants` | `20260420000009` | consultores do CRM | ativa |
| `lead_messages` | `20260420000009` | histórico de mensagens por lead | ativa |
| `lead_assignments` | `20260420000009` | atribuição de leads | ativa |
| `lead_conversions` | `20260420000009` | conversões comerciais | ativa |
| `lead_distribution_rules` | `20260420000009` | regras de distribuição | ativa |
| `analytics_insights` | `20260420000009` | insights analíticos por tenant | ativa |
| `commercial_intelligence_settings` | `20260420000010` | config comercial por tenant | ativa |
| `metric_snapshots` | `20260420000010` | snapshots de métricas | referenciada no purge de tenant |
| `campaign_dispatch_logs` | `20260503000012` | log de disparos de campanha | ativa |
| `lead_client_n8n_settings` | `20260505000013` | bearer/config por tenant para n8n/chatbot | ativa |
| `vexo_sales_opportunities` | `20260506000001` | pipeline comercial interno da Vexo | ativa |
| `vexo_sales_interactions` | `20260506000001` | interações do pipeline Vexo Sales | ativa |
| `leads_outlier` | `20260507100000` + ajustes posteriores | leads do fluxo Outlier/chatbot | ativa |
| `leads_infinie` | rename em `20260512130000` | leads da empresa Infinie | ativa no modelo novo |
| `leads_teste` | `20260512130000` | leads da empresa teste | pronta para uso |
| `chatbot_prompts` | `20260515120000` | prompts customizados por tenant | ativa |

## Tabelas centrais por domínio

### 1. Tenants e autenticação operacional

| Tabela | Chave | Campos críticos |
| --- | --- | --- |
| `leads_clients` | `id` (`text`) | `id`, `name`, `created_at` |
| `lead_client_n8n_settings` | `client_id` | `client_id`, `webhook_bearer_token`, `active`, `chatbot_enabled`, `chatbot_model`, `sdr_whatsapp_number` |
| `access_profiles` | `key` | `key`, `role`, `permissions` |

Observação: `client_id` é a chave operacional dominante do projeto.

### 2. Leads

| Tabela | Modelo | Campos críticos |
| --- | --- | --- |
| `leads` | legado compartilhado | `id`, `client_id`, `telefone`, `status`, `qualificacao` |
| `leads_infinie` | por tenant | `id`, `client_id`, `telefone`, `status`, `status_conversa`, `source_campaign_id` |
| `leads_outlier` | por tenant/chatbot | `id`, `client_id`, `telefone`, `mensagem`, `status_conversa`, `dados`, `source_campaign_id` |
| `leads_teste` | por tenant | mesmo shape de `leads_infinie` |

Observação: `backend/src/server.js` já deriva o nome da tabela dinamicamente com `leadsTableName(clientId)`, no padrão `leads_{clientId}`.

### 3. Conversa e chatbot

| Tabela | Papel | Campos críticos |
| --- | --- | --- |
| `lead_conversations` | memória comprimida de conversa | `telefone`, `conversation_compressed`, `unknown_lead`, `created_at` |
| `chatbot_prompts` | prompt customizado por tenant/tipo | `client_id`, `type`, `content`, `updated_at` |

Risco: `lead_conversations` não tem `client_id`, então o isolamento é por telefone e aplicação.

### 4. Importações

| Tabela | Papel | Campos críticos |
| --- | --- | --- |
| `lead_imports` | cabeçalho da carga | `client_id`, `source_name`, `total_rows`, `imported_rows`, `uploaded_by_uid` |
| `lead_import_items` | detalhe por linha | `import_id`, `client_id`, `telefone`, `lead_id`, `imported`, `skip_reason`, `normalized_data` |

### 5. Campanhas e revenue ops

| Tabela | Papel | Campos críticos |
| --- | --- | --- |
| `campaigns` | campanha, webhook e segmentação | `id`, `client_id`, `status`, `webhook_url`, `webhook_token`, `phones`, `scheduled_for`, `archived_at`, `analytics_meta` |
| `campaign_dispatch_logs` | execução/disparo | `campaign_id`, `client_id`, `phone`, `status`, `payload`, `created_at` |
| `crm_consultants` | consultores | `client_id`, `name`, `available`, `active`, `priority_rank` |
| `lead_messages` | mensagens por lead | `client_id`, `lead_id`, `campaign_id`, `phone`, `direction`, `message_text` |
| `lead_assignments` | atribuição | `client_id`, `lead_id`, `consultant_id`, `assignment_status` |
| `lead_conversions` | conversão | `client_id`, `lead_id`, `consultant_id`, `conversion_status` |
| `lead_distribution_rules` | regra de distribuição | `client_id`, `distribution_mode`, `active` |
| `analytics_insights` | insight gerado | `client_id`, `title`, `severity`, `generated_at` |
| `commercial_intelligence_settings` | parâmetros comerciais | `client_id`, `qualification_threshold`, `sla_minutes` |
| `metric_snapshots` | séries temporais de métrica | `client_id`, `metric_date`, `snapshot_type`, `payload` |

### 6. Pipeline interno Vexo

| Tabela | Papel | Campos críticos |
| --- | --- | --- |
| `vexo_sales_opportunities` | oportunidades do pipeline interno | `company_name`, `stage`, `status`, `priority`, `assigned_to`, `estimated_value` |
| `vexo_sales_interactions` | histórico de interação | `opportunity_id`, `type`, `description`, `interaction_at` |

## Relacionamentos principais

```text
leads_clients (1) -> (N) leads / leads_infinie / leads_outlier / leads_teste
leads_clients (1) -> (N) lead_imports
lead_imports (1) -> (N) lead_import_items
leads_clients (1) -> (1) lead_client_n8n_settings
leads_clients (1) -> (N) campaigns
campaigns (1) -> (N) campaign_dispatch_logs
campaigns (1) -> (N) lead_messages / lead_assignments / lead_conversions
crm_consultants (1) -> (N) lead_assignments / lead_conversions
vexo_sales_opportunities (1) -> (N) vexo_sales_interactions
```

## Divergências relevantes encontradas

### `campaigns`

- o runtime usa `campaigns` amplamente;
- as migrations atuais só trazem alterações aditivas;
- a migration de criação da tabela não foi localizada na série atual.

Impacto: não dá para reconstruir um banco limpo com confiança sem recuperar a criação base de `campaigns`.

### Modelo de leads híbrido

- parte do sistema ainda acessa `leads`;
- parte nova já usa `leads_{client_id}`;
- existe migration renomeando `leads` para `leads_infinie` e criando `leads_teste`.

Impacto: o banco ainda convive com modelo compartilhado e modelo por tenant.

### `lead_conversations` sem tenant

- não existe `client_id`;
- lookup é por telefone;
- isso depende de disciplina da aplicação para evitar colisão entre empresas.

### Documentação antiga

- `database.md` não cobre várias tabelas ativas;
- `docs/SCHEMA_MAP.md` marca `metric_snapshots` como não encontrada, mas a tabela existe em `20260420000010`.

## Leitura prática

Hoje, o banco do projeto é composto por:

1. núcleo operacional do CRM (`leads_clients`, `lead_imports`, `notifications`, `n8n_error_logs`);
2. camada de leads em transição (`leads`, `leads_infinie`, `leads_outlier`, `leads_teste`);
3. camada comercial/campanhas (`campaigns` e revenue ops);
4. camada de automação/chatbot (`lead_conversations`, `lead_client_n8n_settings`, `chatbot_prompts`);
5. módulo comercial interno (`vexo_sales_*`).

## Próximas correções recomendadas

1. versionar a criação completa de `campaigns`;
2. decidir e consolidar o modelo final de leads: `leads` compartilhada ou `leads_{client_id}`;
3. adicionar `client_id` em `lead_conversations` se o isolamento por tenant for obrigatório no banco;
4. atualizar `database.md` e `docs/SCHEMA_MAP.md` para refletir o schema real.
