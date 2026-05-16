# Hardcoded Chatbot Guide

## Visão Geral

O sistema de chatbot hardcoded foi projetado para:
- **Fluxo em código**: Perguntas e validações definidas em código (estável e versionado)
- **Dados dinâmicos**: Dados do usuário salvos incrementalmente em tempo real
- **Redis para contexto**: Mantém contexto da conversa ativa (evita repetição)
- **Backend para histórico**: Salva histórico completo em `leads_outlier`
- **Métricas completas**: Coleta dados mesmo que a conversa seja abandonada

## Arquitetura

### Componentes

1. **`hardcoded-chatbot.js`**: Engine base do chatbot
   - Classe `HardcodedChatbot`: Base abstrata
   - Classe `ChatbotStep`: Define um passo da conversa
   - Redis memory: Contexto de conversa ativa (TTL 24h)

2. **`hardcoded-chatbot-outlier.js`**: Implementação para Outlier
   - Classe `OutlierQualificationBot`: Fluxo SPIN Selling
   - 9 passos de qualificação (Situação → Problema → Implicação → Necessidade)

3. **`hardcoded-chatbot-persistence.js`**: Persistência em BD
   - `persistChatbotProgress()`: Salva progresso incremental
   - `determineSPINPhase()`: Mapeia stepId para fase SPIN
   - `qualifyLead()`: Qualifica lead como QUENTE/MORNO/FRIO
   - `generateConversationSummary()`: Resumo da conversa

4. **Tabela `leads_outlier`**: Armazena conversas
   ```sql
   - id (UUID PK)
   - client_id (TEXT, FK)
   - telefone (TEXT)
   - status_conversa (aguardando_usuario | em_atendimento | finalizado)
   - spin_fase (situacao | problema | implicacao | necessidade)
   - status (QUENTE | MORNO | FRIO)
   - dados (JSONB) - dados coletados incrementalmente
   - finalizado (BOOLEAN)
   - mensagem (TEXT)
   - created_at (TIMESTAMPTZ)
   ```

## Fluxo de Conversa (Outlier)

### Passos (9 total)

**Fase: SITUAÇÃO**
1. `situation_interest` → "Você tem interesse?" (campo: `interesse`)
2. `situation_objective` → "Qual seu objetivo?" (campo: `objetivo`)
3. `situation_state` → "Em qual estado está?" (campo: `estado`)
4. `situation_city` → "E qual é sua cidade?" (campo: `cidade`)

**Fase: PROBLEMA**
5. `problem_credit` → "Como avalia seu crédito?" (campo: `crédito`)

**Fase: IMPLICAÇÃO**
6. `implication_parcels` → "Quantas parcelas?" (campo: `parcela`)
7. `implication_timeline` → "Qual seu prazo?" (campo: `prazo`)
8. `implication_fgts` → "Usar FGTS na entrada?" (campo: `lance_entrada_fgts`)

**Fase: NECESSIDADE**
9. `necessity_best_time` → "Melhor horário?" (campo: `melhor_horario`)

## API Endpoint

### POST /api/hardcoded-chat

Processa mensagens do chatbot.

**Request:**
```json
{
  "clientId": "outlier",
  "phone": "5511999999999",
  "message": "Sim" // opcional - omitir para iniciar conversa
}
```

**Response (Iniciar):**
```json
{
  "success": true,
  "clientId": "outlier",
  "phone": "***9999",
  "message": "Olá! 👋 Nós da Vexo CRM estamos te contando sobre oportunidades de crédito. Você tem interesse em conhecer nossas soluções? (sim/não)",
  "status": "started",
  "stepId": "situation_interest",
  "metrics": {
    "durationSeconds": 2,
    "stepsCompleted": 0,
    "isCompleted": false,
    "status": "em_atendimento"
  },
  "leadId": "uuid-da-conversa"
}
```

**Response (Resposta Válida):**
```json
{
  "success": true,
  "clientId": "outlier",
  "phone": "***9999",
  "message": "Qual é seu principal objetivo? (Refinanciar dívidas / Investimento pessoal / Expandir negócio / Reforma / Outro)",
  "status": "next_step",
  "stepId": "situation_objective",
  "collectedData": {
    "interesse": "Sim"
  },
  "metrics": {
    "durationSeconds": 45,
    "stepsCompleted": 1,
    "isCompleted": false,
    "status": "em_atendimento"
  },
  "leadId": "uuid-da-conversa"
}
```

