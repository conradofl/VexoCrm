# Banco de dados do VexoCrm

Este documento descreve o schema operacional atual do projeto.

## Premissa

O banco oficial do sistema esta no `Supabase PostgreSQL`.

Hoje o fluxo principal nao depende de planilhas. As tabelas abaixo sustentam:

- captura de leads;
- importacao e auditoria de planilhas dos clientes;
- memoria de conversa;
- notificacoes operacionais;
- rastreio de erros do n8n;
- filtros e visoes do CRM.

## Tabelas ativas

- `leads_clients`
- `leads`
- `lead_imports`
- `lead_import_items`
- `lead_conversations`
- `notifications`
- `n8n_error_logs`

## Relacionamento logico

```text
leads_clients (1) ---- (N) leads
leads_clients (1) ---- (N) lead_imports
lead_imports (1) ----- (N) lead_import_items
lead_import_items ----> leads
leads.telefone ------- lead_conversations.telefone
n8n_error_logs ------> notifications
```

## `leads_clients`

Cadastro dos clientes/origens exibidos no CRM.

| Coluna | Tipo | Observacao |
| --- | --- | --- |
| `id` | `text` | chave logica usada como `client_id` |
| `name` | `text` | nome exibido no sistema |
| `created_at` | `timestamptz` | data de criacao |

## `leads`

Tabela principal do CRM.

| Coluna | Tipo | Observacao |
| --- | --- | --- |
| `id` | `uuid` | chave primaria |
| `client_id` | `text` | cliente/origem do lead |
| `telefone` | `text` | telefone normalizado |
| `nome` | `text` | nome do lead |
| `tipo_cliente` | `text` | residencial, rural, comercial etc. |
| `faixa_consumo` | `text` | faixa ou valor de consumo |
| `cidade` | `text` | cidade |
| `estado` | `text` | UF |
| `status` | `text` | status comercial |
| `data_hora` | `timestamptz` | marco temporal do lead |
| `qualificacao` | `text` | resumo completo e sinais de temperatura |
| `created_at` | `timestamptz` | criacao do registro |
| `updated_at` | `timestamptz` | ultima alteracao |

### Regra operacional

O workflow e o backend tratam `client_id + telefone` como chave logica do lead.

## `lead_imports`

Cabecalho de cada planilha importada pelo CRM.

| Coluna | Tipo | Observacao |
| --- | --- | --- |
| `id` | `uuid` | chave primaria |
| `client_id` | `text` | cliente dono da carga |
| `source_name` | `text` | nome original do arquivo |
| `source_type` | `text` | extensao/tipo informado na carga |
| `total_rows` | `integer` | total de linhas lidas |
| `imported_rows` | `integer` | linhas aproveitadas |
| `skipped_rows` | `integer` | linhas ignoradas |
| `uploaded_by_uid` | `text` | uid do usuario interno |
| `uploaded_by_email` | `text` | email do usuario interno |
| `created_at` | `timestamptz` | carimbo da importacao |

## `lead_import_items`

Persistencia linha a linha da planilha recebida.

| Coluna | Tipo | Observacao |
| --- | --- | --- |
| `id` | `uuid` | chave primaria |
| `import_id` | `uuid` | referencia para `lead_imports` |
| `client_id` | `text` | cliente dono da linha |
| `row_number` | `integer` | numero original da linha na planilha |
| `telefone` | `text` | telefone normalizado, quando existir |
| `lead_id` | `uuid` | lead impactado pela importacao |
| `imported` | `boolean` | indica se a linha virou lead/upsert |
| `skip_reason` | `text` | motivo da rejeicao |
| `raw_data` | `jsonb` | linha original extraida da planilha |
| `normalized_data` | `jsonb` | payload padronizado para o CRM |
| `created_at` | `timestamptz` | carimbo da persistencia |

### Campos antigos removidos

Estas colunas nao fazem mais parte do schema operacional:

- `conta_energia`
- `bot_ativo`
- `historico`

Qualquer codigo que ainda tente ler esses campos esta defasado.

## `lead_conversations`

Persistencia da memoria comprimida das conversas.

| Coluna | Tipo | Observacao |
| --- | --- | --- |
| `id` | `uuid` | chave primaria |
| `telefone` | `text` | telefone associado |
| `conversation_compressed` | `text` | payload compactado |
| `tamanho_original` | `integer` | tamanho antes da compressao |
| `unknown_lead` | `boolean` | indica lead ainda nao identificado |
| `created_at` | `timestamptz` | carimbo temporal |

### Uso

- escrita por `conversation-memory`;
- leitura por `conversation-memory` e `conversation-memory-latest`.

## `notifications`

Tabela de notificacoes exibidas no CRM.

| Coluna | Tipo | Observacao |
| --- | --- | --- |
| `id` | `uuid` | chave primaria |
| `type` | `text` | tipo da notificacao |
| `title` | `text` | titulo curto |
| `description` | `text` | descricao exibida |
| `link` | `text` | link opcional |
| `read` | `boolean` | controle de leitura |
| `created_at` | `timestamptz` | data de criacao |

### Uso

- leitura/atualizacao pelo CRM;
- escrita automatica por `n8n-error-webhook`.

## `n8n_error_logs`

Tabela de auditoria tecnica dos workflows.

| Coluna | Tipo | Observacao |
| --- | --- | --- |
| `execution_id` | `text` | execucao unica do n8n |
| `workflow_name` | `text` | nome do workflow |
| `message` | `text` | mensagem de erro |
| `node` | `text` | ultimo no executado |
| `execution_url` | `text` | link da execucao no n8n |

## Como cada camada usa o banco

### n8n + Edge Functions

- cria e finaliza leads;
- salva memoria de conversa;
- registra importacoes de planilhas e linhas extraidas;
- busca ultima memoria;
- registra erros operacionais.

### Backend

- le agregados do dashboard;
- lista leads para o CRM;
- importa planilhas e audita cada linha recebida;
- serve notificacoes para o frontend;
- prepara a futura migracao do audio.

### Frontend

- consome backend para dashboard, leads, planilhas e notificacoes.

## Conclusao

Para documentar o banco corretamente hoje, use este arquivo e [docs/supabase-functions.md](docs/supabase-functions.md). O CRM voltou a aceitar planilhas, mas agora elas entram como importacao auditada e viram registros persistidos no PostgreSQL.
