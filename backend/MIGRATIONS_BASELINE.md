# Migrations Baseline

Estado atual:

- O banco local/direto ja tem as 18 migrations de `backend/supabase/migrations` aplicadas ou marcadas em `public.app_schema_migrations`.
- O runner local agora usa `backend/scripts/conditional-migrate.mjs` via `pg`, sem depender de `supabase db push`.

## Regra daqui pra frente

1. Nao editar migrations antigas ja publicadas.
2. Toda mudanca nova de schema entra em um novo arquivo `.sql`.
3. Depois que o deploy em producao estiver estavel, congelamos estas 18 migrations como `baseline`.
4. A proxima limpeza deve gerar um unico arquivo baseline novo para ambientes novos.
5. Essa consolidacao so acontece uma vez e apenas depois de confirmar que producao, staging e local estao iguais.

## Como consolidar depois do deploy

1. Criar um banco limpo.
2. Extrair um schema unico desse banco ja estabilizado.
3. Salvar esse schema como uma nova migration baseline, por exemplo:
   - `20260515_baseline_schema.sql`
4. Mover as 18 migrations antigas para uma pasta de arquivo historico, por exemplo:
   - `backend/supabase/migrations-archive/`
5. Manter no diretório ativo:
   - a nova baseline
   - apenas migrations criadas depois da baseline

## Regra operacional

- Ambiente existente:
  continua usando `public.app_schema_migrations` e aplica apenas o que faltar.

- Ambiente novo:
  aplica a baseline unica primeiro, depois apenas as migrations novas.

## Checklist antes de consolidar

- `public.leads_outlier` existe
- `public.campaign_dispatch_logs` existe
- `public.lead_client_n8n_settings` existe
- `public.app_schema_migrations` contem todas as migrations historicas
- backend local sobe com `/health` respondendo `200`

## Observacao

Enquanto a baseline unica nao for criada, a pasta atual `backend/supabase/migrations` continua sendo a fonte da verdade.
