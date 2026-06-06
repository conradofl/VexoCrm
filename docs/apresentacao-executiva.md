# Apresentacao executiva

## Visao geral

O VexoCrm e o ecossistema de CRM e automacao da operacao Vexo/Infinie.

Hoje o projeto funciona sobre quatro pilares:

- atendimento e qualificacao automatizada no `n8n`;
- persistencia centralizada no `Supabase`;
- Edge Functions como interface operacional do workflow;
- CRM web para time interno e clientes.

## O que mudou

O projeto deixou de depender de planilhas.

A arquitetura atual concentra o fluxo em:

- `Supabase PostgreSQL`
- `Supabase Edge Functions`
- `n8n`

Isso reduziu dispersao de dados e simplificou o processo de captura, memoria de conversa, qualificacao e notificacao operacional.

## Componentes ativos

### Banco

- `leads_clients`
- `leads`
- `lead_conversations`
- `notifications`
- `n8n_error_logs`

### Edge Functions

- `conversation-memory`
- `conversation-memory-latest`
- `lead-webhook`
- `n8n-error-webhook`
- `notifications-api`

### Aplicacoes

- frontend React/Vite para CRM e portal;
- backend Node.js para consultas do CRM.

## Beneficios operacionais

- uma unica base de leads;
- memoria de conversa persistida;
- erro de workflow rastreado e notificado;
- qualificacao consolidada no banco;
- documentacao centralizada do processo.

## Fluxo resumido

1. O WhatsApp entra no `n8n`.
2. O fluxo identifica texto ou audio.
3. O n8n consulta memoria anterior no Supabase.
4. O lead e criado no inicio e finalizado ao fim da qualificacao.
5. O CRM consulta o resultado consolidado.
6. Falhas tecnicas viram notificacoes operacionais.

## Mensagem principal para apresentacao

O VexoCrm ja nao e mais um processo apoiado por planilhas. Hoje ele opera como uma stack integrada de automacao, banco e CRM, com persistencia centralizada no Supabase e orquestracao no n8n.
