# Frontend VexoCrm

Aplicacao React + Vite do CRM e do portal de clientes.

## Objetivo

O frontend entrega duas experiencias:

- CRM interno para equipe operacional;
- portal por cliente em rotas publicas controladas.

## Stack

- React 18
- TypeScript
- Vite
- TanStack Query
- Firebase Auth
- Recharts
- componentes baseados em Radix UI

## Rotas principais

| Rota | Papel |
| --- | --- |
| `/` e `/home` | landing page |
| `/login` | autenticacao |
| `/set-password` | troca obrigatoria de senha |
| `/crm/dashboard` | dashboard operacional |
| `/crm/leads` | base de leads |
| `/crm/agente` | notificacoes e visao operacional |
| `/clientes/:clientId/dashboard` | portal resumido por cliente |
| `/clientes/:clientId/leads` | leads do cliente |

## Fontes de dados

O frontend consome principalmente o backend Node para:

- `GET /api/lead-clients`
- `GET /api/dashboard`
- `GET /api/leads`

Autenticacao:

- Firebase Auth no login;
- token validado pelo backend nas rotas protegidas.

## Estrutura

```text
frontend/
|-- src/
|   |-- components/
|   |-- contexts/
|   |-- hooks/
|   |-- lib/
|   `-- pages/
`-- supabase/
    `-- functions/
```

## Paginas

### Landing

Pagina de entrada institucional do produto.

### Dashboard

Exibe:

- total de leads;
- leads do dia;
- qualificados;
- taxa de qualificacao;
- cidades ativas;
- distribuicoes por temperatura, perfil e status.

### Leads

Mostra a base no schema atual:

- `telefone`
- `nome`
- `tipo_cliente`
- `faixa_consumo`
- `cidade`
- `estado`
- `status`
- `data_hora`
- `qualificacao`
- `created_at`

### Agente

Tela operacional para notificacoes e erros do ecossistema n8n/Supabase.

### Portal do cliente

Rotas `/clientes/:clientId/*` para visao segmentada por cliente.

## Relacao com Supabase Edge Functions

A pasta `frontend/supabase/functions/` esta no mesmo modulo por conveniencia de repositorio, mas:

- nao entra no bundle do React;
- pertence ao runtime de automacao com Supabase;
- e consumida principalmente pelo `n8n`.

As funcoes ativas estao documentadas em [../docs/supabase-functions.md](../docs/supabase-functions.md).

## O que nao faz mais parte do fluxo

Nao existe mais dependencia operacional de planilhas ou `Google Sheets` para a captura e qualificacao dos leads.

## Execucao local

Variavel de ambiente da API: `VITE_API_BASE_URL` (sem barra final). Em desenvolvimento, se nao estiver definida, o codigo usa `http://127.0.0.1:3001` (backend local na porta padrao). Copie `.env.example` para `.env.local` e ajuste se o backend nao for esse endereco.

```powershell
cd frontend
npm install
npm run dev
```

## Build

```powershell
cd frontend
npm run build
```
