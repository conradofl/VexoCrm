# Status da Migracao do Postgres

Data de referencia: 2026-05-06

## Objetivo

Migrar o projeto para rodar com o PostgreSQL da VPS no lugar do banco remoto do Postgres, sem perder os dados operacionais e sem reescrever toda a regra de negocio de uma vez.

## Estado atual

### Banco de dados

- O banco remoto do Postgres e o banco novo da VPS foram comparados no schema `public`.
- A comparacao final validou:
  - mesmas tabelas
  - mesmas colunas
  - mesmas constraints
  - mesmos indices
  - mesmas contagens
  - mesmos dados
- Resultado pratico: o banco da VPS esta espelhado em relacao ao banco remoto atual no `public`.

### Origem e destino usados

#### Origem

- Plataforma: Postgres
- Projeto: `yfhdzkjuhxsbxklfgdut`
- Base usada na migracao: PostgreSQL remoto do projeto

#### Destino

- Host: `187.77.52.167`
- Porta: `5432`
- Banco: `vexo-data`
- Usuario: `dbvexo`

## Artefatos gerados

### Dumps e conferencias

- Dump remoto usado na migracao:
  - [postgres-refresh-2026-05-06T04-33-11-983Z](</C:/Users/W11/Desktop/Vexo/VexoCrm/_exports/postgres-refresh-2026-05-06T04-33-11-983Z>)
- Confirmacao do banco novo:
  - [postgres-target-confirm-2026-05-06T22-40-47-842Z](</C:/Users/W11/Desktop/Vexo/VexoCrm/_exports/postgres-target-confirm-2026-05-06T22-40-47-842Z>)
- Relatorio de comparacao final:
  - [compare-report.json](</C:/Users/W11/Desktop/Vexo/VexoCrm/_exports/postgres-compare-2026-05-06T23-39-33-910Z/compare-report.json>)

## Contagens relevantes validadas

- `access_profiles`: 4
- `campaigns`: 3
- `commercial_intelligence_settings`: 2
- `crm_consultants`: 1
- `lead_client_n8n_settings`: 2
- `lead_conversations`: 21
- `lead_import_items`: 880
- `lead_imports`: 6
- `leads`: 12
- `leads_clients`: 4
- `notifications`: 5

Tabelas vazias preservadas:

- `analytics_insights`
- `campaign_dispatch_logs`
- `lead_assignments`
- `lead_conversions`
- `lead_distribution_rules`
- `lead_messages`
- `metric_snapshots`
- `n8n_error_logs`

## Aplicacao

### Situacao atual do backend

- O backend ainda esta acoplado ao `pg`.
- O ponto principal de uso fica em [backend/src/server.js](</C:/Users/W11/Desktop/Vexo/VexoCrm/backend/src/server.js>).
- O backend ja recebeu `DATABASE_URL` para a VPS no arquivo [backend/.env](</C:/Users/W11/Desktop/Vexo/VexoCrm/backend/.env>).
- Porem, o codigo ainda nao foi trocado para priorizar Postgres direto em runtime.

### Situacao das rotas Express

- As rotas Express ainda fazem parte da arquitetura operacional atual.
- O destino final e portar essas funcoes para:
  - rotas Express no backend, ou
  - workers/jobs separados
- Conceito da troca:
  - antes: `n8n -> rota Express Postgres -> banco Postgres`
  - depois: `n8n -> backend -> PostgreSQL VPS`

## Deploy em producao (EasyPanel / VPS)

Para o container em producao usar o Postgres da VPS (nao o projeto Postgres via JS):

1. No painel do app, defina `DATABASE_URL` com a connection string do Postgres na VPS.
4. Salve e faca **redeploy** ou **restart** do servico.
5. Confira os logs de boot: `[database] Using direct PostgreSQL (pg)`.
6. Confira `GET /health`: `services.postgresPing` deve ser `true`.

Documentacao detalhada: [deploy.md](../.cursor/context/topics/deploy.md) e [backend/.env.example](backend/.env.example).

## Proximo passo imediato

Fazer o backend local rodar com o banco da VPS primeiro, mantendo a regra de negocio atual.

### Estrategia

- Evitar reescrever todas as rotas agora; validar localmente os endpoints principais contra a VPS.

## Riscos ainda em aberto

- O backend usa `Postgres-js` em muitos pontos do `server.js`.
- A troca nao e so de string de conexao; e tambem de camada de acesso.
- rotas Express, secrets e runtime do Postgres ainda nao foram aposentados.
- O banco `public` esta validado; o ecossistema completo do Postgres ainda nao foi migrado.

## Log de implementacao (backend)


## Resumo executivo

- Dados: migrados e conferidos
- Schema `public`: igual entre remoto e VPS
- Backend: pode usar a VPS em runtime com `DATABASE_URL` + driver Postgres (camada de compatibilidade em `pgPostgresCompat.js`)
- rotas Express: ainda precisam virar rotas ou workers
- Proximo foco: smoke local contra a VPS e cutover de URLs no n8n
