# Workflow n8n: Versao Nova

Documento baseado no export `Versão Nova (1).json`.

## Identificacao

| Item | Valor |
| --- | --- |
| Nome do workflow | `Versao Nova` |
| Total de nos | `38` |
| Entrada | webhook HTTP |
| Objetivo | qualificar leads WhatsApp, consolidar memoria e registrar no Supabase |

## Blocos do workflow

Os grupos visuais do arquivo exportado estao organizados assim:

- `Verifica e Inclui Lead no Banco`
- `Qualifica/Gerencia Lead`
- `Envia Qualificacao para SDR`
- `Limpeza Redis`

## Sequencia principal

1. `Webhook1` recebe a mensagem.
2. `E Audio ou MSG` divide o fluxo entre texto e audio.
3. No ramo de audio:
   - `Dados Audio`
   - `HTTP Request`
   - `Code in Python`
   - `Analyze audio`
4. No ramo de texto:
   - `Dados Msg`
5. Os dois ramos convergem em `Ajustar Numero`.
6. `Temos Conversas ?` consulta `conversation-memory-latest`.
7. `If2` decide entre continuar contexto existente ou iniciar novo.
8. `Salva Lead Infie` chama `lead-webhook` com `action=create`.
9. `Juntar Contexto` + `Qualificador` conduzem a qualificacao.
10. `Finalizado` decide se a conversa fechou a qualificacao.
11. `Agradece Lead` e `Dados` preparam a saida final.
12. `IA Extratora1` e `Objeto Json` estruturam os dados.
13. `Envia SDR` notifica o SDR.
14. `Salva Lead` chama `lead-webhook` com `action=finalize`.
15. `Compactar Conversa` e `Salvar Memoria no Backend` persistem contexto.

## Edge Functions chamadas no workflow

### `conversation-memory-latest`

Node:

- `Temos Conversas ?`

Requisicao:

```http
GET /functions/v1/conversation-memory-latest?telefone=<telefone>
Authorization: Bearer <token-interno>
```

Uso:

- recuperar a ultima memoria antes de montar o contexto.

### `lead-webhook` com `action=create`

Node:

- `Salva Lead Infie`

Payload logico:

```json
{
  "action": "create",
  "client_id": "infinie",
  "telefone": "<telefone-normalizado>",
  "nome": "<senderName>"
}
```

### `lead-webhook` com `action=finalize`

Node:

- `Salva Lead`

Payload logico:

```json
{
  "action": "finalize",
  "client_id": "infinie",
  "telefone": "<telefone-normalizado>",
  "nome": "<senderName>",
  "cidade": "<cidade-extraida>",
  "estado": "<estado-extraido>",
  "tipo_cliente": "<perfil-extraido>",
  "faixa_consumo": "<consumo-extraido>",
  "status": "qualificado",
  "qualificacao": "<texto-final-da-qualificacao>"
}
```

### `conversation-memory`

Node:

- `Salvar Memoria no Backend`

Payload esperado:

```json
{
  "telefone": "<telefone>",
  "conversation_compressed": "<payload-compactado>",
  "tamanho_original": 1234,
  "timestamp": "<iso-date>"
}
```

## Redis no fluxo

O export tambem mostra nos de Redis para:

- guardar contexto intermediario;
- compactar conversa;
- limpar estado transitorio.

Esses nos continuam relevantes, mas o armazenamento persistente de longo prazo esta no Supabase.

## Conclusao

O workflow `Versao Nova` confirma a arquitetura atual do projeto:

- entrada pelo `n8n`;
- persistencia via `Supabase Edge Functions`;
- CRM consultando dados consolidados;
- audio tratado dentro do proprio fluxo operacional.
