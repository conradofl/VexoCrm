# Supabase Edge Functions ativas

Este documento registra somente as Edge Functions que fazem parte da operacao atual.

## Funcoes em uso

| Function | Metodo | Consumida por | Papel |
| --- | --- | --- | --- |
| `conversation-memory` | `GET`, `POST` | n8n | salvar e consultar memoria de conversa |
| `conversation-memory-latest` | `GET` | n8n | recuperar a memoria mais recente por telefone |
| `lead-webhook` | `POST` | n8n | criar e finalizar leads |
| `n8n-planilha-webhook` | `GET`, `POST` | n8n | importar/atualizar leads e consultar estado da conversa |
| `mark-lead-dispatched` | `POST` | n8n / disparo | marcar item de importacao como disparo realizado |
| `n8n-error-webhook` | `POST` | n8n error workflow | registrar erros e gerar notificacoes |
| `notifications-api` | `GET`, `PATCH` | CRM | consultar e marcar notificacoes |
| `get-leads-disparo` | `GET` | n8n / integracoes | listar itens importados prontos para disparo (telefone deduplicado) |

## Funcoes removidas do escopo atual

As funcoes abaixo nao fazem mais parte da arquitetura documentada:

- `sheets-proxy`
- `lead-exists-by-phone`

Tambem foi normalizado o nome da function de leads:

- `leads-webhook` -> `lead-webhook`

## Padrao de URLs

Use o padrao:

```text
https://<projeto>.supabase.co/functions/v1/<nome-da-function>
```

## 1. `conversation-memory`

Arquivo fonte:

- [frontend/supabase/functions/conversation-memory/index.ts](../frontend/supabase/functions/conversation-memory/index.ts)

### Metodos

- `GET`
- `POST`

### Autenticacao

- Bearer token interno do workflow

### `GET`

Query:

- `telefone`

Retorno:

- ultima conversa encontrada para o telefone

### `POST`

Body esperado:

```json
{
  "telefone": "5534999999999",
  "conversation_compressed": "<payload compactado>",
  "tamanho_original": 1234,
  "timestamp": "2026-03-14T10:00:00.000Z"
}
```

Tabela impactada:

- `lead_conversations`

## 2. `conversation-memory-latest`

Arquivo fonte:

- [frontend/supabase/functions/conversation-memory-latest/index.ts](../frontend/supabase/functions/conversation-memory-latest/index.ts)

### Metodo

- `GET`

### Query

- `telefone`

### Autenticacao

- `Authorization: Bearer @Vexo2026` (valor fixo no codigo da function; nao usa secret `EDGE_FUNCTION_BEARER_TOKEN`)

### Papel no workflow

E a consulta usada logo apos a normalizacao do telefone para decidir se o n8n deve:

- continuar uma conversa existente;
- ou iniciar um contexto novo.

## 3. `lead-webhook`

Arquivo fonte:

- [frontend/supabase/functions/lead-webhook/index.ts](../frontend/supabase/functions/lead-webhook/index.ts)

### Metodo

- `POST`

### Substituto no backend (VPS)

- `POST /api/lead-webhook` em [`backend/src/server.js`](../backend/src/server.js) replica o mesmo contrato (create/finalize, JSON de sucesso/erro). Bearer: variável `LEAD_WEBHOOK_BEARER_TOKEN` ou, se ausente, o mesmo valor fixo `@Vexo2026` da Edge.

### Autenticacao

- `Authorization: Bearer @Vexo2026` (valor fixo no codigo da function; nao usa secret `EDGE_FUNCTION_BEARER_TOKEN`)

### Acoes suportadas

#### `create`

Usada no inicio da conversa para garantir que o lead exista.

Body tipico:

```json
{
  "action": "create",
  "client_id": "infinie",
  "telefone": "5534999999999",
  "nome": "Nome do contato"
}
```

#### `finalize`

Usada no fim da qualificacao para consolidar o lead no schema atual.

Body tipico:

```json
{
  "action": "finalize",
  "client_id": "infinie",
  "telefone": "5534999999999",
  "nome": "Nome do contato",
  "tipo_cliente": "rural",
  "faixa_consumo": "600",
  "cidade": "Uberlandia",
  "estado": "MG",
  "status": "qualificado",
  "qualificacao": "Resumo completo do lead"
}
```

Tabela impactada:

- `leads`

Observacao:

- a function trabalha com o schema novo e nao usa `conta_energia`, `bot_ativo` ou `historico`.

## 4. `n8n-planilha-webhook`

Arquivo fonte:

- [frontend/supabase/functions/n8n-planilha-webhook/index.ts](../frontend/supabase/functions/n8n-planilha-webhook/index.ts)

### Metodos

- `GET`
- `POST`

### Autenticacao

- Bearer token interno do workflow

### `POST`

Usado pelo n8n para importar/atualizar leads e tambem para gravar o estado da conversa.

Payload minimo para marcar que o bot fez uma pergunta:

```json
{
  "client_id": "infinie",
  "telefone": "5534999999999",
  "status_conversa": "aguardando_usuario",
  "ultima_interacao_bot": "2026-05-05T03:00:00.000Z"
}
```

Payload minimo quando o usuario responde:

