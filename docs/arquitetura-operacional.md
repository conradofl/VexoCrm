# Arquitetura operacional

## Objetivo

Documentar a arquitetura real atualmente usada pela operacao.

## Camadas

### 1. Entrada de mensagens

- WhatsApp via API de mensageria
- webhook de entrada no `n8n`

### 2. Orquestracao

- `n8n` conduz a conversa, decide ramificacoes e chama as Edge Functions

### 3. Persistencia e integracao

- `Supabase PostgreSQL`
- `Supabase Edge Functions`

### 4. Camada de aplicacao

- frontend React/Vite
- backend Node.js/Express

## Responsabilidade por componente

| Componente | Responsabilidade |
| --- | --- |
| `n8n` | receber mensagens, qualificar, enviar respostas e chamar functions |
| `conversation-memory` | salvar memoria comprimida |
| `conversation-memory-latest` | buscar ultimo contexto |
| `lead-webhook` | criar e finalizar leads |
| `n8n-error-webhook` | registrar falhas e gerar notificacoes |
| `notifications-api` | expor notificacoes ao CRM |
| `backend/` | dashboard, leads e notificacoes |
| `frontend/` | CRM interno e portal do cliente |

## Tabelas operacionais

| Tabela | Uso |
| --- | --- |
| `leads_clients` | cadastro de clientes/origens |
| `leads` | base principal de leads |
| `lead_conversations` | memoria de conversa |
| `notifications` | notificacoes operacionais |
| `n8n_error_logs` | auditoria de erros |

## Fluxo de dados

1. O webhook do n8n recebe a mensagem.
2. O telefone e normalizado.
3. O n8n consulta `conversation-memory-latest`.
4. Se necessario, cria o lead com `lead-webhook` usando `action=create`.
5. O motor de qualificacao conduz a conversa.
6. Ao final, o n8n chama `lead-webhook` com `action=finalize`.
7. A memoria e compactada e salva em `conversation-memory`.
8. Se houver erro, o fluxo de erro chama `n8n-error-webhook`.
9. O CRM consome os dados ja consolidados.

## Autenticacao

### CRM

- usuarios autenticados com Firebase;
- backend valida token antes de liberar rotas protegidas.

### Edge Functions do workflow

- acesso por bearer interno usado pelo n8n.

### `notifications-api`

- usa JWT do usuario para validacao.

## Decisao arquitetural atual

O banco e as automacoes centrais estao no eixo:

- `n8n + Supabase + Edge Functions`

O backend permanece importante, mas como camada de produto e consolidacao de servicos, nao como origem principal do fluxo de leads.
