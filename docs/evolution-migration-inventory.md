# Inventario de migracao Evolution API

Data do rastreio: 2026-06-15

## Resumo

A configuracao da Evolution no Vexo esta dividida em tres lugares:

1. Variaveis de ambiente globais do backend, usadas para administrar/provisionar instancias e pelo modulo de follow-up.
2. Tabela `public.lead_client_evolution_instances`, que e a entidade oficial de chips/instancias por tenant.
3. Tabela legada/compatibilidade `public.lead_client_n8n_settings`, ainda usada como fallback para URL/token de disparo por tenant.

Na migracao da VPS da Evolution, o ponto critico e atualizar todos os endpoints que apontam para o host antigo (`/message/sendText/<instancia>`) e a API key/token usada no header `apikey`.

## Variaveis de ambiente

### Obrigatorias para provisionamento e follow-up

- `EVOLUTION_API_URL`: base URL da Evolution nova, sem path. Exemplo: `https://evolution.novo-dominio.com`.
- `EVOLUTION_API_KEY`: chave admin/global da Evolution. Usada no header `apikey`.

Usos encontrados:

- `backend/src/server.js`: `getEvolutionAdminConfig()` e `provisionLeadClientEvolutionInstance()` usam `EVOLUTION_API_URL` + `EVOLUTION_API_KEY` para chamar `POST /instance/create`.
- `backend/src/followup/worker.js`: usa `EVOLUTION_API_URL` + `EVOLUTION_API_KEY` para enviar follow-ups em `/message/sendText/<instance>`.

### Fallbacks por tenant

- `EVOLUTION_DISPATCH_WEBHOOKS_JSON`
- `EVOLUTION_DISPATCH_WEBHOOK_URL_<TENANT>`
- `EVOLUTION_DISPATCH_WEBHOOK_TOKEN_<TENANT>`
- aliases legados: `N8N_DISPATCH_WEBHOOKS_JSON`, `N8N_DISPATCH_WEBHOOK_URL_<TENANT>`, `N8N_DISPATCH_WEBHOOK_TOKEN_<TENANT>`

Ordem de resolucao para disparos:

1. `lead_client_evolution_instances` via instancia default/ativa.
2. `lead_client_n8n_settings`.
3. fallbacks env `EVOLUTION_*` / `N8N_*`.

Observacao local: no `backend/.env` deste workspace apareceu somente `N8N_DISPATCH_WEBHOOK_URL=https://geracaodigital.app.n8n.cloud/webhook/vexocrm-disparo-imediato` entre as variaveis filtradas. O EasyPanel/producao pode ter outras envs que nao estao no arquivo local.

## Tabelas que carregam dados da Evolution

### `public.lead_client_evolution_instances`

Entidade principal de instancias/chips por tenant.

Colunas relevantes:

- `id`
- `client_id`
- `name`
- `dispatch_webhook_url`: endpoint Evolution usado para envio, normalmente `https://host/message/sendText/<instanceName>`.
- `dispatch_webhook_token`: token/API key enviada como `apikey` e `Authorization: Bearer`.
- `inbound_bearer_token`: token inbound legado.
- `active`
- `is_default`
- `chip_state`
- `daily_limit_override`

E usada em:

- listagem/crud/provisionamento em `/api/lead-clients/:tenantId/evolution-instances`.
- selecao de chip em campanhas.
- rotacao anti-ban e cota diaria.
- chatbot outbound quando responde conversas recebidas.
- relatorio de uso via join com `evolution_instance_daily_usage`.

### `public.lead_client_n8n_settings`

Configuracao legada/compatibilidade por cliente.

Colunas relevantes:

- `client_id`
- `dispatch_webhook_url`
- `dispatch_webhook_token`
- `inbound_bearer_token`
- `active`
- `chatbot_enabled`
- `chatbot_model`
- `segmentation_config`
- `sdr_whatsapp_number`

Ainda entra no fluxo quando nao ha instancia default/ativa em `lead_client_evolution_instances`, e tambem conserva parametros de chatbot/inbound.

### `public.evolution_instance_daily_usage`

Uso diario por instancia.

Colunas:

- `instance_id`
- `date`
- `sent_count`

Nao precisa ser alterada por causa da troca de VPS, mas deve ser mantida se a migracao incluir historico operacional e relatorios.

### `public.campaign_dispatches`

Coluna relevante:

- `evolution_instance_id`: fixa uma instancia especifica em um disparo.

Se a tabela `lead_client_evolution_instances` for preservada com os mesmos `id`s, nao ha ajuste. Se as instancias forem recriadas com novos IDs, esta coluna precisa ser remapeada.

### `public.followup_companies`

Modulo separado de follow-up.

Colunas relevantes:

- `evolution_instance`: nome da instancia usado pelo worker em `/message/sendText/<instance>`.
- `webhook_url`: repasse de resposta do lead; nao e necessariamente URL Evolution.

Aqui a URL base vem de `EVOLUTION_API_URL`; a tabela guarda o nome da instancia.

## Pontos de codigo

