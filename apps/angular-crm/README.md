# Vexo Angular Sidecar

App Angular isolado criado como **sidecar incremental** do CRM da Vexo.

Esta aplicacao:

- nao substitui o frontend atual em `frontend/`
- nao altera backend, auth, Supabase, Edge Functions ou n8n
- serve como base controlada para rollout futuro de:
  - `Vexo Labs`
  - `Dashboard`
  - `Requests`

## Regras desta fase

- manter o React/Vite atual funcionando normalmente
- preservar contratos do backend existente
- validar auth, tenant e performance antes de migrar qualquer area critica

## Como rodar

```bash
cd apps/angular-crm
npm install
npm start
```

Por padrao, o Angular CLI sobe em:

- [http://localhost:4200](http://localhost:4200)

Isso nao conflita com o frontend React atual, que hoje roda em `http://localhost:8080`.

## Build

```bash
cd apps/angular-crm
npm run build
```

## Estrutura inicial

```text
apps/angular-crm/
|-- angular.json
|-- package.json
|-- src/
|   `-- app/
|       |-- app.config.ts
|       |-- app.html
|       |-- app.routes.ts
|       |-- app.scss
|       `-- app.ts
```

## Proximo passo esperado

Conectar:

1. autenticacao
2. contexto de tenant/empresa selecionada
3. contratos de API reutilizados do backend atual
