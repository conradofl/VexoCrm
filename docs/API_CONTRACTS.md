# API Contracts - Vexo CRM

## Objetivo

Definir os nomes oficiais de campos usados entre frontend, backend, Supabase e Edge Functions, reduzindo drift sem fazer renomeacao global ampla.

Regra desta fase: codigo novo deve usar o campo oficial. Aliases legados podem ser aceitos apenas na borda da API e devem ser normalizados antes de persistir ou consultar.

---

## 1. Contratos oficiais

| Dominio | Campo oficial | Tipo esperado | Persistencia | Aliases aceitos na borda | Nao usar em codigo novo |
| --- | --- | --- | --- | --- | --- |
| Tenant/empresa | `client_id` | `text` slug de `leads_clients.id` | Sim | `clientId`, `tenant_id`, `tenantId`, `company_id`, `companyId` | `tenant_id`, `company_id` como coluna nova sem ADR |
| Usuario | `user_id` | Firebase `uid` como `text` | Quando necessario | `userId`, `uid` | `email` como chave primaria de usuario |
| Lead | `lead_id` | UUID como `text`/`uuid` conforme tabela | Sim em tabelas relacionais | `leadId` | `telefone` como unica relacao entre tabelas |
| Campanha | `campaign_id` | UUID como `text`/`uuid` conforme tabela | Sim em tabelas relacionais | `campaignId` | inferir campanha somente por `phones` |
| Telefone | `telefone` | digitos normalizados, preferencialmente `55` + DDD + numero | Sim em leads/imports | `phone`, `whatsapp`, `numero` | telefone formatado com mascara no banco |
| Qualificacao | `qualificacao` | texto/resumo de qualificacao legado | Sim em `leads` | `qualification`, `resumo` | usar `qualificacao` como enum de status |
| Status | `status` | texto canonico por fluxo | Sim | `stage`, `current_status` | status visual sem mapeamento |
| Notificacao | `notification_id` | UUID da notificacao | Nao como coluna; usado em payload | `notificationId`, `id` no payload de `/api/notifications` | atualizar notificacao sem validar escopo |

---

## 2. Tenant

### Oficial

- Persistencia: `client_id`
- Origem canonica: `public.leads_clients.id`
- Tipo real: `TEXT`
- Exemplo atual: `infinie`

### Aliases temporarios

| Alias | Onde aparece | Acao |
| --- | --- | --- |
| `clientId` | frontend hooks, query params, payloads internos | aceitar na borda e normalizar para `client_id` |
| `tenantId` | claims Firebase, rotas de empresa, hooks | manter como alias de aplicacao; nao persistir como padrao novo |
| `companyId` | claims Firebase e alguns payloads | aceitar apenas como compatibilidade |
| `tenant_id`, `company_id` | possiveis payloads externos/Edge | aceitar na borda quando nao houver `client_id` |

### Decisao desta PR

O validador de lead deixou de exigir UUID em `client_id`, porque o schema real usa slug textual em `leads_clients.id`. Isso alinha validacao com a migration `20260304000001_create_leads_tables.sql`.

---

## 3. Leads

### Contrato de entrada recomendado

```json
{
  "client_id": "infinie",
  "nome": "Maria",
  "email": "maria@example.com",
  "telefone": "5511999999999",
  "status": "novo",
  "qualificacao": "Resumo da qualificacao"
}
```

### Compatibilidade temporaria

O backend pode aceitar `clientId`, `tenantId`, `companyId`, `phone` e `qualification` em payloads de borda, mas deve normalizar para `client_id`, `telefone` e `qualificacao`.

### Nao usar em codigo novo

- `phone` persistido em tabela de lead principal.
- `qualification` como campo persistido.
- `client_id` UUID obrigatorio.

---

## 4. Campanhas

### Oficial

- `campaign_id` para relacionamento.
- `client_id` para tenant.
- `telefone` para telefones de leads.

### Risco remanescente

`campaigns.phones` ainda e usado como marcador operacional de disparo. Isso fica documentado como legado ate uma PR propria criar contrato mais forte para eventos de disparo.

---

## 5. Notificacoes

### Oficial

- Payload de update: `notification_id` preferencialmente; `id` ainda e aceito pelo endpoint atual.
- Escopo: `client_id` quando a notificacao pertencer a uma empresa.
- Usuario alvo: `user_id` quando a notificacao for individual.

### Regra

Notificacoes sem `client_id` e sem `user_id` sao globais de operacao e devem ficar restritas a admin interno real.

---

## 6. Schema truth

| Tabela | Estado apos esta PR | Observacao |
| --- | --- | --- |
| `notifications` | Criacao versionada em `20260221031218` | Inclui `client_id`, `user_id`, indices e RLS deny-all |
| `n8n_error_logs` | Criacao versionada em `20260221031218` | Inclui `execution_id` unico, `client_id`, payload e RLS deny-all |
| `campaigns` | Ainda parcial | Precisa de PR propria para creation migration |
| `lead_conversations` | Ainda sem `client_id` | Precisa de decisao/migration propria |

Observacao: `client_id` em `notifications` e `n8n_error_logs` nao recebe FK nesta migration porque o arquivo historico `20260221031218` roda antes da criacao de `leads_clients`. A constraint pode ser adicionada depois em migration propria, na ordem correta.

---

## 7. Plano de migracao gradual

1. Continuar aceitando aliases na borda das APIs.
2. Normalizar aliases antes de validacao e persistencia.
3. Atualizar docs/workflows n8n para enviar campos oficiais.
4. Evitar novas tabelas com `tenant_id`/`company_id` sem decisao arquitetural.
5. Em PRs futuras, remover dependencias de aliases apenas quando os consumidores estiverem atualizados.