- `backend/src/server.js`
  - `resolveEnvDispatchWebhookSettings()`: fallbacks por env.
  - `ensureLeadClientEvolutionInstancesTable()`: schema da entidade oficial.
  - `getLeadClientN8nSettingsStatus()`: mescla instancia default com settings legados.
  - `upsertLeadClientEvolutionInstance()`: grava URL/token por instancia.
  - `getEvolutionAdminConfig()`: le `EVOLUTION_API_URL` e `EVOLUTION_API_KEY`.
  - `provisionLeadClientEvolutionInstance()`: cria instancia na Evolution e grava URL/token.
  - `resolveDispatchWebhookSettings()`: resolve URL/token final.
  - `checkEvolutionInstanceHealth()`: chama `/instance/connectionState/<instance>`.
  - `resolveCampaignDispatchSettings()`: escolhe instancia da campanha ou fallback.

- `backend/src/campaign-outbound.js`
  - monta payloads de texto/imagem.
  - envia para Evolution com headers `apikey` e `Authorization`.
  - troca `/message/sendText/` por `/message/sendMedia/` em imagem.

- `backend/src/domains/registerAllDomainRoutes.js`
  - rotas `/api/lead-clients/:tenantId/evolution-instances`.
  - runner de campanhas com rotacao de chips.
  - `/api/hardcoded-chat-webhook` responde conversas pela Evolution.
  - `/api/campaigns/reply-webhook` processa replies de campanha.

- `backend/src/followup/worker.js`
  - envia follow-up usando `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` e `followup_companies.evolution_instance`.

- `frontend/src/components/EvolutionChipsPanel.tsx`
  - UI de chips/instancias, URL e API key mascarada.

- `frontend/src/hooks/useLeadClients.ts`
  - chamadas frontend para CRUD/provisionamento de instancias.

- `frontend/src/pages/Tenants.tsx`
  - UI legada de settings `dispatch_webhook_url` / token.

- `frontend/src/pages/Conexoes.tsx`
  - tela operacional de conexoes/chips.

- `frontend/src/hooks/useReports.ts`
  - relatorio de uso Evolution.

## Checklist de migracao

1. Subir a nova Evolution e confirmar a nova `EVOLUTION_API_URL` e `EVOLUTION_API_KEY`.
2. Migrar ou recriar as instancias na Evolution nova mantendo os nomes de instancia sempre que possivel.
3. Atualizar envs de producao:
   - `EVOLUTION_API_URL`
   - `EVOLUTION_API_KEY`
   - qualquer `EVOLUTION_DISPATCH_*` ou `N8N_DISPATCH_*` que aponte para a VPS antiga.
4. Atualizar no banco:
   - `lead_client_evolution_instances.dispatch_webhook_url`
   - `lead_client_evolution_instances.dispatch_webhook_token` se a key/token mudou.
   - `lead_client_n8n_settings.dispatch_webhook_url`
   - `lead_client_n8n_settings.dispatch_webhook_token` se ainda houver tenants dependentes do fallback legado.
   - `followup_companies.evolution_instance` somente se os nomes das instancias mudarem.
5. Preservar IDs de `lead_client_evolution_instances` se possivel. Se recriar registros, remapear `campaign_dispatches.evolution_instance_id`.
6. Validar `GET /instance/connectionState/<instance>` para cada URL/token configurado.
7. Fazer disparo controlado por tenant e validar:
   - campanha texto.
   - campanha imagem, pois troca endpoint para `/message/sendMedia/`.
   - resposta inbound via `/api/hardcoded-chat-webhook` ou `/api/campaigns/reply-webhook`.
   - follow-up worker, se o modulo estiver ativo.

## SQL util para inventario antes da migracao

```sql
SELECT client_id, id, name, active, is_default, chip_state,
       dispatch_webhook_url,
       dispatch_webhook_token IS NOT NULL AS has_dispatch_webhook_token
FROM public.lead_client_evolution_instances
ORDER BY client_id, is_default DESC, active DESC, created_at;

SELECT client_id, active, dispatch_webhook_url,
       dispatch_webhook_token IS NOT NULL AS has_dispatch_webhook_token,
       inbound_bearer_token IS NOT NULL AS has_inbound_bearer_token
FROM public.lead_client_n8n_settings
ORDER BY client_id;

SELECT id, name, evolution_instance, webhook_url
FROM public.followup_companies
WHERE archived_at IS NULL
ORDER BY name;

SELECT id, campaign_id, evolution_instance_id, status, created_at
FROM public.campaign_dispatches
WHERE evolution_instance_id IS NOT NULL
ORDER BY created_at DESC;
```

## SQL modelo para troca de host

Use apenas depois de conferir o host antigo e novo.

```sql
UPDATE public.lead_client_evolution_instances
SET dispatch_webhook_url = replace(dispatch_webhook_url, 'https://HOST_ANTIGO', 'https://HOST_NOVO'),
    updated_at = now()
WHERE dispatch_webhook_url LIKE 'https://HOST_ANTIGO%';

UPDATE public.lead_client_n8n_settings
SET dispatch_webhook_url = replace(dispatch_webhook_url, 'https://HOST_ANTIGO', 'https://HOST_NOVO'),
    updated_at = now()
WHERE dispatch_webhook_url LIKE 'https://HOST_ANTIGO%';
```
