# Scripts legados de importacao

Este diretorio nao faz parte do fluxo operacional atual.

## Status

O projeto nao usa mais planilhas como fonte principal de leads. A operacao atual roda com:

- `n8n`
- `Supabase`
- `Supabase Edge Functions`

Por isso, os scripts desta pasta devem ser tratados apenas como material historico ou de contingencia.

## O que ainda existe aqui

| Arquivo | Status |
| --- | --- |
| `setup-leads-tables.sql` | legado |
| `excel-to-leads.py` | legado |
| `leads.json` | artefato de apoio antigo |
| `backend/scripts/import-leads.js` | pode ser reaproveitado somente em migracoes manuais |

## O que fazer em operacao normal

Nao use estes scripts para o dia a dia.

Para gravar ou atualizar leads no fluxo atual, use:

- `lead-webhook`

Para memoria de conversa, use:

- `conversation-memory`
- `conversation-memory-latest`

## Quando esta pasta ainda pode ser util

- migracao extraordinaria;
- carga inicial manual;
- auditoria de dados antigos.

Mesmo nesses casos, revise o schema primeiro em [database.md](../database.md).