**Response (Resposta Inválida):**
```json
{
  "success": true,
  "clientId": "outlier",
  "phone": "***9999",
  "message": "Por favor, responda com 'sim' ou 'não'",
  "status": "invalid_response",
  "retryStepId": "situation_interest",
  "metrics": { ... }
}
```

**Response (Conversa Finalizada):**
```json
{
  "success": true,
  "clientId": "outlier",
  "phone": "***9999",
  "message": "Obrigado! Suas informações foram salvas.",
  "status": "completed",
  "collectedData": {
    "interesse": "Sim",
    "objetivo": "Refinanciar dívidas",
    "estado": "São Paulo",
    "cidade": "São Paulo",
    "crédito": "Bom",
    "parcela": "12",
    "prazo": "Imediato",
    "lance_entrada_fgts": "Sim",
    "melhor_horario": "Manhã"
  },
  "metrics": {
    "durationSeconds": 180,
    "stepsCompleted": 9,
    "isCompleted": true,
    "status": "finalizado"
  },
  "leadId": "uuid-da-conversa"
}
```

## Salvamento Incremental

O chatbot salva o progresso **a cada resposta válida**, não apenas ao finalizar.

**Sequência:**
1. Usuário envia mensagem
2. Chatbot valida
3. Se válido: salva dados em Redis + atualiza `leads_outlier` no banco
4. Se inválido: rastreia tentativa e pede resposta novamente
5. Ao finalizar: marca como `finalizado: true`

**Garantias:**
- ✅ Mesmo se conversa abandonar: dados coletados até aquele ponto estarão no banco
- ✅ Redis é contexto temporário: permite saber qual foi a última pergunta feita
- ✅ Histórico completo em `leads_outlier`: cada interação fica registrada

## Qualificação de Lead

Classificação automática baseada em dados coletados:

| Status | Critério |
|--------|----------|
| **QUENTE** | Interesse "sim" + Crédito "excelente"/"bom" + ≥6 campos |
| **MORNO** | ≥4 campos coletados |
| **FRIO** | <4 campos ou falta interesse |

## Adicionando Novo Chatbot

Para criar um novo modelo de chatbot:

1. Crie arquivo `hardcoded-chatbot-{nome}.js`:
```javascript
import HardcodedChatbot from "./hardcoded-chatbot.js";

export class MeuChatbot extends HardcodedChatbot {
  constructor(clientId) {
    super(clientId, {
      startStepId: "start",
      steps: [
        {
          id: "start",
          message: "Pergunta 1?",
          dataField: "campo1",
          validator: (r) => ({ valid: r.length > 0 }),
          nextStepId: "passo2"
        },
        // ... mais passos
      ]
    });
  }
}
```

2. Registre no endpoint `/api/hardcoded-chat`:
```javascript
let chatbot;
if (clientId === "meu-cliente") {
  chatbot = new MeuChatbot(clientId);
} else {
  chatbot = new OutlierQualificationBot(clientId);
}
```

## Debugging

**Ver conversa em Redis:**
```bash
redis-cli
> SELECT 1
> KEYS chat:*
> GET chat:outlier:5511999999999
```

**Ver histórico em Postgres:**
```sql
SELECT id, status_conversa, spin_fase, status, dados, finalizado, created_at
FROM leads_outlier
WHERE client_id = 'outlier'
ORDER BY created_at DESC
LIMIT 10;
```

**Logs:**
```
[hardcoded-chat] Error: ...
[chatbot-persistence] Progress saved: ...
[redis-chat] Connected to Redis for chat memory
```

## Métricas

Cada resposta retorna métricas:
- `durationSeconds`: Tempo total de conversa
- `stepsCompleted`: Número de campos coletados
- `isCompleted`: Se conversa finalizou
- `status`: Estado atual (em_atendimento | finalizado)

## Considerações de Produção

1. **Redis**: Use Redis persistente em produção (RDB ou AOF)
2. **RLS**: `leads_outlier` tem RLS habilitado - acesso apenas via service role
3. **Phone normalization**: Telefones são normalizados e salvos de forma consistente
4. **TTL**: Redis cache expira em 24h - conversas muito antigas serão zeradas
5. **Escalabilidade**: Chatbot é stateless - pode rodar em múltiplas instâncias