```json
{
  "client_id": "infinie",
  "telefone": "5534999999999",
  "status_conversa": "em_atendimento",
  "ultima_interacao_usuario": "2026-05-05T03:05:00.000Z"
}
```

### `GET`

Usado depois do `Wait` do n8n para decidir se ainda precisa enviar fallback.

```http
GET /functions/v1/n8n-planilha-webhook?client_id=infinie&telefone=5534999999999
Authorization: Bearer <token-interno>
```

Retorno relevante:

```json
{
  "success": true,
  "found": true,
  "status_conversa": "aguardando_usuario",
  "ultima_interacao_bot": "2026-05-05T03:00:00.000Z",
  "ultima_interacao_usuario": null
}
```

Regra no fallback:

- enviar fallback somente se `status_conversa` ainda for `aguardando_usuario`;
- para evitar duplicacao, compare tambem se `ultima_interacao_bot` ainda e o mesmo timestamp salvo antes do `Wait`;
- depois de enviar o fallback, chame o `POST` novamente atualizando `ultima_interacao_bot`.

## 5. `n8n-error-webhook`

Arquivo fonte:

- [frontend/supabase/functions/n8n-error-webhook/index.ts](../frontend/supabase/functions/n8n-error-webhook/index.ts)

### Metodo

- `POST`

### Papel

- salva erro tecnico em `n8n_error_logs`;
- cria notificacao em `notifications`.

### Autenticacao

- header `Authorization: Bearer <N8N_WEBHOOK_SECRET>`
- valores iniciados com `=` nos campos de texto sao normalizados (strip do prefixo), alinhado ao comportamento do n8n em alguns payloads

### Secrets do Supabase (runtime)

- `SUPABASE_URL` com fallback legado `URL`
- `SUPABASE_SERVICE_ROLE_KEY` com fallback legado `SERVICE_ROLE_KEY`

### Payload esperado

Estrutura disparada pelo error workflow do n8n, incluindo:

- `workflow.name`
- `execution.id`
- `execution.url`
- `error.message`
- `error.lastNodeExecuted`

## 6. `mark-lead-dispatched`

Arquivo fonte:

- [frontend/supabase/functions/mark-lead-dispatched/index.ts](../frontend/supabase/functions/mark-lead-dispatched/index.ts)

### Metodo

- `POST`

### Autenticacao

- `Authorization: Bearer <token interno do workflow>` (valor fixo no codigo da function em producao; preferir secret em revisoes futuras)

### Body esperado

```json
{
  "telefone": "5534999999999"
}
```

O telefone e normalizado removendo caracteres nao numericos antes do match.

### Papel

- atualiza `lead_import_items.skip_reason` para `disparo_realizado` quando ainda for `null`, para o telefone informado.

### Tabela impactada

- `lead_import_items`

## 7. `notifications-api`

Arquivo fonte:

- [frontend/supabase/functions/notifications-api/index.ts](../frontend/supabase/functions/notifications-api/index.ts)

### Metodos

- `GET`
- `PATCH`

### Autenticacao

- JWT do usuario autenticado no Supabase

### Papel

- listar notificacoes;
- contar nao lidas;
- marcar uma ou todas como lidas.

## 8. `get-leads-disparo`

Arquivo fonte:

- [frontend/supabase/functions/get-leads-disparo/index.ts](../frontend/supabase/functions/get-leads-disparo/index.ts)

### Metodo

- `GET`

### Autenticacao

- `Authorization: Bearer @Vexo2026` (valor fixo no codigo da function; nao usa secret `EDGE_FUNCTION_BEARER_TOKEN`)

### Query

- `clientId` (opcional): filtra `lead_import_items.client_id`
- `importId` (opcional): filtra `lead_import_items.import_id`
- `limit` (opcional): inteiro positivo; se ausente ou invalido, nenhum `.limit()` e aplicado na query do Supabase
- `campaignId` (opcional): **ecoado** no JSON de resposta como `campaignId`; **nao** filtra registros (comportamento alinhado ao deploy online)

### Comportamento

- Le `lead_import_items` com `imported = true`, `telefone` nao nulo, ordenado por `created_at` descendente.
- Normaliza telefone para apenas digitos e deduplica por telefone (mantem a primeira ocorrencia).
- Campos como nome, cidade, estado vêm de `normalized_data` quando existirem.

### Tabela impactada

- `lead_import_items` (somente leitura)

## Segredos e autenticacao

### Functions de workflow

`conversation-memory`, `conversation-memory-latest`, `lead-webhook`, `n8n-planilha-webhook`, `mark-lead-dispatched`, `n8n-error-webhook` e `get-leads-disparo` esperam um bearer interno da operacao. `lead-webhook`, `mark-lead-dispatched` e `get-leads-disparo` usam token fixo `@Vexo2026` no codigo no deploy atual, nao variavel `EDGE_FUNCTION_BEARER_TOKEN`.

### Function de CRM

`notifications-api` valida o JWT do usuario.

## Resumo operacional

Se a pergunta for "quais functions estao ativas hoje?", a resposta correta e exatamente a lista deste documento. Qualquer referencia adicional deve ser tratada como legado ou material fora do escopo atual.
